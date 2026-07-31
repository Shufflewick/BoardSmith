# Phase 177 — Goal Measurement (Plan 13)

**Purpose, stated up front:** this document measures Phase 177's own GOAL — "Rule-bearing
inferences get an independent second opinion, separate from the presentation notes the Phase 170
split now keeps out of the way" — in the goal's own unit, not by inference from the three success
criteria passing or failing. This follows the project's own hard-won convention (MEMORY: "Phase
goal vs success criteria" — v4.9 Phase 174 scored 90.9% on SC-2 and still failed its goal at 100%
chunks stale). Phase 177 already demonstrated the same discipline once, honestly, in its first
pass (`177-07`: green tests, "Goal NOT MET" stated in those words). This document closes the loop
with an actual per-line measurement rather than a restated inference.

Every number cited below is read directly from `177-PROOF-2.md`'s recorded artifacts (§§1-3), never
recomputed by hand from first principles. Where a table below reproduces a value, the source
section is named inline.

## The goal's own unit

Per this plan's own interfaces block (`177-13-PLAN.md`), a rule-bearing `Derived` line got what the
goal promises only when ALL FOUR of the following are true of it:

1. **Enumeration** — it was enumerated as a candidate, not silently dropped.
2. **Independence** — its blind dispatch carried no annotation family, no slice path, no line
   number in the saved prompt.
3. **Targeting** — the second opinion was about THAT line's own fact: `factAlignment === 'same-fact'`,
   or a terminal blind outcome (`underivable`/`not-rule-bearing`) legitimately reached — AND the
   candidate was not `targetingAmbiguous` (a shared, indistinguishable focus passage with another
   candidate in the same slice means the mechanism cannot prove the opinion was about *this*
   line's fact specifically, even when the landed verdict happens to be benign).
4. **Recording** — a verdict was actually recorded through the real write surface; no `pending`
   finding remains.

## Population: the 16 real dispatch candidates, not the 22-line total

`177-PROOF-2.md` §1 reconciles `seven` (`enumeratedCount` 10 + `presentationExcludedCount` 0 = 10)
and `one-two-punch` (`enumeratedCount` 6 + `presentationExcludedCount` 6 = 12), total 22, matching
`177-CONTEXT.md`'s Measured Reality exactly. The 6 `one-two-punch` lines mechanically excluded by
`isPresentationLine` are, by the mechanism's own correct classification (the fix `177-01`/decision
13 shipped), presentation notes — exactly the population the goal's own text says stays "out of the
way," not rule-bearing inferences under test. They are correctly excluded from the goal's unit, not
silently dropped (Condition 1 is satisfied for all 22 — the 6 are enumerated AND reported as
excluded, never vanish). The goal's unit therefore applies to the **16 real dispatch candidates**
(10 `seven` + 6 `one-two-punch`), the same population `177-PROOF.md` and `177-PROOF-2.md` both
measured throughout.

## Condition 1 (Enumeration) and Condition 4 (Recording) — both satisfied for all 16

- **Enumeration:** all 16 real candidates were dispatched; `177-PROOF-2.md` §1's reconciliation
  matches the 22-line total exactly, with the 6 presentation exclusions accounted for, not dropped.
- **Recording:** `177-PROOF-2.md` §3 — both games' `verify-derive-recheck --json` report **zero
  `pending`, zero `staleRecords`, zero `orphanedRecords`**. Every one of the 16 real dispatch
  outcomes was recorded through the real, registered `verify-derive-record` CLI (never a driver
  import of the recording function directly).

No line fails on Condition 1 or Condition 4. The goal's fate rests entirely on Conditions 2 and 3.

## Condition 2 (Independence) — satisfied for all 16

`177-PROOF-2.md` §2(a): zero `Derived (p.`/`Visual (p.` matches across all 16 blind prompts.
§2(b) (new this run): each candidate's own slice path and own line number, grepped against its own
blind prompt — clean, zero real leaks (one line-number-digit false positive investigated and
confirmed coincidental — `"30 MINUTES"` box play-time text plus a hex substring of the opaque
handle, neither the target's own resolvable line number). No line fails Condition 2.

## Condition 3 (Targeting) — the condition that decides the goal, per line

| # | Location | Verdict / factAlignment | `targetingAmbiguous` | Condition 3 | Reason if failed |
|---|---|---|---|---|---|
| 1 | `seven:01-definitions-and-components.md:8` | `disagrees` / different-fact | false | **FAIL** | off-target: blind derivation answered a different fact (Hand-size math) than line 8's own claim (Set-example illustration) |
| 2 | `seven:01-definitions-and-components.md:14` | `disagrees` / different-fact | false | **FAIL** | off-target: derived the Run definition, not line 14's own claim (illustration value mismatch) |
| 3 | `seven:01-definitions-and-components.md:19` | `agrees` / same-fact | **true** (shares w/ 21) | **FAIL** | targeting-ambiguous: benign collision, but the mechanism cannot prove the opinion targeted line 19 specifically rather than line 21 |
| 4 | `seven:01-definitions-and-components.md:21` | `agrees` / same-fact | **true** (shares w/ 19) | **FAIL** | targeting-ambiguous: same collision, mirrored |
| 5 | `seven:01-definitions-and-components.md:33` | `underivable` (legitimate) | false | **PASS** | — |
| 6 | `seven:01-overview-setup-and-play.md:36` | `disagrees` / different-fact | **true** (shares w/ 38) | **FAIL** | targeting-ambiguous AND off-target: the genuinely unresolved Match-Length/Round-structure collision, "produced real damage" per §3 |
| 7 | `seven:01-overview-setup-and-play.md:38` | `disagrees` / different-fact | **true** (shares w/ 36) | **FAIL** | targeting-ambiguous AND off-target, mirrored |
| 8 | `seven:01-overview-setup-and-play.md:42` | `underivable` (legitimate) | false | **PASS** | — |
| 9 | `seven:02-solo-variant.md:11` | `disagrees` / different-fact | false | **FAIL** | off-target: unique focus window, blind subagent still derived something other than line 11's own claim |
| 10 | `seven:02-solo-variant.md:17` | `disagrees` / different-fact | false | **FAIL** | off-target: unique focus window, still off-target |
| 11 | `one-two-punch:01-setup-and-round-structure.md:30` | `agrees` / same-fact | false | **PASS** | — |
| 12 | `one-two-punch:01-setup-and-round-structure.md:52` | `disagrees` / different-fact | false | **FAIL** | off-target: unique focus window, still off-target |
| 13 | `one-two-punch:02-action-cards-and-resolution.md:49` | `disagrees` / different-fact | false | **FAIL** | off-target: this is the ONE case `177-TARGETING-PREDICTION.md` named in advance (rule e) as a predicted mistargeting — confirmed |
| 14 | `one-two-punch:02-action-cards-and-resolution.md:82` | `agrees` / same-fact | false | **PASS** | — |
| 15 | `one-two-punch:02-action-cards-and-resolution.md:89` | `not-rule-bearing` (legitimate) | false | **PASS** | — |
| 16 | `one-two-punch:02-action-cards-and-resolution.md:95` | `underivable` (legitimate) | false | **PASS** | — |

Every number above is `177-PROOF-2.md` §3's own per-line table and its `targetingAmbiguousCount`
subsection, transcribed, not recomputed.

**Passing lines (6 of 16):** `seven:33`, `seven:42`, `one-two-punch:30`, `one-two-punch:82`,
`one-two-punch:89`, `one-two-punch:95`.

**Failing lines (10 of 16), by specific failure sub-reason:**
- **Targeting-ambiguous (mechanical, shared focus passage):** `seven:19`, `seven:21`, `seven:36`,
  `seven:38` (4 lines — matches `177-PROOF-2.md`'s own `targetingAmbiguousCount: 4`).
- **Off-target (unique focus window, blind subagent still derived a different fact):** `seven:8`,
  `seven:14`, `seven:11`, `seven:17`, `one-two-punch:52`, `one-two-punch:49` (6 lines — this is the
  NEW finding `177-PROOF-2.md` surfaces: a correctly and uniquely narrowed focus passage does not
  reliably steer the derivation to the fact it supports).

No line fails on Condition 1, 2, or 4 alone — every failure in this corpus is a Condition 3 failure.

## The measured goal, stated plainly

**Goal's own unit: 6 of 16 real rule-bearing `Derived` line candidates (37.5%) received an
independent second opinion genuinely about that line's own fact.**

Per game:
- `seven`: 2 of 10 (20%) — `seven:33`, `seven:42` (both `underivable`, legitimately unsupported).
- `one-two-punch`: 4 of 6 (67%) — `one-two-punch:30`, `82`, `89`, `95`.
- **Combined: 6/16 = 37.5%.**

**The goal is NOT MET.** Cite `177-PROOF-2.md` §3 for every count above.

## Interpretation rule applied — no new rule introduced

`177-TARGETING-PREDICTION.md`'s interpretation rule (b), the failure rule, already fired in
`177-PROOF-2.md` §3: `offTargetDisagreements` is 8 of 8 `disagrees` verdicts (100%), exceeding
`177-PROOF.md`'s own pre-fix ratio (8/9, 89%) — "THE FIX DID NOT WORK," in the exact words that rule
committed to using in advance. This goal-unit measurement does not introduce a second, competing
interpretation rule; it is the natural per-line consequence of that same fired rule, expressed in
the goal's own unit (a per-line pass/fail count) rather than the metric's own unit (a fraction of
`disagrees` verdicts). No threshold was moved and no new reading was sought here — the 37.5% figure
falls directly out of applying the plan's four pre-defined conditions to `177-PROOF-2.md`'s already
-recorded per-line data.

## SC-1 / SC-2 / SC-3 status vs. the goal status — stated separately, divergence named explicitly

- **SC-1** ("Every rule-bearing `Derived` line ... is re-derived independently ... using only quote
  lines present in the current slice") — **NOT MET.** The "independent of the original transcription
  pass" half is proven (Condition 2, zero leaks). The "using only quote lines... [correctly
  targeting the line under test]" half is measured NOT MET: 10 of 16 candidates fail Condition 3.
- **SC-2** ("A disagreement... is reported as a finding, citing both derivations") — **MET.**
  Every `disagrees` record this run carries `originalReading`/`rederivedReading` verbatim,
  enforced unconditionally by `createDeriveVerdictRecord` (no throw occurred across 8 real
  `disagrees` verdicts).
- **SC-3** ("The check runs with no source rulebook present and correctly ignores `Visual` lines")
  — **MET**, with the same disclosed limitation Phase 176 and `177-PROOF.md` both named:
  source-freeness is structural (proven by code read); `Visual`-ignoring is proven only on
  constructed input (zero real `Visual (p.` lines exist in either reference game, re-confirmed
  directly this run).
- **The phase goal** (its own unit, computed above) — **NOT MET: 6/16 (37.5%).**

**Stated explicitly, in the words the honesty discipline requires: the criteria set is 2/3 MET
(SC-2, SC-3) and the goal is NOT MET.** Unlike Phase 174's divergence pattern (criteria fully
passing while the goal failed at 100% staleness), this phase's own SC-1 already signals the same
failure the goal's own unit now confirms and quantifies — there is no NEW divergence between "the
criteria say it's fine" and "the goal says it isn't" here. What this measurement adds beyond SC-1's
existing NOT MET is a number: not just "targeting is broken" (already known since `177-07`) but
"only 37.5% of the corpus that matters actually got what the goal promises," and a taxonomy of WHY
(4 mechanically-ambiguous, 6 off-target-despite-unique-focus). The value of measuring in the goal's
own unit here is not discovering a hidden divergence — it is refusing to let "SC-1 fails" be read as
a vague or partial failure when the real number is this severe, and refusing to let the phase's
substantial real infrastructure work (a working enumeration, ledger, write surface, and
independence guarantee — all genuinely shipped and proven, per `177-08` through `177-11`) be mistaken
for the goal itself being substantially achieved.

## The residual — named as concrete work, not a caveat

For the goal to be met, the following would still have to be true, concretely:

1. **The blind subagent's own derivation judgment must reliably converge on the fact a
   correctly-scoped focus passage actually supports**, not merely "some fact somewhere in the
   passage." 6 of the 10 failing lines in this corpus already have a UNIQUE, non-ambiguous focus
   window (`targetingAmbiguous: false`) and still land off-target — `focusQuoteWindow`'s
   payload-construction fix (177-11) is proven necessary but not sufficient. Closing this requires
   either (a) a dispatch-prompt redesign that forces the blind subagent to state which SPECIFIC
   sentence(s) within the focus passage it is deriving from before producing a value, so an
   off-target derivation is visible and reportable at the blind stage itself rather than only
   detectable later by the comparison stage; or (b) narrowing `focusQuoteWindow`'s passage further
   than a full citation-header section, to the sentence-cluster level, if that granularity can be
   computed without leaking the withheld line's own position; or (c) some other mechanism not yet
   designed. This is genuinely open — no code in this plan's scope (proof/bookkeeping only)
   attempts to close it.
2. **The 4 mechanically-ambiguous lines (`seven:19`/`21`, `seven:36`/`38`) need a targeting
   mechanism that can distinguish between multiple candidates sharing one citation-header passage**
   — `derivePayloadSet`'s `targetingAmbiguous` flag correctly SURFACES this residual (that part
   works, per its exact-match prediction) but does not RESOLVE it. A resolution would need either a
   finer-grained passage-splitting heuristic within a single citation header (risking the exact
   kind of leak CR-07 closed if done carelessly) or accepting these as a permanently-reported,
   honestly-disclosed residual category the goal's own unit will never count as satisfied.
3. Neither of the above was attempted in `177-08` through `177-12` — they were out of scope for
   proof-only and structural-fix plans. They remain the concrete next-attempt work, not vague future
   polish.

## Precedent named explicitly

This measurement follows the v4.9 Phase 174 precedent by name, per this plan's own instruction: a
phase can pass every criterion (Phase 174: SC-2 at 90.9%) and still fail its goal (100% chunks
stale) — and the correct response is to say so in those words, not to round the criteria's near-pass
up into a goal-pass. Phase 177 is a variant of the same lesson: here the criteria (2/3) already
signalled trouble, and the goal's own unit (37.5%) confirms and quantifies it rather than
contradicting it — the discipline is the same either way: measure the goal in its own unit, report
what it says, whatever it says.

## Findings ledger — all 18 `177-REVIEW.md` findings accounted for

Every finding is either fixed (naming the plan and the empirical pin that proves it) or deliberately
deferred (naming the reason and the date of deferral). No blank rows.

| Finding | Status | Plan | Evidence / reason |
|---|---|---|---|
| CR-01 (blockquote/list decoration leak + silent-drop) | **FIXED** | 177-08 | `annotationBody()` single decoration-normalization site + construction-site backstop throw in `buildBlindDerivePayload`. Empirically proven: reverting `annotationBody` failed 6 tests with real recorded output (177-08-SUMMARY.md). |
| CR-02 (`readDeriveVerdicts` bypasses the validation choke point) | **FIXED** | 177-09 | Every parsed ledger line now re-enters `createDeriveVerdictRecord`. Empirically proven: reverting to the pre-fix `JSON.parse(l) as DeriveVerdictRecord` cast reproduced the reviewer's exact `"TOTALLY-BOGUS": NaN` output, then 4 tests failed (177-09-SUMMARY.md). |
| CR-03 (verdicts joined by line number only — stale record silently reported against different text) | **FIXED** | 177-10 | Join now requires `record.originalLine === entry.text`; a mismatch reports `pending` and is named in `staleRecords`. Empirically proven: reverting to location-only join failed with real observed `expected 'agrees' to be 'pending'` (177-10-SUMMARY.md). `177-PROOF-2.md` §3 confirms zero `staleRecords` in the live run. |
| CR-04 (ledger fence injection via unescaped model-controlled `reasoning`) | **FIXED** | 177-09 | `createDeriveVerdictRecord` throws on any `reasoning`/`originalReading`/`rederivedReading` carrying a ledger fence marker. Empirically proven: deleting the block failed 3 tests (177-09-SUMMARY.md). |
| CR-05 (no CLI write surface — CHECK-04 could not complete end-to-end) | **FIXED** | 177-10 | `boardsmith verify-derive-record` registered, no bypass option. Proven with a real built-CLI invocation (two successive calls, both survive). `177-PROOF-2.md` §1/§3 confirms all 16 real recordings this run went through the real registered CLI, never a driver import. |
| CR-06 (`recordDeriveVerdicts` replaces the whole ledger, destroying prior verdicts) | **FIXED** | 177-09 | Renamed to `replaceDeriveVerdicts`; new `recordDeriveVerdict` upserts by `slicePath:lineNumber`. Empirically proven: reverting to the destructive call pattern failed the two-different-locations test (177-09-SUMMARY.md). |
| CR-07 (payload hands the blind subagent a resolvable `slicePath:lineNumber` pointer) | **FIXED** | 177-11 | `blindDeriveHandle(entry)` — opaque sha256-truncated digest — is the ONLY target identifier a blind prompt carries; `grep -c 'Slice: '` returns 0. Empirically proven: reintroducing the resolvable pointer failed 2 tests asserting its absence (177-11-SUMMARY.md). `177-PROOF-2.md` §2(b) adds a NEW own-coordinate leak check on real dispatch data — clean. |
| WR-01 (`Derived (p.N)` regex diverges from `ingest-archive.ts`) | **FIXED** | 177-08 | Shared `DERIVED_LINE_RE` extracted to a dependency-free leaf module (`derived-line-pattern.ts`), consumed by both modules. |
| WR-02 (every `readdir` failure reported as "No rulebook/ directory") | **FIXED** | 177-10 | `readLiveSlices` distinguishes `ENOENT` from other errno codes. Proven with a real `fs.chmod(dir, 0o000)` EACCES fixture, not a mock. |
| WR-03 (orphaned ledger records silently discarded from the report) | **FIXED** | 177-10 | `orphanedRecords` added to `VerifyDeriveRecheckResult`, printed per-orphan. `177-PROOF-2.md` §3 confirms zero `orphanedRecords` in the live run. |
| WR-04 (`underivable`/`not-rule-bearing` pass-through had no code cross-check) | **FIXED** | 177-09 | `rederivedValue` is now a required input; a contradicting compare verdict throws. |
| WR-05 (`sourceQuotes` silently defaults to `[]`, permitting evidence-free `agrees`/`disagrees`) | **FIXED** | 177-09 | Non-empty `sourceQuotes` required for `agrees`/`disagrees`; `underivable` carve-out preserved and pinned. |
| WR-06 (report prints literal `undefined` for a `disagrees` record missing readings) | **FIXED** | 177-10 | `formatReading()` extracted as the printer's single fallback site. The scenario was independently proven UNREACHABLE end-to-end (177-09's CR-02 fix had already closed the read path WR-06 named) — the defensive guard was kept anyway per the honesty discipline (proved rather than assumed closed). |
| WR-07 (`quoteLinesOnly`'s deny-list should invert to an allow-list) | **DEFERRED (deliberate)** | — | Deferred explicitly in `177-08-PLAN.md`'s own instruction, dated 2026-07-30 (177-08's execution date), and not implemented in any of 177-08 through 177-12. Reason: the deny-list was made structurally safe by other means in this same phase — `buildBlindDerivePayload`'s construction-site backstop (CR-01's fix) throws on ANY assembled payload matching an annotation family regardless of which prefix regex missed it, which mitigates the leak risk an allow-list inversion would also address. The inversion itself (validating quote-shape parsing against a broader corpus of citation/quote forms) is real, additional work not attempted here, and `177-PROOF-2.md` neither exercises nor newly evidences it either way. Left open for a future phase. |
| WR-08 (`derive-recheck.md` misattributes who strips the payload; omits `Named-but-undefined`) | **FIXED** | 177-10 | Corrected to attribute stripping to `buildBlindDerivePayload`; `Named-but-undefined` added to the never-given list. |
| WR-09 (widened presentation qualifier applied asymmetrically; can't express nesting) | **FIXED** | 177-08 | Optional qualifier group applied symmetrically to the `Visual` marker; widened to a nesting-tolerant `\([^:]*\)`. |
| WR-10 (redundant, ineffective `fs.access` pre-check) | **FIXED** | 177-10 | Deleted; `readLiveSlices` is now the module's sole "no rulebook/" throw site. |
| WR-11 (source-guard tests assert on the module's own text, not its behavior) | **FIXED** | 177-08 | Four tautological `readFileSync`-and-grep tests replaced with behavioral assertions against real temp-project decoy trees. |

**17 of 18 fixed; 1 (WR-07) deliberately deferred with a recorded reason and date.** No finding is
unaccounted for.

## What the next attempt needs to know (carried forward)

The most valuable output of this gap-closure sequence is arguably the negative finding itself, not
the infrastructure (real, substantial, and correctly built as it is): **blind re-derivation of a
specific inference from a shared or adjacent-topic passage is harder than the original design
assumed.** `177-11`'s fix — opaque target handle plus quote-local focus narrowing — closed the
independence leak (CR-07) and worked exactly as designed at the payload-construction layer (zero
coordinate leaks; `targetingAmbiguousCount` predicted exactly, 4/16, by a zero-dispatch mechanical
dry-run). But narrowing the payload's TOPIC did not reliably narrow the blind subagent's own
DERIVATION to that topic — 6 of this run's 10 failing lines have a uniquely-scoped focus window and
still land off-target. **The next attempt at this goal should not re-try payload-construction
fixes** (narrower windows, different framing of the target identifier, more explicit "only derive
from the material below" instructions) without first establishing, empirically, whether the failure
mode is in the subagent's reading comprehension of a correctly-scoped prompt or in some remaining
payload-construction defect this measurement did not surface. The cheapest next experiment is
probably (1) above: require the blind subagent to cite which specific sentence(s) it derived from
before returning a value, and check whether THAT citation matches the target's own actual support —
this would separate "subagent read the passage wrong" from "subagent read a different passage" at
the point of failure, which the current two-stage (blind then compare) design cannot distinguish
today.
