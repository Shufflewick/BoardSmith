# CHECK-04 Definitive Consolidated Proof — Phase 177 Plan 21

One measurement, current code (HEAD `564f1a42`, including `ac5f64c5`/`d1c7199a`/`4ddee529`/`b5be6f65`
from the prior chain, plus this milestone's two most recent fixes: deterministic rank-ordered
`findMatch` and the fully-decoration-tolerant `ANNOTATION_VOCABULARY_RE`), all three reference
games, run twice for determinism. **90 real `claude -p` dispatches** (15 dispatchable slices x 2
enumerators + 1 reconciler x 2 runs), zero simulated, zero hand-authored substitutes.

Pre-registration: `177-21-MEASUREMENT/PRE-REGISTRATION.md`, committed alone (`2aad3d1c`) before any
dispatch.

**Every number below is from THIS run.** 177-15/17/18/19/20 are cited only as explicit historical
comparison, never averaged or combined into this run's totals — each measured a different code
state.

## Corpora

| Game | Project dir | Derived lines | Slices w/ Derived lines |
|---|---|---|---|
| `seven` | `~/BoardSmithGames/seven` | 3 | 2 |
| `one-two-punch` | `~/BoardSmithGames/one-two-punch` | 11 | 2 |
| `doom-machine` | `~/BoardSmithGames/doom-machine` | 18 (14 non-`CARDS.md` + 4 real in `CARDS.md`) | 11 |
| **Total** | | **32** | **15** |

**Correction to the plan brief's stated corpus size (32, not 33 — disclosed, not silently
absorbed):** `CARDS.md` line 8 is the file's OWN LEGEND explaining the `Derived (p.N):` /
`Visual (p.N):` annotation convention, using the literal placeholder text `p.N` (letter N, not a
page number), inside backticks describing the syntax rather than using it:

```
> Text below is one of three kinds of line: QUOTE (transcribed verbatim from the printed card),
> `Derived (p.N):` (a rule-bearing inference — affects legality, scoring, or sequencing), or
> `Visual (p.N):` (a description of card geometry, layout, or colour that carries no rule content).
```

This run's own corpus-extraction harness (adapted from 177-20's `extract-corpus.mjs`, itself
inherited from 177-18's) matched this legend line as if it were a real annotation, because its
mid-line detection regex accepted any character after `p.` instead of requiring a digit. **This
harness bug was never exercised before this run** — every prior measurement round either never
reached `CARDS.md` at all (177-15/17/19) or found the whole file blocked by an unrelated
construction-site throw before this line could matter (177-18/20). It is a bug in this run's own
measurement scaffolding, not in `verify-enumerate.ts` — confirmed by grepping the REAL dispatched
payload text (`payloads/doom-machine__CARDS.payload.txt`) for the legend's wording: zero matches.
The real, unmodified `buildEnumeratorPayload`/`quoteLinesOnly` pipeline already excluded this line
from every actual dispatch, in every run, correctly. Fixed in the extraction harness
(`p.\d` instead of `p.[^)]*`) before analysis, disclosed per Rule 1 and this run's honesty
discipline. **The true count of real, rule-bearing `Derived` lines in this corpus is 32, not 33.**
All 32 were dispatched, in both runs — no line was blocked this time (see Headline 1).

## Headline 1 — all 32 lines dispatch cleanly; `CARDS.md`'s prior block is gone

`buildEnumeratorPayload` threw zero construction-site errors across all 15 slices, in both runs.
`CARDS.md`'s original line-270 mid-sentence citation (`` `+ = / >`). Derived (p.3), by
symmetry... ``, the cause of 177-20's total `CARDS.md` block) no longer throws, because the
`564f1a42` fix broadened `ANNOTATION_VOCABULARY_RE` to consume ALL non-alphanumeric leading
characters rather than a hand-enumerated set — the strip filter now removes that mid-sentence
citation before the backstop ever sees it. **This is the first measurement in this chain's history
to genuinely attempt all real `Derived` lines across all three reference games.**

## Headline 2 — determinism did NOT fully hold, on a DIFFERENT line, for a DIFFERENT reason than 177-20

31 of 32 lines classified identically between run 1 and run 2. **One flipped:**
`doom-machine/rulebook/CARDS.md` L143 (`Derived (p.1): Effectively a 2-space loop — die goes
slot → Damage → dead → back to slot.`) — `corroborated` (run 1) → `uncorroborated` (run 2).

This is **not** a recurrence of 177-20's `findMatch` defect. `seven` L21 — the exact line that
flipped last time — is now stable `corroborated-by-composition` in BOTH runs of this measurement
(confirmed by inspecting `composeAttempts` and `classifications` directly: both runs' compositions
succeed with the same `7 x 4 x 4 = 112` arithmetic, and both runs' operand resolution finds the
expected magnitudes among the cited facts). **The `findMatch` fix worked, on the exact line it was
built to fix, re-measured live.**

Instead, `CARDS.md` L143's flip traces to a **different layer of the pipeline entirely: real,
across-run variance in what the two enumerators (opus/haiku) enumerated**, not to any grounding or
matching code:

- In run 1, enumerator A stated (among 127 facts) `"Landing on a dead space sends the die back to
  position 1 of the cycle track."` and (separately) `"Impact Nexus's cycle track is HP die slot,
  damage, then three dead spaces."` — enumerator B (125 facts) stated the equivalent pairing. The
  reconciler synthesized these into a `corroborated` verdict for L143's "2-space loop" claim,
  citing both.
- In run 2, enumerator A (143 facts) again stated the general dead-space rule AND Impact Nexus's
  specific track shape. But enumerator B (haiku), this run, decomposed the SAME source material
  into 150 much more atomized, per-space facts (`"IMPACT NEXUS cycle track space 1 has the HP die
  slot set to 4."`) and never restated Impact Nexus's cycle-track SHAPE as a single combinable fact
  the way it did in run 1. The reconciler's run-2 proposal for L143 carries **zero**
  `citedBothStatements` — a genuine judgment call that no synthesizable pair existed in what it was
  given, not a matching-code failure.

**Root cause: enumerator (specifically `haiku`, the weaker of the two model families) output
variance in how a large, dense, tabular slice (`CARDS.md`, 125-150 facts per enumerator — by far
the largest slice in this corpus) gets decomposed between independent dispatches of an identical
prompt.** This is model stochasticity at the enumeration step itself, not a code defect this
module's mechanical checks (`validateGrounding`, `findMatch`, `composeArithmeticClaim`) could ever
catch — those checks operate on whatever the enumerators actually returned, and both runs' checks
behaved correctly given their (legitimately different) inputs.

**Per this run's own pre-registered rule, this still blocks closure — regardless of whether the
cause is a code defect or the design's own consumption of a stochastic component.** The
pre-registration named this precisely: "or a new determinism gap exists." One does. It is a
different, arguably harder, category than 177-20's: not a bug to fix in `verify-enumerate.ts`, but
a structural property of dispatching two non-deterministic models against a large, repetitive slice
and expecting the same decomposition twice. Whether a lower `temperature`, a larger/more capable
"B" model, or a stricter enumeration-granularity instruction would close this gap is unmeasured —
naming a fix here would be pre-committing to an untested hypothesis, exactly what this run's
honesty discipline prohibits.

## Headline 3 — grounding: mechanically caught quoting-rule violations, zero fabrications passed through

| Run | Grounded ("both") | Rejected | Total "both" claims |
|---|---|---|---|
| 1 | 322 | 14 | 336 |
| 2 | 377 | 0 | 377 |

All 14 of run 1's rejections are on `doom-machine/CARDS.md` — 13 are `quotedFromA` mismatches where
the reconciler quoted a short glyph fragment (e.g. `"DEAL 3 DMG"`, 10 normalized characters) instead
of the fact's actual `statement` or `sourceSentence` as `reconcile-facts.md`'s Rule 2 requires
("the exact text (statement or source sentence) from A's list"). Spot-checked one
(`Thought Siphon's damage effect deals 3 damage`): enumerator A's real `sourceSentence` was
`"- QUOTE — cards.pdf p.1, row 2 col 2 (Damage strip): \"DEAL 3 DMG\""` — the reconciler's quote is
a genuine substring of that real sourceSentence, but not the sourceSentence itself, and at 10
normalized characters it falls below `MIN_MATCH_LENGTH` (12) for a containment match. **This is
`validateGrounding` working exactly as designed**: the reconciler took a shortcut (quoting the raw
card-text fragment embedded inside A's sourceSentence rather than A's actual sourceSentence), and
the mechanical check correctly refused to accept it as verbatim-traceable. Not a fabrication in the
sense this module exists to catch (a claim about something NEITHER enumerator said) — a
Rule-2-noncompliant quote, mechanically caught and reported per `validateGrounding`'s own contract,
exactly as 177-20 found on the same file and the same class of glyph-text fact. **Zero fabrications
passed grounding in either run.**

## Headline 4 — zero `contradicted`, on any of the 32 lines, in either run

No line in either run resolved `contradicted`. This closing criterion (a single confident false
accusation blocks closure unconditionally, because it aims a human at the one line that was right)
is met on this run's real evidence.

## Headline 5 — independence holds mechanically, confirmed by grep BEFORE any dispatch

```
grep -l -iE "Derived|Visual \(p\.|Named-but-undefined" payloads/*.payload.txt   # 0 matches, all 15 slices
grep -L "BS-ENUMERATE-V1" payloads/*.payload.txt                                # 0 matches — every dispatch carried the token
```

Zero annotation lines reached any of the 32 real enumerator dispatch payloads across both runs
(payloads are per-slice, shared between run 1 and run 2, per the same method 177-20 used). This
includes `CARDS.md` line 140 (`(Derived: effectively a 2-space loop...)`), the exact
parenthesized-form gap 177-20 found `ANNOTATION_VOCABULARY_RE` missing — confirmed absent from the
real assembled payload, on real corpus text, for the first time (177-20 could only check this in an
isolated supplementary test, since `CARDS.md` was entirely blocked from real dispatch that run).
**The `564f1a42` widening of `ANNOTATION_VOCABULARY_RE` to consume all non-alphanumeric leading
decoration closes the gap 177-20 found, verified live.**

## Full classification, both runs (32 real Derived lines)

| Classification | Run 1 | Run 2 |
|---|---|---|
| `corroborated` | 21 | 20 |
| `corroborated-by-composition` | 3 | 3 |
| `uncorroborated` | 6 | 7 |
| `contradicted` | 0 | 0 |
| `quote-unverified` | 0 | 0 |
| `absence-corroborated` | 1 | 1 |
| `absence-unverifiable` | 1 | 1 |
| **Total classified** | **32** | **32** |

Per-game breakdown (run 1 / run 2):

| Game | corroborated | corroborated-by-composition | uncorroborated | absence-* |
|---|---|---|---|---|
| `seven` (3) | 0 / 0 | 2 / 2 | 1 / 1 | — |
| `one-two-punch` (11) | 8 / 8 | 0 / 0 | 1 / 1 | 2 / 2 |
| `doom-machine` incl. `CARDS.md` (18) | 13 / 12 | 1 / 1 | 4 / 5 | — |

## Every non-corroborated line, named by category (both runs; run 2's extra line is the L143 flip)

| Line | Category |
|---|---|
| `seven` L38 (rounds simultaneous) | Genuine dual-enumeration miss — a real gap, no code defect implicated (reproduces 177-18/20) |
| `otp` L117 (2 Rest cards, implied) | Genuine dual-enumeration miss on an implication, not a stated fact (reproduces 177-18/20) |
| `doom-machine 01-dice-roll-symbology` L25 | Cross-slice reference — corroborating detail lives in a different slice than the one under test; structurally invisible to per-passage dual enumeration (reproduces 177-18/20) |
| `doom-machine 01-gameplay-loop-and-phase-i` L15 ("up to 10") | Reconciler proposed a composition this run's harness had no hardcoded arithmetic spec for; `composeArithmeticChain`/`Claim` never ran for it, so it reports `uncorroborated` rather than a verified composition — a genuine capability gap in what this run's own analysis harness pre-registered as arithmetic-bearing, not a `verify-enumerate.ts` defect (the module's real classification behavior — report `uncorroborated` when no composed fact matches — is correct; the harness simply did not attempt every possible composition a reconciler might propose) |
| `doom-machine 02-card-effect-icons` L25 | Cross-slice / compound-synthesis miss (reproduces 177-18/20) |
| `doom-machine 02-player-actions` L23 | Cross-slice reference (Hard Mode card lives in a different slice) (reproduces 177-18/20) |
| `doom-machine CARDS.md` L143 (run 2 only) | **The enumerator-variance determinism flip described in Headline 2 — a genuine cross-run instability, not a stable miss** |

`otp` L132 is its own explicit bucket (`absence-unverifiable`) — a claim spanning several loosely
related concepts with no safe literal target, exactly as designed, not a defect (reproduces
177-18/20).

## Answering the goal in its own unit

**Of 32 real, rule-bearing `Derived` lines across three reference games (the corrected count — see
above), all 32 (100%) received a genuine, independent dual-enumeration attempt on current code, in
both runs.** This is the first measurement in this chain to reach 100% of the real corpus — every
prior round left `CARDS.md` either unmeasured (177-15/17/19) or entirely blocked (177-18/20).

Of the 32:
- **24 (run 1) / 23 (run 2)** resolved to a real, code-verified positive signal (`corroborated` or
  `corroborated-by-composition`).
- **2 (run 1) / 2 (run 2)** resolved `absence-*` — one mechanically confirmed, one honestly flagged
  as structurally unanswerable.
- **6 (run 1) / 7 (run 2)** resolved `uncorroborated` — every one individually attributable to a
  named category above, not unexplained noise.
- **0** resolved `contradicted`, in either run.

### Named categories, per the run's requirement

**(a) Design limitations** (real, reported, not fixed here — none are newly-found code defects this
time, unlike 177-20):
1. Cross-slice references — structurally invisible to a design scoped per-passage (3 lines).
2. A genuine dual-enumeration miss on an implication (1 line) and on a simultaneity claim (1 line).
3. Multi-fact enumerator-decomposition variance on a large, dense, tabular slice — the NEW finding
   this run adds (see Headline 2) — is a property of dispatching stochastic models against a
   32-Derived-line, 125-150-fact slice, not a bug in this module's own deterministic code.

**(b) Corpus/transcription staleness**: NONE this run — `CARDS.md`'s prior blocking defect
(line 270's mid-sentence citation) is now handled cleanly by the widened
`ANNOTATION_VOCABULARY_RE`/strip pipeline; no file is blocked.

**(c) Structurally unanswerable** (by design, not a defect): `otp` L132 — an absence claim spanning
several loosely related concepts with no safe literal target.

**(d) Measurement-harness artifact, disclosed and fixed before analysis** (not a corpus or code
finding): `CARDS.md` line 8, the file's own annotation-convention legend, matched by this run's
initial corpus-extraction regex as if it were a real `Derived` line. Confirmed absent from every
real dispatch (the actual production filter already excludes it). Excluded from all counts above.

## CHECK-04 disposition — NOT closed

Per this run's closing criteria, ALL FIVE must hold. Scored against this run's actual evidence:

1. **Determinism — FAILS.** 31/32 identical, 1 genuine flip (`doom-machine/CARDS.md` L143), traced
   to real enumerator-output variance on a large, dense slice, not a matching/grounding code defect
   (that specific defect, `findMatch`, is CONFIRMED FIXED — `seven` L21 is stable in both runs of
   this measurement). Per this run's own pre-registered rule ("a flip on ANY of the lines... means
   the fix did not fully close the defect, or a new determinism gap exists... CHECK-04 must NOT
   close on this run's evidence" — `PRE-REGISTRATION.md` prediction 1), this is the precise,
   pre-named non-closure condition.
2. Grounding rejections — PASSES (all real Rule-2 violations, mechanically caught and reported,
   zero fabrications passed through, on both runs).
3. Zero `contradicted` — PASSES (0/32 in both runs).
4. Independence — PASSES (confirmed by grep against all 32 real dispatched payloads before any
   dispatch, not by post-hoc assertion — including the exact `CARDS.md` L140 case 177-20 flagged as
   a latent, unexercised gap; it is now exercised, live, and does not leak).
5. Honest explainability — PASSES (every non-corroborated line named, above; no unexplained noise).

**Criterion 1 alone is sufficient to block closure**, per this run's own stated rule and per the
project's five-phase-long convention (177-15 through 177-20) that an honestly-reported failure
beats a flattering close. **CHECK-04 remains open.**

Unlike 177-20, this run does NOT carry forward a specific unfixed code defect as the blocker —
both defects 177-20 named (`findMatch`'s first-match-wins ambiguity, `ANNOTATION_VOCABULARY_RE`'s
missing `(` tolerance) are CONFIRMED FIXED, live, on the exact lines/files that exposed them. What
blocks closure now is a different, more structural finding: **determinism, as this run's criteria
define it (identical classification across two full runs of unchanged input), may not be fully
achievable against a large, information-dense slice dispatched to two independently-sampled models,
without either a code-level intervention this run did not test (e.g., enumeration-granularity
instructions strict enough to force consistent decomposition, or a stronger "B" model) or a
loosening of the closing criterion's own definition of determinism (neither of which is this run's
place to decide unilaterally).**

## Confidence

**Low-to-moderate**, unchanged in kind from every prior measurement in this chain — 3 games, 32
real lines (corrected from the previously-assumed 33), 2 runs. This run's distinguishing
contribution is completeness (100% of the real corpus attempted, for the first time) and a
confirmation that the two specific code defects 177-20 found are genuinely fixed — but it also
demonstrates that fixing named code defects does not guarantee determinism against a
non-deterministic enumeration step, which is a more fundamental property of this design's
architecture than either of the two now-fixed bugs.
