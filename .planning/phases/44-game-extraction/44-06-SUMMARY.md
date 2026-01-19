---
phase: 44-game-extraction
plan: 06
subsystem: games
tags: [polyhedral-potions, game-extraction, vue, typescript]

# Dependency graph
requires:
  - phase: 44-01
    provides: Template files for standalone game extraction
provides:
  - Polyhedral Potions game as standalone project
  - Unified src/ structure (rules/, ui/)
  - Imports using boardsmith (not @boardsmith/*)
affects: [44-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified game structure: src/rules/, src/ui/, tests/"
    - "Import transformation: @boardsmith/* -> boardsmith/*"
    - "Local rules reference: ../../rules/index.js"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/polyhedral-potions/package.json
    - /private/tmp/boardsmith-test-target/polyhedral-potions/boardsmith.json
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/rules/index.ts
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/ui/components/GameBoard.vue
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/ui/components/ScoreSheet.vue
    - /private/tmp/boardsmith-test-target/polyhedral-potions/src/ui/components/DiceShelf.vue
    - /private/tmp/boardsmith-test-target/polyhedral-potions/tests/game.test.ts
  modified: []

key-decisions:
  - "Consolidated split structure (rules/, ui/, tests/) into unified src/"
  - "ScoreSheet imports rules from local ../../rules/index.js"

patterns-established:
  - "Split-structure games need consolidation during extraction"
  - "UI components reference local rules via relative imports"

# Metrics
duration: 9min
completed: 2026-01-18
---

# Phase 44 Plan 06: Polyhedral Potions Extraction Summary

**Polyhedral Potions dice-crafting game extracted as standalone project with unified src/ structure and boardsmith imports**

## Performance

- **Duration:** 9 min
- **Started:** 2026-01-19T02:37:39Z
- **Completed:** 2026-01-19T02:46:36Z
- **Tasks:** 3
- **Files created:** 19

## Accomplishments

- Created complete standalone Polyhedral Potions project at /private/tmp/boardsmith-test-target/polyhedral-potions/
- Consolidated split rules/ui/tests structure into unified src/ layout
- Transformed all imports from @boardsmith/* to boardsmith and boardsmith/* subpaths
- Initialized git repository with initial commit

## Task Commits

Tasks created files in /private/tmp/ (outside main git repo). Game repository initialized:

1. **Task 1: Create project structure and copy templates** - Project skeleton with templates
2. **Task 2: Copy and transform source files** - All 19 source files with transformed imports
3. **Task 3: Initialize git repository** - `ce282cb` (Initial commit)

**Plan metadata:** (docs commit to follow in main repo)

## Files Created

**Configuration:**
- `/private/tmp/boardsmith-test-target/polyhedral-potions/package.json` - Standalone npm package with boardsmith dependency
- `/private/tmp/boardsmith-test-target/polyhedral-potions/boardsmith.json` - Game metadata (1-4 players, 20-40 min)
- `/private/tmp/boardsmith-test-target/polyhedral-potions/index.html` - Entry HTML with Polyhedral Potions title
- `/private/tmp/boardsmith-test-target/polyhedral-potions/tsconfig.json` - TypeScript config (ES2022, bundler)
- `/private/tmp/boardsmith-test-target/polyhedral-potions/vite.config.ts` - Vite build config with Vue plugin
- `/private/tmp/boardsmith-test-target/polyhedral-potions/vitest.config.ts` - Vitest config with globals

**Rules (src/rules/):**
- `game.ts` - PolyPotionsGame class with dice drafting mechanics
- `elements.ts` - IngredientDie, IngredientShelf, DraftArea, PolyPotionsPlayer
- `actions.ts` - Draft, Craft, Record actions plus ability actions (Reroll, Flip, Refresh)
- `flow.ts` - Game flow with Rule of Three support
- `index.ts` - Public exports and gameDefinition

**UI (src/ui/):**
- `App.vue` - GameShell integration with player stats display
- `components/GameBoard.vue` - Main game board with phase panels
- `components/DiceShelf.vue` - 3D dice display with drafting and abilities
- `components/ScoreSheet.vue` - Full score tracking (ingredients, potions, tracks, poisons)
- `index.ts` - UI component exports

**Tests:**
- `tests/game.test.ts` - Game setup, mechanics, scoring, and debug utility tests

## Decisions Made

1. **Consolidated split structure** - Original game had separate rules/, ui/, and tests/ directories; consolidated into unified src/rules/, src/ui/, tests/ structure
2. **ScoreSheet local rules import** - ScoreSheet component imports game constants from `../../rules/index.js` instead of package path

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Polyhedral Potions successfully extracted as standalone project
- Ready for 44-07 (final game extraction plan)
- Pattern established for handling split-structure games

---
*Phase: 44-game-extraction*
*Completed: 2026-01-18*
