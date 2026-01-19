---
phase: 46-documentation
plan: 03
subsystem: docs
tags: [migration, documentation, v2.0, collapsed-monorepo]

# Dependency graph
requires:
  - phase: 42-exports
    provides: subpath exports definition in package.json
  - phase: 39-foundation
    provides: collapsed package structure (boardsmith vs @boardsmith/*)
provides:
  - MERC team migration guide with complete import mapping
  - Step-by-step v1.x to v2.0 upgrade instructions
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - docs/migration-guide.md
  modified: []

key-decisions:
  - "Table format for import mappings: Clear visual reference for all 13 paths"
  - "Both VS Code and CLI approaches: Supports different team workflows"

patterns-established:
  - "Copy-paste ready documentation: Commands work as-is, no adaptation needed"

# Metrics
duration: 1min
completed: 2026-01-19
---

# Phase 46 Plan 03: Migration Guide Summary

**Copy-paste ready migration guide with complete import mapping table for MERC team upgrade from v1.x to v2.0**

## Performance

- **Duration:** 1 min
- **Started:** 2026-01-19T17:27:24Z
- **Completed:** 2026-01-19T17:28:04Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created docs/migration-guide.md with 4-step migration process
- Complete import mapping table (13 entries: 11 subpaths + 2 CSS assets)
- Quick find/replace commands for both VS Code and CLI (macOS/Linux)
- Common issues section addressing TypeScript moduleResolution setup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration guide for MERC team** - `5e45dd7` (docs)

## Files Created/Modified
- `docs/migration-guide.md` - Step-by-step migration from @boardsmith/* to boardsmith

## Decisions Made
- Table format chosen for import mappings (visual clarity over prose)
- Included both VS Code and sed approaches for flexibility
- Kept guide minimal and actionable per CONTEXT.md direction

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Migration guide complete
- Ready for plan 04 (API reference pages) if needed
- DOC-04 requirement satisfied

---
*Phase: 46-documentation*
*Completed: 2026-01-19*
