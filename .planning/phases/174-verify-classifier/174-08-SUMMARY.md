---
phase: 174-verify-classifier
plan: 08
subsystem: verify-pipeline
tags: [verify-pipeline, classification, chunk-staleness, gap-closure, real-data]

requires:
  - phase: 174-verify-classifier (174-04)
    provides: "computeChunkVerdicts, decision 18's slice-level narrowing + the 174-04 corrective (unattributable-quote / unreadable-live-slice broaden-and-report)"
  - phase: 174-verify-classifier (174-07)
    provides: "174-FIXTURES/ real pass-1-vs-pass-2 material, the real quotedPass1/quotedPass2 values §2/§5 recorded, the §6 phase-goal measurement this plan re-runs"
  - phase: 172-source-free-conformance-checks
    provides: "The deterministic resolution-ladder pattern (decision 3, and its AMENDMENT — the cautionary case for measuring before trusting a narrowing) reused for decision 19's ladder"

provides:
  - "src/cli/commands/verify-classify.ts — CITATION_ANCHOR_RUNGS, CHUNK_ATTRIBUTION_WARNING_KINDS, MIN_FRAGMENT_CHARS, parseClaimCitationAnchors, matchedLiveLine, citedPageForLine, resolveCitationAttribution, ChunkVerdict.attributions[]"
  - "174-PROOF.md §7 — citation-resolution rate measured on real chunks before the narrowing was trusted"
  - "174-PROOF.md §8 — phase-goal re-measurement on both real reference games, explicit NOT-MET verdict with a measured diagnosis"

affects:
  - "Phase 175/176 — inherit the still-open finding that chunk-level staleness, while roughly halved by decision 19, still fails the phase goal's own bar on both real reference games; VERIFY-06's repair-scoping and Phase 175's impact map should read 174-PROOF.md §8 before assuming per-citation attribution alone keeps repair effort small"

tech-stack:
  added: []
  patterns:
    - "Pair-level blindness checks (unreadable slice / unattributable quote, 174-04) run strictly BEFORE a finer per-citation ladder, never inside it — a citation-level 'not attributed' answer computed from a blind pair would be a fabricated exemption"
    - "Measure a resolution ladder's real hit-rate on real data BEFORE trusting it for a downstream bar (172 decision 3's amendment is the cautionary case for skipping this)"
    - "Replay a recorded real classification verdict (label + verbatim quotes) through new attribution code rather than re-dispatching a fresh LLM judgment, when only the mechanical consumer changed"

key-files:
  created: []
  modified:
    - src/cli/commands/verify-classify.ts
    - src/cli/commands/verify-classify.test.ts
    - .planning/phases/174-verify-classifier/174-PROOF.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

decisions:
  - "Implemented 174-CONTEXT.md decision 19's 3-rung ladder (quoted-fragment > cited-page > slice-fallback) as pure functions with no per-claim slice binding retained in ClaimCitationAnchors (the interface's slices/pages/fragments are chunk-wide unions, per the plan's own instruction not to bind a fragment to a slice at parse time) — binding happens at attribution time by testing whether a fragment occurs verbatim in the specific liveSliceText being evaluated."
  - "The pair-level blindness checks (174-04's unattributable-quote / unreadable-live-slice) are ordered strictly BEFORE decision 19's ladder in computeChunkVerdicts and the ladder never runs inside those branches — pinned by decision-19-guard-2, which proves this holds even when claim-level anchors are present and would otherwise resolve to 'not attributed'."
  - "Task 3's real re-measurement REPLAYS the exact recorded --label/--quoted-pass1/--quoted-pass2 values from 174's real classification dispatches (§2's seven-sharper, §5's one-two-punch-contradictory) through fresh, unmutated cp -R copies reconstituted from 174-FIXTURES — no new claude -p dispatch. Disclosed explicitly: one-two-punch's copy here is un-mutated (matching 174-FIXTURES) whereas §6's copy had a real archived-source mutation; per decision 3/SC-4 this changes only the reported provenance value, never the attribution the recorded quotedPass1 drives."
  - "Reported the phase-goal re-measurement as NOT MET on both games, individually and overall, despite both stale fractions roughly halving (seven 87.5%→37.5%, one-two-punch 100%→54.5%) — per decision 19's own standard (a small, explainable subset, not a small number) and this plan's explicit instruction not to tune anything in response to a NOT-MET finding."

requirements-completed: [VERIFY-03]

metrics:
  duration: "~1 session"
  completed: "2026-07-31"
---

# Phase 174 Plan 08: Decision 19 Per-Citation Attribution + Phase-Goal Re-Measurement Summary

Implemented 174-CONTEXT.md decision 19's per-citation attribution ladder, measured its real
citation-resolution rate on both reference games BEFORE trusting it, wired it into
`computeChunkVerdicts` with both 174-04 guardrails preserved and pinned, and re-measured the phase
goal on both real reference games by replaying the exact real classification dispatch returns. The
result: both games' stale fractions roughly HALVED on real data (`seven` 87.5%→37.5%,
`one-two-punch` 100%→54.5%) — a real, non-tuned, verifiable improvement — but the phase goal's own
bar is still **NOT MET** on either game, reported plainly with a measured diagnosis rather than
smoothed over. VERIFY-03 remains closed; SC-1..SC-5 were not re-litigated.

## What was built

**Task 1 — claim-level citation anchors + the deterministic rung ladder, measured before trusted.**
Added four pure functions to `src/cli/commands/verify-classify.ts`, reusing `extractSection`
(`build-manifest.ts`) and `resolveCitedSlices` (`chunk-provenance.ts`) rather than inventing a second
citation convention: `parseClaimCitationAnchors` (claim-level slices/pages/quoted fragments from a
chunk's own `## Interpretation` body, HTML comments stripped, fragments below `MIN_FRAGMENT_CHARS`
(12) rejected), `matchedLiveLine`/`citedPageForLine` (whitespace-normalized quote-to-line and
line-to-page resolution), and `resolveCitationAttribution` (the 3-rung ladder:
`quoted-fragment` > `cited-page` > `slice-fallback`, modelled on 172 decision 3's ladder — the
fallback rung is NEVER `false`, exactly as conservative as decision 18's shipped answer). Two frozen
enums, `CITATION_ANCHOR_RUNGS` and `CHUNK_ATTRIBUTION_WARNING_KINDS`, pin the vocabulary. Before
trusting the ladder, ran a read-only measurement script (`npx tsx`) against both real reference
games' real chunks and rulebooks, recorded verbatim in `174-PROOF.md` §7: `quoted-fragment` is the
dominant real rung on both games (10/14 `seven`, 10/11 `one-two-punch` evaluations), with a real,
disclosed `slice-fallback` share (21.4% seven, 9.1% one-two-punch) reported as a limitation, not
tuned away. Both game trees confirmed byte-identical before/after.

**Task 2 — wired the ladder into `computeChunkVerdicts`, both guardrails preserved.** `ChunkVerdict`
gained `attributions: Array<{pairId, liveSlice, rung, attributed, reason}>` — one entry per
(pairId, cited live slice) the ladder actually evaluated, so every clean chunk's cleanliness is
nameable from `--json` alone. Critically, the 174-04 pair-level blindness checks (an unreadable live
slice, or a quote matching NO live slice in the pair at all) were kept running strictly BEFORE the
ladder and the ladder never runs inside those branches — a citation-level "not attributed" answer
computed from a blind pair would be a fabricated exemption re-opening exactly the false-clean 174-04
closed. `decision-19-guard-2` proves this ordering holds even when claim-level anchors are present
and would otherwise say "not attributed." A new `[unresolved-citation]` warning fires whenever the
ladder falls to `slice-fallback`. All seven pre-existing `chunk-*`/`decision-18*` tests pass
UNMODIFIED (verified via `git diff` on the test file showing no edits inside those test bodies) —
`writeChunkCiting`'s chunks carry no `## Interpretation` section, so they correctly land on the
fallback rung, proving the fallback reproduces today's behavior exactly.

**Task 3 — real phase-goal re-measurement.** Reconstituted fresh `cp -R` copies of both reference
games (never the originals), real skill install, real `ingest-archive` (hashes confirmed identical
to `174-FIXTURES/MANIFEST.md`'s recorded values), restored `174-FIXTURES/<game>/staged/*.md` +
`RUN.md` (all 13 restored file hashes re-verified against the manifest), real
`verify-classify-pairs`, then real `verify-classify-record` REPLAYING the exact `--label`/
`--quoted-pass1`/`--quoted-pass2` values §2's real seven-`sharper` dispatch and §5's real
one-two-punch-`contradictory` dispatch already returned — no new `claude -p` dispatch. Ran
`verify-classify-status --project . --run-id <runId> --json` twice per game (byte-identical,
confirming determinism) with a whole-tree sha256 diff excluding `rulebook/.verify/` before/after
(identical, confirming no build ran). Result, recorded in `174-PROOF.md` §8 with every clean chunk
named and its real `attributions[].reason` quoted, and every stale chunk named with its attributing
rung: `seven` 6/16 (37.5%) stale (down from 14/16, 87.5%); `one-two-punch` 6/11 (54.5%) stale (down
from 11/11, 100%). Both real, non-tuned, roughly-halved improvements. **Verdict: NOT MET on both
games and overall** — neither fraction is a small, explainable subset under decision 19's own
standard, even though decision 19's mechanism is proven to work exactly as designed. Diagnosis: an
anchor-density property of these two short, tightly cross-referenced reference rulebooks (several
chunks independently quote the exact same central, changed rule because it is genuinely foundational
to what they build), not a defect in the ladder. Both `~/BoardSmithGames` originals confirmed
byte-identical before/after this plan's whole session. `ROADMAP.md`/`STATE.md` updated with the
identical measured numbers; the phase remains `[ ]` (not marked complete) in `ROADMAP.md` since the
goal is not met, while `174-08-PLAN.md` itself is checked off as executed.

## Task Commits

1. **Task 1+2 (combined): decision 19 ladder implemented and wired into `computeChunkVerdicts`** —
   `1aa84328` (feat)
2. **Task 1 (§7 documentation): citation-resolution rate measured on real chunks** — `3a2208d2`
   (docs)

**Plan metadata:** (this commit, pending — Task 3's `174-PROOF.md` §8, `ROADMAP.md`, `STATE.md`,
and this `SUMMARY.md`)

### Deviation from strict per-task atomicity (disclosed, Rule-adjacent)

Tasks 1 and 2's code (the pure ladder functions and their wiring into `computeChunkVerdicts`) were
implemented in a single continuous edit pass and committed together as one `feat` commit
(`1aa84328`), rather than as two separate commits. The two tasks are tightly coupled — Task 2's
wiring directly consumes every function Task 1 defines, and splitting the diff into two commits
after the fact (via manual hunk selection) risked introducing an inconsistent intermediate state
with no independent value. Task 1's own required artifact (`174-PROOF.md` §7, the pre-trust
measurement) was still produced and committed separately (`3a2208d2`), preserving the substance of
the "measure before wiring" discipline the plan requires, even though the commit boundary itself
does not perfectly mirror the task boundary. All acceptance criteria for both tasks are independently
verifiable in the final state (69/69 tests, guard tests for both 174-04 conditions, the frozen
enums, the `[unresolved-citation]` warning, etc.).

## Files Created/Modified

- `src/cli/commands/verify-classify.ts` — `CITATION_ANCHOR_RUNGS`, `CHUNK_ATTRIBUTION_WARNING_KINDS`,
  `MIN_FRAGMENT_CHARS`, `parseClaimCitationAnchors`, `matchedLiveLine`, `citedPageForLine`,
  `resolveCitationAttribution`, `ChunkVerdict.attributions[]`, `computeChunkVerdicts` rewired
- `src/cli/commands/verify-classify.test.ts` — 15 new `decision-19-*` tests (anchors, rung ladder,
  line/page resolution, frozen enums, narrowing, both guardrails, `attributions[]` shape); all 54
  pre-existing tests, including the 7 named chunk/decision-18 tests, pass unmodified
- `.planning/phases/174-verify-classifier/174-PROOF.md` — `## 7.` (citation-resolution rate,
  measured before trusting the narrowing) and `## 8.` (phase-goal re-measurement, explicit NOT-MET
  verdict with diagnosis)
- `.planning/ROADMAP.md` — Phase 174's reopened note updated with the measured post-decision-19
  numbers; `174-08-PLAN.md` checked `[x]`; Result paragraph replaced with the gap-closure outcome;
  phase remains unmarked-complete (goal still not met)
- `.planning/STATE.md` — Current Position updated with the measured numbers and NOT-MET verdict

## Decisions Made

See frontmatter `decisions`. The headline ones: (1) the ladder's `ClaimCitationAnchors` stays
chunk-wide (no per-claim slice binding retained), matching the plan's own instruction that binding
happens at attribution time by text-matching against the specific slice being evaluated; (2) the
pair-level blindness checks are ordered strictly before the ladder and the ladder never runs inside
them, closing off the exact fabricated-exemption risk this plan's own "what matters most" section
warned about; (3) Task 3 replays recorded real dispatch returns rather than re-dispatching a fresh
LLM judgment, since only the mechanical consumer (`computeChunkVerdicts`) changed between §6 and this
re-measurement; (4) the NOT-MET verdict is reported plainly with a measured diagnosis, per decision
19's explicit standard that a small stale set — not a small number — is the bar, and no threshold was
tuned to move either percentage.

## Deviations from Plan

**1. [Disclosed, not a Rule 1-4 fix] Tasks 1 and 2 committed together** — see "Deviation from strict
per-task atomicity" above. No correctness impact; both tasks' acceptance criteria are independently
verifiable in the final committed state.

No other deviations. No auto-fixes to code beyond the plan's own specification. No blockers, no
auth gates, no package installs (only pre-existing `npx tsx`/`vitest`/`boardsmith` CLI commands were
used).

## Known Stubs

None. No hardcoded empty values, placeholder text, or unwired data sources were introduced.

## Threat Flags

None beyond the plan's own pre-declared threat register (`174-08-PLAN.md`'s `<threat_model>`), which
this implementation follows exactly: `parseClaimCitationAnchors`'s regex scans are linear over one
already-extracted section body (no ReDoS surface), `resolveCitedSlices`'s existing path-traversal
guard is reused unchanged, and no new package was installed.

## Issues Encountered

None. The measurement script (Task 1, §7) and the real reconstitution (Task 3, §8) both ran cleanly
on the first attempt against the real reference games, with every hash check (restored fixture
files, before/after tree diffs, both originals) passing on the first try.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `174-VERIFICATION.md`'s single recorded gap (the phase goal itself) has been substantively
  addressed with a real, measured, non-tuned improvement (both games' stale fractions roughly
  halved) and an honest re-measurement — but the gap is **not closed**: the phase goal's own bar is
  still NOT MET on both real reference games. Whoever re-verifies this phase should read
  `174-PROOF.md` §7/§8 directly rather than assume the gap-closure plan fully discharges the gap.
- Phase 175/176 (VERIFY-04/05/06 — human adjudication, staleness markers, repair scoping) should
  read `174-PROOF.md` §8's diagnosis before assuming per-citation attribution alone keeps repair
  effort scoped small on games this short and this cross-referenced: roughly half of citing chunks
  still go stale from one real finding on both reference games.
- A larger, multi-group reference game (carried forward from §6/§7/§8 as still-needed) would be
  required to establish whether a still-finer attribution key could narrow further, or whether these
  two short rulebooks have exhausted what citation-level narrowing alone can buy.
- `REQUIREMENTS.md`'s VERIFY-01/03/07 closures are unchanged and not re-litigated by this plan, per
  `174-VERIFICATION.md`'s own explicit instruction.

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-classify.ts` (`CITATION_ANCHOR_RUNGS`,
  `CHUNK_ATTRIBUTION_WARNING_KINDS`, `MIN_FRAGMENT_CHARS`, `parseClaimCitationAnchors`,
  `matchedLiveLine`, `citedPageForLine`, `resolveCitationAttribution`, `ChunkVerdict.attributions`)
- FOUND: `src/cli/commands/verify-classify.test.ts` (69 tests total; 15 new `decision-19-*`)
- FOUND: `.planning/phases/174-verify-classifier/174-PROOF.md` (`## 7.` and `## 8.` sections present)
- FOUND commit `1aa84328` (feat(174-08): decision 19 ladder + wiring)
- FOUND commit `3a2208d2` (docs(174-08): §7 measurement)
- `npx vitest run src/cli/commands/verify-classify.test.ts` — 69/69 passed
- `npm test` (full suite via `npx vitest run`) — 3706/3706 passed (3691 baseline + 15 new)
- `npx tsc --noEmit -p .` — clean (only the pre-existing unrelated `docs/seed-to-state.test.ts`
  rootDir diagnostic)
- `npx eslint src/cli/commands/verify-classify.ts` — clean
- Both `~/BoardSmithGames` originals confirmed byte-identical before/after (whole-tree sha256 diff
  empty for both games across the §7 measurement AND the §8 re-measurement); `seven` still pinned at
  `a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain clean
- No stray processes: only synchronous `node`/`boardsmith`/`git`/`find`/`shasum` commands were run;
  nothing was left running in the background
