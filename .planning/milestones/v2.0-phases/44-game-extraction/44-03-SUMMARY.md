---
phase: 44-game-extraction
plan: 03
subsystem: games
tags: [checkers, extraction, standalone, vue, typescript]

# Dependency graph
requires:
  - phase: 44-01
    provides: Template files for standalone game extraction
provides:
  - Complete standalone Checkers game project at /private/tmp/boardsmith-test-target/checkers/
  - Unified src/ structure (rules/, ui/, main.ts)
  - All imports transformed to boardsmith package paths
affects: [44-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split game (rules/, ui/, tests/) normalized to unified src/ structure"
    - "Internal cross-references (@boardsmith/checkers-rules) become relative imports"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/checkers/package.json
    - /private/tmp/boardsmith-test-target/checkers/boardsmith.json
    - /private/tmp/boardsmith-test-target/checkers/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/checkers/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/checkers/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/checkers/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/checkers/src/rules/ai.ts
    - /private/tmp/boardsmith-test-target/checkers/src/rules/index.ts
    - /private/tmp/boardsmith-test-target/checkers/src/main.ts
    - /private/tmp/boardsmith-test-target/checkers/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/checkers/src/ui/components/CheckersBoard.vue
    - /private/tmp/boardsmith-test-target/checkers/src/ui/index.ts
    - /private/tmp/boardsmith-test-target/checkers/tests/game.test.ts
  modified: []

key-decisions:
  - "Normalized split structure (rules/, ui/, tests/) to unified src/ structure"
  - "Internal imports (@boardsmith/checkers-rules) converted to relative paths (../src/rules/index.js)"

patterns-established:
  - "Split-to-unified transformation pattern for game extraction"
  - "Test imports use relative paths to local rules (../src/rules/index.js)"

# Metrics
duration: 6min
completed: 2026-01-18
---

# Phase 44 Plan 03: Checkers Game Extraction Summary

**Checkers game extracted to standalone project with unified src/ structure and transformed boardsmith imports**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-18T20:37:00Z
- **Completed:** 2026-01-18T20:43:00Z
- **Tasks:** 3
- **Files created:** 18

## Accomplishments
- Created standalone Checkers project at /private/tmp/boardsmith-test-target/checkers/
- Normalized split structure (rules/, ui/, tests/) to unified src/ (src/rules/, src/ui/, tests/)
- Transformed all @boardsmith/* imports to boardsmith and boardsmith/* subpaths
- Initialized git repository with initial commit

## Task Commits

Tasks were executed outside the BoardSmith git repo (in /private/tmp/):

1. **Task 1: Create project structure** - Created directory structure and copied templates
2. **Task 2: Copy and transform source** - Copied all source files with import transformations
3. **Task 3: Initialize git** - `d866ccd` (Initial commit in checkers repo)

**Plan metadata:** (docs commit to follow)

_Note: Checkers project has its own git repo at /private/tmp/boardsmith-test-target/checkers/_

## Files Created

**Project Structure:**
- `/private/tmp/boardsmith-test-target/checkers/package.json` - Package config with boardsmith dependency
- `/private/tmp/boardsmith-test-target/checkers/boardsmith.json` - Game metadata
- `/private/tmp/boardsmith-test-target/checkers/index.html` - Entry HTML
- `/private/tmp/boardsmith-test-target/checkers/tsconfig.json` - TypeScript config
- `/private/tmp/boardsmith-test-target/checkers/vite.config.ts` - Vite build config
- `/private/tmp/boardsmith-test-target/checkers/vitest.config.ts` - Test config
- `/private/tmp/boardsmith-test-target/checkers/.gitignore` - Git ignores

**Rules (src/rules/):**
- `game.ts` - CheckersGame class with game logic
- `elements.ts` - Board, Square, CheckerPiece, CheckersPlayer classes
- `actions.ts` - Move and EndTurn action definitions
- `flow.ts` - Game flow with turn management
- `ai.ts` - AI objectives for MCTS
- `index.ts` - Package exports and game definition

**UI (src/ui/):**
- `App.vue` - Main app component with GameShell
- `components/CheckersBoard.vue` - Custom board component
- `index.ts` - UI exports

**Entry:**
- `src/main.ts` - App entry point

**Tests:**
- `tests/game.test.ts` - Game unit tests

## Import Transformations

| Original | Transformed |
|----------|-------------|
| `@boardsmith/engine` | `boardsmith` |
| `@boardsmith/session` | `boardsmith/session` |
| `@boardsmith/ui` | `boardsmith/ui` |
| `@boardsmith/ai` | `boardsmith/ai` |
| `@boardsmith/testing` | `boardsmith/testing` |
| `@boardsmith/checkers-rules` | `../src/rules/index.js` (in tests) |

## Decisions Made

1. **Split-to-unified structure** - Converted from rules/, ui/, tests/ directories to unified src/ with src/rules/, src/ui/, and tests/ at root
2. **Relative imports for tests** - Test file imports game classes via `../src/rules/index.js` instead of package alias

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Checkers game is ready as a standalone project. Remaining games can be extracted using the same pattern:
- Split games (hex, go-fish, cribbage, polyhedral-potions): Follow checkers pattern
- Unified games (floss-bitties): Simpler extraction, just import transforms
- Demos: Follow unified pattern

---
*Phase: 44-game-extraction*
*Completed: 2026-01-18*
