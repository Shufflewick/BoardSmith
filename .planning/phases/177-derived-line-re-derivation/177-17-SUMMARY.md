---
phase: 177-derived-line-re-derivation
plan: 17
subsystem: cli-verify
tags: [check04-replacement, multi-step-arithmetic, absence-claims, re-measurement, honesty-discipline]

# Dependency graph
requires:
  - plan: 177-15
    provides: verify-enumerate.ts's mechanical core and the live measurement that named multi-step
      arithmetic and absence claims as the two remaining structural gaps.
  - plan: 177-16
    provides: rulebook source provenance for both reference games (the precondition for any
      corroborated/uncorroborated/contradicted/absence-* finding to be reported at all, rather than
      downgraded to quote-unverified) and the 177-16 baseline (8 corroborated, 6 uncorroborated, 0
      contradicted, 0 quote-unverified) this plan re-measures against.
  - commit: ac5f64c5
    provides: the operand-unit token-compatibility fix, merged after 177-15's measurement and never
      re-measured live until this plan's code-isolated replay.
provides:
  - composeArithmeticChain (src/cli/commands/verify-enumerate.ts) — bounded multi-step arithmetic
    composition (MAX_ARITHMETIC_CHAIN_DEPTH = 3), closing the "seven L36" compound-relationship gap
    177-15 named and left open.
  - classifyDerivedLines' new 'absence' branch — a mechanical, code-side check for absence claims,
    producing absence-corroborated/absence-contradicted/absence-unverifiable, closing the
    "otp L128/L132" gap 177-15/177-16 left masquerading as plain uncorroborated.
  - reconcile-facts.md updated to teach the reconciler both new capabilities (multi-step
    arithmetic-ingredient flagging, absence-claim + absenceTargets proposal), verified against a
    real live dispatch, not just updated prose.
  - .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/ — the post-fix
    re-measurement: a code-isolated replay against 177-15's archived run1/run2 data, plus one fresh
    live end-to-end claude -p dispatch round confirming the contract layer.
affects: [the-orchestrator-disposition-of-CHECK-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded a NEW multi-step capability at the EXACT depth the one real measured failure
      requires (3), not padded with speculative headroom — extending composeArithmeticChain's
      constraints (never GENERATE a relationship, only CHECK one; every intermediate must be a
      Derived-line-stated value, never a free variable) rather than relaxing them for the
      multi-step case."
    - "Absence-claim recognition and target-naming stayed a MODEL judgment call, never a keyword
      list in code — this module's second deliberate refusal to ship an authoritative-looking
      heuristic (177-01's precedent for annotation-line detection, now this plan's precedent for
      absence-claim detection). Code only ever performs the literal, mechanical, reconciler-named
      search."
    - "Re-measurement used BOTH comparison shapes the plan required: a code-isolated replay against
      unmodified archived dispatch data (isolates the code change from model variance) AND one
      fresh live end-to-end dispatch round (confirms the updated CONTRACT text, not just the code,
      still produces sound real-model behavior) — the two independently agreed on otp L128/L132's
      classification."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/README.md
    - .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/code-isolated-comparison/reanalysis.json
    - .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/fresh-dispatch/ (enumA.json, enumB.json, reconcile.json, fresh-classification.json)
    - .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/originals-before-and-after.sha256
  modified:
    - src/cli/commands/verify-enumerate.ts (composeArithmeticChain, extractOperandValue refactor, 'absence' classification branch)
    - src/cli/commands/verify-enumerate.test.ts (+15 tests: composeArithmeticChain, classifyDerivedLines absence claims)
    - src/cli/slash-command/bs/verify/reconcile-facts.md (multi-step + absence guidance)

decisions:
  - "MAX_ARITHMETIC_CHAIN_DEPTH is 3, not padded with headroom — the one real measured multi-step
    case (seven L36) needs exactly 3 steps (net subtraction, span subtraction, division). Extending
    this bound should require measuring another real multi-step failure, not raising it
    speculatively; a generous bound would reopen the fabrication risk composeArithmeticClaim's
    single-step design was built to refuse (searching for compositions the Derived line never
    actually makes)."
  - "Absence-claim target-naming is NEVER done by BoardSmith code. otp L128 ('No edition or
    printing number is stated') maps cleanly onto two literal words; otp L132 ('no rules marked as
    variants, optional modules, or advanced/expert rules') spans three loosely related concepts
    with no safe literal stand-in — a live dispatch under the updated contract confirmed the
    reconciler makes exactly this distinction unprompted (absenceTargets: ['edition','printing']
    vs absenceTargets: []), which is the evidence this design choice was correct rather than merely
    plausible."
  - "The absence-check scans quoteLinesOnly() output, never the raw slice text — the Derived line's
    own text always literally contains its claimed-absent word ('No edition...' contains
    'edition'), so scanning anything wider than the real quote lines an enumerator saw would make
    every absence claim trivially self-contradict itself. Empirically proven: temporarily scanning
    raw text flipped the real otp L128 case from absence-corroborated to absence-contradicted
    against itself, confirmed, then reverted."
  - "Kept the absence-provenance gate identical in shape to the existing uncorroborated/contradicted
    gate (downgrade to quote-unverified when QuoteVerifiedProvenance is absent) rather than
    inventing a separate rule — the absence scan reads the same passage quote lines, carrying the
    identical upstream-transcription risk 177-EXPERIMENTS/README.md's CORRECTION section
    identified."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-30
---

# Phase 177 Plan 17: Multi-Step Composition + Absence Classification + Re-Measurement Summary

Closed the two STRUCTURAL gaps 177-15's live measurement named and left open — multi-step
arithmetic composition (`seven` L36's compound relationship) and absence claims (`otp` L128/L132,
which dual enumeration structurally cannot corroborate) — then re-ran the live measurement two
ways: a code-isolated replay against 177-15's archived, unmodified run1/run2 dispatch data, and one
fresh, real, end-to-end `claude -p` dispatch round confirming the updated contract text still
produces sound behavior from real models, not just from hand-built test fixtures. Result: **all 14
real `Derived` lines in the clean corpus now carry a genuine classification** — 0 `contradicted`,
0 `quote-unverified` — up from 177-16's 8 corroborated / 6 uncorroborated split. Deterministic
across both code-isolated runs; grounding rejections unchanged at 0/110 and 0/111.

## What was built

**`composeArithmeticChain`** (`src/cli/commands/verify-enumerate.ts`) composes a bounded sequence
of arithmetic steps, where a later step may consume an earlier step's own computed result —
`seven` L36 needs exactly this: net = draw(2) − discard(1); span = end(10) − start(3); rounds =
span ÷ net = 7. Every constraint `composeArithmeticClaim` already enforced carries over unmodified
per step (refactored the shared per-operand logic into `extractOperandValue` so the two functions
cannot diverge): every leaf operand still traces to a `GroundedBothFact`; approximate operands are
still refused; unit compatibility is still checked. The new constraint is that **an intermediate
result is not a free variable** — it must itself be a value the `Derived` line under test literally
states (the same "does the text mention this digit" check applied to leaf operands), or the chain
is refused. Bounded at `MAX_ARITHMETIC_CHAIN_DEPTH = 3` — the exact depth the one real measured
case requires, not padded with speculative headroom, because a generous bound reopens the
fabrication risk the single-step design was built to close (searching for a composition the
`Derived` line never actually makes).

**`classifyDerivedLines`'s new `'absence'` branch** recognizes that dual enumeration structurally
cannot corroborate a claim that something is absent — no enumerator ever lists a fact that is not
there, by construction. Bucketing `otp` L128/L132 as plain `uncorroborated` (177-15/177-16's
behavior) looked identical to "both enumerators tried and failed to agree," which is a different,
misleading signal. The reconciler now proposes `'absence'` with, ONLY when safe, literal
`absenceTargets` — never guessed by this module (177-01's precedent for annotation-line detection
extends here: recognizing an absence claim and naming its target is a judgment call left to the
model). When a safe target is named, code mechanically scans the passage's `quoteLinesOnly()`
output (never the raw slice text — the `Derived` line's own annotation text always literally
contains its claimed-absent word, so scanning wider would make every absence claim trivially
self-contradict) and resolves `absence-corroborated`/`absence-contradicted`, gated on
`QuoteVerifiedProvenance` exactly like `uncorroborated`/`contradicted` (same upstream-transcription
risk). When no safe target exists, the claim lands the new, explicit `absence-unverifiable` bucket
— reported honestly rather than silently downgraded.

**`reconcile-facts.md`** was extended to teach the reconciler both capabilities: it does not need
to decompose a compound arithmetic relationship into steps itself (code owns that), just name every
ingredient fact anywhere in the relationship; and it should leave `absenceTargets` empty rather
than guess when a claim spans several loosely related concepts. A real live dispatch (below)
confirmed the reconciler applies this distinction correctly, unprompted.

## Empirical proof of the new pins (honesty discipline)

Four guards were temporarily reverted, the corresponding test observed to genuinely fail (not
trivially pass), and the code reverted — confirmed via `git diff --stat` clean before committing:

1. **Chain depth bound.** `MAX_ARITHMETIC_CHAIN_DEPTH` set to 4 → `bounds chain depth...` test
   failed real (`expected 4 to be 3`).
2. **Forward/self-reference refusal.** Removed the `ref.index >= stepIdx` check → the
   `forward/self reference` test crashed with a real `TypeError: Cannot read properties of
   undefined (reading 'magnitude')`, not a graceful refusal.
3. **Intermediate-mention refusal.** Removed the intermediate-mention check → the `intermediate
   result is NOT mentioned` test failed real (`outcome.ok` was `true` when it should have been
   refused).
4. **Self-contradiction guard (quoteLinesOnly, not raw text).** Scanned raw passage text instead of
   `quoteLinesOnly()` output → the REAL otp L128 case (using the real fixture text) flipped from
   `absence-corroborated` to `absence-contradicted` against its own claimed-absent word — proving
   the guard is load-bearing, not decorative.

All four reverted cleanly; `diff /tmp/verify-enumerate.ts.bak src/cli/commands/verify-enumerate.ts`
was empty before the final commit.

## Re-measurement — two comparison shapes, per the plan's instruction

**Code-isolated replay** (`177-17-MEASUREMENT/code-isolated-comparison/reanalysis.json`) reused
177-15's archived, real, unmodified run1/run2 enumerator/reconciler JSON — no re-dispatch — and ran
the real, unmodified `validateGrounding`/`classifyDerivedLines` against it with the new code,
isolating the code change from model variance:

- `seven` L21 (7×4×4=112): `uncorroborated` → **`corroborated-by-composition`** (single-step;
  re-measures `ac5f64c5`'s unit-token-compatibility fix live for the first time — it was merged
  after 177-15's measurement and never re-run against real dispatch data until now)
- `seven` L36 (round-count compound): `uncorroborated` → **`corroborated-by-composition`** (NEW —
  the 3-step chain: net = 2−1=1; span = 10−3=7; rounds = 7÷1=7)
- `otp` L128 (no edition/printing stated): `uncorroborated` → **`absence-corroborated`** (NEW —
  "edition"/"printing" genuinely absent from the real passage's quote lines)
- `otp` L132 (no variants/optional/advanced-expert rules): `uncorroborated` → **`absence-
  unverifiable`** (NEW, explicit bucket — no safe literal target for this multi-concept claim)
- `seven` L38, `otp` L117: unchanged, still genuinely `uncorroborated` — neither is an arithmetic
  or absence claim; both are real dual-enumeration misses, not artifacts of either gap this plan
  closed.
- The 8 already-`corroborated` lines: unchanged.

**Identical between run1 and run2** — determinism holds on all 14 lines, extending 177-15's own
headline determinism result to the new code paths.

**Fresh live dispatch** (`177-17-MEASUREMENT/fresh-dispatch/`): one real, full end-to-end round —
two enumerators on genuinely different model families (`claude-opus-4-5-20251101` /
`claude-haiku-4-5-20251001`) independently enumerating `one-two-punch/02-action-cards-and-
resolution.md`, reconciled by a third model (`claude-sonnet-5`) under the updated
`reconcile-facts.md` contract. The real reconciler output proposed `absenceTargets:
["edition", "printing"]` for L128 and `absenceTargets: []` for L132 — **unprompted**, matching
exactly the code-isolated replay's manually-supplied values, and running the real classification
code against this fresh data reproduced `absence-corroborated`/`absence-unverifiable` independently.
0 grounding rejections on this fresh round (33/33 "both" claims grounded).

## Full 14-line classification, before (177-16) and after (this plan)

| Classification | 177-16 count | 177-17 count |
|---|---|---|
| `corroborated` | 8 | 8 (unchanged) |
| `corroborated-by-composition` | 0 | **2** (seven L21, L36) |
| `uncorroborated` | 6 | **2** (seven L38, otp L117 — genuine misses, unrelated to either gap) |
| `contradicted` | 0 | 0 (unchanged) |
| `quote-unverified` | 0 | 0 (unchanged) |
| `absence-corroborated` | n/a | **1** (otp L128) |
| `absence-unverifiable` | n/a | **1** (otp L132) |

**The goal's own unit:** of the 14 real `Derived` lines, **13 received a genuine, independent
second opinion** — 8 by direct dual-enumeration agreement, 2 by code-verified arithmetic
composition, 1 by a mechanical absence check against the real source text, and 2 by a genuine
dual-enumeration attempt that found no supporting fact (an inconclusive but real attempt, distinct
from no attempt being possible at all). **Exactly 1 line** (`otp` L132) is structurally outside what
this design — or any safe mechanical check — can currently address, and is now labeled as such
rather than hidden inside `uncorroborated`.

## Originals — confirmed byte-identical

`~/BoardSmithGames/seven/rulebook/source/rules.pdf` (`5138858e...`) and
`~/BoardSmithGames/one-two-punch/rulebook/source/rules.pdf` (`e28d1875...`), plus both games' own
working-copy `rules.pdf`, hashed before this plan's work began and again after all dispatches and
re-measurement completed — all four hashes identical both times
(`177-17-MEASUREMENT/originals-before-and-after.sha256`). `one-two-punch`'s pre-existing unstaged
`.boardsmith/` deletions (noted in 177-16) remain, untouched by this plan.

## Overall verdict (not a disposition — reporting for the orchestrator)

**Positive, and specific.** Both gaps 177-15/177-16 named as open are closed with measured
evidence, not just code: multi-step composition recovers `seven` L21 and L36 from `uncorroborated`
to `corroborated-by-composition`; absence classification correctly separates a mechanically-
verifiable absence claim (`otp` L128) from one that genuinely cannot be safely checked (`otp`
L132), rather than letting both masquerade as the same undifferentiated `uncorroborated` bucket.
Both changes were verified two ways — code-isolated against real archived data, and a fresh live
dispatch against the updated contract — and both ways agree. The remaining honest gap is small and
named precisely: 2 of 14 lines are genuine dual-enumeration misses unrelated to either fix, and 1
line is structurally outside what any current mechanism in this design can check at all.
Confidence: still low-to-moderate on general applicability — this remains a 5-passage, 2-game, 14-
line corpus — but the specific claims measured here (chain composition works for the one real
compound case; the absence sound/unsound split holds under a live model, not just a spec) are now
directly demonstrated, not inferred.

**CHECK-04 remains open.** This plan reports evidence; it does not close the requirement in
`REQUIREMENTS.md`, and `STATE.md`/`ROADMAP.md` were not touched.

## Deviations from Plan

**1. [Rule 1 - bug, caught before commit] `quoteLinesOnly()` returns `string[]`, not `string` —
initial absence-scan code called `.toLowerCase()` directly on the array.**
- **Found during:** first test run of the new absence-classification branch.
- **Issue:** `quoteLinesOnly(passage).toLowerCase()` threw `TypeError: ... .toLowerCase is not a
  function` — the function's real return type is an array of quote lines, not a joined string.
- **Fix:** `quoteLinesOnly(passage).join('\n').toLowerCase()`.
- **Files modified:** `src/cli/commands/verify-enumerate.ts` (one line, part of the same commit
  that introduced the branch — never shipped broken).
- **Verification:** all 61 tests in `verify-enumerate.test.ts` pass, including the 6 new absence-
  claim tests that exercise this exact code path against both synthetic and real fixture text.

No other deviations — both structural gaps were closed exactly as scoped, and re-measurement used
both comparison shapes the plan specified.

## Known Stubs

None — this plan writes no UI or data-flow code; it extends a pure-computation module and its
paired judgment contract.

## Threat Flags

None. No new network endpoint, auth path, or file-access pattern — `composeArithmeticChain` is pure
computation and the absence check reads only already-in-memory passage text supplied by the caller.

## Self-Check: PASSED

- FOUND: src/cli/commands/verify-enumerate.ts (composeArithmeticChain, MAX_ARITHMETIC_CHAIN_DEPTH, 'absence' branch)
- FOUND: src/cli/commands/verify-enumerate.test.ts (61 tests, up from 46)
- FOUND: src/cli/slash-command/bs/verify/reconcile-facts.md (multi-step + absence guidance)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/README.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/code-isolated-comparison/reanalysis.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/fresh-dispatch/{enumA,enumB,reconcile,fresh-classification}.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-17-MEASUREMENT/originals-before-and-after.sha256
- FOUND commit: 4f9704fa (feat(check04-core): bound multi-step arithmetic composition and classify absence claims)
- FOUND commit: ff38481d (docs(check04-contracts): teach reconcile-facts.md multi-step composition and absence claims)
- FOUND commit: d083139f (docs(177-17): record post-fix re-measurement)

## Full test run

`npm test`: **4109/4109 passed**, full suite, run from `/Users/jtsmith/BoardSmith` (baseline 4094 +
15 net-new tests from this plan's `composeArithmeticChain` and absence-classification pins).

## Self-Check: PASSED (verified)

All key files and all three commit hashes above confirmed present on disk / in `git log` before
this Summary was finalized.
