# Phase 177 Plan 12: Targeting-Fix Re-Proof — Distribution Prediction

**NO REAL `claude -p` DISPATCH HAS BEEN RUN FOR THIS FILE.** This prediction is written from (a) a
zero-model-dispatch mechanical dry-run of `derivePayloadSet`/`enumerateDerivedLines`/
`readLiveSlices` — the shipped 177-11 functions, imported directly, never reimplemented — against
both reference games' real live slices, and (b) a close manual reading of the real focus-passage
content that dry-run printed for all 16 real dispatch candidates, cross-checked against
`177-PREDICTION.md`'s own per-line reasoning and `177-PROOF.md` §3's targeting-collapse findings.
No `claude -p` subprocess exists anywhere in the history of this file. It is committed in its own
commit, alone, before Task 2 issues a single real dispatch, so that commit's ordering — not this
paragraph's assertion — is what proves the expectation predates the measurement.

**Procedural note, disclosed rather than hidden:** the mechanical dry-run (zero dispatches, fully
deterministic — it calls only already-shipped, already-tested 177-11 code against already-committed
reference-game text) was executed once, before this file was written, in order to learn the real
field shapes `derivePayloadSet` exposes (the plan's own `<read_first>` instruction for this task).
That dry-run's output is quoted below as the *predicted* value for the three purely-mechanical
metrics (payload distinctness, `targetingAmbiguousCount`, and the per-line `targetingAmbiguous`
flags), because those three are 100% code-determined by already-frozen, already-tested source —
reading the code and running it produce the identical number; there is no judgment call or live
dispatch outcome to leak. **The genuinely unknown quantities this file predicts — the verdict
distribution, `offTargetDisagreements` vs. `genuineDisagreements`, and whether the targeting fix
actually reduced the artifact rate `177-PROOF.md` measured — depend on real `claude -p` dispatches
that have not happened and are blind.** Task 2's dispatches are the first time any of those numbers
will exist.

## Metric definitions (shipped `--json` field names)

1. **Mechanical pre-dispatch payload distinctness** — for each slice with 2+ real candidates,
   whether `derivePayloadSet`'s computed `focus` differs between candidates. (The raw payload
   *string* always differs trivially, because `blindDeriveHandle` emits a different opaque hash per
   candidate regardless of focus content — that string-level check is not informative and is
   reported here only to name it explicitly as non-informative.) The metric that matters is
   `targetingAmbiguousCount` (below) — payload strings can differ while still narrowing to the
   identical FOCUS content, which is the actual collapse condition `177-PROOF.md` §3 measured.
2. **`targetingAmbiguousCount`** — count of `DeriveRecheckFinding`s with `targetingAmbiguous: true`
   (`VerifyDeriveRecheckResult.targetingAmbiguousCount`), computed mechanically by
   `derivePayloadSet`, independent of any dispatch.
3. **`offTargetDisagreements` / `genuineDisagreements`** — the split of `disagrees` verdicts by
   recorded `factAlignment` (`VerifyDeriveRecheckResult.offTargetDisagreements` /
   `.genuineDisagreements`). This is the field that answers whether the fix worked: a `disagrees`
   whose `factAlignment` is `different-fact` is the SAME artifact `177-PROOF.md` §3 found (the blind
   stage answered a different question than the one under test); `same-fact` is the class SC-2
   actually promises a designer.
4. **The phase-goal unit `177-13` will report** — the **genuine-disagreement rate among real
   dispatch candidates**: `genuineDisagreements / (dispatched candidate count)`, contrasted against
   the RAW `disagrees / (dispatched candidate count)` rate `177-PROOF.md` reported as 56%. The fix
   is judged to have worked to the extent the raw `disagrees` rate is now dominated by
   `genuineDisagreements` rather than `offTargetDisagreements`, and to the extent
   `targetingAmbiguousCount` — the honestly-reported residual that cannot be resolved without
   leaking the withheld inference — is small relative to the corpus, not merely relative to the old
   `disagrees` count.

## Predicted totals (16 real dispatch candidates — the same 16 `177-PROOF.md` measured)

**Mechanical (measured by the zero-dispatch dry-run, not predicted in the judgment sense — see the
procedural note above):**

| Metric | seven | one-two-punch | Total |
|---|---|---|---|
| Real dispatch candidates | 10 | 6 | 16 |
| `targetingAmbiguousCount` | 4 | 0 | 4 |
| Payload strings distinct (trivial, handle-driven) | 10/10 | 6/6 | 16/16 (100%, non-informative) |
| Distinct-FOCUS-content rate (16 − ambiguous) / 16 | — | — | 12/16 (75%) |

The 4 targeting-ambiguous candidates, named individually (mechanical, zero dispatch):

- `seven:19` / `seven:21` — share the `p.1, Distribution of Cards:` focus passage. **This is a
  BENIGN collision**, not a bug: both lines are genuinely about the same deck-composition fact
  (line 19 describes the diagram, line 21 does the arithmetic over the same numbers), exactly as
  `177-PROOF.md` §3 itself noted ("Lines 19 and 21 are ACTUALLY about deck composition, so the
  collapsed derivation happens to coincide with them — both correctly landed `agrees`").
- `seven:36` / `seven:38` — share the `p.1, Match Length:` focus passage (the nearest citation
  header above both; no intervening heading severs either). **This is a GENUINE residual the
  narrowing cannot resolve**: line 36 is round-structure arithmetic (draw/discard/round count) and
  line 38 is a claim about simultaneity, and neither fact is actually stated inside the Match
  Length passage the walk located — both target lines sit in the slice's `## Round (Simultaneous)`
  section, but the nearest ABOVE citation header is `Match Length`, one section earlier, with no
  heading between them to sever it (the file has no heading immediately above the Round section in
  this slice). This is exactly the class of residual `targetingAmbiguous` exists to report honestly
  rather than hide.

**Judgment (genuinely blind — no dispatch has run):**

| Verdict / split | Predicted count | Reasoning |
|---|---|---|
| `agrees` | 6 | `seven:19`, `seven:21` (deck math, directly supported); `seven:36` (round math, directly supported by its OWN true passage even though the mechanical focus window mistargets it to Match Length — see caveat below); `one-two-punch:30` (box contents, verbatim quote); `one-two-punch:82` ("both rest cards" → two, directly quoted); `one-two-punch:95` (structural absence observation, arguably `not-rule-bearing` — see below, listed here as the harder call) |
| `not-rule-bearing` | 5 | `seven:8`, `seven:14`, `seven:33`, `seven:17` (all pure art/layout description, no rule content in ANY reachable focus, empty or illustration-only); `one-two-punch:95` is the borderline case named in `177-CONTEXT.md` itself — predicted here rather than `agrees` because "no Variants section" is a document-structure fact, not a game rule |
| `underivable` | 3 | `seven:38` (the mistargeted Match-Length focus supports neither "simultaneous" nor anything else about turn order — the word never appears in any quote line at all, matching `177-PREDICTION.md`'s own original call); `one-two-punch:52` (the narrowed focus is the "Starting a New Game" discard worked example, not the Contents total — it does not state 8-per-player either, so `underivable` remains the honest call even with narrowing); `one-two-punch:89` (Colophon focus states only the copyright sentence, never the icon or edition-number claim) |
| `disagrees` | 2 | `one-two-punch:49` (the mechanically-computed focus for this line is `p.2, Fight phase continuation (under Rest):` — a citation header from a DIFFERENT, unrelated passage about resolution order, not icon glyphs; a blind derivation working from that focus will very likely produce a resolution-order or Rest-related reading that is NOT what line 49 asserts, landing `disagrees` with `factAlignment: different-fact` — this is a genuine remaining case of `focusQuoteWindow`'s upward walk locating the nearest citation header even when that header is not actually about the target's own topic, a residual not fully closed by 177-11); `seven:36`/`38`'s pairing carries real risk one of the two lands `disagrees` rather than the `agrees`/`underivable` split predicted above, discussed under Interpretation rules |
| **Total** | **16** | |

**`offTargetDisagreements` predicted: 1** (`one-two-punch:49` — the focus window's own
mistargeting, not a genuine content conflict; `factAlignment: different-fact`).
**`genuineDisagreements` predicted: 0** (no line in this corpus is predicted to produce a real,
on-topic factual conflict this run — `one-two-punch:52`, this phase's one previously-genuine
`disagrees` per `177-PROOF.md` §3, is predicted `underivable` here because its narrowed focus no
longer surfaces the Setup discard-step content in a form the blind stage can derive "8 per player"
from at all, closer to a real `underivable` case than a comparison the blind stage can even attempt).

**Phase-goal unit, predicted:** genuine-disagreement rate `0/16` (0%), against `177-PROOF.md`'s raw
`9/16` (56%) `disagrees` rate — predicting that narrowing collapses the artifact rate dramatically,
with `offTargetDisagreements` (1) and `targetingAmbiguousCount` (4, of which only 2 — `seven:36`/
`38` — are a genuine unresolved residual, the other 2 being the benign `seven:19`/`21` collision)
as the honestly-reported remainder.

## Interpretation rules, fixed BEFORE any result exists

**(a) Success outcome, named concretely:** if the measured `genuineDisagreements` count is 0-2
across the 16 real candidates, AND `offTargetDisagreements` is small (≤2) relative to the OLD raw
9-of-16 `disagrees` share `177-PROOF.md` measured, the targeting fix will be reported as having
worked — the raw `disagrees` rate collapsing because most of it was never a genuine disagreement to
begin with, exactly as `177-PROOF.md` §3 hypothesized but could not yet prove because the mechanism
to split `disagrees` by `factAlignment` did not exist until 177-11.

**(b) FAILURE outcome, named exactly as concretely as (a) — this is the failure this file commits
to reporting plainly if it happens:** if the measured `offTargetDisagreements` count remains large
(more than half of all `disagrees` verdicts, mirroring `177-PROOF.md`'s own 8-of-9 ratio) — i.e. if
`focusQuoteWindow`'s narrowing still routes the blind stage to the WRONG passage often enough that
most `disagrees` verdicts are still targeting artifacts rather than genuine content conflicts — THE
FIX DID NOT WORK, and this document commits, in advance, to reporting that in those exact words in
`177-PROOF-2.md`, not to reframing `offTargetDisagreements` as some other more flattering label, not
to arguing that `targetingAmbiguous`'s honest reporting alone counts as success even if the
underlying rate is unchanged. A worse number than `177-PROOF.md`'s 56% raw `disagrees` rate is also
a valid, reportable outcome under this rule — reducing the artifact SHARE (offTarget vs. genuine)
is what decision matters, not reducing the raw `disagrees` count, which could rise for reasons
unrelated to targeting (e.g. a citation-header walk now correctly severing a passage that previously
accidentally supplied support).

**(c) A `targetingAmbiguousCount` that is non-trivial (this file predicts 4/16, 25%) is NOT itself a
failure** — it is the honest, mechanically-computed residual `derivePayloadSet` exists to report
rather than hide (177-11's whole design point). It becomes evidence the fix DID NOT work only if the
per-line dispatch data shows those specific ambiguous candidates ALSO landing genuine (`same-fact`)
disagreements at a materially higher rate than the un-ambiguous candidates — that comparison will be
made explicitly in `177-PROOF-2.md`, not asserted.

**(d) A uniform result in either direction (all 16 landing the same verdict) would be as suspicious
here as it was in `177-06`'s and Phase 176's own precedent, and will be labelled that way rather than
treated as a clean success.**

**(e) `one-two-punch:49`'s predicted `disagrees`/`different-fact` above is itself a NAMED, IN-ADVANCE
prediction that `focusQuoteWindow` still mistargets at least once in this real corpus** — the
citation-header upward walk can land on the nearest header regardless of topical relevance, and this
prediction commits to that specific miss being counted as evidence the fix is PARTIAL, not complete,
regardless of what the aggregate rate says.

## No threshold may move after the run

Nothing in this file — the predicted counts, the `agrees`/`not-rule-bearing`/`underivable`/
`disagrees` split, the failure-outcome threshold in rule (b), or the specific named prediction for
`one-two-punch:49`/`seven:36`/`seven:38` — may be edited after Task 2's dispatches run. Task 2 and
Task 3 cite this file's commit hash and quote it; they never rewrite it. `177-PREDICTION.md` (the
original 22-line, four-verdict prediction committed in `913bfe7d` for `177-06`) remains untouched by
this plan — `git diff HEAD -- .planning/phases/177-derived-line-re-derivation/177-PREDICTION.md` is
empty both before and after this entire plan's execution.
