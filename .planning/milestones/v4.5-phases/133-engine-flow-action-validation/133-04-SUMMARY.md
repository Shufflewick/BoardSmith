---
phase: 133-engine-flow-action-validation
plan: 04
subsystem: engine
tags: [validation, action-builder, chooseFrom, multiSelect, security]

# Dependency graph
requires:
  - phase: 133-01
    provides: PROC-01 findings-verification gate confirming F6/ENG-04 as LEGITIMATE with exact file:line evidence
provides:
  - Server-side multiSelect count (min/max) enforcement on the choice branch of validateSelection
  - Non-array rejection for multiSelect-configured chooseFrom submissions (new logic, no elements-branch analog)
  - Red-first regression test suite for ENG-04 in action.test.ts
affects: [138-games-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Choice-branch multiSelect enforcement mirrors the elements-branch pattern (resolve function-valued config with context, compute min/max from number|object form) but diverges deliberately: non-array values are rejected outright instead of degraded to count=1"

key-files:
  created: []
  modified:
    - src/engine/action/action.ts
    - src/engine/action/action.test.ts

key-decisions:
  - "Non-array rejection is genuinely new logic (not a straight port) — a bare scalar is a legitimate shorthand for a single-item elements-branch selection but is explicitly disallowed for a multiSelect-configured chooseFrom per the locked decision in 133-FINDINGS-VERIFICATION.md"
  - "Kept the choice-branch enforcement inline rather than extracting a shared helper with the elements branch — the array-type rejection branch only applies to choice selections, so a shared helper would need a boolean flag; inline stayed clearer per Claude's Discretion in the plan"

requirements-completed: [ENG-04, PROC-02]

# Metrics
duration: 10min
completed: 2026-07-03
---

# Phase 133 Plan 04: chooseFrom multiSelect Server-Side Enforcement Summary

**Choice-branch `validateSelection` now enforces `chooseFrom` `multiSelect` min/max bounds server-side and rejects non-array submissions outright, closing the ENG-04/F6 gap where client-shipped bounds were the only check.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-03T14:12:00Z
- **Completed:** 2026-07-03T14:22:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Red-first regression tests added to the `validateSelection` describe block covering too-few, too-many, number-form, function-form, non-array-rejection, in-bounds, and non-multiSelect-control cases for `chooseFrom`
- RED confirmed: 5 of 7 new tests failed against the unpatched choice branch (only the two cases with no multiSelect-related assertion — the in-bounds control and the non-multiSelect control — passed, since they exercise pre-existing membership validation only)
- GREEN: choice branch now resolves `(selection as ChoiceSelection).multiSelect` (calling function form with `context`), enforces `min`/`max` against `value.length`, and rejects non-array values with an actionable "expected an array" error when multiSelect is configured
- Elements-branch (F31) behavior confirmed unaffected — no shared helper extracted, block kept inline for clarity

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression tests for choice-branch multiSelect enforcement** - `d82a61b7` (test)
2. **Task 2: GREEN — choice-branch multiSelect count + array-type enforcement** - `423dffa1` (feat)

**Plan metadata:** (this commit, follows)

_TDD tasks: RED (test) → GREEN (feat); no REFACTOR commit needed (no shared helper extracted, no cleanup required)._

## Files Created/Modified
- `src/engine/action/action.ts` - Added multiSelect count + array-type enforcement to the choice branch of `validateSelection`, inside the existing `selection.type === 'choice' || 'element'` guard
- `src/engine/action/action.test.ts` - Added 7 red-first regression tests for ENG-04 inside the `validateSelection` describe block

## Decisions Made
- Non-array rejection kept as new logic, not a port — matches the locked decision from `133-FINDINGS-VERIFICATION.md` that a scalar submitted against a multiSelect-configured choice selection must not silently degrade to count=1
- No shared `enforceMultiSelectCount` helper extracted between choice and elements branches — the plan offered this at Claude's Discretion ("if it reads cleanly... otherwise keep the block inline"); the array-type-rejection asymmetry between the two branches made a clean shared helper awkward (would need a boolean flag or callback), so both blocks were kept inline and independently readable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## RED Output (Task 1, per PROC-02)

Running `npx vitest run src/engine/action/action.test.ts -t "validateSelection"` against the unpatched choice branch:

```
Test Files  1 failed (1)
     Tests  5 failed | 9 passed | 119 skipped (133)
```

Failing tests (all against the unenforced choice branch, as expected):
- `rejects a chooseFrom multiSelect submission with too few items`
- `rejects a chooseFrom multiSelect submission with too many items`
- `enforces bounds for the number multiSelect form on chooseFrom (implicit min 1)`
- `enforces bounds for the function multiSelect form on chooseFrom`
- `rejects a non-array value submitted to a multiSelect-configured chooseFrom`

Passing (control cases requiring no new enforcement):
- `accepts an in-bounds array submission to a multiSelect chooseFrom`
- `is unaffected for a non-multiSelect chooseFrom selection`

After the Task 2 fix, `npx vitest run src/engine/action/action.test.ts` reports 133/133 passing (all ENG-04 tests green, F31 elements-branch tests unchanged). Full suite (`npm test`) reports 2157/2157 passing across 168 files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ENG-04/F6 closed; server-side multiSelect enforcement now symmetric across the choice and elements branches (with the deliberate non-array-rejection asymmetry documented above)
- Choice-branch multiSelect usage across shipped games (8 example games + MERC) is verified cross-repo in Phase 138 per the plan's verification note — no game currently exercises this path based on the F6 audit trace, but Phase 138 will confirm
- Plan 133-05 (F27/ENG-07 switchOn silent-completion fix) is next in the wave sequence

---
*Phase: 133-engine-flow-action-validation*
*Completed: 2026-07-03*

## Self-Check: PASSED

All claimed files (src/engine/action/action.ts, src/engine/action/action.test.ts) and commits (d82a61b7, 423dffa1) verified present.
