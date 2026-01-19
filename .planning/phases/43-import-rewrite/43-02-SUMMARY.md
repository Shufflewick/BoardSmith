---
phase: 43-import-rewrite
plan: 02
subsystem: imports
tags: [vitest, alias, esm, module-resolution]

# Dependency graph
requires:
  - phase: 43-01
    provides: All internal @boardsmith/* imports converted to relative paths in src/
provides:
  - Vitest config cleaned up with only game package aliases
  - Phase 43 import rewrite complete
affects: [44-game-extraction, 45-cli-consolidation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vitest aliases only for external packages (games in packages/)"
    - "Internal modules resolved via relative imports"

key-files:
  created: []
  modified:
    - vitest.config.ts

key-decisions:
  - "Keep game package aliases until Phase 44 extracts them"

patterns-established:
  - "Vitest config: aliases only needed for packages outside src/"

# Metrics
duration: 2min
completed: 2026-01-18
---

# Phase 43 Plan 02: Vitest Config Cleanup Summary

**Removed 7 internal package aliases from vitest.config.ts, completing Phase 43 import rewrite**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-19T01:54:19Z
- **Completed:** 2026-01-19T01:55:29Z
- **Tasks:** 1 (Task 3 only - Tasks 1-2 completed in 43-01 scope extension)
- **Files modified:** 1

## Accomplishments
- Removed 7 internal @boardsmith/* aliases (engine, runtime, ai, ai-trainer, session, ui, testing)
- Kept 3 game package aliases (checkers-rules, cribbage-rules, go-fish-rules)
- All 510+ tests pass (3 E2E failures unrelated - require external server)
- Phase 43 import rewrite complete

## Task Commits

Task 3 committed (Tasks 1-2 were completed in 43-01):

1. **Task 3: Update vitest config** - `cd4dda2` (refactor)
   - Removed 7 internal package aliases
   - Kept 3 game package aliases

## Files Created/Modified
- `vitest.config.ts` - Removed internal package aliases, kept game package aliases only

## Decisions Made
- Keep 3 game package aliases until Phase 44 extracts games from packages/ to a separate structure

## Deviations from Plan

None - Task 3 executed exactly as written. (Tasks 1-2 were completed as part of 43-01's scope extension.)

## Issues Encountered

1. **TS6059 rootDir warnings** - Pre-existing TypeScript configuration warnings about files in packages/ not being under rootDir. These are not caused by this change and are tracked for Phase 44 (game extraction).

2. **3 E2E test failures** - Tests in `e2e-game.test.ts` fail with ECONNREFUSED because they require a server running on port 8787. These are E2E tests that need external infrastructure, unrelated to import changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 43 import rewrite complete
- All internal @boardsmith/* imports use relative paths
- Vitest config has only game package aliases
- Ready for Phase 44: Game Extraction

---
*Phase: 43-import-rewrite*
*Completed: 2026-01-18*
