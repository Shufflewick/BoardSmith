# Track A Findings — Existing derive-recheck mechanism, asked only answerable questions

Throwaway experiment. Nothing written to the repository; no git commits. All work happened in
scratchpad copies (`.../scratchpad/track-a/`). Originals confirmed byte-identical (sha256)
before and after; `git status --porcelain` in the BoardSmith repo is empty; no processes left
running.

## Pre-registered expectation

Written and frozen BEFORE any dispatch: `.../scratchpad/track-a/PRE-REGISTERED-EXPECTATION.md`.
Summary of the concrete, falsifiable claim made in advance: predicted **3/7 (43%)**, matching the
paper re-scoring already computable from Phase 177's own recorded per-line data, with one flagged
uncertainty (`seven:21` might flip from FAIL to PASS once `seven:19` is removed from the corpus,
because `targetingAmbiguous` is computed against the currently-enumerated `Derived` population).
Explicitly predicted the mechanism would NOT become reliably useful — "remains close to a coin
flip on the clean population too (2-4 out of 7)" — and predicted `seven` would continue to
underperform `one-two-punch`.

## Method actually executed

1. `cp -R` both reference games from `174-FIXTURES/{seven,one-two-punch}` into scratchpad.
   sha256 of the whole original tree recorded before and after all work; diff empty (confirmed
   above and re-confirmed at the end of this run).
2. Re-tagged the 8 agreed-REQUIRES-SIGHT lines from `Derived (p.N):` to `Visual (p.N):`,
   byte-identical content otherwise, in the scratchpad copies only:
   `seven/live/01-definitions-and-components.md:8,14,19,33`,
   `seven/live/01-overview-setup-and-play.md:42`, `seven/live/02-solo-variant.md:17`,
   `one-two-punch/live/02-action-cards-and-resolution.md:49,89`.
   `seven/02-solo-variant.md:11` (the disputed line) was left untouched.
3. Ran the real `boardsmith verify-derive-recheck --json` (built CLI, not a library import) against
   each retagged copy (restructured as `rulebook/` project dirs, since the CLI reads
   `<project>/rulebook/*.md` directly — the `live/` fixture naming is 174-FIXTURES' own archival
   convention, not the CLI's expected layout). Enumeration mechanically confirmed the clean
   population is exactly the 7 lines predicted, plus the disputed `seven:11` as an 8th real
   candidate that was never retagged:
   - `seven`: `enumeratedCount: 4` — lines 21, 36, 38, 11.
   - `one-two-punch`: `enumeratedCount: 4`, `presentationExcludedCount: 6` — lines 30, 52, 82, 95
     (the pre-existing 6 explicitly-qualified `diagram description`/`art` lines stay excluded;
     the newly retagged 49/89 vanish from the `Derived (p.` scan entirely rather than appearing in
     `presentationExcludedCount`, because the regex `DERIVED_LINE_RE` only matches lines that
     still start with `Derived (p.` — a `Visual (p.N):` line never enters that scan at all. Net
     effect is identical: never dispatched.)
4. Built the real blind-derivation dispatch prompts using `buildBlindDerivePayload` /
   `blindDeriveHandle` / `enumerateDerivedLines` (the same exported functions the orchestrator
   contract in `derive-recheck.md` describes constructing) via a throwaway `tsx` script reading
   the built module directly — there is no separate "dump payload" CLI verb; this is how the
   production orchestrator itself is architected to build dispatches. Dispatched each of the 8
   payloads as a REAL `claude -p` call carrying the full `derive-recheck.md` contract text plus
   the `BS-DERIVE-V1` token and payload, one process per line, none run in parallel/background.
5. Dispatched the compare stage for each of the 8 as a REAL `claude -p` call carrying the full
   `derive-compare.md` contract, the `BS-DERIVE-COMPARE-V1` token, the original `Derived` line,
   and the blind stage's own structured return — never re-deriving, per contract.
6. Recorded all 8 verdicts through the real, registered `boardsmith verify-derive-record` CLI
   (never a driver/library import) into each project's own `rulebook/.derive-recheck/
   DERIVE-VERDICTS.md` ledger.
7. Re-ran `boardsmith verify-derive-recheck --json` on both projects to confirm Condition 4
   (Recording): both reports show `staleRecords: []`, `orphanedRecords: []`, and every finding
   carries a real verdict — zero `pending`.
8. Checked Condition 2 (Independence) directly against the 8 real dispatch payloads sent this run:
   zero `Derived (p.`/`Visual (p.` matches, and zero occurrences of each candidate's own
   `slicePath` or line-number substring inside its own payload.

## Per-line result table (Phase 177's own four conditions applied)

Condition 3 (Targeting) PASS requires: `factAlignment: same-fact` (for `agrees`) or a legitimate
terminal blind outcome (`underivable`/`not-rule-bearing`), AND `targetingAmbiguous: false`.

| Line | Verdict | factAlignment | targetingAmbiguous | Cond. 1/2/4 | Cond. 3 | Overall |
|---|---|---|---|---|---|---|
| `seven:21` | agrees | same-fact | false | OK | **PASS** | **PASS** |
| `seven:36` | disagrees | different-fact | **true** (shares w/38) | OK | FAIL (ambiguous + off-target) | FAIL |
| `seven:38` | disagrees | different-fact | **true** (shares w/36) | OK | FAIL (ambiguous + off-target) | FAIL |
| `one-two-punch:30` | agrees | same-fact | false | OK | **PASS** | **PASS** |
| `one-two-punch:52` | disagrees | different-fact | false | OK | FAIL (off-target) | FAIL |
| `one-two-punch:82` | disagrees | different-fact | false | OK | FAIL (off-target) | FAIL |
| `one-two-punch:95` | underivable (legitimate — blind stage itself returned `underivable`) | — | false | OK | **PASS** | **PASS** |
| `seven:11` (**disputed, reported separately, NOT in the clean-7 score**) | disagrees | different-fact | false | OK | FAIL (off-target) | FAIL |

No line failed Condition 1, 2, or 4 in this run — same pattern 177 itself found: every failure
here is a Condition 3 (targeting) failure.

## Score

**Clean population (7 lines): 3/7 PASS = 42.9%.**

Passing: `seven:21`, `one-two-punch:30`, `one-two-punch:95`.
Failing: `seven:36`, `seven:38`, `one-two-punch:52`, `one-two-punch:82`.

**Disputed line `seven:11` (reported separately, per instructions): FAIL** (off-target,
`disagrees`/`different-fact`, unique focus window — matches 177's own original recorded outcome
for this line). If folded in as an 8th candidate: 3/8 = 37.5% — coincidentally identical to 177's
full-corpus 16-line baseline, though that identity is not meaningful (different denominator,
different population).

## Per-game split

- `seven` clean population (21, 36, 38): **1/3 PASS = 33%.**
- `one-two-punch` clean population (30, 52, 82, 95): **2/4 PASS = 50%.**

## Comparison to both baselines

- Phase 177's own full-corpus baseline: **6/16 = 37.5%** (16-line population, contaminated with
  8 REQUIRES-SIGHT lines).
- Paper re-scoring predicted from 177's existing per-line data (no re-dispatch): **3/7 = 43%.**
- This run's fresh re-dispatch on the clean 7-line population: **3/7 = 42.9%.**

The fresh re-dispatch reproduces the paper re-scoring's number almost exactly, but the
**composition differs**, which matters for honesty here: this was NOT the same 3 lines passing
for the same reasons.
- `seven:21` FAILED in 177's original run (`targeting-ambiguous`, shared focus with `seven:19`)
  but PASSED here, because retagging `seven:19` out of the corpus removed the ambiguity —
  confirming the uncertainty flagged in the pre-registration.
- `one-two-punch:82` PASSED in 177's original run (`agrees`/`same-fact`) but FAILED here
  (`disagrees`/`different-fact`) — a fresh blind dispatch of the identical payload landed on a
  different fact (timing/resolution order) than the original run's dispatch did (Rest-card
  count), off the same Tip-region focus passage. This is itself evidence the targeting failure
  is non-deterministic across dispatches, not a fixed property of the payload.

These two changes happen to cancel out numerically (3/7 both times) but are NOT the same finding
reproduced twice — they are two different draws from what looks like a genuinely unstable
process.

## What this confirms about the "what we actually want to learn" questions

**Does the mechanism become USEFUL when asked only answerable questions?** No. 3/7 (43%) is not
meaningfully better than a coin flip, and is barely better than 177's own contaminated 37.5%
baseline. The residual failure mode 177 already identified — "narrowing the payload's TOPIC did
not reliably narrow the blind subagent's own DERIVATION" — persists undiminished once
contamination is removed. This run adds direct confirmation that the SAME correctly-scoped focus
passage can produce a different targeting outcome (`one-two-punch:82`) on a second independent
dispatch, which is a stronger and more concerning finding than 177 itself established (177 never
re-dispatched the same line twice to check for this).

**Does the clean re-run confirm slice density as the residual failure mode, distinct from
contamination?** Partially, and with an important complication. `seven:36`/`seven:38` DO confirm
it directly: both survive retagging as genuine `Derived` lines, both still share one citation
header (the match-length paragraph), and the mechanism's own `targetingAmbiguous` flag still
fires on both — this is exactly the slice-density mechanism the background predicted, unaffected
by removing the 8 sight-only lines. But `seven:21` complicates the story: it was ALSO a density
casualty in 177's original run (sharing with `seven:19`), and removing `seven:19` (a REQUIRES-
SIGHT line) from the corpus is enough to eliminate that particular density collision and let
`seven:21` pass. So density is confirmed as a real, distinct failure mode for the pairs that
survive contamination-removal (36/38), but the ORIGINAL 177 corpus's total ambiguous count (4)
was itself partly a contamination artifact: some of the sharing was between a real inference and
a sight-only line that should never have been a `Derived` candidate at all. Removing contamination
doesn't just remove candidates — it also removes some (not all) of the density collisions those
candidates caused.

**Per-game split — does one-two-punch 3/4 / seven 0/3 hold?** Not exactly, but the direction
holds. Predicted `seven` 0/3, actual `seven` 1/3 (33%). Predicted `one-two-punch` 3/4 (75%),
actual `one-two-punch` 2/4 (50%). `one-two-punch` still outperforms `seven` on this clean
population, consistent with the general asymmetry claim, but the specific numbers from the
background note (drawn from 177's un-re-dispatched data) did not survive a fresh, independent
re-dispatch. `one-two-punch:82`'s flip from PASS to FAIL specifically is what closes the gap
between the prediction and the observed result.

## What this does and does not establish

**Does establish:**
- The 8 agreed sight-only lines really were being asked an unanswerable question in 177's
  original run, and retagging them out is mechanically effective — enumeration confirms exactly
  the predicted 7-line (+1 disputed) clean population, with zero silent drops.
- Removing that contamination does not turn the mechanism from "broken" into "useful." The clean
  score (43%) is barely different from the contaminated baseline (37.5%), and both are close to
  chance for a four-verdict-but-effectively-binary-pass/fail check.
- At least one clean-population line (`one-two-punch:82`) produces a DIFFERENT targeting outcome
  on a second independent fresh dispatch than it did in 177's original run against the same
  underlying quote material — direct evidence the targeting failure has a non-deterministic
  component, not purely a fixed property of any one payload's construction.
- Slice/citation-header density (`seven:36`/`38`) is confirmed as a real, contamination-
  independent failure mode.

**Does NOT establish:**
- A reliable, generalizable pass rate for the mechanism on answerable-only questions. **n=7 is
  too small to support a confident point estimate** — the single-line flips discussed above
  (`seven:21`, `one-two-punch:82`) each move the score by roughly 14 percentage points, which
  means this specific 43% is fragile, not a stable characterization of the mechanism's true
  reliability. A single additional independent re-run could plausibly land anywhere from 2/7
  (29%) to 5/7 (71%) on the evidence gathered here.
- Whether the non-determinism observed in `one-two-punch:82` is typical or a one-off — this run
  dispatched each line exactly once; no line was re-dispatched multiple times to characterize its
  own variance, because the task scope was one clean pass, not a variance study.
- Anything about the 8 retagged (excluded) lines' own correctness as `Visual` classifications —
  that question was already answered by the two independent classification passes this
  experiment consumed as a precondition, not re-litigated here.

## Honesty discipline compliance

- Pre-registered expectation written and frozen before dispatch (see file above); not edited
  after seeing results.
- No parameter, prompt, or contract text was altered to move the outcome. The contract files
  (`derive-recheck.md`, `derive-compare.md`) were used byte-identical from the source repo.
- One compare-stage dispatch (`seven:38`) initially emitted a stray malformed line before self-
  correcting to a valid JSON object in the same response; the LAST, well-formed JSON object in
  that response was used, unmodified — no re-dispatch, no cherry-picking a more favorable answer.
- The result (43%, not meaningfully better than chance, composition unstable across an identical
  payload) is reported as-is, including the parts that complicate the pre-registered predictions
  (the `seven:21` flip, the `one-two-punch:82` flip) rather than only the parts that matched.
