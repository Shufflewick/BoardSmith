# 177-15 Pre-Registration — dual-enumeration + reconciliation, real dispatches

Timestamp: 2026-07-30, before any `claude -p` call for this plan. Committed alone, in its own
commit, per this plan's honesty-discipline requirement — `git show --stat` on that commit lists
only this file.

## What is being measured

The assembled design this plan's Task 1 wrote as skill text (`verify/enumerate-facts.md`,
`verify/reconcile-facts.md`), driving the already-built, already-tested mechanical core
(`verify-enumerate.ts`, 177-14), run end-to-end on the real, re-transcribed, quote-verified
`177-FIXTURES/` corpus — NOT `174-FIXTURES/`, which the experiments proved carries a labeling
defect (image lines misfiled as `Derived`) this corpus fixes.

This is the FIRST real dispatch of these two contracts. `TRACK-B-FINDINGS.md` measured the design
with hand-written prompts, on the stale corpus, with the reconciler cross-referenced BY HAND rather
than through code (`validateGrounding`/`classifyDerivedLines`/`composeArithmeticClaim`). This run
is the first to combine: the actual skill-text contracts, the actual quote-verified corpus, and the
actual mechanical grounding/composition/provenance code — the first time all three pieces of this
design run together for real.

## Corpus and dispatch plan

5 rule slices (matching Track B's granularity choice, for comparability):
- `seven/live/01-definitions-and-components.md` (1 Derived: L21, arithmetic)
- `seven/live/01-overview-setup-and-play.md` (2 Derived: L36 arithmetic, L38 non-arithmetic)
- `seven/live/02-solo-variant.md` (0 Derived — the seven:11 truncated-quote defect that produced
  this line no longer exists in the re-transcribed corpus; included anyway for parity with
  Track B and because it still has quote content to enumerate)
- `one-two-punch/live/01-setup-and-round-structure.md` (4 Derived: L32, L61, L68, L81, all
  non-arithmetic direct statements)
- `one-two-punch/live/02-action-cards-and-resolution.md` (7 Derived: L16, L68, L82, L106, L117,
  L128, L132, all non-arithmetic)

11 real `Derived` lines total (`seven` 3 + `one-two-punch` 8 in these 5 files — `one-two-punch`
has 11 total across the whole corpus per `177-FIXTURES/README.md`; the 8 above are the ones in
these two files, matching the README's per-file split). Only 2 of the 11 state arithmetic
(`seven` L21, L36) — the `otp` "16÷2=8" arithmetic line from the OLD corpus does not exist in this
one; `otp`'s box-contents line (L32) states the total directly, not as a computed quotient.

Two enumerators per passage, different model families:
- Enumerator A: `claude -p --model claude-opus-5`
- Enumerator B: `claude -p --model claude-haiku-4-5-20251001`

One reconciler per passage: `claude -p --model claude-sonnet-5` (a third, distinct dispatch/model
from both enumerators).

10 enumerator dispatches + 5 reconciler dispatches = 15 real `claude -p` calls, matching Track B's
budget for the same corpus shape.

## Safety

`~/BoardSmithGames/seven` and `~/BoardSmithGames/one-two-punch` are read-only inputs to this
measurement — sha256 of every file under each game's `rulebook/` dir recorded before dispatch and
re-checked after, confirmed byte-identical. No `claude -p` dispatch is given write access or a
working directory inside either game; all prompts are assembled from the already-archived
`177-FIXTURES/` copies (not the live `~/BoardSmithGames` trees) and all output is written under
this plan's scratchpad, never back into `~/BoardSmithGames`.

## What I expect

Based on `TRACK-B-FINDINGS.md`'s hand-measurement of this same design (different corpus, hand
cross-reference, no code-side grounding check):

1. **Grounding rejections: I expect a NONZERO but SMALL number** — somewhere in the 0-3 range
   across the 5 reconciler dispatches. Track B measured the reconciler-fabrication failure mode
   twice during earlier, less-constrained development of this same idea (the "5 cards each" and
   invented-arithmetic-grounding cases the contract now names explicitly as measured failures) —
   but this run's reconciler contract explicitly forbids both, with worked failure examples, which
   Track B's hand-written prompts did not have. I expect the contract's explicit prohibition to
   reduce, not eliminate, fabrication. Zero rejections would be a mildly positive surprise; I would
   not fully trust a zero on a 5-dispatch sample (too small to claim the fabrication risk is
   closed) and will say so explicitly if it happens.

2. **Arithmetic composition: I expect `composeArithmeticClaim` to REFUSE at least one of `seven`
   L21 (7×4×4=112) and L36 (round-count math), for the SAME structural reason Track B measured**
   — neither enumerator is instructed to compute the final product/sum, only to enumerate the
   ingredient facts, so the composed claim will only succeed if the reconciler correctly names the
   grounded ingredient facts as operands AND the `Derived` line's own text literally restates every
   operand's magnitude as a digit (a real, sometimes-failing precondition `composeArithmeticClaim`
   enforces). L21's text ("7 numbers x 4 colors x 4 copies = 112") states all three operands as
   digits, so if the reconciler correctly proposes it as `corroborated-by-composition` with the
   right three operands, I expect it to VERIFY. L36's text ("starting at 3 cards and ending at 10
   cards means 7 rounds") is a subtraction (10-3=7) where the source states all three numbers, so
   the same applies IF the reconciler proposes the right operands and operation. My concrete
   prediction: **at least one of the two composes/verifies successfully; if BOTH refuse, that is a
   real negative finding about the reconciler's ability to even PROPOSE the right composition
   (distinct from the code's ability to verify one correctly proposed)**, worth reporting plainly.

3. **Classification distribution over the 11 Derived lines: I expect roughly half to land
   `corroborated` (the direct, single-sentence restatement lines — `otp` L32, L61, L68, L81, L16,
   L68, `seven` L38 are all close paraphrases of a single quoted sentence, the shape Track B found
   near-100% corroborated), 1-2 as `corroborated-by-composition` (the two arithmetic lines, per
   point 2), and the remainder `quote-unverified`** — NOT `uncorroborated`/`contradicted` — because
   `QuoteVerifiedProvenance.obtain()` will return `null` for both `seven` and `one-two-punch`
   (177-14-SUMMARY.md already established, by test, that neither game has recorded rulebook
   provenance yet; nothing in this plan changes that). This is a mechanical, code-enforced
   certainty, not a soft prediction: **any `Derived` line this run's reconciler proposes as
   `uncorroborated` or `contradicted` MUST come back as `quote-unverified` from
   `classifyDerivedLines`, because the provenance guard is unconditional.** I would treat it as a
   bug in this run's driver script, not a finding about the design, if any `Derived` line surfaces
   as bare `uncorroborated`/`contradicted` without the downgrade.

4. **Determinism: I expect the SECOND run (same 5 passages, fresh dispatches, unchanged input)
   to NOT reproduce the first run's bucket counts exactly** — real model output varies run to run
   even holding the prompt fixed, and Track A's own finding (`seven:11`'s companion flip,
   PASS→FAIL on an identical payload) showed the OLD design was unstable under repetition. I
   predict this design will be MORE stable in one specific, code-enforced sense (grounding
   rejections and provenance downgrades are deterministic FUNCTIONS of whatever the model outputs,
   so a given reconciler transcript always classifies the same way), but the raw enumerator/
   reconciler OUTPUT itself — which facts get enumerated, which pairs a reconciler proposes as
   `both` — is not something this design constrains to be identical run over run. I expect the
   FINAL classification (corroborated / corroborated-by-composition / quote-unverified) to be
   stable for most of the 11 lines across both runs, with possibly 1-2 lines differing between
   `corroborated` and `quote-unverified`/`uncorroborated`-then-downgraded if a fact happens to be
   enumerated on one run and not the other.

## Concrete failure outcome I will call the design AGAINST if it occurs

**If grounding rejections exceed 30% of all "both" claims across the 5 reconciler dispatches**
(i.e., the reconciler is fabricating attribution on more than roughly 1 in 3 claims even under a
contract that explicitly names and forbids both measured fabrication shapes with worked examples),
I will report the contract text as an INSUFFICIENT mitigation — proof that the fabrication failure
mode is not adequately closed by instruction alone and requires a stronger structural guard than
"tell the reconciler not to, with examples," regardless of how many nominal corroborations the run
also produces.

**Separately, if BOTH arithmetic lines (`seven` L21 and L36) fail to reach
`corroborated-by-composition` — not because `composeArithmeticClaim` correctly refuses an
under-supported operand, but because the reconciler never proposes the composition at all** — I
will report that the reconciler contract's arithmetic-flagging instruction did not work in
practice, a genuine regression risk against the one specific weakness `177-EXPERIMENTS/README.md`
named as this design's real remaining gap.

**Separately, if the SECOND determinism run reproduces a grounding-rejection count of zero when
the first run's was nonzero (or vice versa) on the identical 5 passages**, I will report the
grounding-rejection headline number as unstable and caveat any single-run count accordingly — this
mirrors the discipline this plan's own instructions require (the old design's instability
invalidated its numbers; a headline number from one run of this design, without checking the
second, would repeat that exact mistake).

## Dispatch count budget

15 dispatches for run 1 (10 enumerator + 5 reconciler) + 15 for the determinism re-run = 30 real
`claude -p` calls total, plus whatever additional calls are needed if a dispatch errors and must be
retried (retries logged, not silently absorbed into the headline numbers).
