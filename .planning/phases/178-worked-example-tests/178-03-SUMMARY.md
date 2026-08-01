---
phase: 178-worked-example-tests
plan: 03
subsystem: testing
tags: [worked-example, check-06, ledger, atomic-upsert-append, fence-injection, advisory-exit-0]

requires:
  - phase: 178-worked-example-tests plan 02
    provides: "example-derivation.ts — WorkedExampleSpec, workedExampleId, WORKED_EXAMPLE_KINDS, buildExampleExtractionPayload"
provides:
  - "verify-example-replay.ts — EXAMPLE_REPLAY_VERDICTS (frozen four-verdict set), createExampleReplayRecord (the ONE choke-point constructor), the atomic upsert-append ledger triad (exampleReplayLedgerPath/replaceExampleReplayVerdicts/recordExampleReplayVerdicts/readExampleReplayVerdicts), and verifyExampleReplayCommand (read-only, --json, --chunk, exits 0 unconditionally)"
affects: [178-04-write-surface, check-06-cli-registration, verify-game-md-step-8]

tech-stack:
  added: []
  patterns:
    - "Ledger structure mirrored from verify-derive-check.ts (CHECK-04): frozen verdict enum, one choke-point record constructor, fence-injection rejection at construction, read-path revalidation through that same choke point, atomic upsert-append via atomicWriteFile"
    - "Path-containment guard on --chunk (a chunk slug resolving into chunks/<slug>/CHUNK.md) mirroring verify-classify.ts's --live-slice guard — added as Rule 2 (the plan's threat model named it as a required guarantee but did not enumerate --chunk as a threat register row)"
    - "reason required for EVERY verdict, not only unexecutable — a strict superset of the plan's literal per-verdict wording, matching the task's own <done> criterion (\"a named reason and caller-assigned identity\")"

key-files:
  created:
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/verify-example-replay.test.ts

key-decisions:
  - "EXAMPLE_REPLAY_VERDICTS has no external union to compile-time-tie against (unlike DERIVE_CHECK_VERDICTS, which is tied to the externally-imported DerivedLineClassification from verify-enumerate.ts) — it IS the canonical source of truth for ExampleReplayVerdict. The 'exhaustiveness guard' the plan asked to mirror is therefore structural (the type is derived directly from the frozen array, so there is no second declaration anywhere in the module for it to drift against) rather than a literal copy of the _deriveCheckVerdictsExhaustive Exclude<> pattern, which requires an external union that does not exist here."
  - "reason is required for every verdict (not gated per-verdict) — the plan's <behavior> list calls it out specifically for unexecutable, but the task's own <done> criterion ('A verdict cannot enter the system without a named reason and caller-assigned identity') reads as universal. Made universal; this strictly satisfies the unexecutable-specific wording as a special case and costs nothing since every other verdict already needs one to be a useful record."
  - "--chunk resolves into chunks/<slug>/CHUNK.md and reaches fs.readFile — the plan's what_must_be_right item 5 (\"Path containment on any --*-path option that reaches fs.readFile\") applies to it even though the threat-model table's T-178 rows don't name --chunk specifically. Added the same containment guard shape as verify-classify.ts's --live-slice guard (resolve against chunksDir, reject any resolution starting with '..' or escaping via an absolute path) before the first read."

requirements-completed: []

duration: ~45min
completed: 2026-07-31
---

# Phase 178 Plan 03: CHECK-06 Ledger + verify-example-replay Read Command Summary

**Built the CHECK-06 ledger (frozen verdict enum, one choke-point record constructor, atomic upsert-append, revalidating read path) plus `verifyExampleReplayCommand` — a read-only, project-wide, exit-0 report that hands out its own extraction dispatch payloads — mirroring the CHECK-04 (`verify-derive-check.ts`) pairing's four code-reviewed guarantees in structure, without importing any of its blind-derivation judgment machinery.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 completed (landed as one commit — see Deviations)
- **Files created:** 2 (`verify-example-replay.ts`, `verify-example-replay.test.ts`)

## Accomplishments

- **Task 1 — `EXAMPLE_REPLAY_VERDICTS` + `createExampleReplayRecord`.** The frozen four-member set (`agrees`/`disagrees`/`example-inconsistent`/`unexecutable`). `createExampleReplayRecord` is the single validating constructor: rejects an out-of-set verdict or `kind`, rejects an out-of-set `provenance`, requires a non-empty `reason` for every verdict, requires both `expected`/`observed` for `disagrees`, requires both `contradictionA`/`contradictionB` for `example-inconsistent`, rejects any free-prose field (including `supportingQuoteLines[]` and `testFilePath`) carrying the ledger's own fence marker, and requires `exampleId` to equal `workedExampleId({ slicePath, lineNumber })` — caller-assigned identity, never model-supplied, the direct continuation of 177.1's CR-01/CR-02 fix that plan 178-02's `example-derivation.ts` already established.
- **Task 2 — the atomic upsert-append ledger triad.** `exampleReplayLedgerPath` resolves to `rulebook/.example-replay/EXAMPLE-VERDICTS.md`. `replaceExampleReplayVerdicts` writes through `atomicWriteFile` (the repo's one atomic write path — grep-gated at 0 direct `fs.writeFile`/`writeFileSync` calls). `recordExampleReplayVerdicts` upserts by `exampleId`: recording example B never disturbs example A's byte-identical entry; re-recording A replaces it in place, leaving exactly one entry. `readExampleReplayVerdicts` re-enters `createExampleReplayRecord` on every parsed line (CR-02) — a hand-corrupted verdict, a missing required field, or an unbalanced/missing fence pair all throw an actionable message naming the offending location, never silently returning `[]`.
- **Task 3 — `verifyExampleReplayCommand`.** Composes `readLiveSlices` (project-wide, ignores any `.verify/<runId>/` staging tree by construction) + `buildExampleExtractionPayload` + `readExampleReplayVerdicts`. `--chunk` scopes to exactly that chunk's cited slices via `resolveCitedSlices`, guarded against path traversal before its first read, and errors actionably when the slug names no chunk. Never assigns `process.exitCode`, even when every recorded verdict is `disagrees`. Reports raw per-verdict `counts` and a `perGameBreakdown` grouped by `slicePath` — proven to never contain `percent`/`Percentage`/`%` anywhere in its `--json` output. A slice with no ledger entry is reported `pending: true` carrying its own `extractionPayload`, proven byte-equal to `buildExampleExtractionPayload(slice).payload` directly. Human-readable output prints the explicit "n = &lt;count&gt; — too small to distinguish..." line whenever the recorded-verdict count is below 10.
- Full suite green throughout: 4180/245 baseline → 4213/246 (33 new tests, 0 subtracted, 0 failing).

## Task Commits

1. All three tasks — `e06faa3e` (feat, TDD — Task 1's RED/GREEN cycle ran first and separately (verified failing before the module existed, then passing against the minimal Task-1-only implementation); Tasks 2 and 3 were then added to the same module and test file and verified together before the single commit landed, following the same combined-landing precedent 178-02 set for a tightly-coupled three-task module)

## Files Created

- `src/cli/commands/verify-example-replay.ts` — `EXAMPLE_REPLAY_VERDICTS`, `ExampleReplayVerdict`, `ExampleReplayProvenance`, `EXAMPLE_REPLAY_LEDGER_BEGIN`/`_END`, `ExampleReplayRecord`, `createExampleReplayRecord`, `exampleReplayLedgerPath`, `replaceExampleReplayVerdicts`, `recordExampleReplayVerdicts`, `readExampleReplayVerdicts`, `VerifyExampleReplayOptions`, `VerifyExampleReplaySlice`, `VerifyExampleReplaySliceBreakdown`, `VerifyExampleReplayResult`, `verifyExampleReplayCommand`
- `src/cli/commands/verify-example-replay.test.ts` — 33 tests: verdict-set/frozen check (1), `createExampleReplayRecord` construction + 8 distinct throw conditions (16), ledger path/upsert-append/revalidating-read/no-direct-write (8), command behavior (9 more — `-t "verdict"`/`-t "ledger"`/`-t "command"` filters all pass independently, matching the plan's three `<verify>` commands)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical functionality, `what_must_be_right` item 5] `--chunk` needed the same path-containment guard as `--live-slice`, though the plan's threat-model table did not enumerate it as a T-178 row**
- **Found during:** Task 3, implementing `--chunk` resolution into `chunks/<slug>/CHUNK.md`.
- **Issue:** `--chunk` is user-supplied and reaches `fs.readFile` via a joined path (`chunks/<chunk>/CHUNK.md`). The plan's `<threat_model>` table lists T-178-06/07/08 (ledger tampering, verdict overwrite, bypass flags) but has no row naming `--chunk` path traversal specifically — yet the plan's own `what_must_be_right` section (item 5) explicitly instructs mirroring `verify-classify.ts`'s `--live-slice` guard on "any `--*-path` option that reaches `fs.readFile`," citing 177.1's own traversal finding at exactly this shape of option.
- **Fix:** Added the identical containment guard shape (resolve against `chunksDir`, reject any resolution equal to `''`, starting with `..`, or absolute) before the chunk file is read, one-for-one matching `verify-classify.ts`'s `--live-slice` guard.
- **Files modified:** `src/cli/commands/verify-example-replay.ts` (guard in `verifyExampleReplayCommand`), `src/cli/commands/verify-example-replay.test.ts` (`--chunk rejects a value that resolves outside the project chunks directory` test)
- **Verification:** `npx vitest run src/cli/commands/verify-example-replay.test.ts -t "command"` — the traversal test passes, asserting the guard's error message.
- **Committed in:** `e06faa3e`

### Findings (not defects — documented, not fixed)

**2. The plan's "compile-time exhaustiveness guard mirroring `_deriveCheckVerdictsExhaustive`" instruction assumes an external union to tie against, which does not exist for `EXAMPLE_REPLAY_VERDICTS`**
- **Found during:** Task 1, writing the verdict-set section's header comment.
- **What's actually true:** `DERIVE_CHECK_VERDICTS` (`verify-derive-check.ts`) is compile-time tied to `DerivedLineClassification`, an EXTERNALLY-imported union from `verify-enumerate.ts` — the guard exists to catch that external union drifting away from the local array. `EXAMPLE_REPLAY_VERDICTS` has no external counterpart anywhere in the codebase; it IS the canonical, first declaration of the four-member verdict set. Deriving `ExampleReplayVerdict` as `(typeof EXAMPLE_REPLAY_VERDICTS)[number]` is therefore already exhaustive by construction — there is no second, independently-authored union for it to diverge from, and a literal `Exclude<X, Y> extends never` guard would need a second `X` to check against that does not exist.
- **No code change required beyond documenting this in the module's own header comment** — this is the honest structural difference between a set with an external source of truth (CHECK-04's) and one that is itself the source of truth (CHECK-06's). Test coverage (`EXAMPLE_REPLAY_VERDICTS` deep-equal + frozen) still pins the four-member set exactly as the acceptance criteria require.

---

**Total deviations:** 1 auto-fixed (Rule 2, a genuine gap the plan's own prose flagged but its threat-model table didn't enumerate), 1 documented finding (the plan's exhaustiveness-guard instruction doesn't literally transplant because CHECK-06 has no external verdict union to tie against — the derived-type pattern used instead is honest and equally strong for a self-sourced enum).

## Issues Encountered

None beyond the deviations above.

## Requirements Note

This plan's frontmatter lists `requirements: [CHECK-06, TEST-01]` for traceability, but **neither
requirement is complete after this plan** — the same posture 178-02's summary recorded. This plan
builds the ledger and the read/report command; it does not register `verify-example-replay` in
`src/cli/cli.ts`, does not wire a new Step 8 into `verify-game.md`, and does not touch
`build/test.md`'s TEST-01 generation step. `.planning/REQUIREMENTS.md`'s CHECK-06/TEST-01
checkboxes remain unchecked, to be marked complete by the plan(s) that deliver the actual pipeline
wiring (178-04 and later).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Plan 178-04 (verify-example-record write surface + `QuoteVerifiedProvenance` gating + CLI
registration) can now:
- Import `EXAMPLE_REPLAY_VERDICTS`, `ExampleReplayVerdict`, `ExampleReplayProvenance`,
  `ExampleReplayRecord`, `createExampleReplayRecord`, `recordExampleReplayVerdicts` from
  `verify-example-replay.ts` — never re-implement any of these (SC-3's single-export-site
  requirement, checked by plan 178-11).
- Set `provenance: 'quote-verified' | 'quote-unverified'` on every record it constructs —
  `createExampleReplayRecord` validates the value but does not compute it; plan 04's
  `QuoteVerifiedProvenance` gating (178-CONTEXT.md decision 12) is the one place that decides
  which value a record gets.
- Register `verify-example-replay` (and the plan-04 write command) in `src/cli/cli.ts` — neither
  command is registered yet; this plan built the modules only.
- Reuse the `--chunk` path-containment guard shape now established in
  `verifyExampleReplayCommand` if the write surface ever needs an equivalent option.
- Both grep gates (`buildBlindDerivePayload|focusQuoteWindow|blindDeriveHandle` and
  `fs.writeFile|writeFileSync`) return 0 against `verify-example-replay.ts` — keep them at 0 when
  extending the module.
- No blockers. Full suite green (4213/246).

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*

## Self-Check: PASSED

`src/cli/commands/verify-example-replay.ts` and `src/cli/commands/verify-example-replay.test.ts`
confirmed present on disk; commit `e06faa3e` confirmed present in `git log`.
