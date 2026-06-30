---
phase: 75-engine-core
plan: 02
subsystem: engine
tags: [typescript, annotated-choice, disabled-selections, validation, path-checking, mcts-bot, tests]

# Dependency graph
requires:
  - phase: 75-01
    provides: AnnotatedChoice<T> type and disabled callbacks on selection interfaces/builders
provides:
  - getChoices() returns AnnotatedChoice<unknown>[] for choice, element, elements types
  - validateSelection() rejects disabled items with "Selection disabled: <reason>"
  - hasValidSelectionPath() only counts enabled items for required selections
  - Optional selections remain available when all items disabled
  - AI bot filters disabled choices and extracts .value
  - game.getSelectionChoices() returns AnnotatedChoice<unknown>[]
  - Comprehensive disabled behavior test coverage (10 new tests)
affects: [76 session wire (AnnotatedChoice in getSelectionChoices), 77 UI integration (disabled rendering), 78 documentation (breaking change)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "annotatedChoicesContain() for value comparison in annotated choice arrays"
    - "disabled check FIRST in validateSelection before containment check"
    - "filter to enabled choices before path checking in hasValidSelectionPath"
    - "AI bot filters disabled and extracts .value to preserve its existing contract"

key-files:
  created: []
  modified:
    - src/engine/action/action.ts
    - src/engine/action/action.test.ts
    - src/engine/element/game.ts
    - src/ai/mcts-bot.ts

key-decisions:
  - "Disabled check runs before containment check in validateSelection -- provides specific error message"
  - "AI bot preserves unknown[] contract by filtering disabled and extracting .value internally"
  - "hasValidSelectionPath filters to enabled choices for required selections, skips filtering for optional"

patterns-established:
  - "annotatedChoicesContain pattern: compare against .value in AnnotatedChoice arrays"
  - "disabled-first validation: check disabled before invalid to give better error messages"

# Metrics
duration: 7min
completed: 2026-02-06
---

# Phase 75 Plan 02: getChoices Returns AnnotatedChoice[], Validation, Path Checking, Tests Summary

**getChoices() annotated return type with disabled validation, path checking, AI bot integration, and 10 new disabled behavior tests**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-06T16:49:54Z
- **Completed:** 2026-02-06T16:57:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Changed `getChoices()` return type from `unknown[]` to `AnnotatedChoice<unknown>[]` for choice, element, and elements selection types
- Updated all internal callers (`trySmartResolveChoice`, `smartResolveChoiceValue`, `formatValidChoices`, `validateSelection`, `hasValidSelectionPath`, `traceSelectionPath`, `processRepeatingStep`) to use `.value` on annotated choices
- Added disabled-first validation: `validateSelection()` rejects disabled items with `"Selection disabled: <reason>"` before checking containment
- Updated `hasValidSelectionPath()` to filter to enabled choices for required selections, while optional selections remain available when all items disabled
- Updated AI bot (`mcts-bot.ts`) to filter disabled choices and extract `.value`, preserving existing `unknown[]` contract
- Updated `game.getSelectionChoices()` return type to `AnnotatedChoice<unknown>[]`
- Updated 6 existing test assertions to match new AnnotatedChoice return format
- Added 10 new tests covering all disabled behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1: Update getChoices() and all internal callers in ActionExecutor** - `0a4e95a` (feat)
2. **Task 2: Update existing tests and add disabled behavior tests** - `0c480b2` (test)

## Files Created/Modified
- `src/engine/action/action.ts` - getChoices returns AnnotatedChoice[], annotatedChoicesContain(), disabled-aware validateSelection, hasValidSelectionPath filters enabled, processRepeatingStep handles disabled
- `src/engine/action/action.test.ts` - Updated 6 assertions for AnnotatedChoice format, added 10 new disabled behavior tests
- `src/engine/element/game.ts` - getSelectionChoices return type changed to AnnotatedChoice<unknown>[]
- `src/ai/mcts-bot.ts` - getChoicesForSelection filters disabled and extracts .value

## Decisions Made
- Disabled check runs before containment check in `validateSelection()` so users get the specific "Selection disabled: <reason>" message rather than a generic "invalid selection" error
- AI bot preserves its existing `unknown[]` contract by filtering disabled choices and extracting `.value` internally -- callers of the bot are unaffected
- `hasValidSelectionPath()` filters to enabled choices for required selections but skips filtering for optional selections, allowing optional actions to remain available even when all items disabled

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 75 Engine Core is now complete -- all 6 engine requirements (ENG-01 through ENG-06) fulfilled
- `AnnotatedChoice<T>` type, builder API, getChoices annotation, validation, and path checking all working
- Ready for Phase 76 Session Wire to map engine AnnotatedChoice onto wire types (ValidElement, ChoiceWithRefs)
- Breaking change: `game.getSelectionChoices()` now returns `AnnotatedChoice<unknown>[]` -- Phase 78 documentation must cover this

---
*Phase: 75-engine-core*
*Completed: 2026-02-06*
