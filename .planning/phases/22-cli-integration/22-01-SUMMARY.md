---
phase: 22-cli-integration
plan: 01
subsystem: cli
tags:
  - parallel-training
  - worker-threads
  - cli

# Dependency graph
requires:
  - phase: 21-worker-infrastructure
    provides: runParallelSimulations, ParallelSimulatorOptions
provides:
  - --parallel CLI flag for train-ai command
  - --workers CLI flag for custom worker count
  - Parallel training integration bypassing AITrainer
affects:
  - 23-verification

# Tech tracking
tech-stack:
  added: []
  patterns:
    - CLI parallel integration bypasses AITrainer (CLI knows module path, AITrainer doesn't)
    - Parallel mode logs worker count at startup

key-files:
  created: []
  modified:
    - packages/cli/src/cli.ts
    - packages/cli/src/commands/train-ai.ts

key-decisions:
  - "Bypass AITrainer for parallel mode because CLI knows module path but AITrainer doesn't"
  - "Parse --workers as string, convert to int with default of CPU cores - 1"

patterns-established:
  - "Parallel path orchestrates training manually: runParallelSimulations -> analyzeFeatures -> selectTopFeatures -> generateAICode"

issues-created: []

# Metrics
duration: 8min
completed: 2026-01-13
---

# Phase 22 Plan 01: CLI Integration Summary

**Added --parallel and --workers CLI flags to train-ai command with full parallel simulation integration.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-13T20:47:00Z
- **Completed:** 2026-01-13T20:55:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `--parallel` flag to enable parallel simulation using worker threads
- Added `--workers <count>` flag to customize worker thread count (defaults to CPU cores - 1)
- Implemented parallel training path that bypasses AITrainer and calls runParallelSimulations directly
- Logs parallel mode status at startup: "Parallel mode: enabled (X workers)" or "Parallel mode: disabled"

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CLI flags for parallel training** - `7bb3c48` (feat)
2. **Task 2: Integrate parallel simulation into trainer** - `123a10d` (feat)

## Files Created/Modified

- `packages/cli/src/cli.ts` - Added --parallel and --workers options to train-ai command
- `packages/cli/src/commands/train-ai.ts` - Added parallel/workers options to TrainAIOptions interface, added parallel mode logging, implemented parallel training path that bypasses AITrainer

## Decisions Made

**Bypassing AITrainer for parallel mode:** The parallel integration happens at the CLI level, not inside AITrainer. This is because AITrainer doesn't know the game module path (it has GameClass, not the path to import it), but the CLI knows the module path from finding the rules bundle.

**Worker count default:** Uses `Math.max(1, cpus().length - 1)` to leave one core free for the main process, with minimum of 1 worker.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- CLI integration complete, ready for Phase 23 (verification)
- Parallel training verified with go-fish game:
  - Parallel mode: 4.8s for 10 games
  - Non-parallel mode: 33.4s for 10 games
  - ~7x speedup observed in quick test
- Custom worker count verified working with --workers flag

---
*Phase: 22-cli-integration*
*Completed: 2026-01-13*
