---
phase: 44-game-extraction
plan: 05
subsystem: games
tags: [go-fish, card-game, extraction, vue, ai]

# Dependency graph
requires:
  - phase: 44-01
    provides: Template files for standalone game extraction
provides:
  - Go Fish game as standalone project
  - Unified src/rules and src/ui structure
  - AI evaluation functions (objectives, threat response, playout policy)
  - Custom Vue UI with card animations
affects: [44-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified src/ structure for extracted games"
    - "Import transformation: @boardsmith/* -> boardsmith/*"
    - "E2E test not included (requires running server)"

key-files:
  created:
    - /private/tmp/boardsmith-test-target/go-fish/src/rules/game.ts
    - /private/tmp/boardsmith-test-target/go-fish/src/rules/elements.ts
    - /private/tmp/boardsmith-test-target/go-fish/src/rules/actions.ts
    - /private/tmp/boardsmith-test-target/go-fish/src/rules/flow.ts
    - /private/tmp/boardsmith-test-target/go-fish/src/rules/ai.ts
    - /private/tmp/boardsmith-test-target/go-fish/src/ui/App.vue
    - /private/tmp/boardsmith-test-target/go-fish/src/ui/components/GoFishBoard.vue
    - /private/tmp/boardsmith-test-target/go-fish/tests/game.test.ts
    - /private/tmp/boardsmith-test-target/go-fish/tests/complete-game.test.ts
  modified: []

key-decisions:
  - "E2E tests excluded - require running server infrastructure"
  - "Split structure normalized to unified src/ structure"
  - "AI functions transformed to use boardsmith/ai subpath"

patterns-established:
  - "Card game extraction pattern: rules with AI evaluation functions"
  - "Custom UI with animation support (flyToPlayerStat, useAutoAnimations)"

# Metrics
duration: 7min
completed: 2026-01-19
---

# Phase 44 Plan 05: Go Fish Game Extraction Summary

**Go Fish card game extracted as standalone project with AI evaluation, custom Vue UI with animations, and unified src/ structure**

## Performance

- **Duration:** 7 min
- **Started:** 2026-01-19T02:37:38Z
- **Completed:** 2026-01-19T02:44:46Z
- **Tasks:** 3
- **Files created:** 19

## Accomplishments

- Extracted Go Fish from split structure (rules/, ui/, tests/) to unified src/ structure
- Transformed all imports from @boardsmith/* to boardsmith/* subpaths
- Preserved AI evaluation functions including objectives, threat response, playout policy
- Custom Vue UI with card animation support (FlyingCardsOverlay, flyToPlayerStat)
- Initialized standalone git repository

## Task Commits

Tasks create files in /private/tmp/ (outside BoardSmith repo), so no task-level commits in the main repo.

**Go Fish repo initial commit:** `d80cc84` - "Initial commit: Go Fish game extracted from BoardSmith monorepo"

## Files Created

**Project root:**
- `package.json` - npm package with boardsmith dependency
- `boardsmith.json` - Game configuration (2-4 players, card-game category)
- `index.html` - Entry HTML with "Go Fish" title
- `tsconfig.json` - TypeScript config (ES2022, bundler resolution)
- `vite.config.ts` - Vite with Vue plugin
- `vitest.config.ts` - Vitest config
- `.gitignore` - Standard ignores

**src/rules/:**
- `game.ts` - GoFishGame class (247 lines) - deck creation, dealing, book formation
- `elements.ts` - Card, Hand, Pond, Books, GoFishPlayer classes
- `actions.ts` - createAskAction with target/rank selection
- `flow.ts` - Turn loop with extra turn handling
- `ai.ts` - 8 objectives, threat response, playout policy, move ordering, UCT constant
- `index.ts` - Exports and gameDefinition

**src/ui/:**
- `App.vue` - GameShell with Custom UI and AutoUI comparison view
- `components/GoFishBoard.vue` - Custom board with card animations
- `index.ts` - UI exports

**tests/:**
- `game.test.ts` - Unit tests for game setup, helper methods, book formation
- `complete-game.test.ts` - Integration tests for full game playthrough

## Decisions Made

1. **E2E tests excluded** - The e2e-game.test.ts requires Playwright and running server infrastructure, not suitable for standalone extraction
2. **Split to unified structure** - Normalized from rules/src/, ui/src/, tests/ to src/rules/, src/ui/, tests/
3. **AI subpath import** - AI types from boardsmith/ai (Objective, BotMove, ThreatResponse)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Go Fish extraction complete. The game:
- Has unified src/ structure matching boardsmith init output
- Imports from boardsmith and boardsmith/* subpaths
- Has comprehensive AI evaluation (objectives, threat response, playout policy)
- Has custom Vue UI with card animations
- Has unit and integration tests (excluding E2E)
- Is an independent git repository

Ready for:
- Plan 44-06 (Cribbage extraction)
- Plan 44-07 (Verification phase)

---
*Phase: 44-game-extraction*
*Completed: 2026-01-19*
