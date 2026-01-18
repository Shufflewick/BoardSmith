---
phase: 40-source-collapse
plan: 02
subsystem: infra
tags: [git-mv, monorepo-collapse, source-reorganization]

# Dependency graph
requires:
  - phase: 40-01
    provides: Foundation package sources in src/ (engine, runtime, ai, ai-trainer, testing, session)
provides:
  - Peripheral package sources in src/ (eslint-plugin, client, server, ui, worker, cli)
  - Complete source collapse: 179 files in unified src/ structure
affects: [41-tests, 43-imports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Source files organized by package in src/*/
    - Non-TypeScript assets (CSS, MP3, .d.ts) collocated with source

key-files:
  created:
    - src/eslint-plugin/index.ts
    - src/client/index.ts
    - src/server/index.ts
    - src/ui/index.ts
    - src/worker/index.ts
    - src/cli/cli.ts
  modified: []

key-decisions:
  - "Single atomic commit for all 95 peripheral file moves"
  - "Skipped empty cli/src/templates/ and cli/src/utils/ directories"

patterns-established:
  - "git mv for file moves to preserve history"
  - "Package-to-directory mapping: packages/X/src/* -> src/X/"

# Metrics
duration: 1min 19s
completed: 2026-01-18
---

# Phase 40 Plan 02: Peripheral Package Source Collapse Summary

**Moved 95 peripheral package sources (eslint-plugin, client, server, ui, worker, cli) completing the 179-file source collapse**

## Performance

- **Duration:** 1min 19s
- **Started:** 2026-01-18T23:10:25Z
- **Completed:** 2026-01-18T23:11:44Z
- **Tasks:** 3
- **Files modified:** 95

## Accomplishments

- Moved eslint-plugin (6 files), client (6 files), server (9 files) to src/
- Moved ui package (54 files) including CSS animations, MP3 audio, and .d.ts declarations
- Moved worker (1 file) and cli (19 files, including markdown templates)
- All 95 files tracked as git renames (100% similarity) preserving full history
- Completed source collapse: 179 total files now in unified src/ structure

## Task Commits

The plan used a single atomic commit:

1. **Tasks 1-2: Move peripheral packages and commit** - `01bf2e5` (refactor)
2. **Task 3: Verification only** - no commit

## Files Created/Modified

Directory structure created:
- `src/eslint-plugin/` - 6 files (ESLint rules with rules/ subdirectory)
- `src/client/` - 6 files (browser SDK)
- `src/server/` - 9 files (server core with stores/, handlers/ subdirectories)
- `src/ui/` - 54 files (Vue components with animation/, assets/, components/, composables/ subdirectories)
- `src/worker/` - 1 file (Cloudflare Worker)
- `src/cli/` - 19 files (CLI with commands/, lib/, slash-command/ subdirectories)

## Decisions Made

1. **Single atomic commit** - All 95 files moved in one commit matching Plan 01 approach
2. **Skipped empty directories** - cli/src/templates/ and cli/src/utils/ were empty, git mv fails on empty dirs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Empty CLI directories** - `git mv packages/cli/src/*` failed because templates/ and utils/ were empty. Resolved by moving files individually, skipping empty directories. This was anticipated in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Source collapse complete: all 179 files in src/
- All 12 SRC requirements (SRC-01 through SRC-12) satisfied
- File types: 153 TypeScript, 19 Vue, 2 CSS, 4 Markdown, 1 MP3
- Ready for Phase 41 (Test Colocation)
- Note: Imports still reference @boardsmith/* paths - will be updated in Phase 43

---
*Phase: 40-source-collapse*
*Completed: 2026-01-18*
