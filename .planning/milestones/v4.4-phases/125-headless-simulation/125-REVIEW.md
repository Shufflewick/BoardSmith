---
phase: 125-headless-simulation
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/cli/cli.ts
  - src/cli/commands/dev.ts
  - src/cli/commands/game-runtime.ts
  - src/cli/commands/simulate.test.ts
  - src/cli/commands/simulate.ts
  - src/runtime/runner.test.ts
  - src/session/headless-session.test.ts
  - src/session/headless-session.ts
  - src/session/index.ts
  - src/session/testing/eachplayer-clone.test.ts
  - src/session/testing/parity-contract.test.ts
  - src/session/testing/undo-authoritative.test.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: fixed
fixed_at: 2026-07-01T00:00:00Z
---

# Phase 125: Code Review Report

**Reviewed:** 2026-07-01
**Depth:** standard
**Files Reviewed:** 12
**Status:** fixed (all 6 findings resolved -- see resolution notes per finding below)

## Summary

The `createHeadlessSession` move to `src/session/headless-session.ts` (Plan 01) is clean: no dangling references to the deleted `testing/headless-harness.ts` path exist anywhere in `src/` (only a documentation comment in the new test file names the deleted path, as intended), all four migrated call sites (`runner.test.ts`, `eachplayer-clone.test.ts`, `parity-contract.test.ts`, `undo-authoritative.test.ts`) import correctly, the barrel export in `src/session/index.ts` is placed sensibly under a clear `Headless Simulation` banner, and the JSDoc `@example` matches the real return shape (`start()`/`send()`/`broadcasts`). No vitest imports leak into the public module.

The `simulate` CLI command (Plan 02) reuses `simulateRandomGames` as instructed, has correct `process.exitCode` (not `process.exit`) semantics on its success/failure path so stdout flushes before exit, and produces a stable, deterministically-ordered JSON shape. However, I found real gaps: `simulate.ts` never cleans up the `.boardsmith` temp directory it creates (unlike `dev.ts`, which does on shutdown), numeric CLI flags (`--games`, `--players`) are not validated and silently degrade to a vacuous "0/0 complete, exit 0" report on non-numeric input instead of failing loudly, the CLI's 3-state status fold drops the underlying failure reason for `timedOut`/`exceededMaxActions` games (leaving `status: 'error'` with no `error` string and a replay hint that doesn't explain why replay is needed), and `dev.ts` still carries a byte-for-byte duplicate of the `boardsmith` package→directory map that now also lives in `game-runtime.ts` (the extraction didn't fully eliminate duplicated loader logic, contrary to the plan's stated goal). None of these are correctness-breaking for the documented happy path, but they violate the project's "fail fast and loud, not silently" and "no duplicated logic" conventions (CLAUDE.md), so I'm filing them as warnings rather than blockers.

## Warnings

### WR-01: `simulate.ts` never cleans up its `.boardsmith` temp bundle directory

**File:** `src/cli/commands/simulate.ts:143-155`
**Issue:** `simulateCommand` creates `.boardsmith/` (if missing) and calls `loadGameDefinition`, which writes `simulate-entry.ts` and `simulate-bundle.mjs` into it (`src/cli/commands/game-runtime.ts:104,109`). Unlike `dev.ts`, which is long-running and removes its temp dir in the SIGINT/SIGTERM `cleanup()` handler (`dev.ts:618-629`), `simulate` is a one-shot command that exits immediately after printing its report — there is no code path that ever calls `rmSync` on `tempDir`. Every invocation of `boardsmith simulate` leaves stale `.boardsmith/simulate-entry.ts` / `.boardsmith/simulate-bundle.mjs` files behind, accumulating in the user's game project (and since these are esbuild-bundled snapshots of the rules, they can go stale/misleading if a developer inspects them later).
**Fix:**
```ts
// simulate.ts, after runSimulation() completes (success or failure)
try {
  rmSync(tempDir, { recursive: true, force: true });
} catch {
  // best-effort cleanup; do not fail the command over it
}
```
Import `rmSync` from `node:fs` and call it right before `process.exitCode = ...` (and also in the `catch` block around `loadGameDefinition`, mirroring `dev.ts`'s pattern).

**Resolution:** status: fixed — commit `80f1478`. `runSimulation`'s call is now wrapped in `try/finally` (best-effort `rmSync`, never masking the original error), and the `loadGameDefinition` catch block also cleans up before returning. Verified: go-fish `boardsmith simulate` smoke test leaves no `.boardsmith/` dir behind.

### WR-02: Non-numeric `--games`/`--players` silently produce a vacuous success report instead of an actionable error

**File:** `src/cli/commands/simulate.ts:157-162`
**Issue:** `options.games`/`options.players` are commander string options with no custom parser, so `Number(options.games)` on e.g. `--games abc` yields `NaN`. That `NaN` flows into `runSimulation` → `simulateRandomGames({ count: NaN, playerCounts: [NaN] })`. In `src/testing/random-simulation.ts:530-533`, `gamesPerPlayerCount = Math.ceil(NaN / 1) = NaN`, and the `for (let i = 0; i < NaN && ...)` loop body never executes (all comparisons against `NaN` are `false`). The result: `games: []`, `total: 0`, `report.anyFailed = false` (vacuous `.some()` on an empty array). `simulateCommand` then prints "0/0 complete, 0 stuck, 0 errored" and sets `process.exitCode = 0` — a silent success on invalid input, violating CLAUDE.md's "Fail fast and loud, not silently" and "Error messages should be actionable." A CI script that typos `--games` would see green, not a failure.
**Fix:**
```ts
const gamesCount = Number(options.games);
const playersCount = Number(options.players);
if (!Number.isInteger(gamesCount) || gamesCount < 1) {
  console.error(chalk.red(`Error: --games must be a positive integer, got "${options.games}"`));
  process.exitCode = 1;
  return;
}
if (!Number.isInteger(playersCount) || playersCount < 1) {
  console.error(chalk.red(`Error: --players must be a positive integer, got "${options.players}"`));
  process.exitCode = 1;
  return;
}
```

**Resolution:** status: fixed — commit `84c2c47`. Applied as suggested; validation runs before `context`/`tempDir` are created. Verified live: `boardsmith simulate --games abc --players 2` now exits 1 with `Error: --games must be a positive integer, got "abc"` and creates no `.boardsmith/` dir.

### WR-03: `status: 'error'` for timed-out / max-actions-exceeded games carries no error message, undermining the "actionable replay" contract

**File:** `src/cli/commands/simulate.ts:66-76`
**Issue:** `runSimulation` maps `SingleGameResult` to `{ status: g.completed ? 'complete' : g.stuck ? 'stuck' : 'error' }`. Per the plan's documented decision, `crashed`/`timedOut`/`exceededMaxActions` all fold into `'error'`. But `simulateSingleGame` (`src/testing/random-simulation.ts:355-365`) only sets `stuckReason`/`error` for the `stuck` and `crashed` branches — the `timedOut` and `exceededMaxActions` `break`s never populate `error`. So a game hitting the timeout gets `{ status: 'error', error: undefined }`. `printHumanReport` (`simulate.ts:110-116`) then prints `Game N error (seed X).` with no explanatory line, followed by a "Replay: boardsmith simulate --games 1 --seed X" hint — but replaying with the same seed against the same default timeout/maxActions will reproduce the exact same unexplained timeout, and the user has no idea from CLI output whether it was a crash, a stuck flow, or a timeout.
**Fix:** Either surface `timedOut`/`exceededMaxActions` as explicit fields on `PerGameReport` (cleaner, avoids information loss), or synthesize an `error` string in `runSimulation`'s mapper when one isn't present:
```ts
const status: GameStatus = g.completed ? 'complete' : g.stuck ? 'stuck' : 'error';
const error = g.error
  ?? (g.timedOut ? 'Game exceeded the simulation timeout.'
    : g.exceededMaxActions ? 'Game exceeded the maximum action count.'
    : undefined);
```

**Resolution:** status: fixed — commit `7dc8d7e`. Applied the synthesize-in-mapper option (keeps `--json` shape stable, no new field). Added a regression test (`simulate.test.ts`) pinning the `exceededMaxActions` message via a real `maxActions: 1` cutoff.

### WR-04: `dev.ts` still duplicates the `boardsmith` package→directory map extracted into `game-runtime.ts`

**File:** `src/cli/commands/dev.ts:430-439` (duplicates `src/cli/commands/game-runtime.ts:54-63`)
**Issue:** The Plan 02 summary states the goal of extracting shared helpers into `game-runtime.ts` to avoid divergence ("one loader family, no divergence"). `boardsmithResolvePlugin` in `game-runtime.ts` already contains the `packageDirs` map (`boardsmith` → `engine`, `boardsmith/ai` → `ai`, etc.) for esbuild resolution. `dev.ts`'s inline Vite plugin (`boardsmithVitePlugin`, used only in monorepo context) re-declares the identical map verbatim as `srcDirs` at lines 430-439. Any future package added to `packageDirs` (e.g. a new subpath export) must be remembered to be added in both places — the exact "loader logic duplication" risk the refactor was meant to close.
**Fix:** Export the map itself from `game-runtime.ts` (e.g. `export const BOARDSMITH_PACKAGE_DIRS: Record<string,string> = {...}`) and have both `boardsmithResolvePlugin` and `dev.ts`'s Vite plugin reference the single shared constant.

**Resolution:** status: fixed — commit `5a3ce1c`. Exported `BOARDSMITH_PACKAGE_DIRS` from `game-runtime.ts`; both `boardsmithResolvePlugin` and `dev.ts`'s monorepo-context Vite plugin now reference the single constant. No behavior change (values were byte-identical).

## Info

### IN-01: `simulateCommand`'s CLI wrapper (config loading, error paths, `--json` branch) has no test coverage

**File:** `src/cli/commands/simulate.test.ts`
**Issue:** All three tests exercise `runSimulation` directly with an in-memory game class — a good, fast unit-test strategy for the seeded-determinism core. But `simulateCommand` itself (the `boardsmith.json`/rules-path resolution, the `existsSync` guards, `process.exit(1)` paths, the `--json` vs human-table branch, and `process.exitCode` propagation) is only exercised by the manual go-fish smoke test noted in the summary, not by an automated test. Given WR-02 and WR-01 above are both in `simulateCommand`, not `runSimulation`, this is exactly the code that needed direct coverage.
**Fix:** Add a thin test that stubs/mocks `loadGameDefinition` (or points `paths.rules` at a fixture) and asserts `simulateCommand`'s exit-code and `--json` output shape end-to-end, plus a case for missing `boardsmith.json`.

**Resolution:** status: fixed — commit `745ea94`. Added two tests exercising `simulateCommand` directly against a real fixture project directory (temp dir with `boardsmith.json` + stub `src/rules/index.ts`), asserting `process.exitCode === 1` for invalid `--games`/`--players` (the WR-02 validation path, which returns via `process.exitCode` rather than `process.exit`, so it's safe to exercise in-process). The `process.exit(1)` paths (missing config/rules) and the `--json` success branch remain covered only by the manual go-fish smoke test — narrower scope than the review's suggested fix, but covers the code path that WR-01/WR-02 actually live in.

### IN-02: `cliMonorepoRoot` depth math in `game-runtime.ts` resolves to `<root>/src`, not `<root>`, making the monorepo-context `boardsmithResolvePlugin` branch resolve to a non-existent double-`src` path

**File:** `src/cli/commands/game-runtime.ts:31-34`
**Issue:** `cliMonorepoRoot = resolve(__dirname, '..', '..')`, where `__dirname` is `src/cli/commands` when run via `tsx`. That resolves to `<repo>/src` (two levels up from `commands`), not `<repo>` (three levels up). `boardsmithResolvePlugin`'s monorepo branch then does `join(cliMonorepoRoot, 'src', dirName, 'index.ts')` → `<repo>/src/src/engine/index.ts`, which does not exist (verified: `ls <repo>/src/src/engine/index.ts` → ENOENT). This is preserved, byte-identical behavior from the pre-refactor `dev.ts` (verified via `git show <pre-refactor-commit>:src/cli/commands/dev.ts`), so it is not introduced by this phase, and it is currently unreachable in practice (there is no `boardsmith.json` at the BoardSmith monorepo root, so `getProjectContext` never actually returns `'monorepo'` today) — hence Info rather than Warning. Flagging per the review's explicit focus on `cliMonorepoRoot`/`__dirname` depth correctness: if a future monorepo-context consumer is added, this path will silently fail to resolve `boardsmith` imports.
**Fix:** If the monorepo-context feature is still intended to be reachable, change to `resolve(__dirname, '..', '..', '..')` (three levels: `commands` → `cli` → `src` → repo root) and add a regression test/assertion that `existsSync(join(cliMonorepoRoot, 'src', 'engine', 'index.ts'))` when context is `'monorepo'`.

**Resolution:** status: fixed — commit `3a3ece5`. Applied the suggested three-level depth fix with a comment documenting that the monorepo-context branch is currently unreachable in practice (no `boardsmith.json` at the BoardSmith monorepo root today). No regression test was added (no automated way to flip `getProjectContext` to `'monorepo'` without an actual `src/engine/` + `boardsmith.json` at a synthetic monorepo root, which is out of proportion for a currently-unreachable path); the depth-math correctness itself is provably safe (verified `existsSync` of the corrected path manually) and confirmed via `npx tsc --noEmit` + the full test suite (1956/1956 passing) after the change.

---

_Reviewed: 2026-07-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
