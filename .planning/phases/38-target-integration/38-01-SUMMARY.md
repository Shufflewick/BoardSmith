---
phase: 38-target-integration
plan: 01
subsystem: cli
tags: [npm-pack, tarball, target-integration, file-protocol, vendor]

# Dependency graph
requires:
  - phase: 37-pack-command
    provides: boardsmith pack command with timestamp versioning
provides:
  - "--target flag for automatic consumer project integration"
  - "vendor/ directory with tarballs in target project"
  - "package.json dependency updates to file: protocol"
  - "workspace: to file: protocol resolution in tarballs"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "workspace: protocol resolution to file:./vendor/* for external consumption"
    - "tarball map computed upfront for cross-package dependency resolution"

key-files:
  created: []
  modified:
    - packages/cli/src/commands/pack.ts
    - packages/cli/src/cli.ts

key-decisions:
  - "Resolve workspace:* deps inside tarballs to file:./vendor/* for external use"
  - "Build tarball map upfront before packing to enable dependency resolution"
  - "Only update existing BoardSmith dependencies in target, don't add new ones"

patterns-established:
  - "Target integration: copy vendor/, update package.json, run npm install"
  - "resolveWorkspaceDeps() for converting workspace protocol to file protocol"

# Metrics
duration: 4min
completed: 2026-01-18
---

# Phase 38 Plan 01: Target Integration Summary

**`--target` flag copies tarballs to consumer project, updates file: deps, resolves workspace: protocol for external use**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-18T17:58:57Z
- **Completed:** 2026-01-18T18:02:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `--target <path>` flag to pack command for automatic consumer integration
- Tarballs copied to target's vendor/ directory automatically
- Target's package.json updated with file:./vendor/*.tgz dependencies
- npm install runs automatically in target after dependency updates
- workspace: protocol deps resolved to file: protocol in tarballs for external consumption

## Task Commits

Each task was committed atomically:

1. **Task 1: Add --target flag and target integration logic** - `0a1baa1` (feat)
2. **Task 2: Fix workspace: protocol and verify end-to-end** - `331f26a` (fix)

## Files Created/Modified
- `packages/cli/src/commands/pack.ts` - Added integrateWithTarget(), resolveWorkspaceDeps(), tarball map
- `packages/cli/src/cli.ts` - Added --target option to pack command

## Decisions Made
- Resolve workspace:* dependencies to file:./vendor/* before npm pack so tarballs work outside monorepo
- Build tarball map upfront (before packing) to enable cross-package dependency resolution
- Only update dependencies that already exist in target's package.json (don't add new ones)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] workspace: protocol causes npm install failure**
- **Found during:** Task 2 (End-to-end verification)
- **Issue:** Tarballs contained `"@boardsmith/engine": "workspace:*"` which fails npm install outside monorepo context
- **Fix:** Added resolveWorkspaceDeps() to convert workspace:* to file:./vendor/*.tgz before npm pack; built tarball map upfront
- **Files modified:** packages/cli/src/commands/pack.ts
- **Verification:** Re-ran pack --target, npm install succeeded, checked tarball package.json has file: deps
- **Committed in:** 331f26a

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Critical fix for tarballs to work outside monorepo. No scope creep.

## Issues Encountered
None - the workspace: protocol issue was caught during planned verification.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Target integration complete and working
- v1.2 Local Tarballs milestone complete (Phases 37-38)
- `boardsmith pack --target /path/to/game` workflow ready for use

---
*Phase: 38-target-integration*
*Completed: 2026-01-18*
