---
phase: 26-training-improvements
plan: 01
subsystem: ai-training
tags: [benchmark, mcts, training, evaluation]

# Dependency graph
requires:
  - phase: 25-structural-features
    provides: Feature templates for connection and capture games
provides:
  - benchmarkAI function for real win rate measurement
  - Separated MCTS configs for oracle vs trained AI
  - Real win rate tracking during training
affects: [training-improvements, integration-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Benchmark evaluation with position-balanced games
    - Tiered MCTS iterations (oracle vs trained vs benchmark)

key-files:
  created:
    - packages/ai-trainer/src/benchmark.ts
  modified:
    - packages/ai-trainer/src/types.ts
    - packages/ai-trainer/src/trainer.ts
    - packages/ai-trainer/src/index.ts

key-decisions:
  - "Use 100 MCTS iterations for benchmark evaluation (high for accuracy)"
  - "Use 50 MCTS iterations for oracle training games (quality data)"
  - "Use 10 MCTS iterations for trained AI (objectives help guide search)"
  - "Run 20-game mini-benchmarks after each training iteration"

patterns-established:
  - "benchmarkAI() plays half games as player 0, half as player 1 to eliminate first-player bias"

issues-created: []

# Metrics
duration: 3min
completed: 2026-01-14
---

# Phase 26 Plan 01: Benchmark Infrastructure Summary

**benchmarkAI() function with tiered MCTS configs for real win rate measurement during training**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-14T16:41:02Z
- **Completed:** 2026-01-14T16:43:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created benchmarkAI() that measures trained AI vs random baseline with position balancing
- Added oracleMCTSIterations (50), trainedMCTSIterations (10), benchmarkMCTSIterations (100) to config
- Replaced fake win rate estimate with real benchmark measurement after each training iteration
- Benchmark reports wins/losses/draws per position to detect first-player advantage issues

## Task Commits

Each task was committed atomically:

1. **Task 1: Add benchmark evaluation function** - `dd11fec` (feat)
2. **Task 2: Separate oracle MCTS from training MCTS** - `6f00fde` (feat)

## Files Created/Modified

- `packages/ai-trainer/src/benchmark.ts` - New file with benchmarkAI() function
- `packages/ai-trainer/src/types.ts` - Added oracle/trained/benchmark MCTS iteration configs
- `packages/ai-trainer/src/trainer.ts` - Integrated benchmarkAI for real win rate measurement
- `packages/ai-trainer/src/index.ts` - Exported benchmarkAI and related types

## Decisions Made

- **Position balancing:** Run half games with trained AI as player 0, half as player 1, to eliminate first-player advantage bias in win rate measurement
- **MCTS iteration tiers:** Oracle games need strong play (50 iterations) for quality training data, while trained games can use fewer (10) since learned objectives guide the search. Benchmarks use 100 for accuracy.
- **Mini-benchmarks:** Run 20 games between iterations for quick feedback, final benchmarks can be larger

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Benchmark infrastructure ready for measuring training improvement
- Real win rates will now be reported in training output
- Ready for 26-02 (mutation/evolution of feature weights) if defined

---
*Phase: 26-training-improvements*
*Completed: 2026-01-14*
