# Phase 176 — Deferred / Out-of-Scope Items

## From 176-04 (verify-game.md sweep)

**`src/cli/slash-command/bs/verify/adjudication-gate.md` § 6 (Report) carries the same class of
issue this plan fixed in `verify-game.md`, but the file is outside 176-04's declared
`files_modified` list (`verify-game.md`, `verify.test.ts` only) — not touched, per the SCOPE
BOUNDARY rule (only auto-fix issues directly caused by the current task's changes).**

Specifically:

- Line 112-113 enumerates the repair-gate disposition as three values
  (`reopen-playtest`/`close-without-replaytest`/`unknown-drift`), omitting `not-applicable` —
  the same stale enumeration `verify-game.md`'s Step 4 carried before this plan's fix. Checked
  against `verifyImpactStatusCommand`'s `printImpactHumanReport` (`verify-impact.ts:1099-1122`):
  it iterates the FULL `REPAIR_GATE_DISPOSITIONS` (all four values) and prints any group with
  `inGroup.length > 0`, so `not-applicable` entries genuinely can appear in the real report this
  step formats. The three-item list is a second instance of the same defect class fixed in
  `verify-game.md`.
- Line 116-117 ("performing the repair itself ... is Phase 176's job, never this step's") is
  still TRUE in effect (this step still never performs repair), but the "Phase 176" label is now
  a live self-reference rather than a forward reference — it could be sharpened to name
  `verify/repair-dispatch.md` directly, the way `verify-game.md`'s Step 4 now does, but was left
  untouched since it is not literally false and adjudication-gate.md is out of this plan's file
  scope.

**Recommendation:** whichever plan next touches `adjudication-gate.md` (or a dedicated follow-up)
should apply the same two fixes: drop the hardcoded three-item disposition list in favor of citing
`REPAIR_GATE_DISPOSITIONS`, and repoint the "Phase 176's job" sentence at
`verify/repair-dispatch.md` by name.

---

## RESOLVED 2026-07-30 (orchestrator, between waves 3 and 4)

Both items above are **fixed**. The disposition enumeration in `adjudication-gate.md` was not
incremented to four values — it was **removed**, and replaced with a pointer to
`REPAIR_GATE_DISPOSITIONS` plus a note that `printImpactHumanReport` iterates the array in full.

Rationale for removing rather than correcting: a hardcoded enumeration inside a citing file is a
self-invalidating claim. Correcting it to four values would be right today and wrong at the next
addition — which is exactly how it reached three-of-four in the first place. This is the same call
made in plan 175-05 (dropping `verify-game.md`'s "four items" count rather than bumping it to five)
and again in 176-04 (dropping the disposition list in favour of citing the source array).

The "Phase 176's job" phrasing was also reworded to name the repair STEP rather than a phase number,
since a phase reference inside shipped skill text goes stale the moment that phase closes.

`npx vitest run src/cli/slash-command/bs/verify.test.ts` → 66/66 green after the edit.

**Standing lesson for later phases:** this was the FIFTH instance of stale cross-file prose in v4.9
(173's boundary statements, 174's Step 3 claim, 175's "four items" + hyphenated "eight-item" variant,
176-04's three claims, and this). In every case the survivors were claims nobody had listed in
advance. Sweep whole files; never fix only the enumerated hits.
