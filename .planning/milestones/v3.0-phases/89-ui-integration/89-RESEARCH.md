# Phase 89: UI Integration - Research

**Researched:** 2026-02-07
**Domain:** Vue 3 composables, provide/inject wiring, animation gating
**Confidence:** HIGH

## Summary

This phase completes the v3.0 animation system UI integration by performing three surgical changes: (1) removing the dead `acknowledge` callback from `createAnimationEvents()`, (2) confirming `useCurrentView`/`CURRENT_VIEW_KEY` are already deleted, and (3) verifying GameShell provides a single `gameView` with no `currentGameView` alternative. The ActionPanel animation gating already works correctly via the `useActionController` integration established in Phase 83 and preserved through Phases 85-88.

The codebase is 90% there. Phase 85 (theatre erasure) already deleted `useCurrentView.ts`, removed `CURRENT_VIEW_KEY` exports, removed the `currentGameView` computed from GameShell, and wired `createAnimationEvents()` with a no-op acknowledge (`() => {}`). Phase 88 added the wait-for-handler mechanism. What remains is cleaning up the dead `acknowledge` parameter from the interface and call sites, and verifying the full chain end-to-end.

**Primary recommendation:** This is a cleanup phase -- remove the `acknowledge` parameter from `UseAnimationEventsOptions`, update all call sites (`GameShell.vue`, tests), verify ActionPanel gating still works, and update example games (`cribbage`, `demo-animation`).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.x | `ref`, `watch`, `computed`, `provide/inject` | Already used throughout the UI module |

### Supporting
No additional libraries. This is purely refactoring existing code.

### Alternatives Considered
None -- this phase has no design decisions to make. All choices were locked in Phases 85 and 88.

## Architecture Patterns

### Current File Structure (modify in place)
```
src/ui/composables/
  useAnimationEvents.ts        # Remove acknowledge from interface + processQueue
  useAnimationEvents.test.ts   # Remove acknowledge from all test setups (~40 call sites)
src/ui/components/
  GameShell.vue                # Remove acknowledge: () => {} from createAnimationEvents call
  auto-ui/ActionPanel.vue      # Verify gating works (no changes expected)
```

### Pattern 1: Provide/Inject for Component Tree Access

GameShell creates composable instances and provides them down the component tree. Child components inject them.

**Current provide/inject chain (verified from source):**
```
GameShell.vue
  |-- createAnimationEvents({ events: ... })    # Creates instance
  |-- provideAnimationEvents(animationEvents)    # provide(ANIMATION_EVENTS_KEY, ...)
  |-- provide('gameView', gameView)              # String injection key
  |-- provide('actionController', actionController)
  |-- provideBoardInteraction(boardInteraction)   # Symbol injection key
  |
  +-- ActionPanel.vue
  |     |-- useAnimationEvents()                 # inject(ANIMATION_EVENTS_KEY)
  |     |-- inject('actionController')
  |     |-- useBoardInteraction()
  |
  +-- Custom game boards (via slot)
        |-- useAnimationEvents()                 # Optional, for registering handlers
```

**Key insight:** `ANIMATION_EVENTS_KEY` uses a `Symbol` InjectionKey (typed via Vue's `InjectionKey<T>`), while `gameView` uses a raw string key `'gameView'`. Both patterns exist in the codebase.

### Pattern 2: Animation Gating in useActionController

The gating mechanism is already fully implemented in `useActionController.ts` (lines 1340-1353):

```typescript
// Inside useActionController():
const animationsPending = computed((): boolean => {
  return options.animationEvents?.isAnimating.value ?? false;
});

const showActionPanel = computed((): boolean => {
  return Boolean(isMyTurn.value) && !animationsPending.value && !pendingFollowUp.value;
});
```

ActionPanel consumes these (lines 91-92 of ActionPanel.vue):
```typescript
const animationsPending = computed(() => actionController.animationsPending.value);
const showActionPanel = computed(() => actionController.showActionPanel.value);
```

And the template uses them for gating (line 1373-1379):
```html
<div v-if="animationsPending" class="action-panel-pending">
  <span class="pending-text">Playing animations...</span>
  <button class="skip-btn" @click="skipAnimations">Skip</button>
</div>
<div class="action-panel" v-else-if="showActionPanel">
  <!-- Normal action panel content -->
</div>
```

**This is already working. No changes needed for UI-01.**

### Anti-Patterns to Avoid
- **Removing too much:** Do NOT remove `defaultDuration` from the interface -- it serves a backward-compat purpose separate from acknowledge (documented in Phase 88 decisions)
- **Breaking external consumers:** CribbageBoard.vue creates its own `createAnimationEvents()` directly (not via GameShell). Its call site must be updated too.

## Current State Assessment

### CLI-10: Remove acknowledgment callback from `createAnimationEvents()`

**Status:** The `acknowledge` callback exists in the interface and implementation but is wired to `() => {}` in GameShell (since Phase 85).

**What exists in `useAnimationEvents.ts`:**
```typescript
// Interface (line 52):
acknowledge: (upToId: number) => void;

// Destructured in createAnimationEvents (line 109):
const { events: getEvents, acknowledge, ... } = options;

// Called in processQueue after each event (line 214, 231):
acknowledge(event.id);

// Called in skipAll for batch ack (line 246):
acknowledge(lastEvent.id);
```

**What to do:**
1. Remove `acknowledge` from `UseAnimationEventsOptions` interface
2. Remove `acknowledge` destructure from `createAnimationEvents()`
3. Remove all `acknowledge(...)` calls from `processQueue()` and `skipAll()`
4. Remove `acknowledge` from docstring example (line 21)
5. Update all 40+ test call sites that pass `acknowledge: vi.fn()`
6. Remove test cases specifically about acknowledge behavior (the "per-event advancement" tests)

**GameShell.vue call site (lines 168-171):**
```typescript
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
  acknowledge: () => {},  // <-- Remove this line
});
```

### CLI-11: Remove `useCurrentView()` composable and `CURRENT_VIEW_KEY`

**Status: ALREADY DONE.** Phase 85-03 deleted these:
- `src/ui/composables/useCurrentView.ts` -- file does not exist
- `src/ui/composables/useCurrentView.test.ts` -- file does not exist
- No `CURRENT_VIEW_KEY` or `useCurrentView` references exist in `src/`

**Verification:** `grep -r "useCurrentView\|CURRENT_VIEW_KEY" src/` returns zero results (confirmed during research).

**No action needed.** This requirement is already satisfied.

### UI-01: ActionPanel gates on pending animation events

**Status: ALREADY WORKING.** The full gating chain is in place:
1. `createAnimationEvents()` provides `isAnimating` ref
2. `useActionController()` accepts `animationEvents` option and exposes `animationsPending` + `showActionPanel` computed
3. GameShell passes `animationEvents` to `useActionController()` (line 235)
4. ActionPanel reads `animationsPending` and `showActionPanel` from controller (lines 91-92)
5. Template gates on these values (lines 1373-1379)

**No changes needed.** This requirement is already satisfied.

### UI-02: GameShell wires `createAnimationEvents` without acknowledge callback

**Status: Partially done.** GameShell currently wires with `acknowledge: () => {}`. After CLI-10 removes the parameter from the interface, this line must be removed.

**Single change needed in GameShell.vue (lines 168-171):**
```typescript
// Before:
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
  acknowledge: () => {},
});

// After:
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
});
```

### UI-03: GameShell provides single `gameView` (truth) -- no `currentGameView`

**Status: ALREADY DONE.** Phase 85-03 removed the `currentGameView` computed and `CURRENT_VIEW_KEY` provide from GameShell.

GameShell currently (lines 206-211, 359):
```typescript
const gameView = computed(() => {
  if (timeTravelState.value) {
    return timeTravelState.value.view as any;
  }
  return state.value?.state.view as any;
});

provide('gameView', gameView);  // Single truth view
```

No `currentGameView` exists. No alternative view is provided.

**No action needed.** This requirement is already satisfied.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Animation gating | Custom gating logic | Existing `animationsPending`/`showActionPanel` computed in useActionController | Already implemented and tested |
| View injection | New injection keys | Existing `provide('gameView', gameView)` | Already the single source of truth |

## Common Pitfalls

### Pitfall 1: Missing Test Updates for Acknowledge Removal
**What goes wrong:** Tests pass `acknowledge: vi.fn()` in ~40 call sites. If `acknowledge` is removed from the interface, all these will be TypeScript errors.
**Why it happens:** The test file is 1136 lines with many test setups.
**How to avoid:** Do a systematic pass removing `acknowledge` from every `createAnimationEvents()` call in the test file. Also remove tests that specifically assert acknowledge call counts (the "per-event advancement" describe block).
**Warning signs:** `npx tsc --noEmit` will catch all of these as type errors.

### Pitfall 2: External Game Consumer Breakage (Cribbage)
**What goes wrong:** CribbageBoard.vue (in BoardSmithGames) calls `createAnimationEvents()` directly with its own `acknowledge` callback. This will break after the interface change.
**Why it happens:** CribbageBoard created its own animation events controller instead of using the one from GameShell. It passes a real acknowledge callback that logs.
**How to avoid:** Update CribbageBoard.vue to remove the `acknowledge` parameter. However, example game updates are scoped to Phase 90 (DOC-05, DOC-06), so this breakage is expected and documented.
**Warning signs:** TypeScript compilation of the cribbage game will fail until updated.

### Pitfall 3: Demo-Animation Game Comment Reference
**What goes wrong:** GameTable.vue in demo-animation has a comment referencing "server acknowledge" (line 68: "which creates and provides it with server acknowledge").
**Why it happens:** The comment was written during the theatre era and not updated.
**How to avoid:** This is a documentation concern scoped to Phase 90. Note it but don't act on it in Phase 89.

### Pitfall 4: Removing Too Many Acknowledge-Related Tests
**What goes wrong:** Some tests that mention "acknowledge" are actually testing per-event processing order (sequential handler execution). Removing them would lose test coverage.
**Why it happens:** Test names like "acknowledge is called between handler completions" describe both acknowledge AND handler ordering.
**How to avoid:** Review each test case individually. Tests about handler execution order should be preserved (with acknowledge assertions removed). Only delete tests where the ENTIRE purpose is verifying acknowledge calls.

## Code Examples

### Removing acknowledge from UseAnimationEventsOptions

```typescript
// Before:
export interface UseAnimationEventsOptions {
  events: () => AnimationEvent[] | undefined;
  acknowledge: (upToId: number) => void;       // DELETE
  defaultDuration?: number;
  handlerWaitTimeout?: number;
}

// After:
export interface UseAnimationEventsOptions {
  events: () => AnimationEvent[] | undefined;
  defaultDuration?: number;
  handlerWaitTimeout?: number;
}
```

### Removing acknowledge from createAnimationEvents

```typescript
// Before:
export function createAnimationEvents(options: UseAnimationEventsOptions) {
  const { events: getEvents, acknowledge, defaultDuration = 0, handlerWaitTimeout = 3000 } = options;

// After:
export function createAnimationEvents(options: UseAnimationEventsOptions) {
  const { events: getEvents, defaultDuration = 0, handlerWaitTimeout = 3000 } = options;
```

### Removing acknowledge calls from processQueue

```typescript
// In processQueue, line 214 (timeout skip):
acknowledge(event.id);    // DELETE this line
lastProcessedId = event.id;

// In processQueue, line 231 (after handler):
acknowledge(event.id);    // DELETE this line
lastProcessedId = event.id;
```

### Removing acknowledge from skipAll

```typescript
// In skipAll, line 246:
acknowledge(lastEvent.id);    // DELETE this line
lastProcessedId = lastEvent.id;
```

### Updating docstring example

```typescript
// Before (line 19-22):
 * const animationEvents = createAnimationEvents({
 *   events: () => state.value?.animationEvents,
 *   acknowledge: (upToId) => notifyServer(upToId),    // DELETE
 * });

// After:
 * const animationEvents = createAnimationEvents({
 *   events: () => state.value?.animationEvents,
 * });
```

### Test cleanup pattern

```typescript
// Before (repeated ~40 times):
const acknowledge = vi.fn();
const instance = createAnimationEvents({
  events: () => events.value,
  acknowledge,
});

// After:
const instance = createAnimationEvents({
  events: () => events.value,
});
```

## Affected Files (Exhaustive)

### Must Change
| File | Change | Lines Affected |
|------|--------|----------------|
| `src/ui/composables/useAnimationEvents.ts` | Remove `acknowledge` from interface, constructor, processQueue, skipAll, docstring | ~15 lines removed |
| `src/ui/composables/useAnimationEvents.test.ts` | Remove `acknowledge` from all test setups; remove acknowledge-specific assertions | ~100 lines removed/modified |
| `src/ui/components/GameShell.vue` | Remove `acknowledge: () => {}` from createAnimationEvents call | 1 line removed |

### No Changes Needed (verified)
| File | Reason |
|------|--------|
| `src/ui/components/auto-ui/ActionPanel.vue` | Animation gating already works via controller |
| `src/ui/composables/useActionController.ts` | Only reads `isAnimating` from animationEvents -- no acknowledge usage |
| `src/ui/composables/useActionControllerTypes.ts` | `animationEvents?: UseAnimationEventsReturn` -- type still valid after removing acknowledge |
| `src/ui/index.ts` | Exports `createAnimationEvents`, `UseAnimationEventsOptions` -- interface change is transparent |

### External (Phase 90 scope)
| File | Impact |
|------|--------|
| `BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue` | Passes `acknowledge` callback to `createAnimationEvents()` -- will break |
| `BoardSmithGames/demo-animation/src/ui/components/GameTable.vue` | Comment references "server acknowledge" -- cosmetic |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Theatre view with server acknowledgment | Client-side playback, no acknowledgment | Phase 85 (v3.0) | Acknowledge callback is dead code |
| `useCurrentView()` for truth opt-in | Single `gameView` from GameShell | Phase 85 (v3.0) | Composable already deleted |
| `currentGameView` computed in GameShell | Single `gameView` computed | Phase 85 (v3.0) | Already done |
| No wait-for-handler | Wait-for-handler with 3s timeout | Phase 88 (v3.0) | Queue pauses for lazy components |

## Open Questions

1. **Should acknowledge-specific tests be preserved as "processing order" tests?**
   - What we know: The "per-event advancement" test block (lines 715-805) tests that acknowledge is called after each handler. The underlying processing order (sequential, one at a time) is already covered by other tests.
   - What's unclear: Whether the test named "acknowledge is called between handler completions" has value beyond acknowledge verification.
   - Recommendation: Review each test case. If it tests sequential handler execution (which matters), keep the test but remove acknowledge assertions. If the entire test only checks acknowledge counts, delete it.

2. **Should `PickStepFn` export be checked?**
   - What we know: No file in `src/` references acknowledge in connection with the action controller or pick system.
   - Recommendation: No action needed.

## Sources

### Primary (HIGH confidence)
- `src/ui/composables/useAnimationEvents.ts` -- full source read, current implementation
- `src/ui/composables/useAnimationEvents.test.ts` -- 1136 lines, ~40 acknowledge references
- `src/ui/components/GameShell.vue` -- full 1338-line source read
- `src/ui/components/auto-ui/ActionPanel.vue` -- full 2109-line source read
- `src/ui/composables/useActionController.ts` -- animation gating section (lines 1340-1394)
- `src/ui/composables/useActionControllerTypes.ts` -- `UseAnimationEventsReturn` type reference
- `src/ui/index.ts` -- export surface
- `.planning/phases/88-client-animation-queue/88-01-SUMMARY.md` -- Phase 88 deliverables
- `.planning/phases/85-theatre-erasure/85-03-SUMMARY.md` -- Phase 85 deliverables (useCurrentView/CURRENT_VIEW_KEY deletion confirmed)

### Secondary (HIGH confidence)
- `BoardSmithGames/cribbage/src/ui/components/CribbageBoard.vue` -- external consumer using acknowledge
- `BoardSmithGames/demo-animation/src/ui/components/GameTable.vue` -- external consumer using useAnimationEvents
- `BREAKING.md` -- already documents all v3.0 API removals
- `.planning/REQUIREMENTS.md` -- CLI-10, CLI-11, UI-01, UI-02, UI-03 requirement definitions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure refactoring
- Architecture: HIGH - all patterns verified from source code
- Pitfalls: HIGH - identified from exhaustive grep of all references

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable -- no external dependencies or fast-moving targets)
