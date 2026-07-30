---
phase: 175-impact-map-repair-gating
plan: 05
subsystem: cli
tags: [verify, skill-text, adjudication, gate, drift-pins, boundary-claim]

requires:
  - phase: 175-impact-map-repair-gating
    plan: 03
    provides: "verifyImpactGateCommand/verifyImpactAdjudicateCommand — the CLI commands this plan's skill text drives"
  - phase: 175-impact-map-repair-gating
    plan: 04
    provides: "verifyImpactApplyCommand/verifyImpactStatusCommand — the gated write and impact-map report this plan's skill text drives"
provides:
  - "verify/adjudication-gate.md — the hard stop-and-ask reference file live sessions dispatch to from verify-game.md Step 4"
  - "verify-game.md at six steps, with the now-false Phase 173/175-era boundary claim deleted rather than contradicted"
  - "Drift pins proving the deletion is real (fail-on-reintroduction proven) and that the count-drift class of defect (Step 0's item-count citation) cannot recur"
affects: [176-repair-gating-close]

tech-stack:
  added: []
  patterns:
    - "In-place deletion of a now-false boundary claim, not an appended contradiction beside it (174-05's identical technique reapplied)"
    - "Drop a hardcoded count from a citing sentence rather than incrementing it, and pin against ANY count re-appearing (\\d+), not just the stale one"
    - "stripComments before scanning for forbidden bypass vocabulary, so a comment mentioning the word cannot self-invalidate the gate"

key-files:
  created:
    - src/cli/slash-command/bs/verify/adjudication-gate.md
  modified:
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/slash-command/bs/verify.test.ts
    - src/cli/commands/install-claude-command.ts

key-decisions:
  - "verify-game.md's header claim ('even there the verdict is only ever recorded') was reworded rather than left in place — it read as a whole-skill promise that Step 4 now falsifies; the still-true promise (no staged slice ever takes a live one's place) was preserved verbatim in substance"
  - "Step 0's 'restate its four items' was fixed by DROPPING the count ('restate its items'), not bumping it to five, per the plan's explicit reasoning: an exact count in a citing file self-invalidates on every future addition to the cited section"
  - "adjudication-gate.md's original 'No Bypass, By Construction' heading was renamed to 'No Skip Path, By Construction' after Task 3's own forbidden-vocabulary pin (which now scans this file, once ALL_VERIFY_FILES was widened) caught the literal word 'bypass' in its own heading — reworded to avoid the substring while keeping the identical semantic guarantee"

patterns-established:
  - "A negative drift pin is only trustworthy once proven to fail: the deleted Step 3 sentence was temporarily reintroduced, the suite was run and observed failing on the `not.toContain('Phase 175')` assertion, then reverted — recorded here rather than merely asserted"

requirements-completed: [VERIFY-04, VERIFY-05, VERIFY-06]

duration: ~55min
completed: 2026-07-30
---

# Phase 175 Plan 05: The Adjudication Gate Skill Text — Boundary-Claim Deletion, Step 4, Drift Pins Summary

**`verify-game.md`'s Step 3 no longer claims it "flips no staleness marker anywhere and opens no repair loop" — that claim is deleted in place (not contradicted beside a new step), a new Step 4 dispatches to `verify/adjudication-gate.md` for the hard stop-and-ask/RULINGS.md-append/staleness-write/impact-map sequence with no bypass vocabulary anywhere, and the rewritten drift pins in `verify.test.ts` were proven — by temporarily reintroducing the deleted sentence and watching the suite fail — to actually catch a regression, not merely assert one.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-30
- **Completed:** 2026-07-30
- **Tasks:** 3 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Created `src/cli/slash-command/bs/verify/adjudication-gate.md` (132 lines): models `build/ask.md`'s "Gate-Before-Write" no-bypass discipline exactly — present all pending contradictions at once (one question per FINDING, never per affected chunk, decision 14), both readings verbatim, every affected chunk slug uncapped (decision 15); no durable write until an explicit answer; two terminal answers only (`resolved` appends a `RULINGS.md` `### Ruling N` entry, `UNADJUDICATED` never silently cleans, decision 8); cites `state-machine.md`'s Write Order/Authority/Redteam Escalation/Rules Staleness Marker sections by name at least twice rather than restating them
- Deleted `verify-game.md` Step 3's now-false final sentence ("flips no staleness marker anywhere and opens no repair loop (that is Phase 175's job)") in place — not appended around — and replaced it with a sentence that is true after this change, pointing at the new Step 4
- Inserted `## Step 4: Adjudication Gate and Impact Map (VERIFY-04, VERIFY-05, VERIFY-06)` between Classification and Close, dispatching to the new reference file; renumbered the existing Close step to Step 5 and updated its one in-file cross-reference (Step 0's "(Step 4) releases" → "(Step 5) releases")
- Fixed all three collateral stale claims the plan enumerated: the step-count pin (5→6), the per-heading requirement-ID regex (`/VERIFY-0[12378]/` → `/VERIFY-0[1-8]/`), and Step 0's "restate its four items" — fixed by dropping the count entirely rather than incrementing it, with a new pin rejecting ANY hardcoded count (`/restate its (four|five|\d+) items/`)
- Also reworded the header paragraph's now-overbroad "even there the verdict is only ever recorded" claim, which read as a whole-skill promise Step 4 now falsifies, while preserving the still-true no-promotion guarantee verbatim in substance
- Added `join(SHARED_ROOT, 'verify', 'adjudication-gate.md')` to `install-claude-command.ts`'s `SHARED_LEAF_PROBES`, and verified with a real local install into a scratch directory that the file physically ships to `.claude/skills/bs-shared/verify/adjudication-gate.md`
- Rewrote `verify.test.ts`'s drift pins: widened `ALL_VERIFY_FILES` to include the new file (so the existing copy-drift/forbidden-vocabulary loops cover it), added a new describe block asserting Step 4/Step 5 exist, the Phase 175 boundary claim is gone, all four `verify-impact-*` commands are named between the router and its delegate, and the delegate carries the hard-gate discipline with no bypass vocabulary (`--force`/`--yes`/`--skip`/`bypass`, scanned after `stripComments`)
- **Proved the negative pin actually fails on reintroduction**: temporarily restored the deleted Step 3 sentence, ran the suite, observed `AssertionError: expected "Phase 175..." not to contain "Phase 175"` fail on the new `not.toContain('Phase 175')` assertion, then reverted the file — recorded per the plan's explicit requirement that a negative assertion that never fails is not a test

## Task Commits

Each task was committed atomically:

1. **Task 1: `verify/adjudication-gate.md` — the hard stop-and-ask and the ordered write sequence** - `93f685a4` (feat)
2. **Task 2: `verify-game.md` — delete the false boundary statement, insert Step 4, renumber Close** - `a0456961` (fix)
3. **Task 3: Rewrite the drift pins in `verify.test.ts`** - `71826a71` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/slash-command/bs/verify/adjudication-gate.md` (created) - the hard adjudication-gate reference file: When This File Runs / Detect / Present / Wait / Write / Report, plus a "No Skip Path, By Construction" closing section and a Reference section citing `state-machine.md`
- `src/cli/slash-command/bs/verify-game.md` - Step 3's boundary claim deleted in place; new Step 4 inserted; Close renumbered to Step 5 with its cross-reference updated; header claim reworded; Step 0's item count dropped; Reference Files footer and installed-location note extended
- `src/cli/slash-command/bs/verify.test.ts` - `ALL_VERIFY_FILES` widened; step-count/requirement-ID pins updated to six steps; new "restate its items" no-hardcoded-count pin; new describe block for Step 4/Step 5 existence, the deleted boundary claim's absence, cross-file command-name coverage, and the delegate's no-bypass vocabulary scan
- `src/cli/commands/install-claude-command.ts` - `SHARED_LEAF_PROBES` extended with `verify/adjudication-gate.md`

## Decisions Made

- Embedded a second full `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` citation in the Write sub-step (alongside the opening paragraph's citation) to satisfy the plan's "cites `state-machine.md` at least twice" acceptance criterion literally, rather than relying on the bare word "state-machine.md" appearing elsewhere.
- Renamed `adjudication-gate.md`'s closing section heading from "No Bypass, By Construction" to "No Skip Path, By Construction" after Task 3's forbidden-vocabulary scan (now covering this file) caught the literal substring "bypass" in the heading itself — reworded rather than removed, preserving the identical guarantee the heading describes.

## Deviations from Plan

None requiring Rule 1-4 intervention. The one process note: the "No Bypass" → "No Skip Path" heading rename in `adjudication-gate.md` was made during Task 3 (discovered by Task 3's own new pin) and committed alongside Task 3's `verify.test.ts` changes rather than as a Task 1 amendment, since Task 1's own commit had already landed and the fix was a direct consequence of Task 3's forbidden-vocabulary scan being widened to cover the new file.

## Issues Encountered

None beyond the heading self-invalidation caught and fixed within Task 3's own scope before its suite went green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `verify-game.md` now routes VERIFY-04/05/06 through a real Step 4 dispatch to `adjudication-gate.md`, which drives all four `verify-impact-*` CLI commands (175-03/175-04's output) with a structurally unbypassable gate.
- Phase 176 (repair-gating close) can proceed knowing the skill-text side of VERIFY-04/05/06 is now consistent with the mechanical CLI work 175-01 through 175-04 already shipped — no self-contradicting boundary claim remains anywhere in the router.
- No blockers identified for the remaining Phase 175 plans (06-08).

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 4 files confirmed present on disk (1 created, 3 modified); all three task commit hashes (`93f685a4`, `a0456961`, `71826a71`) confirmed in `git log`. Full bs skill-text suite (`src/cli/slash-command/bs/`) 470/470 green; full repo suite `npm test` 3817/3817 green (3811 baseline + 6 new tests). `grep -n "Phase 175\|flips no staleness marker" verify-game.md` returns nothing. A real local install into a scratch directory confirmed `adjudication-gate.md` physically ships to `.claude/skills/bs-shared/verify/`. The negative drift pin was proven to fail on temporary reintroduction of the deleted sentence, then reverted; working tree confirmed clean (`git status --short`) before this summary was written.
