---
phase: 177-derived-line-re-derivation
plan: "06"
subsystem: docs
tags: [verify-pipeline, check-04, derive-recheck, prediction-before-measurement, proof-staging]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation
    plan: "02"
    provides: "buildBlindDerivePayload / enumerateDerivedLines (the 22 real Derived lines), the fixed PRESENTATION_EXCLUSION_MARKERS regex (decision 13)"
  - phase: 177-derived-line-re-derivation
    plan: "03"
    provides: "boardsmith verify-derive-recheck --project/--json CLI surface"
  - phase: 177-derived-line-re-derivation
    plan: "04"
    provides: "BS-DERIVE-V1 / BS-DERIVE-COMPARE-V1 contracts, installed as SHARED_LEAF_PROBES"
provides:
  - "177-PREDICTION.md — a committed-before-measurement, per-line verdict prediction for all 22 real Derived lines, with three interpretation rules fixed in advance"
  - "177-PROOF.md §1 — real cp -R copies, sha256 baselines (before/after, byte-identical), real skill install with filesystem-checked contract files, dispatch mechanism stated in advance, real verify-derive-recheck --json enumeration reconciled against the 10/12/22 counts"
affects: [177-07-derive-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Prediction-before-measurement discipline (174-06, 176-05 precedent) applied a third time: the prediction file states plainly at the top that no dispatch has run, is committed alone in its own commit, and the plan SUMMARY (this file) is the durable record of that commit's hash for later plans to cite."
    - "Interpretation rules fixed before the result exists (a: high underivable is a real finding, never tuned away; b: uniform distribution proves consistency not discrimination; c: zero not-rule-bearing would be suspicious) — mirrors 176-05's committed-bar discipline exactly."
    - "Reconcile-not-silently-adjust: when the real enumerated counts (verify-derive-recheck --json) diverged from what 177-RESEARCH.md's pre-fix regex measurement assumed, the discrepancy is recorded explicitly in 177-PROOF.md rather than silently absorbed or used to retroactively edit the already-committed prediction."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-PREDICTION.md
    - .planning/phases/177-derived-line-re-derivation/177-PROOF.md

key-decisions:
  - "Prediction committed in commit 913bfe7d BEFORE any dispatch, CLI enumeration run, or proof-staging work — plan 07 should cite this hash as the pre-measurement anchor."
  - "The prediction explicitly diverges from 177-RESEARCH.md's own underivability hedge on two lines after closer per-line reading: `seven` line 21 (the '112 cards' deck-math line) is predicted `agrees`, not `underivable`, because the quoted Distribution-of-Cards sentence directly states 1-7/4 colors/4 copies/7 bonus without needing the diagram line research assumed was its only support; `one-two-punch` line 82 ('two Rest cards') is predicted `agrees` because the quoted Tip's word 'both' is itself sufficient support. This is stated as an explicit, defended divergence in the prediction file's own closing section, not a silent contradiction."
  - "Predicted underivable share is 3/22 (~14%), deliberately under the plan's own 20% 'looks unsampled' warning threshold — defended explicitly per the plan's escape hatch ('if that is genuinely what the per-line reading supports, say so explicitly and defend it') rather than hedged upward to a safer-looking number."
  - "Real enumeration (Task 2) found a fact 177-RESEARCH.md could not have known when written: `PRESENTATION_EXCLUSION_MARKERS`'s regex gap (decision 13) was already fixed by this phase's own earlier plans (177-02/177-04, commits 06a4fe44/8a8f86ad), so `one-two-punch` now mechanically excludes 6 of its 12 Derived lines before any dispatch, not the 2 the pre-fix research measurement implied. This changes which lines are real dispatch candidates (16 of 22, not 20) but not the prediction's committed 22-line total or its underivable share (none of the 4 newly-excluded lines were predicted underivable) — recorded as a reconciliation note in 177-PROOF.md, the already-committed prediction file was not edited."
  - "Dispatch mechanism for future re-derivation/comparison dispatches is stated in advance as a `claude -p` OS subprocess, per 173-PROOF.md §6's precedent — this execution session has no native Task/Agent tool exposed, matching every real dispatch in Phases 173-176."

patterns-established:
  - "A prediction file can defend a per-line reading that undercuts a prior phase's own RESEARCH.md hedge, provided the divergence is stated explicitly with the specific quoted text that resolves the ambiguity — not silently substituted for the hedge."

requirements-completed: []  # CHECK-04 stays open — the live claude -p dispatch proof measuring the real distribution against this committed prediction is plan 07's job.

# Metrics
duration: ~50min
completed: 2026-07-30
---

# Phase 177 Plan 06: Derived-Line Re-Derivation — Prediction and Proof Staging Summary

Committed a per-line, pre-dispatch distribution prediction for all 22 real `Derived` lines across the
two pinned reference games, then staged the live proof run (copies, sha256 baselines, real skill
install, real enumeration) without running any dispatch — establishing the git-ordering evidence plan
07's real `claude -p` measurement run will be checked against.

## What Was Built

**Task 1 — `177-PREDICTION.md` (commit `913bfe7d`).** A line-by-line prediction for all 22 `Derived
(p.` lines (10 in `seven`, 12 in `one-two-punch`), each quoted verbatim with slice path, line number, and
a one-sentence reason grounded in that slice's actual quoted content — not an aggregate percentage. Three
interpretation rules are stated before any result exists: (a) a large `underivable` share is a real
finding about the ingest contract, never tuned away; (b) a uniform result in either direction proves
consistency, not discrimination (176's 60/60 precedent); (c) zero `not-rule-bearing` verdicts would be
suspicious given the corpus's known art/layout-only lines. Predicted totals: 9 `agrees`, 9
`not-rule-bearing`, 3 `underivable` (~14%), 1 `disagrees` — summing to 22.

The prediction explicitly names and defends two places where careful re-reading of the quoted material
contradicts `177-RESEARCH.md`'s own hedge about underivability (the `seven` "112 cards" deck-math line
and the `one-two-punch` "both rest cards" line), and explicitly defends landing under the plan's 20%
"looks unsampled" warning threshold rather than hedging upward.

**Task 2 — `177-PROOF.md` §1 (commit `d8b88198`).** Real preflight on both originals (pinned commits
confirmed, `one-two-punch`'s pre-existing `.boardsmith/` deletions named as the documented Phase 173
exception), whole-tree sha256 baselines captured before any copy (3919 / 4134 files, matching
`173-PROOF.md`/`176-PROOF.md`'s own counts exactly), real `cp -R` copies, real `npx boardsmith claude
--local --force` install into each copy with a direct filesystem check confirming
`bs-shared/verify/derive-recheck.md` and `bs-shared/verify/derive-compare.md` both exist at the
installed path, the dispatch mechanism stated in advance (`claude -p` OS subprocess — this session
exposes no native Task/Agent tool, per `173-PROOF.md` §6's precedent), and real `boardsmith
verify-derive-recheck --project <copy> --json` output pasted for both games. Both originals re-verified
byte-identical (empty `diff`) at the end of the task. No dispatch, prompt, or verdict distribution
appears anywhere in §1 — every returned finding carries `"verdict": "pending"`.

## Real finding surfaced by the enumeration (reconciled, not silently absorbed)

`177-RESEARCH.md` measured `PRESENTATION_EXCLUSION_MARKERS`'s regex as requiring the colon immediately
after `description`/`art`, missing all 4 of `one-two-punch`'s parenthetical-qualified diagram lines. That
gap was already fixed by this phase's own earlier plans (`177-02`/`177-04`, decision 13 — the current
constant carries an optional `(?: \([^)]+\))?` group). The real enumeration reflects the fixed constant:
`one-two-punch` mechanically excludes 6 of its 12 `Derived` lines before dispatch (not 2, as the pre-fix
research measurement implied), leaving 16 of the 22 lines total as real dispatch candidates once
re-derivation runs (10 `seven` + 6 `one-two-punch`), not 20. This is recorded explicitly in
`177-PROOF.md`'s Reconciliation subsection — the already-committed `177-PREDICTION.md` was **not**
edited to reflect it; the 4 newly-excluded lines' now-moot `agrees` predictions are noted as moot without
changing the prediction's committed 22-line total or its `underivable` share (none of the 4 were
predicted `underivable`).

## Deviations from Plan

None — plan executed exactly as written. Both tasks matched their acceptance criteria: the prediction
was committed alone, before any dispatch or CLI enumeration; the proof-staging task ran real commands
against copies only, asserted install by direct filesystem check, stated the dispatch mechanism in
advance, and reconciled the real enumerated counts against the 10/12/22 claim rather than adjusting it
silently.

## Verification

- `git log --oneline -1 -- .planning/phases/177-derived-line-re-derivation/177-PREDICTION.md` →
  `913bfe7d docs(177-06): commit pre-dispatch distribution prediction for CHECK-04` (predates
  `d8b88198`, the proof-staging commit, and predates any dispatch artifact — none exists in this repo
  for this phase yet).
- `npm test` → 241 test files, 3954 tests, all passed.
- Both `~/BoardSmithGames/{seven,one-two-punch}` whole-tree sha256 manifests diffed empty before/after
  the entire Task 2 proof run.

## Self-Check

```
FOUND: .planning/phases/177-derived-line-re-derivation/177-PREDICTION.md
FOUND: .planning/phases/177-derived-line-re-derivation/177-PROOF.md
FOUND commit: 913bfe7d
FOUND commit: d8b88198
```

## Self-Check: PASSED
