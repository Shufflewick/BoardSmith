# 177-20 Pre-Registration — CHECK-04 Consolidated Measurement

Committed alone, before any dispatch. Named per the run's `honesty_discipline`: results below must
not be tuned after seeing output. If anything here is revised, the revision and both runs are
disclosed in `177-20-SUMMARY.md`.

## What is being measured

The real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`, `enumerate-facts.md`,
`reconcile-facts.md`) — current HEAD `b1a9bc35`, which already includes all four fixes the prior
measurement chain made across three prior code states (`ac5f64c5` operand-unit token compatibility,
`d1c7199a` annotation-vocabulary backstop, `4ddee529` per-slice `QuoteVerifiedProvenance`, `b5be6f65`
multi-source `ingest-archive`) — run against all three reference games in one pass, twice, for
determinism.

**Corpora, project directories used directly** (confirmed byte-identical in slice content to
`177-FIXTURES/seven` and `/one-two-punch`; provenance already recorded there by 177-16/177-19):

- `~/BoardSmithGames/seven` — 3 real `Derived` lines (`01-overview-setup-and-play.md` x2,
  `01-definitions-and-components.md` x1)
- `~/BoardSmithGames/one-two-punch` — 11 real `Derived` lines (`01-setup-and-round-structure.md` x4,
  `02-action-cards-and-resolution.md` x7)
- `~/BoardSmithGames/doom-machine` — 19 real `Derived` lines across 11 slices (10 ordinary slices +
  `CARDS.md`'s 5, including the two bare-`Derived:` lines the `d1c7199a` fix now catches)

**Total: 33 `Derived` lines, 16 slices, 2 enumerators + 1 reconciler per slice per run, 2 full runs
= up to 96 real `claude -p` dispatches** (fewer if a slice's construction-site backstop throws and
that slice is reported as a throw rather than worked around — no manual stripping this time; if
`buildEnumeratorPayload` throws on any slice, current code, that throw itself is the finding for
that slice, disclosed in the consolidated proof, not silently patched around as 177-18 did once).

## Concrete failure predictions (falsifiable, checked against this run's own output)

1. **Grounding rejections will be non-zero on `CARDS.md` specifically, again.** 177-18 measured
   32/98 (33%) and 1/145 (0.7%) on two runs of `CARDS.md` alone, attributed to its dense, repetitive,
   tabular per-card structure — a corpus property, not a code defect the intervening fixes touch.
   Predict: at least one of this run's two `CARDS.md` passes shows a double-digit rejection count
   (not necessarily matching 32 exactly). A **failure of this prediction downward to 0/0 rejections
   on both runs** would itself be worth reporting as an unexplained improvement, not silently
   accepted as good news.

2. **The two `d1c7199a`-targeted lines (`CARDS.md` original lines 30, 140 — bare `Derived:` with no
   page citation) will NOT leak into the enumerator payload this time**, and will each land the
   design's honest, non-fabricated bucket for a real dual-enumeration miss on a fact this specific
   (most likely `uncorroborated`, `absence-*`, or `quote-unverified` — NOT `corroborated` from a
   leaked restatement). **A `corroborated` verdict on either line, without a construction-site
   throw somewhere in this run's `CARDS.md` dispatch, would mean the vocabulary fix did not
   actually close 177-18's leak** and CHECK-04 must not close on this run's evidence regardless of
   what every other line shows.

3. **Determinism will hold on the two small games (14 lines) exactly as it did across every prior
   run of them (177-15/17/19), but may NOT hold on `doom-machine`'s `CARDS.md` lines specifically**
   — 177-18 measured 2 of 3 re-checked `CARDS.md`-adjacent lines flip between runs, both traced to
   the leak. If the leak is genuinely closed (prediction 2), the mechanism this flip depended on is
   gone; predict determinism holds on ALL 33 lines this run, but flag this as the single most
   important thing to check first when analyzing results, because it is the one place instability
   was previously measured and never re-verified against the actual fix.

4. **Zero lines will resolve `contradicted`.** No prior run at any code state has ever produced a
   false disagreement under this design — that is the entire measured advantage over the retired
   per-line design. A single `contradicted` verdict on this run would be the specific,
   named failure that blocks CHECK-04's closure per the run's closing criteria, regardless of every
   other number.

## What would mean CHECK-04 should NOT close (the concrete non-closure outcome required by this run's brief)

**If prediction 2 fails** — i.e., a bare-`Derived:` line lands `corroborated` on a genuine leak, not
a construction-site throw — CHECK-04 stays open. The `d1c7199a` fix would be proven not to close the
independence-breaking gap it was built for, on the exact real corpus that originally found the gap,
and no amount of clean results on `seven`/`one-two-punch` would offset a reproduced instance of the
retired design's core fatal flaw (confirmation, not independence).

**If any line resolves `contradicted`** (prediction 4 failing) — CHECK-04 stays open, per the run's
own closing criterion 3 (a single confident false accusation blocks closure unconditionally).

Both of these are named now, before any dispatch, specifically so a later reader can check whether
this measurement was tuned after the fact.
