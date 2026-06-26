---
phase: 107-ai-assisted-teaching
plan: "01"
subsystem: ai
tags: [mcts, ai, stats, types, tdd]
dependency_graph:
  requires: []
  provides: [BotMoveStats, MCTSBot.playWithStats, MCTSBot.runSearch, AIConfig.hintTargetFromMove]
  affects: [src/ai/mcts-bot.ts, src/ai/types.ts, src/ai/index.ts]
tech_stack:
  added: []
  patterns: [runSearch extraction, TDD RED/GREEN/REFACTOR, vitest exclusion for external-dep integration tests]
key_files:
  created:
    - src/ai/mcts-stats.test.ts
    - src/ai/mcts-stats-checkers.test.ts
  modified:
    - src/ai/types.ts
    - src/ai/index.ts
    - src/ai/mcts-bot.ts
    - vitest.config.ts
decisions:
  - "Split checkers integration test into separate excluded file (mcts-stats-checkers.test.ts) because having unit tests and excluded tests in the same file would prevent unit tests from running under the project's vitest exclusion convention"
  - "Single-move early exit in runSearch() now returns a minimal MCTSNode root with no children, giving playWithStats() empty stats — correct behavior for a forced move"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-26"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 4
  tests_added: 7
  tests_total: 1463
---

# Phase 107 Plan 01: MCTS Stats API Summary

One-liner: Extract `runSearch()` from `playSingle()` returning `{ move, root }` so `playWithStats()` captures root.children (per-candidate evaluations) before post-search cleanup discards the tree.

## What Was Built

### BotMoveStats type + hintTargetFromMove hook (Task 1)

- Added `BotMoveStats` interface to `src/ai/types.ts` immediately after `BotMove`, following the same JSDoc-per-field style: `move: BotMove`, `visits: number`, `value: number` (normalized [0,1])
- Imported `ElementRef` from the engine layer to type the new `hintTargetFromMove` return value
- Added optional `hintTargetFromMove?: (move: BotMove) => ElementRef | undefined` to `AIConfig` between `moveOrdering` and `uctConstant` with a JSDoc comment explaining the session-layer default extraction fallback
- Re-exported `BotMoveStats` from `src/ai/index.ts` alongside the existing `BotMove` export

### runSearch() extraction + playWithStats() (Task 2)

- Renamed `playSingle()` → `private async runSearch(): Promise<{ move: BotMove; root: MCTSNode }>` — returns both the selected move and the root node BEFORE cleanup nulls `this.searchGame`/`this.rootSnapshot`; callers can safely read `root.children` after return
- All `return best.parentMove!` paths updated to `return { move: best.parentMove!, root }`
- Single-move early exit (`allMoves.length === 1`) updated to create a minimal root node and return `{ move: allMoves[0], root }` — `playWithStats()` callers get empty stats, which is correct for a forced move
- `play()` rewired to call `(await this.runSearch()).move`; parallel fallback also updated
- Added `async playWithStats(): Promise<{ move: BotMove; stats: BotMoveStats[] }>` that always calls `runSearch()` (ignoring `config.parallel`), maps `root.children` to `BotMoveStats[]`, and returns `{ move, stats }`
- RED/GREEN TDD cycle: 5 failing tests created before implementation; all 5 pass after

### Test coverage (Task 3)

- Expanded `src/ai/mcts-stats.test.ts` with 2 additional unit tests: move shape validation and recommended move present in stats (7 total unit tests)
- Created `src/ai/mcts-stats-checkers.test.ts` with 4 checkers integration tests: non-empty stats, recommended move in stats, `to` arg present for hint/heatmap anchor, all values in [0,1]
- Added `src/ai/mcts-stats-checkers.test.ts` to `vitest.config.ts` exclude list — CI without `@boardsmith/checkers-rules` symlink does not fail
- Zero new npm dependencies

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed early-return path returning wrong type**
- **Found during:** Task 2 GREEN phase
- **Issue:** `runSearch()` early exit for `allMoves.length === 1` still returned `allMoves[0]` (a `BotMove`) instead of `{ move: BotMove; root: MCTSNode }`. Callers doing `(await runSearch()).move` received `undefined`, causing `TypeError: Cannot read properties of undefined (reading 'action')` in 5 pre-existing tests (`multiplayer-host.test.ts`, `stateless-ops.test.ts`)
- **Fix:** Create a minimal `MCTSNode` root at the early-exit point and return `{ move: allMoves[0], root }`. `playWithStats()` callers correctly receive empty stats (no children evaluated) for forced moves
- **Files modified:** `src/ai/mcts-bot.ts`
- **Commit:** `f1e29ec`

### Architectural Decisions

**1. Separate file for checkers integration test**
- **Decision:** Created `src/ai/mcts-stats-checkers.test.ts` instead of adding the checkers test inline to `mcts-stats.test.ts`
- **Reason:** The project's vitest exclusion convention operates at the file level (entire file excluded). Putting both unit tests and the checkers integration test in the same file would require excluding the entire file, preventing unit tests from running in CI without the symlink
- **Impact:** Unit tests in `mcts-stats.test.ts` always run; checkers integration only runs locally with symlink

## TDD Gate Compliance

- RED gate: `src/ai/mcts-stats.test.ts` stub created with 5 failing tests before implementation (commit `f1e29ec` message includes both red/green in same commit per single-atomic-commit constraint; RED state verified via vitest run showing `TypeError: bot.playWithStats is not a function`)
- GREEN gate: Implementation commit makes all 5 tests pass
- REFACTOR: No refactor needed

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/ai/types.ts | FOUND |
| src/ai/index.ts | FOUND |
| src/ai/mcts-bot.ts | FOUND |
| src/ai/mcts-stats.test.ts | FOUND |
| src/ai/mcts-stats-checkers.test.ts | FOUND |
| commit 8d1d671 (types) | FOUND |
| commit f1e29ec (runSearch) | FOUND |
| commit 7cb148f (tests) | FOUND |
| 1463 tests pass | VERIFIED |
| No new dependencies | VERIFIED |
