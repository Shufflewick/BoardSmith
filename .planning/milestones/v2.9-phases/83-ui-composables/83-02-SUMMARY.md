---
phase: 83-ui-composables
plan: 02
subsystem: ui
tags: [vue, gameshell, animation-events, theatre-view, composables, provide-inject]

# Dependency graph
requires:
  - phase: 83-01
    provides: "Client SDK acknowledgeAnimations transport, useCurrentView composable, per-event animation acknowledge"
provides:
  - "GameShell animation events wiring with WebSocket acknowledge callback"
  - "currentGameView provide for truth opt-in via CURRENT_VIEW_KEY"
  - "animationEvents passed to useActionController for ActionPanel gating"
  - "useCurrentView unit tests"
  - "Per-event acknowledge tests verifying N events = N calls"
affects: [83-03 ActionPanel theatre rendering, 84 integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "app.runWithContext() for testing Vue provide/inject composables without DOM"
    - "GameShell as animation event root: creates, provides, and passes to action controller"

key-files:
  created:
    - "src/ui/composables/useCurrentView.test.ts"
  modified:
    - "src/ui/components/GameShell.vue"
    - "src/ui/composables/useAnimationEvents.test.ts"

key-decisions:
  - "(state.value?.state as any)?.animationEvents pattern for accessing server fields not on client PlayerState type"
  - "app.runWithContext() for testing provide/inject without jsdom or happy-dom dependency"

patterns-established:
  - "GameShell animation wiring: createAnimationEvents -> provideAnimationEvents -> pass to useActionController"
  - "currentGameView provide respects time travel (historical state when time traveling)"

# Metrics
duration: 4min
completed: 2026-02-07
---

# Phase 83 Plan 02: GameShell Wiring and Tests Summary

**GameShell wired for theatre view animation events with WebSocket acknowledge, currentGameView truth provide, and ActionPanel gating -- plus unit tests for useCurrentView and per-event acknowledge behavior**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-07T16:46:41Z
- **Completed:** 2026-02-07T16:51:06Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments
- GameShell creates animation events with WebSocket acknowledge callback, provides them to descendant components, and passes to useActionController for ActionPanel gating
- currentGameView computed provides truth state via CURRENT_VIEW_KEY, respecting time travel
- useCurrentView composable has 5 unit tests covering error handling, injection, and null cases
- Animation event acknowledge tests updated to verify per-event behavior (N events = N calls with individual IDs)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire GameShell for animation events and current view** - `c065f60` (feat)
2. **Task 2: Write tests for useCurrentView and update animation event tests** - `f63467d` (test)

## Files Created/Modified
- `src/ui/components/GameShell.vue` - Added createAnimationEvents wiring, currentGameView provide, acknowledgeAnimations destructure, animationEvents passed to useActionController
- `src/ui/composables/useCurrentView.test.ts` - New: 5 unit tests for useCurrentView composable (throws outside context, returns view, returns null, actionable error, key value)
- `src/ui/composables/useAnimationEvents.test.ts` - Updated acknowledge tests: per-event calls verification, ordering test (handler-end -> ack -> next handler)

## Decisions Made
- Used `(state.value?.state as any)?.animationEvents` pattern consistent with existing GameShell code for accessing server-side fields not on client PlayerState type (matches `actionMetadata` and `canUndo` access patterns)
- Used `app.runWithContext()` to test Vue provide/inject without adding jsdom or happy-dom dependency -- no new dependencies required
- currentGameView respects time travel state (shows historical state when time traveling, falls through to currentView/view otherwise)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type-safe access for animationEvents and currentView**
- **Found during:** Task 1 (GameShell wiring)
- **Issue:** Plan used `state.value?.state.animationEvents` and `state.value?.state.currentView` but client `PlayerState` type doesn't have these fields, causing TypeScript errors
- **Fix:** Used `(state.value?.state as any)?.animationEvents` and `(state.value?.state as any)?.currentView` matching existing patterns for `actionMetadata` and `canUndo`
- **Files modified:** src/ui/components/GameShell.vue
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** c065f60 (Task 1 commit)

**2. [Rule 3 - Blocking] Test approach adapted for node environment**
- **Found during:** Task 2 (writing useCurrentView tests)
- **Issue:** Plan suggested `@vue/test-utils` mount pattern but the package is not installed, and vitest environment is `node` (no DOM)
- **Fix:** Used `createApp` + `app.runWithContext()` + `app.provide()` to test provide/inject without DOM, avoiding new dependency
- **Files modified:** src/ui/composables/useCurrentView.test.ts
- **Verification:** All 5 tests pass in node environment
- **Committed in:** f63467d (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for type correctness and test execution without new dependencies. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full animation pipeline wired: server sends theatre view -> GameShell receives via useGame -> createAnimationEvents watches state.animationEvents -> handlers play each event -> acknowledge(event.id) sends WebSocket message per event -> server advances theatre -> new state broadcast -> gameView updates -> ActionPanel ungates when isAnimating becomes false
- Skip works end-to-end: skipAll() acknowledges all events, theatre advances to current
- Plan 03 (ActionPanel theatre rendering) can now proceed: ActionPanel already reads animationsPending and showActionPanel from the action controller

---
*Phase: 83-ui-composables*
*Completed: 2026-02-07*
