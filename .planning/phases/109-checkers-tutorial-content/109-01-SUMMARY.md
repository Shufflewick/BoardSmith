---
phase: 109-checkers-tutorial-content
plan: 01
subsystem: engine
tags: [tutorial, gate, selection, TypeScript]

# Dependency graph
requires:
  - phase: 106-predicate-helpers
    provides: TutorialGate infrastructure, getGateReasonForValue, getActiveStep
  - phase: 104-tutorial-lifecycle
    provides: TutorialGateAllowList type, TutorialStep, action gating substrate
provides:
  - SelectionMatcher type (Record<string, unknown>) exported from engine public surface
  - TutorialGateAllowList.selections map (keyed by selection name) replacing reserved from/to
  - selectionMatchesValue helper with ElementRef-style id>notation>name precedence
  - getGateReasonForValue extended to 4 params (selectionName: string)
  - Per-selection gating through all 3 action.ts call sites (choice, element, elements)
affects:
  - 109-02 (tutorial launch surface uses this gate substrate)
  - 109-03 (checkers tutorial content uses per-selection gate for piece+destination)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - SelectionMatcher field equality: id > notation > name precedence for element selections, all-fields for choice objects
    - Per-selection gate: selections map keyed by selection.name; unlisted selection names permit all values (back-compat)
    - TDD gate: RED commit (test), GREEN commit (feat) sequence followed

key-files:
  created: []
  modified:
    - src/engine/tutorial/types.ts
    - src/engine/tutorial/gate.ts
    - src/engine/tutorial/gate.test.ts
    - src/engine/action/action.ts
    - src/engine/action/tutorial-gate.test.ts
    - src/engine/index.ts

key-decisions:
  - "Removed reserved from/to fields from TutorialGateAllowList; replaced with selections map — no deprecation cycle per project hard-rule"
  - "selectionMatchesValue uses ElementRef precedence (id>notation>name) then falls back to all-field equality for choice objects like DestinationChoice"
  - "tutorial-gate.test.ts migrated from string choices to object choices for the per-selection describe block; action-level tests kept with string choices and no selections gate"

patterns-established:
  - "Per-selection gate pattern: gate: { action: 'move', selections: { piece: { id: N }, destination: { toNotation: 'X' } } }"
  - "SelectionMatcher resolution order: id wins, then notation, then name, then general field equality"

requirements-completed: [CHK-01]

# Metrics
duration: 7min
completed: 2026-06-28
---

# Phase 109 Plan 01: Per-selection tutorial gate (LR-02 substrate) Summary

**SelectionMatcher type + per-selection getGateReasonForValue: gate piece-by-id and destination-by-toNotation independently within a two-step action**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-28T21:06:28Z
- **Completed:** 2026-06-29T02:13:11Z
- **Tasks:** 2 (Task 1 TDD: types + gate + unit tests; Task 2: action call sites + pipeline tests)
- **Files modified:** 6

## Accomplishments
- `SelectionMatcher = Record<string, unknown>` exported from `src/engine/index.ts`; replaces the reserved `from`/`to` fields on `TutorialGateAllowList` with a `selections?: Record<string, SelectionMatcher>` map
- `selectionMatchesValue` private helper implements ElementRef-style id > notation > name precedence for element values; falls back to full field-equality for choice objects (e.g., `{ toNotation: 'd4', pieceId: 1 }`)
- `getGateReasonForValue` extended with `selectionName: string` 4th param; new per-selection branch gates only the matcher for the named selection; unlisted selection names permit all values (back-compatible)
- All 3 `getGateReasonForValue` call sites in `action.ts` (choice/element/elements selections) now pass `selection.name`
- 13 unit tests in `gate.test.ts` + 33 pipeline tests in `tutorial-gate.test.ts` all green; full engine suite (516 tests) green

## Task Commits

1. **Task 1 RED: failing tests for per-selection matching** - `ac1aaf6` (test)
2. **Task 1 GREEN: SelectionMatcher type + per-selection gate matching** - `4a5fff1` (feat)
3. **Task 2: thread selection.name through 3 action.ts call sites** - `d0731fd` (feat)

## Files Created/Modified
- `src/engine/tutorial/types.ts` - Added `SelectionMatcher` type; replaced `from`/`to` on `TutorialGateAllowList` with `selections` map
- `src/engine/tutorial/gate.ts` - Added `selectionMatchesValue` helper + 4th `selectionName` param + per-selection gate branch; removed old `from`/`to` logic
- `src/engine/tutorial/gate.test.ts` - Replaced `from`/`to` test with 5 new per-selection cases (id match, unspecified-name permit-all, toNotation field equality, non-object guard, no-selections back-compat)
- `src/engine/action/action.ts` - Added `selection.name` as 4th arg at all 3 `getGateReasonForValue` call sites
- `src/engine/action/tutorial-gate.test.ts` - Migrated `tutorialDef` from removed `from`/`to` to action-only gate; updated Behavior 2+4 tests; added per-selection pipeline describe block with object choices
- `src/engine/index.ts` - Added `SelectionMatcher` to tutorial-types export group

## Decisions Made
- Removed `from`/`to` entirely (no deprecation cycle — project hard rule). The existing `tutorial-gate.test.ts` tests that relied on per-value gating via `from`/`to` were migrated: action-level tests use an action-only gate; a new per-selection describe block uses object choices so `selectionMatchesValue` can match them.
- `selectionMatchesValue` treats non-object values (null, string, number) as non-matching (returns false), satisfying the T-109-01 threat mitigation: no crash on invalid value types.
- `tutorial-gate.test.ts` retains string choices in the main `tutorialDef` (for action-level tests) and adds object choices only in the per-selection describe block, keeping HR-01 enforcement tests unaffected.

## Deviations from Plan

None - plan executed exactly as written. The test file migration was implicit in the task action ("Replace any existing `from`/`to` test cases with the new `selections` equivalents") and was handled within Task 2 scope.

## Issues Encountered

The existing `tutorial-gate.test.ts` used string primitive choices (`'c3'`, `'e5'`, `'d4'`, `'f6'`). The `selectionMatchesValue` helper requires object values for field-equality matching (`typeof value !== 'object'` guard). Migrating the per-value gating tests required introducing object-choice variants in a new per-selection describe block, while keeping the action-level tests with their original string choices.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check

- [x] `SelectionMatcher` exported from `src/engine/index.ts`: `grep -c 'SelectionMatcher' src/engine/index.ts` = 1
- [x] `from`/`to` removed from `TutorialGateAllowList`: 0 non-comment occurrences
- [x] `selectionName` in `gate.ts`: 5 occurrences (≥2 required)
- [x] All 3 call sites pass `selection.name`: `grep -c 'getGateReasonForValue([^)]*selection\.name' action.ts` = 3
- [x] `npx vitest run src/engine` → 516 tests, all passing
- [x] Commits exist: `ac1aaf6`, `4a5fff1`, `d0731fd`

## Self-Check: PASSED

## Next Phase Readiness
- LR-02 substrate is complete. The `selections` map with per-selection matchers is available for Plan 109-03 (checkers tutorial content) to gate `piece` by `{ id: N }` and `destination` by `{ toNotation: 'X' }`.
- Plan 109-02 (tutorial launch surface) is independent and can proceed in parallel.

---
*Phase: 109-checkers-tutorial-content*
*Completed: 2026-06-28*
