---
phase: 178-worked-example-tests
plan: 06
subsystem: testing
tags: [worked-example, test-01, sandbox-scan, cli-registration, generated-test-emit]

requires:
  - phase: 178-worked-example-tests plan 04
    provides: "verify-example-replay.ts — readExampleReplayVerdicts, exampleReplayLedgerPath, ExampleReplayRecord, createExampleReplayRecord/recordExampleReplayVerdicts"
  - phase: 178-worked-example-tests plan 05
    provides: "verify-example-translate — the second dispatch's byte source (the translation payload sent to the model that returns the runnable code this plan writes to disk)"
provides:
  - "src/cli/lib/sandbox-scan.ts — scanSourceForSandboxViolations(code, relPath, ruleIds?), the single-source-string entry point scanSandboxViolations now delegates to"
  - "src/cli/commands/example-test-emit.ts — verifyExampleEmitCommand (registered as `boardsmith verify-example-emit`), generatedTestFilePath, scanGeneratedTestCode, GENERATED_TEST_SANDBOX_RULES"
  - "178-06-MEASUREMENT/RESULTS.md — the measured five-rule generated-test sandbox gate, against the three reference games' real hand-written tests"
affects: [178-07-extraction-translation-contracts, 178-08-build-test-md-wiring, 178-09-verify-game-md-step-8, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "One lint implementation, two entry points: scanSandboxViolations's per-file body was extracted into scanSourceForSandboxViolations(code, relPath, ruleIds?) — the whole-project scanner now just loops files and delegates, never a forked config or a re-declared rule list. ruleIds narrows the REPORTED set after the SAME full-FLAT_CONFIG lint pass, so the src/ui/** determinism relaxation still applies correctly even when a caller restricts to a subset."
    - "Measure before choosing a gate, per 178-CONTEXT.md decision 14: ran the new single-file scanner over every tests/*.test.ts in one-two-punch, seven, and doom-machine BEFORE picking GENERATED_TEST_SANDBOX_RULES. boardsmith/no-filesystem (37 hits — ordinary fixture-loading fs/path imports) and boardsmith/no-nondeterministic (1 hit — a randomized-property test's own Math.random()) both fired on real, legitimate, hand-written test code and were excluded; the surviving five rules (no-network, no-timers, no-eval, no-element-identity-comparison, no-element-array-state) never fired."
    - "Validate-everything-then-write, mirroring verify-example-record's own discipline: every executable (agrees/disagrees) record's translated code is scanned against GENERATED_TEST_SANDBOX_RULES BEFORE the file is composed or written — a single violation anywhere rejects the WHOLE chunk's emission, never a partial file."
    - "Identity by workedExampleId, never by prose: --translated entries are keyed by workedExampleId({slicePath, lineNumber}), the same caller-assigned identity every other CHECK-06 command uses — direct continuation of 177.1's fixed lookups-keyed-by-model-text hazard class (178-CONTEXT.md addendum point 5)."
    - "Read-the-ledger, never re-judge it: unexecutable/example-inconsistent records are emitted as a named-reason comment sourced from the record's own `reason` field — this command never re-derives or overrides a verdict the ledger already carries (decision 7)."

key-files:
  created:
    - src/cli/commands/example-test-emit.ts
    - src/cli/commands/example-test-emit.test.ts
    - .planning/phases/178-worked-example-tests/178-06-MEASUREMENT/RESULTS.md
  modified:
    - src/cli/lib/sandbox-scan.ts
    - src/cli/lib/sandbox-scan.test.ts
    - src/cli/cli.ts
    - src/cli/cli.test.ts

key-decisions:
  - "The wire shape for the third dispatch's return (the translator's actual runnable CODE, as opposed to plan 178-05's translationPayload PROMPT) was undefined at plan time — designed here as RawExampleEmitEntry: {slicePath, lineNumber, pageCitation, sourceText, code}, keyed by workedExampleId. pageCitation/sourceText travel on this entry rather than being re-read from the ledger because ExampleReplayRecord (the ledger's own record shape) carries neither field — only exampleId/slicePath/lineNumber/kind/verdict/reason/expected/observed/contradictionA/contradictionB/supportingQuoteLines/provenance/recordedAt/testFilePath. This is Claude's Discretion territory (178-CONTEXT.md: 'the WorkedExample record's exact field shape'); plan 178-07 (the extraction/translation subagent contracts) should confirm or supersede this shape when it defines the third dispatch's actual prompt/response contract."
  - "GENERATED_TEST_SANDBOX_RULES excludes boardsmith/no-filesystem and boardsmith/no-nondeterministic — both fired on real hand-written test code in the measurement (178-06-MEASUREMENT/RESULTS.md), so per 178-CONTEXT.md decision 14 they cannot legitimately gate GENERATED test code either. Test files run under vitest, not inside the executor sandbox src/rules code is held to."
  - "A chunk-wide zero-example exemption is a real, executing `it(...)` (never `it.skip`) that asserts true — proven by actually invoking the repo's own vitest CLI against the emitted file inside a project with node_modules symlinked to this repo (the exact live-symlink layout real BoardSmithGames projects use), not by inspecting the file's text."

requirements-completed: []

duration: ~70min
completed: 2026-07-31
---

# Phase 178 Plan 06: example-test-emit — One Idempotent Generated Test File Per Chunk Summary

**Added `scanSourceForSandboxViolations` (the single-source-string entry point `boardsmith lint`/`validate`'s sandbox scanner now shares with generated code) and `example-test-emit.ts`'s `verifyExampleEmitCommand` (registered `boardsmith verify-example-emit`) — the build-side write surface that turns a chunk's CHECK-06 ledger records and a third dispatch's translated test code into ONE atomic, idempotent `tests/examples/<chunk>.examples.test.ts` file, gated by a measured five-of-seven sandbox rule subset.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 2 completed, each committed separately
- **Files modified:** 7 (2 new source files, 1 new test file, 1 new measurement doc, 4 extended files)

## Accomplishments

- **Task 1 — measured `GENERATED_TEST_SANDBOX_RULES`.** Extracted `scanSandboxViolations`'s per-file body into `scanSourceForSandboxViolations(code, relPath, ruleIds?)`; `scanSandboxViolations` now loops files and delegates, never forking `FLAT_CONFIG` or the rule list. Verified the two entry points agree on one fixture file (a test asserting byte-equal violation arrays). Ran the new single-file scanner over every `tests/*.test.ts` in `~/BoardSmithGames/one-two-punch`, `~/BoardSmithGames/seven`, and `~/BoardSmithGames/doom-machine` — real, legitimate, hand-written test suites — and recorded raw counts + every file/line for non-zero rules in `178-06-MEASUREMENT/RESULTS.md`. `boardsmith/no-filesystem` fired 37 times (ordinary `fs`/`path` fixture-loading imports across 16 files) and `boardsmith/no-nondeterministic` fired once (`seven/tests/scoring.test.ts:628`'s `Math.random()` inside a randomized-property test). Both excluded per 178-CONTEXT.md decision 14 ("a gate that a correct implementation could never pass is a defect in the gate"). The surviving five — `no-network`, `no-timers`, `no-eval`, `no-element-identity-comparison`, `no-element-array-state` — fired zero times and became `GENERATED_TEST_SANDBOX_RULES`.
- **Task 2 — `example-test-emit.ts`.** `generatedTestFilePath(projectDir, chunkSlug)` resolves to `tests/examples/<chunkSlug>.examples.test.ts`, rejecting any slug containing a path separator, `..`, or empty string before any path is composed (T-178-13). `verifyExampleEmitCommand` resolves `--chunk` to its cited slices via the SAME `resolveCitedSlices` mechanism `verifyExampleReplayCommand`'s own `--chunk` option uses (mirrored verbatim in shape/message), reads `readExampleReplayVerdicts` for those slices, and splits records into EXEMPT (`unexecutable`/`example-inconsistent` — emitted as a named-reason comment sourced from the record's own `reason`, never a test) and EXECUTABLE (`agrees`/`disagrees` — needs real code from `--translated`). Every executable record's translated code is scanned via `scanGeneratedTestCode` against `GENERATED_TEST_SANDBOX_RULES` BEFORE the file is composed — validate-everything-then-write, so a single violation anywhere rejects the whole emission and writes nothing. The composed file is written via `atomicWriteFile` (never `fs.writeFile`/`writeFileSync`) — the module's ONLY write, proven never to touch the ledger, and proven that `recordExampleReplayVerdicts` never writes a test file. Registered `verify-example-emit` in `cli.ts` directly after the CHECK-06 block with the same no-bypass-flag discipline (`--project`, required `--chunk`, `--translated`, `--json` — no `--run-id`, `--force`, `--skip`, `--overwrite`), verified against a REAL BUILT CLI (`npm run build:cli`, `node dist/cli.js verify-example-emit --help`).
- Idempotence and per-chunk isolation (D-08, what_must_be_right item 1) proven directly: emitting chunk A twice produces byte-identical output; emitting chunk B leaves chunk A's file byte-identical. A zero-example chunk-wide exemption is proven to be a REAL, PASSING (never `it.skip`) vitest test by actually spawning the repo's own `vitest` CLI against the emitted file inside a generated project with `node_modules` symlinked to this repo — the same live-symlink layout every real BoardSmithGames project uses — not by inspecting the file's text.
- Full suite green throughout: 4242/246 baseline → 4263/247 (21 new tests: 1 in `sandbox-scan.test.ts`'s two-entry-point agreement test, 17 in the new `example-test-emit.test.ts`, 3 in `cli.test.ts`'s new `verify-example-emit` describe block; 0 subtracted, 0 failing).

## Task Commits

1. Task 1 — `6bea3850` (feat: `scanSourceForSandboxViolations` + the measured `GENERATED_TEST_SANDBOX_RULES` subset)
2. Task 2 — `5e5d56a0` (feat: `example-test-emit.ts` — one idempotent generated test file per chunk)

## Files Modified

- `src/cli/lib/sandbox-scan.ts` — extracted `scanSourceForSandboxViolations(code, relPath, ruleIds?)`; `scanSandboxViolations` now delegates to it per file
- `src/cli/lib/sandbox-scan.test.ts` — added the two-entry-point agreement test
- `.planning/phases/178-worked-example-tests/178-06-MEASUREMENT/RESULTS.md` — the measured rule-viability results
- `src/cli/commands/example-test-emit.ts` — `generatedTestFilePath`, `scanGeneratedTestCode`, `GENERATED_TEST_SANDBOX_RULES`, `verifyExampleEmitCommand`
- `src/cli/commands/example-test-emit.test.ts` — 17 tests: path-guard rejection, sandbox-rule inclusion/exclusion proofs, zero-example exemption (including a real spawned-vitest proof), per-chunk isolation (D-08), idempotence, citation-header content, sandbox-violation rejection with nothing written, exempt-record comment-not-test, missing-`--translated` error, ledger/test-file write-boundary disjointness
- `src/cli/cli.ts` — imports and registers `verify-example-emit` directly after the CHECK-06 block, with a comment explaining the write-boundary discipline
- `src/cli/cli.test.ts` — 3 tests: flag listing + no-bypass-flag assertion, missing-required-`--chunk` exit-non-zero case, end-to-end real-project zero-example run

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `atomicWriteFile` does not create its parent directory; `tests/examples/` did not exist in any fixture project**
- **Found during:** Task 2, first test run (all 7 tests exercising a real write failed with `ENOENT` opening the `.tmp` file).
- **Issue:** `atomicWriteFile` (verify-run.ts) opens its temp file directly in `dirname(filePath)` without ever creating that directory — correct for callers writing into an already-scaffolded project structure (e.g. an existing ledger's directory), but `tests/examples/` is a NEW directory this command introduces and no prior step creates it.
- **Fix:** Added `await fs.mkdir(dirname(testFilePath), { recursive: true })` immediately before the `atomicWriteFile` call in `verifyExampleEmitCommand` — one `mkdir -p`-equivalent call, not a change to the shared `atomicWriteFile` primitive (which correctly assumes its caller's directory already exists, matching every other CHECK-0x caller's usage).
- **Files modified:** `src/cli/commands/example-test-emit.ts`.
- **Commit:** `5e5d56a0` (part of Task 2's single commit — caught before the first commit, not a separate fix commit).

---

**Total deviations:** 1 auto-fixed (Rule 1, caught before Task 2's commit — not a separate defect commit).

## Issues Encountered

Getting the "real, runnable vitest" proof test working took two iterations: `vitest run <file> --no-config` misparsed `--no-config` as a config-path argument (commander/vitest CLI quirk); the working shape spawns `vitest run` with `cwd` set to the generated project itself, `node_modules` symlinked from this repo (mirroring the real BoardSmithGames symlink layout CLAUDE.md documents), and no test-file argument — vitest's own default include glob then finds the one emitted file.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**TEST-01's checkbox stays deliberately unchecked** — this plan builds TEST-01's write surface
(`example-test-emit.ts`), not its `build/test.md` wiring; the requirement's own text ("`build/
test.md` generates example-derived tests...") is satisfied only once plan 178-08 wires this
command into that skill's sequence. Matches the CHECK-06/TEST-01 convention every prior 178-0x
`STATE.md` entry already holds.

Plan 178-07 (the extraction/translation subagent contracts) should know:

- **Do not re-implement.** `readExampleReplayVerdicts`, `resolveCitedSlices`, `atomicWriteFile`, `workedExampleId` are imported here, not re-implemented. Any new plan needing the same `--chunk`-to-cited-slices resolution should reuse the block in `verifyExampleEmitCommand`/`verifyExampleReplayCommand` rather than writing a third copy.
- **Confirm or supersede the `RawExampleEmitEntry` wire shape** this plan originated for the third dispatch's return: `{slicePath, lineNumber, pageCitation, sourceText, code}`, keyed by `workedExampleId`. This is a SEPARATE wire shape from wave 5's `example-inconsistent` extraction-return question (that one lives on the FIRST dispatch's return, decided by `verifyExampleTranslateCommand`'s consumer) — 178-07 needs to settle both, and they need not be the same shape.
- **`GENERATED_TEST_SANDBOX_RULES`** (`example-test-emit.ts`) is the five-rule subset (`no-network`, `no-timers`, `no-eval`, `no-element-identity-comparison`, `no-element-array-state`) any subagent contract instructing a model to write test code should be told about explicitly — a model unaware of the gate will write code the emitter then rejects with no chance to self-correct within the same dispatch.
- **`scanGeneratedTestCode(code, relPath)`** is the one function to call to pre-check translated code before submitting it to `verify-example-emit` — cite it, never re-describe the rule list in skill prose.
- No blockers. Full suite green (4263/247).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/lib/sandbox-scan.ts`, `src/cli/lib/sandbox-scan.test.ts`,
`.planning/phases/178-worked-example-tests/178-06-MEASUREMENT/RESULTS.md`,
`src/cli/commands/example-test-emit.ts`, `src/cli/commands/example-test-emit.test.ts`,
`src/cli/cli.ts`, `src/cli/cli.test.ts` confirmed present/modified on disk; commits `6bea3850`
and `5e5d56a0` confirmed present in `git log`.
