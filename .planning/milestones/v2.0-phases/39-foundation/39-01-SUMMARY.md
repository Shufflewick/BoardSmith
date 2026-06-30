---
phase: 39-foundation
plan: 01
subsystem: infra
tags: [npm, package-management, exports]

# Dependency graph
requires: []
provides:
  - npm tooling foundation (replaces pnpm)
  - Single-package structure with exports field
  - package-lock.json for npm dependency resolution
affects: [40-source, 41-tests, 43-imports]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - npm single-package structure
    - exports field for ESM entry points

key-files:
  created:
    - package-lock.json
  modified:
    - package.json

key-decisions:
  - "Switch from pnpm to npm for simpler single-package workflow"
  - "Remove workspaces config - no longer a monorepo"
  - "Add exports field pointing to packages/engine/dist as foundation"

patterns-established:
  - "package.json exports field pattern: types before import"

# Metrics
duration: 1min 19s
completed: 2026-01-18
---

# Phase 39 Plan 01: pnpm to npm Migration Summary

**Migrated from pnpm monorepo to npm single-package structure with exports field**

## Performance

- **Duration:** 1min 19s
- **Started:** 2026-01-18T22:45:16Z
- **Completed:** 2026-01-18T22:46:35Z
- **Tasks:** 2
- **Files modified:** 2 (package.json modified, package-lock.json created)
- **Files deleted:** 2 (pnpm-workspace.yaml, pnpm-lock.yaml)

## Accomplishments

- Removed pnpm configuration files (pnpm-workspace.yaml, pnpm-lock.yaml)
- Updated package.json: removed workspace/pnpm config, added exports field
- Generated package-lock.json with npm install (237 packages)
- Established foundation for monorepo collapse

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove pnpm configuration and update package.json** - `e44fa19` (chore)
2. **Task 2: Generate npm lock file and verify installation** - `c729bd8` (chore)

## Files Created/Modified

- `package.json` - Updated: removed pnpm/workspace config, added exports field, removed private flag
- `package-lock.json` - Created: npm lock file with lockfileVersion 3
- `pnpm-workspace.yaml` - Deleted
- `pnpm-lock.yaml` - Deleted
- `node_modules/` - Recreated with npm structure (not tracked)

## Decisions Made

1. **Removed private: true** - Package should be publishable after collapse
2. **Exports field points to packages/engine/dist** - Minimal foundation; will expand in later phases
3. **Removed build and cli scripts** - They depended on workspaces; will be restored in Phase 40

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - npm install ran cleanly with expected output.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- npm tooling foundation complete
- Ready for Phase 40 (source consolidation)
- Note: Tests will not pass yet because sub-packages still have `workspace:*` dependencies (addressed in Phase 43)

---
*Phase: 39-foundation*
*Completed: 2026-01-18*
