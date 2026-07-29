---
phase: 174-verify-classifier
plan: 02
subsystem: verify-run-ledger
tags: [verify-pipeline, ledger, export-surface, classification-schema]
requires: []
provides:
  - "src/cli/commands/verify-run.ts — exported atomicWriteFile, appendLedgerLine, locateFences, parseLedgerBody, resolveLedgerState, ledgerFilePath, readLedgerOrThrow; exported ParsedUnitLine/ParsedMarkerLine/ParsedLine/ParsedClassificationLine; exported ClassificationRecord"
  - "ClassificationRecord.units[]/liveSlices[]/stagedSlices[] — the plural m:n schema plan 174-03/174-04 assign SlicePair.stagedUnits[] into directly, with no transformation"
affects:
  - "src/cli/commands/verify-classify.ts (plans 174-03/174-04) — will import the now-exported ledger helpers instead of copying them"
tech-stack:
  added: []
  patterns:
    - "Genuine reuse via export, not copy: the SAME atomic temp-file+fsync+rename write path (173-08/CR-01) now has a second legitimate caller"
    - "Fourth discriminant kind added to an existing parser's union, following the same malformed-line-tolerant discipline as the first three kinds"
key-files:
  created: []
  modified:
    - src/cli/commands/verify-run.ts
    - src/cli/commands/verify-run.test.ts
decisions:
  - "ClassificationRecord's parse branch validates every field's TYPE but not ENUM MEMBERSHIP of provenance/ruleDelta — enum normalization is the record command's job (plan 174-04, CONTEXT.md decision 8), so the parser never throws on an unrecognized label"
  - "resolveLedgerState's new classifications[] field resolves last-write-wins per pairId, matching the append-only ledger's re-classification path (decision 6)"
metrics:
  duration: "~1 session"
  completed: "2026-07-29"
---

# Phase 174 Plan 02: Ledger Export Surface + Classification Record Kind Summary

Widened `verify-run.ts`'s ledger surface so a sibling module can genuinely reuse the one hardened
atomic write path instead of re-earning crash-safety, and taught the ledger's record union a fourth
kind — `classification` — with a plural, m:n-shaped schema matching the pairing output field-for-field.

## What was built

**Task 1 — Export the seven ledger helpers and the ParsedLine union.** Added `export` to
`ledgerFilePath`, `atomicWriteFile`, `locateFences`, `appendLedgerLine`, `parseLedgerBody`,
`resolveLedgerState`, and `readLedgerOrThrow` — no signature, body, or behavior change to any of
them; only the `export` keyword plus a doc-comment sentence naming `verify-classify.ts` as the
second caller. Also exported `ParsedUnitLine`, `ParsedMarkerLine`, and `ParsedLine`. Pinned with
three new tests (`EXPORT-1..3`) in `verify-run.test.ts`: every helper is importable and a function,
`ledgerFilePath` returns the exact path a real `verifyRunInitCommand` created, and `atomicWriteFile`
leaves no `*.tmp*` sibling after a successful write.

**Task 2 — Teach the ledger union a fourth kind, `classification`.** Added
`export interface ClassificationRecord` with `kind: 'classification'`, `pairId: string`, and three
PLURAL array fields — `units: string[]`, `liveSlices: string[]`, `stagedSlices: string[]` — plus
`provenance`, `ruleDelta`, a derived `stale: boolean`, `evidence`, and `recordedAt`. Added
`ParsedClassificationLine` and widened `ParsedLine` to a three-member union. `parseLedgerBody` gained
a fourth discriminant branch (placed before the existing unit branch, since that branch accepts
`kind === undefined`), validating every field's type — including that all three plural fields are
arrays of strings — and routing any failure to `malformedLines`, never throwing.
`resolveLedgerState` gained a new `classifications: ClassificationRecord[]` return field, resolved
last-write-wins per `pairId`; the existing `recorded`/`completeRanges` fields are untouched (they
already filter to unit/marker lines respectively), so kind isolation — a classification line never
appears in `recorded[]`, a `range-reset` marker never supersedes a classification — falls out of the
existing filtering logic rather than needing new exclusion code. Pinned with four tests
(`LEDGER-1..4`): a three-element `units[]` round-trips deep-equal with no element dropped
(`LEDGER-1`); a missing field, `units` as a bare string, `units` containing a non-string, and torn
JSON all land in `malformedLines` without throwing (`LEDGER-2`); a classification line naming the
same unit id as a recorded unit is not double-counted in `verifyRunStatusCommand`'s `recorded[]`
(`LEDGER-3`); a `range-reset` marker leaves a classification record's `units[]` intact
(`LEDGER-4`).

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria greps pass (7 exported helper
declarations, 1 `export type ParsedLine`, 1 `export interface ClassificationRecord` with 0 singular
`unit: string` fields, 6 occurrences of `'classification'`). `npm test` is green at 3624/3624
(3611 baseline from Phase 173, plus tests added by 174-01 and this plan) — no regression.
Typecheck is clean for every file this plan touches; the one remaining `tsc --noEmit` diagnostic
(`docs/seed-to-state.test.ts` not under `rootDir`) is pre-existing, unrelated to `verify-run.ts`,
and out of this plan's scope per the deviation-rules scope boundary.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-run.ts` (7 exported helpers, `ClassificationRecord`, widened
  `ParsedLine`, widened `resolveLedgerState`)
- FOUND: `src/cli/commands/verify-run.test.ts` (`EXPORT-1..3`, `LEDGER-1..4`)
- FOUND commit `5657a132` (feat(174-02): export the ledger's atomic-write and parse helpers)
- FOUND commit `a6997a26` (feat(174-02): teach the ledger union a fourth kind, 'classification')
- `npx vitest run src/cli/commands/verify-run.test.ts` — 43/43 passed
- `npm test` — 3624/3624 passed (full suite, no regression)
