---
phase: 177-derived-line-re-derivation
plan: 20
subsystem: cli-verify
tags: [check04-replacement, consolidated-measurement, real-dispatch, determinism, defect-found, honesty-discipline]

# Dependency graph
requires:
  - plan: 177-15
    provides: verify-enumerate.ts's mechanical core, first live-measured.
  - plan: 177-17
    provides: composeArithmeticChain, absence classification (ac5f64c5 operand-unit fix applied
      after this plan, re-measured live here for the first time on current code).
  - plan: 177-18
    provides: the third reference game (doom-machine) and the discovery that named the two gaps
      177-19 and the standalone d1c7199a fix closed.
  - plan: 177-19
    provides: per-slice QuoteVerifiedProvenance and multi-source ingest-archive, both exercised
      live here against the real doom-machine repo (cards.pdf now archived).
  - commit: d1c7199a
    provides: ANNOTATION_VOCABULARY_RE, the independence-leak fix this plan found a real,
      unfixed gap in (leading-paren case).
provides:
  - .planning/phases/177-derived-line-re-derivation/177-CONSOLIDATED-PROOF.md — the ONE
    consolidated measurement of current code (HEAD b1a9bc35, all four prior fixes included),
    all three reference games, run twice for determinism, per this run's brief.
  - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/ — the full real-dispatch
    record: PRE-REGISTRATION.md (committed alone before any dispatch), the extraction/dispatch/
    analysis harness scripts, both runs' raw enumerator/reconciler JSON (84 real claude -p
    dispatches), the code-side analysis output, and before/after sha256 hashes for all three
    real game repos.
  - Two new, specific, unfixed code-defect findings for CHECK-04's next attempt: validateGrounding's
    findMatch first-match-wins ambiguity (the cause of this run's one determinism failure), and
    ANNOTATION_VOCABULARY_RE's missing leading-paren tolerance (a latent independence-leak gap).
  - .planning/REQUIREMENTS.md — CHECK-04 amendment 2, left open, citing this run specifically.
affects: [the-orchestrator-disposition-of-CHECK-04, any-future-plan-touching-validateGrounding-or-ANNOTATION_VOCABULARY_RE]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Used the real game project directories (~/BoardSmithGames/seven, /one-two-punch,
      /doom-machine) directly rather than the separate 177-FIXTURES copy, after confirming
      byte-identical slice content — this let the measurement reuse already-recorded, real
      provenance (177-16/177-19) instead of re-establishing it, and meant 'current state' meant
      the actual game repos, not a snapshot."
    - "Declined to work around buildEnumeratorPayload's construction-site throw on CARDS.md this
      time (177-18 manually stripped the offending line to keep measuring) — the throw itself is
      reported as the finding for that file's 5 lines, per this run's pre-registered intent not to
      patch around a real safety mechanism firing."
    - "Discovered a live code defect (validateGrounding's findMatch) by re-deriving arithmetic
      operand resolution the METHODOLOGICALLY CORRECT way (matching the reconciler's own
      citedBothStatements to GroundedBothFact.statement, exactly mirroring classifyDerivedLines'
      real citedFactIds mechanism) rather than a magnitude-search shortcut that would have masked
      the bug by finding a numerically-plausible substitute fact instead of the one actually cited."
    - "A supplementary, clearly-labeled isolated test (stripping only the one line independently
      known to cause the CARDS.md throw) is NOT part of the real measurement's dispatch data, but
      is disclosed as its own finding — confirming a SECOND, currently-latent independence gap in
      ANNOTATION_VOCABULARY_RE that this run's real dispatches never exercised."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-CONSOLIDATED-PROOF.md
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/PRE-REGISTRATION.md
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/manifest.json
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/analysis-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/analysis-run2.json
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/run1/, run2/ (84 real dispatch records)
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/payloads/ (assembled enumerator payloads + Derived-line extracts for all 15 slices with Derived lines, incl. CARDS.md's throw text)
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/{baseline,after}-{seven,one-two-punch,doom-machine}.sha256
    - .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/{extract-corpus,dispatch-enum,dispatch-reconcile,driver,analyze}.mjs (the measurement harness, disclosed alongside its output)
  modified:
    - .planning/REQUIREMENTS.md (CHECK-04 amendment 2 + traceability row)

decisions:
  - "No BoardSmith product code (verify-enumerate.ts or either contract file) was modified in this
    plan, per its own brief (measurement, not remediation) — both newly-found defects
    (validateGrounding's findMatch, ANNOTATION_VOCABULARY_RE's paren gap) are reported for the
    orchestrator/next plan to fix, not patched here even though the exact one-line fixes are
    named in the consolidated proof."
  - "CHECK-04 stays OPEN. Four of five closing criteria passed cleanly on real evidence; the
    determinism criterion failed on 1/28 lines, traced to a real, reproduced, previously-unknown
    code defect — and per this run's own pre-committed rule, any single criterion failing blocks
    closure regardless of every other number."
  - "The pre-registration's specific determinism-risk prediction (CARDS.md re-check) did not
    materialize in the form predicted, because CARDS.md was entirely blocked from dispatch this
    run — disclosed as a miss against the letter of the prediction, while the underlying intent
    (checking determinism as the single most important thing) was honored and the actual flip,
    though in an unpredicted location, is reported with equal weight."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-31
---

# Phase 177 Plan 20: CHECK-04 Consolidated Measurement Summary

Ran the real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`,
`enumerate-facts.md`, `reconcile-facts.md`) against all three reference games in one pass, twice,
on current code (HEAD `b1a9bc35`, including all four fixes the prior measurement chain made across
three different code states). **84 real `claude -p` dispatches** — 14 dispatchable slices x 2
enumerators + 1 reconciler x 2 runs. No BoardSmith product code was written; this plan is
measurement plus two newly-discovered, precisely-diagnosed, disclosed-but-unfixed defects.

## Pre-registration

`177-20-MEASUREMENT/PRE-REGISTRATION.md` committed alone (`f56add71`, `git show --stat` lists
exactly one file) before any dispatch, naming two concrete non-closure conditions: a leaked
`CARDS.md` bare-`Derived:` line resolving `corroborated`, or any line resolving `contradicted`.
Neither occurred — but a THIRD, unpredicted failure occurred instead (see below), and per the
run's honesty discipline this deviation from the letter of the prediction is disclosed rather than
quietly absorbed.

## The measurement

**Corpora**: the real game project directories (`~/BoardSmithGames/seven`, `/one-two-punch`,
`/doom-machine`), used directly rather than a separate fixtures copy — confirmed byte-identical in
slice content to `177-FIXTURES/seven`/`/one-two-punch` (only `INDEX.md` metadata and the `source/`
provenance directory differ), and each already carries provenance correctly recorded by
177-16/177-19. Doing this meant "current state" was the actual game repos, with real, already-valid
provenance, nothing re-transcribed.

33 real `Derived` lines across 15 slices. `buildEnumeratorPayload`'s construction-site backstop
threw for `CARDS.md` on the first attempt — original line 270's mid-line `Derived (p.3),` citation.
**Unlike 177-18, this run did not manually work around it.** All 5 of `CARDS.md`'s lines received
zero dispatch attempt, reported as their own honest "measurement blocked" category. The other 28
lines across 14 slices dispatched cleanly, 14/14 succeeding in both runs with zero harness errors.

Two enumerators per slice on genuinely different model families (`opus`/`haiku`), one reconciler
per slice (`sonnet`), run twice, unchanged, for determinism.

## Headline findings

**Grounding**: 3 total rejections across 487 "both" claims (2/242 run 1, 1/245 run 2) — every one a
genuine reconciler Rule-2 violation (paraphrase instead of verbatim quote), mechanically caught and
reported. Zero fabrications passed through in either run.

**Contradicted**: zero, in either run, on any line.

**Independence**: confirmed by `grep`, not assertion — zero annotation lines in any of the 28 real
dispatched enumerator payloads across both runs; every payload carried its required token.

**Determinism — the one failure**: 27/28 lines classified identically between runs. `seven`
L21 (`7x4x4=112`) flipped `corroborated-by-composition` → `uncorroborated`. Traced to a genuine,
newly-discovered defect in `validateGrounding`'s `findMatch`: `Array.prototype.find` returns the
FIRST list entry matching a quote, and when multiple facts in one enumerator's list share an
identical `sourceSentence` (here, one sentence legitimately backs three distinct numbers — range,
colors, copies), a quote matching that shared sentence silently attaches the WRONG fact's
`numericValue`. Confirmed not a harness artifact by re-deriving operand resolution the
methodologically correct way (matching cited statement text to `GroundedBothFact.statement`,
mirroring `classifyDerivedLines`'s own mechanism) — the same failure reproduced identically.

**A second, latent defect, found while investigating the CARDS.md block**: `ANNOTATION_VOCABULARY_RE`
(the `d1c7199a` independence fix) tolerates leading whitespace/`>`/`-`/`*` but not `(` — so
`CARDS.md`'s line 140 (`(Derived: effectively a 2-space loop...)`) still leaks past both the strip
filter and its backstop. This did NOT cause an actual leak in this run's real dispatches (the whole
file is blocked by the unrelated line-270 throw, headline above) — a supplementary, clearly-labeled
isolated check (not part of the real dispatch data) confirmed the gap exists on current code.
Disclosed as a real, reproducible, currently-unexercised finding, not fixed here.

## Full classification (28 dispatched lines, both runs)

| Classification | Run 1 | Run 2 |
|---|---|---|
| `corroborated` | 17 | 17 |
| `corroborated-by-composition` | 2 | 1 |
| `uncorroborated` | 7 | 8 |
| `contradicted` | 0 | 0 |
| `quote-unverified` | 0 | 0 |
| `absence-corroborated` | 1 | 1 |
| `absence-unverifiable` | 1 | 1 |

Every `uncorroborated` line is individually attributed to a named category in
`177-CONSOLIDATED-PROOF.md`: cross-slice reference (x3), "up to N" hedge ambiguity (x1, reproducing
177-18), conservative unit-incompatibility arithmetic refusal (x1), the `findMatch` defect (x1, run
2 only), and 2 genuine dual-enumeration misses.

## The goal in its own unit

Of 33 real, rule-bearing `Derived` lines across three reference games: **28 (85%) received a
genuine, independent dual-enumeration attempt on current code** (18/28 or 17/28 positively
corroborated depending on run; 2/28 absence-checked; 7-8/28 honestly uncorroborated, each named).
**5 (15%)** — all of `CARDS.md` — received **no attempt at all**, blocked by a real, disclosed,
uncorrected game-repo transcription defect (a mid-line-buried citation). Named categories: (a)
design limitations (the two code defects above, cross-slice reference invisibility, the "up to N"
ambiguity, conservative unit-incompatibility refusal), (b) corpus/transcription staleness
(`CARDS.md`'s line 270), (c) structurally unanswerable (`otp` L132, an absence claim with no safe
literal target).

## CHECK-04 disposition — NOT closed

All five of this run's closing criteria were checked against actual evidence. **Determinism
failed** (1/28 lines, a real reproduced defect) — per the run's own rule, this alone blocks
closure regardless of the other four criteria passing cleanly. `CHECK-04` remains open in
`.planning/REQUIREMENTS.md`, with amendment 2 citing this run specifically, the measured numbers,
and the two named, unfixed code defects for whoever attempts closure next.

## Deviations from Plan

**1. [Disclosed methodology choice, not a Rule 1-3 auto-fix] Did not work around `CARDS.md`'s
construction-site throw**, unlike 177-18's manual line-strip. This was decided in the
pre-registration before any dispatch (not a post-hoc choice) — the throw itself is reported as the
finding for `CARDS.md`'s 5 lines.

**2. [Rule 1 - bug found in my own harness, fixed before any dispatch] My extraction regex for
locating `Derived` lines initially missed the leading-paren form** (`(Derived:` at `CARDS.md` line
140) because its tolerated leading-decoration character class did not include `(` — the exact same
class of gap later found live in the shipped `ANNOTATION_VOCABULARY_RE`. Fixed in the harness
before extracting the real corpus; the shipped-code gap it revealed is reported, not fixed.
**Files modified:** scratchpad-only harness (`extract-corpus.mjs`), not shipped code.

**3. [Rule 1 - bug found and fixed during analysis] Initial arithmetic-operand resolution in the
analysis harness searched the WHOLE grounded-both set by expected magnitude, which would have
silently masked the `findMatch` defect described above** by finding a numerically-plausible
substitute fact rather than the one the reconciler actually cited. Rewrote to resolve operands via
the reconciler's own `citedBothStatements` (mirroring `classifyDerivedLines`'s real mechanism)
before this defect could be reported — confirmed the same failure reproduced under the corrected
method, ruling out a harness-only artifact. **Files modified:** scratchpad-only harness
(`analyze.mjs`), not shipped code.

No product code in this repository was modified — this plan's product is a measurement and two
disclosed, unfixed findings for the orchestrator to disposition.

## Known Stubs

None — this plan writes no application code.

## Threat Flags

None. No new network endpoint, auth path, or file-access pattern. The two newly-found defects
(`validateGrounding`'s `findMatch`, `ANNOTATION_VOCABULARY_RE`'s paren gap) are pre-existing
behaviors of already-shipped, already-reviewed code, newly exercised and precisely diagnosed here —
not introduced by this plan.

## Self-Check: PASSED

- FOUND: .planning/phases/177-derived-line-re-derivation/177-CONSOLIDATED-PROOF.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/PRE-REGISTRATION.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/manifest.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/analysis-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/analysis-run2.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/run1/, run2/ (84 real dispatch records)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-20-MEASUREMENT/payloads/
- FOUND commit: f56add71 "docs(177-20): commit pre-dispatch expectation for CHECK-04 consolidated measurement, alone"
- CONFIRMED: all three real game repos (`~/BoardSmithGames/{seven,one-two-punch,doom-machine}`)
  byte-identical (sha256, all `.pdf`/`.md` files) before this plan's work began and after all 84
  dispatches completed — `177-20-MEASUREMENT/{baseline,after}-*.sha256`.
- CONFIRMED: zero annotation-vocabulary lines in any of the 28 real assembled enumerator payloads
  (`grep -l -iE "Derived|Visual \(p\.|Named-but-undefined" payloads/*.payload.txt` — no matches).
- CONFIRMED: no `claude -p` process left running; `ps aux | grep "claude -p"` clean.

## Full test run

`npm test`: **4127/4127 passed**, full suite, run from `/Users/jtsmith/BoardSmith`. Unchanged from
the 177-19 baseline — this plan modified no BoardSmith source file.
