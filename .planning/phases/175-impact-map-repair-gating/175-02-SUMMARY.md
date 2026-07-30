---
phase: 175-impact-map-repair-gating
plan: 02
subsystem: cli
tags: [verify, ledger, provenance, chunk-provenance, atomic-write]

requires:
  - phase: 174-verify-classifier
    provides: "ClassificationRecord's exact widen-the-union pattern this plan copies for a fifth/sixth ledger kind"
  - phase: 173-run-ledger
    provides: "the ONE atomic ledger write path (atomicWriteFile/appendLedgerLine/parseLedgerBody/resolveLedgerState) this plan reuses, never re-implements"
  - phase: 171-provenance-recording
    provides: "VERIFIED_AGAINST_LABELS' append-only positional-destructuring pattern this plan extends"
provides:
  - "ImpactRecord/AdjudicationRecord ledger kinds (verify-run.ts): parsed defensively, resolved last-write-wins per slug/pairId, excluded from recorded[]"
  - "VERIFIED_AGAINST_LABELS' ninth member, 'Re-verified (no code change):', plus VerifiedAgainstRecord.reverifiedNoCodeChange and chunkCheckCommand's matching option"
affects: [176-repair-gating-close, verify-game-skill-text]

tech-stack:
  added: []
  patterns:
    - "A new ledger record kind is a widen-the-union edit in exactly three sites (ParsedLine union, parseLedgerBody branch, resolveLedgerState resolution) — never a second fence pair or a second atomicWriteFile call"
    - "A new VERIFIED_AGAINST_LABELS member is an append (never a restructure); its render/parse omit-when-absent discipline keeps every existing consumer byte-identical"

key-files:
  created: []
  modified:
    - src/cli/commands/verify-run.ts
    - src/cli/commands/verify-run.test.ts
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts

key-decisions:
  - "ImpactRecord.attributions mirrors ChunkVerdict.attributions[] field-for-field with no collapsing step (decision 16), so Phase 176 never has to re-derive what changed from the boolean stale flag alone"
  - "AdjudicationRecord.outcome 'UNADJUDICATED' is a first-class recorded terminal state (decision 8), never silence — rulingNumber is absent for it by construction, never a sentinel value"
  - "The new VERIFIED_AGAINST_LABELS member's value embeds its own drift-comparison evidence (<hash>..<head> — 0 manifest files changed) rather than asserting a bare boolean, since the block itself carries no timestamp (T-175-07)"
  - "chunk-provenance.ts's cli.ts flag registration is explicitly deferred to plan 175-04 to keep cli.ts in one plan's files_modified — chunkCheckCommand's option is wired and ready"

patterns-established:
  - "Escaping a label string before building its lookup RegExp — the pre-existing readLabel() built new RegExp(`^${label}...`) directly, which silently failed to match any future label containing regex metacharacters"

requirements-completed: [VERIFY-05, VERIFY-06]

duration: 45min
completed: 2026-07-30
---

# Phase 175 Plan 02: Impact/Adjudication Ledger Kinds + Re-Verification Stamp Summary

**`impact` and `adjudication` joined the run ledger's existing fence pair as first-class kinds, and `## Verified Against` gained a `Re-verified (no code change):` stamp that names its own evidence — both through the single atomic write path and label array Phases 171-174 already built, with zero second write paths introduced.**

## Performance

- **Duration:** ~45 min
- **Started:** ~2026-07-30T13:26:00Z (approx, per read step)
- **Completed:** 2026-07-30T14:11:58Z
- **Tasks:** 2 completed
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments
- Widened `verify-run.ts`'s `ParsedLine` union, `parseLedgerBody`, and `resolveLedgerState` to a fifth and sixth ledger kind (`impact`, `adjudication`) in the SAME `RUN_LEDGER_BEGIN`/`END` fence pair 174-02 already extended for `classification` — same malformed-line discipline, same last-write-wins resolution, same kind-isolation from `recorded[]`/`range-reset`
- Appended `'Re-verified (no code change):'` as `VERIFIED_AGAINST_LABELS`' ninth member, added `reverifiedNoCodeChange?: string` to `VerifiedAgainstRecord`/`ParsedVerifiedAgainst`, and wired `chunkCheckCommand`'s matching option — every existing eight-label consumer keeps parsing unchanged
- Added 18 new tests (7 in `verify-run.test.ts`, 11 in `chunk-provenance.test.ts`) covering round-trip parse, malformed-line demotion, last-write-wins supersession, kind isolation, `range-reset` non-interference, the nine-member label pin, and byte-identical rendering when the new field is absent
- Found and fixed a latent regex-escaping bug in `parseVerifiedAgainst`'s `readLabel()` helper — see Deviations

## Task Commits

Each task was committed atomically:

1. **Task 1: Two new ledger record kinds in the existing fence pair** - `b041b6ae` (feat)
2. **Task 2: `Re-verified (no code change):` — decision 11's stamp in `## Verified Against`** - `a3ebf8fa` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/commands/verify-run.ts` - `ImpactRecord`/`AdjudicationRecord` interfaces, `ParsedImpactLine`/`ParsedAdjudicationLine`, widened `ParsedLine`/`parseLedgerBody`/`resolveLedgerState`
- `src/cli/commands/verify-run.test.ts` - 7 new tests + a grep guard proving no second `RUN_LEDGER_BEGIN` fence was introduced
- `src/cli/commands/chunk-provenance.ts` - ninth `VERIFIED_AGAINST_LABELS` member + `LABEL_REVERIFIED`, `VerifiedAgainstRecord.reverifiedNoCodeChange`, render/parse support, `chunkCheckCommand`'s new option, and the `readLabel()` regex-escape fix
- `src/cli/commands/chunk-provenance.test.ts` - 11 new tests: label-count/order pins, `SCOPE_REASONS` non-reuse guard, render omission/inclusion, round-trip parse, old-block-still-valid, and a live `chunkCheckCommand` integration test

## Decisions Made
- Kept `ImpactRecord.ruleDelta`/`driftState` typed permissively (`ruleDelta: string`, `driftState` validated as string in the parser but typed as the three-value union on the interface) — matching `ClassificationRecord`'s existing stated policy that enum-membership validation is the producing command's job, not the parser's.
- `AdjudicationRecord.rulingNumber` is omitted from the object entirely for `'UNADJUDICATED'` (never written as `undefined` or a sentinel), consistent with the rest of this module's optional-field convention.
- The new `Re-verified (no code change):` line renders between `Skills tree hash:` and the blank line before `Cited slices:`, exactly where the plan's `<action>` specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `parseVerifiedAgainst`'s `readLabel()` did not escape regex metacharacters**
- **Found during:** Task 2, writing the round-trip test for the new label
- **Issue:** `readLabel()` built `new RegExp(`^${label}\\s*(.*)$`, 'm')` directly from the label string. Every pre-existing label (`Scope:`, `Reason:`, etc.) contains no regex metacharacters, so this silently worked by coincidence. `'Re-verified (no code change):'` contains literal parentheses, which the constructed RegExp interpreted as a capture group instead of literal text — the label never matched, and `reverifiedNoCodeChange` always came back `undefined` even when the line was present in the rendered block.
- **Fix:** Escape regex metacharacters (`.*+?^${}()|[\]\\`) in the label before constructing the RegExp.
- **Files modified:** `src/cli/commands/chunk-provenance.ts`
- **Commit:** `a3ebf8fa`

None else — the rest of the plan executed exactly as written.

## Issues Encountered

None beyond the bug above, caught and fixed within Task 2's own scope before its suite went green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both new ledger kinds and the new label are proven end-to-end and ready for the commands/skill-text that will populate them (plan 175-03 and later, per the roadmap).
- `chunkCheckCommand`'s `reverifiedNoCodeChange` option is wired and tested; `cli.ts`'s `--reverified-no-code-change <range>` flag registration remains explicitly plan 175-04's job, so `cli.ts` stays in one plan's `files_modified`.
- No blockers identified for the remaining Phase 175 plans (03-08).

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

All 4 modified files confirmed present on disk; both task commit hashes (`b041b6ae`, `a3ebf8fa`) confirmed in `git log`. Full suite 3769/3769 green (3751 baseline + 18 new tests); `npx tsc --noEmit` clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning remains).
