---
phase: 177-derived-line-re-derivation
plan: 21
subsystem: cli-verify
tags: [check04-definitive-measurement, consolidated-measurement, real-dispatch, determinism, honesty-discipline]

# Dependency graph
requires:
  - plan: 177-20
    provides: the consolidated-measurement method (real dispatch, pre-registration, per-line
      determinism comparison) this plan repeats, plus two named code-defect findings this plan
      re-verifies as fixed.
  - commit: 564f1a42
    provides: deterministic rank-ordered `findMatch` and a fully-decoration-tolerant
      `ANNOTATION_VOCABULARY_RE` — both fixes 177-20's evidence forced, confirmed live here.
provides:
  - .planning/phases/177-derived-line-re-derivation/177-FINAL-PROOF.md — the definitive
    consolidated measurement of current code (HEAD `564f1a42`), all three reference games, all 32
    real Derived lines (100% of the corpus, for the first time in this chain), run twice.
  - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/ — the full real-dispatch
    record: PRE-REGISTRATION.md (committed alone before any dispatch), the harness scripts (adapted
    from 177-20's), both runs' raw enumerator/reconciler JSON (90 real claude -p dispatches), the
    code-side analysis output, before/after sha256 hashes for all three real game repos.
  - Confirmation that both code defects 177-20 found (`findMatch` first-match-wins,
    `ANNOTATION_VOCABULARY_RE`'s missing `(` tolerance) are genuinely fixed, re-verified on live
    dispatch data — `seven` L21 stable in both runs; `CARDS.md` L140's parenthesized form confirmed
    absent from the real dispatched payload by grep.
  - A new, structural (not code-level) determinism finding: real cross-run enumerator-output
    variance on a large, dense slice (`CARDS.md`, 125-150 facts per enumerator) still flips one
    line's classification, sourced in the enumeration step's own model stochasticity, not in any
    of this module's mechanical checks.
  - A disclosed, fixed measurement-harness bug (not a corpus or code finding): this run's own
    corpus-extraction regex mis-flagged `CARDS.md`'s own annotation-convention legend (line 8,
    using the literal placeholder `p.N`) as a real `Derived` line — corrected the true count to 32.
  - .planning/REQUIREMENTS.md — CHECK-04 amendment 3, left open, citing this run specifically.
affects: [the-orchestrator-disposition-of-CHECK-04, any-future-plan-touching-verify-enumerate.ts-or-attempting-CHECK-04-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reused 177-20's real-dispatch harness (extract-corpus/dispatch-enum/dispatch-reconcile/
      driver/analyze.mjs) with path adaptation only — no reimplementation of judgment logic, per
      this milestone's repeated precedent of running the REAL, unmodified verify-enumerate.ts
      functions rather than a simulation."
    - "Found and fixed a bug in the harness's OWN corpus-extraction regex (mid-line Derived-citation
      detection accepted any character after 'p.' instead of requiring a digit) before running
      analysis — confirmed via grep that the real production buildEnumeratorPayload/quoteLinesOnly
      pipeline never sent the offending line to any real dispatch, so this was purely a measurement
      artifact, not evidence of an independence leak."
    - "Diagnosed this run's one determinism flip down to the enumeration layer specifically (by
      diffing both runs' raw enumerator fact lists for the flipped line, not just the final
      classification) — distinguishing 'a code defect in matching/grounding' from 'the enumerator
      itself decomposed the source differently across runs,' which changes what remediation (if
      any) is even possible."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-FINAL-PROOF.md
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/PRE-REGISTRATION.md
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/manifest.json
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/analysis-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/analysis-run2.json
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/run1/, run2/ (90 real dispatch records)
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/payloads/ (assembled enumerator payloads + Derived-line extracts for all 15 slices)
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/{baseline,after}-{seven,one-two-punch,doom-machine}.sha256
    - .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/{extract-corpus,dispatch-enum,dispatch-reconcile,driver,analyze}.mjs (the measurement harness, disclosed alongside its output)
  modified:
    - .planning/REQUIREMENTS.md (CHECK-04 amendment 3 + traceability row)

decisions:
  - "No BoardSmith product code (verify-enumerate.ts or either contract file) was modified in this
    plan, per its own brief (measurement, not remediation) — the one bug found and fixed
    (extract-corpus.mjs's mid-line Derived-detection regex) lives entirely in this run's own
    scratchpad-only measurement harness, never in shipped code."
  - "CHECK-04 stays OPEN. Both defects 177-20 named are confirmed fixed and re-verified live
    (seven L21 stable, CARDS.md L140 confirmed absent from the real payload) — but determinism
    still failed, on a different line, for a different and more structural reason: real cross-run
    variance in what the enumerator models themselves produced on a large, dense slice, not a bug
    this module's mechanical checks could ever catch. Per this run's own pre-registered rule, this
    still blocks closure."
  - "Did not attempt to fix or work around the enumerator-variance finding (e.g., by tightening the
    enumeration contract's granularity instructions, or by re-running until the flip disappears) —
    per this plan's measurement-not-remediation scope and its honesty discipline against tuning
    after seeing results."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-31
---

# Phase 177 Plan 21: CHECK-04 Definitive Consolidated Measurement Summary

Ran the real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`,
`enumerate-facts.md`, `reconcile-facts.md`) against all three reference games in one pass, twice, on
current code (HEAD `564f1a42`, including the two fixes 177-20's evidence forced plus everything
before it). **90 real `claude -p` dispatches** — 15 dispatchable slices x 2 enumerators + 1
reconciler x 2 runs. No BoardSmith product code was written; this plan is measurement plus
confirmation that two prior defects are fixed, plus one new structural finding.

## Pre-registration

`177-21-MEASUREMENT/PRE-REGISTRATION.md` committed alone (`2aad3d1c`, `git show --stat` lists
exactly one file) before any dispatch, naming three concrete non-closure conditions: any
determinism flip on any of the 32 lines (specifically re-checking `seven` L21, the line 177-20's
`findMatch` defect flipped), any line resolving `contradicted`, or a traceable annotation leak on
`CARDS.md`. The third and second did not occur. **The first did — on a different line than
predicted, `CARDS.md` L143, not `seven` L21** (which is now stable). Per the run's honesty
discipline, this deviation from the letter of the prediction (which line flips) while the
underlying intent (any flip blocks closure) is honored exactly, is disclosed rather than quietly
absorbed — precisely the same disclosure pattern 177-20 followed for its own unpredicted flip
location.

## The measurement

**Corpora**: the real game project directories (`~/BoardSmithGames/seven`, `/one-two-punch`,
`/doom-machine`), sha256-confirmed byte-identical before and after all 90 dispatches. **32 real
`Derived` lines** across 15 slices — corrected from the plan brief's stated 33: `CARDS.md` line 8
is the file's own legend explaining the `Derived (p.N):`/`Visual (p.N):` convention using the
literal placeholder `p.N`, not a real annotation; this run's own extraction harness initially
mis-flagged it (a bug in the harness, not in production code — confirmed by grep that the real
dispatched payload never contained it), fixed before analysis.

**All 32 lines dispatched cleanly in both runs — zero construction-site throws.** This is the first
measurement in this chain to attempt 100% of the real corpus: every prior round left `CARDS.md`
either unmeasured or entirely blocked by a construction-site throw that `564f1a42`'s widened
`ANNOTATION_VOCABULARY_RE` now resolves upstream (the strip filter removes the offending mid-
sentence citation before the backstop ever fires).

## Headline findings

**Both 177-20 defects confirmed fixed, live:** `seven` L21 (the line whose determinism flip 177-20
traced to `findMatch`'s first-match-wins ambiguity) is stable `corroborated-by-composition` in both
runs of this measurement. `CARDS.md` L140's parenthesized `(Derived: ...)` form (the latent
independence gap 177-20 could only test in isolation, since the whole file was blocked from real
dispatch that run) is confirmed absent from the real dispatched payload, by grep, before any
dispatch — the exact case that gap was named for, now genuinely exercised and closed.

**Determinism — still fails, on a different line, for a different reason:** 31/32 lines identical
between runs; `doom-machine/CARDS.md` L143 flipped `corroborated` → `uncorroborated`. Traced to real
cross-run variance in what enumerator B (haiku) produced on `CARDS.md` — the largest, densest slice
in the corpus (125-150 facts per enumerator) — not to any matching or grounding code defect. In run
1, both enumerators stated Impact Nexus's cycle-track shape as a single combinable fact; in run 2,
enumerator B decomposed the same source material into much more atomized per-space facts and never
restated the shape in synthesizable form, so the reconciler genuinely had nothing to cite. Both
runs' mechanical checks (`validateGrounding`, `findMatch`) behaved correctly given their inputs —
the instability is upstream, in the enumeration step's own model stochasticity.

**Grounding**: 14 rejections in run 1 (0 in run 2), all on `CARDS.md`, all genuine `reconcile-facts.md`
Rule-2 violations — the reconciler quoting a short glyph fragment (e.g. `"DEAL 3 DMG"`, 10 normalized
characters) instead of the fact's actual `statement`/`sourceSentence`. Spot-checked one: the
fragment genuinely appears inside enumerator A's real sourceSentence but is not that sourceSentence
itself, and falls below `MIN_MATCH_LENGTH` (12) for containment — `validateGrounding` working
exactly as designed. Zero fabrications passed grounding in either run.

**Contradicted**: zero, in either run, on any line.

**Independence**: confirmed by `grep` before any dispatch — zero annotation lines in any of the 32
real dispatched enumerator payloads across both runs.

## Full classification (32 real Derived lines, both runs)

| Classification | Run 1 | Run 2 |
|---|---|---|
| `corroborated` | 21 | 20 |
| `corroborated-by-composition` | 3 | 3 |
| `uncorroborated` | 6 | 7 |
| `contradicted` | 0 | 0 |
| `absence-corroborated` | 1 | 1 |
| `absence-unverifiable` | 1 | 1 |

Every `uncorroborated` line is individually attributed to a named category in
`177-FINAL-PROOF.md`: cross-slice reference (x3), a harness arithmetic-spec gap (x1, not a
`verify-enumerate.ts` defect — this run's analysis harness simply had no hardcoded composition spec
for that particular proposal), 2 genuine dual-enumeration misses, and (run 2 only) the L143
determinism flip.

## The goal in its own unit

**Of 32 real, rule-bearing `Derived` lines across three reference games (the corrected count),
32 (100%) received a genuine, independent dual-enumeration attempt on current code, in both runs**
— the first time this chain has reached 100% of the real corpus. Of those 32: 24/23 (run 1/run 2)
resolved to a real, code-verified positive signal; 2/2 resolved `absence-*`; 6/7 resolved
`uncorroborated`, each named; 0 resolved `contradicted`.

## CHECK-04 disposition — NOT closed

All five of this run's closing criteria were checked against actual evidence. **Determinism
failed** (1/32 lines, a genuine cross-run enumerator-variance instability, not a code defect) — per
the run's own pre-registered rule, this alone blocks closure regardless of the other four criteria
passing cleanly. `CHECK-04` remains open in `.planning/REQUIREMENTS.md`, with amendment 3 citing
this run specifically. Unlike the two prior amendments, no specific unfixed code defect is named as
the blocker this time — the open question is structural: whether byte-identical determinism, as
this run's own criteria define it, is achievable at all against two independently-sampled,
non-deterministic enumerator models on a large, dense slice, without either an
enumeration-granularity mechanism this run did not test, or a redefinition of the determinism
criterion itself (neither attempted here, per measurement-not-remediation scope).

## Deviations from Plan

**1. [Rule 1 - bug found in my own harness, fixed before any dispatch] The corpus-extraction
regex's mid-line Derived-citation detection (`DERIVED_ANYWHERE_RE`) accepted any character after
`p.` instead of requiring a digit, mis-flagging `CARDS.md` line 8 (the file's own legend, using the
literal placeholder `p.N`) as a real annotation line.** Confirmed via grep that the real
`buildEnumeratorPayload`/`quoteLinesOnly` pipeline never sent this line to any actual dispatch in
either run — a measurement-scaffolding bug, not a corpus or product-code finding. Fixed
(`/Derived\s*\(p\.\d/i`) before extracting the final corpus and before any analysis. **Files
modified:** scratchpad-only harness (`extract-corpus.mjs`), not shipped code. Corrected the
plan's stated corpus size from 33 to 32 real `Derived` lines — disclosed explicitly rather than
silently using the original assumed count.

**2. [Disclosed methodology note, not a Rule 1-3 fix] Excluded the harness-artifact line-8
classification from all final tallies** (both runs' reconciler dispatches had already run against a
`derivedLinesText` prompt that included the bogus line, since the bug was found only during
analysis, after dispatch). Both runs' reconcilers correctly reported it `uncorroborated` when asked
(no fact corroborates a description of the annotation SYNTAX itself), consistent with the module's
real behavior — excluding it from tallies changes no run's mechanical classification, only removes
a line that was never a real corpus member from the final counts.

No product code in this repository was modified — this plan's product is a measurement, a
confirmation that two prior defects are fixed, and one new structural finding for the orchestrator
to disposition.

## Known Stubs

None — this plan writes no application code.

## Threat Flags

None. No new network endpoint, auth path, or file-access pattern. This plan exercises
already-shipped, already-reviewed code (`verify-enumerate.ts`) on real data; the one bug found and
fixed lives entirely in scratchpad-only measurement tooling that ships nowhere.

## Self-Check: PASSED

- FOUND: .planning/phases/177-derived-line-re-derivation/177-FINAL-PROOF.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/PRE-REGISTRATION.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/manifest.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/analysis-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/analysis-run2.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/run1/, run2/ (90 real dispatch records)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-21-MEASUREMENT/payloads/
- FOUND commit: 2aad3d1c "docs(177-21): commit pre-dispatch expectation for CHECK-04 definitive consolidated measurement, alone"
- CONFIRMED: all three real game repos (`~/BoardSmithGames/{seven,one-two-punch,doom-machine}`)
  byte-identical (sha256, all `.pdf`/`.md` files) before this plan's work began and after all 90
  dispatches completed — `177-21-MEASUREMENT/{baseline,after}-*.sha256`.
- CONFIRMED: zero annotation-vocabulary lines in any of the 32 real assembled enumerator payloads
  (`grep -l -iE "Derived|Visual \(p\.|Named-but-undefined" payloads/*.payload.txt` — no matches;
  `grep -L "BS-ENUMERATE-V1" payloads/*.payload.txt` — no matches, every payload carries the token).
- CONFIRMED: no `claude -p` process left running; `ps aux | grep "claude -p"` clean.

## Full test run

`npm test`: **4130/4130 passed**, full suite, run from `/Users/jtsmith/BoardSmith`. Matches the
stated baseline exactly — this plan modified no BoardSmith source file.
