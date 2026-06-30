---
phase: 85-theatre-erasure
plan: 02
subsystem: session
tags: [session, server, websocket, buildPlayerState, theatre-erasure]

# Dependency graph
requires:
  - phase: 85-01
    provides: Engine theatre code removed (theatreStateForPlayer, animate, mutation capture)
provides:
  - Session layer without acknowledgeAnimations or theatre view split
  - buildPlayerState producing single truth view
  - Server without acknowledgeAnimations WebSocket handler
affects: [85-03, 85-04, 86, 87]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single truth view in PlayerGameState (no theatre/currentView split)"

key-files:
  created: []
  modified:
    - src/session/game-session.ts
    - src/session/utils.ts
    - src/session/types.ts
    - src/server/core.ts

key-decisions:
  - "Delete entire animation-events.test.ts since all tests depended on removed game.animate() -- Phase 86 rebuilds"

patterns-established:
  - "buildPlayerState returns truth view directly via getPlayerView()"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 85 Plan 02: Session + Server Erasure Summary

**Removed acknowledgeAnimations protocol and theatre/currentView split from session and server layers; buildPlayerState now returns truth directly**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-07T23:57:33Z
- **Completed:** 2026-02-07T23:59:57Z
- **Tasks:** 2/2
- **Files modified:** 4 (1 deleted)

## Accomplishments
- Removed `acknowledgeAnimations()` method from GameSession
- Removed `acknowledgeAnimations` WebSocket case from server core
- Simplified `buildPlayerState()` to produce a single truth view (no `theatreStateForPlayer` or `currentView`)
- Removed `currentView` field from `PlayerGameState` interface
- Removed `acknowledgeAnimations` from `WebSocketMessage` union type
- Deleted `animation-events.test.ts` (all tests depended on removed `game.animate()`)
- All 39 remaining session tests pass, zero session/server compile errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove acknowledgeAnimations from session and server** - `37a6a14` (feat)
2. **Task 2: Simplify buildPlayerState and fix session tests** - `c1919f0` (feat)

## Files Created/Modified
- `src/session/game-session.ts` - Removed acknowledgeAnimations() method
- `src/session/utils.ts` - Simplified buildPlayerState() to use getPlayerView() for truth directly
- `src/session/types.ts` - Removed currentView from PlayerGameState, acknowledgeAnimations from WebSocketMessage
- `src/server/core.ts` - Removed acknowledgeAnimations case from WebSocket handler
- `src/session/animation-events.test.ts` - Deleted (all tests depended on removed game.animate())

## Decisions Made
- Deleted entire animation-events.test.ts rather than trying to salvage partial tests, since every test in the file called `game.animate()` which was removed in Plan 01. Phase 86 will rebuild session animation tests with the new API.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## Next Phase Readiness
- Session and server layers are clean of theatre references
- Ready for 85-03-PLAN.md (Client + UI erasure)
- Phase 86 will rebuild animation event tests with the new API

---
*Phase: 85-theatre-erasure*
*Completed: 2026-02-07*
