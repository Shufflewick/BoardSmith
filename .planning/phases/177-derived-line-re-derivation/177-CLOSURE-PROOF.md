# CHECK-04 Closure Proof — 177-22 Definitive Measurement (post-CARDS.md-split)

One code state (HEAD, unchanged since `564f1a42` — this plan modified no BoardSmith source), all
three reference games, all real `Derived` lines, both determinism passes, using two dispatched
model families named by explicit id (`claude-opus-5`, `claude-haiku-4-5-20251001`) plus a
`claude-sonnet-5` reconciler — repeating 177-21's method exactly on one changed input: doom-machine
commit `7e05243` split `CARDS.md` (435 lines, 17,804-char payload, 125-150 facts/enumerator — by
far the densest slice measured in this chain) into 9 page-anchored slices.

Pre-registration: `.planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/PRE-REGISTRATION.md`,
committed alone (`9e272f58`, `git show --stat` lists exactly one file) before any dispatch.

## Corpus

**Established mechanically, before any dispatch** (`extract-corpus.mjs`, `buildEnumeratorPayload`,
real unmodified code): **32 real `Derived` lines across 18 dispatchable slices, zero
construction-site throws** — the same total line count as 177-21 (32), now spread across 18 slices
instead of 15 because `CARDS.md`'s 5 lines distribute across 5 of its 9 new slices
(`01-card-anatomy`, `01-cards-overview`, `01-cards-parts-set-1`, `01-cards-trackers`,
`03-cards-parts-set-2`).

- `seven` — 3 lines, 2 slices (unchanged corpus since 177-21)
- `one-two-punch` — 11 lines, 2 slices (unchanged corpus since 177-21)
- `doom-machine` — 18 lines, 14 slices (content unchanged since 177-21; now split across more,
  smaller files)

**108 real `claude -p` dispatches**: 18 slices x 2 enumerators x 2 runs (72) + 18 slices x 1
reconciler x 2 runs (36).

## Independence — confirmed, count reported (not asserted)

A coarse `grep -l -iE "Derived|Visual \(p\.|Named-but-undefined"` against all 18 assembled payloads
returned **4 matches** — all four are the identical, real, transcribed document sentence the split
introduced as a cross-reference note (`> See `01-cards-overview.md` for the source note
(QUOTE/Derived/Visual legend)...`), physically present in the source `.md` files themselves (not an
out-of-band annotation), naming the LOCATION of the legend without stating any line's derived
answer. Running the actual production regexes (`ANY_ANNOTATION_LINE_RE`,
`ANNOTATION_VOCABULARY_RE`, both imported unmodified from `verify-enumerate.ts`) against the same
18 payloads returns **zero matches** — the coarse grep's 4 hits do not match either real filter
because "Derived" appears mid-sentence, inside a genuine document quote, never at a line-start after
tolerated decoration and never in the `Derived (p.` citation form. `grep -L "BS-ENUMERATE-V1"` — 0
matches (every payload carries the required token). Independence holds, mechanically, on this run's
real payloads.

## Determinism — FAILS, 4/32 lines flipped (worse than 177-21's 1/32)

| Line | Run 1 | Run 2 | Root cause |
|---|---|---|---|
| `seven/01-definitions-and-components.md` L21 (`7x4x4=112`) | `corroborated-by-composition` | `uncorroborated` | Both runs' reconcilers proposed composition; run 2's citation set (`"minimum card number is 1"` / `"maximum card number is 7"` split, vs run 1's single `"range 1 to 7"` fact) caused `validateGrounding`'s pairing to attach an inconsistent A/B numeric pair (A: 7, B: 1) to one cited statement — `composeArithmeticClaim` correctly refused to compose from an internally-inconsistent operand and the line downgraded to `uncorroborated`. Traced to enumerator decomposition variance surfacing as a grounding-pairing collision, not a silent wrong-answer defect — the real code refused rather than fabricated. |
| `seven/01-overview-setup-and-play.md` L38 | `corroborated` | `uncorroborated` | Enumerator B (haiku) stated the "simultaneous rounds" fact in run 1, omitted it entirely in run 2 (confirmed: 0 hits in run 2's raw B fact list). Cross-run enumerator omission variance. |
| `doom-machine/01-cards-trackers.md` L42 | `uncorroborated` | `corroborated` | Enumerator B stated **zero** of the 6 card-specific damage-effect facts in run 1, all 5-6 in run 2 (confirmed by direct inspection of both raw B fact lists). Cross-run enumerator omission variance, same class, opposite direction. |
| `one-two-punch/02-action-cards-and-resolution.md` L117 | `uncorroborated` | `corroborated` | Enumerator omitted the "never hold both Rest cards" fact in run 1, stated it in run 2. Same class. |

**Zero `contradicted` in either run** (0/32 both runs) — no false accusation.

**The line 177-21 flipped is now STABLE**: `doom-machine/01-cards-parts-set-1.md` L66 (formerly
`CARDS.md` L143, the exact "2-space loop" fact) classified `uncorroborated` in both runs of this
measurement, identically. Prediction 1 (this run's density-hypothesis test on the specific line)
**HOLDS**.

**But prediction 2 (determinism across all 32 lines) FAILS**, on 4 different lines, none of them
the one prediction 1 targeted, and 3 of the 4 on ordinary-sized slices (`seven`, 3 lines total, and
one-two-punch, both untouched by the split). Per this run's own pre-registered rule, this alone
blocks closure.

## The density hypothesis — REFUTED at the aggregate level

The specific line the hypothesis was built to explain (`01-cards-parts-set-1.md` L66) held stable
post-split, which is consistent with the hypothesis in isolation. But the aggregate result
contradicts it: this run's flip rate (4/32, 12.5%) is **higher**, not lower, than both 177-20's
(1/28, 3.6%) and 177-21's (1/32, 3.1%) pre-split rates, and 3 of the 4 flips occur on slices that
were never dense and were never touched by the split (`seven`, 13-25 facts/enumerator;
`one-two-punch`, 40-50 facts/enumerator — both well within this project's normal range, nowhere
near `CARDS.md`'s old 125-150). **Enumerator fact-count comparison, this run's own real data:**

| Slice | Run 1 (A/B) | Run 2 (A/B) |
|---|---|---|
| `01-card-anatomy` | 14/8 | 13/4 |
| `01-cards-overview` | 27/21 | 21/13 |
| `01-cards-parts-set-1` | 48/46 | 40/54 |
| `01-cards-trackers` | 36/32 | 40/38 |
| `03-cards-parts-set-2` | 38/32 | 37/46 |

The 9 new card slices' fact counts (roughly 4-54 facts/enumerator, largest `01-cards-parts-set-1`
at 40-54) are dramatically lower than the old monolithic file's 125-150, and per-slice run-to-run
variance is real but proportionally similar to the variance seen on small non-card slices
elsewhere in the corpus (e.g. `seven/01-definitions-and-components`, 13 vs 9 then 11 vs 9). **The
correct reading of this run's evidence: splitting a dense file into normal-sized slices did not
measurably reduce cross-run instability in aggregate — it only removed one specific instability
locus while leaving the underlying cause (independently-sampled, non-deterministic enumerator
models genuinely enumerating different fact sets on repeat dispatch of unchanged input) fully
intact everywhere else, including small, previously-stable files.** This is the honest result, not
the one the hypothesis predicted, and it is reported as such rather than reframed as a partial win.

## Grounding — zero fabrications passed, all rejections genuine

Run 1: 1 rejected / 360 total "both" claims. Run 2: 8 rejected / 384 total "both" claims. Every
rejection, both runs, is a genuine `reconcile-facts.md` Rule-2 violation — the reconciler quoting a
short glyph/fragment (e.g. `"2. Damage"`, `"-1 POWER"`) or paraphrasing instead of citing the fact's
real `sourceSentence`/`statement` — mechanically caught by `validateGrounding`, spot-checked by
direct inspection against both runs' raw enumerator lists (the quoted fragment genuinely does not
appear verbatim in the named enumerator's fact list in every case examined). Zero fabrications
passed grounding in either run.

## Explainability — every non-corroborated line named

Run 1 (8 `uncorroborated`, 1 `absence-corroborated`, 1 `absence-unverifiable`) and run 2 (same
counts, different lines) are each individually attributed in `177-22-MEASUREMENT/analysis-run{1,2}.json`
to a mechanical reason string produced by the real, unmodified `classifyDerivedLines`: "no grounded
fact corroborates" (dual-enumeration miss, 6/8 run 1, 6/8 run 2), "composed-fact id
mismatch/downgrade" (1/8 each run — `doom-machine/01-gameplay-loop-and-phase-i.md` L15, both runs,
plus `seven` L21 in run 2 specifically), and the two structurally-distinct absence buckets
(1 `absence-corroborated`, 1 `absence-unverifiable`, identical both runs). No unnamed "noise" line
in either run.

## A disclosed live-dispatch data-quality finding (not a `verify-enumerate.ts` defect)

Run 1's enumerator B (haiku) output for `doom-machine/01-objective-and-setup.md` contained raw,
syntactically invalid JSON — an unescaped embedded quote inside a `sourceSentence` string echoing
the source document's own quoted text (`"Find the "Doom Core" machine part card..."`). This is a
harness-level finding (this measurement's manual `--output-format json` + text-parse step is what
exposes a raw model string; the real production dispatch path uses structured Task-tool output, not
manual JSON parsing of CLI text). A generic, non-case-tuned repair (escape any `"` not immediately
followed by a JSON structural character) was applied and disclosed
(`177-22-MEASUREMENT/repair-log-run1.json`, 4 repairs, one file) — written into `analyze.mjs` BEFORE
re-running the analysis a second time on already-completed dispatch data, not after seeing
classification results. No dispatch data was regenerated or hand-edited; only the harness's own
JSON-parsing step was made more tolerant, exactly as 177-21 disclosed its own harness regex fix.

## Closing criteria — final disposition

1. **Determinism** — **FAILS.** 4/32 lines (12.5%) classify differently between run 1 and run 2 on
   unchanged code. This alone blocks closure, per this run's own pre-registered rule.
2. **Grounding** — PASSES. Zero fabrications passed either run; every rejection genuine and
   mechanically caught.
3. **Zero wrongly-`contradicted` lines** — PASSES. 0/32, both runs.
4. **Independence** — PASSES. Zero real annotation-vocabulary matches (production regex) across all
   18 real dispatched payloads, confirmed by grep before dispatch; a coarse over-inclusive grep's 4
   hits are genuine document content, disclosed and distinguished from a real leak.
5. **Explainability** — PASSES. Every non-corroborated line in both runs traces to a named,
   mechanical category.

**CHECK-04 does NOT close on this run's evidence.** Criterion 1 fails, and per the phase brief
("If any criterion fails, do NOT close"), that is dispositive regardless of the other four passing
cleanly for the second consecutive definitive run.

## What this run adds beyond 177-21

- The exact line 177-21 flipped is now stable — the split did not regress that specific
  instability.
- But the density hypothesis, taken as a general explanation for cross-run instability in this
  design, is refuted: the flip rate went UP, not down, and the new flips are concentrated on
  ordinary, previously-stable, untouched slices (`seven`).
- A new determinism-adjacent failure mode is named for the first time: enumerator decomposition
  variance can manifest not just as "nothing to cite" (177-21's story) but as a **grounding-pairing
  collision** during arithmetic composition, correctly caught and refused by
  `composeArithmeticClaim`'s own consistency check rather than propagated as a wrong answer — real
  evidence that the mechanical safety net (Rule 2's inconsistency refusal) held even under this new
  failure shape.
- **What remains open, restated with this run's evidence:** whether byte-identical determinism, as
  currently defined, is achievable at all against two independently-sampled, non-deterministic
  enumerator models — now demonstrated on both dense and ordinary-sized slices, not only the
  original CARDS.md case. Any future attempt to close this requirement needs either (a) a
  redefinition of the determinism criterion (e.g., stability of the reconciler's underlying
  grounded-fact set rather than the final classification label), or (b) a mechanism that makes
  enumeration itself deterministic (unlikely to be achievable against hosted, temperature-bearing
  models without fixing a seed the CLI does not expose), neither attempted here.

## Full test run

`npm test`: run from `/Users/jtsmith/BoardSmith` after all dispatch and analysis work completed,
before the final commit. Result recorded in `177-22-SUMMARY.md`. This plan modified no
`verify-enumerate.ts` or other BoardSmith source file.
