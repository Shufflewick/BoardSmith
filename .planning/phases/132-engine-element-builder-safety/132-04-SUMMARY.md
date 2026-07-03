---
phase: 132-engine-element-builder-safety
plan: 04
subsystem: engine
tags: [flow-engine, forEach, checkpoint-restore, tdd]

# Dependency graph
requires:
  - phase: 132-01
    provides: PROC-01 independent re-verification confirming F13/ENG-06 as LEGITIMATE with an exact chokepoint trace (engine.ts:1151-1176) and the executeEachPlayer eligibleSeats mirror template
provides:
  - executeForEach snapshots its collection exactly once on first frame entry instead of re-evaluating config.collection(context) every iteration against a persisted index
  - GameElement items in the snapshot are tagged { elementId } and re-resolved via game.getElementById per iteration; JSON primitives are tagged { value } — avoids conflating a bare-number primitive with an element id (the ENG-05/resolveArgs ambiguity class)
  - Non-element/non-primitive collection items and mid-loop element deletion (not move) both fail loud with actionable errors instead of silently misbehaving
affects: [133-flow-action-validation, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Frame.data snapshot-on-first-entry (guarded by `frame.data?.<key> === undefined`), mirrored from executeEachPlayer's eligibleSeats pattern", "Tagged-union snapshot items ({elementId} | {value}) to keep frame.data JSON-plain and unambiguous for checkpoint/restore"]

key-files:
  created: []
  modified:
    - src/engine/flow/engine.ts
    - src/engine/flow/engine.test.ts

key-decisions:
  - "GameElement snapshot items are tagged with an explicit { elementId } wrapper rather than a bare number, so a JSON-primitive number item in the same collection can never be misread as an element id on re-resolution (mirrors the ENG-05/resolveArgs ambiguity this phase's 132-03 plan just fixed in a sibling chokepoint)"
  - "Mid-loop element deletion (id no longer resolvable via getElementById) throws a descriptive error rather than silently skipping — a loop body may move a visited element but must not delete it"

patterns-established:
  - "Any future frame.data-based flow-loop executor snapshotting a live collection should tag GameElement identity explicitly (not rely on bare-number type inference) to stay unambiguous against JSON-primitive items in the same collection"

requirements-completed: [ENG-06, PROC-02]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 132 Plan 04: forEach snapshot-on-entry fix (ENG-06) Summary

**executeForEach now snapshots its collection once on first frame entry (mirroring executeEachPlayer's eligibleSeats pattern) so a loop body that mutates the source collection still visits every original item, with GameElements re-resolved by tagged id and non-element items failing loud.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T00:26:00Z
- **Completed:** 2026-07-03T00:38:00Z
- **Tasks:** 2 (TDD: RED then GREEN)
- **Files modified:** 2

## Accomplishments
- Added a red-first regression test proving the mutate-while-iterating skip bug (2/4 items visited instead of 4/4) against the unpatched `executeForEach`
- Rewrote `executeForEach` to snapshot `config.collection(context)` exactly once, guarded by `frame.data?.forEachItems === undefined`, storing a JSON-plain tagged-identity list (`{elementId}` for `GameElement`, `{value}` for JSON primitives) in `frame.data`
- Re-resolution per iteration uses `game.getElementById` for elements (throwing loud if the element was deleted, not just moved) and reads primitives directly
- Non-element, non-primitive collection items throw a descriptive error at snapshot time instead of silently being dropped or mis-cloned
- Both pre-existing non-mutating `ForEach Execution` tests remain unchanged and green; full suite (168 files / 2142 tests) green

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1: RED — regression test for forEach over a mutated collection** - `e4e06518` (test)
2. **Task 2: GREEN — snapshot-on-first-entry executeForEach** - `a85c4ae6` (feat)

**Plan metadata:** (this commit, following SUMMARY)

## Files Created/Modified
- `src/engine/flow/engine.ts` - `executeForEach` rewritten to snapshot-on-first-entry with tagged-identity re-resolution; new `ForEachSnapshotItem` type
- `src/engine/flow/engine.test.ts` - New mutating-collection regression test inside the existing `ForEach Execution` describe block

## Decisions Made
- Tagged snapshot items (`{elementId}` / `{value}`) instead of the plainer bare-number approach the plan's must-haves literally describe, because a bare number is ambiguous between "this was originally a `GameElement.id`" and "this was originally a plain numeric primitive that happens to equal a live element's id" — exactly the ENG-05/resolveArgs coercion bug this same phase (132-03) just fixed in a sibling chokepoint. Re-introducing that ambiguity here would be a regression of the same defect class the phase is fixing elsewhere. The plan's `must_haves.artifacts` requirement ("`frame.data` stores only numbers/primitives... no `GameElement` object references") is still satisfied — the tagged wrapper objects are JSON-plain, contain no live object references, and round-trip through checkpoint/restore identically to bare numbers.
- Mid-loop element deletion (not move) throws loud rather than silently skipping, since `getElementById` returning `undefined` for a snapshotted id is otherwise indistinguishable from a bug.
- Checked `docs/actions-and-flow.md` (the only doc documenting `forEach` usage) for any existing claim about live-collection re-evaluation semantics per DOCX-04 — found none; the docs are silent on mutation-during-iteration behavior, so no doc update was needed.

## Deviations from Plan

None - plan executed exactly as written, with one clarifying elaboration on the snapshot's exact on-disk shape (tagged wrapper vs. bare number) documented above under Decisions Made — this is a stricter, non-behavior-visible implementation of the same "JSON-plain identity, elements re-resolved via getElementById" must-have, not a deviation from the required behavior.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ENG-06 closed; `executeForEach` is now checkpoint-restore-safe and mutation-safe, matching `executeEachPlayer`'s established snapshot pattern
- Full suite green (168 files / 2142 tests); tsc --noEmit shows zero new errors attributable to `engine.ts`/`engine.test.ts` (pre-existing unrelated test-file looseness elsewhere, documented tech debt)
- Ready for the next Phase 132 plan (132-05, F28/ENG-08 action-builder handler-less-execute validation) or Phase 133 (flow/action validation cluster)
