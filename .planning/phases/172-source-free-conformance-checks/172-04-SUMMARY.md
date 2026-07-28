---
phase: 172-source-free-conformance-checks
plan: 04
subsystem: cli
tags: [vitest, cli, commander, integration-test, exit-code]

# Dependency graph
requires:
  - phase: 172-source-free-conformance-checks
    plan: 02
    provides: "src/cli/commands/trace-check.ts's traceCheckCommand"
  - phase: 172-source-free-conformance-checks
    plan: 03
    provides: "src/cli/commands/drift-check.ts's driftCheckCommand"
provides:
  - "boardsmith trace-check [--project <dir>] [--json] and boardsmith drift-check [--project <dir>] [--json], both registered and reachable from the CLI surface"
  - "src/cli/cli-conformance-commands.test.ts — the first real-child-process CLI exit-code proof in this repo, pinning 172-CONTEXT.md decision 6 (findings exit 0, tool failure exits non-zero) through the actual node bin/boardsmith.js entry point"
affects: [172-05-real-game-proof, 173-bs-verify-game]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First test file in this repo to spawn node bin/boardsmith.js as a real child process via execFile/promisify, reading the exit code off the rejection's `code` property, rather than calling a command function in-process and inspecting process.exitCode — this is what actually exercises cli.ts's top-level parseAsync()/catch block"

key-files:
  created:
    - src/cli/cli-conformance-commands.test.ts
  modified:
    - src/cli/cli.ts

key-decisions:
  - "No mode flag, no --fix flag, no new path flag — --project and --json only, exactly matching chunk-provenance-status's existing shape, per 172-CONTEXT.md decisions 5 and 8 and the plan's explicit prohibition"
  - "Command descriptions state read-only-ness explicitly with the established '(read-only)' phrasing, and the comment preceding the pair explains the deliberate contrast with chunk-check's repair-then-fail exit-non-zero convention"
  - "The exit-code test spawns four real child processes (not four in-process calls) — the only way to observe cli.ts's actual `process.exitCode = 1` behavior, since program.parseAsync() awaits actions but a raw function call would test a weaker contract"

patterns-established:
  - "cli-conformance-commands.test.ts is the template for any future CLI-surface proof: mkdtemp fixture, execFile(process.execPath, [bin/boardsmith.js, ...args]), read exit code from the rejection error's `code` property, assert no `at `-frame/`.ts:`-reference/repo-src-path ever reaches stderr"

requirements-completed: [CHECK-03, CHECK-05]

duration: ~20min
completed: 2026-07-28
---

# Phase 172 Plan 04: CLI registration and exit-code contract for trace-check/drift-check Summary

**Registered `boardsmith trace-check` and `boardsmith drift-check` on the CLI surface next to `chunk-provenance-status`, and pinned 172-CONTEXT.md decision 6 — findings exit 0, tool failure exits non-zero — with the first test in this repo that spawns the real `node bin/boardsmith.js` entry point as a child process instead of calling a command function in-process.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-28 (first tool call)
- **Completed:** 2026-07-28 (this summary)
- **Tasks:** 2 (both completed)
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- Imported `traceCheckCommand` (`./commands/trace-check.js`) and `driftCheckCommand` (`./commands/drift-check.js`) into `cli.ts` and registered both as `program.command()` entries immediately after `chunk-provenance-status`, matching its shape exactly: no positional argument, `--project <dir>` and `--json` only, descriptions using the established `(read-only)` phrasing.
- Added a comment naming CHECK-03/CHECK-05 and 172-CONTEXT.md decisions 5–6 ahead of the pair, explaining the deliberate contrast with `chunk-check` (which repairs then fails) — these two never write and never exit non-zero for a finding.
- Verified via `--help`: both commands appear on the CLI surface and list exactly `--project <dir>` and `--json`, no mode/repair flag.
- Created `src/cli/cli-conformance-commands.test.ts` — 4 tests, all spawning the real `node bin/boardsmith.js <cmd> --project <fixture> --json` entry point as a child process:
  1. `trace-check` against a fixture project with a live untested claim: exit 0, JSON parses, `findings.length > 0`, includes a `claim-untested` finding.
  2. `trace-check` against a directory with no `chunks/`: exit 1, single-line actionable stderr naming the directory and `--project`, no `at `-stack-frame, no `.ts:` reference, no repo `src/` path.
  3. `drift-check` against a real two-commit git fixture whose chunk's manifest file changed after its recorded verified hash: exit 0, JSON parses, includes a `chunk-code-drifted` finding.
  4. `drift-check` against a directory that is not a git repo: exit 1, same message-discipline assertions as case 2.
  All four fixture projects are confirmed byte-identical (whole-project SHA-256 over every file's relative path + bytes) before and after their spawned run.
- Ran `npm test`: 3503/3503 passed (baseline 3498 + this plan's 4 new tests + 1 unrelated test from the other agent's concurrent in-flight work on `stateless-ops.ts`, confirmed not touched by this plan).

## Task Commits

1. **Task 1: Register trace-check and drift-check in cli.ts**
   - `d4a7338e` (feat) — two imports, two `program.command()` registrations, precedent comment; `--help` smoke checks both passing
2. **Task 2: Pin the exit-code contract through the real CLI entry point**
   - `e970f2a8` (test) — `cli-conformance-commands.test.ts`, 4/4 spawned tests passing on first run (implementation from 172-02/172-03 required no changes)

## Files Created/Modified

- `src/cli/cli.ts` (+20 lines) — two new imports, two new `.command()` registrations, one precedent comment; nothing else in the file changed (the existing `parseAsync()` try/catch at the bottom needed no modification, exactly as the plan specified)
- `src/cli/cli-conformance-commands.test.ts` (220 lines, 4 tests, new) — real-child-process exit-code proof for both commands

## Decisions Made

- **No RED phase needed for Task 2 in the traditional TDD sense.** The plan marks Task 2 `tdd="true"`, but its only file is a proof test over already-fully-implemented behavior from 172-02/172-03 — there is no new production code for this test to drive into existence. All 4 spawned cases passed on the first run once the fixtures were built correctly, exactly mirroring how 172-02's/172-03's own unit-level tests already proved the underlying logic; this test's distinct job is proving the CLI-surface wiring and the real-process exit-code contract, which could not have passed before Task 1's registration landed.
- **Test fixtures deliberately minimal** — a single chunk with one untested claim for `trace-check`, a single chunk with one manifest file that changed after its recorded hash for `drift-check` — sufficient to prove `findings.length > 0` and the specific finding kind (`claim-untested`, `chunk-code-drifted`) without duplicating 172-02's/172-03's already-exhaustive fixture coverage. The real-data, high-volume proof is explicitly 172-05's job.
- **`REPO_ROOT` resolved via `fileURLToPath(import.meta.url)` + two `dirname` levels**, not `process.cwd()` — keeps the spawn's `bin/boardsmith.js` path correct regardless of vitest's invocation directory.

## Deviations from Plan

None — plan executed exactly as written. No architectural changes, no new dependencies, no mode/repair flag added. `cli.ts`'s existing top-level `parseAsync()`/catch block required no modification, as the plan predicted.

## Read-Only / Threat Model Verification

- T-172-05 (information disclosure via `cli.ts`'s top-level catch): pinned directly — both tool-failure test cases assert stderr contains no `at `-stack-frame, no `.ts:` line reference, and no absolute path into this repo's `src/`, while still naming the offending directory and the `--project` flag (actionable, per CLAUDE.md).
- T-172-09 (accept — `--project` pointing outside the user's project): unchanged this plan; both new registrations pass `--project` straight through to the already-implemented commands with no new restriction, consistent with the accepted disposition.
- T-172-SC (accept — package installs): zero new dependencies.
- Read-only invariant: both real-CLI-spawn tests hash their fixture project's full contents before and after the spawned run and assert byte-identical output.

## Issues Encountered

None. Both commands' underlying implementations (172-02, 172-03) needed no changes to satisfy this plan's contract — registration and the real-process exit-code test were the entirety of the work.

## User Setup Required

None — no external service configuration required. `git` must be present on the system (already an assumed dependency of `drift-check.ts` itself, per 172-03-SUMMARY.md).

## Next Phase Readiness

The CLI surface plan 172-05's real-game proof harness needs now exists and works:
- `node bin/boardsmith.js trace-check --project <copy-dir> --json` and
- `node bin/boardsmith.js drift-check --project <copy-dir> --json`

are both invokable, both read-only (proven by the byte-hash tests above, and by 172-02's/172-03's own unit-level byte-hash tests), and both honor the findings-exit-0/tool-failure-exits-non-zero contract end to end through a real process. 172-05 can proceed directly to running both commands against copies of `~/BoardSmithGames/seven` and `~/BoardSmithGames/one-two-punch` and recording real finding counts — no further CLI wiring is needed.

No blockers for 172-05 or for Phase 173's `/bs-verify-game`.

---
*Phase: 172-source-free-conformance-checks*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/cli/cli.ts (modified, contains `trace-check` and `drift-check`)
- FOUND: src/cli/cli-conformance-commands.test.ts
- FOUND commit: d4a7338e
- FOUND commit: e970f2a8
- `node bin/boardsmith.js trace-check --help` / `drift-check --help`: both list exactly `--project <dir>` and `--json`
- `npx vitest run src/cli/cli-conformance-commands.test.ts`: 4/4 passed
- `npm test` (full suite): 3503/3503 passed
