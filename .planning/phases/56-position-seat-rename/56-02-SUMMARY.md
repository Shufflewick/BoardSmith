---
phase: 56-position-seat-rename
plan: 02
subsystem: api
tags: [session, lobby, websocket, types, rename]

# Dependency graph
requires:
  - phase: 56-01
    provides: Engine layer renamed to seat terminology
provides:
  - Session layer types renamed (LobbySlot.seat, SessionInfo.playerSeat, etc.)
  - Session implementation files updated
  - Client/server types aligned with seat terminology
affects: [56-03, 56-04, ui, client, worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seat is 1-indexed for external APIs"
    - "playerPosition param names kept for API stability, JSDoc updated"

key-files:
  modified:
    - src/session/types.ts
    - src/session/utils.ts
    - src/session/game-session.ts
    - src/session/lobby-manager.ts
    - src/session/state-history.ts
    - src/session/pending-action-manager.ts
    - src/session/selection-handler.ts
    - src/session/index.ts
    - src/client/types.ts
    - src/server/types.ts
    - src/server/core.ts
    - src/server/handlers/games.ts
    - src/server/handlers/matchmaking.ts

key-decisions:
  - "Keep playerPosition parameter names in session methods for API stability"
  - "Update JSDoc comments to reference seat instead of position"
  - "Error messages now use seat terminology"

patterns-established:
  - "LobbySlot.seat is the canonical property name"
  - "ClaimSeat/LeaveSeat method naming"

# Metrics
duration: 12min
completed: 2026-01-22
---

# Phase 56 Plan 02: Session and API Layer Rename Summary

**Renamed external-facing session/client/server APIs from position to seat terminology - LobbySlot.seat, claimSeat/leaveSeat methods, ClaimSeatRequest/Response types**

## Performance

- **Duration:** 12 min
- **Started:** 2026-01-22T17:31:02Z
- **Completed:** 2026-01-22T17:43:14Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- Renamed error codes: POSITION_ALREADY_CLAIMED -> SEAT_ALREADY_CLAIMED, INVALID_POSITION -> INVALID_SEAT
- Renamed types: LobbySlot.position -> seat, SessionInfo.playerPosition -> playerSeat, StateUpdate.playerPosition -> playerSeat
- Renamed request/response types: ClaimPositionRequest -> ClaimSeatRequest, ClaimPositionResponse -> ClaimSeatResponse
- Renamed methods: claimPosition -> claimSeat, leavePosition -> leaveSeat, getPositionForPlayer -> getSeatForPlayer
- Updated WebSocket message types to use seat instead of position
- Updated all error messages to reference "seat" instead of "position"
- Updated client types (MatchmakingResult, GameState, GameConnectionConfig, etc.)
- Updated server routes and handlers

## Task Commits

Each task was committed atomically:

1. **Task 1: Update session/types.ts** - `4c6a43c` (feat)
2. **Task 2: Update session implementation files** - `5a5aef8` (feat)
3. **Task 3: Update client/server types** - `1bf9b88` (feat)

## Files Created/Modified
- `src/session/types.ts` - Error codes, types, WebSocket message types
- `src/session/utils.ts` - buildPlayerState returns seat instead of position
- `src/session/game-session.ts` - claimSeat/leaveSeat/getSeatForPlayer methods
- `src/session/lobby-manager.ts` - All position refs to seat, method renames
- `src/session/state-history.ts` - Error messages updated
- `src/session/pending-action-manager.ts` - Error messages updated
- `src/session/selection-handler.ts` - Error messages and comments
- `src/session/index.ts` - Export renamed types
- `src/client/types.ts` - All external API types
- `src/server/types.ts` - Re-export renamed types, MatchInfo, WebSocketSession
- `src/server/core.ts` - Route handlers, WebSocket handlers
- `src/server/handlers/games.ts` - Handler functions renamed
- `src/server/handlers/matchmaking.ts` - playerSeat in results

## Decisions Made
- Kept `playerPosition` as parameter names in session methods (not renamed to `playerSeat`) to maintain API stability - only updated JSDoc to clarify it represents seat number
- Error messages now use "seat" terminology throughout

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Session and API layer fully renamed
- Ready for 56-03 (UI components) and 56-04 (external games)
- TypeScript compiles cleanly with no errors

---
*Phase: 56-position-seat-rename*
*Completed: 2026-01-22*
