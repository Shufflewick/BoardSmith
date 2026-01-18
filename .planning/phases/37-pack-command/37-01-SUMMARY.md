---
phase: 37-pack-command
plan: 01
subsystem: cli
tags: [npm-pack, tarball, versioning, monorepo, local-development]

# Dependency graph
requires: []
provides:
  - boardsmith pack command for creating local tarballs
  - timestamp-based versioning for immutable snapshots
  - Package discovery for @boardsmith/* and eslint-plugin
affects: [38-target-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - timestamp versioning pattern: baseVersion-YYYYMMDDHHMMSS
    - package discovery with isBoardSmithPackage() filter
    - try/finally for package.json restoration during npm pack

key-files:
  created:
    - packages/cli/src/commands/pack.ts
  modified:
    - packages/cli/src/cli.ts

key-decisions:
  - "Only pack @boardsmith/* and eslint-plugin-boardsmith (skip @mygames/*)"
  - "Single timestamp for all packages in a pack run (consistent snapshot)"
  - "Use try/finally to always restore package.json after npm pack"

patterns-established:
  - "CLI command pattern: validate monorepo root, discover, process, report"
  - "Timestamp versioning: YYYYMMDDHHMMSS suffix for dev versions"

# Metrics
duration: 2min
completed: 2026-01-18
---

# Phase 37 Plan 01: Pack Command Summary

**`boardsmith pack` command creates timestamped tarballs of all 12 public packages for local installation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-18T17:40:03Z
- **Completed:** 2026-01-18T17:42:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `boardsmith pack` command with full package discovery
- Timestamp-based versioning (e.g., 0.0.1-20260118174156) for immutable snapshots
- All 12 public packages packed: engine, runtime, session, ai, client, testing, eslint-plugin, ui, worker, cli, server, ai-trainer

## Task Commits

Each task was committed atomically:

1. **Task 1: Create pack command implementation** - `8ceb143` (feat)
2. **Task 2: Wire pack command into CLI** - `d596689` (feat)
3. **Fix: Include eslint-plugin-boardsmith** - `2dbf2fb` (fix)

## Files Created/Modified
- `packages/cli/src/commands/pack.ts` - Pack command implementation with discovery, versioning, packing
- `packages/cli/src/cli.ts` - CLI entry point with pack command registration

## Decisions Made
- Only pack packages starting with `@boardsmith/` plus `eslint-plugin-boardsmith` - games use `@mygames/*` scope and should not be packed
- Use single timestamp for all packages in a run to create consistent snapshot
- Always restore original package.json using try/finally, even if npm pack fails

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] eslint-plugin-boardsmith not included**
- **Found during:** Verification (after Task 2)
- **Issue:** eslint-plugin-boardsmith uses non-scoped naming convention (npm ESLint plugin standard), so `@boardsmith/*` filter missed it
- **Fix:** Added `isBoardSmithPackage()` helper that checks for both `@boardsmith/*` prefix and `eslint-plugin-boardsmith` name
- **Files modified:** packages/cli/src/commands/pack.ts
- **Verification:** Re-ran pack, confirmed 12 packages (was 11)
- **Committed in:** 2dbf2fb

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor fix to include all BoardSmith packages. No scope creep.

## Issues Encountered
None - verification testing caught the eslint-plugin exclusion before finalizing.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pack command complete and working
- Ready for Phase 38: Target Integration (--target flag for copying tarballs to consumer projects)
- Tarballs output to `.boardsmith/tarballs/` by default

---
*Phase: 37-pack-command*
*Completed: 2026-01-18*
