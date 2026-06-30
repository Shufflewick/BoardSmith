---
phase: 76-session-wire
plan: 01
subsystem: session
tags: [typescript, wire-types, pick-handler, disabled-selections, sparse-representation]

# Dependency graph
requires:
  - phase: 75-engine-core
    provides: AnnotatedChoice<T> type, disabled callbacks on ChoiceSelection/ElementSelection/ElementsSelection
provides:
  - ValidElement and ChoiceWithRefs wire types with disabled?: string field
  - PickHandler.getPickChoices() threads disabled callback results onto wire output
  - Sparse wire representation (disabled field absent on enabled items)
affects: [77 UI integration (disabled rendering from wire types), 78 documentation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sparse disabled on wire: only set disabled field when callback returns truthy string"
    - "Direct callback invocation in PickHandler (no delegation to executor.getChoices())"

key-files:
  created:
    - src/session/pick-handler.test.ts
  modified:
    - src/session/types.ts
    - src/types/protocol.ts
    - src/session/pick-handler.ts

key-decisions:
  - "Sparse wire representation: disabled field absent (not undefined) on enabled items for clean JSON"
  - "Disabled callback invoked with rawValue in choice case to match engine dual-shape behavior"

patterns-established:
  - "Wire disabled pattern: disabled?: string (optional, absent when selectable) vs engine disabled: string | false (always present)"

# Metrics
duration: 3min
completed: 2026-02-06
---

# Phase 76 Plan 01: Wire Types and PickHandler Disabled Threading Summary

**disabled?: string on ValidElement/ChoiceWithRefs wire types with PickHandler callback evaluation for choice, element, and elements selection types**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-06T17:12:14Z
- **Completed:** 2026-02-06T17:16:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `disabled?: string` to `ValidElement` and `ChoiceWithRefs` in both `src/session/types.ts` and `src/types/protocol.ts` (identical interface shapes)
- Threaded disabled callback evaluation in PickHandler's choice case using `rawValue` (correct for dual-shape choices from playerChoices)
- Threaded disabled callback evaluation in PickHandler's `#buildValidElementsList` (covers both element and elements selection types)
- Created comprehensive test suite with 6 tests covering choice disabled, element disabled, sparse representation, no-callback baseline, and multi-select elements
- Full test suite (520 tests) passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add disabled field to wire types and thread in PickHandler** - `74910aa` (feat)
2. **Task 2: Add PickHandler disabled threading tests** - `ed7a371` (test)

## Files Created/Modified
- `src/session/types.ts` - Added `disabled?: string` to ValidElement and ChoiceWithRefs interfaces
- `src/types/protocol.ts` - Added `disabled?: string` to ValidElement and ChoiceWithRefs interfaces (mirror)
- `src/session/pick-handler.ts` - Disabled callback evaluation in choice case and #buildValidElementsList
- `src/session/pick-handler.test.ts` - 6 tests for disabled threading through PickHandler wire output

## Decisions Made
- Sparse wire representation: disabled field is absent (not `undefined` or `false`) on enabled items, ensuring clean JSON serialization with no noise
- Disabled callback receives `rawValue` in choice case, matching engine behavior where the callback gets whatever `choices` returns (may be plain value or `{ value, display }` object)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 76 Session Wire is now complete -- all 3 session requirements (SES-01, SES-02, SES-03) fulfilled
- Wire types carry disabled status through the session boundary
- Ready for Phase 77 UI Integration to consume disabled field from wire types for rendering

---
*Phase: 76-session-wire*
*Completed: 2026-02-06*
