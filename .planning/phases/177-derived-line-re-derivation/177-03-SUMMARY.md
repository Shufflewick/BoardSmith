---
phase: 177-derived-line-re-derivation
plan: 03
subsystem: cli
tags: [verify-pipeline, check-04, derive-recheck, project-level-ledger, cli-registration]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation
    plan: "02"
    provides: "DERIVE_VERDICTS, createDeriveVerdictRecord, readLiveSlices, quoteLinesOnly, enumerateDerivedLines, buildBlindDerivePayload — CHECK-04's mechanical core"
provides:
  - "recordDeriveVerdicts / readDeriveVerdicts — the project-level ledger (rulebook/.derive-recheck/DERIVE-VERDICTS.md, no --run-id) through the one atomic write path"
  - "verifyDeriveRecheckCommand — the read-only report joining enumerated candidates to recorded verdicts, --json shape Phase 179 can assemble a source-free mode from"
  - "`boardsmith verify-derive-recheck` registered in cli.ts with exactly --project and --json"
affects: [177-04-derive-judgment-contracts, 177-05-derive-skill-wiring, 177-06-derive-proof-prediction, 177-07-derive-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Project-level, run-less ledger (rulebook/.derive-recheck/, no .verify/<runId>/ segment) — the same read-only, run-less shape CHECK-03/CHECK-05 (trace-check.ts/drift-check.ts) already hold, now a third instance."
    - "Report-command-reads-its-own-ledger: verifyDeriveRecheckCommand never calls recordDeriveVerdicts itself — recording is a separate, later step (177-04's dispatch skill), keeping the report command itself fully read-only."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts
    - src/cli/cli.ts

key-decisions:
  - "verifyDeriveRecheckCommand reads verdicts from the project-level ledger itself (via readDeriveVerdicts) rather than accepting an options.verdicts map the way verify-ruling-recheck.ts does — since CHECK-04's ledger is project-level (no run to carry a supplied-verdicts map across), reading the ledger directly is the correct single source of truth and keeps the report command genuinely read-only (it never records, only reads what a prior recordDeriveVerdicts call persisted)."

patterns-established:
  - "Enumerate → mechanical-filter → judgment-dispatch → validate-and-record → project-level-ledger-report (fifth instance in this milestone, now including the run-less ledger variant CHECK-03/05 pioneered)."

requirements-completed: []  # CHECK-04 stays open — this plan (3 of 7) adds the CLI surface/ledger; the two judgment-subagent contracts (177-04), verify-game.md wiring (177-05), and the live claude -p dispatch proof (177-06/07) remain.

# Metrics
duration: 38min
completed: 2026-07-30
---

# Phase 177 Plan 03: CHECK-04's CLI Surface Summary

**Gave CHECK-04 its CLI surface: a project-level ledger written through the repo's one atomic write path, and a read-only report command — `boardsmith verify-derive-recheck` — registered with exactly `--project`/`--json` and no `--run-id`, findings exit 0.**

## Performance

- **Duration:** ~38 min
- **Started:** 2026-07-30T21:33:00Z (approx, from prior commit timestamp)
- **Completed:** 2026-07-30T21:43:15Z
- **Tasks:** 2 completed
- **Files modified:** 3 (`verify-derive-recheck.ts`, `verify-derive-recheck.test.ts`, `cli.ts`)

## Accomplishments

- `recordDeriveVerdicts(projectDir, records)` / `readDeriveVerdicts(projectDir)` write and
  round-trip a project-level ledger at `rulebook/.derive-recheck/DERIVE-VERDICTS.md` — no
  `.verify/<runId>/` segment, no `runId` parameter in either function's signature (decision 14),
  matching CHECK-03/CHECK-05's read-only, run-less shape exactly. Both functions route exclusively
  through `atomicWriteFile` (`verify-run.ts`); a source-guard test proves no direct
  `fs.writeFile`/`writeFileSync` call exists anywhere in the module. Re-recording replaces the body
  atomically, proven by writing twice and confirming the first write's record is gone. A round-trip
  test explicitly covers an `underivable` record.
- A before/after whole-project byte-hash test (the T-171-19 class, mirroring
  `chunk-provenance.ts:706-714`) proves recording touches only `rulebook/.derive-recheck/`: a live
  slice and a decoy file at an archive-shaped path (`rulebook/source/rules.pdf`) both confirmed
  byte-identical before and after.
- The module's doc comment gained the source-free-by-construction guarantee in `trace-check.ts`'s
  style (decision 4) plus the project-level-ledger rationale (decision 14).
- `verifyDeriveRecheckCommand({ project, json })` enumerates every live-tree `Derived` line,
  reads whatever `recordDeriveVerdicts` has already persisted to the ledger, and reports one
  `DeriveRecheckFinding` per surviving candidate — `pending` when nothing is recorded yet, never a
  manufactured default. `verdictCounts` includes all four `DERIVE_VERDICTS` with zeros written
  explicitly. Never sets `process.exitCode` anywhere in the module (findings exit 0, decision 15) —
  pinned by a source-inspection test reading the stripped-of-comments module source. Only a missing
  `rulebook/` throws, with a single actionable `--project`-naming line (no stack, no `.ts:`).
  `--json` emits exactly one `console.log` call whose payload parses as JSON. A `disagrees` finding
  always carries both `originalReading` and `rederivedReading` verbatim (decision 8), guaranteed
  transitively by `createDeriveVerdictRecord`'s existing validation from 177-02.
- `boardsmith verify-derive-recheck` registered in `cli.ts` alongside `verify-ruling-recheck`/
  `verify-repair`, with exactly `--project <dir>` and `--json` — confirmed via a real `--help`
  invocation showing no `--run-id` and no bypass option, plus a comment in the registration block
  stating both exclusions explicitly (177-04-06's precedent style).

## Task Commits

Each task was committed atomically:

1. **Task 1: Project-level ledger through the one atomic write path** - `3c43bb36` (feat)
2. **Task 2: The report command and its CLI registration** - `b4318f46` (feat)

_Both tasks used `tdd="true"`; tests were authored alongside the implementation in the same commit
per task, matching this module's existing colocated-test convention (177-02's precedent). The
single authored implementation pass was reconstructed into two task-scoped commits (Task 1's
ledger content isolated first, Task 2's report-command additions restored second), since Task 2's
report command reads through Task 1's `readDeriveVerdicts`._

## Files Created/Modified

- `src/cli/commands/verify-derive-recheck.ts` (+362 lines total across both tasks) —
  `recordDeriveVerdicts`, `readDeriveVerdicts`, `DeriveRecheckFinding`,
  `VerifyDeriveRecheckResult`, `verifyDeriveRecheckCommand`; module doc comment extended with the
  source-free-by-construction and project-level-ledger guarantees.
- `src/cli/commands/verify-derive-recheck.test.ts` (+13 tests, 22 → 35) — round-trip, atomicity,
  project-level/no-run-id, source-free byte-hash, `--json` purity, `process.exitCode`-unset,
  per-verdict-counts-with-explicit-zeros, and pending-by-default tests.
- `src/cli/cli.ts` — imports `verifyDeriveRecheckCommand`; registers `verify-derive-recheck` with
  `--project`/`--json` only, plus a comment stating no `--run-id`/no bypass (decision 14).

## Deviations from Plan

### Auto-fixed Issues

None — the plan's `<action>` text specified the shapes closely enough that no Rule 1/2/3 fixes
were needed beyond ordinary implementation choices (documented as key-decisions above, not
deviations).

### Deferred Issues

None — both tasks completed within the fix-attempt limit with zero blocking issues.

## Known Stubs

None. `verifyDeriveRecheckCommand` is a complete, working read-only report against whatever the
ledger already holds — it correctly reports `pending` for every candidate with no recorded verdict
(proven by a dedicated test), which is the honest state for a project that has not yet run the
judgment-subagent dispatch (177-04/177-05's job). This is not a stub; it is the documented,
tested behavior of a report command whose data source (the recording dispatch) does not exist yet
in this milestone.

## Threat Flags

None. The three threats this plan's `<threat_model>` assigns to `verify-derive-recheck.ts`
(T-177-07 tampering, T-177-08 denial-of-service, T-177-09 information-disclosure) are exactly the
mitigations implemented and tested here (atomic-write-only source guard; `process.exitCode`
never-set source guard; `--json` purity test). No new security-relevant surface (network endpoint,
auth path, file-access pattern, or schema change at a trust boundary) was introduced beyond what
the threat model already names.

## Issues Encountered

- Splitting the single authored implementation pass into two task-scoped commits required removing
  the unused `chalk`/`resolve` imports from the Task-1-only intermediate state (both are used only
  by Task 2's `verifyDeriveRecheckCommand`) to keep the intermediate commit's source clean rather
  than carrying dead imports forward. Both intermediate (28/28) and final (35/35) states were
  independently test-run and typechecked clean before each commit.

## Verification

- `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` — 35/35 passed (intermediate
  Task-1-only state: 28/28; final Task-1+2 state: 35/35).
- `npm test` — 3931/3931 green (baseline 3918 + 13 new tests, zero regressions).
- `npx tsc --noEmit` — clean; only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir
  error remains.
- `npx tsx src/cli/cli.ts verify-derive-recheck --help` — real invocation confirms exactly
  `--project <dir>` and `--json` are listed, no `--run-id`, no bypass option.
- `grep -c "writeFile" src/cli/commands/verify-derive-recheck.ts` (excluding `atomicWriteFile`
  call sites) — 0 direct `fs.writeFile`/`writeFileSync` calls, confirmed by the module's own
  source-guard test.

## Next Steps

- 177-04 writes the two judgment-subagent contracts (`BS-DERIVE-V1` blind-derive,
  `BS-DERIVE-COMPARE-V1` comparison) and installer leaf probes.
- 177-05 wires the CHECK-04 step into `verify-game.md`, dispatching the new contracts and calling
  `recordDeriveVerdicts`/`verify-derive-recheck` from the skill text.
- 177-06/07 commit the 22-line distribution prediction and run the real `claude -p` dispatch proof
  against both reference games, then close CHECK-04 in `REQUIREMENTS.md`.

## Self-Check: PASSED

- `src/cli/commands/verify-derive-recheck.ts` — FOUND
- `src/cli/commands/verify-derive-recheck.test.ts` — FOUND
- `src/cli/cli.ts` — FOUND
- Commit `3c43bb36` (Task 1) — FOUND in `git log --oneline --all`
- Commit `b4318f46` (Task 2) — FOUND in `git log --oneline --all`
