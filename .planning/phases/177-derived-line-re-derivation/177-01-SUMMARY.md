---
phase: 177-derived-line-re-derivation
plan: 01
subsystem: cli
tags: [verify-pipeline, regex, presentation-exclusion, classification, vitest]

requires:
  - phase: 174-verify-classifier
    provides: "PRESENTATION_EXCLUSION_MARKERS / isPresentationLine (exported, decision 1's reuse target) and classification-subagent.md's dual-schema exclusion prose"
provides:
  - "PRESENTATION_EXCLUSION_MARKERS widened to tolerate an optional parenthetical qualifier between description/art and the colon"
  - "Positive + negative regression pins on the 4 real one-two-punch lines that previously slipped the filter"
  - "classification-subagent.md and verify-classify.ts back in lockstep, cross-file lexicon pin preserved (stronger, not weaker)"
  - "174-PROOF.md note documenting why Phase 174's recorded results stand unaffected"
affects: [177-02, 177-03, 177-04, 177-05, 177-06, 177-07]

tech-stack:
  added: []
  patterns: ["regex source normalization for cross-file lexicon pins (strip an optional group before the literal-prefix comparison)"]

key-files:
  created: []
  modified:
    - src/cli/commands/verify-classify.ts
    - src/cli/commands/verify-classify.test.ts
    - src/cli/slash-command/bs/verify/classification-subagent.md
    - src/cli/slash-command/bs/verify.test.ts
    - .planning/phases/174-verify-classifier/174-PROOF.md

key-decisions:
  - "Widened the two dash-qualified regex patterns with an optional (?: \\([^)]+\\))? group before the colon, rather than inventing a 177-local pattern — a correction to the single shared definition decision 1 already committed to reusing."
  - "The cross-file lexicon pin (verify.test.ts) now strips the optional group from a marker's regex source BEFORE the existing backslash/^/d+ normalization, so the widened marker still normalizes to the same literal prefix already quoted in classification-subagent.md — the test got stronger (a new isPresentationLine-driven assertion), not weaker."
  - "174-PROOF.md gets an additive-only note, not a re-run: Phase 174's lineFindings[] came from the subagent layer (whose prose was already correct), not the mechanical constant, so no recorded number needed re-measuring."

patterns-established:
  - "When widening a frozen regex-source constant that a cross-file lexicon pin normalizes into a literal-prefix containment check, add the normalization step for the new syntax rather than loosening the assertion itself."

requirements-completed: [CHECK-04]

duration: 25min
completed: 2026-07-30
---

# Phase 177 Plan 01: Fix PRESENTATION_EXCLUSION_MARKERS regex gap Summary

**Widened `PRESENTATION_EXCLUSION_MARKERS`'s two dash-qualified patterns to tolerate an optional parenthetical qualifier, closing a real gap that let 4 `one-two-punch` presentation lines slip through as rule-bearing — pinned by the 4 real lines plus a negative over-exclusion guard, with the cross-file prose/code lexicon pin kept honest rather than weakened.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-30T16:19:00Z
- **Completed:** 2026-07-30T16:24:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `isPresentationLine` now correctly classifies all 4 real `one-two-punch` lines carrying a `— diagram description (Plan phase):` / `(Fight phase):` / `(first Punch example):` / `(second Punch example):` qualifier as presentation, matching what `classification-subagent.md`'s prose already stated was correct.
- A negative sweep proves the widened constant excludes exactly those 4 lines and nothing else, across every `Derived (p.` line in both reference games' committed live fixtures — `seven`'s 10 unqualified lines remain untouched.
- The cross-file lexicon pin between `verify-classify.ts`'s code constant and `classification-subagent.md`'s prose stays a verbatim-containment assertion (never loosened), extended to normalize the new optional-group syntax, plus a new assertion driving the real `isPresentationLine` against the prose's own worked example.
- `174-PROOF.md` carries an additive-only note (verified via `git diff --numstat`) explaining that Phase 174's recorded `lineFindings[]` came from the subagent judgment layer, not the mechanical constant, so nothing needed re-measuring.

## Task Commits

1. **Task 1: Widen PRESENTATION_EXCLUSION_MARKERS, pinned by the 4 real slipping lines and a negative case** - `7af516f5` (fix)
2. **Task 2: Keep the cross-file lexicon pin honest — prose and code back in lockstep** - `4b606465` (docs)
3. **Task 3: Record in 174-PROOF.md why Phase 174's results stand unchanged** - `90d5097a` (docs)

## Files Created/Modified
- `src/cli/commands/verify-classify.ts` - widened the two dash-qualified `PRESENTATION_EXCLUSION_MARKERS` patterns with an optional `(?: \([^)]+\))?` group
- `src/cli/commands/verify-classify.test.ts` - updated the frozen-set pin, widened the pre-existing `presentation-1` local regex to match, added `presentation-5` (positive, fixture-read) and `presentation-6` (negative over-exclusion sweep, both games)
- `src/cli/slash-command/bs/verify/classification-subagent.md` - added a lexicon bullet naming the qualified-parenthetical form with a real `(Plan phase)` qualifier, quoting the real line
- `src/cli/slash-command/bs/verify.test.ts` - extended the cross-file lexicon pin's normalization to erase the optional group before the literal-prefix check; added a new assertion driving `isPresentationLine` against the prose's own example
- `.planning/phases/174-verify-classifier/174-PROOF.md` - additive note (23 lines added, 0 removed) documenting the layer-attribution argument for why Phase 174's results stand

## Decisions Made
- Widen in place rather than fork: the fix lives in the single shared `PRESENTATION_EXCLUSION_MARKERS` constant, satisfying decision 1's verbatim-reuse-target requirement for later 177 plans.
- Kept the negative-pin discipline (177's threat model T-177-01) as a hard size-4 assertion, not a loose `toContain`, so a future 5th line silently newly excluded would fail loudly.

## Deviations from Plan

None - plan executed exactly as written. The pre-existing `presentation-1` test (not named in the plan's task list) needed its own local regex widened to stay green after Task 1's constant change — this is the same correction the task's acceptance criteria already required (`npm test` green), not a scope expansion.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
`PRESENTATION_EXCLUSION_MARKERS` is now correct and safe for 177-02+ to reuse verbatim per decision 1 — CHECK-04's mechanical presentation-line exclusion will inherit the fixed, not the buggy, definition. `npm test`: 3896/3896 green throughout, zero regressions.

---
*Phase: 177-derived-line-re-derivation*
*Completed: 2026-07-30*
