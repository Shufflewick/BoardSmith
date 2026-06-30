---
phase: 44-game-extraction
plan: 10
subsystem: games
tags: [floss-bitties, extraction, card-game, vue]

# Dependency graph
requires:
  - phase: 44-01
    provides: Template files for standalone game extraction
provides:
  - Floss Bitties extracted to standalone project
  - Unified src/ structure preserved
  - All imports transformed to boardsmith package
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified structure: src/rules, src/ui, src/main.ts"
    - "Import transformation: @boardsmith/engine -> boardsmith"
    - "Import transformation: @boardsmith/ui -> boardsmith/ui"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/floss-bitties/package.json
    - /private/tmp/boardsmith-test-target/floss-bitties/vitest.config.ts
  modified:
    - /private/tmp/boardsmith-test-target/floss-bitties/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/floss-bitties/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/floss-bitties/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/floss-bitties/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/floss-bitties/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/floss-bitties/tests/game.test.ts

key-decisions:
  - "Preserved existing unified structure (already correct format)"
  - "Used rsync to exclude node_modules/dist during copy"
  - "Added vitest.config.ts since game has tests"

patterns-established:
  - "Unified game extraction: copy, update package.json, transform imports"
  - "Test imports also transformed: @boardsmith/testing -> boardsmith/testing"

# Metrics
duration: 2min
completed: 2026-01-18
---

# Phase 44 Plan 10: Floss Bitties Extraction Summary

**Extracted Floss Bitties card game to standalone project with boardsmith imports (marked as potentially non-working)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-19T02:37:41Z
- **Completed:** 2026-01-19T02:39:52Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Copied Floss Bitties project to /private/tmp/boardsmith-test-target/floss-bitties/
- Updated package.json with boardsmith dependency (removed @boardsmith/* packages)
- Transformed all imports from @boardsmith/* to boardsmith/*
- Initialized standalone git repository

## Task Commits

Since extracted game is in /private/tmp/ (outside BoardSmith repo), commits are in the extracted project:

1. **Task 1-3: Complete extraction** - `cc3fbe8` (Initial commit: Floss Bitties extracted)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `/private/tmp/boardsmith-test-target/floss-bitties/package.json` - Updated with boardsmith dependency
- `/private/tmp/boardsmith-test-target/floss-bitties/tsconfig.json` - Updated to include tests/**/*
- `/private/tmp/boardsmith-test-target/floss-bitties/vitest.config.ts` - Added from template
- `/private/tmp/boardsmith-test-target/floss-bitties/.gitignore` - Updated to include package-lock.json
- `/private/tmp/boardsmith-test-target/floss-bitties/src/rules/game.ts` - @boardsmith/engine -> boardsmith
- `/private/tmp/boardsmith-test-target/floss-bitties/src/rules/elements.ts` - @boardsmith/engine -> boardsmith
- `/private/tmp/boardsmith-test-target/floss-bitties/src/rules/actions.ts` - @boardsmith/engine -> boardsmith
- `/private/tmp/boardsmith-test-target/floss-bitties/src/rules/flow.ts` - @boardsmith/engine -> boardsmith
- `/private/tmp/boardsmith-test-target/floss-bitties/src/ui/App.vue` - @boardsmith/ui -> boardsmith/ui
- `/private/tmp/boardsmith-test-target/floss-bitties/tests/game.test.ts` - @boardsmith/testing -> boardsmith/testing

## Decisions Made

1. **Preserved unified structure** - Floss Bitties already had correct src/rules, src/ui layout
2. **Used rsync for copy** - Cleanly excluded node_modules and dist with broken symlinks
3. **Added vitest.config.ts** - Game has tests that need vitest configuration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Initial `cp -r` failed due to broken symlinks in node_modules - used rsync with excludes instead

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Floss Bitties is extracted as a standalone project. Per GAME-05 requirements, non-working state is acceptable - the extraction preserved the existing game code.

Note: This game is marked as "not currently working" in the research phase. The extraction is complete, but functionality testing is not required.

---
*Phase: 44-game-extraction*
*Completed: 2026-01-18*
