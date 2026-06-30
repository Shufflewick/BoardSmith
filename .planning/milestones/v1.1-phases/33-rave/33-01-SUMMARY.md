---
phase: 33-rave
plan: 01
subsystem: ai
tags: [mcts, rave, amaf, uct, search]

# Dependency graph
requires:
  - phase: 32-move-ordering
    provides: moveOrdering hook for exploration priority
provides:
  - RAVE value estimation for faster MCTS learning
  - UCT-RAVE blended selection formula
  - useRAVE and raveK config options
affects: [34-gradient-objectives, 35-dynamic-uct]

# Tech tracking
tech-stack:
  added: []
  patterns: [RAVE/AMAF heuristic, beta decay formula]

key-files:
  created: []
  modified: [packages/ai/src/types.ts, packages/ai/src/mcts-bot.ts]

key-decisions:
  - "RAVE values stored from move-maker's perspective for correct perspective handling"
  - "Beta decay formula: sqrt(k / (3*visits + k)) with k=500 default"
  - "RAVE enabled by default (useRAVE: true) since it improves learning speed"

patterns-established:
  - "AMAF pattern: credit moves appearing anywhere in playout to nodes where they could be first"

issues-created: []

# Metrics
duration: 15min
completed: 2026-01-15
---

# Phase 33 Plan 01: RAVE Summary

**RAVE (Rapid Action Value Estimation) integrated into MCTS for faster move learning via All-Moves-As-First heuristic**

## Performance

- **Duration:** 15 min
- **Started:** 2026-01-15T17:00:00Z
- **Completed:** 2026-01-15T17:15:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- Added useRAVE and raveK config options to BotConfig
- Track all moves (tree path + playout) for RAVE table updates
- Implemented UCT-RAVE blended selection with beta decay formula
- RAVE values correctly handle perspective (bot vs opponent moves)

## Task Commits

1. **Task 1: Add RAVE data structures and config** - `e80dbe6` (feat)
2. **Task 2: Track playout moves and update RAVE table** - `32eca4b` (feat)
3. **Task 3: Integrate RAVE into UCT selection** - `1d5ce9f` (feat)

**Plan metadata:** pending

## Files Created/Modified

- `packages/ai/src/types.ts` - Added useRAVE, raveK config options to BotConfig
- `packages/ai/src/mcts-bot.ts` - RAVE table, move tracking, UCT-RAVE selection

## Decisions Made

- RAVE enabled by default since it improves learning speed without downsides
- Beta decay constant k=500 (trust RAVE for ~500 visits before favoring UCT)
- Store RAVE values from move-maker's perspective, flip when needed for opponent moves

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation was straightforward following the well-documented RAVE algorithm.

## Benchmark Results

Hex AI vs AI (40 games, 100 iterations):
- P1 wins: 52.5%, P2 wins: 47.5%
- Avg moves/game: 36.9
- Avg time/game: 1.54s
- Results show balanced, strategic play

## Next Phase Readiness

Ready for Phase 34: Gradient Objectives
- RAVE foundation provides faster learning for objective-based evaluation
- No blockers or concerns

---
*Phase: 33-rave*
*Completed: 2026-01-15*
