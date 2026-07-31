---
phase: 178-worked-example-tests
plan: 01
subsystem: testing
tags: [regex, annotation-family, ingest-contract, check-04, wr-07, measurement]

requires:
  - phase: 177.1-wire-check-04-into-pipeline
    provides: "The single consolidated ANNOTATION_FAMILIES/ANNOTATION_CITATION_RE/ANNOTATION_VOCABULARY_RE/annotationLineStartRe definition in derived-line-pattern.ts, and the live buildEnumeratorPayload construction-site backstop this plan had to widen without breaking."
provides:
  - "A shared, exported Example (p.N): recognizer (ANNOTATION_FAMILIES four-name citation list, EXAMPLE_LINE_RE) with zero measured behavior change on any of the three reference games"
  - "WR-07 resolved: Option B (deny-list kept, Example added, CHECK-06 gets its own payload builder), recorded in 178-WR07-DECISION.md and REQUIREMENTS.md"
  - "The Example (p.N): marker in the ingest transcription contract, with a PROC-01 prose-regression pin"
  - "VISUAL_LINE_RE exported from verify-derive-check.ts for plan 178-02's extraction module"
affects: [178-02-example-derivation-module, check-06-worked-example-replay, test-01-build-side-generation]

tech-stack:
  added: []
  patterns:
    - "Split family list: a citation-keyed family list (ANNOTATION_FAMILIES) and a narrower vocabulary-keyed subset (VOCABULARY_KEYED_FAMILIES) driving two structurally different backstops from one source of truth, rather than one list feeding both blindly"

key-files:
  created:
    - .planning/phases/178-worked-example-tests/178-01-MEASUREMENT/scan.mjs
    - .planning/phases/178-worked-example-tests/178-01-MEASUREMENT/RESULTS.md
    - .planning/phases/178-worked-example-tests/178-01-MEASUREMENT/raw-report.json
    - .planning/phases/178-worked-example-tests/178-WR07-DECISION.md
  modified:
    - src/cli/commands/derived-line-pattern.ts
    - src/cli/commands/derived-line-pattern.test.ts
    - src/cli/commands/verify-derive-check.ts
    - src/cli/commands/verify-derive-check.test.ts
    - src/cli/slash-command/bs/ingest/transcription-subagent.md
    - src/cli/slash-command/bs/ingest.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "WR-07 resolved as Option B: keep quoteLinesOnly's deny-list, add Example to it; CHECK-06 gets its own extraction payload builder rather than an inverted allow-list. Chosen because Option B is measured zero-behavior-change on all three reference games (zero Example (p. lines exist today) while Option A would re-open CHECK-04's already-closed 32-line-corpus composition question for a phase that does not need it."
  - "ANNOTATION_FAMILIES (four names, citation-keyed) split from a new VOCABULARY_KEYED_FAMILIES (three names, unchanged) rather than widening one shared list — required because the naive one-list widening silently strips seven's real quote lines from CHECK-04's payload with no error, a worse failure than the throw the plan's measured_hazard block originally hypothesized (corrected by Task 1's live measurement)."

requirements-completed: []

duration: ~25min
completed: 2026-07-31
---

# Phase 178 Plan 01: Example Recognizer, WR-07 Resolution, Ingest Marker Summary

**Split `ANNOTATION_FAMILIES` into a citation-keyed four-name list and a vocabulary-keyed three-name subset to add `Example (p.N):` recognition with zero measured payload-composition change on any reference game, closing WR-07 as Option B.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3 completed
- **Files modified:** 6 source/test files + 1 requirements doc; 4 measurement/decision artifacts created

## Accomplishments

- Measured the real blast radius of the naive `Example` widening against all three reference games (`seven`, `one-two-punch`, `doom-machine`) using the REAL `buildEnumeratorPayload`/`quoteLinesOnly`, and found the plan's own hypothesized failure mode (a throw) does not occur — the actual failure mode is a **silent strip** of seven's two real quote lines, which is worse (no error signal).
- Resolved WR-07 explicitly, with cited evidence and both real `quoteLinesOnly` consumers named by grep: Option B (keep the deny-list, add `Example`, give CHECK-06 its own extraction payload builder).
- Implemented the `Example (p.N):` recognizer at the measured, split scope: `ANNOTATION_FAMILIES` (citation-keyed, now four names) vs. the new `VOCABULARY_KEYED_FAMILIES` (unchanged three names). `ANNOTATION_VOCABULARY_RE.source` stays byte-identical; `ANNOTATION_CITATION_RE.source` gains the fourth alternative, proven behavior-neutral on the live corpus.
- Wired `EXAMPLE_LINE_RE` into `isQuoteLine`'s deny-list (Option B) and exported both it and `VISUAL_LINE_RE` for plan 178-02's extraction module.
- Added the `Example (p.N):` marker to the ingest transcription contract as a sibling of `Named-but-undefined`/`Visual`, including the "never resolve a source contradiction, transcribe both sides" instruction, pinned by a new `ingest.test.ts` PROC-01 describe block.
- `verify-classify.ts` (`PRESENTATION_EXCLUSION_MARKERS`) left untouched — confirmed via an empty `git diff --stat` and a new source-assertion test.
- Full suite green throughout: 4125/244 baseline → 4153/244 after (28 new tests added, 0 subtracted, 0 failing).

## Task Commits

1. **Task 1: Measure the widening's real blast radius on all three reference games** - `a91ce69e` (docs)
2. **Task 2: Decide WR-07 explicitly and record it** - `f5b50a8f` (docs)
3. **Task 3: Implement the Example recognizer at the measured scope, plus the ingest marker** - `7ee50e68` (feat, TDD — RED tests and GREEN implementation landed together since the split design was implemented directly against the measured spec rather than iteratively)

**Plan metadata:** (this commit, pending)

## Files Created/Modified

- `.planning/phases/178-worked-example-tests/178-01-MEASUREMENT/scan.mjs` - Measurement script: real `buildEnumeratorPayload`/`quoteLinesOnly` against all three reference games, both today's three-name backstop and a naive four-name variant
- `.planning/phases/178-worked-example-tests/178-01-MEASUREMENT/RESULTS.md` - Raw per-game counts, verbatim offending lines, and the correction to the plan's hypothesized failure mode
- `.planning/phases/178-worked-example-tests/178-WR07-DECISION.md` - WR-07's full, evidence-cited resolution
- `src/cli/commands/derived-line-pattern.ts` - `ANNOTATION_FAMILIES` widened to four names (citation-keyed); new `VOCABULARY_KEYED_FAMILIES` (three names) drives `ANNOTATION_VOCABULARY_RE` unchanged; `ANNOTATION_CITATION_SOURCES` now four entries
- `src/cli/commands/derived-line-pattern.test.ts` - Updated pins (`ANNOTATION_CITATION_RE.source` changed, `ANNOTATION_VOCABULARY_RE.source` pinned unchanged), new `Example`/`VOCABULARY_KEYED_FAMILIES` coverage
- `src/cli/commands/verify-derive-check.ts` - `EXAMPLE_LINE_RE` added and exported, wired into `isQuoteLine`'s deny-list; `VISUAL_LINE_RE` now exported
- `src/cli/commands/verify-derive-check.test.ts` - New `EXAMPLE_LINE_RE`/`quoteLinesOnly`/fixture-slice coverage for all three reference games, `PRESENTATION_EXCLUSION_MARKERS` unchanged assertion
- `src/cli/slash-command/bs/ingest/transcription-subagent.md` - New `### EXAMPLE markers` section
- `src/cli/slash-command/bs/ingest.test.ts` - New PROC-01 prose-regression describe block
- `.planning/REQUIREMENTS.md` - WR-07 paragraph updated to point at the resolution, history preserved

## Decisions Made

See `key-decisions` above and the full evidence trail in `178-WR07-DECISION.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — corrected a factual claim in the plan's own `<measured_hazard>` block] The naive widening does not THROW — it silently strips real quote lines**
- **Found during:** Task 1
- **Issue:** The plan's `<measured_hazard>` block asserted the naive one-list widening "makes `buildEnumeratorPayload`'s construction-site backstop THROW on `seven`'s slice." Measured behavior (real `buildEnumeratorPayload` construction-site logic, parameterized only in which regex it checks against) shows it does NOT throw: the offending vocabulary match is stripped from the payload by the SAME regex before the backstop check ever runs, so the backstop sees a clean payload and passes.
- **Fix:** No code fix needed (this is a measurement-only task) — recorded the correction in `RESULTS.md`'s "Correction to the plan's stated failure mode" section, with the mechanism traced line-by-line against the real `buildEnumeratorPayload` source. The plan's ultimate conclusion (the naive widening is unsafe) still holds — the mechanism is a silent composition change instead of a throw, which is a **more** dangerous failure mode (no error signal), not a less dangerous one. This did not change Task 3's implementation, which was already designed to avoid both failure modes via the split.
- **Files modified:** `.planning/phases/178-worked-example-tests/178-01-MEASUREMENT/RESULTS.md`
- **Verification:** `node .planning/phases/178-worked-example-tests/178-01-MEASUREMENT/scan.mjs` reproduces `throwsToday=0 throwsFourName=0` for all three games; `vocabularyOnlyNew=2` for seven, quoting the two real lines verbatim.
- **Committed in:** `a91ce69e` (Task 1 commit)

---

**Total deviations:** 1 (a corrected factual claim in the plan's own hazard framing, found via direct measurement rather than assumed)
**Impact on plan:** None on scope or implementation — Task 3's split design already prevented both the hypothesized throw and the actually-measured silent strip, since neither failure mode can occur once `Example` never joins `VOCABULARY_KEYED_FAMILIES`.

## Issues Encountered

None beyond the deviation above.

## Requirements Note

This plan's frontmatter lists `requirements: [CHECK-06, TEST-01]` for traceability to the phase's
overall requirement set, but **neither requirement is complete after this plan.** This plan builds
only the identification mechanism (the `Example (p.N):` recognizer) and the WR-07/ingest-marker
groundwork every later plan in the phase consumes — it does not implement worked-example replay
(CHECK-06) or build-side test generation (TEST-01) themselves. `.planning/REQUIREMENTS.md`'s
CHECK-06/TEST-01 checkboxes are deliberately left unchecked; they will be marked complete by the
plan(s) that actually deliver the replay/generation machinery.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 178-02 (the shared `example-derivation.ts` module) can now:
- Recognize `Example (p.N):` lines via `EXAMPLE_LINE_RE` (exported from `verify-derive-check.ts`) or `annotationLineStartRe('Example')` (from `derived-line-pattern.ts`).
- Recognize `Visual (p.N):` lines via the now-exported `VISUAL_LINE_RE` — needed because `seven`'s Run-example contradiction (measured_reality #4: printed "5, 6, 7" vs. card art 1, 2, 3) is recorded ONLY in a `Visual (p.1):` line, not a `Derived` line.
- Rely on `quoteLinesOnly` continuing to EXCLUDE `Example (p.N):` lines (Option B) — CHECK-06's extraction payload must be built by a SEPARATE function that explicitly includes them, never by reusing `quoteLinesOnly` directly.
- Trust that zero reference-game slices currently carry an `Example (p.` marker (178-01-MEASUREMENT/RESULTS.md) — plan 178-02's proof against the three reference games will need either synthetic/staged fixtures (as this plan's Task 3 tests do) or acceptance that today's corpus yields zero real extractions, which is itself a real, reportable finding about the ingest contract per 178-CONTEXT decision 17.
- No blockers. Full suite green (4153/244).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

All created/modified artifacts confirmed present on disk; all three task commit hashes
(`a91ce69e`, `f5b50a8f`, `7ee50e68`) confirmed present in `git log`.
