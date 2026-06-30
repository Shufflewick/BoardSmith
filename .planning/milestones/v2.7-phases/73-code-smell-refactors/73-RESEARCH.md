# Phase 73: Code Smell Refactors - Research

**Researched:** 2026-02-01
**Domain:** Internal code quality - eliminating code smells
**Confidence:** HIGH

## Summary

This phase addresses two specific code smells identified in the codebase:

1. **SMELL-01: `suppressNextWatcherFetch` module-level flag** - A mutable module-level variable is used to coordinate between async operations (start/startFollowUp fetching choices) and a Vue watcher. This pattern is fragile and can lead to race conditions. The proper solution is to pass coordination state through function parameters or use a more structured state management pattern.

2. **SMELL-02: Redundant `unknown | undefined` return type** - The `injectBoardInteraction()` function has a return type of `unknown | undefined` which is redundant since `unknown` already includes `undefined`. This should simply be `unknown`.

**Primary recommendation:** Replace the module-level flag with a parameter-based coordination pattern (return value from helpers that the caller can use), and fix the redundant return type annotation.

## Standard Stack

No external libraries needed. This is purely internal TypeScript refactoring.

### Core Tools
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Type system | Project standard |
| Vue 3 | 3.x | Reactive framework | Project standard |

## Architecture Patterns

### Pattern 1: Parameter-Based Coordination (Instead of Module Flag)

**What:** Replace module-level mutable state with explicit parameter passing
**When to use:** When coordinating between async operations and watchers
**Why better:** Makes data flow explicit, avoids race conditions, easier to test

**Current problematic pattern:**
```typescript
// Module-level mutable state - CODE SMELL
let suppressNextWatcherFetch = false;

async function fetchAndAutoFill(selection: PickMetadata): Promise<void> {
  // Sets flag before async operation
  suppressNextWatcherFetch = true;
  await fetchChoicesForPick(selection.name);
  // ... rest of function
}

// Watcher checks and clears the flag
watch(currentPick, async (sel) => {
  const shouldSkipFetch = suppressNextWatcherFetch;
  if (shouldSkipFetch) {
    suppressNextWatcherFetch = false;
  }
  // Skip fetch if flag was set
  if (!shouldSkipFetch) {
    await fetchChoicesForPick(sel.name);
  }
});
```

**Problems with this pattern:**
1. **Race conditions:** If two calls to `start()` happen rapidly, the flag state becomes unpredictable
2. **Hidden state:** The coordination mechanism is not visible in function signatures
3. **Testing difficulty:** Hard to unit test because behavior depends on external mutable state
4. **Debugging difficulty:** Flag state isn't visible in Vue devtools or stack traces

**Recommended approach: Track fetched selections in snapshot**

The cleanest solution is to track which selections have been fetched in the `actionSnapshot` itself. This way:
- The watcher can check if a selection was already fetched
- No module-level mutable state needed
- State is visible in Vue devtools through actionSnapshot
- Easy to reason about and test

```typescript
// In ActionStateSnapshot interface, add:
interface ActionStateSnapshot {
  // ... existing fields ...
  /** Set of selection names that have been fetched (prevents double-fetch) */
  fetchedSelections: Set<string>;
}

// In fetchAndAutoFill:
async function fetchAndAutoFill(selection: PickMetadata): Promise<void> {
  if (selection.type !== 'choice' && selection.type !== 'element' && selection.type !== 'elements') {
    return;
  }

  // Mark as fetched BEFORE the async operation
  if (actionSnapshot.value) {
    actionSnapshot.value.fetchedSelections.add(selection.name);
  }

  await fetchChoicesForPick(selection.name);

  if (tryAutoFillSelection(selection)) {
    const nextSel = getNextSelection(selection.name);
    if (nextSel) {
      await fetchAndAutoFill(nextSel);
    }
  }
}

// In the watcher:
watch(currentPick, async (sel) => {
  if (!sel || isExecuting.value) return;

  // Check if this selection was already fetched by start/startFollowUp
  const alreadyFetched = actionSnapshot.value?.fetchedSelections.has(sel.name) ?? false;

  // Only fetch if not already fetched and needs choices
  if (!alreadyFetched) {
    const snapshot = actionSnapshot.value?.pickSnapshots.get(sel.name);
    if (!snapshot && (sel.type === 'choice' || sel.type === 'element' || sel.type === 'elements')) {
      // Mark as fetched before starting
      if (actionSnapshot.value) {
        actionSnapshot.value.fetchedSelections.add(sel.name);
      }
      await fetchChoicesForPick(sel.name);
    }
  }

  // ... rest of watcher (prefill and auto-fill logic) ...
});
```

**Why this is better:**
- State is scoped to the action, not global
- Automatically cleared when action ends (actionSnapshot becomes null)
- Visible in Vue devtools
- Testable (can inspect actionSnapshot.fetchedSelections)
- No timing-dependent flag clearing

### Pattern 2: Proper Return Type for Injection Functions

**What:** Use correct TypeScript types for Vue inject functions
**When to use:** When creating injection helper functions

**Current problematic pattern:**
```typescript
// REDUNDANT: unknown already includes undefined
export function injectBoardInteraction(): unknown | undefined {
  return inject<unknown | undefined>('boardInteraction', undefined);
}
```

**Problem:** `unknown | undefined` is redundant because `unknown` is the top type in TypeScript and includes all possible values, including `undefined`. The `| undefined` adds nothing but confusion.

**Additionally:** The function returns `BoardInteraction | undefined` in practice (the inject returns either the provided `BoardInteraction` or the default `undefined`). Using `unknown` loses the type information entirely.

**Correct pattern - Option A (typed return):**
```typescript
// Best: Return the actual type
export function injectBoardInteraction(): BoardInteraction | undefined {
  return inject<BoardInteraction | undefined>('boardInteraction', undefined);
}
```

**Correct pattern - Option B (unknown without redundant undefined):**
```typescript
// If unknown is intentional (for loose coupling), at least remove redundancy
export function injectBoardInteraction(): unknown {
  return inject('boardInteraction', undefined);
}
```

**Recommendation:** Use Option A (typed return) since:
1. `BoardInteraction` is already exported from the same module
2. The function is documented to return `BoardInteraction`
3. Consumers benefit from type safety

**However, looking at the actual code:**

The function is in `useActionController.ts` but `BoardInteraction` is defined in `useBoardInteraction.ts`. The `unknown` type was likely intentional to avoid a circular dependency or to keep the modules loosely coupled.

Given the constraint, the fix should be:
```typescript
// Remove redundant | undefined, keep unknown for loose coupling
export function injectBoardInteraction(): unknown {
  return inject('boardInteraction', undefined);
}
```

### Anti-Patterns to Avoid

- **Module-level mutable state for coordination:** Use parameters, return values, or scoped reactive state instead
- **Redundant union types:** `unknown | undefined`, `any | null`, etc. add confusion without benefit
- **Flag-based control flow:** Prefer explicit state tracking in appropriate data structures

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async coordination | Module-level flags | Scoped state in reactive objects | Race-condition free, debuggable |
| Type unions | Manual union with `undefined` | Let TypeScript infer from inject default | Cleaner, less redundant |

## Common Pitfalls

### Pitfall 1: Breaking the Double-Fetch Prevention

**What goes wrong:** After refactoring the flag, choices get fetched twice (once by start/startFollowUp, once by watcher)
**Why it happens:** The new coordination mechanism doesn't properly communicate "already fetched" state
**How to avoid:**
- Test the exact scenario: start action -> immediately check watcher doesn't refetch
- Ensure the "already fetched" state is set BEFORE the async fetch starts, not after
- Clear state appropriately when action ends
**Warning signs:** Network requests for the same selection twice, flickering UI

### Pitfall 2: Memory Leak from Persistent Set

**What goes wrong:** The `fetchedSelections` Set grows unboundedly
**Why it happens:** Not clearing the set when action completes
**How to avoid:**
- The set is part of `actionSnapshot` which is set to `null` when action ends
- Verify `clearAdvancedState()` is called on action completion
**Warning signs:** Memory growth over many actions (unlikely given set size, but worth verifying)

### Pitfall 3: Incorrect Type Change

**What goes wrong:** Consumers that were handling `undefined` separately start failing
**Why it happens:** Changing from `unknown | undefined` to `unknown` might affect type narrowing
**How to avoid:**
- The practical effect is minimal since `unknown` already requires type narrowing
- Search for usages of `injectBoardInteraction` to verify no breakage
**Warning signs:** TypeScript errors at call sites

## Code Examples

### SMELL-01: Replace Module Flag with Scoped State

**Before (problematic):**
```typescript
// Line 210 - module-level mutable state
let suppressNextWatcherFetch = false;

// Line 496 - set before fetch
suppressNextWatcherFetch = true;
await fetchChoicesForPick(selection.name);

// Lines 654-656 - check and clear
const shouldSkipFetch = suppressNextWatcherFetch;
if (shouldSkipFetch) {
  suppressNextWatcherFetch = false;
}
```

**After (proper coordination):**
```typescript
// In ActionStateSnapshot type
interface ActionStateSnapshot {
  // ... existing fields ...
  fetchedSelections: Set<string>;
}

// Initialize in start/startFollowUp
actionSnapshot.value = {
  actionName,
  metadata: ...,
  pickSnapshots: new Map(),
  collectedPicks: new Map(),
  repeatingState: null,
  prefills: new Map(...),
  fetchedSelections: new Set(),  // NEW
};

// In fetchAndAutoFill - mark before fetching
async function fetchAndAutoFill(selection: PickMetadata): Promise<void> {
  if (selection.type !== 'choice' && selection.type !== 'element' && selection.type !== 'elements') {
    return;
  }

  // Mark as fetched BEFORE async operation (prevents race with watcher)
  actionSnapshot.value?.fetchedSelections.add(selection.name);

  await fetchChoicesForPick(selection.name);

  if (tryAutoFillSelection(selection)) {
    const nextSel = getNextSelection(selection.name);
    if (nextSel) {
      await fetchAndAutoFill(nextSel);
    }
  }
}

// In watcher - check Set instead of flag
watch(currentPick, async (sel) => {
  if (!sel || isExecuting.value) return;

  // Check if already fetched by start/startFollowUp
  const alreadyFetched = actionSnapshot.value?.fetchedSelections.has(sel.name) ?? false;

  if (!alreadyFetched) {
    const snapshot = actionSnapshot.value?.pickSnapshots.get(sel.name);
    if (!snapshot && (sel.type === 'choice' || sel.type === 'element' || sel.type === 'elements')) {
      actionSnapshot.value?.fetchedSelections.add(sel.name);
      await fetchChoicesForPick(sel.name);
    }
  }

  // ... prefill and auto-fill logic unchanged ...
}, { immediate: true });
```

### SMELL-02: Fix Redundant Return Type

**Before (redundant):**
```typescript
// Line 1471
export function injectBoardInteraction(): unknown | undefined {
  return inject<unknown | undefined>('boardInteraction', undefined);
}
```

**After (clean):**
```typescript
export function injectBoardInteraction(): unknown {
  return inject('boardInteraction', undefined);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Module-level flags | Scoped state in reactive objects | Modern Vue 3 patterns | Eliminates race conditions |
| `unknown \| undefined` | Just `unknown` | TypeScript best practices | Cleaner types |

## Open Questions

1. **Should fetchedSelections be a Set or tracked differently?**
   - What we know: Set works well for "has this been fetched" checks
   - What's unclear: Could use pickSnapshots.has() as proxy for "fetched"
   - Recommendation: Explicit Set is clearer about intent. The presence of a pickSnapshot technically means it was fetched, but an explicit Set makes the double-fetch prevention intent obvious.

2. **Should injectBoardInteraction return typed BoardInteraction?**
   - What we know: Using `unknown` avoids coupling useActionController to useBoardInteraction
   - What's unclear: Whether this loose coupling is actually valuable
   - Recommendation: Keep `unknown` to maintain current architecture. The loose coupling was intentional to avoid circular dependencies and keep the modules independent.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - Direct source inspection of both smells
- `/Users/jtsmith/BoardSmith/src/ui/composables/useBoardInteraction.ts` - BoardInteraction type definition
- TypeScript documentation on `unknown` type (top type includes all values including undefined)

### Secondary (MEDIUM confidence)
- Vue 3 Composition API patterns for inject/provide coordination
- Phase 72 research establishing the helper extraction pattern (helpers already exist from DUP-02)

## Metadata

**Confidence breakdown:**
- SMELL-01 analysis: HIGH - Clear code smell, solution follows Vue 3 best practices
- SMELL-02 analysis: HIGH - TypeScript type system fact (unknown is top type)
- Implementation approach: HIGH - Straightforward refactoring with clear test scenarios

**Research date:** 2026-02-01
**Valid until:** No expiration - internal refactoring, not dependent on external factors
