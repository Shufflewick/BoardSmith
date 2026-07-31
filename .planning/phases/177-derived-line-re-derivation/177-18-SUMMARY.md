---
phase: 177-derived-line-re-derivation
plan: 18
subsystem: cli-verify
tags: [check04-replacement, third-reference-game, real-dispatch, measurement, honesty-discipline, defect-found]

# Dependency graph
requires:
  - plan: 177-15
    provides: The dual-enumeration + reconciliation mechanism (verify-enumerate.ts, enumerate-facts.md,
      reconcile-facts.md) this plan measures unmodified against a third, independently-classified,
      deliberately-uncleaned reference game.
  - plan: 177-16
    provides: The `boardsmith ingest-archive` provenance-recording pattern this plan reuses (and
      whose single-source limitation this plan empirically confirms and reports for the first time
      on a two-source-PDF project).
  - plan: 177-17
    provides: composeArithmeticChain, the absence-classification branch, and the 13/14
      genuine-second-opinion baseline this plan compares against.
provides:
  - A real, third-game measurement (doom-machine, 11 rule slices, 19 Derived lines, 2 source PDFs,
    42 real claude -p dispatches across two runs) answering whether CHECK-04's replacement
    generalizes beyond the two small hand-prepared games it was built on.
  - A confirmed, load-bearing CODE DEFECT: buildEnumeratorPayload's annotation-stripping filter and
    its own construction-site backstop are both keyed to the "Derived (p." citation form; a slice
    using the file's OWN stated convention without a page-citation parenthelical ("Derived: ...")
    leaks the Derived line's own text into the enumerator payload SILENTLY — no throw, no warning —
    reproducing the retired design's exact "confirmation, not independence" failure mode on 2 of
    CARDS.md's 5 Derived lines.
  - A confirmed single-source limitation in `boardsmith ingest-archive`: a project with two source
    PDFs cannot have both provenances recorded; the second `ingest-archive` call silently overwrites
    the first's Source:/Source hash: header, and QuoteVerifiedProvenance is per-PROJECT not
    per-slice, so once one source is recorded, suspect findings in slices sourced from the
    UNRECORDED PDF are indistinguishably treated as quote-verified.
affects: [the-orchestrator-disposition-of-CHECK-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-registering four concrete, falsifiable failure predictions in a file committed ALONE
      before any dispatch (c3809bd9), naming exact thresholds and exact lines expected to be
      affected — continuing 177-06/177-12/177-15's discipline into a third-game context where the
      predictions could be, and were, partially wrong in informative ways (the L34 'flip' traced to
      a harness/citation-granularity artifact, not a genuine design failure; the L30/L140 flips
      traced to a real code defect the pre-registration did not anticipate at all)."
    - "When buildEnumeratorPayload's REAL construction-site backstop threw on CARDS.md (a genuine,
      reproduced firing of the exact safety mechanism 177-15 built), the correct response was not to
      patch the filter — it was to disclose a scoped, minimal, explicitly-labeled workaround (strip
      the one offending residual line) so measurement could continue on the file's OTHER lines,
      and report the throw itself as the primary finding. Fixing the filter would have been
      undisclosed post-hoc tuning; not measuring CARDS.md at all would have thrown away the
      corpus's most informative slice."
    - "Discovered a SECOND, SILENT instance of the same underlying gap the backstop is supposed to
      catch — bare 'Derived:' lines with no page-citation parenthetical — only by diffing the
      actual assembled payload against grep results for 'Derived', not by trusting the backstop's
      silence as proof of safety. The backstop covers the form it was written against; it does not
      cover forms it was never told about, and CARDS.md's own documented two-bucket convention
      (QUOTE/Derived, no page citation required) is exactly such a form."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/PRE-REGISTRATION.md
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/analysis-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/analysis-run2.json
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/run1/ (enum/ + reconcile/, 33 real dispatch records)
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/run2/ (enum/ + reconcile/, 9 real dispatch records — determinism subset)
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/payloads/ (11 slices' buildEnumeratorPayload output + derived-line extracts + the CARDS.md deviation record)
    - .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/originals-before.sha256, rules-cards-pdf.sha256, rulebook-md-files.sha256
  modified: []
  # Game-repo change, not this repo:
  # ~/BoardSmithGames/doom-machine/rulebook/INDEX.md (+3), rulebook/source/rules.pdf (new) — commit 245ee31

decisions:
  - "Recorded provenance for rules.pdf only, not cards.pdf. Empirically confirmed (test-then-revert,
    not reasoned from code alone) that a second `ingest-archive` call silently overwrites the first's
    Source:/Source hash: header — there is no multi-source representation. Chose rules.pdf because it
    sources 10 of 11 slices; disclosed, not hidden, that CARDS.md's cards.pdf provenance cannot
    currently be recorded at all without destroying the rules.pdf record."
  - "Did NOT fix buildEnumeratorPayload's filter or backstop after finding the silent bare-'Derived:'
    leak, per honesty discipline (no post-hoc tuning). Reported both instances (the loud L270 throw
    and the silent L30/L140 leak) as findings for the orchestrator, with the exact regex gap named."
  - "CARDS.md's one mid-line-annotation residual (original line 270) was manually stripped from
    quoteLinesOnly() output before dispatch — disclosed as a deviation, not the real shipped
    buildEnumeratorPayload path — specifically so the file's OTHER 4 Derived lines could still be
    measured. The throw itself (a real, reproduced firing of a real safety mechanism) is reported as
    a finding, not worked around silently."
  - "3-slice determinism re-run subset (01-objective-and-setup.md, 02-card-effect-icons.md, CARDS.md)
    chosen to cover the three predicted-interesting cases (arithmetic, cross-slice reference,
    sight-line self-sorting) rather than a random sample — deliberately maximizing the chance of
    catching instability, per the pre-registration's own stated purpose."

# Metrics
metrics:
  duration: "~2.5 hours (dispatch-bound: 42 real claude -p calls, several minutes each on CARDS.md's
    18K-character payload)"
  completed: 2026-07-31
---

# Phase 177 Plan 18: CHECK-04 Replacement — Third Reference Game (`doom-machine`) Summary

Ran the real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`,
`enumerate-facts.md`, `reconcile-facts.md`) against `doom-machine` — 11 rule slices, 19 `Derived`
lines, 2 source PDFs, deliberately left uncleaned since its 2026-07-12 transcription. 42 real
`claude -p` dispatches across two runs (33 for the full corpus, 9 for a 3-slice determinism
re-check), two model families for enumeration, a third for reconciliation, exactly per the
177-15/177-17 measurement pattern. **Result: mixed, and the most important finding is a real code
defect, not a soft "corpus is different" observation.** The design's core selling point over the
retired per-line design — structural independence, nobody can see what they're supposedly verifying
— silently broke on 2 of CARDS.md's 5 lines, reproducing the retired design's exact "confirmation,
not independence" failure mode, because CARDS.md's own documented transcription convention uses a
`Derived:` annotation form the filter and its backstop were never built to recognize.

## Provenance and the two-PDF edge case

Recorded provenance via the real `boardsmith ingest-archive rules.pdf --json` — one command, no new
mechanism. Before doing so, empirically tested (not just reasoned about) what happens with a second
source PDF: ran `boardsmith ingest-archive cards.pdf --json` against the same project, confirmed via
diff that it silently overwrote the `Source:`/`Source hash:` header with `cards.pdf`'s values,
discarding `rules.pdf`'s record entirely, then reverted via `git checkout -- rulebook/INDEX.md` and
removed the transient archived copy. **`boardsmith ingest-archive` has no multi-source
representation.** Recorded `rules.pdf`'s provenance only (it sources 10 of the 11 slices), and
verified live that `QuoteVerifiedProvenance.obtain()` now returns non-null for the whole project —
which means CARDS.md's `cards.pdf`-sourced suspect findings are ALSO treated as quote-verified,
despite `cards.pdf` never having been checked. `QuoteVerifiedProvenance` is a per-PROJECT flag, not
per-slice; this project structurally cannot represent "this source is verified, that one isn't."
Disclosed as a real, reasoned-through gap — not fixed, not hidden.

## The measurement

**Pre-registration committed alone** (`c3809bd9`, `git show --stat` lists exactly one file) before
any dispatch, naming four concrete failure predictions with exact thresholds and exact lines named.

**A real construction-site throw, on the first payload-build attempt.** `buildEnumeratorPayload`
threw for `CARDS.md` exactly as designed: `+ = / >`). Derived (p.3), by symmetry..." (original line
270) buries `Derived (p.3),` mid-sentence, after other quoted card text, inside a nested list
continuation — not line-initial, so `quoteLinesOnly`'s line-initial-only decoration stripping missed
it, and the construction-site backstop caught the leak and threw rather than silently including it
in a dispatch prompt. This is the safety mechanism working exactly as 177-15 built it. To still
measure CARDS.md's other 4 lines, the ONE offending residual line was manually stripped from
`quoteLinesOnly()`'s real output before assembly — a disclosed, one-off workaround, not the shipped
path, recorded in `payloads/CARDS.md.deviation.json`.

**All 11 slices dispatched**, 2 enumerators (`claude-opus-5`, `claude-haiku-4-5-20251001`) + 1
reconciler (`claude-sonnet-5`) each, real `claude -p` calls, real `enumerate-facts.md`/
`reconcile-facts.md` contracts, unmodified. `~/BoardSmithGames/doom-machine`'s `rules.pdf`,
`cards.pdf`, and all 14 `rulebook/*.md` files confirmed byte-identical (sha256) before and after
every dispatch.

## Headline finding — a real, silent, second instance of the leak the backstop is supposed to prevent

While diffing the assembled `CARDS.md` payload for the report below, found that TWO of CARDS.md's
five `Derived` lines use a bare `Derived:` form with **no page-citation parenthetical** —
`Derived: the yellow-vs-grey connector colour is the reliable tell for live-vs-dead...` (original
line 30) and `(Derived: effectively a 2-space loop...)` (original line 140) — exactly matching
CARDS.md's own stated convention (`"Anything else is marked 'Derived'"`, no page-citation
requirement). Both `DERIVED_LINE_RE` (`^Derived \(p\.[^)]*\)`) and the construction-site backstop's
`ANY_ANNOTATION_LINE_RE` (`Derived \(p\.|Visual \(p\.|Named-but-undefined \(p\.`) require the `(p.`
parenthetical. Neither recognizes a bare `Derived:` line. **Both lines leaked verbatim into the real
dispatch payload both enumerators received — silently, no throw, no warning** (confirmed: `grep -n
Derived` against the assembled payload file shows both lines present; confirmed absent from all
other 10 slices' payloads, which uniformly use the `(p.` form).

This is the same failure class the mid-line L270 case triggered, but WITHOUT the safety net: the
backstop covers the form it was written against, not every form CARDS.md's own convention actually
uses. The practical consequence: **for these two lines, "corroboration" is not independent
verification at all** — both enumerators saw the exact sentence under test sitting in their
"quote-only" payload and could restate it as a "fact" without ever having derived anything,
reproducing the RETIRED per-line design's exact fatal flaw (confirmation, not independence) that
this entire replacement design exists to close. Traced directly to the two determinism flips below.

## Determinism — did NOT fully hold, and now the cause is known precisely

3-slice re-run subset (`01-objective-and-setup.md`, `02-card-effect-icons.md`, `CARDS.md`), same
inputs, fresh dispatches:

| Line | Run 1 | Run 2 | Explanation |
|---|---|---|---|
| `01-objective-and-setup.md` L34 (9−3=6) | `uncorroborated` | `corroborated-by-composition` | **Not a design flip.** The reconciler cited 3 facts in run 1 (2 genuine numeric operands + 1 non-numeric "Doom Core sits at the bottom" supporting fact) vs. 2 clean numeric operands in run 2. `composeArithmeticClaim` requires EVERY passed operand to carry a numeric value, with no filtering step to separate "arithmetic operand" from "supporting context fact" — passing all of the reconciler's `citedBothStatements` (as `reconcile-facts.md` explicitly invites: "Name which 'found by both' facts you believe are the operands") caused a spurious total refusal in run 1. Manually re-ran `composeArithmeticClaim` with only the two genuine numeric operands: **succeeds, 9−3=6, exactly as the rulebook states.** Real integration gap: neither the contract nor the code distinguishes numeric operands from supporting facts in a `corroborated-by-composition` citation list.
| `CARDS.md` L30 (connector-colour REQUIRES-SIGHT) | `uncorroborated` | `corroborated` | **The leak.** Both runs' enumerators saw the identical leaked `Derived:` sentence in their payload (the payload is built once, deterministically, and reused for both runs) — whether a model happens to restate a leaked annotation as its own "enumerated fact" is real, observed model-level stochasticity, not a stable property of the design.
| `CARDS.md` L140 (2-space-loop REQUIRES arithmetic/logic) | `uncorroborated` | `corroborated` | Same leak, same explanation. |

All other classifications (16 of 19 lines, including the two cross-slice `uncorroborated` cases and
every non-CARDS.md `corroborated` line) were stable — not re-run for all 19, but the 3-slice subset
was deliberately chosen to cover the three most failure-prone cases, and 2 of its 9 lines (excluding
the harness-artifact one) genuinely flipped for a real, now-identified cause.

## Full 19-line classification (run 1, primary)

| Classification | Count | Lines |
|---|---|---|
| `corroborated` — non-CARDS.md slices | 9 | card-anatomy L11, destroying L16, gameplay-loop L13, objective-setup L36/L38, hard-mode L19, machine-phase L26, taking-damage L9/L11 |
| `corroborated` — CARDS.md, clean | 2 | CARDS L70, L270 |
| `corroborated` — CARDS.md, MIXED (caveat, see below) | 1 | CARDS L19 |
| `uncorroborated` in run 1, but demonstrably `corroborated-by-composition` (harness/citation-granularity artifact, not a design failure — see determinism table) | 1 | objective-setup L34 |
| `uncorroborated` — genuine dual-enumeration miss (compound-sentence synthesis, same class 177-15 named) | 1 | dice-roll-symbology L25 |
| `uncorroborated` — approximate-flag correctly refused composition ("up to 5" hedge — see "up to N" note below) | 1 | gameplay-loop L15 |
| `uncorroborated` — cross-slice reference (structural, new) | 2 | card-effect-icons L25, player-actions L23 |
| `uncorroborated` in run 1 / `corroborated` in run 2 — leak-dependent, untrustworthy either way | 2 | CARDS L30, L140 |

19 lines total, matching `analysis-run1.json`.

## Answering the five questions

**1. Does the corroboration rate hold on a larger, uncleaned corpus?** Partially, with one sharp
exception. Grounding rejections on the 10 non-CARDS.md slices: **0/143 (0%)** — identical to the
prior corpus's 0/221 baseline, across genuinely denser, uncleaned, real rule text. On CARDS.md
alone: **32/98 (32.7%) in run 1, 1/145 (0.7%) in run 2** — real, reproduced fabrication-adjacent
reconciler behavior on a large (98-claim), repetitive, tabular corpus (per-card roll conditions and
damage strips), concentrated entirely in that one file. **`validateGrounding` caught and rejected
every one of them** — zero false corroborations from grounding failures. The honest answer: the
rate holds on ordinary-density, ordinary-convention rulebook text; it does not hold uniformly on a
dense, repetitive, tabular file, though the safety net catches the difference rather than passing it
through silently.

**2. Do CARDS.md's misfiled sight lines self-sort into uncorroborated?** Three of five did, cleanly:
L70 (text-derivable) correctly corroborated, and — setting the leak aside — the design's intended
mechanism worked once. But **L19, the file's own "clearest case of double duty" (per the independent
classification), produced a misleading `corroborated` verdict**: the reconciler corroborated only
the compound line's TEXT-DERIVABLE half (per-card cycle-track position lists, genuinely stated in
the passage) while the REQUIRES-SIGHT half (the physical "inverted-L" geometric shape) was never
checked at all, because dual enumeration has no way to partially verify a compound claim. A reader
trusting the binary `corroborated` label would wrongly conclude the geometric claim is supported
too. This is a real, structural limitation this design has no mechanism to represent, distinct from
and worse than a clean self-sort.

**3. Grounding-rejection count?** 0/221 on the prior corpus; **0/143 + 33/241** here — the 33
CARDS.md rejections are the headline, not a footnote, and are reported as such.

**4. Do the newer categories fire correctly on real data they weren't built from?** Multi-step
arithmetic: fires and works once operand filtering is done correctly (L34, 9−3=6) — but a real
integration gap (numeric-vs-supporting-fact filtering) caused it to spuriously fail in run 1.
Absence classification: **never proposed at all** — no plain absence-claim `Derived` line exists in
this corpus, confirming the category is genuinely inert (not broken) when the corpus doesn't need
it. New "up to N" finding: `enumerate-facts.md`'s "hedge word → approximate:true" rule (built from
the "about 7 minutes" false-precision case) correctly fired on "may gain up to 5 additional yellow
dice," but "up to N" in this rulebook means a HARD CAP (exactly 5 is the maximum, stated elsewhere
as a precise "10 dice" total), not a fuzzy estimate — the SAME word conflates two different
real-world senses, and the conservative refusal is arguably correct (composing an unverified cap is
still a real risk) but produces a real, demonstrable false negative (`gameplay-loop-and-phase-i.md`
L15) on a fact that IS independently and directly corroborated elsewhere (`destroying-a-machine-
part.md` L16, whose Derived line quotes the same "10 dice" cap as a directly-stated fact, not a
composition).

**5. New failure modes this corpus exposes that the two small games could not:**
- The silent bare-`Derived:` annotation leak (above) — the single most serious finding of this run.
- The loud mid-line-annotation throw (`CARDS.md` L270's original text) — the backstop worked, but
  the fact that it fired on the FIRST real dispatch of a third game shows the filter's line-initial
  assumption is not robust to real-world transcription variance.
- Cross-slice references (`card-effect-icons.md` L25, `player-actions.md` L23) — dual enumeration is
  scoped per-passage; a `Derived` line synthesizing a claim whose corroborating sentence lives in a
  DIFFERENT slice is structurally invisible to this design, and both cases resolved honestly to
  `uncorroborated` rather than fabricating a match — a real design gap, correctly NOT masked.
- The numeric-vs-supporting-fact operand-filtering gap in `corroborated-by-composition` citations.
- The "up to N" hard-cap-vs-estimate ambiguity in the approximate-flagging heuristic.
- The two-source-PDF provenance limitation (project-level `QuoteVerifiedProvenance`, not per-slice).

## Comparison to the prior baseline

Prior corpus (177-17, 14 lines, 2 small hand-cleaned games): 13/14 lines got a genuine independent
second opinion, 0 contradicted, 0 fabrications passed grounding, fully deterministic across 2 runs.
This corpus (19 lines, 1 larger uncleaned game): the ordinary-convention slices (14 of 19 lines)
reproduce that picture closely — 0 grounding rejections, determinism held on every one re-checked.
**CARDS.md (5 of 19 lines) does not reproduce it**: real grounding rejections concentrated there, a
real silent independence-breaking leak on 2 of its 5 lines, and one compound line that launders a
REQUIRES-SIGHT claim through its TEXT-DERIVABLE sibling. The honest overall verdict: **the design
generalizes well to rulebook text that follows the same annotation convention the design was built
against, and breaks in specific, now-precisely-identified ways when a real project's corpus departs
from that convention** — which is exactly the kind of corpus a real, non-hand-prepared project
produces.

## Deviations from Plan

**1. [Rule 1 - harness bug, caught during analysis] `analyze.mjs`'s arithmetic-composition attempt
used an empty-string `unit` for candidate results, which `composeArithmeticClaim`'s own validation
correctly rejects.**
- **Fix:** derive `resultUnit` from the first named operand's own unit (or fall back to `'value'`).
- **Files modified:** scratchpad-only harness (`analyze.mjs`), not shipped code.

**2. [Disclosed workaround, not a Rule 1-3 auto-fix] `CARDS.md`'s one mid-line `Derived (p.3),`
residual (original line 270) was manually stripped from `quoteLinesOnly()`'s real output before
assembly, so the file's other 4 lines could still be dispatched. This is NOT the shipped
`buildEnumeratorPayload` path** — the real function still throws on this file unmodified, exactly as
designed. Recorded in `177-18-MEASUREMENT/payloads/CARDS.md.deviation.json`.

No product code in this repository (`src/cli/commands/verify-enumerate.ts`, `verify-derive-
recheck.ts`, or either contract file) was modified. The bare-`Derived:` leak and the operand-
filtering gap are reported as findings for the orchestrator, not fixed here, per honesty discipline.

## Known Stubs

None — this plan writes no application code.

## Threat Flags

None. No new network endpoint, auth path, or file-access pattern. The `boardsmith ingest-archive`
single-source limitation and the `QuoteVerifiedProvenance` per-project scope are pre-existing
behaviors of already-shipped, already-reviewed code, newly exercised here — not introduced by this
plan.

## Self-Check: PASSED

- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/PRE-REGISTRATION.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/analysis-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/analysis-run2.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/run1/ (33 dispatch records)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/run2/ (9 dispatch records)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-18-MEASUREMENT/payloads/CARDS.md.deviation.json
- FOUND commit (this repo): c3809bd9 "docs(177-18): commit pre-dispatch expectation for CHECK-04 third-game measurement, alone"
- FOUND commit (doom-machine repo): 245ee31 "docs(rulebook): record source provenance (archive rules.pdf + hash)"
- CONFIRMED: `~/BoardSmithGames/doom-machine/rules.pdf`, `cards.pdf`, and all 14 `rulebook/*.md`
  files byte-identical (sha256) before this plan's work began and after all 42 dispatches completed.
- CONFIRMED: the bare-`Derived:` leak — `grep -n Derived` against the real assembled `CARDS.md`
  payload shows both offending lines present; the same grep against all 10 other slices' assembled
  payloads shows zero matches.

## Full test run

`npm test`: **4109/4109 passed**, full suite, run from `/Users/jtsmith/BoardSmith`. Unchanged from
the 177-17 baseline — this plan modified no BoardSmith source file.
