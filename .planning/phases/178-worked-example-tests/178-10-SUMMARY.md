---
phase: 178-worked-example-tests
plan: 10
subsystem: testing
tags: [pre-registration, satisfiability-audit, worked-examples, check-06, test-01, proof-discipline]

requires:
  - phase: 178-worked-example-tests plan 09
    provides: "Both pipeline sides wired (build/test.md item 4, verify-game.md Step 8) — the shipped design this pre-registration's expected extraction and satisfiability audit are checked against"
provides:
  - ".planning/phases/178-worked-example-tests/178-PRE-REGISTRATION.md — the committed, pre-dispatch expected extraction (25 slices, 11 worked examples, permitted outcome sets) and satisfiability audit (6 criteria audited, 4 rewritten/rejected) plan 178-11 must check its live results against"
affects: [178-11-live-proof]

tech-stack:
  added: []
  patterns:
    - "Zero-dispatch dry run via a standalone tsx script importing the real readLiveSlices/buildExampleExtractionPayload directly — no ledger, no staging, no claude -p — the same technique 177.1-06's pre-registration used to predict targetingAmbiguousCount exactly."
    - "Every candidate example cross-checked by an independent cat -n read of the raw slice file, not taken from the dry-run script's output alone — caught two corrections (a line-number typo, an undersold characterization of the SOUL HARVESTER example) and one major finding (the inherited corpus undercounted by more than half)."
    - "Satisfiability audit table format (criterion / how measured / could a correct implementation ever fail this for reasons outside its control / disposition) mirrors CONTEXT decision 14's own wording verbatim, reused from 177.1-PRE-REGISTRATION.md's self-check section shape."

key-files:
  created:
    - .planning/phases/178-worked-example-tests/178-PRE-REGISTRATION.md
  modified: []

key-decisions:
  - "Corrected the inherited corpus estimate (~5-6 examples, CONTEXT <measured_reality> #3) to 11, found by direct read before any dispatch: one-two-punch alone has six citation-labeled worked examples, not two — two in 01-setup-and-round-structure.md (Starting a New Game, FIGHT) the CONTEXT/plan never named, plus two more in 02-action-cards-and-resolution.md (ADVANCE, PUNCH) beyond the two Punch Examples already known. doom-machine gained a third (the DICE ROLL SYMBOLOGY / EXAMPLES legend block in 01-dice-roll-symbology.md)."
  - "seven's Run example pre-registered {example-inconsistent} ONLY, per D-04 — the slice's own Visual line (L14, not L13 as the plan's <corpus> block stated) prints the '5,6,7' vs '1,2,3' contradiction in source text; any other verdict means extraction failed to notice a contradiction handed to it directly."
  - "Satisfiability audit: SC-1 and SC-2's literal ROADMAP wording ('every worked example produces an executable test' / 'executes each example') both REWRITTEN — an unexecutable or example-inconsistent example makes the literal wording unsatisfiable by construction, the same defect class that cost CHECK-04 four full measurement runs (REQUIREMENTS.md CHECK-04 closure note). A naive 'the Run example is never turned into a test' criterion REWRITTEN because it passes vacuously if extraction silently finds nothing — strengthened to require the example-inconsistent verdict WITH both contradicting excerpts recorded. Any N-of-M bar over a single game's example count REJECTED per 178-RESEARCH Pitfall 5. A 'human-recognizable' bar REJECTED as unmeasurable, replaced by this document's own Section 1 table as the fixed checkable target. SC-3 (shared derivation logic) KEPT unchanged — a static, non-dispatch-dependent code-structure fact already demonstrated true by 178-08/178-09's own regression tests."
  - "Stability (Section 3) defined on the generated test's PASS/FAIL outcome across two independent extraction+translation runs of the same example — decision 15 named explicitly, the retired CHECK-04 byte-identical determinism gate explicitly NOT re-imported at any layer (label OR outcome)."

requirements-completed: [CHECK-06, TEST-01]

duration: ~55min
completed: 2026-07-31
---

# Phase 178 Plan 10: Pre-Registration — Expected Extraction + Satisfiability Audit Summary

**Committed `178-PRE-REGISTRATION.md` alone, before any dispatch, correcting the inherited ~5-6-example corpus estimate to 11 by direct read and pre-registering a satisfiability-audited acceptance bar (3 criteria rewritten, 2 rejected) for plan 178-11's live proof.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 completed (both folded into the single pre-registration document per the plan's structure)
- **Files modified:** 1 (new)

## Accomplishments

- **Task 1 — Expected extraction, per game, by slice and line.** Ran a zero-dispatch `tsx` script calling the real, unmodified `readLiveSlices` (`verify-derive-check.ts`) and `buildExampleExtractionPayload` (`example-derivation.ts`) directly against all three live `~/BoardSmithGames/{seven,one-two-punch,doom-machine}` trees — no ledger, no staging, zero `claude -p`/Task dispatches. Confirmed the exact slice counts CHECK-06/TEST-01 actually enumerate: `seven` 3, `one-two-punch` 2, `doom-machine` 20 (including `OPEN-QUESTIONS.md`, a live slice under `readLiveSlices`'s own exclusion list of exactly `{INDEX.md, 00-visual-survey.md}`) — 25 total. Cross-checked every extraction-candidate line against an independent `cat -n` read of the raw slice file rather than trusting the script's output alone. **This direct-read pass found the inherited corpus (178-CONTEXT.md `<measured_reality>` #3, this plan's own `<corpus>` block) undercounted the real population by more than half**: 11 worked examples exist, not ~5-6 — `seven` 2 (unchanged), `one-two-punch` 6 (not 2 — four previously-unnamed citation-labeled `(worked example, italic)` spans found in `01-setup-and-round-structure.md` and `02-action-cards-and-resolution.md`), `doom-machine` 3 (not 2 — a previously-unnamed `DICE ROLL SYMBOLOGY / EXAMPLES:` legend block). Built the full per-slice table (Section 1) with verbatim first line, 1-based line number, expected `kind`, and a permitted outcome SET (never a single label) for every example, plus one "no worked example expected" row per example-free slice. `seven`'s Run example is pre-registered `{example-inconsistent}` ONLY per D-04 — its own Visual line (corrected to L14, not L13 as the plan's `<corpus>` stated) names the "5,6,7" vs "1,2,3" contradiction in source prose. Stated the corpus size as a raw count (11 across 25 slices, 3 games) with no percentage anywhere, and decision 17's zero-examples rule verbatim in substance.
- **Task 2 — the satisfiability audit.** Built Section 2 as a four-column table (criterion / how measured / "could a correct implementation ever fail this for reasons outside its control?" / disposition) auditing 6 proposed criteria derived from ROADMAP.md's three Phase 178 success criteria plus CONTEXT decisions 14/16/17 and 178-RESEARCH.md Pitfall 5. **4 of 6 rows carry a non-KEEP disposition**: SC-1's literal wording ("generates an executable test for every worked example") REWRITTEN to require executable-OR-named-unexecutable-OR-routed-inconsistent, since `unexecutable`/`example-inconsistent` are legitimate first-class verdicts that make the literal wording unsatisfiable whenever either applies — exactly CHECK-04's defect class (four full measurement runs failing a criterion unsatisfiable by construction, per REQUIREMENTS.md's CHECK-04 closure note). SC-2 REWRITTEN identically for CHECK-06's replay side. A naive "the Run example is never turned into a test" criterion REWRITTEN because it would pass vacuously if extraction silently returned nothing — strengthened to require the `example-inconsistent` verdict WITH both contradicting excerpts present in the record. Any N-of-M bar over a single game's example count (M as low as 2) REJECTED per 178-RESEARCH Pitfall 5's own named hazard. A "human-recognizable" bar REJECTED as unmeasurable — this pre-registration's own Section 1 table stands in as the fixed, checkable target instead. SC-3 (shared derivation logic) KEPT unchanged: a static code-structure fact (both `build/test.md` and `verify-game.md` Step 8 cite the identical `extract-example.md`/`translate-example.md` contracts and `example-derivation.ts` payload builders), not model-dispatch-dependent, already demonstrated true by 178-08/178-09's own regression tests. Section 3 defines stability on the generated test's PASS/FAIL outcome across two independent extraction+translation runs of the same example, names decision 15 explicitly, states what a real stability failure looks like (same example, same unchanged code, opposite pass/fail across runs), and states the retired CHECK-04 byte-identical determinism gate is not re-imported at any layer. Section 4 records the literal `cp -R`/sha256 baseline/verification commands (decision 18) plan 178-11 must run verbatim, reusing the exact selector `177.1-06`'s pre-registration already proved reproduces the recorded baseline byte-for-byte.

## Task Commits

1. **Task 1 + Task 2 — pre-registration document** — `dc4670fe` (docs: pre-register expected extraction + satisfiability audit, committed alone)

**Plan metadata:** committed together with this SUMMARY, STATE.md, and ROADMAP.md updates (see below).

_Note: this plan performed zero code changes — both tasks compose one document, committed as the plan's sole, standalone, pre-dispatch commit per decision 13's requirement._

## Files Created/Modified

- `.planning/phases/178-worked-example-tests/178-PRE-REGISTRATION.md` — the pre-dispatch expected extraction (Section 1) and satisfiability audit (Sections 2-4), committed alone at `dc4670fe`

## Deviations from Plan

None — plan executed exactly as written. The one substantive addition (the expanded 11-example
corpus vs. the plan's own stated ~5-6) is not a deviation from the plan's INSTRUCTIONS — Task 1
explicitly required confirming or correcting the inherited corpus "by direct read, never inherit
on faith," and the correction is the deliverable that instruction exists to produce, recorded
prominently in Section 1 rather than silently reconciled.

## Issues Encountered

None. The zero-dispatch dry-run script and every direct-read cross-check completed without
requiring any auto-fix.

## User Setup Required

None — no external service configuration required. No packages installed.

## Confirmation of what_must_be_right

1. **Committed ALONE, before any dispatch.** `git show --stat dc4670fe` lists exactly one path
   (`.planning/phases/178-worked-example-tests/178-PRE-REGISTRATION.md`, 249 insertions, 0
   deletions) and it is the first commit this plan made — no `claude -p`/Task dispatch occurred
   anywhere before or during this plan's execution. Confirmed by direct `git show --stat` output
   captured immediately after the commit, before any further work.
2. **seven's Run example pre-registered `{example-inconsistent}` ONLY.** Section 1's row for
   `01-definitions-and-components.md:12` carries the single-label permitted set with the required
   written justification: the slice's own `Visual (p.1):` line (L14) states the contradiction in
   plain prose, so a correct implementation reading that line has no legitimate route to any other
   verdict.
3. **Build/verify asymmetry verified as intentional, not flagged as a bug.** Section 2's SC-1/SC-2
   rewrites preserve, rather than paper over, the build-blocking (TEST-01) vs. advisory (CHECK-06)
   distinction 178-08/178-09 already wired — neither rewrite proposes making CHECK-06 gate anything.
4. **Staging discipline recorded, not yet executed.** Section 4 states the literal `cp -R`/sha256
   commands 178-11 must run; this plan itself performed zero live dispatches and therefore never
   touched any reference game's tree (confirmed: this plan's own zero-dispatch dry run only READ
   the live trees via `readLiveSlices`, never wrote to them — no staging was needed for a read-only
   dry run).

## Next Phase Readiness

Plan 178-11 (the live proof) should know:

- **The corpus is 11 examples across 25 slices in 3 games, not ~5-6.** Every live dispatch in
  178-11 must be checked against Section 1's full table, not the CONTEXT's smaller inherited
  estimate — in particular, `one-two-punch` now has SIX examples to extract, not two, and
  `doom-machine` has a THIRD (the dice-roll-symbology legend block) beyond the two previously named.
- **Every acceptance criterion 178-11 measures against must be the REWRITTEN wording in Section 2,
  never the ROADMAP's literal SC-1/SC-2 text** — the literal wording is unsatisfiable by
  construction whenever any example legitimately verdicts `unexecutable` or `example-inconsistent`.
- **The Run-example bar is now WITH-both-excerpts, not merely "never a test."** A live run that
  extracts nothing for `seven`'s L12 must be treated as a FAILURE of this criterion (a vacuous
  pass), not a pass.
- **Stability across two runs is checked on generated-test PASS/FAIL, never on spec-text or
  verdict-label equality** — 178-11 should not flag two differently-worded but pass/fail-agreeing
  runs as a flip.
- **The `cp -R`/sha256 commands in Section 4 are the ones to run, verbatim** — do not re-derive a
  new selector; reuse the one already proven byte-for-byte reproducible against `177-22-MEASUREMENT`'s
  recorded baseline.
- No blockers. Full suite unchanged from the entering baseline: **4306 tests / 247 files, 0
  failing** (this plan touched zero `src/` files).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`.planning/phases/178-worked-example-tests/178-PRE-REGISTRATION.md` confirmed present on disk;
commit `dc4670fe` confirmed present in `git log --oneline --all`, with `git show --stat` naming
exactly that one path.
