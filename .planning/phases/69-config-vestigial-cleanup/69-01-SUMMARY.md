---
phase: 69-config-vestigial-cleanup
plan: 01
subsystem: infra
tags: [vitest, eslint, config, cleanup]

# Dependency graph
requires:
  - phase: 39-46 (v2.0 Collapse the Monorepo)
    provides: Consolidated src/ structure
provides:
  - Clean build configuration pointing to src/ only
  - No stale packages/ references in tooling
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - vitest.config.ts
    - eslint.config.mjs
    - package.json
    - src/ai/mcts-bot.ts
  deleted:
    - src/ai/utils.ts

key-decisions:
  - "Direct import from canonical location preferred over re-export proxy files"

patterns-established: []

# Metrics
duration: 4min
completed: 2026-02-01
---

# Phase 69 Plan 01: Config Cleanup Summary

**Removed stale monorepo paths from build config and deleted vestigial re-export file**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-01T20:12:50Z
- **Completed:** 2026-02-01T20:14:20Z
- **Tasks:** 3
- **Files modified:** 4 (1 deleted)

## Accomplishments
- Removed stale paths from vitest.config.ts (packages/, cli/, game-specific aliases)
- Fixed ESLint configuration to lint src/**/*.ts instead of packages/**/*.ts
- Removed vestigial src/ai/utils.ts single-export proxy file
- All 504 tests passing, build working

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix vitest.config.ts stale paths** - `dcdbe98` (chore)
2. **Task 2: Fix ESLint configuration and lint script** - `1ae4b01` (chore)
3. **Task 3: Remove vestigial utils.ts re-export file** - `fa574bf` (chore)

## Files Created/Modified
- `vitest.config.ts` - Removed stale include paths and game package aliases
- `eslint.config.mjs` - Changed files pattern from packages/**/*.ts to src/**/*.ts
- `package.json` - Changed lint script from eslint packages/ to eslint src/
- `src/ai/mcts-bot.ts` - Updated import path for SeededRandom
- `src/ai/utils.ts` - Deleted (was vestigial re-export)

## Decisions Made
- Direct imports to canonical location (../utils/random.js) preferred over proxy re-export files

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config files now reference only existing paths
- Ready for remaining v2.7 cleanup phases (70-74)
- ESLint currently reports 11 no-shadow violations (existing issues, not from this plan)

---
*Phase: 69-config-vestigial-cleanup*
*Completed: 2026-02-01*
