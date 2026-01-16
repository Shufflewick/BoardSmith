---
phase: 34-gradient-objectives
plan: 01
subsystem: ai
tags: [mcts, hex, evaluation, objectives]

# Dependency graph
requires:
  - phase: 33-rave
    provides: RAVE heuristic integration, MCTS evaluation framework
provides:
  - Numeric objective interface (0.0-1.0 gradients)
  - Gradient-based MCTS evaluation
  - Hex-specific gradient formulas
affects: [ai-evaluation, game-objectives, future-games]

# Tech tracking
tech-stack:
  added: []
  patterns: [gradient-evaluation, numeric-objectives]

key-files:
  created: []
  modified:
    - packages/ai/src/types.ts
    - packages/ai/src/mcts-bot.ts
    - packages/games/hex/rules/src/ai.ts

key-decisions:
  - "Linear gradients for path-based objectives (simple, monotonic)"
  - "0.5 = neutral for symmetric objectives like path-distance-advantage"
  - "Ratio-based gradient for group comparisons (fewer-groups)"
  - "Inverse gradient (1/groups) for single-group consolidation"

patterns-established:
  - "Objective checkers return [0,1] where 0=not achieved, 1=fully achieved"
  - "Handle Infinity cases explicitly before gradient calculation"
  - "Gradient should be monotonic with quality measure"

issues-created: []

# Metrics
duration: 12min
completed: 2026-01-15
---

# Phase 34 Plan 01: Gradient Objectives Summary

**Objective checkers now return [0,1] gradients enabling finer-grained position evaluation than boolean checks**

## Performance

- **Duration:** 12 min
- **Started:** 2026-01-15T18:48:00Z
- **Completed:** 2026-01-15T19:00:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Changed Objective interface from boolean to numeric checker
- Updated MCTS evaluation to multiply weight by gradient value
- Converted all 7 Hex objectives to meaningful [0,1] gradients

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Objective interface to numeric checker** - `130ab8c` (feat)
2. **Task 2: Update MCTS evaluation to use numeric objectives** - `1173876` (feat)
3. **Task 3: Convert Hex objectives to gradient values** - `2d906b5` (feat)

## Files Created/Modified

- `packages/ai/src/types.ts` - Objective.checker returns number [0,1]
- `packages/ai/src/mcts-bot.ts` - Gradient multiplication: totalScore += weight * achieved
- `packages/games/hex/rules/src/ai.ts` - All Hex objectives with gradient formulas

## Decisions Made

### Gradient Formulas Chosen

| Objective | Formula | Rationale |
|-----------|---------|-----------|
| path-distance-advantage | `(advantage + maxAdvantage) / (2 * maxAdvantage)` | 0.5=tied, linear scale for path difference |
| near-win (all 3) | `1 - pathLength / boardSize` | Linear: closer to winning = higher score |
| opponent-path-blocked | `opponentPath / boardSize` (or 1.0 if Infinity) | Longer opponent path = better for us |
| opponent-near-win | `1 - opponentPath / boardSize` | With negative weight, penalizes when opponent close |
| fewer-groups | `theirGroups / (myGroups + theirGroups)` | Ratio: more opponent groups = better |
| single-group | `1 / groups` | 1.0 for single group, diminishes with fragmentation |

### Why Linear Gradients

- **Simplicity**: Easy to understand and verify correctness
- **Monotonicity**: Guaranteed to prefer better positions
- **No tuning**: Linear doesn't introduce hyperparameters
- **Composability**: Linear gradients combine predictably with weights

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript type caching**: Hex rules package used cached types from @boardsmith/ai. Required rebuilding AI package first before hex rules would compile with new numeric checker type.
- **E2E test failures**: 3 E2E tests failed due to server not running (ERR_CONNECTION_REFUSED). Not related to gradient changes - these are infrastructure tests.

## Benchmark Results

AI vs AI benchmark (40 games, 100 MCTS iterations each):

```
Player 1 wins: 21 (52.5%)
Player 2 wins: 19 (47.5%)
Draws: 0 (0.0%)

Avg moves/game: 39.7
Avg time/game: 1.68s

Results look balanced (expected P1 slight advantage)
```

The 52.5% P1 win rate matches expected first-move advantage in Hex. All games completed successfully with no draws, confirming the gradient evaluation maintains proper game resolution.

## Next Phase Readiness

Ready for Phase 35: Dynamic UCT

The gradient objective framework is now in place and can be extended to:
- Add new game-specific objectives with gradient values
- Implement adaptive objective weighting
- Support multi-objective optimization
- Enable UCT constant tuning based on position gradients

---
*Phase: 34-gradient-objectives*
*Completed: 2026-01-15*
