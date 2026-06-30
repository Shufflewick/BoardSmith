# Phase 32 Plan 01: Move Ordering Summary

**Added moveOrdering hook to MCTS for exploring promising moves first**

## Performance

- **Duration:** 15 min
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added moveOrdering hook to AIConfig interface for game-specific move prioritization
- Modified MCTSBot to use moveOrdering during node creation for exploration order
- Changed EXPAND phase to pick from front of untriedMoves (order-preserving)
- Implemented getHexMoveOrdering with scoring: opponent's recent stone (+10), adjacent to opponent (+5), adjacent to own (+3), center region (+2)
- Wired moveOrdering into Hex game definition

## Task Commits

1. **Task 1:** feat(32-01): add moveOrdering hook to AIConfig (0df9c06)
2. **Task 2:** feat(32-01): implement Hex move ordering (10bc47a)
3. **Task 3:** (verification only - benchmark run)

## Files Created/Modified

- packages/ai/src/types.ts - Added moveOrdering to AIConfig interface
- packages/ai/src/mcts-bot.ts - Use moveOrdering in createNode, pick from front in expand
- packages/games/hex/rules/src/ai.ts - Added getHexMoveOrdering function
- packages/games/hex/rules/src/index.ts - Wired moveOrdering into game definition

## Benchmark Results

- MCTS-50 vs MCTS-1 baseline: 80% win rate as P0
- Combined win rate with position swap: 90%
- P0 win rate: 80%, P1 win rate: 100%

## Issues Encountered

- None - implementation straightforward following plan

## Next Phase Readiness

Ready for Phase 33: RAVE (Rapid Action Value Estimation)
