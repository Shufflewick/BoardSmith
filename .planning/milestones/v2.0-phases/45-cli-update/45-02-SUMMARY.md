---
phase: 45-cli-update
plan: 02
subsystem: cli
tags: [cli, dev, build, pack, context-detection, standalone-projects]

# Dependency graph
requires:
  - phase: 45-01
    provides: Updated init command with boardsmith imports
  - phase: 42-exports
    provides: boardsmith subpath exports configuration
provides:
  - Context-aware dev command (monorepo vs standalone detection)
  - Build command with correct boardsmith externals
  - Pack command for single-package structure
  - Clean CLI help text (no @boardsmith/* references)
affects: [46-docs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Context detection via src/engine/ presence (monorepo) vs boardsmith.json (standalone)
    - Conditional plugin loading based on project context

key-files:
  created: []
  modified:
    - src/cli/commands/dev.ts
    - src/cli/commands/build.ts
    - src/cli/commands/pack.ts

key-decisions:
  - "Context detection pattern: src/engine/ indicates monorepo, boardsmith.json indicates standalone"
  - "dev.ts noop plugin for standalone: Let node_modules resolution work naturally"
  - "build.ts monorepo rejection: Build command is for games only, not library"
  - "pack.ts single package: Only pack root boardsmith package after collapse"

patterns-established:
  - "getProjectContext(): Reusable function for monorepo/standalone detection across CLI commands"
  - "Plugin context awareness: Plugins check context before intercepting imports"

# Metrics
duration: 9min
completed: 2026-01-18
---

# Phase 45 Plan 02: CLI Commands Update Summary

**Context-aware CLI commands that detect monorepo vs standalone, with clean boardsmith imports and proper error messages**

## Performance

- **Duration:** 9 min
- **Started:** 2026-01-19T05:09:28Z
- **Completed:** 2026-01-19T05:18:44Z
- **Tasks:** 4
- **Files modified:** 3

## Accomplishments
- dev.ts detects context and only applies monorepo resolution plugins when needed
- build.ts validates context (games only) and uses boardsmith as external
- pack.ts works with single-package structure, clear error for standalone projects
- All CLI help text clean of @boardsmith/* references (CLI-06)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update dev.ts with context detection** - `b0f0f62` (feat)
2. **Task 2: Update build.ts for standalone projects** - `6e64c6b` (feat)
3. **Task 3: Update pack.ts for new single-package structure** - `56b8c49` (feat)
4. **Task 4: Test all commands and verify help text** - verification only, no code changes

## Files Created/Modified
- `src/cli/commands/dev.ts` - Added getProjectContext(), context-aware plugins, optimizeDeps config
- `src/cli/commands/build.ts` - Added context detection, monorepo rejection, boardsmith externals
- `src/cli/commands/pack.ts` - Simplified to single package, context detection, standalone rejection

## Decisions Made
- **Context detection via src/engine/**: Monorepo has src/engine/, standalone has boardsmith.json but no src/engine/
- **Noop plugin for standalone dev**: Instead of intercepting imports, let Vite resolve from node_modules naturally
- **Build command is games-only**: Clear error when run in monorepo context guides users to appropriate tooling
- **Pack packs single package**: After monorepo collapse, there's only one boardsmith package at root

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **CLI build process**: Discovered the CLI is bundled with esbuild, not tsc. Used `npx esbuild src/cli/cli.ts --bundle` to rebuild after changes.
- **cliMonorepoRoot path adjustment**: Changed from 4 levels up to 2 levels up since CLI is now at dist/cli/ instead of packages/cli/dist/commands/

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All CLI commands now work correctly in both monorepo and standalone contexts
- Phase 46 (docs) can proceed
- CLI is ready for use with extracted standalone game projects

---
*Phase: 45-cli-update*
*Completed: 2026-01-18*
