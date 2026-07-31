# Phase 177 — post-hoc experiments and the CHECK-04 direction change

**Date:** 2026-07-30, after Phase 177's 13 plans (7 original + 6 gap-closure) completed with the
phase goal measured NOT MET (6/16, 37.5% — see `../177-GOAL-MEASUREMENT.md`).

These experiments were run at the project owner's direction to answer a question the phase itself
never asked: **is the per-line blind re-derivation design the right design at all?** They are
measurements, not implementation. No product code was written or changed by any of them.

## Why the phase's own conclusion was incomplete

Phase 177 diagnosed its failure as a *targeting* problem — the blind subagent could not tell which
fact was under test — and spent plan 177-11 fixing payload construction. That fix was re-measured
live (177-12) and did not work. The phase closed there, correctly reporting the goal unmet.

Two things were not examined, and both turned out to matter more than targeting.

## Finding 1 — half the population was unanswerable (`classification-*.md`)

8 of the 16 lines under test are **descriptions of images** — card art, diagram layout, page
typography — not inferences from text. A text-only subagent cannot re-derive them at any level of
prompt quality. The only honest verdict is `underivable`; anything else is noise.

They were included because the presentation-note filter only recognizes explicitly qualified forms
(`Derived (p.N) — diagram description:`, `— art:`, `Visual (p.N):`). `one-two-punch`'s transcription
used those qualifiers; **`seven`'s did not**, so its visual observations are plain `Derived (p.N):`
and were indistinguishable, to the code, from real inferences. The 6-excluded-vs-0-excluded
asymmetry sits in the phase's own numbers and was read as a property of the two games rather than
as a labeling defect.

Established by **two independent classification passes** (`classification-orchestrator.md` written
blind to `classification-independent.md`), agreeing on 15 of 16 candidates. The lone disagreement
(`one-two-punch:95`, an absence-of-variants claim) was resolved in favor of the independent pass.

Same-category lines scored oppositely under the existing mechanism — `seven:33` and `seven:42`
(both sight-only) landed `underivable` and scored PASS, while `seven:8`, `:14`, `:17` (also
sight-only) landed `disagrees` and scored FAIL. Coin flips, not measurements.

**This is a defect in the ingest transcription, independent of CHECK-04.** Anything downstream that
trusts the Phase 170 `Derived`/`Visual` split is being misled by it.

## Finding 2 — the existing mechanism is non-deterministic (`TRACK-A-FINDINGS.md`)

Track A re-tagged the 8 sight-only lines as `Visual`, confirmed via the tool's own enumeration that
the clean population is exactly the predicted 7 lines, and re-ran the real two-stage mechanism with
real `claude -p` dispatches, recording every verdict through the real `verify-derive-record` CLI.

**Result: 3/7 (42.9%)** — essentially unchanged from the contaminated 6/16 (37.5%). Removing the
unanswerable questions does not make the mechanism useful.

The composition change is the real finding:

- `seven:21` flipped **FAIL → PASS** (its targeting-ambiguity partner `seven:19` was itself a
  sight-only line, now removed) — so contamination *was* causing real failures.
- `one-two-punch:82` flipped **PASS → FAIL** on a fresh dispatch of an **identical payload**.

That second flip means the mechanism's verdict is not stable under repetition. **Phase 177's 6/16
was never a measurement of a fixed quantity** — any single run's score carries unmeasured variance,
and the entire gap-closure sequence was tuning against a metric that moves on its own. The
`seven:36`/`:38` pair still failed to shared-passage collision, confirming slice density as a
second failure mode independent of contamination.

## Finding 3 — a different design works better (`TRACK-B-FINDINGS.md`)

Track B tested the project owner's proposal: instead of asking one AI to vet another's specific
claim, have **two AIs independently enumerate every fact a passage supports** (each fact tagged with
its source sentence), then a **third reconcile** them into found-by-both / found-by-one buckets.
Facts found by both are well-supported; facts found by one warrant attention. Nobody aims at a
target, so the targeting problem cannot arise.

15 real dispatches (vs. 28), stripping verified by grep on every saved prompt, originals confirmed
byte-identical.

- **Zero false disagreements** on the exact 10 lines that broke the existing design. Every outcome
  was a clean corroboration, an honest non-answer, or a defect catch — an improvement in *kind*,
  not just hit rate.
- **Caught a real transcription bug** neither design was told to look for: `seven:11` claims the
  final challenge sentence ends "in no particular order." It does not — that phrase belongs to the
  *previous* sentence. Both enumerators independently reconstructed the sentences correctly, so the
  reconciled output actively **contradicts** the `Derived` line.
- **Found two facts the transcription missed entirely** (Guard cards have ready/exhausted states;
  a boxer occupies own-corner or center-ring) — real state-machine facts, invisible to a design
  that only re-checks targets the transcriber already picked.
- **Image lines self-sorted 7 of 8** with no targeting mechanism and no filter. One edge case:
  `seven:19`'s diagram redescribes numbers also stated in prose, so a naive matcher keying on
  shared numbers could mistake corroboration of the numbers for corroboration of the diagram claim.

### Its real weakness

**Multi-hop arithmetic is systematically under-corroborated.** For `seven:21` (7×4×4=112),
`seven:36` (round-count math), and `one-two-punch:52` (16÷2=8), *every sub-fact is corroborated by
both enumerators*, but neither performs the final arithmetic unprompted — so the compound
conclusion appears in neither list and buckets as "uncorroborated," indistinguishable from an
actually-wrong inference. Different noise from the old design's false disagreements, but still
noise. Likely fix: instruct the reconciler to attempt cross-fact arithmetic rather than only
literal-meaning matching; it already holds both operands.

### The caveat that matters most

The agreement-quality spot-check verified ~20 corroborated facts against source text and found zero
errors — **and then argued against its own result.** On this corpus, agreed facts are almost all
near-verbatim restatements of single sentences. The design's stated main risk (two runs of one
model confidently wrong *together*) requires exactly the hard multi-hop synthesis these enumerators
mostly declined to attempt. **Read 0/20 as "not stress-tested," not as "signal is strong."**

## Direction

Retire per-line blind re-derivation; re-scope CHECK-04 around dual enumeration + reconciliation.
Not because the old design is unpolished — because it asks a question that cannot be asked. You
cannot say "re-derive *this* fact" without naming the fact. Six gap-closure plans, two
prediction-backed live runs, and a clean-population re-run all reach the same wall.

Next-attempt order:

1. Instruct the reconciler to attempt cross-fact arithmetic (closes the one measured weakness; the
   operands are already in hand).
2. Stress-test the agreement signal against a genuinely ambiguous passage, ideally with two
   *different models* rather than two framings of one.
3. **Fix the ingest labeling regardless of which design wins** — `seven` tags picture descriptions
   as `Derived`, which misleads everything downstream of the Phase 170 split.

The gap-closure infrastructure survives the change: the ledger, the recording CLI, enumeration, and
the independence guarantee are all design-agnostic. It is the judgment step being replaced, not the
plumbing.

## Confidence

**Low-to-moderate.** A 5-passage, 2-game corpus, 7 clean lines, ~15 dispatches per track. Enough to
see the qualitative shape of the failure modes clearly — no more false disagreements, a real
arithmetic blind spot, a real defect catch, and a non-determinism problem nobody had measured — but
**not enough to put a number on any hit rate.** Both tracks pre-registered their expectations before
dispatching; both pre-registrations are in this directory and unedited.

## Files

| File | What it is |
|---|---|
| `classification-orchestrator.md` | First classification pass, written blind |
| `classification-independent.md` | Second pass, blind to the first; agreed 15/16 |
| `TRACK-A-PRE-REGISTRATION.md` | Track A's expectation, committed before dispatch |
| `TRACK-A-FINDINGS.md` | Clean-population re-run of the existing mechanism |
| `TRACK-B-PRE-REGISTRATION.md` | Track B's expectation, committed before dispatch |
| `TRACK-B-FINDINGS.md` | Dual-enumerator + reconciler design, measured |
