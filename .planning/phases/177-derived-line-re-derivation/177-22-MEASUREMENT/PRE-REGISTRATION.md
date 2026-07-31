# 177-22 Pre-Registration — CHECK-04 Definitive Measurement (post-CARDS.md-split)

Committed alone, before any dispatch. Per this milestone's honesty discipline: results below must
not be tuned after seeing output. If anything here is revised, the revision and both runs are
disclosed in `177-22-SUMMARY.md`.

## What is being measured

The real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`, `enumerate-facts.md`,
`reconcile-facts.md`) — current HEAD, unchanged since 177-21 (`564f1a42`, no BoardSmith source
touched by this run) — run against all three reference games in one pass, twice, for determinism.
This repeats 177-21's method exactly, on one changed input: `doom-machine`'s `CARDS.md` (435
lines, 17,804-char payload, 125-150 facts per enumerator — by far the densest slice in any prior
run) was split into 9 page-anchored slices per the transcription contract (doom-machine commit
`7e05243`). Content preservation was proven mechanically and independently re-verified before this
plan started: 49 transcribed QUOTE content lines before and after, `Derived` 5/5, `Visual` 3/3,
missing-line set empty. Largest new slice is 4,135 chars — a 4.3x reduction from the old single
file, within this project's normal 752-3,668 char range except one named synthesis outlier.

**Corpora, project directories used directly** (sha256 hashes taken before this run's own work
began, `177-22-MEASUREMENT/baseline-{game}.sha256`; `seven` and `one-two-punch` are untouched
since 177-21 and are not re-transcribed here):

- `~/BoardSmithGames/seven` — 3 real `Derived` lines (unchanged since 177-21)
- `~/BoardSmithGames/one-two-punch` — 11 real `Derived` lines (unchanged since 177-21)
- `~/BoardSmithGames/doom-machine` — 18 real `Derived` lines across 14 rule/card slices (the
  content is unchanged from 177-21's 19-line count; this run's own corpus-extraction harness
  applies the same `Derived (p.\d` legend-exclusion fix 177-21 disclosed, and the true corrected
  count for this game is 18, not 19 — one line difference from 177-21's own headline number is
  expected because `01-objective-and-setup.md` alone carries 3 (not the 4 informally summed in
  177-21's narrative prose) and this run recomputes mechanically rather than by hand)

**Established fact before dispatch, mechanically confirmed (not a prediction):**
`extract-corpus.mjs` (reused from 177-21 unmodified except output paths) reports **32 real
`Derived` lines across 18 dispatchable slices, zero construction-site throws** — the same total
line count as 177-21 (32), now spread across 18 slices instead of 15 because the CARDS.md split
distributes its 5 lines across up to 5 of the 9 new card slices (`01-card-anatomy`,
`01-cards-overview`, `01-cards-parts-set-1`, `01-cards-trackers`, `03-cards-parts-set-2`), each far
smaller than the old monolithic file.

## The specific line under test for the density hypothesis

177-21's one determinism flip was `doom-machine/CARDS.md` L143 (`Derived (p.1): Effectively a
2-space loop — die goes slot → Damage → dead → back to slot.`), traced to enumerator B (haiku)
decomposing the source material differently across the two runs of the old, dense single-file
slice (125-150 facts per enumerator run). That exact line now lives in
`doom-machine/01-cards-parts-set-1.md` line 66, a slice with only 1 `Derived` line and roughly
2,900 characters total — one of the smallest slices in the whole corpus, not the densest.

## Concrete falsifiable predictions

1. **The density hypothesis: `01-cards-parts-set-1.md` L66 (the exact fact that flipped under
   density in 177-21) will classify identically across both of this run's full runs.** If it
   flips again on a normal-sized slice, the hypothesis that slice density caused the 177-21
   instability is REFUTED, and the flip's real cause is something else (a genuine per-line
   ambiguity independent of slice size, most likely) — reported honestly either way.

2. **Determinism will hold on all 32 lines** (not just the one named above). A flip on ANY line,
   anywhere in the corpus, in either direction — means CHECK-04 does not close on this run's
   evidence, per this run's own closing criterion 1, regardless of whether it is the same line
   177-21 flipped or a new one.

3. **Zero lines will resolve `contradicted`, on any of the 32 lines, in either run.** No prior run
   at any code state has ever produced a false disagreement under this design. A single
   `contradicted` verdict blocks closure unconditionally, per closing criterion 3.

4. **Independence:** zero annotation-vocabulary lines in any of the 32 real assembled enumerator
   payloads, confirmed by grep before any dispatch (not by assertion).

5. **Grounding rejections, if any, will each be a genuine reconciler Rule-2 violation
   (paraphrase/fragment, not verbatim quote), traceable by inspection — not a mechanism failure.**
   No specific count is predicted; 177-21 measured 14 rejections in run 1 (0 in run 2), all on the
   old monolithic `CARDS.md`. If the split reduces or eliminates that rejection cluster, that is
   also part of the density-hypothesis evidence and is reported, not treated as a separate result.

## What would mean CHECK-04 should NOT close (the concrete non-closure outcome required by this
run's brief)

**If prediction 2 fails** (any of the 32 lines classifies differently between run 1 and run 2,
whether or not it is the specific line named in prediction 1) — CHECK-04 stays open. A metric that
still moves on its own, on unchanged code and (for `seven`/`one-two-punch`) unchanged input, cannot
support closure regardless of every other number, and regardless of whether the density hypothesis
held for the one line it was built to explain.

**If prediction 3 fails** (any line resolves `contradicted`) — CHECK-04 stays open unconditionally,
per closing criterion 3 (a single confident false accusation blocks closure regardless of the
aggregate).

**If prediction 4 fails** (an annotation line is found in any dispatched payload) — CHECK-04 stays
open; the independence guarantee would have a live, exercised leak.

If ALL of predictions 2-5 hold on this run's real evidence, and prediction 1 also holds (the named
line is stable), that is the first run in this chain where every one of the five closing criteria
is checked and passes — the disposition in that case is closure, cited to this run specifically,
with the limitations named in the phase brief's closing-criteria section stated verbatim in the
`REQUIREMENTS.md` amendment.

All five are named now, before any dispatch, specifically so a later reader can check whether this
measurement was tuned after the fact.
