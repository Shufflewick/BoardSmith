---
phase: 44-game-extraction
plan: 08
subsystem: infra
tags: [game-extraction, npm, standalone, demo, animation]

# Dependency graph
requires:
  - phase: 44-01
    provides: Template files for standalone game extraction
provides:
  - Demo Animation extracted as standalone project
  - Import rewrites from @boardsmith/* to boardsmith/*
  - Standalone git repository at /private/tmp/boardsmith-test-target/demo-animation/
affects: [44-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified src/ structure preserved for demos"
    - "Import transformation: @boardsmith/engine -> boardsmith, @boardsmith/ui -> boardsmith/ui"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/demo-animation/package.json
    - /private/tmp/boardsmith-test-target/demo-animation/vitest.config.ts
    - /private/tmp/boardsmith-test-target/demo-animation/.gitignore
  modified:
    - /private/tmp/boardsmith-test-target/demo-animation/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/demo-animation/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/demo-animation/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/demo-animation/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/demo-animation/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/demo-animation/src/ui/components/GameBoard.vue
    - /private/tmp/boardsmith-test-target/demo-animation/tests/game.test.ts
    - /private/tmp/boardsmith-test-target/demo-animation/tsconfig.json

key-decisions:
  - "Unified structure already present - no reorganization needed"
  - "Tests included with vitest config (game.test.ts exists)"

patterns-established:
  - "Demos with unified src/ structure need only import rewrites"

# Metrics
duration: 2min
completed: 2026-01-19
---

# Phase 44 Plan 08: Demo Animation Extraction Summary

**Demo Animation extracted as standalone project with unified src/ structure and boardsmith imports**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-19T02:37:38Z
- **Completed:** 2026-01-19T02:39:38Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Copied Demo Animation to /private/tmp/boardsmith-test-target/demo-animation/
- Replaced package.json with template-based version (boardsmith dependency, npx scripts)
- Transformed all imports from @boardsmith/* to boardsmith/*
- Added vitest.config.ts and .gitignore from templates
- Initialized standalone git repository

## Task Commits

Tasks executed in /private/tmp/ (outside BoardSmith repo). Standalone repo created:

1. **Task 1: Copy Demo Animation project and update config** - (external: project setup)
2. **Task 2: Transform imports in source files** - (external: 10 files updated)
3. **Task 3: Initialize git repository** - `992c7de` (in standalone repo)

**Plan metadata:** (docs commit to follow in BoardSmith repo)

## Files Created/Modified

**Created:**
- `/private/tmp/boardsmith-test-target/demo-animation/package.json` - Standalone package with boardsmith dependency
- `/private/tmp/boardsmith-test-target/demo-animation/vitest.config.ts` - Vitest config for tests
- `/private/tmp/boardsmith-test-target/demo-animation/.gitignore` - Standard ignores

**Modified (import rewrites):**
- `src/rules/game.ts` - @boardsmith/engine -> boardsmith
- `src/rules/elements.ts` - @boardsmith/engine -> boardsmith
- `src/rules/actions.ts` - @boardsmith/engine -> boardsmith
- `src/rules/flow.ts` - @boardsmith/engine -> boardsmith
- `src/ui/App.vue` - @boardsmith/ui -> boardsmith/ui
- `src/ui/components/GameBoard.vue` - @boardsmith/ui -> boardsmith/ui, CSS import updated
- `tests/game.test.ts` - @boardsmith/testing -> boardsmith/testing, @boardsmith/engine -> boardsmith
- `tsconfig.json` - Added tests/**/* to include

## Decisions Made

1. **Unified structure already present** - Demo Animation already had src/rules, src/ui structure, no reorganization needed
2. **Tests included** - Added vitest.config.ts since tests/game.test.ts exists

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Copy command had errors on symlinks in node_modules, but directory was created successfully
- Removed node_modules/dist before proceeding, as planned

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Demo Animation is ready as standalone project. Next extractions (44-09) can proceed.

Verification checklist:
- [x] Demo Animation project exists
- [x] Unified src/ structure preserved
- [x] No @boardsmith/* imports remain
- [x] Git repository initialized

---
*Phase: 44-game-extraction*
*Completed: 2026-01-19*
