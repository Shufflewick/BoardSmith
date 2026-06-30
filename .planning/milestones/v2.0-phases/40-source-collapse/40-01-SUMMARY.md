---
phase: 40-source-collapse
plan: 01
subsystem: infra
tags: [git-mv, monorepo-collapse, source-reorganization]

# Dependency graph
requires:
  - phase: 39-foundation
    provides: npm single-package structure with exports field
provides:
  - Foundation package sources in src/ (engine, runtime, ai, ai-trainer, testing, session)
  - 84 files moved with git history preserved
affects: [40-02-source-collapse, 41-tests, 43-imports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Source files organized by package in src/*/

key-files:
  created:
    - src/engine/index.ts
    - src/runtime/index.ts
    - src/ai/index.ts
    - src/ai-trainer/index.ts
    - src/testing/index.ts
    - src/session/index.ts
  modified: []

key-decisions:
  - "Single atomic commit for all 84 file moves"
  - "Preserved empty packages/*/src/ directories (will be cleaned later)"

patterns-established:
  - "git mv for file moves to preserve history"
  - "Package-to-directory mapping: packages/X/src/* -> src/X/"

# Metrics
duration: 1min 2s
completed: 2026-01-18
---

# Phase 40 Plan 01: Foundation Package Source Collapse Summary

**Moved 84 source files from packages/*/src/ to unified src/ structure using git mv for history preservation**

## Performance

- **Duration:** 1min 2s
- **Started:** 2026-01-18T23:08:15Z
- **Completed:** 2026-01-18T23:09:17Z
- **Tasks:** 2
- **Files modified:** 84

## Accomplishments

- Moved engine package (42 files) to src/engine/ with subdirectories preserved
- Moved runtime, ai, ai-trainer, testing, session packages (42 files total) to src/
- All files tracked as git renames (100% similarity) preserving full history
- Created foundation for unified single-package codebase

## Task Commits

The plan was committed as a single atomic operation:

1. **Task 1+2: Move foundation packages and commit** - `7d495fa` (refactor)

## Files Created/Modified

Directory structure created:
- `src/engine/` - 42 files (core game logic with action/, command/, element/, flow/, player/, sandbox/, scoring/, utils/)
- `src/runtime/` - 2 files (runner.ts, index.ts)
- `src/ai/` - 4 files (mcts-bot.ts, types.ts, utils.ts, index.ts)
- `src/ai-trainer/` - 17 files (training infrastructure)
- `src/testing/` - 7 files (test utilities)
- `src/session/` - 12 files (session management)

## Decisions Made

1. **Single atomic commit** - All 84 files moved in one commit for easier rollback if needed
2. **Empty src/ directories left in packages/** - Will be cleaned up in later phase to keep this plan focused

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all git mv operations succeeded with files detected as renames.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Foundation packages (Wave 1) complete in src/
- Ready for Plan 40-02 (peripherals: eslint-plugin, client, server, ui, worker, cli)
- Note: Imports still reference @boardsmith/* paths - will be updated in Phase 43

---
*Phase: 40-source-collapse*
*Completed: 2026-01-18*
