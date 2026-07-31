---
phase: 177-derived-line-re-derivation
plan: 22
subsystem: cli-verify
tags: [check04-definitive-measurement, density-hypothesis, real-dispatch, determinism, honesty-discipline]

# Dependency graph
requires:
  - plan: 177-21
    provides: the definitive-measurement method (real dispatch, pre-registration, per-line
      determinism comparison) this plan repeats unmodified, plus the single determinism flip
      (`CARDS.md` L143) this plan's hypothesis test targets directly.
  - commit: 7e05243 (doom-machine repo)
    provides: the CARDS.md-split input change this plan measures against — 9 page-anchored
      slices replacing one 435-line, 125-150-facts-per-enumerator monolithic file, content
      preservation proven mechanically before this plan started.
provides:
  - .planning/phases/177-derived-line-re-derivation/177-CLOSURE-PROOF.md — the definitive
    density-hypothesis measurement: current code, all three reference games, all 32 real
    `Derived` lines, run twice, 108 real `claude -p` dispatches, two explicit different-family
    model ids (`claude-opus-5`, `claude-haiku-4-5-20251001`) plus a `claude-sonnet-5` reconciler.
  - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/ — the full real-dispatch
    record: PRE-REGISTRATION.md (committed alone before any dispatch), the harness scripts
    (adapted from 177-21's, path/model changes only), both runs' raw enumerator/reconciler JSON,
    the code-side analysis output, before/after sha256 hashes for all three real game repos, and
    a disclosed harness JSON-repair log.
  - The density hypothesis tested directly and REFUTED at the aggregate level: the one line
    177-21 flipped is now stable, but overall determinism got worse (4/32 vs 1/32), with 3 of 4
    new flips on ordinary slices never touched by the split.
  - A new determinism-adjacent failure shape, observed live for the first time: a
    decomposition-driven grounding-pairing collision that `composeArithmeticClaim`'s own
    internal-consistency check correctly caught and refused, rather than silently mis-composing.
  - .planning/REQUIREMENTS.md — CHECK-04 amendment 4, left open, citing this run specifically.
affects: [the-orchestrator-disposition-of-CHECK-04, any-future-plan-touching-verify-enumerate.ts-or-attempting-CHECK-04-closure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reused 177-21's real-dispatch harness (extract-corpus/dispatch-enum/dispatch-reconcile/
      driver/analyze.mjs) with path and model-id changes only — explicit different-family model
      ids (claude-opus-5, claude-haiku-4-5-20251001, claude-sonnet-5) instead of CLI aliases,
      per this plan's brief — no reimplementation of judgment logic."
    - "Pre-registered a targeted falsifiable prediction (the exact line that flipped in 177-21,
      now in a normal-sized slice, must stay stable) alongside the general determinism
      prediction, so the density hypothesis itself — not just the aggregate pass/fail — could be
      checked against real evidence without post-hoc reframing."
    - "Disclosed and generically repaired a live-dispatch JSON-malformation finding (an
      enumerator model echoing the source document's own embedded quote marks unescaped) via a
      character-scanning repair applied identically to all facts files, not tuned to the specific
      occurrence, written into the harness before re-running analysis on already-completed
      dispatch data — same disclosure pattern 177-21 used for its own harness regex bug."
    - "Distinguished a coarse exploratory independence grep (over-inclusive, flags the word
      'Derived' anywhere) from the real production independence regexes
      (ANY_ANNOTATION_LINE_RE/ANNOTATION_VOCABULARY_RE, imported unmodified) — ran both, reported
      both, and traced the coarse grep's 4 false-positive hits to a single genuine transcribed
      cross-reference sentence the split introduced, confirmed zero real leaks."

key-files:
  created:
    - .planning/phases/177-derived-line-re-derivation/177-CLOSURE-PROOF.md
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/PRE-REGISTRATION.md
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/manifest.json
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/analysis-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/analysis-run2.json
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/repair-log-run1.json
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/run1/, run2/ (108 real dispatch records: enum + reconcile)
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/payloads/ (assembled enumerator payloads + Derived-line extracts for all 18 slices)
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/{baseline,after}-{seven,one-two-punch,doom-machine}.sha256
    - .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/{extract-corpus,dispatch-enum,dispatch-reconcile,driver,analyze}.mjs (the measurement harness, disclosed alongside its output)
  modified:
    - .planning/REQUIREMENTS.md (CHECK-04 amendment 4 + traceability row)

decisions:
  - "No BoardSmith product code (verify-enumerate.ts or either contract file) was modified in this
    plan, per its own brief (measurement, not remediation) — the harness JSON-repair fix lives
    entirely in this run's own scratchpad-only measurement tooling, never in shipped code."
  - "CHECK-04 stays OPEN. The specific flip 177-21 found is confirmed stable post-split (density
    hypothesis holds for that one case), but the aggregate determinism rate got WORSE (4/32 vs
    1/32) with new flips on slices the split never touched — the density hypothesis is refuted as
    a general explanation. Per this run's own pre-registered rule, any flip on any line blocks
    closure regardless of which specific line it is or whether it confirms or refutes the prior
    run's working theory."
  - "Did not attempt to fix, tune, or re-run anything after seeing the 4-flip result — the harness
    JSON-repair (disclosed above) was written and applied BEFORE re-running analysis on the
    already-completed dispatch data, not in response to the classification counts. Both runs'
    dispatch data is untouched; only the harness's own JSON-parsing step became more tolerant."

# Metrics
metrics:
  duration: "~1 session"
  completed: 2026-07-31
---

# Phase 177 Plan 22: CHECK-04 Density-Hypothesis Measurement Summary

Ran the real, unmodified CHECK-04 replacement mechanism (`verify-enumerate.ts`,
`enumerate-facts.md`, `reconcile-facts.md`) against all three reference games in one pass, twice,
on current code (HEAD, unchanged since `564f1a42` — no BoardSmith source touched by this plan),
testing 177-21's density hypothesis directly: does splitting `doom-machine/CARDS.md` (the densest
slice in the corpus, 125-150 facts/enumerator) into 9 normal-sized page-anchored slices fix
cross-run determinism? **108 real `claude -p` dispatches** — 18 dispatchable slices x 2
enumerators (explicit `claude-opus-5` / `claude-haiku-4-5-20251001` ids, not CLI aliases) x 2
runs, plus 18 x 1 `claude-sonnet-5` reconciler x 2 runs.

## Pre-registration

`177-22-MEASUREMENT/PRE-REGISTRATION.md` committed alone (`9e272f58`, `git show --stat` lists
exactly one file) before any dispatch, naming 5 falsifiable predictions — including one targeted
specifically at the density hypothesis (the exact line 177-21 flipped, now in a normal-sized
slice, must stay stable across both runs) separate from the general determinism prediction (no
flip anywhere in the 32-line corpus). This separation mattered: the targeted prediction held while
the general one failed, which is exactly the nuanced, non-binary result the two-prediction
structure was built to surface honestly rather than force into a single pass/fail.

## The measurement

**Corpus**: 32 real `Derived` lines (unchanged total from 177-21) across 18 dispatchable slices
(up from 15 — `CARDS.md`'s split distributes its 5 lines across 5 of its 9 new page-anchored
files). `seven` (3 lines) and `one-two-punch` (11 lines) are untouched since 177-21; `doom-machine`
(18 lines) has identical content, now spread across smaller files. Zero construction-site throws,
zero real independence leaks (production regexes, not the coarser exploratory grep — see below).

## Headline findings

**The targeted density-hypothesis line is now stable.** `doom-machine/01-cards-parts-set-1.md`
L66 (formerly `CARDS.md` L143, the exact "2-space loop" fact that flipped in 177-21) classified
`uncorroborated` in both runs of this measurement, identically. In isolation, this supports the
hypothesis that extreme slice density caused that specific instability.

**But aggregate determinism got WORSE, not better: 4/32 lines (12.5%) flip between runs, versus
177-21's 1/32 (3.1%) and 177-20's 1/28 (3.6%).** Three of the four new flips occur on ordinary
slices that were never dense and never touched by the split:

- `seven/01-definitions-and-components.md` L21 — the `7 x 4 x 4 = 112` arithmetic line, stable
  through both 177-20 and 177-21, now flips `corroborated-by-composition` → `uncorroborated`.
  Traced to a newly-observed failure shape: run 2's reconciler cited a differently-decomposed
  operand set (`"minimum card number is 1"` / `"maximum card number is 7"` split, versus run 1's
  single `"range 1 to 7"` fact), and `validateGrounding`'s pairing attached an internally
  inconsistent A/B numeric pair (A: 7, B: 1) to one cited statement. `composeArithmeticClaim`
  **correctly refused** to compose from that inconsistent operand — the real code's own safety net
  caught the collision and downgraded honestly rather than fabricating a match.
- `seven/01-overview-setup-and-play.md` L38 and `one-two-punch/02-action-cards-and-resolution.md`
  L117 — both plain cross-run enumerator-omission flips, confirmed by direct inspection of the raw
  fact lists (enumerator B stated a fact in one run, omitted it entirely in the other).
- `doom-machine/01-cards-trackers.md` L42 — same omission class, on one of the new, ordinary-sized
  (3,184-byte) card slices: enumerator B stated zero of 6 card-effect facts in run 1, 5-6 of them
  in run 2.

**Conclusion: slice density is refuted as the (sole) cause of this design's cross-run instability
at the aggregate level.** It is a general property of independently-sampled, non-deterministic
enumerator models, exercised at any corpus size — splitting the one known dense slice removed that
one instability locus without addressing the underlying cause, and the aggregate rate went up.

**Zero `contradicted`, either run.** **Grounding**: 1 rejection (run 1) / 8 rejections (run 2), out
of 360/384 total "both" claims — every rejection a genuine reconciler Rule-2 quoting violation
(short glyph fragment or paraphrase instead of the fact's real statement), mechanically caught,
zero fabrications passed. **Independence**: the real production regexes
(`ANY_ANNOTATION_LINE_RE`/`ANNOTATION_VOCABULARY_RE`, imported unmodified) matched zero times
across all 18 real dispatched payloads. A coarser, over-inclusive exploratory grep (`Derived`
anywhere in the text) flagged 4 payloads; all four are the identical, genuine, transcribed
cross-reference sentence the split introduced (`> See `01-cards-overview.md` for the source note
(QUOTE/Derived/Visual legend)...`) — real document content naming the legend's LOCATION, not
leaking any line's derived answer, and confirmed not to match either real filter. **Explainability**:
every non-corroborated line in both runs traces to a named mechanical category in
`177-22-MEASUREMENT/analysis-run{1,2}.json`.

## The goal in its own unit

**Of 32 real, rule-bearing `Derived` lines across three reference games, 32 (100%) received a
genuine, independent dual-enumeration attempt on current code, in both runs** — matching 177-21's
first-ever 100%-of-corpus result and confirming it holds after the split. Of those 32:
22/23 (run 1/run 2) resolved to a real, code-verified positive signal (`corroborated` or
`corroborated-by-composition`); 2/2 resolved `absence-*`; 8/8 resolved `uncorroborated`, each
individually named; 0/0 resolved `contradicted`.

## CHECK-04 disposition — NOT closed

All five of this run's closing criteria were checked against actual evidence. **Determinism
failed** (4/32 lines, worse than either prior run) — per the run's own pre-registered rule, this
alone blocks closure regardless of the other four criteria passing cleanly for the second
consecutive definitive run. `CHECK-04` remains open in `.planning/REQUIREMENTS.md`, with amendment
4 citing this run specifically. What remains open is now more sharply defined than either prior
amendment could show: whether byte-identical classification determinism is achievable at all
against hosted, temperature-bearing enumerator models, independent of corpus size or slice
density, without either redefining the determinism criterion (e.g., stability of the underlying
grounded-fact set rather than the final classification label) or controlling a seed/temperature
parameter this run's CLI dispatch surface does not expose — neither attempted here, per this run's
own measurement-not-remediation scope.

## Deviations from Plan

**1. [Rule 1 - bug found in a live model output, generically repaired before analysis, not
after seeing results] Run 1's `claude-haiku-4-5-20251001` enumerator emitted syntactically invalid
JSON for one slice** (`doom-machine/01-objective-and-setup.md`, enumerator B) — an unescaped
double-quote inside a `sourceSentence` string value, echoing the source document's own embedded
quote marks (`"Find the "Doom Core" machine part card..."`) without escaping them. This is a
live-dispatch data-quality finding, not a `verify-enumerate.ts` defect: the module's real
`createEnumeratedFact` never receives raw unparsed text in production (a Task-tool dispatch
returns already-structured output); this measurement's own manual `claude -p --output-format json`
+ text-parse step is what exposes the raw model string. **Fix:** a generic, non-case-tuned repair
(a character-scanning pass that escapes any `"` not immediately followed by a JSON structural
character) was written into `analyze.mjs` and applied before re-running the analysis on the
already-completed dispatch data — 4 repairs, one file, disclosed in full
(`177-22-MEASUREMENT/repair-log-run1.json`). No dispatch data was regenerated, hand-edited, or
selectively excluded. **Files modified:** scratchpad-only harness (`analyze.mjs`), not shipped
code.

**2. [Disclosed methodology note, not a Rule 1-3 fix] Two-prediction pre-registration structure**
(a targeted density-hypothesis prediction alongside the general determinism prediction) was a
deliberate plan-time design choice, not a deviation, but is called out here because it produced a
genuinely split result (the targeted prediction held, the general one failed) that a single
pass/fail prediction would have obscured — reported as designed, not reframed after the fact.

No product code in this repository was modified — this plan's product is a measurement, a direct
test of 177-21's own hypothesis (with an honest refutation at the aggregate level), and one new
observed failure shape (`composeArithmeticClaim`'s correct refusal under a grounding-pairing
collision) for the orchestrator to disposition.

## Known Stubs

None — this plan writes no application code.

## Threat Flags

None. No new network endpoint, auth path, or file-access pattern. This plan exercises
already-shipped, already-reviewed code (`verify-enumerate.ts`) on real data; the one finding (a
live model JSON-malformation) is handled entirely in scratchpad-only measurement tooling that
ships nowhere.

## Self-Check: PASSED

- FOUND: .planning/phases/177-derived-line-re-derivation/177-CLOSURE-PROOF.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/PRE-REGISTRATION.md
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/manifest.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/analysis-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/analysis-run2.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/repair-log-run1.json
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/run1/, run2/ (real dispatch records)
- FOUND: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/payloads/
- FOUND commit: 9e272f58 "docs(177-22): commit pre-dispatch expectation for CHECK-04 definitive measurement, alone"
- CONFIRMED: all three real game repos (`~/BoardSmithGames/{seven,one-two-punch,doom-machine}`)
  byte-identical (sha256, all `.md`/`.pdf` files) before this plan's work began and after all 108
  dispatches completed — `177-22-MEASUREMENT/{baseline,after}-*.sha256`.
- CONFIRMED: zero real annotation-vocabulary matches (production regexes
  `ANY_ANNOTATION_LINE_RE`/`ANNOTATION_VOCABULARY_RE`, imported unmodified from
  `verify-enumerate.ts`) across all 18 real assembled enumerator payloads, both against the coarse
  grep's 4 flagged files individually and against the full corpus.
- CONFIRMED: no `claude -p` process left running; `ps aux | grep "claude -p"` clean.

## Full test run

`npm test`: **4130/4130 passed**, full suite, run from `/Users/jtsmith/BoardSmith`, after all
dispatch and analysis work completed, before this plan's final commit. Matches the stated baseline
exactly — this plan modified no BoardSmith source file.
