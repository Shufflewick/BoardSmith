---
phase: 45-cli-update
plan: 01
subsystem: cli
tags: [cli, init, scaffolding, standalone-projects]

# Dependency graph
requires:
  - phase: 42-exports
    provides: boardsmith subpath exports (boardsmith, boardsmith/ui, boardsmith/testing)
  - phase: 44-games
    provides: validated extraction guide and package.json structure
provides:
  - Updated init command generating standalone projects with boardsmith imports
  - Robust monorepo detection for both bundled and unbundled CLI
affects: [45-02-cli-commands, 46-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Multi-path monorepo detection for bundled/unbundled CLI

key-files:
  created: []
  modified:
    - src/cli/lib/project-scaffold.ts
    - src/cli/commands/init.ts

key-decisions:
  - "Multi-candidate monorepo detection: Try both 3-level and 2-level parent paths to handle bundled CLI"
  - "Package name simplified: @mygames/${name} -> ${name}"
  - "npx boardsmith for scripts: No @boardsmith/cli devDependency needed"
  - "Game-specific Player import in tests: Use ${pascal}Player instead of generic Player"

patterns-established:
  - "Standalone game structure: boardsmith dependency + boardsmith/ui for UI"
  - "Local dev via file: link when running from monorepo"

# Metrics
duration: 5min
completed: 2026-01-18
---

# Phase 45 Plan 01: Init Command Update Summary

**Updated boardsmith init to generate standalone projects with boardsmith subpath imports instead of @boardsmith/* packages**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-19T05:02:54Z
- **Completed:** 2026-01-19T05:08:01Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Init command now generates projects using `boardsmith` and `boardsmith/ui` imports
- Package.json uses single `boardsmith` dependency (not separate @boardsmith/engine, @boardsmith/ui, etc.)
- Monorepo detection works for both bundled (esbuild) and unbundled (tsc) CLI builds
- Fixed test template to import game-specific Player class

## Task Commits

Each task was committed atomically:

1. **Task 1: Update project-scaffold.ts for standalone projects** - `32431ea` (feat)
2. **Task 2: Update init.ts template functions** - `86d71e4` (feat)
3. **Task 3: Verify init command end-to-end** - `2f11882` (fix - bundled CLI monorepo detection)

## Files Created/Modified
- `src/cli/lib/project-scaffold.ts` - Updated getMonorepoRoot(), getDependencyPaths(), generatePackageJson(), generateAppVue()
- `src/cli/commands/init.ts` - Updated all template generators to use boardsmith imports

## Decisions Made
- **Multi-candidate monorepo detection:** When CLI is bundled with esbuild, __dirname is at `dist/cli/` not `dist/cli/lib/`, so we try multiple parent path depths
- **Simplified package name:** Changed from `@mygames/${name}` to just `${name}` for standalone projects
- **npx boardsmith for scripts:** Instead of adding @boardsmith/cli as devDependency, scripts use `npx boardsmith`
- **Game-specific Player in tests:** Test template imports `${Pascal}Player` from game.js instead of generic Player

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed bundled CLI monorepo detection**
- **Found during:** Task 3 (End-to-end verification)
- **Issue:** When CLI is bundled with esbuild, all modules merge into single file at `dist/cli/cli.mjs`. The __dirname points to `dist/cli/` not `dist/cli/lib/`, so going up 3 levels overshoots the monorepo root.
- **Fix:** Added multi-candidate path checking: try 3 levels first (unbundled), then 2 levels (bundled)
- **Files modified:** src/cli/lib/project-scaffold.ts
- **Verification:** Bundled CLI correctly detects monorepo and generates file: link
- **Committed in:** 2f11882

---

**Total deviations:** 1 auto-fixed (blocking issue)
**Impact on plan:** Necessary for correct local development experience. No scope creep.

## Issues Encountered
None - plan tasks executed successfully after fixing the bundled CLI detection.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Init command ready for use with new standalone project structure
- Plan 02 (other CLI commands) can proceed
- May need similar monorepo detection fixes in other CLI commands

---
*Phase: 45-cli-update*
*Completed: 2026-01-18*
