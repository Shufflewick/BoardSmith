---
phase: 44-game-extraction
plan: 01
subsystem: infra
tags: [templates, npm, vite, vitest, vue]

# Dependency graph
requires:
  - phase: 43-import-rewrite
    provides: boardsmith package with subpath exports
provides:
  - Template files for standalone game extraction
  - package.json with boardsmith dependency (not @boardsmith/*)
  - Standard build tooling configuration (vite, vitest, typescript)
affects: [44-02, 44-03, 44-04, 44-05, 44-06, 44-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified package dependency: boardsmith (not @boardsmith/*)"
    - "CLI via npx: npx boardsmith dev/build/validate"
    - "Placeholder tokens: {GAME_NAME}, {DISPLAY_NAME}"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/templates/package.json
    - /private/tmp/boardsmith-test-target/templates/tsconfig.json
    - /private/tmp/boardsmith-test-target/templates/vite.config.ts
    - /private/tmp/boardsmith-test-target/templates/vitest.config.ts
    - /private/tmp/boardsmith-test-target/templates/index.html
    - /private/tmp/boardsmith-test-target/templates/.gitignore
  modified: []

key-decisions:
  - "Templates in /private/tmp/boardsmith-test-target/ for isolated testing"
  - "file:../../BoardSmith for local development, npm version for production"
  - "{GAME_NAME} and {DISPLAY_NAME} placeholders for per-game customization"

patterns-established:
  - "All extracted games use identical base configuration"
  - "boardsmith as single dependency (not @boardsmith/* packages)"
  - "npx boardsmith for CLI commands (CLI not a dependency)"

# Metrics
duration: 3min
completed: 2026-01-18
---

# Phase 44 Plan 01: Game Extraction Templates Summary

**Reusable template files for extracted games with boardsmith dependency and npx CLI commands**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-18T20:34:00Z
- **Completed:** 2026-01-18T20:37:00Z
- **Tasks:** 3
- **Files created:** 6

## Accomplishments
- Created templates directory structure at /private/tmp/boardsmith-test-target/templates/
- package.json template with boardsmith (not @boardsmith/*) and npx commands
- Build configuration templates (vite, vitest, tsconfig) matching boardsmith init output
- index.html and .gitignore for complete standalone project scaffolding

## Task Commits

Templates are created in /private/tmp/ (outside git repo) for isolated testing. No task commits needed for external files.

**Plan metadata:** (docs commit to follow)

## Files Created

- `/private/tmp/boardsmith-test-target/templates/package.json` - Base package.json with boardsmith dependency and npx scripts
- `/private/tmp/boardsmith-test-target/templates/tsconfig.json` - TypeScript config for standalone game (ES2022, bundler resolution)
- `/private/tmp/boardsmith-test-target/templates/vite.config.ts` - Vite build config with Vue plugin
- `/private/tmp/boardsmith-test-target/templates/vitest.config.ts` - Vitest config with Vue plugin and globals
- `/private/tmp/boardsmith-test-target/templates/index.html` - Entry HTML with {DISPLAY_NAME} placeholder
- `/private/tmp/boardsmith-test-target/templates/.gitignore` - Standard ignores (node_modules, dist, logs)

## Decisions Made

1. **Templates in /private/tmp/** - Isolated from BoardSmith repo for clean testing of extraction workflow
2. **file:../../BoardSmith dependency** - Local development testing; production uses npm version
3. **Placeholder tokens** - {GAME_NAME} for package name, {DISPLAY_NAME} for HTML title

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Templates are ready for use by game extraction plans (44-02 through 44-07). Each plan will:
1. Copy templates to game directory
2. Replace {GAME_NAME} and {DISPLAY_NAME} placeholders
3. Copy game source files
4. Rewrite imports from @boardsmith/* to boardsmith/*

---
*Phase: 44-game-extraction*
*Completed: 2026-01-18*
