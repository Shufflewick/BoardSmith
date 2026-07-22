# Deferred items (out of scope for the 169-0x sweeps)

## seven — `refuses a published-discard undo from every seat EXCEPT seat 1 staging last — and does so for engine reasons, not .notUndoable()` (tests/game.test.ts)

**Discovered during:** 169-03 Task 1, baseline `npx vitest run` on `~/BoardSmithGames/seven` BEFORE any
sweep edits (pre-existing failure, not caused by this sweep).

**Symptom:** seats 2 and 3's forged `{type:'undo'}` after a published discard barrier now get
`"No actions to undo"` instead of the test's expected `/not your turn/`.

**Root cause (not investigated further — out of scope):** the test's own title says it is testing
"engine reasons, not `.notUndoable()`" — i.e. general simultaneous-step undo-eligibility semantics
(`computeUndoEligibility` in `session/utils.ts`, the D4/SIM-02 family), NOT the D1/UNDO-01 or
D24/SPACE-03 targets this sweep is gated on. BSR-7/BSR-8 (seven's own SIM-family filings) are marked
"out-of-scope for this crosswalk's fix-present checklist" in 169-CROSSWALK.md Section 1 — this failure
is in the same family.

**Disposition:** left failing, unmodified. Not a regression (same failure on the untouched baseline).
Recommend a future SIM-family-specific plan (analogous scope to BSR-7/BSR-8) investigate whether
`"No actions to undo"` is now the CORRECT message for a simultaneous-step participant that has acted
but is not the tail-of-history seat, in which case the test's own expectation is stale and should be
updated — or whether this is a genuine regression in `computeUndoEligibility`'s message selection.
