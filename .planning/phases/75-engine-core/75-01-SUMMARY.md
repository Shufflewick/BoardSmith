---
phase: 75-engine-core
plan: 01
subsystem: engine
tags: [typescript, action-builder, disabled-selections, annotated-choice]

# Dependency graph
requires:
  - phase: none
    provides: first plan in v2.8 feature
provides:
  - AnnotatedChoice<T> type for annotating choices with disabled status
  - disabled callback on ChoiceSelection, ElementSelection, ElementsSelection interfaces
  - disabled option on chooseFrom, chooseElement, fromElements builder methods
affects: [75-02 getChoices annotation, 76 session wire, 77 UI integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "disabled callback returns string | false (no bare true, forces reason string)"
    - "filter = visibility, disabled = selectability separation"

key-files:
  created: []
  modified:
    - src/engine/action/types.ts
    - src/engine/action/action-builder.ts
    - src/engine/action/index.ts
    - src/engine/index.ts

key-decisions:
  - "AnnotatedChoice<T> has { value: T, disabled: string | false } -- no bare true, forces reason string"
  - "disabled callback added after existing fields on each interface (non-breaking, optional)"

patterns-established:
  - "disabled returns string | false pattern: forces UX reason for every disabled state"

# Metrics
duration: 2min
completed: 2026-02-06
---

# Phase 75 Plan 01: Add AnnotatedChoice Type and Builder API Summary

**AnnotatedChoice<T> type with disabled callbacks on all three selection interfaces and builder methods**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-06T16:45:36Z
- **Completed:** 2026-02-06T16:48:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `AnnotatedChoice<T>` type with `{ value: T, disabled: string | false }` for annotating choices
- Added `disabled` callback to all three selection interfaces (ChoiceSelection, ElementSelection, ElementsSelection)
- Threaded `disabled` option through all three builder methods (chooseFrom, chooseElement, fromElements)
- Exported `AnnotatedChoice` from both `action/index.ts` and `engine/index.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add AnnotatedChoice type and disabled to selection interfaces** - `e5b93cb` (feat)
2. **Task 2: Add disabled option to builder methods** - `5ec7390` (feat)

## Files Created/Modified
- `src/engine/action/types.ts` - Added AnnotatedChoice type, disabled callback on ChoiceSelection, ElementSelection, ElementsSelection
- `src/engine/action/action-builder.ts` - Added disabled option to chooseFrom, chooseElement, fromElements builder methods
- `src/engine/action/index.ts` - Added AnnotatedChoice to type exports
- `src/engine/index.ts` - Added AnnotatedChoice to engine-level type exports

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AnnotatedChoice type and disabled callbacks ready for Plan 02 to implement getChoices annotation, validation, and path checking
- All changes are additive (optional fields) so no existing code was affected
- Ready for 75-02-PLAN.md

---
*Phase: 75-engine-core*
*Completed: 2026-02-06*
