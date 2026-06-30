---
phase: 42-subpath-exports
plan: 01
subsystem: pkg
tags: [exports, esm, typescript, moduleResolution, bundler]

# Dependency graph
requires:
  - phase: 40-source-collapse
    provides: Source files consolidated in src/*/ structure
  - phase: 41-test-colocation
    provides: Tests colocated with sources, vitest aliases configured
provides:
  - 11 subpath exports in package.json pointing to src/*/index.ts
  - External consumers can import from boardsmith, boardsmith/ui, etc.
  - TypeScript types resolved via exports field with bundler resolution
affects:
  - 43-import-rewrite: Will need to rewrite @boardsmith/* to relative imports
  - 44-game-extraction: Games will import from new subpath structure
  - 45-cli: CLI may need boardsmith/cli subpath

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Source-based exports (types and import point to .ts source files)
    - Types condition first in each export for TypeScript resolution

key-files:
  created: []
  modified:
    - package.json (11 exports)
    - vitest.config.ts (added @boardsmith/testing alias)

key-decisions:
  - "Source-based exports: Point to .ts source files, not compiled dist"
  - "Types condition first: Required for TypeScript moduleResolution bundler"
  - "11 subpaths: ., ui, session, testing, eslint-plugin, ai, ai-trainer, client, server, runtime, worker"

patterns-established:
  - "exports condition order: types first, then import"
  - "All exports point to src/*/index.ts entry points"

# Metrics
duration: 4min
completed: 2026-01-19
---

# Phase 42: Subpath Exports Summary

**11 subpath exports configured in package.json, verified with external test project using Node.js ESM resolution**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-19T01:19:00Z
- **Completed:** 2026-01-19T01:23:18Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Configured all 11 subpath exports in package.json with types-first condition ordering
- Each export points to source .ts files for bundler-based consumers
- External test project successfully resolved all 11 subpaths via import.meta.resolve()
- Added missing @boardsmith/testing alias to vitest.config.ts for game demo tests

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure 11 subpath exports** - `5304de7` (feat)
   - Updated exports field from single . export to 11 subpaths
   - Added @boardsmith/testing vitest alias (auto-fix)

2. **Task 2: Verify with external test project** - (no commit, external files in /tmp)
   - Created test project at /private/tmp/boardsmith-test-target/
   - Verified all 11 subpaths resolve via Node.js ESM resolution

## Files Created/Modified
- `package.json` - 11 subpath exports pointing to src/*/index.ts
- `vitest.config.ts` - Added @boardsmith/testing alias for game demo tests

## Decisions Made
- **Source-based exports:** Point directly to .ts source files instead of compiled dist. This works for bundler consumers (Vite, webpack, esbuild) and defers build concerns to a future phase.
- **Types-first condition ordering:** Each export has `types` before `import` as required for TypeScript moduleResolution: bundler.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing @boardsmith/testing alias to vitest.config.ts**
- **Found during:** Task 1 (test verification)
- **Issue:** Game demo tests (floss-bitties, demoAnimation) failed with "Cannot find module @boardsmith/testing"
- **Fix:** Added `'@boardsmith/testing': resolve(__dirname, 'src/testing/index.ts')` to vitest aliases
- **Files modified:** vitest.config.ts
- **Verification:** floss-bitties tests now pass (demoAnimation has pre-existing game setup bug, unrelated)
- **Committed in:** 5304de7 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for test suite. No scope creep.

## Issues Encountered
- TypeScript compilation of external test project fails due to @boardsmith/* internal imports - This is expected per research and will be fixed in Phase 43 (Import Rewrite). Used Node.js ESM resolution (import.meta.resolve) for verification instead.
- demoAnimation game demo tests fail (player.hand undefined) - Pre-existing bug in that demo game, unrelated to exports change.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Exports configured and verified, ready for Phase 43 (Import Rewrite)
- Phase 43 will rewrite @boardsmith/* imports to relative imports
- After import rewrite, external TypeScript consumers can fully compile with the library

---
*Phase: 42-subpath-exports*
*Completed: 2026-01-19*
