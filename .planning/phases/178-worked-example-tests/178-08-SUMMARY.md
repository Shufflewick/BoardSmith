---
phase: 178-worked-example-tests
plan: 08
subsystem: skill-prose
tags: [worked-example, test-01, build-test-md, dispatch-orchestration]

requires:
  - phase: 178-worked-example-tests plan 04
    provides: "verify-example-replay.ts — verifyExampleReplayCommand, verifyExampleRecordCommand (the record-side seam this plan closes)"
  - phase: 178-worked-example-tests plan 05
    provides: "verifyExampleTranslateCommand — the second dispatch's byte source, and its notTranslated[] routing for example-inconsistent entries"
  - phase: 178-worked-example-tests plan 06
    provides: "example-test-emit.ts — verifyExampleEmitCommand, the one-file-per-chunk write surface"
  - phase: 178-worked-example-tests plan 07
    provides: "extract-example.md (BS-EXAMPLE-EXTRACT-V1) / translate-example.md (BS-EXAMPLE-TRANSLATE-V1) — the two dispatch contracts this step cites"
provides:
  - "src/cli/slash-command/bs/build/test.md — item 4, the worked-example test-generation step (TEST-01), build-blocking, sequence renumbered 1-8"
  - "verify-example-replay.ts — verifyExampleRecordCommand now accepts kind: 'example-inconsistent' --extraction entries (closes the seam wave 7 flagged)"
affects: [178-09-verify-game-md-step-8, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "Record-level kind widening, not spec-level: EXAMPLE_REPLAY_RECORD_KINDS = [...WORKED_EXAMPLE_KINDS, 'example-inconsistent'] is a NEW, separate constant from WORKED_EXAMPLE_KINDS — createWorkedExampleSpec/buildExampleTranslationPayload are untouched. An example-inconsistent extraction entry never becomes a WorkedExampleSpec (decision 4: never pick a side, a spec implies one agreed example) but IS now a legitimate ExampleReplayRecord, built directly from the extractor's own return."
    - "example-inconsistent entries are split off from --extraction BEFORE spec construction, validated for a non-empty reason, and recorded with contradictionA/contradictionB pulled from supportingQuoteLines[0]/[1] — no --translation entry is required or expected for them (mirrors verifyExampleTranslateCommand's existing notTranslated[] routing, which never dispatches these for translation in the first place)."
    - "build/test.md's TEST-01 step cites all four real commands and both handshake tokens (BS-EXAMPLE-EXTRACT-V1/BS-EXAMPLE-TRANSLATE-V1 — the real example-derivation.ts exports, not the phase's earlier placeholder spelling) and never restates GameApiSurface/exportedSymbols in prose."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/verify-example-replay.test.ts
    - src/cli/slash-command/bs/build/test.md
    - src/cli/slash-command/bs/build-chunk.test.ts

key-decisions:
  - "Closed the wave-7-flagged seam by extending verifyExampleRecordCommand's raw-entry type (per the plan's stated preference), not by filtering example-inconsistent entries out at the orchestrator/prose level. RawExampleExtractionEntry's sourceText/setup/expected became optional and gained an optional reason field, matching what extract-example.md's contract actually returns for that kind."
  - "The record's own kind validation now accepts a THIRD value (example-inconsistent) via a new EXAMPLE_REPLAY_RECORD_KINDS constant, deliberately NOT by widening WORKED_EXAMPLE_KINDS — that would have loosened createWorkedExampleSpec/buildExampleTranslationPayload's own kind check, which must stay exactly {transition, predicate} per decision 5/6."
  - "build/test.md's asymmetry with /bs-verify-game's CHECK-06 (advisory) is stated explicitly in the same paragraph as the build-blocking rule (item 4(g)), per what_must_be_right item 2 — 178-09 (verify-game.md Step 8) must keep that asymmetry, never make the two symmetric."
  - "No change made to example-test-emit.ts — it already routed verdict: 'example-inconsistent' records to the EXEMPT bucket regardless of a record's kind field, so the seam was isolated entirely to verifyExampleRecordCommand; measured directly before assuming otherwise."

requirements-completed: [TEST-01]

duration: ~50min
completed: 2026-07-31
---

# Phase 178 Plan 08: TEST-01 — build/test.md's Worked-Example Step + Closing the Record-Side example-inconsistent Seam Summary

**Wired TEST-01 into `build/test.md` as new numbered item 4 (renumbering the rest to 5-8, guarded by a parsed-index test), citing all four real CHECK-06 commands and both dispatch contracts without restating their logic in prose — and, as a prerequisite, closed the wave-7-flagged seam where `verifyExampleRecordCommand` threw on any `kind: 'example-inconsistent'` `--extraction` entry (the `seven` Run-example fixture) by extending the record-level kind set rather than the spec-level one.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 completed, plus one prerequisite fix (the seam)
- **Files modified:** 4 (`verify-example-replay.ts`, `verify-example-replay.test.ts`, `build/test.md`, `build-chunk.test.ts`)

## Accomplishments

- **Seam fix (prerequisite, before Task 1).** `verifyExampleRecordCommand` fed every `--extraction` entry straight into `createWorkedExampleSpec`, which throws for any `kind` outside `transition`/`predicate` — so an `example-inconsistent` entry (the `seven` Run-example fixture, the phase's designated adversarial case) would crash the record step rather than being recorded. Fixed by: (1) widening `RawExampleExtractionEntry`'s `sourceText`/`setup`/`expected` to optional and adding an optional `reason` field, matching what `extract-example.md`'s real contract returns for that kind; (2) splitting `example-inconsistent` entries off from `consistentEntries` before spec construction; (3) validating a non-empty `reason`; (4) building the `ExampleReplayRecord` directly, with `contradictionA`/`contradictionB` pulled from `supportingQuoteLines[0]`/`[1]` — no `--translation` entry required, since these were never dispatched for translation (`verifyExampleTranslateCommand`'s existing `notTranslated[]` routing already reflects this). Introduced `EXAMPLE_REPLAY_RECORD_KINDS` as a NEW record-level constant (`[...WORKED_EXAMPLE_KINDS, 'example-inconsistent']`), deliberately separate from `WORKED_EXAMPLE_KINDS` itself, so spec construction (`createWorkedExampleSpec`) and the translation payload builder stay untouched. Three new tests prove the `seven`-shaped fixture survives end to end: a standalone record, an empty-reason rejection, and a mixed transition+`example-inconsistent` batch recording both correctly.
- **Task 1 — the worked-example step.** Inserted `build/test.md` item 4, "Worked-example tests (TEST-01)", between the existing chunk-tests item (3) and the full-regression-suite item (renumbered 4→5). Nine ordered sub-steps (a)-(i) cite, in sequence: `verify-example-replay --chunk --json` (enumerate pending slices), a subagent dispatch carrying `extract-example.md`'s `BS-EXAMPLE-EXTRACT-V1` handshake, `verify-example-translate --slice-path --extraction --json` (stated as the ONLY source of translation-dispatch bytes — no `GameApiSurface`/`exportedSymbols` narration appears anywhere in the file), a second subagent dispatch carrying `translate-example.md`'s `BS-EXAMPLE-TRANSLATE-V1` handshake (with the two-dispatch-never-one-combined-pass reason stated inline), one `verify-example-record` invocation per slice, `verify-example-emit --chunk` followed by actually RUNNING the emitted file (verdict comes from the observed pass/fail, never the translator's own `verdictHint`), the build-blocking `disagrees` rule stated in the same paragraph as its deliberate asymmetry with `/bs-verify-game`'s advisory CHECK-06, the non-blocking `unexecutable`/`example-inconsistent` routing (to `## Open Rules Gaps` / a named reason respectively), and the zero-worked-examples exemption named explicitly in the generated test file's own comment. The rest of the sequence renumbered 4-7 → 5-8; the only pre-existing numeric cross-reference in the file ("item 2 above", inside the asset-reachability item) still points at item 2 (sandbox lint), which never moved, so no cross-reference needed updating beyond the sequence's own numbers.
- **Task 2 — regression pins.** Added a `BUILD-06 / TEST-01 — worked-example step (178-08)` describe block (9 tests) to `build-chunk.test.ts`: a numbering guard parsing the "## The Ordered Sequence" section's own `^N. ` items (scoped by heading boundary so it can never collide with the nested A11y Floor's separate 1-5 list) asserting exactly `[1,2,3,4,5,6,7,8]`; a companion test proving the parse helper is a real regression detector (mutating a copy to duplicate item 4 and asserting the parser catches it); the step's position by parsed index (directly after chunk-tests, directly before full-suite) rather than substring search; all four command names including `verify-example-translate` named as the cited producer of translation bytes; both handshake tokens; the two-dispatch rule with its reason; the build-blocking + asymmetry paragraph (isolated via regex between `(g)` and `(h)`); the zero-example exemption sentence; and the run-the-test-not-`verdictHint` sentence.
- Full suite green: **4280/247 baseline → 4292/247** (12 new tests — 3 seam-closing, 9 prose pins — 0 subtracted, 0 failing).

## Task Commits

1. Seam fix (prerequisite) — `1e608bad` (fix: verify-example-record accepts example-inconsistent extraction entries)
2. Task 1 + Task 2 — `372af766` (feat: wire TEST-01 into build/test.md as a new numbered step)

## Files Modified

- `src/cli/commands/verify-example-replay.ts` — `EXAMPLE_REPLAY_RECORD_KINDS`, widened `RawExampleExtractionEntry`, split extraction handling in `verifyExampleRecordCommand`
- `src/cli/commands/verify-example-replay.test.ts` — 3 new tests proving the seam is closed
- `src/cli/slash-command/bs/build/test.md` — new item 4 (TEST-01), sequence renumbered 1-8, title updated to name TEST-01
- `src/cli/slash-command/bs/build-chunk.test.ts` — new `BUILD-06 / TEST-01` describe block (9 tests)

## Closing the `example-inconsistent` Seam — What Changed and the Proof

**Before:** `verifyExampleRecordCommand` mapped every `--extraction` entry through `createWorkedExampleSpec`, which only accepts `kind: 'transition' | 'predicate'` and throws for anything else. A real dispatch chain hitting `seven`'s Run example (the phase's designated adversarial fixture) would crash at the record step.

**After:** `example-inconsistent` entries are recognized and split off before spec construction, validated for a non-empty `reason`, and recorded directly — `contradictionA`/`contradictionB` come from the extractor's own `supportingQuoteLines[0]`/`[1]` (the field wave 7 already confirmed carries both contradicting excerpts verbatim), `kind` is recorded as `'example-inconsistent'` itself (a new record-level-only value, `EXAMPLE_REPLAY_RECORD_KINDS`), and no `--translation` entry is required for these — matching `verifyExampleTranslateCommand`'s existing behavior of never dispatching them for translation.

**The test that proves it** (`src/cli/commands/verify-example-replay.test.ts`, `verifyExampleRecordCommand — record` describe block): `'a seven-shaped example-inconsistent --extraction entry is recorded end to end (the 178-07 seam), never thrown for'` — builds a slice byte-identical in shape to `seven`'s real Run-example contradiction (quoted `"example: 5, 6, 7"` vs. a `Visual (p.1):` line naming `1, 2, 3`), calls `verifyExampleRecordCommand` with an empty `--translation` array (the honest input for an entry that was never dispatched for translation), and asserts the record lands in the ledger with `verdict: 'example-inconsistent'`, `contradictionA`/`contradictionB` populated from the two quoted excerpts, and the extractor's own reason preserved verbatim. Two companion tests prove the validation still fails loud (empty reason throws, writing nothing) and that a mixed batch (one `transition` + one `example-inconsistent`) records both correctly without cross-contaminating each other's pairing requirements.

## Verdict Provenance — Confirmed, Never `verdictHint`

`build/test.md` item 4(f) states explicitly: "The recorded verdict comes from actually running the emitted test and observing its pass/fail result — never from the translator's own `verdictHint`, which is a model's guess, not an observation." This is pinned by a dedicated regression test in `build-chunk.test.ts` (`'states the recorded verdict comes from running the emitted test, never from the translator's verdictHint'`) matching that exact sentence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The wave-7-flagged `example-inconsistent` seam had to be closed BEFORE Task 1 could honestly claim the pipeline it cites actually works end to end**
- **Found during:** Pre-Task-1 reading of 178-07-SUMMARY.md's "Next Phase Readiness" section, which explicitly named this as an unaddressed seam this plan would hit on its first real dispatch.
- **Issue:** `verifyExampleRecordCommand` threw on any `--extraction` entry carrying `kind: 'example-inconsistent'`.
- **Fix:** Extended the record-level kind set (`EXAMPLE_REPLAY_RECORD_KINDS`), split extraction entries before spec construction, and recorded `example-inconsistent` entries directly — per the plan's own explicit instruction to "prefer extending the type" over filtering at the orchestrator/prose level.
- **Files modified:** `src/cli/commands/verify-example-replay.ts`, `src/cli/commands/verify-example-replay.test.ts`.
- **Commit:** `1e608bad` (separate commit, landed before Task 1's build/test.md edit).

**2. [Rule 1 - Bug] A test-collision word ("forced") accidentally matched an unrelated existing regression test's bypass-flag regex**
- **Found during:** First test run after the seam fix.
- **Issue:** A new comment used the word "forced" ("never forced through the transition/predicate path"), which matched the pre-existing `/run-id|force|--skip|overwrite/` bypass-option drift guard in `verify-example-replay.test.ts`.
- **Fix:** Reworded to "never routed through" — no behavior change, comment-only.
- **Files modified:** `src/cli/commands/verify-example-replay.ts`.
- **Commit:** `1e608bad` (same commit, caught before it was ever separately committed).

### Commit-granularity note (not a defect)

The seam fix and the build/test.md wiring are two separate commits (as the plan's `key_links`/`files_modified` scope implies: the seam fix touches `verify-example-replay.ts`, a file not listed in this plan's own `files_modified`). Kept as its own atomic, separately-revertible commit rather than folded into Task 1's commit, since it is logically a bug fix in a different module, not part of `build/test.md`'s own edit.

---

**Total deviations:** 1 auto-fixed (Rule 3 — the seam, a genuine blocker), 1 auto-fixed (Rule 1 — a one-word test-collision bug), 1 commit-granularity note (non-substantive).

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-09 (`verify-game.md` Step 8, CHECK-06) should know:

- **The record-side seam is closed.** `verifyExampleRecordCommand` now accepts `example-inconsistent` `--extraction` entries directly — an orchestrator (this plan's `build/test.md` step, or 178-09's own verify-game.md Step 8) can pass the extractor's raw return straight through without pre-filtering `example-inconsistent` entries out first. `--translation` for those entries should simply be omitted (they were never dispatched for translation) — no special-casing needed on the caller side.
- **Both real handshake tokens are `BS-EXAMPLE-EXTRACT-V1` and `BS-EXAMPLE-TRANSLATE-V1`** (not the phase's earlier placeholder spelling) — verify-game.md's Step 8 must cite these same tokens, not re-derive or rename them.
- **The asymmetry with `build/test.md` is deliberate and must be preserved, not softened.** `build/test.md` item 4(g) treats a `disagrees` verdict as build-blocking; 178-09's CHECK-06 step must be advisory — REPORTS, exit 0, never gates the Close (178-CONTEXT.md decision 11, matching CHECK-03/CHECK-05's precedent). Do not make the two symmetric.
- **`build/test.md`'s own step is a citable precedent for the shared derivation flow** (extract → translate → record → emit, four commands, two contracts) — `verify-game.md`'s Step 8 dispatches the SAME two contracts (`extract-example.md`/`translate-example.md`) and the SAME `verify-example-replay`/`verify-example-record`/`verify-example-translate` commands, but never `verify-example-emit` (that command is build-side only, per 178-CONTEXT.md decision 8 — one generated test file per CHUNK, which verify-game.md has no chunk context for).
- No blockers. Full suite green (4292/247).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/commands/verify-example-replay.ts`, `src/cli/commands/verify-example-replay.test.ts`,
`src/cli/slash-command/bs/build/test.md`, `src/cli/slash-command/bs/build-chunk.test.ts` confirmed
present/modified on disk; commits `1e608bad` and `372af766` confirmed present in `git log`.
