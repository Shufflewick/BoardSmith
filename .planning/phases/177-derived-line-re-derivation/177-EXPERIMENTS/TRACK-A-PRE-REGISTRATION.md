# Track A — Pre-registered expectation (written BEFORE dispatch, not edited after)

Timestamp: 2026-07-30, before any `claude -p` dispatch for this experiment.

## What I expect the enumeration to show

After re-tagging the 8 agreed-REQUIRES-SIGHT lines from `Derived (p.N):` to `Visual (p.N):`,
`boardsmith verify-derive-recheck` should enumerate exactly 7 real dispatch candidates:
`seven:21`, `seven:36`, `seven:38`, `one-two-punch:30`, `one-two-punch:52`,
`one-two-punch:82`, `one-two-punch:95` — plus the disputed `seven/02-solo-variant.md:11`,
which I am NOT re-tagging, so it will still enumerate as an 8th real candidate (I will report
it separately, not folded into the "clean 7" score).

## What I expect the scores to be

Phase 177's own per-line table already recorded verdicts for these exact lines on the
UN-retagged corpus (same slice text, same quote-line population once the 8 sight-only lines
are removed from context — retagging them to `Visual` only removes them from the payload,
it does not change what's left for the remaining lines to be judged against). I therefore
expect the re-run to reproduce, or come very close to, 177's own recorded verdicts for these
7 lines, because nothing about the remaining lines' own quote-payload construction changes:

- `seven:21` — predict FAIL (targeting-ambiguous, shared focus passage with `seven:19`,
  which is now excluded — but 177-PROOF-2.md's mechanism computes ambiguity from `Derived`
  lines sharing a citation header BEFORE presentation filtering removes them from the corpus;
  I expect this may in fact change now that seven:19 is retagged out, so I am NOT fully
  confident here — this is the one line where retagging could plausibly change the outcome,
  and I am flagging that uncertainty now rather than after seeing the result).
- `seven:36` — predict FAIL (targeting-ambiguous with `seven:38`, both still in the clean
  population, so the ambiguity should persist unchanged).
- `seven:38` — predict FAIL (mirrored ambiguity with `seven:36`).
- `one-two-punch:30` — predict PASS (agrees/same-fact in 177's data).
- `one-two-punch:52` — predict FAIL (off-target, disagrees/different-fact in 177's data).
- `one-two-punch:82` — predict PASS (agrees/same-fact in 177's data).
- `one-two-punch:95` — predict PASS (underivable, legitimate, in 177's data).

Predicted score: **3/7 PASS (43%)**, matching the paper re-scoring already computed from
177's existing per-line data, MINUS whatever effect removing seven:19 from the corpus has
on seven:21's targeting-ambiguous flag (my honest uncertainty: this could move seven:21
from FAIL to PASS, giving 4/7 = 57%, if the ambiguity flag is computed only against the
currently-enumerated `Derived` population rather than the full original 22-line set).

## Concrete failure outcome I am willing to state in advance

I expect `seven` to continue to underperform `one-two-punch` on the clean population — i.e.
the per-game split predicted by the background note (one-two-punch 3/4, seven 0/3 on
text-derivable lines) should be roughly confirmed, with `seven`'s 3 clean lines (21, 36, 38)
scoring 0/3 or at best 1/3, because two of them (36, 38) are the exact targeting-ambiguous
pair `177-PROOF-2.md` already found and the density explanation in the background (multiple
`Derived` lines under few citation headers in `seven`'s definitions/overview slices) predicts
this persists even after contamination is removed. I expect this to CONFIRM the slice-density
hypothesis, not refute it, because retagging visual lines does not change how many `Derived`
lines cluster under one citation header among the REMAINING lines for `seven:36`/`38` (both
survive as `Derived` and still share a header).

I am NOT predicting the mechanism becomes reliably useful. My concrete expectation is that it
remains close to a coin flip on the clean population too (2-4 out of 7), because Condition-3
targeting failures were shown by 177 to be a subagent-comprehension problem
("narrowing the payload's TOPIC did not reliably narrow the blind subagent's own DERIVATION"),
which contamination-removal does nothing to fix.

## The disputed line: seven/02-solo-variant.md:11

Left as `Derived (p.2)`, not retagged. It will appear in the tool's enumeration as a 7th
`seven` candidate / 8th total. I expect it to land FAIL again (177 recorded `disagrees`/
`different-fact`, off-target, unique focus window) since nothing about its own payload
construction changes. I will report its result separately from the clean-7 score, as
instructed.
