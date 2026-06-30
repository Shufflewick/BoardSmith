---
phase: 56-position-seat-rename
plan: 01
subsystem: engine
tags: [player, seat, position, nomenclature, rename, api]

# Dependency graph
requires:
  - phase: 54-nomenclature
    provides: "Seat" terminology definition in nomenclature dictionary
provides:
  - Player.seat property (renamed from position)
  - game.getPlayer(seat) method with seat parameter
  - player.isFirstPlayer checks seat === 1
affects: [56-02, 56-03, session, ui, client, server, extracted-games]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Player seat number is accessed via player.seat (not player.position)"
    - "playerPosition parameter names kept for API stability but represent seat number"

key-files:
  created: []
  modified:
    - src/engine/player/player.ts
    - src/engine/element/game.ts
    - src/engine/element/game-element.ts
    - src/engine/element/piece.ts
    - src/engine/element/hand.ts
    - src/engine/flow/engine.ts
    - src/engine/flow/turn-order.ts
    - src/engine/action/helpers.ts
    - src/engine/action/types.ts
    - src/engine/command/types.ts
    - src/engine/command/inverse.ts
    - src/engine/utils/serializer.ts
    - src/engine/utils/snapshot.ts

key-decisions:
  - "Renamed Player.position to Player.seat throughout engine"
  - "Kept playerPosition parameter names in types for API stability"
  - "Updated all JSDoc to reflect seat terminology"

patterns-established:
  - "Player seat access: Use player.seat instead of player.position"
  - "Game.getPlayer(seat): Accept seat number as parameter"
  - "Player comparisons: Use p.seat for sorting and filtering"

# Metrics
duration: 10min
completed: 2026-01-22
---

# Phase 56 Plan 01: Core Engine Position-to-Seat Rename Summary

**Renamed Player.position to Player.seat across 16 core engine files with all 306 engine tests passing**

## Performance

- **Duration:** 10 min
- **Started:** 2026-01-22T17:19:19Z
- **Completed:** 2026-01-22T17:29:32Z
- **Tasks:** 3
- **Files modified:** 18 (including test files)

## Accomplishments
- Player class now has `seat!: number` property instead of `position`
- `player.isFirstPlayer` getter checks `this.seat === 1`
- `game.getPlayer(seat)` and `game.getPlayerOrThrow(seat)` accept seat parameter
- All engine files use `.seat` for player seat number
- All 306 engine tests updated and passing
- No `player.position` references remain in src/engine/

## Task Commits

Each task was committed atomically:

1. **Task 1: Rename Player.position to Player.seat** - `044f1c6` (feat)
2. **Task 2: Update Game class player methods** - `2f0dfd8` (feat)
3. **Task 3: Update remaining engine files** - `bacf4c1` (feat)

## Files Created/Modified

**Core Player/Game:**
- `src/engine/player/player.ts` - Renamed position to seat, updated isFirstPlayer
- `src/engine/element/game.ts` - Updated getPlayer, getPlayerOrThrow, player helpers

**Element Files:**
- `src/engine/element/game-element.ts` - Updated isVisibleTo, serializeValue
- `src/engine/element/piece.ts` - Updated visibility methods
- `src/engine/element/hand.ts` - Updated JSDoc example

**Flow Files:**
- `src/engine/flow/engine.ts` - Updated currentPlayer, awaitingPlayers tracking
- `src/engine/flow/turn-order.ts` - Updated filter and LEFT_OF_DEALER example

**Action/Command Files:**
- `src/engine/action/helpers.ts` - Updated ActionTempState seat access
- `src/engine/action/types.ts` - Updated JSDoc for playerPosition
- `src/engine/command/types.ts` - Updated JSDoc for playerPosition
- `src/engine/command/inverse.ts` - Updated createSetCurrentPlayerInverse

**Utility Files:**
- `src/engine/utils/serializer.ts` - Updated player serialization
- `src/engine/utils/snapshot.ts` - Updated createPlayerView, createAllPlayerViews

**Test Files:**
- `src/engine/action/action.test.ts` - Updated to use .seat
- `src/engine/flow/engine.test.ts` - Updated to use .seat
- `src/engine/element/game-element.test.ts` - Updated to use .seat
- `src/engine/utils/snapshot.test.ts` - Updated to use .seat

## Decisions Made

- **Keep playerPosition parameter names:** For API stability, internal parameter names like `playerPosition` in `PendingActionState` and `SetCurrentPlayerCommand` were kept but JSDoc clarified they represent seat numbers
- **Update all JSDoc examples:** Every JSDoc example using `.position` was updated to `.seat` for consistency
- **Update PlayerViewFunction type:** Changed parameter name from `playerPosition` to `playerSeat` in the type signature

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all changes applied cleanly with existing tests guiding verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Core engine fully migrated to `seat` terminology
- Ready for Plan 02: Session types rename (LobbySlot.position, error codes, etc.)
- Ready for Plan 03: UI components rename
- May show TypeScript errors in src/session, src/ui, src/client, src/server until those are updated in subsequent plans

---
*Phase: 56-position-seat-rename*
*Completed: 2026-01-22*
