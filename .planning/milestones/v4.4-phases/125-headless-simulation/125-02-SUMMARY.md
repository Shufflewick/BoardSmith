---
phase: 125-headless-simulation
plan: 02
subsystem: cli
tags: [headless-simulation, cli, determinism, testing]
dependency-graph:
  requires: [simulateRandomGames (src/testing/random-simulation.ts), dev.ts esbuild live-bundle loader pattern]
  provides: [boardsmith simulate CLI command, shared game-runtime.ts rules loader]
  affects: [src/cli/commands/dev.ts, src/cli/cli.ts, ~/BoardSmithGames/* (via symlinked CLI)]
tech-stack:
  added: []
  patterns: [shared rules-loader extraction (one loader family, no divergence), bare-gameClass reuse of simulateRandomGames, process.exitCode over process.exit for testability]
key-files:
  created:
    - src/cli/commands/game-runtime.ts
    - src/cli/commands/simulate.ts
    - src/cli/commands/simulate.test.ts
  modified:
    - src/cli/commands/dev.ts
    - src/cli/cli.ts
decisions:
  - "loadGameDefinition re-exports ONLY gameDefinition (no executeOp) — simulate drives games via createTestGame internally through simulateRandomGames, not the stateless executeOp path dev.ts uses"
  - "game-runtime.ts placed in the SAME directory as dev.ts (src/cli/commands/) to keep __dirname-based cliMonorepoRoot path-depth math identical across both files"
  - "Failure statuses (crashed/timedOut/exceededMaxActions) all fold into a single 'error' status in the CLI's 3-state enum per CONTEXT (complete/stuck/error)"
metrics:
  duration: "~40 minutes"
  completed: 2026-07-02
---

# Phase 125 Plan 02: Headless Simulation CLI Summary

Added the `boardsmith simulate` CLI command: seeded, headless batch play of a project's game with pass/stuck/error reporting, a human-readable table by default and `--json` for agents, and a non-zero exit code when any game fails — built by extracting `dev.ts`'s rules-loading logic into a new shared `game-runtime.ts` module and wiring the existing `simulateRandomGames` engine directly into a new `simulate.ts` command.

## What Was Built

- **`src/cli/commands/game-runtime.ts`** — new shared module (same directory as `dev.ts`, preserving `__dirname`-based `cliMonorepoRoot` path-depth math) exporting `getProjectContext`, `boardsmithResolvePlugin`, `toPosix`, `cliMonorepoRoot`, and a new `loadGameDefinition(rulesPath, tempDir, context)` — a rules-only esbuild live-bundle loader whose synthetic entry re-exports ONLY `gameDefinition` (no `executeOp`), since `simulateRandomGames` drives games via `createTestGame` internally.
- **`src/cli/commands/dev.ts`** — refactored to import the four shared helpers from `./game-runtime.js` instead of defining them locally; `loadGameRuntime` (dev's own executeOp-bundling loader) stays in `dev.ts`, now built on the shared `boardsmithResolvePlugin`/`toPosix`. Behavior verified unchanged via a live `boardsmith dev -p 5198` smoke against the symlinked `~/BoardSmithGames/go-fish` (HTTP 200 + "Ready" log), then killed and port confirmed free.
- **`src/cli/commands/simulate.ts`** — exports `runSimulation(gameClass, opts)` (testable core: calls `simulateRandomGames` with `playerCounts: [players]`, maps each `SingleGameResult` to `{index, seed, status, turns, winner, error?}` with `status = completed ? 'complete' : stuck ? 'stuck' : 'error'`) and `simulateCommand(options)` (the commander action: boardsmith.json check → rules path resolution → `loadGameDefinition` → `runSimulation` → human table or `--json` → `process.exitCode = anyFailed ? 1 : 0`). Failing games print `Game <index> <status> (seed <seed>).` plus a `Replay: boardsmith simulate --games 1 --seed <seed>` line.
- **`src/cli/cli.ts`** — registered `simulate` with `--games` (default '10'), `--seed`, `--players` (default '2'), `--json`, mirroring the dev command's option conventions.
- **`src/cli/commands/simulate.test.ts`** — 3 unit tests against `runSimulation` using an inline `PickGame` fixture (mirrors `random-simulation.test.ts`'s pattern, no esbuild/child-process): same-seed-twice deep-equal determinism, per-game shape/status-enum with sequential index, and the `anyFailed` boolean signal. Plus a real-game smoke: two `boardsmith simulate --games 3 --seed smoke --json` runs against the symlinked go-fish project produced byte-identical output and both exited 0.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx tsc --noEmit -p tsconfig.json` — zero errors attributable to `game-runtime.ts`, `dev.ts`, `simulate.ts`, or `cli.ts` (pre-existing unrelated test-file looseness errors elsewhere, untouched, per STATE.md known tech debt).
- `npx vitest run src/cli/commands/simulate.test.ts` — 3/3 passed.
- `npm test` (full suite) — 148 test files, 1953 tests, all green.
- Live `boardsmith dev -p 5198` smoke against go-fish — HTTP 200 + "Ready" log, killed cleanly, port 5198 confirmed free afterward.
- Real-game determinism smoke — two `boardsmith simulate --games 3 --seed smoke --json` runs against go-fish: `diff -q` clean, both exit 0.
- No dev server or background process left running at any point (confirmed via `lsof`/`ps` after each smoke).

## Self-Check: PASSED

- `src/cli/commands/game-runtime.ts` exists — FOUND
- `src/cli/commands/simulate.ts` exists — FOUND
- `src/cli/commands/simulate.test.ts` exists — FOUND
- `src/cli/commands/dev.ts` imports from `./game-runtime.js` and no longer defines `getProjectContext`/`boardsmithResolvePlugin`/`toPosix`/`cliMonorepoRoot` locally — CONFIRMED
- `src/cli/cli.ts` registers `simulate` with `simulateCommand` — CONFIRMED (`grep -q "simulateCommand" src/cli/cli.ts`)
- Commit `2f1badb` (Task 1: game-runtime.ts extraction + dev.ts refactor) — FOUND in `git log`
- Commit `b3deed4` (Task 2: simulate.ts + cli.ts registration) — FOUND in `git log`
- Commit `54a1c92` (Task 3: simulate.test.ts + go-fish smoke) — FOUND in `git log`
- `npx tsc --noEmit -p tsconfig.json` — no new errors introduced by this plan's files
- `npm test` — 148 test files, 1953 tests, all green
- Port 5198 free at end of session (confirmed via `lsof`)
