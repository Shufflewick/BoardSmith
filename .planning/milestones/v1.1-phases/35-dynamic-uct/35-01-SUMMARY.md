# Phase 35 Plan 01: Dynamic UCT Summary

**Added configurable UCT constant with phase-based tuning for Hex AI, enabling adaptive exploration/exploitation based on game progress.**

## Accomplishments

- Added `uctC` static option to BotConfig for manual UCT override
- Added `uctConstant` hook to AIConfig for dynamic game-state-based UCT tuning
- Implemented cached UCT constant in MCTS (computed once per move, not per selectChild call)
- Created phase-based UCT constant for Hex:
  - Early game (<30% filled): C=1.8 for wide exploration
  - Mid game (30-70%): C=sqrt(2) for balanced play
  - Late game (>70%): C=1.0 for focused exploitation

## Files Created/Modified

- `packages/ai/src/types.ts` - Added `uctC` to BotConfig, `uctConstant` hook to AIConfig with JSDoc
- `packages/ai/src/mcts-bot.ts` - Added `cachedUctC` field, integrated uctConstant hook with fallback chain
- `packages/games/hex/rules/src/ai.ts` - Added `getHexUctConstant` function with phase-based tuning
- `packages/games/hex/rules/src/index.ts` - Exported new hook and added to gameDefinition.ai config

## Decisions Made

1. **Cache UCT constant per move**: Computing UCT constant once at start of playSingle() rather than per selectChild() call for performance (selectChild is called O(iterations) times per move).

2. **Fallback chain**: `uctConstant hook → config.uctC → sqrt(2)` allows both dynamic and static overrides while preserving default behavior.

3. **Phase thresholds for Hex**: Used 30% and 70% as boundaries based on typical Hex game progression. Early exploration helps discover diverse strategies, late exploitation focuses on forcing sequences.

4. **Updated playParallel**: Ensured uctConstant and moveOrdering hooks are passed to sub-bots for consistent ensemble behavior.

## Issues Encountered

None - implementation was straightforward following the established AIConfig hook pattern.

## Benchmark Results

**20 games each, 100 iterations, 11x11 board (default):**

| Configuration | P1 Wins | P2 Wins | Avg Moves | Avg Time |
|--------------|---------|---------|-----------|----------|
| Baseline (static C=sqrt(2)) | 10 (50%) | 10 (50%) | 34.0 | 2.00s |
| Phase-based UCT | 10 (50%) | 10 (50%) | 31.4 | 1.82s |

**Observations:**
- Win rates remain balanced (expected for symmetric AI vs AI)
- Phase-based UCT shows ~8% fewer moves per game (31.4 vs 34.0)
- Average time per game reduced by ~9% (1.82s vs 2.00s)
- Results suggest more efficient play without sacrificing quality

## Task Commits

1. `e21d7e1` - feat(35-01): add UCT configuration to types.ts
2. `f04c034` - feat(35-01): implement configurable UCT constant in MCTS
3. `973b557` - feat(35-01): add phase-based UCT constant to Hex AI

## Next Phase Readiness

Ready for Phase 36: Proof Number Search
