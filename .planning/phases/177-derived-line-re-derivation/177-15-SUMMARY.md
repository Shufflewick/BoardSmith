---
phase: 177-derived-line-re-derivation
plan: 15
subsystem: cli-verify
tags: [check04-replacement, dual-enumeration, real-dispatch, measurement, honesty-discipline]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (177-EXPERIMENTS/README.md)
    provides: The direction change (retire per-line blind re-derivation; replace with dual
      enumeration + reconciliation) and the three measured failure modes this plan's contracts
      and measurement were built to close/exercise.
  - plan: 177-14
    provides: verify-enumerate.ts's mechanical core (buildEnumeratorPayload, createEnumeratedFact,
      validateGrounding, composeArithmeticClaim, QuoteVerifiedProvenance, classifyDerivedLines) —
      reused unmodified, driven for the first time by real claude -p dispatches in this plan.
provides:
  - src/cli/slash-command/bs/verify/enumerate-facts.md — CHECK-04 replacement's first judgment
    contract (quote-lines-only, no arithmetic, mandatory approximate-flagging)
  - src/cli/slash-command/bs/verify/reconcile-facts.md — CHECK-04 replacement's second judgment
    contract (matching-only, forbids computing values, requires verbatim per-list quotes for
    every "both" claim, flags arithmetic for code rather than evaluating it)
  - Both registered in install-claude-command.ts's SHARED_LEAF_PROBES, proven via a real
    scratch-dir install; drift pins added to verify.test.ts (extending, not replacing, the
    existing derive-recheck/derive-compare pins)
  - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/ — the full real-dispatch
    record: PRE-REGISTRATION.md (committed alone before any dispatch), raw enumerator/reconciler
    JSON output for two independent full runs (run1/, run2/), the code-side analysis output
    (analysis-run1.json, analysis-run2.json), and sha256 hashes proving the two source games
    (~/BoardSmithGames/seven, ~/BoardSmithGames/one-two-punch) were never modified
affects: [the-orchestrator-disposition-of-CHECK-04, any-future-plan-adding-multi-step-arithmetic-support-to-composeArithmeticClaim]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-registering a concrete, falsifiable failure threshold (not just a vague expectation)
      in a file committed ALONE, before any real dispatch, so a later reader can check whether
      the measurement was tuned after the fact — the second consecutive plan in this phase to use
      this discipline (177-06's 913bfe7d, 177-12's f0b6a038, now this plan's 6e35afde)."
    - "Running the exact same real-dispatch measurement twice, unchanged, specifically to check
      determinism as its own reportable finding — not a courtesy re-run, a load-bearing check
      the old design never got before its instability was discovered (Track A) after its numbers
      had already been relied on."
    - "Real independent-model output (not hand-built test fixtures) is the one input class 177-14's
      42 tests never exercised — this plan is the first time verify-enumerate.ts's grounding/
      composition/classification functions ran against a live claude -p dispatch's actual JSON,
      and it surfaced a real brittleness (composeArithmeticClaim's exact unit-string equality)
      177-14's hand-built fixtures could not have caught because hand-built fixtures used matching
      unit strings by construction."

key-files:
  created:
    - src/cli/slash-command/bs/verify/enumerate-facts.md
    - src/cli/slash-command/bs/verify/reconcile-facts.md
    - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/PRE-REGISTRATION.md
    - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/analysis-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/analysis-run2.json
    - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/run1/ (raw dispatch JSON, 15 files)
    - .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/run2/ (raw dispatch JSON, 15 files)
  modified:
    - src/cli/commands/install-claude-command.ts (SHARED_LEAF_PROBES +2)
    - src/cli/slash-command/bs/verify.test.ts (+13 new pins, extending ALL_VERIFY_FILES)

decisions:
  - "reconcile-facts.md's handshake token (BS-RECONCILE-V1) is intentionally never quoted as a
    bare literal in enumerate-facts.md's prose (and vice versa) — mirrors derive-recheck.md/
    derive-compare.md's precedent of keeping the two tokens' literal strings from cross-
    contaminating each other's file, which a drift pin (`not.toContain`) now enforces."
  - "The measurement's driver script (analyze.ts, scratchpad-only, not shipped) deliberately
    reuses the real, unmodified verify-enumerate.ts functions rather than reimplementing
    grounding/composition/classification logic for the test — the point of this plan was to
    exercise the ALREADY-BUILT mechanical core against real dispatch output, not to validate a
    parallel implementation of it."
  - "composeArithmeticClaim's operand-consistency check (exact string equality on `unit`) is
    flagged as a real, demonstrated code gap in this plan's findings but NOT fixed in this plan —
    per the honesty-discipline instruction not to tune the design after seeing results. This is
    left for the orchestrator to disposition alongside CHECK-04's overall status."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-30
---

# Phase 177 Plan 15: CHECK-04 Contracts + Real-Dispatch Measurement Summary

Wrote the two judgment contracts (`enumerate-facts.md`, `reconcile-facts.md`) that turn 177-14's
already-built, already-tested dual-enumeration mechanics into a real, dispatchable design, shipped
them via the installer with drift-protected pins, then ran the assembled design end-to-end on the
real, quote-verified `177-FIXTURES/` corpus with **30 real `claude -p` dispatches across two model
families and two full independent runs** — not a simulation, not hand-written prompts standing in
for the contracts. The result is genuinely positive but not a clean pass: **zero grounding
fabrications across 221 claims and two runs, 14/14 identical final classifications between the two
runs, and one real, specific, demonstrated code-level brittleness** (`composeArithmeticClaim`'s
exact unit-string equality check refuses a correctly-proposed, magnitude-consistent arithmetic
composition because two independent enumerators phrase the same unit differently — an interaction
177-14's hand-built test fixtures could not have exposed). CHECK-04 is NOT closed by this plan;
this is evidence for the orchestrator to disposition.

## Task 1 — the two contracts

**`enumerate-facts.md`** instructs a lone enumerator (given quote-lines-only, via the real
`buildEnumeratorPayload`) to list every rule-relevant fact a passage supports, tag each with its
source sentence, and — the load-bearing rule — mark numeric values `approximate: true` whenever the
source hedges, because a prior fabrication in this design's development composed two independently-
stated "about 7 minutes" into a false-precision "49 minutes." It explicitly forbids the enumerator
from performing arithmetic itself ("you are an enumerator, not a calculator"), pushing composition
entirely into code.

**`reconcile-facts.md`** instructs the reconciler (given both completed enumerations, never the raw
passage) to bucket facts into found-by-both/A-only/B-only, and states two rules as the entire
reason the file exists: (1) it may never state a value not literally present in one of the two
input lists — citing, by name, the two measured fabrication shapes this rule closes ("5 cards
each" credited to both sides when one never said it; invented arithmetic operand grounding on an
unrelated pairing); (2) every "both" claim must carry a verbatim quote attributed to each list,
because `validateGrounding` mechanically checks exactly that and rejects — never silently drops —
a claim that fails. It also has the reconciler propose which `Derived` lines are covered by which
reconciled facts and flag arithmetic-bearing lines for CODE to verify, stating explicitly that it
never evaluates the arithmetic itself.

Both files registered in `install-claude-command.ts`'s `SHARED_LEAF_PROBES`; a real scratch-dir
install (`installClaudeCommand({ local: true, force: true, skipLink: true })` against a fresh
`mkdtemp` dir) proved both land under `.claude/skills/bs-shared/verify/`, and a follow-up test
proved deleting one flips the installer back to "partial" so it gets repopulated on the next
non-force install — the same pattern `derive-recheck.md`/`derive-compare.md` already had. 13 new
drift-pin tests added to `verify.test.ts`, extending `ALL_VERIFY_FILES` and the file's existing
describe-block structure rather than replacing anything. Full suite: 4090/4090 (baseline 4075 + 15
net-new tests between this plan's pins and its own installer-proof describe block).

## Task 2 — the measurement

**Pre-registration committed alone** (`6e35afde`, `git show --stat` lists exactly one file,
`177-15-MEASUREMENT/PRE-REGISTRATION.md`) before any dispatch, naming three concrete failure
outcomes: (a) grounding rejections exceeding 30% of "both" claims, (b) both arithmetic-bearing
`Derived` lines never even being PROPOSED for composition by the reconciler, (c) the grounding-
rejection count differing between the two determinism runs.

**Corpus and dispatch shape:** the 5 real rule slices spanning both `177-FIXTURES/` games (11
`one-two-punch` + 3 `seven` `Derived` lines — **14 total**, not the 11 the pre-registration itself
miscounted; that miscount is disclosed in the raw measurement record rather than silently
corrected). Two enumerators per passage on genuinely different model families
(`claude -p --model claude-opus-5` / `claude -p --model claude-haiku-4-5-20251001`), one reconciler
per passage on a third model (`claude -p --model claude-sonnet-5`). Run twice, unchanged, for
determinism: **30 real dispatches total.** `~/BoardSmithGames/seven` and
`~/BoardSmithGames/one-two-punch` confirmed byte-identical via sha256 before dispatch, after run 1,
and after run 2 (three-way diff, all empty).

### Headline number 1 — grounding rejections: 0 / 110 (run 1), 0 / 111 (run 2)

`validateGrounding` — the real, already-tested, unmodified function — rejected zero of the
reconciler's 221 combined "found by both" claims across both full runs. This is better than the
pre-registration predicted (0-3) and the opposite of the pre-registered failure threshold (>30%).
Reported honestly per this plan's discipline: zero on two independent runs is a real, reproduced
result on this corpus, not proof the fabrication risk is generally closed — the corpus is small
(5 passages, 2 games) and the two measured fabrication shapes this rule exists to prevent were
each observed exactly once in earlier, less-constrained development of this same idea, never
against this exact contract text before now.

### Headline number 2 — arithmetic composition: 0 / 2 verified, both refused for real, distinct, informative reasons

`seven` L21 (`7×4×4=112`) and L36 (`10−3=7`, compound). **Both refused in both runs**, but not for
the reason the pre-registration worried about (the reconciler failing to propose the right
operands) — the reconciler correctly proposed L21's operands in both runs, citing the right three
grounded facts. `composeArithmeticClaim` refused anyway because its operand-consistency check
requires the two enumerators' matched facts to agree on `unit` by **exact string equality**, and
two independently-dispatched enumerators (by design, never coordinating on vocabulary) phrase the
same magnitude with different labels — `"highest card number"` vs `"card numbers"` (run 1),
`"4 copies of each card"` vs `"4 copies"` (run 2). Magnitudes agreed exactly in every case (7≡7,
4≡4, 4≡4); the refusal is real conservatism about wording, not a masked correctness failure. L36
never reached composition at all — its claim is a genuine compound of two arithmetic relationships,
and `composeArithmeticClaim` performs exactly one operation per call, confirming
`177-EXPERIMENTS/README.md`'s named multi-hop weakness persists in the shipped code, not just the
model layer. **This is the single most actionable code-level finding from this measurement**:
177-14's 42 tests used hand-built fixtures with matching unit strings by construction and could not
have caught this; real independent-model output did, on the first real dispatch.

### Full classification, both runs (14 real `Derived` lines) — identical between run 1 and run 2

| Classification | Count (both runs) | Lines |
|---|---|---|
| `corroborated` | 8 | otp L32, L61, L68, L81, L16, L68(action), L82, L106 |
| `corroborated-by-composition` | 0 | (refused — see above) |
| `uncorroborated` | 2 | seven L21, L36 |
| `contradicted` | 0 | (none) |
| `quote-unverified` | 4 | seven L38; otp L117, L128, L132 |

The `quote-unverified` downgrade is mechanically expected, not a soft finding:
`QuoteVerifiedProvenance.obtain()` returned `null` for both games in both runs (neither has ever
recorded rulebook provenance — a true, current, unrelated fact 177-14's own tests already
established) and `classifyDerivedLines` downgrades every uncorroborated/contradicted proposal
unconditionally when that happens. No `Derived` line in this corpus was exposed to the
false-accusation failure mode the provenance guard exists to prevent
(`177-EXPERIMENTS/README.md` CORRECTION, `seven:11`).

### Determinism — the headline positive result

**Every one of the 14 `Derived`-line classifications was identical between the two runs**, and
grounding rejections were 0 in both. The two arithmetic refusals reproduced with the identical
root cause both times. This is the direct point of comparison against the old design's own
measured instability (`TRACK-A-FINDINGS.md`: an identical payload flipped PASS→FAIL on a re-run) —
on this corpus, this design's final classification did not flip, on any of 14 lines, across two
independent full dispatches. Stated precisely: the RAW enumerator/reconciler output was NOT
byte-identical between runs (fact counts varied per slice, as expected from real model variance);
what stayed constant was the downstream classification every line resolved to.

### Comparison to the old design's baseline

The old design measured 3/7 (42.9%) on the stale corpus with a non-deterministic mechanism
(`TRACK-A-FINDINGS.md`). This run's closest analogue (`corroborated` + `corroborated-by-
composition`) is 8/14 (57.1%) — **not a directly comparable hit-rate claim** (different corpus,
different verdict taxonomy, different sample size, and the old number was itself proven unstable).
What IS directly comparable: **zero false disagreements** (the old design's core measured failure)
and **stable classification across two runs** (the old design's other measured failure) — neither
of the two specific, named failures that ended the old design reproduced here, on this corpus, at
this sample size.

### The `missed` signal — real but noisier unfiltered than Track B's hand-curated version

`classifyDerivedLines`' `missed` output totaled 89 facts across the corpus in run 1 (8/21/6/22/32
per slice) — far more than Track B's 2 hand-picked genuine state-machine inferences. Read honestly:
most of these are ordinary background facts or facts already fully explicit as a quoted sentence
that never needed a `Derived` line — the mechanical `missed` field is a much broader, noisier
signal than Track B's human-filtered version. Scanning by hand, this run did not surface a clear
Track-B-caliber novel synthesis on this particular corpus, plausibly because this corpus was
already re-transcribed under a stricter contract that captured more inferences directly (11 of 14
`Derived` lines are in `one-two-punch` alone, vs. Track B's older, thinner corpus). Honest
non-finding, not a negative one — this corpus had less headroom for this specific advantage to
show up than Track B's did.

## Overall verdict (not a disposition — reporting for the orchestrator)

**Positive, with a real, specific, actionable gap.** Zero fabrication across 221 claims and two
runs; every one of 14 real classifications reproduced exactly on a fresh dispatch; the provenance
guard worked unconditionally on every candidate that reached it. Against: `composeArithmeticClaim`'s
exact unit-string equality is real, demonstrated brittleness that refused a correctly-proposed,
magnitude-consistent composition for a reason unrelated to truth, and multi-step arithmetic is not
supported by the composer's single-operation shape at all — both are fixable, neither is fixed in
this plan (no post-hoc tuning, per honesty discipline). Confidence: low-to-moderate — 5 passages,
2 games, 14 lines, 2 runs is enough to see the qualitative shape clearly, not enough for a general
hit-rate claim.

**CHECK-04 is left open.** This plan reports evidence; it does not close the requirement in
`REQUIREMENTS.md`, and `STATE.md`/`ROADMAP.md` were not touched.

## Deviations from Plan

**1. [Rule 1 - harness bug, caught and fixed before any measurement was analyzed] Reconciler
dispatch prompts initially omitted an explicit `BS-RECONCILE-V1` token in the payload section.**
- **Found during:** first reconciler dispatch attempt (Task 2, before run 1's real measurement).
- **Issue:** the measurement harness's dispatch-prompt assembly put the token only inside the
  inlined contract text (describing the rule), not inside the "DISPATCH PROMPT" payload section
  itself. 4 of 5 dispatches correctly self-rejected (`DISPATCH REJECTED — missing BS-RECONCILE-V1
  token`); 1 of 5 (`one-two-punch/02-action-cards-and-resolution.md`) proceeded anyway despite the
  identical omission — reported as a genuine, if minor, observation about token-gate reliability
  under an ambiguous prompt, not corrected away silently.
- **Fix:** added an explicit `BS-RECONCILE-V1` line to the dispatch-prompt section, matching the
  real production "pointer block" shape every sibling contract in this directory specifies.
- **Files modified:** scratchpad-only harness script (`build-reconcile.mjs`), not shipped code.
- **Verification:** all 10 reconciler dispatches across both full runs after the fix succeeded on
  the first attempt with well-formed JSON.

No other deviations — the two contracts were written, registered, tested, and dispatched exactly
as this plan's objective specified.

## Known Stubs

None — no UI or data-flow stubs; this plan's product is skill text plus a measurement record.

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/verify/enumerate-facts.md
- FOUND: src/cli/slash-command/bs/verify/reconcile-facts.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/PRE-REGISTRATION.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/analysis-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-15-MEASUREMENT/analysis-run2.json
- FOUND commit: 76b12ee6 (feat(check04-contracts): write and ship CHECK-04's dual-enumeration judgment contracts)
- FOUND commit: 6e35afde (docs(177-15): commit pre-dispatch expectation for CHECK-04 dual-enumeration measurement, alone)

## Full test run

`npm test`: **4090/4090 passed**, full suite, not a subdirectory subset (baseline 4075 + 15
net-new tests from this plan's Task 1 pins/installer-proof block).
