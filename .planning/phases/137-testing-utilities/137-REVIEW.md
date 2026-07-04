---
phase: 137-testing-utilities
reviewed: 2026-07-04T00:02:02Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - docs/agent-control.md
  - docs/api/testing.md
  - src/testing/action-builder.ts
  - src/testing/assertions.ts
  - src/testing/random-simulation.ts
  - src/testing/simulate-action.ts
  - src/testing/simulate-tutorial.ts
  - src/testing/test-game.test.ts
  - src/testing/test-game.ts
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: resolved
resolved_at: 2026-07-03T19:11:00Z
---

# Phase 137: Code Review Report

**Reviewed:** 2026-07-04T00:02:02Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed the Phase 137 testing-utilities changes: `doAction` throw-on-failure with `ActionExecutionError`, the `tryAction` escape hatch, the 4 migrated harness call sites, the fixed `'test-seed'` default, `testGame.seed` exposure, and the doc/JSDoc sweep.

The core implementation is sound. Adversarial traces that came back clean:

- **Throw path cannot mask the original failure.** `game.debugActionAvailability()` (`src/engine/element/game.ts:1252-1266`) returns a structured "does not exist" result for unregistered actions rather than throwing, and the entire rich-trace build in `doAction` (`src/testing/test-game.ts:378-395`) — including `getPlayer` (throws for out-of-range seats) and `getFlowDebugInfo().describe()` — happens inside a `try` whose `catch` falls back to the already-built plain message. The plain message and the rich message both carry `Seed:`. The original `result.error` is preserved in both branches and on the structured `ActionExecutionError.result` field.
- **`tryAction` never-throws claim holds in practice.** `GameRunner.performAction` (`src/runtime/runner.ts:155-233`) returns failure results for missing player / not-awaiting-input / not-your-turn, and wraps `continueFlow` in try/catch. `resolveArgs` (`src/engine/action/action.ts:153`) is defensive on unresolvable IDs.
- **All 4 migrated call sites preserve semantics exactly:** `simulateAction` (`simulate-action.ts:57`, documented return-don't-throw contract), `playUntilComplete` multi-seat batching (`simulate-action.ts:389` — a throw would have lost sibling-seat `moveFailures` diagnostics; batching + dead-end classification intact), `random-simulation` retry counter (`random-simulation.ts:404` — `consecutiveFailures` increment/reset logic unchanged), and `simulate-tutorial` (`simulate-tutorial.ts:230` — the tutorial-specific error naming the active step id replaces the generic throw).
- **Seed threading:** explicit `seed` respected (asserted at `test-game.test.ts:557-560`); `Seed:` appears in both `doAction` message branches, both `assertActionAvailable` throw sites, and all four `GameStuckError` sites in `playUntilComplete`. `TestGame.create` correctly threads the resolved seed through the private constructor.
- Targeted tests pass (47/47 across `test-game.test.ts` + `assertions.test.ts`).

The defects found are at the API-surface and documentation boundary — precisely the deliverables this phase claimed ("public API surface exported correctly", "docs examples updated"). Two are ship-blockers.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `ActionExecutionError` is not exported from the testing barrel

**File:** `src/testing/index.ts:36-40` (omission); class at `src/testing/test-game.ts:94`
**Issue:** `doAction` now throws `ActionExecutionError`, and the docs actively advertise the class by name (`docs/api/testing.md:25`, `docs/agent-control.md:46,62-63`). But the class is not exported from `src/testing/index.ts` (nor anywhere else — repo-wide grep finds zero export sites). External game projects importing from `'boardsmith/testing'` cannot write `catch (err) { if (err instanceof ActionExecutionError) ... }`, cannot type the error, and cannot access its documented structured fields (`actionName`, `playerSeat`, `args`, `result`) without unsafe casts. The class even carries a `readonly name` specifically "safe for `error.name` switch/comparisons" — a workaround consumers are forced into only because the type itself is unreachable. `GameStuckError` (the analogous error from `playUntilComplete`) IS exported at `index.ts:50`, confirming the intended pattern.
**Fix:**
```typescript
// src/testing/index.ts
export {
  TestGame,
  createTestGame,
  ActionExecutionError,
  type TestGameOptions,
} from './test-game.js';
```
Also add `ActionExecutionError` to the exports list in `docs/api/testing.md` (it appears in prose at line 25 but not in the Exports/Types sections).

**Resolution:** status: fixed (commit `afd55be2`) — `ActionExecutionError` exported from `src/testing/index.ts` alongside `TestGame`/`createTestGame`, and added as an explicit bullet in the `docs/api/testing.md` Exports section (fields `actionName`/`playerSeat`/`args`/`result` named).

### CR-02: `docs/agent-control.md` Determinism section still documents the OLD `test-${Date.now()}` default seed — the exact contract this phase removed

**File:** `docs/agent-control.md:334-338`
**Issue:** The "Determinism & Seeding" section states:

> If you don't supply a seed, `TestGame.create` generates one (`` `test-${Date.now()}` ``) — fine for one-off tests, but not reproducible across runs. **Always pass an explicit `seed` when you need a reproducible agent run**

This is the pre-137 contract, verbatim. The shipped behavior is the opposite: the default is the fixed literal `'test-seed'` (`src/testing/test-game.ts:181`), seedless runs ARE reproducible across runs, and the phase's own test (`test-game.test.ts:554`) asserts the seed is NOT `Date.now()`-derived. The phase diff updated this file's `doAction` sections but missed this section entirely. This is agent-facing guidance in the primary agent-control doc, and it misleads in both directions: agents will add unnecessary explicit seeds for repro, and — worse — agents/games relying on seedless runs to vary between CI runs (fuzz-style coverage) will silently get the identical game every time, which the doc tells them cannot happen. The doc-sweep was an explicit deliverable of this phase.
**Fix:** Rewrite lines 334-338 to match the shipped contract, e.g.:
```markdown
If you don't supply a seed, `TestGame.create` uses the fixed literal
`'test-seed'` — two seedless runs are identical (deterministic by default;
never `Date.now()`/`Math.random`). Pass an explicit `seed` when you want a
*different* deterministic run. The resolved seed is exposed as
`testGame.seed` and included in failure messages.
```

**Resolution:** status: fixed (commit `7a8ad212`) — Determinism & Seeding section rewritten to the shipped contract: fixed literal `'test-seed'` default, seedless runs identical across runs, explicit `seed` for a *different* deterministic run, `testGame.seed` exposure + seed-in-failure-messages noted.

## Warnings

### WR-01: `docs/api/testing.md` random-simulation example uses option/result fields that do not exist

**File:** `docs/api/testing.md:259-272`
**Issue:** The example calls `simulateRandomGames(MyGame, { playerCount: 2, gameCount: 100, maxActions: 1000 })` and reads `results.winRates`. The real API (`src/testing/random-simulation.ts:31-49, 100-123`) is `count` (not `gameCount`), `playerCounts: number[]` (not `playerCount: number`), and `SimulationResults` has no `winRates` field. `playerCounts` is a **required** option, so copy-pasting this example fails to compile. This file was edited by this phase (doc sweep in scope) but the broken example was left in place — it also contradicts the correct usage shown in `random-simulation.ts`'s own JSDoc at line 503.
**Fix:**
```typescript
const results = await simulateRandomGames(MyGame, {
  count: 100,
  playerCounts: [2],
  maxActions: 1000,
});
expect(results.completed).toBe(100);
expect(results.stuck).toBe(0);
console.log(`Average game length: ${results.averageActions} actions`);
```

**Resolution:** status: fixed (commit `d0759965`) — example rewritten to the real API (`count: 100`, `playerCounts: [2]`); nonexistent `results.winRates` line removed. All remaining fields (`completed`, `stuck`, `errors`, `averageActions`) verified against `SimulationResults`.

### WR-02: `diffSnapshots` JSDoc example calls `doAction(0, ...)` — invalid seat that now throws under the new contract

**File:** `src/testing/debug.ts:380`
**Issue:** The example reads `testGame.doAction(0, 'move', { destination: cell });`. Seats are 1-indexed throughout `boardsmith/testing` (`docs/api/testing.md:100`). Under the old contract this example silently returned a failure result and the diff printed "No changes detected"; under the new contract seat 0 has no player, so `doAction` is now **guaranteed to throw** `ActionExecutionError` before the `after` snapshot line ever runs. The grep-style sweep for docs modeling the old contract missed this one.
**Fix:** Change to `testGame.doAction(1, 'move', { destination: cell });`

**Resolution:** status: fixed (commit `acf7b502`) — JSDoc example now uses seat 1.

### WR-03: `simulateTutorial`'s `seed` option is dead — JSDoc claims it "is recorded in the return value", but `SimulateTutorialResult` has no seed field

**File:** `src/testing/simulate-tutorial.ts:76-78` (claim), `89-112` (result type), `163-274` (implementation)
**Issue:** `SimulateTutorialOptions.seed`'s JSDoc says: "The `seed` option here is informational — it is recorded in the return value for traceability". The return type is `{ completed, finalStepId, stepsVisited }` — no seed field — and the function body never reads `options.seed` at all (only `seat` and `scenario` are destructured at line 168). The documented traceability behavior does not exist; the option is entirely inert. Given this phase's headline deliverable is seed traceability (`testGame.seed`, seed-in-messages), an inert seed option with a false JSDoc claim is exactly the wrong-path trap the phase set out to remove.
**Fix:** Either (a) delete the `seed` option and point callers at `testGame.seed` (per the No Backward Compatibility rule, and since `TestGame` now always has a resolved seed), or (b) actually record it: add `seed: string` to `SimulateTutorialResult` populated from `options.seed ?? testGame.seed`. Option (a) is cleaner — the precedence caveat paragraph becomes unnecessary too.

**Resolution:** status: fixed (commit `44539a6e`) — wired honestly (variant of option b, chosen because external games — checkers/go-fish tutorial tests and `docs/teaching-and-tutorials.md` — already pass `seed` at both levels): `SimulateTutorialResult.seed` now records the *effective* governing seed (`testGame.seed`, never the inert option), and `options.seed` became a fail-loud declared expectation — if it differs from `testGame.seed`, `simulateTutorial` throws immediately with an actionable message instead of silently running under a different seed. JSDoc rewritten in both places. Red-first: 2 new tests in `simulate-tutorial.test.ts` (result-seed traceability + mismatch throw), red confirmed pre-fix, green post-fix. Existing same-seed-both-levels usages keep passing unchanged.

### WR-04: `GameStuckError` messages report only the game seed — a run with a custom `playUntilComplete` seed/rng is NOT reproducible from the reported `Seed:` line

**File:** `src/testing/simulate-action.ts:369, 419, 432, 459`
**Issue:** All four `GameStuckError` sites append `Seed: ${testGame.seed}` — the game construction seed only. But a `playUntilComplete` run with `strategy: 'random'` is determined by **two** seeds: the game seed and the move-selection seed (`options.seed ?? 'playUntilComplete-default'`, line 317). When the caller passed no options, the fixed default makes the game seed sufficient — fine. But when the caller passed `{ seed: 'my-scenario-seed' }` or a custom `rng`, the failure message's "Seed:" line is incomplete for the docs' "one copy-paste from a deterministic repro" claim (`docs/api/testing.md:64`): replaying with only the reported seed follows a different move sequence and may not reproduce the stuck state at all. This half-reported seed is actively misleading in exactly the debugging scenario the feature exists for.
**Fix:** Report both seeds when a move-selection seed is in play, e.g.:
```typescript
const playSeedNote = options?.rng
  ? 'custom rng (not seed-reproducible)'
  : (options?.seed ?? 'playUntilComplete-default');
// ...in each message:
`Seed: ${testGame.seed} (playUntilComplete seed: ${playSeedNote})`
```

**Resolution:** status: fixed (commit `e549e5d6`) — a single `seedLine` (game seed + `playUntilComplete seed:` note) computed once next to the rng and used at all four `GameStuckError` sites; custom `rng` flagged as `custom rng (not seed-reproducible)`. Red-first: 2 new tests in `play-until-complete.test.ts` (custom-seed run reports both seeds; custom-rng run reports the flag), red confirmed pre-fix, green post-fix.

## Info

### IN-01: `docs/api/testing.md` types section omits the `seed` option on `PlayUntilCompleteOptions`

**File:** `docs/api/testing.md:66`
**Issue:** Lists `PlayUntilCompleteOptions` as "(`maxMoves`, `strategy`, `rng`)" but the type also has `seed` (`simulate-action.ts:270`) — the option this phase's determinism work leans on.
**Fix:** Update to "(`maxMoves`, `strategy`, `rng`, `seed`)".

### IN-02: `ActionExecutionError` stack header reads `Error:` not `ActionExecutionError:` (class-field `name` set after `super()`)

**File:** `src/testing/test-game.ts:96`
**Issue:** `readonly name = 'ActionExecutionError' as const` as a class field initializes after `super(message)`, and V8 captures the stack header at construction — so `err.stack` begins `Error: Action '...' failed...` while `err.name` is correct. Vitest failure output shows the stack header, slightly obscuring the error type. Same pre-existing pattern in `GameStuckError` (`simulate-action.ts:198`), so this is consistent house style; noting for completeness only.
**Fix:** If desired, set `this.name = 'ActionExecutionError'` inside the constructor before any stack use is irrelevant in V8 either way — the practical fix is `Error.captureStackTrace?.(this, ActionExecutionError)` after setting name, or accept the current behavior.

### IN-03: `TestGameOptions.seed` JSDoc still says "Random seed"

**File:** `src/testing/test-game.ts:32-33`
**Issue:** `/** Random seed for deterministic tests */` — "Random" is stale wording now that the default is a fixed literal and the field's whole story (default `'test-seed'`, exposed via `testGame.seed`) is documented elsewhere. The option's own doc is the first thing IDE hover shows.
**Fix:** `/** Seed for deterministic runs. Defaults to the fixed literal 'test-seed'; exposed as testGame.seed. */`

---

_Reviewed: 2026-07-04T00:02:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
