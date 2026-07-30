---
phase: 174-verify-classifier
plan: 06
subsystem: verify-pipeline-live-proof
tags: [verify-pipeline, classification, live-proof, determinism, lexicon-regression, real-data]

requires:
  - phase: 174-verify-classifier (174-01)
    provides: "174-FIXTURES/ real pass-1-vs-pass-2 fixtures + MANIFEST.md sha256 table"
  - phase: 174-verify-classifier (174-03/174-04)
    provides: "verify-classify.ts pure core + verify-classify-pairs/-record/-status CLI commands"
  - phase: 174-verify-classifier (174-05)
    provides: "classification-subagent.md contract, classification-dispatch.md delegate, 7 hand-built lexicon regression pairs"

provides:
  - "174-PROOF.md sections 2/3/4 — the SC-2 bar declared in its own commit before any verdict, a real BS-CLASSIFY-V1 dispatch pass against both reference games (SC-1/SC-2 measured PASS at 90.9% pooled line-level cosmetic, zero contradictory), VERIFY-07's transcript observable grepped across three artifacts per dispatch, a determinism double-run (identical (pairId, ruleDelta, stale) triples across two fully independent dispatches, both games), and 7/7 lexicon regression pairs matching EXPECTED.md"

affects:
  - "174-07 — owns SC-3 (real source mutation), VERIFY-01's per-chunk-verdict close, and the phase-wide REQUIREMENTS.md/ROADMAP.md closeout this plan deliberately does not perform"
  - "Phase 175 — the real per-pair records (provenance, ruleDelta, stale, quotedPass1/quotedPass2) this plan produced are live data for the human-adjudication/impact-map work"

tech-stack:
  added: []
  patterns:
    - "Bar-before-measurement as a git-history proof: the SC-2 bar text is committed in isolation before any reconstitution or dispatch happens, so 'git log -- 174-PROOF.md' is itself the evidence against retrofitting"
    - "Two-path reconstitution declared explicitly (fresh-adopt + restore-from-archive vs reuse-in-place), with all 23 restored bytes re-verified against MANIFEST.md rather than trusted"
    - "External diff of (pairId, ruleDelta, stale) triples via a standalone script, never trusting either run's own JSON framing, for the determinism check"

key-files:
  created: []
  modified:
    - .planning/phases/174-verify-classifier/174-PROOF.md

decisions:
  - "Path B (full rebuild) was taken for both games' scratch reconstitution — the 174-01 harness directory no longer existed on disk (scratch cleanup between plans), so both copies were rebuilt via cp -R + real skill install + real ingest-archive + restoring the archived staged tree/RUN.md from 174-FIXTURES/, with all 23 resulting file hashes independently re-verified against MANIFEST.md (23/23 match) before any classification ran."
  - "Applied decision 14b's amendment as the actual measurement basis: the SC-2 bar is scored over pooled rule-bearing LINE-LEVEL findings (11 total across both games' real lineFindings[] returns, 10 cosmetic/1 sharper/0 contradictory = 90.9%), not pair-group counts, with group-level verdicts (seven=sharper, one-two-punch=cosmetic) reported alongside per decision 18 but not used as the bar."
  - "Extended VERIFY-07's exception beyond quotedPass1/quotedPass2 to cover the -verify-classify-record CLI arguments that forward those same fields verbatim during recording (classification-dispatch.md's explicit 'record from returned fields, do not open a slice' instruction) — one match found in the orchestrator's own transcript, located precisely inside a --quoted-pass2 argument, reported rather than treated as a silent pass."
  - "Reported an honest finding beyond the plan's stated exception: 2 of one-two-punch's raw-return matches for 'Derived (p.'/'Visual (p.' fall inside the free-prose evidence field (describing schema prefixes generically, not quoting rule content), not inside quotedPass1/quotedPass2 — 'evidence never contains a slice-body-shaped line' is not literally true of this real dispatch, only 'evidence never contains a quoted rule line' is."
  - "Did NOT run requirements.mark-complete for VERIFY-03/VERIFY-07 despite this plan closing their classification-half evidence — 174-07-PLAN.md owns SC-3 (real source mutation) and the official REQUIREMENTS.md/ROADMAP.md closeout, matching this project's standing discipline against premature completion marks (174-04/174-05-SUMMARY.md precedent)."

metrics:
  duration: "~1 session"
  completed: "2026-07-30"
---

# Phase 174 Plan 06: Live Proof — SC-1/SC-2 Real Classification, VERIFY-07 Grep, Determinism, Lexicon Regression Summary

Ran the phase's actual live proof: declared the SC-2 bar in its own commit before any verdict
existed, reconstituted the real pass-1-vs-pass-2 material from the 174-FIXTURES archive (all 23
bytes re-verified against MANIFEST.md), dispatched real `BS-CLASSIFY-V1` classification subagents
against both reference games' single real pair (`seven` → `sharper`, `one-two-punch` →
`cosmetic`), measured SC-1/SC-2 against the decision-14b-amended line-level bar (**PASS at
90.9%**, zero `contradictory`), grepped VERIFY-07's transcript observable across three artifacts
per dispatch (clean except the documented `quotedPass1`/`quotedPass2` exception, extended once to
the recording step and once found genuinely outside that exception in a free-prose `evidence`
field), ran a determinism double-run with fresh independent dispatches (identical
`(pairId, ruleDelta, stale)` triples, both games — with an honest caveat that finer-grained
`lineFindings[]` are not byte-identical between runs), and exercised all 7 hand-built lexicon
regression pairs (7/7 match `EXPECTED.md`, including the schema-asymmetry trap).

## What was built

**Task 1 — Bar declaration, reconstitution, real classification pass.** The SC-2 bar (`≥90%
cosmetic, zero contradictory, missing it is a phase BLOCKER`) was written into `174-PROOF.md`
verbatim and committed (`fc030f17`) with the decision-14b amendment stating the bar's denominator
is pooled rule-bearing LINE-LEVEL comparisons, not pair-group counts — strictly BEFORE any
reconstitution or dispatch. The real material was rebuilt in `$SCRATCH` (path B — the 174-01
harness no longer existed on disk): `cp -R` both originals, a real `npx boardsmith claude --local
--force` install (asserting `classification-dispatch.md`/`classification-subagent.md` present by
filesystem read on both copies — SC-1's install half), a real `boardsmith ingest-archive` adoption
producing byte-identical hashes to `174-FIXTURES/MANIFEST.md`, and the archived staged
tree/`RUN.md` restored from `174-FIXTURES/<game>/` — all 23 resulting file hashes independently
re-verified against the manifest (23/23 match). Both games pair into exactly one real group
(`pages-1-2`), reproducing decision 4's second amendment. One real `claude -p` subprocess dispatch
per game, `BS-CLASSIFY-V1` pointer block copied byte-identical, raw prompts and raw returns
captured verbatim before any recording. `seven`'s subagent returned `sharper` (the bonus-point-card
scoring value: undefined in pass 1, `+1` in pass 2 — compatible, not contradicted).
`one-two-punch`'s subagent returned `cosmetic` (all rule-bearing content agrees after dual-schema
exclusion; one inert credit-spelling discrepancy). Both recorded via `verify-classify-record` from
the subagent's own returned fields; final `verify-classify-status --json` reports
`pendingPairs: []` for both games.

**Task 2 — SC-1/SC-2 measurement + VERIFY-07 grep.** SC-1: a per-pair table with both `provenance`
(`unknown` for both — genuinely pre-provenance, per decision 2b) and `ruleDelta` populated, plus
the provenance × ruleDelta cross-tab showing `unknown`+`cosmetic` is NOT stale and `unknown`+
`sharper` IS stale on real data, corroborating that provenance never feeds `deriveStale()`. SC-2:
group-level verdicts reported (1 `sharper`, 1 `cosmetic` — exactly decision 14b's own
"one group flipping moves the number 50 points" illustration), then the actual bar measurement
pooled across both games' real `lineFindings[]`: 11 rule-bearing line-level findings (10
`cosmetic`, 1 `sharper`, 0 `contradictory`, 1 presentation-excluded entry correctly dropped from
both numerator and denominator per decision 17) → **90.9% cosmetic, PASS** against the ≥90% bar,
by a narrow but real margin. VERIFY-07: grepped three artifacts per dispatch (dispatch prompts:
zero matches, both games; raw subagent returns: matches present but accounted for — `seven` 100%
inside `quotedPass1`/`quotedPass2` fields, `one-two-punch` mostly inside quote fields with 2
genuine exceptions inside free-prose `evidence` describing schema prefixes generically; orchestrator
transcript: 1 match, located inside a `--quoted-pass2` recording argument forwarding the subagent's
own returned field, zero matches anywhere else).

**Task 3 — Determinism double-run + lexicon regression + originals re-verification.** A second,
fully independent `verify-run-init`/dispatch/`verify-classify-record` cycle was run per game over
the identical reconstituted staged bytes, with a fresh `claude -p` subprocess (no shared context
with the first dispatch). An external Python script extracted `(pairId, ruleDelta, stale)` triples
from each run's own `--json` output and diff'd them independently: **identical, both games**
(`seven`: `sharper`/`stale=true` both times; `one-two-punch`: `cosmetic`/`stale=false` both times),
with `pairId` (`pages-1-2`) also identical across runs. Reported honestly that the underlying
`lineFindings[]` granularity is NOT identical between runs (6 vs 9 findings for `seven`, 6 vs 4 for
`one-two-punch`) even though every finding in both runs stayed on the same severity side, so the
MAX-severity rollup that produces the coarse triple was never actually at risk. All 7 hand-built
lexicon regression pairs were dispatched fresh against `src/cli/slash-command/bs/verify/
classification-subagent.md` (the canonical contract source) — **7/7 returned labels matching
`EXPECTED.md`**, including the schema-asymmetry trap pair (`cosmetic`, correctly reasoning through
both schemas' exclusion to the byte-identical rule-bearing remainder). Both `~/BoardSmithGames`
originals reconfirmed byte-identical (whole-tree sha256 diff empty) before and after this plan's
entire run.

## Task Commits

1. **Task 0 (bar declaration, precedes measurement)** — `fc030f17` (docs)
2. **Task 1: real classification pass** — `12da110f` (docs)
3. **Task 2: SC-1/SC-2 measurement + VERIFY-07 grep** — `ab70f535` (docs)
4. **Task 3: determinism + lexicon regression + originals re-verification** — `1811b1a1` (docs)

**Plan metadata:** (this commit, pending)

`git log --oneline -- .planning/phases/174-verify-classifier/174-PROOF.md` shows the bar-declaration
commit (`fc030f17`) strictly precedes the measurement commit (`ab70f535`), confirmed directly rather
than asserted.

## Files Created/Modified

- `.planning/phases/174-verify-classifier/174-PROOF.md` — sections 2 (SC-1/SC-2 real classification
  pass), 3 (VERIFY-07 transcript grep), 4 (determinism + lexicon regression)

## Decisions Made

See frontmatter `decisions`. Headline ones: path B reconstitution (full rebuild, all 23 hashes
re-verified), the decision-14b line-level bar as the actual measurement basis (PASS at 90.9%), and
two honest exception-scope findings in the VERIFY-07 grep (the recording-step forwarding case, and
the free-prose `evidence` schema-prefix mentions) reported rather than silently absorbed into the
stated `quotedPass1`/`quotedPass2` exception.

## The bar: PASS

**≥90% cosmetic, zero contradictory — measured 90.9% cosmetic (10/11 pooled rule-bearing
line-level findings), 0 contradictory. PASS**, by a real but narrow margin on a genuinely small
real-data sample (two 2-page rulebooks, 11 total line-level comparisons). No exclusion-filter
diagnosis was required (decision 17's diagnostic step is a FAIL-path requirement, and the bar did
not fail).

## Deviations from Plan

None that change behavior. The plan's own text anticipated the amendment (decision 14b) and this
plan applied it as instructed; no auto-fixes, no blockers, no architectural changes were needed.
The two "honest caveat" findings above (line-level granularity not identical across determinism
runs; 2 `evidence`-field matches outside the stated `quotedPass1`/`quotedPass2` exception) are
reporting discipline, not deviations from the plan's own instructions — they are exactly what the
plan's "report... never smoothed over" language asks for.

## Issues Encountered

None beyond the above — no blockers, no auth gates, no package installs. No processes were left
running: 11 real `claude -p` dispatches total (2 for the initial classification pass, 2 for the
determinism re-run, 7 for the lexicon regression pairs), each run to completion with `timeout` and
exit 0; `ps aux` confirmed no stray `claude -p` process remained before returning, and the
`$SCRATCH` directory was removed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- SC-1, SC-2, VERIFY-07's classification half, and decision 16's determinism check all now have
  real, measured evidence on real data, recorded in `174-PROOF.md` sections 2-4.
- **Deliberately NOT done here:** `requirements.mark-complete` for VERIFY-03/VERIFY-07.
  `174-07-PLAN.md` owns SC-3 (a real source mutation proving the pipeline catches a genuine rules
  change), VERIFY-01's per-chunk-verdict close, and the official `REQUIREMENTS.md`/`ROADMAP.md`
  closeout — this plan's evidence is an input to that closeout, not the closeout itself, matching
  this project's standing discipline against premature completion marks.
- The real per-pair classification records this plan produced (provenance, ruleDelta, stale,
  quotedPass1/quotedPass2, lineFindings) are live data Phase 175's human-adjudication/impact-map
  work can reference as a worked real example, alongside the 7 lexicon regression pairs.

## Self-Check: PASSED

- FOUND: `.planning/phases/174-verify-classifier/174-PROOF.md` (sections 2, 3, 4 all present)
- FOUND commit `fc030f17` (docs(174-06): declare SC-2 bar before measuring)
- FOUND commit `12da110f` (docs(174-06): real classification pass)
- FOUND commit `ab70f535` (docs(174-06): measure SC-1/SC-2, grep VERIFY-07)
- FOUND commit `1811b1a1` (docs(174-06): determinism + lexicon regression)
- `git log --oneline -- .planning/phases/174-verify-classifier/174-PROOF.md` confirms bar-declaration
  commit precedes measurement commit
- Both `~/BoardSmithGames` originals confirmed byte-identical before/after (whole-tree sha256 diff
  empty, both games)
- No stray `claude -p` processes; `$SCRATCH` removed
