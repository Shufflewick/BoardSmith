---
phase: 173-verify-pipeline-core
plan: 02
subsystem: cli
tags: [verify-run, resume-ledger, staging-tree, provenance, fenced-machine-owned-region]

requires:
  - phase: 173-verify-pipeline-core (plan 01)
    provides: "The repaired ingest-archive existing-INDEX branch — a real project's INDEX.md now converges on the HEADER_LABELS contract, which this plan's rulebook/ fixtures build on"
  - phase: 172-conformance-checks
    provides: "findHeadingIndex/extractSection (build-manifest.ts) — imported for reuse discipline, though this plan's own heading location is fence-indexOf, not a heading lookup"
  - phase: 171-ingest-contract-upgrade
    provides: "The fenced machine-owned region convention (GAPS_BEGIN/END) and the chunk-provenance.ts precedent (VERIFIED_AGAINST_BEGIN/END) for a second section minting its own fence pair"
provides:
  - "stagingSlicesDir(projectDir, runId) — the single path-computation authority for rulebook/.verify/<run-id>/slices/, traversal-proof"
  - "verifyRunInitCommand / verifyRunRecordCommand / verifyRunStatusCommand — three CLI commands (verify-run-init/-record/-status) a verify skill invokes for staging allocation and resume-ledger read/write, never reasoning about paths or ledger state from recall"
  - "RUN_LEDGER_BEGIN/END — a new, distinct fence pair; the append-only line-delimited-JSON ledger format that resolves 173-RESEARCH.md Open Question 1"
  - "Proof that five existing rulebook/ consumers (computeVerificationScope, chunkProvenanceStatusCommand, traceCheckCommand, driftCheckCommand, ingestGapsCommand) are structurally blind to the dot-prefixed staging tree, with no new exclusion rule added to any of them"
affects: [173-04, 173-06, 173-07]

tech-stack:
  added: []
  patterns:
    - "Fenced machine-owned region reused for a THIRD section (RUN_LEDGER_BEGIN/END), never sharing a fence with GAPS_BEGIN or VERIFIED_AGAINST_BEGIN — one convention, always its own constant pair"
    - "Per-line self-delimiting JSON records inside one fence pair, instead of a second per-record fence convention — a torn append can only ever damage the final line, and an unparseable line is read as NOT recorded rather than thrown"
    - "Write-before-record ordering: verify-run-record confirms the slice file exists, is non-empty, and resolves inside the run's staging dir BEFORE hashing and appending — a record can never outrun the write it describes"
    - "Read-time tamper/crash detection via re-hash-on-status rather than trusting the ledger's own claim: a stored sha256 that no longer matches the file on disk demotes the unit to NOT recorded, with a warning, never a throw"

key-files:
  created:
    - src/cli/commands/verify-run.ts
    - src/cli/commands/verify-run.test.ts
  modified:
    - src/cli/cli.ts

key-decisions:
  - "Ledger format resolves 173-RESEARCH.md Open Question 1: ONE fence pair wrapping the whole ledger (the GAPS_BEGIN shape) rather than a fence per record — keeps exactly one fencing convention in this pipeline. Per-line JSON self-delimits, buying the same crash safety a per-record fence would without a second convention."
  - "run-id is minted by the command (mintRunId(), UTC, YYYY-MM-DDTHH-MM-SSZ) — --run-id is accepted only to target an existing run for resume, never to let a session fabricate its own timestamp."
  - "Malformed/torn ledger lines and sha256 mismatches are read-time findings reported by verify-run-status (warning + demotion to unrecorded), not verify-run-record failures — record only ever refuses when IT cannot append a valid new record (missing run, missing/empty/outside-staging slice, missing fences)."
  - "Combined Task 1 (failing-first tests) and Task 3 (five-consumer invisibility proof) into a single test-authoring commit, since both exercise the same implementation surface and were designed together — the RED-before-GREEN gate still holds against the following implementation commit (test commit precedes feat commit)."
  - "liveProject() test fixture uses ingest-archive.ts's real renderIndex() rather than a hand-written INDEX.md stub, so the invisibility-proof describe block (Task 3) can exercise ingestGapsCommand's real ## Open Rules Gaps heading/fence lookup without a second, drifting fixture shape."

patterns-established:
  - "A CLI command mints its own timestamp/id rather than asking skill text to run `date -u` — the third instance of this pattern in the ingest/chunk-check/verify-run family, all removing an instruction-shaped step Phase 170 proved gets skipped."

requirements-completed: [VERIFY-02, VERIFY-08]

duration: ~40min
completed: 2026-07-28
---

# Phase 173 Plan 02: verify-run CLI — staging tree + resume ledger Summary

**Built `boardsmith verify-run-init/-record/-status`: a non-destructive `rulebook/.verify/<run-id>/slices/` staging allocator and an append-only, machine-owned `RUN.md` resume ledger with its own fence pair, crash-conservative reads, and tamper detection — proven structurally invisible to all five existing `rulebook/` consumers.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3/3 completed (Tasks 1 and 3 landed in one test commit; see key-decisions)
- **Files modified:** 3 (2 new source, 1 modified)

## Accomplishments

- `stagingSlicesDir()` is the single path-computation authority for the staging tree, validating `--run-id` against a fixed UTC shape and asserting containment under `<project>/rulebook/.verify/` before any filesystem operation (T-173-11 closed, test S5).
- `verifyRunInitCommand` mints its own run-id (never asks skill text to run `date -u`) and is idempotent on a supplied `--run-id`: re-init never truncates `RUN.md` and never deletes staged slices (S3, the resume entry point).
- `verifyRunRecordCommand` appends one self-delimiting JSON record per slice-unit strictly between a brand-new `RUN_LEDGER_BEGIN`/`END` fence pair, confirming the slice is written/non-empty/in-staging BEFORE hashing and appending (T-173-13's write-ordering requirement), and is idempotent (L4).
- `verifyRunStatusCommand` is the single JSON-returning read of what's recorded, re-hashing every recorded slice against disk (L8/T-173-12 tamper detection) and treating any unparseable ledger line as NOT recorded rather than throwing (L7/T-173-13 crash safety) — a torn final append can never look complete.
- Task 3's invisibility proof: `computeVerificationScope`, `chunkProvenanceStatusCommand`, `traceCheckCommand`, `driftCheckCommand`, and `ingestGapsCommand` were all run against a fixture carrying both live slices and a populated, deliberately-collision-named staging tree (including a staged `Named-but-undefined` marker) — none of their `--json` output ever mentions the staged path, and `ingestGapsCommand`'s gap sweep scans exactly the 2 live slices, never the staged phantom marker. No exclusion rule was added to any of them; the existing dot-prefix + non-recursive `.md`-filtered readdir convention already achieves this structurally, exactly as 173-CONTEXT.md decision 5 claimed.
- Three commands registered in `cli.ts` (`verify-run-init`, `verify-run-record`, `verify-run-status`), self-documenting via `--help`, no per-command `try/catch` (inherits the top-level `parseAsync` handler).
- `grep -c 'boardsmith:verify-run:' src/cli/commands/verify-run.ts` → 2, and a grep excluding comments finds zero occurrences of `GAPS_BEGIN`/`VERIFIED_AGAINST_BEGIN` in the file — the ledger's fence pair is genuinely its own, never shared.

## Task Commits

1. **Task 1 (failing-first tests) + Task 3 (five-consumer invisibility proof)** — `4318cb68` (test) — 24 cases, RED against a not-yet-existing module.
2. **Task 2: Implement verify-run.ts and register the three commands** — `a9c70dbc` (feat) — all 24 cases GREEN, no test edited to accommodate the implementation.

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/commands/verify-run.ts` — `verifyRunInitCommand`, `verifyRunRecordCommand`, `verifyRunStatusCommand`, `stagingSlicesDir`, `RUN_ID_RE`, `RUN_LEDGER_BEGIN`/`RUN_LEDGER_END`, and the `LedgerRecord` interface. Internal helpers: `mintRunId`, `assertValidRunId`, `runRootDir`, `ledgerFilePath`, `renderEmptyRunMd`, `locateFences`, `appendLedgerLine`, `parseLedgerBody`.
- `src/cli/commands/verify-run.test.ts` — 24 cases: S1-S7 (staging + run allocation), L1-L9 (ledger append/idempotency/crash-safety/tamper-detection), plus a `describe` block proving five existing `rulebook/` consumers are blind to the staging tree.
- `src/cli/cli.ts` — three new command registrations (`verify-run-init`, `verify-run-record`, `verify-run-status`) following the existing five-line `.command()/.description()/--project/--json/.action()` shape; `verify-run-record` additionally uses `.requiredOption()` for `--run-id`/`--unit`/`--slice`.

## Exact Command Surface (for plans 173-04 and 173-07)

**`boardsmith verify-run-init [--project <dir>] [--run-id <id>] [--json]`**
- No `--run-id`: mints a fresh one matching `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/` (UTC, `:`→`-`).
- `--json` returns: `{ runId: string, stagingDir: string, ledgerPath: string, created: boolean }` — `stagingDir`/`ledgerPath` are project-relative.
- Idempotent on a supplied `--run-id`: second call returns `created: false`, mutates nothing.
- Throws (non-zero exit via `cli.ts`'s top-level catch) if `rulebook/` does not exist, or if `--run-id` fails the shape regex.

**`boardsmith verify-run-record --run-id <id> --unit <unit-id> --slice <path> [--project <dir>] [--json]`**
- `--slice` is relative to the run's staging dir (`stagingSlicesDir()`'s return value), e.g. `03-setup.md`.
- `--json` returns: `{ runId: string, unitId: string, slicePath: string, sha256: string, alreadyRecorded: boolean }`.
- Idempotent: recording the same `--unit` twice returns `alreadyRecorded: true` and writes nothing.
- Throws if: `--run-id`/`--unit`/`--slice` missing or `--run-id` malformed; the run was never `init`ed; `--slice` resolves outside the staging dir; the slice file is missing, empty, or not a regular file; `RUN.md`'s fences are missing/damaged.

**`boardsmith verify-run-status [--project <dir>] [--run-id <id>] [--json]`**
- No `--run-id`: reports the most recent run (fixed-width UTC ids sort lexicographically).
- `--json` returns EXACTLY: `{ runId: string, stagingDir: string, recorded: string[], count: number }` — `recorded` is the list of `unitId`s whose ledger record's `sha256` still matches the file on disk.
- Warnings (tamper detected, torn ledger line, slice not found) are printed to `console.error`, never included in the JSON payload and never thrown — a mismatched/torn unit is silently demoted to absent from `recorded`.
- Throws only if no verify run exists at all under `rulebook/.verify/` (or the specific `--run-id` was never `init`ed).

**Ledger record shape** (one per line, self-delimiting, between `RUN_LEDGER_BEGIN`/`RUN_LEDGER_END`):
```json
{"unitId":"03-setup","slicePath":"03-setup.md","sha256":"<hex>","recordedAt":"<ISO-8601>"}
```

## Deviations from Plan

### Auto-fixed Issues

None beyond what the plan's own tasks specified.

### Structural deviations (documented, not silently absorbed)

**1. Combined Task 1 and Task 3 test authoring into one commit.**
- **Reason:** Both tasks add `it`/`describe` blocks to the same `verify-run.test.ts` file and both are exercised by the same Task-2 implementation. Writing them as two separate test-only commits before any implementation existed would have meant the second (Task 3) commit was ALSO fully RED for reasons unrelated to its own content (the module still didn't exist) — no additional signal over combining them.
- **Preserved invariant:** the TDD gate sequence still holds — one `test(...)` commit (`4318cb68`) precedes the one `feat(...)` commit (`a9c70dbc`) that turns every case GREEN, satisfying the plan-level `type: tdd` RED→GREEN requirement.
- **Files:** `src/cli/commands/verify-run.test.ts`

**2. `liveProject()` fixture uses `renderIndex()` instead of a minimal hand-written `INDEX.md`.**
- **Reason:** Task 3's `ingestGapsCommand` proof needs a real `## Open Rules Gaps` heading with its machine-owned fences to exercise the actual gap-sweep code path (not just call the function and let it throw "no heading"). Reusing `renderIndex()` from `ingest-archive.ts` — the same function `ingest-archive.test.ts` reuses — keeps one fixture shape for the whole file rather than a second, drifting minimal-INDEX.md stub.
- **Files:** `src/cli/commands/verify-run.test.ts`

No new false-success behavior was discovered. No architectural changes were needed — every reuse target named in `173-PATTERNS.md`'s interfaces block (`GAPS_BEGIN` shape, `build-manifest.ts`, Commander registration shape, non-recursive `.md`-filtered readdir) was used exactly as specified.

## Verification

- `npx vitest run src/cli/commands/verify-run.test.ts` — 24/24 green.
- `npm test` — 3549/3549 green (233 → 234 test files; baseline 3525 + 24 new), no regression.
- `npm run lint` — zero errors in `src/cli/`; the 3 pre-existing errors remain confined to `src/engine/`/`src/ui/` (unrelated to this plan) plus 1 pre-existing warning in `src/engine/element/game.ts`.
- `node bin/boardsmith.js verify-run-status --help` — prints `--project` and `--json` (confirmed alongside `--run-id`).
- `node bin/boardsmith.js verify-run-init --help` / `verify-run-record --help` — both discoverable and self-documenting.
- `grep -c 'boardsmith:verify-run:' src/cli/commands/verify-run.ts` → `2`.
- `grep -v '^ *[*/]' src/cli/commands/verify-run.ts | grep -c 'GAPS_BEGIN\|VERIFIED_AGAINST_BEGIN'` → `0`.

## Next Phase Readiness

Plans 173-04 (skill text invoking these commands verbatim) and 173-07 (kill-and-resume live proof) can now build directly on the exact `--json` shapes documented above. This plan touched nothing under `~/BoardSmithGames/` — all fixtures were temp-dir only, per the read-only invariant. No retention/pruning policy was built (173-CONTEXT.md decision 7, explicitly deferred), and no cutover/`--apply` path exists (decision 8) — live slices are never opened for write by any function in `verify-run.ts`.

## Self-Check: PASSED

- `[ -f src/cli/commands/verify-run.ts ]` — FOUND
- `[ -f src/cli/commands/verify-run.test.ts ]` — FOUND
- `git log --oneline --all | grep -q 4318cb68` — FOUND
- `git log --oneline --all | grep -q a9c70dbc` — FOUND
- Re-ran plan-level `<verification>`: `npx vitest run src/cli/commands/verify-run.test.ts` (24/24), `npm test` (3549/3549), `npm run lint` (0 errors in `src/cli/`), `node bin/boardsmith.js verify-run-status --help` (prints `--project`/`--json`), both `grep` checks (2 and 0) — all green.
