---
phase: 82-session-integration
plan: 02
subsystem: session
tags: [theatre-state, buildPlayerState, currentView, websocket, animation, session-integration]

# Dependency graph
requires:
  - phase: 82-01
    provides: "Game.theatreStateForPlayer() -- per-player visibility-filtered theatre snapshot"
  - phase: 81
    provides: "Theatre state engine with _theatreSnapshot, theatreState getter, acknowledgeAnimationEvents"
provides:
  - "buildPlayerState() sends theatre view as primary view field"
  - "PlayerGameState.currentView optional field for truth when animations pending"
  - "WebSocket acknowledgeAnimations message handler"
  - "Integration tests proving full session flow for theatre view"
affects: [83-ui-composables, 84-clean-break]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Theatre view as default broadcast state (buildPlayerState uses theatreStateForPlayer)", "Bandwidth optimization (currentView only sent when divergent from theatre)"]

key-files:
  created: []
  modified:
    - "src/session/types.ts"
    - "src/session/utils.ts"
    - "src/server/core.ts"
    - "src/session/animation-events.test.ts"

key-decisions:
  - "currentView is optional (undefined when theatre equals truth) for bandwidth optimization"
  - "Theatre view is primary view field -- semantic change from truth to theatre as default"
  - "WebSocket acknowledgeAnimations validates spectator, game existence, and upToId presence"

patterns-established:
  - "Theatre as default broadcast: buildPlayerState().view is always theatre state, currentView is truth opt-in"
  - "Conditional field inclusion: spread operator pattern for optional fields on PlayerGameState"

# Metrics
duration: 5min
completed: 2026-02-07
---

# Phase 82 Plan 02: Session Layer Theatre View Wiring Summary

**buildPlayerState() sends theatre view as primary `view` field with bandwidth-optimized `currentView` truth opt-in, WebSocket acknowledgeAnimations handler, and 6 integration tests proving session-level theatre flow**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-07T16:19:57Z
- **Completed:** 2026-02-07T16:24:31Z
- **Tasks:** 3/3
- **Files modified:** 4

## Accomplishments

- `buildPlayerState()` now sends theatre state (via `theatreStateForPlayer()`) as the primary `view` field instead of truth
- `PlayerGameState.currentView` optional field carries truth only when animations are pending (bandwidth optimization)
- WebSocket `acknowledgeAnimations` message type added with spectator, game, and upToId validation
- 6 new integration tests proving theatre view in session: pre-animation state, truth divergence, acknowledgment advancement, multiplayer fairness, and session restore

## Task Commits

Each task was committed atomically:

1. **Task 1: Add currentView to PlayerGameState and wire buildPlayerState()** - `cee74ff` (feat)
2. **Task 2: Add WebSocket acknowledgeAnimations handler** - `811a644` (feat)
3. **Task 3: Write session integration tests for theatre view** - `edf0a1d` (test)

## Files Created/Modified

- `src/session/types.ts` - Added `currentView` field to `PlayerGameState`, `'acknowledgeAnimations'` to `WebSocketMessage.type` union, `upToId` field
- `src/session/utils.ts` - `buildPlayerState()` uses `theatreStateForPlayer()` for view, includes `currentView` only when animations pending
- `src/server/core.ts` - New `case 'acknowledgeAnimations'` in WebSocket message handler with validation
- `src/session/animation-events.test.ts` - Added `TheatreTestGame` class and 6 new integration tests in `describe('Theatre view in PlayerGameState')`

## Decisions Made

- **`currentView` is optional (undefined when not divergent):** Saves bandwidth -- when no animations are pending, `view` IS the truth, so `currentView` is omitted. Consumers use `state.currentView ?? state.view` for truth access.
- **Theatre view as primary `view` field:** Intentional semantic change. Components that previously read `state.view` now get theatre state by default (pit of success -- correct behavior without opt-in).
- **WebSocket handler validates all inputs:** Spectators rejected, game existence checked, `upToId` required -- follows pattern of other handlers in the switch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed execute callback signature in TheatreTestGame**
- **Found during:** Task 3 (integration tests)
- **Issue:** Plan's example code destructured `{ game }` from the first parameter of `Action.create().execute()`, but the first parameter is `args` and the second is `context`. Using `({ game })` caused `game.first()` to fail with `TypeError: Cannot read properties of undefined`
- **Fix:** Changed to `(_args, { game })` to correctly destructure from the context parameter
- **Files modified:** `src/session/animation-events.test.ts`
- **Verification:** All 15 tests pass
- **Committed in:** `edf0a1d` (Task 3 commit)

**2. [Rule 1 - Bug] Fixed undefined children in test assertions**
- **Found during:** Task 3 (integration tests)
- **Issue:** When a Space has no children in `ElementJSON`, the `children` key may be `undefined` rather than an empty array. Calling `.some()` on `undefined` fails
- **Fix:** Changed assertions to use `(boardInTruth.children ?? []).some(...)` pattern
- **Files modified:** `src/session/animation-events.test.ts`
- **Verification:** All 15 tests pass
- **Committed in:** `edf0a1d` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes were necessary for correct test execution. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 82 (Session Integration) is now complete -- all success criteria met
- Theatre view flows through session layer: `theatreStateForPlayer()` -> `buildPlayerState()` -> `broadcast()` -> all clients
- `currentView` opt-in field enables Phase 83 UI composables to distinguish theatre from truth
- WebSocket `acknowledgeAnimations` handler enables multiplayer clients to advance theatre state
- Ready for Phase 83: UI Composables (Vue components rendering from theatre view)

---
*Phase: 82-session-integration*
*Completed: 2026-02-07*
