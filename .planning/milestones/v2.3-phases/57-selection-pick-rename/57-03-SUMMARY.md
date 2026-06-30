---
phase: 57-selection-pick-rename
plan: 03
subsystem: games
tags: [refactor, rename, games, ui, pick-terminology]

# Dependency graph
requires:
  - phase: 57-01
    provides: Pick types and deprecation aliases in engine/session
  - phase: 57-02
    provides: Pick types and currentPick API in UI layer
provides:
  - All 9 extracted games use currentPick instead of currentSelection
  - pickStep terminology in game UIs
  - pickStepDescriptions for action step guidance
affects: [57-04, 57-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - currentPick for action controller pick state
    - pickStepDescriptions for multi-step action guidance

key-files:
  created: []
  modified:
    - packages/games/go-fish/ui/src/components/GoFishBoard.vue
    - packages/games/demoAnimation/src/ui/components/GameTable.vue
    - packages/games/demoComplexUiInteractions/src/ui/components/GameTable.vue
    - packages/games/demoComplexUiInteractions/src/ui/App.vue
    - packages/games/demoComplexUiInteractions/src/rules/actions.ts

key-decisions:
  - "Plan scope refined: Only 5 files needed changes, not all 9 games"
  - "General 'selection' in comments preserved (e.g., 'weighted random selection')"
  - "AI files unchanged - they use general English, not BoardSmith API"

patterns-established:
  - "currentPick/currentPickName for action controller pick state"
  - "pickStepDescriptions for multi-step action step guidance"

# Metrics
duration: 5min
completed: 2026-01-22
---

# Phase 57 Plan 03: Extracted Games Pick Terminology Summary

**Updated 5 game files to use pick terminology (currentPick, currentPickName, pickStep), eliminating all currentSelection API usage from packages/games/**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-22T18:52:07Z
- **Completed:** 2026-01-22T18:57:34Z
- **Tasks:** 3 (2 with changes, 1 verification-only)
- **Files modified:** 5

## Accomplishments

- Updated GoFishBoard.vue to use currentPick, currentPickStep
- Updated demoAnimation GameTable.vue to use currentPick
- Updated demoComplexUiInteractions GameTable.vue with full pick terminology
- Updated comments in App.vue and actions.ts for consistency
- Verified all 455 src/ tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Update game UI components** - `3c3d9ef` (refactor)
2. **Task 2: Update demo games and rules files** - `3a72856` (refactor)
3. **Task 3: Update AI files and verify all games** - No commit (verification-only task)

## Files Created/Modified

- `packages/games/go-fish/ui/src/components/GoFishBoard.vue` - currentSelection -> currentPick, currentSelectionStep -> currentPickStep
- `packages/games/demoAnimation/src/ui/components/GameTable.vue` - currentSelection -> currentPick
- `packages/games/demoComplexUiInteractions/src/ui/components/GameTable.vue` - Full pick terminology update
- `packages/games/demoComplexUiInteractions/src/ui/App.vue` - Comment updated
- `packages/games/demoComplexUiInteractions/src/rules/actions.ts` - JSDoc comments updated

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Plan scope refined: 5 files, not 17 | Checkers, Cribbage, Polyhedral Potions, Hex, demoActionPanel only had "selection" in comments/function names unrelated to the API |
| General "selection" preserved | Words like "weighted random selection" are English, not BoardSmith API |
| AI files unchanged | go-fish/ai.ts and hex/ai.ts use "selection" in algorithm context only |

## Deviations from Plan

### Scope Refinement

**1. [Rule 2 - Missing Critical] Plan over-scoped the work**
- **Found during:** Task 1 research phase
- **Issue:** Plan listed 17 files, but most only had general English "selection" usage
- **Fix:** Only updated 5 files that actually used `currentSelection` API
- **Impact:** Reduced scope appropriately; no false changes to unrelated comments

## Issues Encountered

None - the scope refinement was straightforward once I identified which files actually used the API.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All packages/games/ files now use pick terminology for the API
- Ready for Phase 57-04 (documentation updates) and 57-05 (templates)
- Deprecated aliases from Plan 01/02 ensure backward compatibility for any external consumers

---
*Phase: 57-selection-pick-rename*
*Completed: 2026-01-22*
