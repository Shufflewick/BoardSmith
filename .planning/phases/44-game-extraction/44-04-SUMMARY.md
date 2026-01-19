---
phase: 44-game-extraction
plan: 04
subsystem: games
tags: [cribbage, extraction, card-game, vue]

dependency-graph:
  requires: [44-01]
  provides: [standalone-cribbage-game, extraction-pattern-demo]
  affects: [44-05, 44-06, 44-07]

tech-stack:
  added: []
  patterns: [unified-src-structure, boardsmith-subpath-imports]

key-files:
  created:
    - /private/tmp/boardsmith-test-target/cribbage/package.json
    - /private/tmp/boardsmith-test-target/cribbage/boardsmith.json
    - /private/tmp/boardsmith-test-target/cribbage/index.html
    - /private/tmp/boardsmith-test-target/cribbage/src/main.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/scoring.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/ai.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/rules/index.ts
    - /private/tmp/boardsmith-test-target/cribbage/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/cribbage/src/ui/components/CribbageBoard.vue
    - /private/tmp/boardsmith-test-target/cribbage/src/ui/components/ScoringOverlay.vue
    - /private/tmp/boardsmith-test-target/cribbage/src/ui/components/RoundSummary.vue
    - /private/tmp/boardsmith-test-target/cribbage/tests/game.test.ts
    - /private/tmp/boardsmith-test-target/EXTRACTION-GUIDE.md
  modified: []

decisions:
  - id: unified-structure
    choice: "Consolidate rules/, ui/, tests/ into unified src/ + tests/"
    rationale: "Simpler project structure for standalone games"
    alternatives: ["Keep split structure"]
  - id: import-transformation
    choice: "Transform @boardsmith/* to boardsmith subpath imports"
    rationale: "Public npm package uses subpath exports"
    pattern: "@boardsmith/engine -> boardsmith, @boardsmith/ui -> boardsmith/ui"

metrics:
  duration: "15 minutes"
  completed: 2026-01-19
---

# Phase 44 Plan 04: Cribbage Extraction Summary

Cribbage game extracted to standalone repository with unified src/ structure.

## What Was Done

### Task 1: Create Cribbage project structure and copy templates

Created the complete project skeleton:
- `cribbage/` directory with subdirectories (src/rules, src/ui/components, tests, public)
- Customized `package.json` with boardsmith dependency (`file:../../BoardSmith` for local dev)
- Customized `index.html` with "Cribbage" title
- `boardsmith.json` with game metadata (2 players, 20-40 min, complexity 3)
- Template files: tsconfig.json, vite.config.ts, vitest.config.ts, .gitignore

### Task 2: Copy and transform source files

**Rules files (7 files):**
- `game.ts` - CribbageGame class with full game logic
- `elements.ts` - Card, Hand, Crib, Deck, PlayArea, StarterArea, CribbagePlayer
- `actions.ts` - discard, playCard, sayGo, acknowledgeScore actions
- `flow.ts` - Complete game flow (dealing, discarding, play, scoring phases)
- `scoring.ts` - Cribbage scoring logic (fifteens, pairs, runs, flush, nobs, pegging)
- `ai.ts` - AI objectives for MCTS bot
- `index.ts` - Exports and gameDefinition

**UI files (4 files):**
- `App.vue` - Root component with GameShell
- `components/CribbageBoard.vue` - Main game board with card animations
- `components/ScoringOverlay.vue` - Animated scoring reveal
- `components/RoundSummary.vue` - End-of-round score summary

**Test files (1 file):**
- `tests/game.test.ts` - Complete test suite for game mechanics

**Import transformations applied:**
- `@boardsmith/engine` -> `boardsmith`
- `@boardsmith/ui` -> `boardsmith/ui`
- `@boardsmith/ai` -> `boardsmith/ai`
- `@boardsmith/testing` -> `boardsmith/testing`
- `@boardsmith/cribbage-rules` -> `../src/rules/index.js` (relative paths)

### Task 3: Initialize git repository

Created standalone git repository with initial commit (dd7bdb0).

### Documentation

Created `/private/tmp/boardsmith-test-target/EXTRACTION-GUIDE.md` documenting:
- Import transformation rules
- Project structure conventions
- Required dependencies
- Extraction checklist
- Common pitfalls

## Verification Results

- [x] Cribbage project exists at /private/tmp/boardsmith-test-target/cribbage/
- [x] Unified src/ structure (rules + ui in src/, tests in tests/)
- [x] No @boardsmith/* imports remain (verified with grep)
- [x] Git repository initialized with initial commit

## Statistics

- **Total files created:** 20
- **Total lines of code:** 5,493
- **Rules files:** 7 TypeScript modules (~2,400 lines)
- **UI files:** 4 Vue components (~2,600 lines)
- **Test files:** 1 test suite (~460 lines)

## Deviations from Plan

None - plan executed exactly as written.

## Next Steps

- **44-05:** Extract tic-tac-toe (simplest game, baseline validation)
- **44-06:** Extract another card game to verify pattern consistency
- **44-07:** Document final extraction guide with lessons learned
