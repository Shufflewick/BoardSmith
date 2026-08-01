---
phase: 178-worked-example-tests
plan: 04
subsystem: testing
tags: [worked-example, check-06, ledger, sole-write-surface, quote-provenance, cli-registration]

requires:
  - phase: 178-worked-example-tests plan 03
    provides: "verify-example-replay.ts — EXAMPLE_REPLAY_VERDICTS, createExampleReplayRecord, the atomic upsert-append ledger triad, verifyExampleReplayCommand"
  - phase: 178-worked-example-tests plan 02
    provides: "example-derivation.ts — WorkedExampleSpec, createWorkedExampleSpec, collectWorkedExampleSpecs, workedExampleId"
provides:
  - "verify-example-replay.ts — verifyExampleRecordCommand (the ONLY write surface for CHECK-06's ledger), provenance-gated createExampleReplayRecord calls, and cli.ts registration for both verify-example-replay/verify-example-record"
affects: [178-05-verify-example-translate, 178-08-build-test-md, 178-09-verify-game-md-step-8, 178-11-sc3-proof]

tech-stack:
  added: []
  patterns:
    - "Validate-everything-then-write: every WorkedExampleSpec and ExampleReplayRecord is built and checked in-memory before the single recordExampleReplayVerdicts call at the end — a rejection anywhere throws before any mutation, mirroring verify-derive-record's design."
    - "Caller-assigned identity, forced not trusted: raw extraction/translation entries carry their own slicePath field, but the command overrides it with this invocation's own --slice-path before building any spec or record — workedExampleId is computed from the caller's own coordinates, never the model's returned field (177.1 CR-01/CR-02 continuation)."
    - "Provenance resolved ONCE per invocation, never per example: QuoteVerifiedProvenance.obtain(projectDir) + .covers(slicePath) decided a single time, threaded into every record built from that one --slice-path call."
    - "Read-command provenance is separate from record-time provenance: verifyExampleReplayCommand obtains its own QuoteVerifiedProvenance instance purely to surface project-level unarchivedSources in its report; it never recomputes or overrides the provenance field verifyExampleRecordCommand already froze onto each stored record."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/verify-example-replay.test.ts
    - src/cli/cli.ts
    - src/cli/cli.test.ts

key-decisions:
  - "The plan's literal grep gate (`grep -c \"run-id\\|force\\|--skip\\|overwrite\" src/cli/commands/verify-example-replay.ts` returns 0) is checked against the WHOLE file including JSDoc prose. Wave 3 had already put 2 matches into that file's own comments (\"no run-id\", \"bypass/force/skip\") explicitly documenting the absence of those flags — the same discipline this plan's own <behavior> section asks for (\"No --run-id, --force, --skip, or --overwrite option exists\"). A criterion requiring BOTH explicit prose naming the absent flags AND zero occurrences of those flag-name substrings is unsatisfiable as literally worded (decision 14's 'could this ever pass?' gate). Resolved by rephrasing all 4 occurrences (2 pre-existing from wave 3, 2 newly authored) to state the same guarantee without the literal substrings (e.g. \"no run identifier flag\", \"forced\" -> \"overridden\") — the grep now genuinely returns 0 while every guarantee stays documented in prose."
  - "Extraction/translation collision detection reuses collectWorkedExampleSpecs (already throws naming both previews on an id collision) for the extraction side, and a new local keyRawExampleEntriesByLocation helper (same shape, same message pattern) for the translation side — rather than writing a second, differently-shaped collision detector for each raw JSON array."
  - "Missing/orphaned translation entries are validated explicitly (every extracted example must have exactly one matching translation, and vice versa) even though the plan's <behavior> section did not name this case directly — Rule 2 (missing critical functionality): a translation entry with no matching extraction, or an extraction with no matching translation, is exactly the kind of tampering/omission the ledger's fail-closed design exists to reject before any write."

requirements-completed: []

duration: ~55min
completed: 2026-08-01
---

# Phase 178 Plan 04: verify-example-record Sole Write Surface + Provenance Gating + CLI Registration Summary

**Added `verifyExampleRecordCommand` as CHECK-06's only ledger write surface — containment-checked `--slice-path`, caller-assigned identity, validate-everything-then-write, and `QuoteVerifiedProvenance`-gated confidence on every record — then registered both `verify-example-replay`/`verify-example-record` in the real CLI, proven reachable by an actual built `node dist/cli.js` invocation, not merely a source assertion.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 completed (Tasks 1 and 2 landed together — provenance gating is threaded directly through the same write-surface function Task 1 builds, the same combined-landing precedent 178-03 set for tightly-coupled work; Task 3's CLI registration is a separate commit-worthy unit but was verified and committed alongside since both tasks touch the same small module/CLI pairing)
- **Files modified:** 4 (no new files — extended plan 03's module/test pair, plus `cli.ts`/`cli.test.ts`)

## Accomplishments

- **Task 1 — `verifyExampleRecordCommand`, the sole write surface.** `--slice-path` is containment-checked against `projectDir/rulebook` (mirrors `verify-derive-record`'s CR-04 fix / `verify-classify.ts`'s `--live-slice` guard verbatim) BEFORE any read. Reads `--extraction`/`--translation` JSON files through `parseSubagentJsonInput` (reused, not re-implemented) and a locally mirrored `readRequiredExampleJsonFile` (matching `verify-derive-check.ts`'s module-private `readRequiredJsonFile`, which is not exported). Every raw entry's `slicePath` field is overridden with the invocation's own `--slice-path` before building anything — identity is caller-assigned via `workedExampleId({slicePath, lineNumber})`, never trusted from the model's return. `keyRawExampleEntriesByLocation` throws, naming both colliding entries' previews, when two raw entries (in either the extraction or the translation array) resolve to the same `slicePath`+`lineNumber`. Specs are built through `createWorkedExampleSpec`/`collectWorkedExampleSpecs` (plan 178-02's choke point — rejects an unverbatim `sourceText`, quoting the offending text). Every extracted example must have exactly one matching translation entry, and vice versa — both directions validated explicitly before any write (Rule 2: an orphaned entry in either direction is exactly the omission/tampering class the ledger's fail-closed design exists to reject). All `ExampleReplayRecord`s are built in-memory via `createExampleReplayRecord` and only THEN persisted through one `recordExampleReplayVerdicts` call — a rejection anywhere in validation throws before that call ever runs, leaving the ledger byte-identical to its pre-invocation state.
- **Task 2 — provenance gating (178-CONTEXT.md decision 12), threaded through Task 1's same function.** `QuoteVerifiedProvenance.obtain(projectDir)` is called ONCE per invocation (never per example, since a single invocation always covers exactly one `--slice-path`), then `.covers(slicePath)` decides `'quote-verified'` (an archived, hash-verified source exists AND can honestly be said to cover this slice) versus `'quote-unverified'` (no archived source at all, OR an archived source exists but does not cover this specific slice — e.g. the doom-machine `CARDS.md`/`cards.pdf` shape). That single value is threaded into every `ExampleReplayRecord` this invocation builds. `createExampleReplayRecord` (already required `provenance` as of plan 178-03, confirmed unchanged) throws `Invalid provenance "undefined"...` when the field is omitted — a caller cannot skip the gate. `verifyExampleReplayCommand`'s report was extended to obtain its own `QuoteVerifiedProvenance` instance (purely to surface `unarchivedSources`, never to recompute a per-record provenance value already frozen at record time) and to group `disagrees` findings into two explicitly-named buckets: `"mismatch, quotes source-verified"` and `"mismatch, quotes NOT source-verified — read as a question about the quote, not an accusation against the code"`. The downgrade never rewrites `verdict` — a `disagrees` stays `disagrees` in every fixture tested, whether `quote-verified` or `quote-unverified`.
- **Task 3 — CLI registration.** `verify-example-replay` (`--project`, `--json`, `--chunk`) and `verify-example-record` (`--project`, required `--slice-path`/`--extraction`/`--translation`, `--json`) registered in `cli.ts` immediately after the CHECK-04 block, with a leading comment in the same shape naming CHECK-06, the four verdicts, the advisory-vs-build-blocking asymmetry, and that `verify-example-record` is the ONLY ledger write surface. Verified against a REAL BUILT CLI (`npm run build:cli` then `node dist/cli.js verify-example-replay --help` / `verify-example-record --help`, both exit 0 and list the exact documented flags and nothing that names a bypass; `verify-example-record --project /tmp` exits 1 naming the missing required options) — the exact discipline CLAUDE.md and the plan's `what_must_be_right` item 4 require ("registered but broken" would satisfy a source assertion and still leave the check unreachable, the Phase 177.1 defect class this plan exists to avoid repeating). `cli.test.ts` gained registration assertions mirroring the existing CHECK-04 block, including a negative assertion that neither command lists `--run-id`/`--force`/`--skip`/`--overwrite`.
- Full suite green throughout: 4213/246 baseline → 4228/246 (15 new tests, 0 subtracted, 0 failing).

## Task Commits

1. All three tasks — `51780c72` (feat, combined; Task 1's write surface and Task 2's provenance gating are the same function, and Task 3's CLI registration was verified against the same commit's built artifact before landing, following 178-03's own combined-landing precedent for tightly-coupled work)

## Files Modified

- `src/cli/commands/verify-example-replay.ts` — added `verifyExampleRecordCommand`, `VerifyExampleRecordOptions`, `VerifyExampleRecordResult`, `keyRawExampleEntriesByLocation`, `readRequiredExampleJsonFile`, `shortEntryPreview`; extended `verifyExampleReplayCommand`'s `VerifyExampleReplayResult` with `unarchivedSources` and its report with the two named `disagrees` buckets; rephrased 2 pre-existing + kept-avoiding-in-2-new comments to satisfy the grep gate honestly (see Deviations)
- `src/cli/commands/verify-example-replay.test.ts` — 11 new tests: `verifyExampleRecordCommand — record` (6: rejects an escaping `--slice-path`/ledger-unchanged, extraction-collision-throws-naming-both/ledger-unchanged, unverbatim-sourceText-rejected-quoting-text/ledger-unchanged, records-two-examples-with-correct-ids, missing-required-option errors, no-bypass-flag source scan), `verifyExampleRecordCommand / verifyExampleReplayCommand — provenance gating` (5: no-archived-source downgrade + report phrase, uncovered-slice downgrade + report names the slice, fully-verified project records quote-verified + verdict string unchanged, `createExampleReplayRecord` throws on omitted provenance, non-empty `unarchivedSources` basenames appear in the report)
- `src/cli/cli.ts` — imports + registers `verify-example-replay`/`verify-example-record`, immediately after the CHECK-04 block
- `src/cli/cli.test.ts` — 4 new registration tests mirroring the existing CHECK-04 block (`--help` flag listing + no-bypass-flag assertion for each command, an end-to-end real-project JSON run, and the missing-required-options exit-non-zero case)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking issue] `npm run build` does not exist; the real script is `build:cli`**
- **Found during:** Task 3 verification.
- **Issue:** The plan's `<verify>` block literally says `npm run build && node dist/cli.js ...`, but `package.json` has no `"build"` script — only `"build:cli"` (confirmed via `npm run` listing every available script).
- **Fix:** Used `npm run build:cli` (the actual, only build script that produces `dist/cli.js`) for all verification steps. Every prior wave in this milestone (177.1-12/177-PROOF-2.md) used the same real command name.
- **Files modified:** None (verification-only; no source change).

### Findings (not defects — documented, not fixed)

**2. The plan's literal `grep -c "run-id\|force\|--skip\|overwrite"` acceptance gate is unsatisfiable as worded against a file whose own `<behavior>` section requires documenting the absence of those flags in prose**
- **Found during:** Task 1, running the acceptance-criteria grep after writing the module's JSDoc.
- **What's actually true:** The plan's own `<behavior>` bullet ("No `--run-id`, `--force`, `--skip`, or `--overwrite` option exists") and CHECK-04's sibling module (`verify-derive-check.ts`, which documents the identical absence in its own JSDoc: "Registers no `--force`/`--skip`/`--overwrite`/`--run-id` or any other bypass of any kind") both establish that naming the absent flags in prose is the expected, sibling-consistent documentation pattern. Wave 3 had already put 2 such matches into `verify-example-replay.ts` before this plan touched it (a ledger-header string "no run-id" and a JSDoc sentence "no bypass/force/skip option of any kind"). A literal whole-file `grep -c ... == 0` and a documentation requirement to name those exact words cannot both hold simultaneously — this is precisely the "criterion that no possible correct implementation could satisfy" class CONTEXT decision 14 exists to catch.
- **Resolution:** Rephrased all 4 occurrences (2 pre-existing, 2 newly authored) to state the identical guarantee without the literal substrings — "no run-id" → "not scoped to any run", "no bypass/force/skip option" → "no bypass option of any kind", "forced to" → "overridden with" (this last one was an unrelated accidental match — "forced" contains "force" as a substring). The grep now genuinely returns 0 (`grep -c "run-id\|force\|--skip\|overwrite" src/cli/commands/verify-example-replay.ts` → `0`) while every guarantee remains fully documented.
- **Files modified:** `src/cli/commands/verify-example-replay.ts` (4 comment/string rephrasings, zero logic changes)
- **Verification:** `grep -c "run-id\|force\|--skip\|overwrite" src/cli/commands/verify-example-replay.ts` returns `0`; full test suite unaffected (comment-only changes).

---

**Total deviations:** 1 auto-fixed blocking issue (Rule 3, a nonexistent npm script name in the plan's own verify block), 1 documented finding (an unsatisfiable-as-worded acceptance criterion per decision 14, resolved by honest rephrasing rather than either skipping the check or leaving the required documentation out).

## Issues Encountered

None beyond the deviations above.

## Requirements Note

This plan's frontmatter lists `requirements: [CHECK-06]` for traceability, but **CHECK-06 is NOT
complete after this plan** — its `.planning/REQUIREMENTS.md` entry reads "worked examples in the
cited slices are executed against the engine and mismatches reported as findings," which requires
the full pipeline: the extractor/translator subagent contracts (plan 178-07) that actually PRODUCE
the `--extraction`/`--translation` JSON files this command reads, and `verify-game.md`'s new Step 8
(plan 178-09) that DISPATCHES them. This plan builds the write surface, the provenance gate, and
CLI reachability — the mechanism the pipeline will call, not the pipeline wiring itself.
`REQUIREMENTS.md`'s CHECK-06 checkbox remains unchecked, to be marked complete by the plan(s) that
deliver the actual dispatch wiring (178-07/178-08/178-09 and the closing proof, 178-11).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-05 (`verify-example-translate`) can now:
- Reuse `verifyExampleRecordCommand`'s exact `--extraction`/`--translation` JSON file shape as the
  contract its own translation dispatch payload must produce a return matching — the raw entry
  shape (`{slicePath, lineNumber, verdict, reason, expected?, observed?, contradictionA?,
  contradictionB?, testFilePath?}`) is now load-bearing on the write-surface side.
- Import `verifyExampleRecordCommand`, `VerifyExampleRecordOptions`, `VerifyExampleRecordResult`
  from `verify-example-replay.ts` if it needs to compose with the write surface directly — never
  re-implement any of `createExampleReplayRecord`/`recordExampleReplayVerdicts`/
  `QuoteVerifiedProvenance` (SC-3's single-export-site requirement, checked by plan 178-11).
- Rely on `verify-example-record` and `verify-example-replay` both being registered, real,
  reachable CLI commands (`node dist/cli.js verify-example-replay --help` /
  `verify-example-record --help`) — no further CLI plumbing needed for either.
- Note the grep-gate honesty lesson above: any new module-level "no bypass flag" documentation
  sentence in this milestone's remaining plans should avoid the literal substrings
  `run-id`/`force`/`--skip`/`overwrite` if a sibling acceptance criterion greps the whole file for
  their absence.
- No blockers. Full suite green (4228/246).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-08-01*

## Self-Check: PASSED

`src/cli/commands/verify-example-replay.ts`, `src/cli/commands/verify-example-replay.test.ts`,
`src/cli/cli.ts`, `src/cli/cli.test.ts` confirmed modified on disk; commit `51780c72` confirmed
present in `git log`.
