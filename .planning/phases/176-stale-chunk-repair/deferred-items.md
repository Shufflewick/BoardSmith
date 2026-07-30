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
