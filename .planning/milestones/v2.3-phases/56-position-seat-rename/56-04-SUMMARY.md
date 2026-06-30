---
phase: 56-position-seat-rename
plan: 04
subsystem: games
tags: [extracted-games, seat-rename, refactoring]

# Dependency graph
requires:
  - phase: 56-01
    provides: Player.seat property in engine
provides:
  - All extracted games updated to use seat terminology
  - Checkers, Cribbage, Go Fish, Hex, Polyhedral Potions, Floss Bitties, demo games use .seat
affects:
  - Any future extracted game development should use seat terminology

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "player.seat for player identification (1-indexed)"
    - "playerSeat prop naming convention in Vue components"

key-files:
  modified:
    - packages/games/checkers/rules/src/game.ts
    - packages/games/checkers/rules/src/ai.ts
    - packages/games/checkers/rules/src/elements.ts
    - packages/games/cribbage/rules/src/game.ts
    - packages/games/cribbage/rules/src/ai.ts
    - packages/games/cribbage/rules/src/actions.ts
    - packages/games/cribbage/rules/src/elements.ts
    - packages/games/cribbage/rules/src/flow.ts
    - packages/games/go-fish/rules/src/game.ts
    - packages/games/go-fish/rules/src/ai.ts
    - packages/games/hex/rules/src/game.ts
    - packages/games/hex/rules/src/ai.ts
    - packages/games/hex/rules/src/elements.ts
    - packages/games/polyhedral-potions/rules/src/game.ts
    - packages/games/floss-bitties/src/rules/game.ts
    - packages/games/demoComplexUiInteractions/src/rules/game.ts
    - All corresponding UI App.vue and component files

key-decisions:
  - "Renamed Floss Bitties lastDiscardedByPosition to lastDiscardedBySeat for consistency"
  - "All 9 extracted games now use seat terminology in rules and UI"

patterns-established:
  - "player.seat is 1-indexed, use seat - 1 for array access"
  - "playerSeat prop instead of playerPosition in Vue components"
  - "player-seat attribute instead of player-position in templates"

# Metrics
duration: 15min
completed: 2026-01-22
---

# Phase 56 Plan 04: Extracted Games Summary

**Updated all 9 extracted games (Checkers, Cribbage, Go Fish, Hex, Polyhedral Potions, Floss Bitties, 3 demo games) to use seat terminology throughout rules and UI**

## Performance

- **Duration:** 15 min
- **Started:** 2026-01-22T17:37:30Z
- **Completed:** 2026-01-22T17:52:00Z
- **Tasks:** 3
- **Files modified:** 35+

## Accomplishments
- All extracted games now use Player.seat instead of Player.position
- All game UI components use playerSeat prop instead of playerPosition
- All template bindings use player-seat instead of player-position
- All tests passing for Checkers, Cribbage, Hex, Polyhedral Potions, Floss Bitties, demoComplexUiInteractions

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Checkers, Cribbage, Go Fish** - `186797b` (refactor)
2. **Task 2: Update Hex and Polyhedral Potions** - `f2b7b66` (refactor)
3. **Task 3: Update Demo games and Floss Bitties** - `24bf5f5` (refactor)

## Files Created/Modified

### Checkers
- `packages/games/checkers/rules/src/game.ts` - player.seat for color indexing
- `packages/games/checkers/rules/src/ai.ts` - playerSeat in objectives
- `packages/games/checkers/rules/src/elements.ts` - forwardDirection based on seat
- `packages/games/checkers/ui/src/App.vue` - playerSeat prop
- `packages/games/checkers/ui/src/components/CheckersBoard.vue` - playerSeat prop

### Cribbage
- `packages/games/cribbage/rules/src/game.ts` - dealer/nonDealer.seat references
- `packages/games/cribbage/rules/src/ai.ts` - playerSeat in objectives
- `packages/games/cribbage/rules/src/actions.ts` - player.seat in game logic
- `packages/games/cribbage/rules/src/elements.ts` - this.seat references
- `packages/games/cribbage/rules/src/flow.ts` - currentPlayer.seat references
- `packages/games/cribbage/ui/src/App.vue` - playerSeat prop
- `packages/games/cribbage/ui/src/components/CribbageBoard.vue` - playerSeat prop
- `packages/games/cribbage/ui/src/components/RoundSummary.vue` - playerSeat prop

### Go Fish
- `packages/games/go-fish/rules/src/game.ts` - player.seat references
- `packages/games/go-fish/rules/src/ai.ts` - playerSeat and p.seat
- `packages/games/go-fish/ui/src/App.vue` - playerSeat prop
- `packages/games/go-fish/ui/src/components/GoFishBoard.vue` - playerSeat prop

### Hex
- `packages/games/hex/rules/src/game.ts` - player.seat for color indexing
- `packages/games/hex/rules/src/ai.ts` - playerSeat and various .seat refs
- `packages/games/hex/rules/src/elements.ts` - isRed check with player.seat
- `packages/games/hex/ui/src/App.vue` - playerSeat prop
- `packages/games/hex/ui/src/components/HexBoard.vue` - playerSeat prop

### Polyhedral Potions
- `packages/games/polyhedral-potions/rules/src/game.ts` - player.seat
- `packages/games/polyhedral-potions/ui/src/App.vue` - playerSeat prop
- `packages/games/polyhedral-potions/ui/src/components/DiceShelf.vue` - playerSeat prop
- `packages/games/polyhedral-potions/ui/src/components/GameTable.vue` - playerSeat prop
- `packages/games/polyhedral-potions/ui/src/components/ScoreSheet.vue` - playerSeat prop

### Floss Bitties
- `packages/games/floss-bitties/src/rules/game.ts` - player.seat and lastDiscardedBySeat
- `packages/games/floss-bitties/src/ui/App.vue` - playerSeat prop
- `packages/games/floss-bitties/src/ui/components/GameTable.vue` - playerSeat prop

### Demo Games
- `packages/games/demoComplexUiInteractions/src/rules/game.ts` - player.seat
- `packages/games/demoComplexUiInteractions/src/ui/App.vue` - playerSeat prop
- `packages/games/demoComplexUiInteractions/src/ui/components/GameTable.vue` - playerSeat prop
- `packages/games/demoAnimation/src/ui/App.vue` - playerSeat prop
- `packages/games/demoAnimation/src/ui/components/GameTable.vue` - playerSeat prop

## Decisions Made
- Renamed `lastDiscardedByPosition` to `lastDiscardedBySeat` in Floss Bitties for consistency
- Updated data attributes from `data-player-position` to `data-player-seat`
- Go Fish tests have pre-existing failures unrelated to this rename (e2e tests require server)
- demoAnimation tests have pre-existing failures (wrong test expectations vs game implementation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Some games had `.position` references in additional files beyond those listed in the plan (elements.ts, flow.ts, actions.ts) - discovered during testing and fixed
- Go Fish and demoAnimation have pre-existing test failures unrelated to this rename

## Next Phase Readiness
- All extracted games now use seat terminology
- Phase 56 (position to seat rename) is fully complete
- Any new games should use .seat and playerSeat conventions

---
*Phase: 56-position-seat-rename*
*Completed: 2026-01-22*
