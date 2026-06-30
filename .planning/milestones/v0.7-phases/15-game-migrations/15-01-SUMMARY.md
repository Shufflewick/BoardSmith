---
phase: 15-game-migrations
plan: 01
subsystem: games
tags: [conditions, migration, auto-tracing, typescript]

# Dependency graph
requires:
  - phase: 14-condition-api-refactor/02
    provides: Auto-tracing evaluateObjectCondition(), object condition format
provides:
  - All 7 BoardSmith games use object-based conditions
  - 18+ conditions converted with descriptive labels
  - Automatic condition tracing now works in all games
affects: [16-docs-migration-guide]

# Tech tracking
tech-stack:
  added: []
  patterns: [object-based-conditions]

key-files:
  created: []
  modified:
    - packages/games/go-fish/rules/src/actions.ts
    - packages/games/polyhedral-potions/rules/src/actions.ts
    - packages/games/demoActionPanel/rules/src/actions.ts
    - packages/games/cribbage/rules/src/actions.ts
    - packages/games/floss-bitties/src/rules/actions.ts
    - packages/games/checkers/rules/src/actions.ts
    - packages/games/demoComplexUiInteractions/src/rules/actions.ts

key-decisions:
  - "Compound conditions split into separate labeled predicates for better debug output"
  - "Labels describe WHY the condition exists, not just what it checks"

patterns-established:
  - "Object-based condition format with descriptive labels for all game conditions"

issues-created: []

# Metrics
duration: 18 min
completed: 2026-01-10
---

# Phase 15 Plan 01: Game Condition Migrations Summary

**Migrated all 18+ game conditions from function format to object format with descriptive labels for automatic debug tracing**

## Performance

- **Duration:** 18 min
- **Started:** 2026-01-10T23:09:41Z
- **Completed:** 2026-01-10T23:28:09Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Migrated all 7 BoardSmith games to object-based condition format
- Split compound conditions (&&) into separate labeled predicates
- All conditions now produce automatic debug traces via Phase 14 auto-tracing
- No function-style .condition() calls remain in packages/games/

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate simple games (go-fish, polyhedral-potions, demoActionPanel)** - `4968ecf` (refactor)
2. **Task 2: Migrate card games (cribbage, floss-bitties)** - `1cebd20` (refactor)
3. **Task 3: Migrate remaining games (checkers, demoComplexUiInteractions)** - `66cc44e` (refactor)

**Plan metadata:** (pending commit)

## Files Created/Modified

- `packages/games/go-fish/rules/src/actions.ts` - 1 condition (player can take action)
- `packages/games/polyhedral-potions/rules/src/actions.ts` - 1 condition (two dice drafted)
- `packages/games/demoActionPanel/rules/src/actions.ts` - 2 conditions (available units/enemies, multiple players)
- `packages/games/cribbage/rules/src/actions.ts` - 4 conditions (discarding phase, play phase, say go, scoring)
- `packages/games/floss-bitties/src/rules/actions.ts` - 3 conditions (playable cards, deck has cards, drawable piles)
- `packages/games/checkers/rules/src/actions.ts` - 2 conditions (end turn, move with multi-jump logic)
- `packages/games/demoComplexUiInteractions/src/rules/actions.ts` - 5 conditions (deck/hand/player checks)

## Decisions Made

- Compound conditions split into separate labeled predicates for granular debug output
- Labels written to describe WHY the condition exists (e.g., "in play phase", "has cards in hand")

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Step

Phase 15 has only this one plan. Ready for Phase 16: docs-migration-guide.

---
*Phase: 15-game-migrations*
*Completed: 2026-01-10*
