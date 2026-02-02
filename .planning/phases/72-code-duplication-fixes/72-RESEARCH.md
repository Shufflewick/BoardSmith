# Phase 72: Code Duplication Fixes - Research

**Researched:** 2026-02-01
**Domain:** Internal code refactoring - extracting shared helpers
**Confidence:** HIGH

## Summary

This phase addresses two specific code duplication issues identified in the codebase:

1. **FlowEngine action step completion logic** - The `resume()` and `resumeAfterExternalAction()` methods share ~40 lines of nearly identical code for handling action step completion (move counting, maxMoves checking, repeatUntil evaluation). This logic should be extracted to a private helper method.

2. **useActionController auto-fill pattern** - The pattern of "fetch choices, check for auto-fill, update collectedPicks, recursively handle next selection" appears in three places: `start()`, `startFollowUp()`, and the `currentPick` watcher. This should be extracted to a reusable helper function.

**Primary recommendation:** Extract each duplicated pattern into a well-named private helper function. The helper should capture all the shared logic while accepting the minimal necessary parameters to differ between call sites.

## Standard Stack

No external libraries needed. This is purely internal refactoring of existing TypeScript code.

### Pattern: Extract Method Refactoring

The standard approach for removing code duplication:

1. Identify the duplicated code blocks
2. Determine what varies between instances
3. Create a helper function with parameters for the varying parts
4. Replace duplicated code with calls to the helper

## Architecture Patterns

### Pattern 1: Private Helper Method for FlowEngine

**What:** Extract the action step completion logic into a private method
**When to use:** When two public methods share significant implementation logic

**Current duplication (resume and resumeAfterExternalAction):**
```typescript
// Lines 183-223 in resume(), lines 248-288 in resumeAfterExternalAction()
// Handle action step completion logic
if (currentFrame?.node.type === 'action-step') {
  const config = currentFrame.node.config as ActionStepConfig;

  // If action returned a followUp, don't complete the step...
  if (result.followUp) {
    return this.run();
  }

  // Increment move count...
  const currentMoveCount = (currentFrame.data?.moveCount as number) ?? 0;
  const newMoveCount = currentMoveCount + 1;
  currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };

  // Check if maxMoves reached - auto-complete
  if (config.maxMoves && newMoveCount >= config.maxMoves) {
    currentFrame.completed = true;
    this.currentActionConfig = undefined;
    this.moveCount = 0;
  }
  // Check repeatUntil - only complete if minMoves is met
  else if (config.repeatUntil) {
    const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
    if (config.repeatUntil(this.createContext()) && minMovesMet) {
      currentFrame.completed = true;
      this.currentActionConfig = undefined;
      this.moveCount = 0;
    }
  }
  // No repeatUntil and no maxMoves - complete after single action
  else if (!config.minMoves && !config.maxMoves) {
    currentFrame.completed = true;
    this.currentActionConfig = undefined;
    this.moveCount = 0;
  }
}
```

**Recommended extraction:**
```typescript
/**
 * Handle action step completion after a successful action.
 * Updates move count, checks completion conditions, and marks frame complete if appropriate.
 *
 * @param result - The action result (used to check for followUp)
 * @returns true if the step should run() immediately (followUp case), false otherwise
 */
private handleActionStepCompletion(result: ActionResult): boolean {
  const currentFrame = this.stack[this.stack.length - 1];
  if (currentFrame?.node.type !== 'action-step') {
    return false;
  }

  const config = currentFrame.node.config as ActionStepConfig;

  // If action returned a followUp, don't complete the step or count the move yet
  if (result.followUp) {
    return true; // Caller should run() immediately
  }

  // Increment move count
  const currentMoveCount = (currentFrame.data?.moveCount as number) ?? 0;
  const newMoveCount = currentMoveCount + 1;
  currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };

  // Check completion conditions
  if (config.maxMoves && newMoveCount >= config.maxMoves) {
    this.completeActionStep(currentFrame);
  } else if (config.repeatUntil) {
    const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
    if (config.repeatUntil(this.createContext()) && minMovesMet) {
      this.completeActionStep(currentFrame);
    }
  } else if (!config.minMoves && !config.maxMoves) {
    this.completeActionStep(currentFrame);
  }

  return false;
}

/**
 * Mark an action step frame as completed and reset tracking state.
 */
private completeActionStep(frame: ExecutionFrame): void {
  frame.completed = true;
  this.currentActionConfig = undefined;
  this.moveCount = 0;
}
```

### Pattern 2: Auto-fill Helper for useActionController

**What:** Extract the fetch-and-auto-fill logic into a helper function
**When to use:** When the same async logic pattern repeats in multiple locations

**Current duplication (appears in 3 places):**

Location 1: `start()` (lines 1066-1113)
Location 2: `startFollowUp()` (lines 960-1003)
Location 3: `currentPick` watcher (lines 653-671) - simpler version without recursive next-selection handling

**The duplicated pattern:**
```typescript
// Fetch choices for selection that needs input
if (selectionToFetch && (selectionToFetch.type === 'choice' || selectionToFetch.type === 'element' || selectionToFetch.type === 'elements')) {
  suppressNextWatcherFetch = true;
  await fetchChoicesForPick(selectionToFetch.name);

  // After fetching, check for auto-fill (but not for optional selections)
  if (getAutoFill() && !isExecuting.value) {
    const choices = getChoices(selectionToFetch);
    if (choices.length === 1 && !selectionToFetch.optional) {
      const choice = choices[0];
      currentArgs.value[selectionToFetch.name] = choice.value;

      if (actionSnapshot.value) {
        actionSnapshot.value.collectedPicks.set(selectionToFetch.name, {
          value: choice.value,
          display: choice.display,
          skipped: false,
        });
      }

      // Recursively fetch and auto-fill the next selection if needed
      const nextSel = getNextSelection(selectionToFetch.name);
      if (nextSel && (nextSel.type === 'choice' || nextSel.type === 'element' || nextSel.type === 'elements')) {
        await fetchChoicesForPick(nextSel.name);
        // ... same auto-fill logic for nextSel
      }
    }
  }
}
```

**Recommended extraction:**
```typescript
/**
 * Attempt to auto-fill a selection if it has exactly one non-optional choice.
 * Updates both currentArgs and collectedPicks in actionSnapshot.
 *
 * @param selection - The selection metadata to check for auto-fill
 * @returns true if auto-fill was applied, false otherwise
 */
function tryAutoFillSelection(selection: PickMetadata): boolean {
  if (!getAutoFill() || isExecuting.value) return false;

  const choices = getChoices(selection);
  if (choices.length !== 1 || selection.optional) return false;

  const choice = choices[0];
  currentArgs.value[selection.name] = choice.value;

  if (actionSnapshot.value) {
    actionSnapshot.value.collectedPicks.set(selection.name, {
      value: choice.value,
      display: choice.display,
      skipped: false,
    });
  }

  return true;
}

/**
 * Fetch choices for a selection and attempt auto-fill.
 * Recursively handles next selection if current is auto-filled.
 *
 * @param selection - The selection to fetch and potentially auto-fill
 */
async function fetchAndAutoFill(selection: PickMetadata): Promise<void> {
  // Only fetch for types that have choices
  if (selection.type !== 'choice' && selection.type !== 'element' && selection.type !== 'elements') {
    return;
  }

  suppressNextWatcherFetch = true;
  await fetchChoicesForPick(selection.name);

  if (tryAutoFillSelection(selection)) {
    // Recursively handle next selection
    const nextSel = getNextSelection(selection.name);
    if (nextSel) {
      await fetchAndAutoFill(nextSel);
    }
  }
}
```

### Anti-Patterns to Avoid

- **Extracting too much:** Don't combine both helpers into one mega-function. Keep them focused on single responsibilities.
- **Over-parameterizing:** The helpers should use closure over the composable's state, not accept everything as parameters.
- **Changing behavior:** This is a refactoring, not a feature change. The extracted helpers should have identical behavior to the current inline code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Method extraction | Manual copy-paste-modify | IDE refactoring tools | Reduces risk of introducing subtle bugs |
| Test coverage | Skip testing extracted helper | Test helper directly | Extracted functions deserve their own unit tests |

## Common Pitfalls

### Pitfall 1: Subtle Behavior Differences After Extraction

**What goes wrong:** The extracted helper behaves slightly differently due to scope or timing differences.
**Why it happens:** Control flow that was linear becomes nested function calls.
**How to avoid:**
- Extract exact code first, then consider optimizations
- Preserve early returns as boolean return values
- Write tests before and verify they pass after extraction
**Warning signs:** Failing tests after extraction, different timing in async operations.

### Pitfall 2: Over-extraction

**What goes wrong:** Extracting so many helpers that the code becomes harder to follow.
**Why it happens:** Enthusiasm for "clean code" without considering readability tradeoffs.
**How to avoid:** Only extract genuinely duplicated code (3+ occurrences) or very long blocks.
**Warning signs:** Needing to jump between many functions to understand a simple flow.

### Pitfall 3: Breaking the currentPick Watcher

**What goes wrong:** The watcher has subtle timing dependencies (suppressNextWatcherFetch flag).
**Why it happens:** Async watchers interact with state in ways that aren't obvious.
**How to avoid:** Ensure the extracted helper properly handles the suppressNextWatcherFetch flag. The watcher's version is simpler - it doesn't do recursive next-selection handling.
**Warning signs:** Double-fetch issues, choices not loading properly.

## Code Examples

### DUP-01: FlowEngine Completion Logic

**Before refactoring (resume):**
```typescript
resume(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
  // ... validation and action execution ...

  // Clear error and awaiting state on success
  this.actionError = undefined;
  this.awaitingInput = false;

  // Handle action step completion logic
  if (currentFrame?.node.type === 'action-step') {
    const config = currentFrame.node.config as ActionStepConfig;
    // ... 35+ lines of completion logic ...
  }

  return this.run();
}
```

**After refactoring (resume):**
```typescript
resume(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
  // ... validation and action execution ...

  // Clear error and awaiting state on success
  this.actionError = undefined;
  this.awaitingInput = false;

  // Handle action step completion - returns true if should run() immediately (followUp)
  if (this.handleActionStepCompletion(result)) {
    return this.run();
  }

  return this.run();
}
```

**After refactoring (resumeAfterExternalAction):**
```typescript
resumeAfterExternalAction(result: ActionResult): FlowState {
  // ... validation ...

  this.lastActionResult = result;
  if (!result.success) {
    return this.getState();
  }

  this.awaitingInput = false;

  // Handle action step completion - returns true if should run() immediately (followUp)
  if (this.handleActionStepCompletion(result)) {
    return this.run();
  }

  return this.run();
}
```

### DUP-02: useActionController Auto-fill Pattern

**Before refactoring (start):**
```typescript
async function start(actionName: string, options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }): Promise<void> {
  // ... setup code ...

  if (meta.selections.length > 0) {
    let selectionToFetch: PickMetadata | undefined;
    for (const sel of meta.selections) {
      if (initialArgs[sel.name] === undefined) {
        selectionToFetch = sel;
        break;
      }
    }

    if (selectionToFetch && (selectionToFetch.type === 'choice' || selectionToFetch.type === 'element' || selectionToFetch.type === 'elements')) {
      suppressNextWatcherFetch = true;
      await fetchChoicesForPick(selectionToFetch.name);
      // ... 40+ lines of auto-fill logic with recursive next-selection handling ...
    }
  }
}
```

**After refactoring (start):**
```typescript
async function start(actionName: string, options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }): Promise<void> {
  // ... setup code ...

  if (meta.selections.length > 0) {
    const firstUnfilledSelection = findFirstUnfilledSelection(meta.selections, initialArgs);
    if (firstUnfilledSelection) {
      await fetchAndAutoFill(firstUnfilledSelection);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline duplicated code | Extracted helpers | This phase | Reduced maintenance burden, single source of truth |

## Open Questions

1. **Should the watcher use the same helper?**
   - What we know: The watcher's auto-fill logic is simpler (no recursive next-selection handling) and handles prefills
   - What's unclear: Whether unifying would improve or complicate the code
   - Recommendation: Keep watcher separate or extract just the `tryAutoFillSelection` portion. The recursive `fetchAndAutoFill` may not be appropriate for the watcher due to its prefill handling.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/engine/flow/engine.ts` - FlowEngine source with duplicated `resume` logic
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - useActionController source with duplicated auto-fill pattern
- Direct source code inspection of all duplicate locations

## Metadata

**Confidence breakdown:**
- FlowEngine duplication: HIGH - Lines 182-226 and 248-288 are nearly identical
- useActionController duplication: HIGH - Lines 960-1003, 1055-1113, and 653-671 follow the same pattern
- Extraction approach: HIGH - Standard refactoring patterns, no external dependencies

**Research date:** 2026-02-01
**Valid until:** No expiration - internal refactoring, not dependent on external factors
