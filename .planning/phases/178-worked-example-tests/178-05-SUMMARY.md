---
phase: 178-worked-example-tests
plan: 05
subsystem: testing
tags: [worked-example, check-06, cli-registration, sc-3, translation-payload]

requires:
  - phase: 178-worked-example-tests plan 02
    provides: "example-derivation.ts — buildExampleTranslationPayload, collectGameApiSurface, workedExampleId, createWorkedExampleSpec, collectWorkedExampleSpecs"
  - phase: 178-worked-example-tests plan 04
    provides: "verify-example-replay.ts — verifyExampleRecordCommand, its --slice-path containment guard, keyRawExampleEntriesByLocation, readRequiredExampleJsonFile, both CLI registrations"
provides:
  - "verify-example-replay.ts — verifyExampleTranslateCommand, the registered verify-example-translate CLI command, resolveSlicePathWithinRulebook (the shared containment guard)"
  - "SC-3's falsifying test: a source-scanning describe block proving buildExampleTranslationPayload/buildExampleExtractionPayload/collectGameApiSurface each have exactly one declaration site under src/"
affects: [178-06-example-test-emit, 178-07-extraction-translation-contracts, 178-09-verify-game-md-step-8, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "Shared containment guard, not a second copy: the --slice-path validation inline in verifyExampleRecordCommand was extracted to resolveSlicePathWithinRulebook (module-local, not exported) and both verifyExampleRecordCommand and the new verifyExampleTranslateCommand call it — one containment implementation for the whole module, per the plan's explicit instruction."
    - "Extraction-time judgment, translate-time pass-through: an extraction entry with kind === 'example-inconsistent' carries its own reason and is routed straight to notTranslated[] without ever reaching createWorkedExampleSpec or buildExampleTranslationPayload — the command never re-derives or re-judges a decision the extractor already made."
    - "collectGameApiSurface called exactly once per invocation, threaded into every buildExampleTranslationPayload call — never re-collected per example, matching the plan's stated behavior and verified by a byte-equality test against a directly-constructed spec/api pair."
    - "Read-only by construction: no atomicWriteFile, no fs.writeFile/writeFileSync, no ledger call anywhere in verifyExampleTranslateCommand — its entire output is stdout/the returned result object, proven by a test asserting the ledger file and project file listing are byte-for-byte unchanged across an invocation."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/verify-example-replay.test.ts
    - src/cli/cli.ts
    - src/cli/cli.test.ts

key-decisions:
  - "The extraction return's shape for an example-inconsistent entry was not yet specified anywhere in the codebase (plan 178-07, which defines the extractor's subagent contract, has not landed). Designed a minimal, permissive local interface (RawExampleTranslateExtractionEntry) where kind === 'example-inconsistent' requires only slicePath/lineNumber/kind/reason and every WorkedExampleSpec-shaped field is optional — since this command never builds a spec for that entry. This is Claude's Discretion territory per 178-CONTEXT.md (\"the WorkedExample record's exact field shape\" / \"Dispatch batching\"); plan 178-07 must either match this shape or this command's raw-entry parsing must be revisited alongside it."
  - "Both the extraction and example-inconsistent entries are collision-checked TOGETHER, before either bucket is separated out — two entries sharing slicePath+lineNumber collide regardless of which kind either one carries, since identity is assigned from location alone, never from kind or text."
  - "The single-export-site guard was pinned as a genuine falsifier by re-running its OWN counting mechanism (a source-scanning regex, executed via matchAll) against an in-memory-mutated copy of example-derivation.ts's real text, showing the match count goes from 1 to 2. This directly answers what_must_be_right item 5 rather than asserting a fixed array literal would fail if edited — the test exercises the actual detection code path, not a stand-in for it."

requirements-completed: []

duration: ~40min
completed: 2026-07-31
---

# Phase 178 Plan 05: verify-example-translate — the Second Dispatch's Byte Source Summary

**Added `verifyExampleTranslateCommand` (registered as `boardsmith verify-example-translate`) — a read-only CLI command that turns an extractor's structured JSON return into per-example translation dispatch payloads via `buildExampleTranslationPayload`/`collectGameApiSurface`, with a falsifying source-scanning test proving those two symbols and `buildExampleExtractionPayload` are each declared exactly once under `src/`.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 completed, each committed separately
- **Files modified:** 4 (no new files — extended the existing `verify-example-replay.ts`/`.test.ts` module/test pair, plus `cli.ts`/`cli.test.ts`)

## Accomplishments

- **Task 1 — `verifyExampleTranslateCommand`.** Reads `--extraction` (the extractor's already-dispatched structured JSON return, the same file `verify-example-record` reads), validates `--slice-path` against the SAME containment guard `verifyExampleRecordCommand` uses (extracted into a new module-local `resolveSlicePathWithinRulebook` helper rather than duplicated — the plan's explicit "extract it into a module-local named helper if plan 04 left it inline" instruction). Collision-checks the full raw return by `slicePath`+`lineNumber` via the existing `keyRawExampleEntriesByLocation` (reused, not re-implemented) before splitting entries into two buckets: `kind === 'example-inconsistent'` entries route straight to `notTranslated[]` with their reason (never re-judged, never reaching a spec), and every other entry is built into a `WorkedExampleSpec` through `createWorkedExampleSpec`/`collectWorkedExampleSpecs` — the ONE shared choke point in `example-derivation.ts`. `collectGameApiSurface(projectDir)` is called exactly once and threaded into every `buildExampleTranslationPayload` call. Every emitted `exampleId` is computed by the command itself via `workedExampleId({ slicePath, lineNumber })` — never a model-supplied field. The command never assigns `process.exitCode` and performs zero writes (no `atomicWriteFile`, no `fs.writeFile`/`writeFileSync` anywhere in the function) — verified by a test asserting the ledger file and the project's full file listing are byte-for-byte unchanged across an invocation.
- **Task 2 — CLI registration + the SC-3 falsifier.** Registered `verify-example-translate` in `cli.ts` immediately after `verify-example-record` in the CHECK-06 block, extending that block's leading comment with one sentence naming the new command's role. Verified against a REAL BUILT CLI (`npm run build:cli` then `node dist/cli.js verify-example-translate --help` — exit 0, lists `--project`/`--slice-path`/`--extraction`/`--json`, no `--run-id`; `node dist/cli.js verify-example-translate --project /tmp` — exit non-zero naming the missing required options), the exact discipline CLAUDE.md and this plan's `what_must_be_right` item 4 require. Added a `CHECK-06 — one derivation implementation (SC-3)` describe block to `verify-example-replay.test.ts`: (i) a source-scanning test asserting `buildExampleTranslationPayload`, `buildExampleExtractionPayload`, and `collectGameApiSurface` are each declared (`export (async )?function <name>`) exactly once across every non-test `.ts` file under `src/`, at `cli/commands/example-derivation.ts`; (ii) a test asserting `verify-example-replay.ts` imports all three from `./example-derivation.js` and declares no local `function build...Payload`/`function collect...ApiSurface` of its own; (iii) a falsifier test that re-runs the SAME counting regex against an in-memory-mutated copy of `example-derivation.ts`'s real source text (a duplicate declaration string appended, never written to disk) and asserts the match count becomes 2 — directly demonstrating the detector would fire on a real duplication, not merely asserting a static array would change if hand-edited.
- Full suite green throughout: 4228/246 baseline → 4242/246 (14 new tests: 8 in Task 1's `verifyExampleTranslateCommand` describe block, 3 in Task 2's SC-3 describe block, 3 in `cli.test.ts`'s new `verify-example-translate` describe block; 0 subtracted, 0 failing).

## Task Commits

1. Task 1 — `9d35928f` (feat: `verifyExampleTranslateCommand` + the extracted `resolveSlicePathWithinRulebook` containment helper)
2. Task 2 — `e3f42d06` (feat: CLI registration + the SC-3 one-implementation falsifier)

## Files Modified

- `src/cli/commands/verify-example-replay.ts` — added `verifyExampleTranslateCommand`, `VerifyExampleTranslateOptions`, `VerifyExampleTranslatePayloadEntry`, `VerifyExampleTranslateNotTranslatedEntry`, `VerifyExampleTranslateResult`, `RawExampleTranslateExtractionEntry`; extracted `resolveSlicePathWithinRulebook` from `verifyExampleRecordCommand`'s previously-inline containment check and reused it in both commands; imported `buildExampleTranslationPayload`/`collectGameApiSurface` from `example-derivation.js`
- `src/cli/commands/verify-example-replay.test.ts` — 8 new tests under `verifyExampleTranslateCommand — translate` (containment rejection, exampleId stability against changed model text, byte-equality of the emitted payload against `buildExampleTranslationPayload` called directly, collision-throws-naming-both, example-inconsistent → `notTranslated[]` with clean exit, zero-example → zero payloads with clean exit, write-nothing/ledger-and-file-listing-unchanged, no-bypass-flag source scan); 3 new tests under `CHECK-06 — one derivation implementation (SC-3)` (declaration-count-is-1 across `src/`, import-not-redeclare assertion, the mutated-copy falsifier demonstration)
- `src/cli/cli.ts` — imports and registers `verify-example-translate` in the CHECK-06 block, extends the block's leading comment
- `src/cli/cli.test.ts` — 3 new tests under `verify-example-translate — registration` (flag listing + no-bypass-flag assertion, missing-required-options exit-non-zero case, end-to-end real-project JSON run asserting the emitted payload contains `BS-EXAMPLE-TRANSLATE-V1`)

## Deviations from Plan

### Auto-fixed Issues

None — no bugs found, no blocking issues encountered.

### Findings (not defects — documented, not fixed)

**1. The extraction return's `example-inconsistent` entry shape was undefined at plan time — designed here, to be confirmed by plan 178-07**
- **Found during:** Task 1, designing `verifyExampleTranslateCommand`'s raw-entry parsing.
- **What's actually true:** Neither this plan's `<interfaces>` section nor `example-derivation.ts` (plan 02) defines what an extraction-time `example-inconsistent` finding looks like on the wire — `WorkedExampleSpec`'s `kind` field is constrained to `transition`/`predicate` only (`WORKED_EXAMPLE_KINDS`), and `RawExampleExtractionEntry` (plan 04, used by `verifyExampleRecordCommand`) has no notion of it either. The `example-inconsistent` verdict that DOES exist today (`EXAMPLE_REPLAY_VERDICTS`) is decided at the TRANSLATION step, inside `verify-example-record`'s `--translation` file — a different pipeline position than what this plan's Task 1 `<behavior>` describes ("An entry the extractor marked example-inconsistent").
- **Resolution:** Designed a minimal local interface (`RawExampleTranslateExtractionEntry`) permitting `kind: 'example-inconsistent'` alongside `transition`/`predicate`, requiring only `reason` for that shape (every `WorkedExampleSpec` field is optional since no spec is ever built for it). Documented as Claude's Discretion per 178-CONTEXT.md's explicit carve-out for "the WorkedExample record's exact field shape." Flagged for 178-07 (the extraction subagent contract) to confirm or adjust.
- **Files modified:** `src/cli/commands/verify-example-replay.ts` (design-time decision only, not a fix to existing code).
- **Verification:** All 8 Task 1 tests pass, including the dedicated `example-inconsistent` test.

---

**Total deviations:** 0 auto-fixed, 1 documented design finding (an underspecified wire shape this plan had to originate, flagged forward to the plan that owns the extractor's actual subagent contract).

## Issues Encountered

None beyond the finding above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-06 (`example-test-emit.ts`) can now:
- Cite `boardsmith verify-example-translate --project <d> --slice-path <p> --extraction <f> --json` as the real, registered, reachable command that produces the SECOND dispatch's payload — no skill prose needs to describe `GameApiSurface` itself.
- Import `verifyExampleTranslateCommand`, `VerifyExampleTranslateOptions`, `VerifyExampleTranslateResult` from `verify-example-replay.ts` if it needs to compose with the translate step directly — never re-implement `buildExampleTranslationPayload`/`collectGameApiSurface` (SC-3's single-export-site guard, now enforced by a real falsifying test, would fail the suite on a second implementation).
- Reuse `resolveSlicePathWithinRulebook` (module-local, not exported) as the pattern to follow if a future CHECK-06 command needs the same `--slice-path` containment guard — do not re-write the check a third time.
- Note the open design question flagged above: 178-07's extraction subagent contract should confirm the `example-inconsistent` wire shape this plan originated (`kind: 'example-inconsistent'` + `reason` on the raw extraction entry), or explicitly supersede it.
- No blockers. Full suite green (4242/246).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/commands/verify-example-replay.ts`, `src/cli/commands/verify-example-replay.test.ts`,
`src/cli/cli.ts`, `src/cli/cli.test.ts` confirmed modified on disk; commits `9d35928f` and
`e3f42d06` confirmed present in `git log`.
