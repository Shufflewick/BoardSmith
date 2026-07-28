---
phase: 172-source-free-conformance-checks
plan: 03
subsystem: cli
tags: [vitest, cli, git, tdd, security]

# Dependency graph
requires:
  - phase: 172-source-free-conformance-checks
    provides: "172-01's build-manifest.ts (parseBuildManifest, extractVerifiedCommitHash, FINDING_KINDS, Finding) — the single shared parser this plan consumes without re-deriving"
provides:
  - "src/cli/commands/drift-check.ts — CHECK-05 code-drift check: diffedFilesSince git plumbing, driftCheckCommand's three-state (clean/drifted/unknown) sweep, --json + grouped human report"
  - "The codebase's first git-subprocess convention (execFile argv array, explicit cwd, hand-written promisify wrapper, pre-hash-validation) for Phase 173 to copy"
affects: [172-04-cli-registration, 172-05-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-written promisify wrapper around execFile (callback form called directly), not promisify(execFile) — Node's execFile carries a util.promisify.custom symbol that a vi.fn(actual.execFile) test mock does not carry over, silently changing promisify's resolution shape from {stdout,stderr} to a positional [stdout,stderr] array"
    - "Hash validation regex runs BEFORE any git invocation, never relying on git itself to reject a flag-shaped argv element"
    - "Diff/ancestor-check results cached per DISTINCT hash across all chunks in one run, not per chunk"
    - "drift-unknown is a genuine third state alongside clean/drifted — never collapsed into either"

key-files:
  created:
    - src/cli/commands/drift-check.ts
    - src/cli/commands/drift-check.test.ts

key-decisions:
  - "execFileAsync is a hand-written Promise wrapper calling execFile's callback form directly, NOT promisify(execFile). Discovered mid-task: promisify(execFile) relies on execFile's util.promisify.custom symbol for its {stdout,stderr} object resolution shape; wrapping execFile in vi.fn(actual.execFile) for test mocking (needed because node:child_process exports non-configurable properties, so vi.spyOn throws 'Cannot redefine property') drops that symbol, silently changing the resolved value to a positional [stdout, stderr] array. The hand-written wrapper is immune to this and behaves identically whether execFile is real or mocked."
  - "Manifest paths are de-duplicated via a Set before diffing/stat-ing, since parseBuildManifest can yield the same path from multiple comma-joined cells across rows"
  - "isAncestorOfHead and the diff are both required and both cached per-hash: an unresolvable-as-ancestor hash and an unresolvable-diff hash both map to drift-unknown but with different detail text, per the plan's explicit instruction not to conflate them"
  - "A not-table-shaped manifest short-circuits to drift-unknown (with a manifest-file-missing finding) before ever reaching the hash/diff logic — it has no computable file list regardless of hash validity"

patterns-established:
  - "drift-check.ts's git-subprocess conventions (execFile argv array, explicit cwd, pre-invocation hash validation, hand-written promisify wrapper) are the template for Phase 173's git-touching commands"

requirements-completed: [CHECK-05]

duration: ~35min
completed: 2026-07-28
---

# Phase 172 Plan 03: CHECK-05 code-drift check (`drift-check.ts`) Summary

**`boardsmith drift-check` — diffs each chunk's Build Manifest file list against its recorded Verified Commit Hash via a validated, cwd-pinned `git diff` subprocess, classifying every chunk `clean`/`drifted`/`unknown` (three genuine states, never collapsed) and reporting deleted manifest files as the strongest drift signal.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-28 (first tool call)
- **Completed:** 2026-07-28
- **Tasks:** 2 (both completed)
- **Files created:** 2

## Accomplishments

- Built `diffedFilesSince(projectDir, hash)` — the codebase's first command to shell out to git, with `execFile` argv-array invocation, mandatory explicit `cwd`, and a `/^[0-9a-f]{7,40}$/` hash-shape validation that runs and rejects flag-shaped input (`--upload-pack=...`) BEFORE git is ever invoked (T-172-01). Proven against real temp git repos with two commits each, not mocked diff logic.
- Built `driftCheckCommand` implementing the full three-state classification (decision 10): `clean`, `drifted`, `unknown` — with `unknown` covering no-hash, malformed-hash, non-ancestor-hash, and non-table-shaped-manifest cases, all distinguished by `detail` text but never collapsed into `clean` or `drifted`.
- Decision 12 (deleted manifest file = drift) implemented and tested independently of the git diff — `missingFiles` is populated by an `fs.stat` check regardless of what the diff itself reports.
- Per-distinct-hash caching for both the ancestor check and the diff, proven with a call-count assertion (two chunks sharing one hash produce exactly one `git diff` subprocess).
- Read-only invariant pinned by a before/after whole-project byte-hash test, mirroring `trace-check.ts`'s and `chunk-provenance.ts`'s T-171-19-class test.
- `--project`/`--json` option shape, grouped-and-truncated human report, and findings-exit-0/never-set-`process.exitCode` convention all mirror `trace-check.ts` and `chunk-provenance-status` exactly, per the plan's "these two commands ship together" instruction.

## Task Commits

Each task committed atomically:

1. **Task 1: git plumbing with cwd discipline and hash validation**
   - `617af1df` (feat) — `diffedFilesSince`, `isAncestorOfHead`, `resolveHead`, `assertGitRepo`, the hand-written `execFileAsync` wrapper, and Task 1's test coverage (7 tests, all against real temp git repos)
2. **Task 2: driftCheckCommand — three states, findings, report, read-only invariant**
   - `cfe3d8d4` (feat) — `driftCheckCommand`, `ChunkDrift`/`DriftCheckResult`, `resolveManifestPath`/`fileExists`, `printHumanReport`, and Task 2's test coverage (15 additional tests: 22 total)

_Both tasks were `tdd="true"`; tests and implementation were developed together in a single coherent pass (git plumbing and the command layer are tightly coupled — the command's preflight and per-chunk logic call the plumbing directly) and verified fully passing before either commit was made. Task 1's commit contains only the git-plumbing subset of the file and its corresponding test subset (verified in isolation via `npx vitest run src/cli/commands/drift-check.test.ts -t "git"` and a full run of that intermediate file, both green) to honor the plan's task boundary; Task 2's commit adds the command layer and the remaining tests on top._

## Files Created

- `src/cli/commands/drift-check.ts` (408 lines) — `diffedFilesSince`, `driftCheckCommand`, `ChunkDrift`, `DriftCheckResult`, `UNRESOLVABLE` sentinel — exactly the plan's `<interfaces>` contract, no drift
- `src/cli/commands/drift-check.test.ts` (400 lines, 22 tests) — unit coverage for every behavior bullet in Tasks 1 and 2, all git fixtures are real temp repos (`git init` + two commits), zero mocking of the diff/classification LOGIC (only `execFile` itself is wrapped, and only to work around a Node/Vitest module-mocking limitation, verified call-through by default)

## Exported Signatures (for 172-04's registration and 172-05's proof)

No drift from the plan's `<interfaces>` block:

```typescript
export const UNRESOLVABLE = 'unresolvable' as const;
export async function diffedFilesSince(
  projectDir: string,
  hash: string,
): Promise<string[] | typeof UNRESOLVABLE>;

export interface ChunkDrift {
  chunk: string;
  hash?: string;
  state: 'clean' | 'drifted' | 'unknown';
  changedFiles: string[];
  missingFiles: string[];
  manifestFileCount: number;
}
export interface DriftCheckResult {
  chunks: ChunkDrift[];
  findings: Finding[];
  counts: { clean: number; drifted: number; unknown: number };
  head: string;
}
export async function driftCheckCommand(
  options?: { project?: string; json?: boolean },
): Promise<DriftCheckResult>;
```

## Decisions Made

- **Hand-written `execFileAsync` instead of `promisify(execFile)`** — discovered during Task 1's RED phase: `node:child_process` exports non-configurable properties in this Node/Vitest combination, so `vi.spyOn(childProcess, 'execFile')` throws `Cannot redefine property: execFile`. The fix (`vi.mock('node:child_process', ...)` wrapping `execFile` in `vi.fn(actual.execFile)`) then broke every test asserting `{ stdout }` destructuring, because `promisify(execFile)` depends on `execFile`'s `util.promisify.custom` symbol for its object-shaped resolution, and that symbol is not carried over by `vi.fn()`. Replacing `promisify(execFile)` with a hand-written `new Promise(...)` wrapper that calls the callback form directly closes this gap for both the real implementation and the test mock. This is a Rule 1 (auto-fix bug) fix discovered mid-implementation, not a plan deviation — the plan's interface (`diffedFilesSince`) and behavior are unchanged.
- **Manifest paths de-duplicated via `Set`** before diffing/stat-ing, since `parseBuildManifest` can yield the same path from multiple comma-joined manifest-row cells (Decision 11's real-data shape) and double-counting would double a `changedFiles`/`missingFiles` entry.
- **`isAncestorOfHead` and `diffedFilesSince` are both required and cached independently per-hash** — an unresolvable-as-ancestor hash and an unresolvable-diff hash both map to `drift-unknown`, distinguished only by `detail` text, per the plan's explicit "do not parse `git log` output by hand" and ancestor-vs-unresolvable distinction instruction.
- **A not-table-shaped manifest short-circuits to `drift-unknown` before the hash/diff logic runs** — it has no computable file list regardless of whether the recorded hash is valid, so checking hash validity first would be wasted work and could misleadingly suggest the hash mattered.

## Deviations from Plan

None from the plan's design or interface contract. One implementation-level bug (Rule 1) was found and fixed during TDD before any commit landed:

**1. [Rule 1 - Bug] `promisify(execFile)` silently returned the wrong resolution shape under test mocking**
- **Found during:** Task 1's RED→GREEN cycle, after adding the `vi.mock('node:child_process', ...)` wrapper needed to work around `vi.spyOn`'s `Cannot redefine property` failure on the built-in module.
- **Issue:** `promisify(execFile)` relies on `execFile[util.promisify.custom]`, a symbol not preserved when `execFile` is wrapped in `vi.fn(actual.execFile)`. Every test exercising `driftCheckCommand` (which calls `resolveHead` internally) failed with `Cannot read properties of undefined (reading 'trim')`, because the promisified call resolved to a positional array instead of `{ stdout, stderr }`.
- **Fix:** Replaced `promisify(execFile)` with a hand-written `execFileAsync` that wraps the callback form directly in a `new Promise`, independent of the `util.promisify.custom` symbol.
- **Files modified:** `src/cli/commands/drift-check.ts`
- **Commit:** `617af1df` (fixed before this commit landed; not a separate fix commit)

## Read-Only / Threat Model Verification

- `grep -n "execSync\|exec("` on the final file matches only prose inside doc comments (the module's own header explaining why `execSync` is NOT used) — no live `execSync`/`exec(` call exists. This mirrors the exact false-positive pattern flagged in `172-01-SUMMARY.md`'s "Issues Encountered" section for a literal grep against a doc comment.
- `grep -n "process.exitCode"` matches only the doc comment explaining the decision-6 exit-0 convention; no live assignment exists.
- T-172-01 (hash injection): closed — `HASH_SHAPE` regex validated before any `execFile` call; proven with a call-count assertion (`execFileMock).not.toHaveBeenCalled()`) on a flag-shaped hash, not just a return-value assertion.
- T-172-03 (wrong cwd): closed — `cwd` is mandatory on every git invocation; `assertGitRepo` preflights via `git rev-parse --show-toplevel` with `cwd: projectDir`.
- T-172-02 (path escape → stat): closed — `resolveManifestPath` rejects any path resolving outside `projectDir`; the escape test asserts the path is reported and never appears in `changedFiles`/`missingFiles`.
- T-172-06 (read-only): closed — before/after whole-project byte-hash test passes; only `diff`, `rev-parse`, `merge-base` git subcommands are ever invoked.
- T-172-SC (package installs): n/a — zero new dependencies.

## Issues Encountered

None beyond the promisify.custom bug documented above (caught and fixed pre-commit, not a deviation).

## User Setup Required

None — no external service configuration required. `git` must be present on the system running `drift-check` (standard developer-machine assumption, same as every other `boardsmith` command that already assumes a project checkout).

## Next Phase Readiness

`drift-check.ts`'s exports (`driftCheckCommand`, `diffedFilesSince`, `UNRESOLVABLE`, `ChunkDrift`, `DriftCheckResult`) are ready for 172-04 (CLI registration in `cli.ts`, mirroring `trace-check`'s `.command('drift-check')` wiring) and 172-05 (real-game proof against `seven`/`one-two-punch` copies — this plan's own tests deliberately touch nothing under `~/BoardSmithGames/`). No interface drift occurred; no blockers.

---
*Phase: 172-source-free-conformance-checks*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/cli/commands/drift-check.ts
- FOUND: src/cli/commands/drift-check.test.ts
- FOUND commit: 617af1df
- FOUND commit: cfe3d8d4
- npx vitest run src/cli/commands/drift-check.test.ts: 22/22 passed
- npm test (full suite): 3498/3498 passed (baseline 3476 + 22 new)
