# 177-21 Pre-Registration — CHECK-04 Definitive Consolidated Measurement

Committed alone, before any dispatch. Named per this run's `honesty_discipline`: results below must
not be tuned after seeing output. If anything here is revised, the revision and both runs are
disclosed in `177-21-SUMMARY.md`.

## What is being measured

The real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`, `enumerate-facts.md`,
`reconcile-facts.md`) — current HEAD `564f1a42`, which includes the two fixes the 177-20
consolidated run's evidence forced: deterministic rank-ordered `findMatch` (was `list.find()`,
first-match-wins) and `ANNOTATION_VOCABULARY_RE` widened to consume all non-alphanumeric leading
decoration (was a hand-enumerated character class that missed `(`) — run against all three
reference games in one pass, twice, for determinism.

**Corpora, project directories used directly** (mechanically confirmed byte-identical to
`177-FIXTURES/seven`/`/one-two-punch` in slice content by the same method 177-20 used; provenance
already recorded there by 177-16/177-19; sha256 hashes taken before this run's own work began,
`177-21-MEASUREMENT/baseline-{game}.sha256`):

- `~/BoardSmithGames/seven` — 3 real `Derived` lines
- `~/BoardSmithGames/one-two-punch` — 11 real `Derived` lines
- `~/BoardSmithGames/doom-machine` — 19 real `Derived` lines across 11 slices, including `CARDS.md`'s 5

**Total: 33 `Derived` lines, 15 slices.**

## A mechanical fact already established before any dispatch (not a prediction — code behavior, not model output)

Running the real, unmodified `buildEnumeratorPayload` (via `extract-corpus.mjs`, reused unmodified
from 177-20 except for output paths) against all three game repos on current code: **all 33 lines
across all 15 slices now build a payload successfully — zero construction-site throws.**
`CARDS.md`, entirely blocked in 177-20 by the line-270 mid-sentence citation throw, now dispatches
cleanly. This is expected and mechanical (the `ANY_ANNOTATION_LINE_RE`/`ANNOTATION_VOCABULARY_RE`
strip-then-backstop pipeline runs deterministically over static text; there is no model
non-determinism at this stage), so it is recorded as an established fact, not a falsifiable
prediction, and is why this run can attempt all 33 lines instead of 177-20's 28.

Independence was also grep-confirmed on all 33 assembled payloads before any dispatch (not a
prediction; the same reasoning applies — payload assembly is mechanical text processing):
`grep -l -iE "Derived|Visual \(p\.|Named-but-undefined" payloads/*.payload.txt` → 0 matches;
`grep -L "BS-ENUMERATE-V1" payloads/*.payload.txt` → 0 matches (every payload carries the token).

## Concrete falsifiable predictions (checked against this run's own real dispatch output)

1. **Determinism will hold on all 33 lines, including `seven` L21 (`7x4x4=112`), the exact line
   that flipped in 177-20.** The `findMatch` fix directly targets the mechanism that caused that
   flip (shared `sourceSentence` across multiple facts, first-match-wins ambiguity) — the fix
   replaces first-match with a deterministic strongest-rank-then-content-id-tiebreak selection,
   which is a total order independent of list enumeration order. **A flip on ANY of the 33 lines
   between run 1 and run 2 — `seven` L21 specifically, or any other line — means the fix did not
   fully close the defect, or a new determinism gap exists, and CHECK-04 must NOT close on this
   run's evidence.**

2. **Zero lines will resolve `contradicted`, on any of the 33 lines, in either run.** No prior run
   at any code state has ever produced a false disagreement under this design. **A single
   `contradicted` verdict blocks closure unconditionally, per this run's own closing criterion 3.**

3. **`CARDS.md`'s 5 lines, now dispatchable for the first time in this measurement chain, will
   NOT show a leaked annotation reaching `corroborated` from a restated inference** — specifically
   line 140's `(Derived: effectively a 2-space loop...)` form, the exact case 177-20 found
   `ANNOTATION_VOCABULARY_RE` missing on paren decoration. Already grep-confirmed absent from the
   assembled payload above (established fact, not prediction) — this prediction is about the
   DOWNSTREAM classification: no `corroborated` verdict on that line traceable to the annotation's
   own wording appearing in an enumerator's fact list. **If `corroborated` is reached AND
   traceable to the annotation's own phrasing, the independence fix has a live leak on real
   evidence, and CHECK-04 must NOT close.**

4. **Grounding rejections, if any, will each be a genuine reconciler Rule-2 violation (paraphrase,
   not verbatim quote) traceable by inspection — not a mechanism failure.** No specific count is
   predicted (177-20 measured a low single-digit rate against 487 total "both" claims across 28
   lines; this run adds `CARDS.md`'s 5 previously-unmeasured lines, so the total claim count and
   rejection count will differ from 177-20's numbers and must not be compared as if the same
   corpus).

## What would mean CHECK-04 should NOT close (the concrete non-closure outcome required by this run's brief)

**If prediction 1 fails** (any of the 33 lines classifies differently between run 1 and run 2) —
CHECK-04 stays open. The `findMatch` fix would be proven not to fully close determinism on the
exact corpus and code state this run measures, and a metric that still moves on its own cannot
support closure regardless of every other number.

**If prediction 2 fails** (any line resolves `contradicted`) — CHECK-04 stays open, per this run's
own closing criterion 3 (a single confident false accusation blocks closure unconditionally,
because it aims a human at the one line that was right).

**If prediction 3 fails** (a leaked annotation reaches `corroborated` on `CARDS.md`, traceably) —
CHECK-04 stays open; the independence guarantee would have a live, exercised leak, not merely a
latent one.

All three are named now, before any dispatch, specifically so a later reader can check whether this
measurement was tuned after the fact.
