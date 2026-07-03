# Phase 137: Testing Utilities - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 4 modified (test-game.ts, docs/api/testing.md, docs/agent-control.md) + N call-site migrations
**Analogs found:** 3 / 3 (all patterns exist in-repo; no external research needed)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/testing/test-game.ts` (`doAction` throw flip + `tryAction()`) | utility (test SDK method) | request-response | `src/testing/simulate-action.ts` `playUntilComplete`/`GameStuckError` (fail-loud precedent) + `src/testing/assertions.ts` `assertActionAvailable` (trace-building precedent) | exact (compose two existing patterns) |
| `src/testing/test-game.ts` (default seed + `testGame.seed` getter) | utility (test SDK method) | CRUD (construction) | `src/testing/simulate-action.ts` `playUntilComplete` seed doctrine (`options?.seed ?? 'playUntilComplete-default'`) | exact |
| Error class for `doAction` throw (`ActionExecutionError` or similar) | utility (error type) | n/a | `src/testing/simulate-action.ts` `GameStuckError` (lines 194-221) | exact — same shape: named class, structured fields, `Object.setPrototypeOf` |
| `src/testing/simulate-tutorial.ts:228` (doAction call site) | test-harness internal | request-response | migrate to `tryAction()` | n/a — call site fix |
| `src/testing/random-simulation.ts:402` (doAction call site) | test-harness internal | request-response | migrate to `tryAction()` | n/a — call site fix |
| `src/testing/simulate-action.ts:55` (`simulateAction` wrapper) | test-harness internal | request-response | migrate to `tryAction()` | n/a — call site fix |
| `src/testing/simulate-action.ts:383` (`playUntilComplete` internal) | test-harness internal | request-response | migrate to `tryAction()` | n/a — call site fix |
| `src/testing/action-builder.ts:92` (`ActionBuilder.execute()`) | test-harness internal | request-response | simplify — drop the manual `!result.success` throw, let `doAction` throw directly (or keep thin wrapper that adds ActionBuilder context) | n/a — call site fix |
| `src/testing/assertions.test.ts:325` (fixture setup call) | test | request-response | no change — action succeeds, throw-on-failure doesn't fire | n/a |
| New RED/GREEN test file(s) for TST-01/TST-02 | test | request-response | `src/testing/test-game.test.ts` fixture pattern (`FixtureGame`/`FixtureCard`, lines 1-80) | exact |

## Pattern Assignments

### `src/testing/test-game.ts` — `doAction` throw-on-failure + `tryAction()`

**Analog 1 (error class shape):** `src/testing/simulate-action.ts` lines 194-221 — `GameStuckError`

```typescript
export class GameStuckError extends Error {
  /** Always `'GameStuckError'` — safe for `error.name` switch/comparisons. */
  readonly name = 'GameStuckError' as const;
  readonly iteration: number;
  readonly availableActions: string[];
  readonly flowState: FlowState | undefined;

  constructor(
    message: string,
    iteration: number,
    availableActions: string[],
    flowState: FlowState | undefined,
  ) {
    super(message);
    this.iteration = iteration;
    this.availableActions = availableActions;
    this.flowState = flowState;
    // Required for correct instanceof checks when extending built-in classes in TS.
    Object.setPrototypeOf(this, GameStuckError.prototype);
  }
}
```
Mirror this shape for the new `doAction`-throw error class (e.g. `ActionExecutionError`): named class, `readonly name` literal, structured fields (`actionName`, `playerSeat`, `args`, the `ActionExecutionResult` it wraps, and/or the `debugActionAvailability` trace), `Object.setPrototypeOf` for `instanceof` safety.

**Analog 2 (rich trace to reuse):** `src/testing/assertions.ts` lines 207-242 — `assertActionAvailable`

```typescript
export function assertActionAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  if (!canSeatAct(flowState, playerSeat)) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} — seat is not active. ` +
      `currentPlayer=${flowState?.currentPlayer}, ` +
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}\n` +
      `Flow position: ${testGame.game.getFlowDebugInfo().describe()}`
    );
  }

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    const player = testGame.getPlayer(playerSeat);
    const debugInfo = testGame.game.debugActionAvailability(actionName, player);
    const selLines = debugInfo.details.selections
      .map(s =>
        `  ${s.passed ? '✓' : '✗'} '${s.name}': ${s.choices} choices${s.note ? ` — ${s.note}` : ''}`
      )
      .join('\n');
    throw new Error(
      `Action "${actionName}" is not available for player ${playerSeat}.\n` +
      `Available actions: [${availableActions.join(', ')}]\n` +
      `Why: ${debugInfo.reason}` +
      (selLines ? `\nSelections:\n${selLines}` : '') +
      `\nFlow position: ${testGame.game.getFlowDebugInfo().describe()}`
    );
  }
}
```
This is the "rich trace" the CONTEXT.md references — when `doAction` fails, call `this.game.debugActionAvailability(actionName, player)` (or fall back to a plain `ActionExecutionResult.error` string if the action name isn't even registered / seat can't act) and fold `debugInfo.reason` + the selection lines into the thrown error message, exactly as `assertActionAvailable` does on its failure path only (no perf cost on success).

**Current `doAction` (never throws) — the method being replaced:** `src/testing/test-game.ts` lines 272-278

```typescript
doAction(
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {}
): ActionExecutionResult {
  return this.runner.performAction(actionName, playerSeat, args);
}
```

**New shape:** `doAction` calls `this.runner.performAction(...)`, and on `!result.success` throws the new error class carrying the `debugActionAvailability`-style trace (built from the seat/action at time of failure) plus `result.error`/`result.errorCode`. Add a sibling `tryAction(playerSeat, actionName, args)` with the exact old signature/behavior (`return this.runner.performAction(...)` — never throws) for tests that intentionally exercise the failure path. `ActionBuilder.execute()` (see below) can then simplify to call `doAction` directly instead of duplicating a `!result.success` throw.

**Class-level example to update:** `src/testing/test-game.ts` lines 94-104 (currently ignores the `doAction` result, modeling the trap CONTEXT.md calls out):
```typescript
/**
 * @example
 * ```typescript
 * const testGame = TestGame.create(GoFishGame, {
 *   playerCount: 2,
 *   seed: 'deterministic',
 * });
 *
 * testGame.doAction(1, 'ask', { target: 2, rank: 'K' });
 * expect(testGame.isComplete()).toBe(false);
 * ```
 */
```
Fix: either drop the seed (now redundant with the new fixed default) or keep it and add a comment note that `doAction` now throws on failure — no `if (!result.success)` gate needed for the happy path.

---

### `src/testing/test-game.ts` — fixed default seed + `testGame.seed`

**Analog:** `src/testing/simulate-action.ts` lines 256-268, 311-315 — `playUntilComplete`'s seed doctrine (already the house style CONTEXT.md names as precedent)

```typescript
/**
 * Seed for the default move-selection rng (used when `strategy` is
 * `'random'` and `rng` is not supplied). Defaults to a fixed literal seed,
 * so calling `playUntilComplete(testGame)` with no options is deterministic
 * by default — two runs produce identical command history. Pass a
 * different `seed` to vary the play-through.
 */
seed?: string;
```
```typescript
// Deterministic by default: a fixed literal seed (unless the caller
// supplies its own `seed` or an escape-hatch `rng`) so no-options runs
// reproduce identical command history. NEVER falls back to Math.random.
const rng =
  options?.rng ?? createSeededRandom(options?.seed ?? 'playUntilComplete-default');
```

**Current TestGame seed (non-deterministic default) — being replaced:** `src/testing/test-game.ts` line 127
```typescript
const seed = options.seed ?? `test-${Date.now()}`;
```
Replace `` `test-${Date.now()}` `` with a fixed literal (e.g. `'test-seed'`, matching the `'playUntilComplete-default'` naming convention — Claude's discretion per CONTEXT.md). Then store the resolved seed on the instance (constructor already threads `runner`/`game`; add `readonly seed: string` set from the same `seed` local before constructing `GameRunner`) and expose it via `TestGame.seed`. Reference it in assertion-helper failure messages (`assertActionAvailable`, the new `doAction` throw, `GameStuckError` messages in `playUntilComplete`) alongside the existing `Flow position: ...describe()` line, so a failing test's output is one copy-paste away from a deterministic repro — same idea as `GameStuckError.flowState`/`availableActions` already surfacing repro context.

---

### Call-site migration: `src/testing/simulate-tutorial.ts` lines 227-235

**Current pattern (checks failure, throws own message) — category (b), migrate to `tryAction`:**
```typescript
const result = testGame.doAction(moveSeat, move.action, move.args ?? {});
if (!result.success) {
  const activeStep = getActiveStep(testGame.game, moveSeat);
  throw new Error(
    `Tutorial scenario: action '${move.action}' by seat ${moveSeat} on step '${activeStep?.id ?? 'unknown'}' failed. ` +
    `Error: ${result.error ?? 'unknown error'}`,
  );
}
```
This intentionally builds a tutorial-specific error message (with `activeStep.id`) richer than the generic `doAction` throw would produce. Migrate `testGame.doAction(...)` → `testGame.tryAction(...)` to preserve this custom handling; the generic throw would lose the tutorial step context.

### Call-site migration: `src/testing/random-simulation.ts` lines 401-414

**Current pattern (expects and handles failures as a normal branch) — category (b), migrate to `tryAction`:**
```typescript
const move = rng.pick(moves);
const result = testGame.doAction(actor.seat, move.name, move.args);

if (result.success) {
  actionCount++;
  consecutiveFailures = 0;
  continue;
}

// A move built from the engine's own choices was rejected. That is a real
// inconsistency between availability and validation -- surface it loudly
// rather than retrying forever.
consecutiveFailures++;
```
Failure is an expected, counted branch here (random simulation deliberately tries moves that may be rejected). Must migrate to `tryAction` — the throw-flip would break this loop's control flow on the very first rejected move.

### Call-site migration: `src/testing/simulate-action.ts` line 55 (`simulateAction`)

**Current pattern (returns the raw result to the caller for assertion) — category (b), migrate to `tryAction`:**
```typescript
export function simulateAction<G extends Game>(
  testGame: TestGame<G>,
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {}
): SimulateActionResult {
  const result = testGame.doAction(playerSeat, actionName, args);
  return { ...result, action: actionName, playerSeat, args };
}
```
`simulateAction` is the documented API for tests that check `result.success` themselves (docs/api/testing.md line 176: `expect(result.success).toBe(true)`; and `assertActionFails` builds on it for the *expected-failure* case). Must migrate `testGame.doAction` → `testGame.tryAction` here — this function's entire contract is "return the result, don't throw."

### Call-site migration: `src/testing/simulate-action.ts` line 383 (`playUntilComplete` internal loop)

**Current pattern (checks success, records failures, does NOT throw immediately) — category (b), migrate to `tryAction`:**
```typescript
const result = testGame.doAction(seat, move.action, move.args);
if (result.success) {
  anyMoveMade = true;
  movesExecuted = movesExecuted + 1;
} else {
  moveFailures.push(
    `seat ${seat}: action "${move.action}" failed — ${result.error ?? 'no error detail'}`
  );
}
```
`playUntilComplete` deliberately batches failures across all active seats in one iteration before deciding whether it's a genuine dead-end (see the `moveFailures.length > 0` branch at lines 404-417, which throws its own `GameStuckError` with all failures listed). Must migrate to `tryAction` to keep this batching intact — a throw-flip would only report the first seat's failure, losing the multi-seat diagnostic.

### Call-site migration: `src/testing/action-builder.ts` lines 91-98 (`ActionBuilder.execute()`)

**Current pattern (checks failure, throws own message) — category (c), can simplify:**
```typescript
execute(): void {
  const result = this._testGame.doAction(this._seat, this._actionName, this._args);
  if (!result.success) {
    throw new Error(
      `ActionBuilder.execute(): action '${this._actionName}' failed for seat ${this._seat}: ${result.error}`,
    );
  }
}
```
After the flip, `doAction` itself throws a message naming the action/seat plus the richer `debugActionAvailability` trace — a strict superset of what this hand-rolled throw provides. Simplify to:
```typescript
execute(): void {
  this._testGame.doAction(this._seat, this._actionName, this._args);
}
```
(Optionally catch-and-rewrap only if `ActionBuilder`-specific context, e.g. accumulated `_args`, needs to be appended — but the seat/action/error are already covered by the new default throw.)

### No-change call site: `src/testing/assertions.test.ts` line 325

```typescript
testGame.doAction(1, 'bid', {});
```
Category (a) — this is fixture setup where the action is expected to succeed (a valid `'bid'` action for seat 1 in `makeBidGame()`). After the throw-flip this remains correct with zero changes: if it ever silently failed before, it now surfaces as a loud test failure (the intended effect of TST-01).

---

### New RED/GREEN test file — fixture pattern to reuse

**Analog:** `src/testing/test-game.test.ts` lines 1-80 — `FixtureGame`/`FixtureCard`/`FixtureGame` minimal 2-player game

```typescript
import { describe, it, expect } from 'vitest';
import {
  Game, Player, Hand, Card, Action,
  defineFlow, loop, eachPlayer, actionStep,
  type GameOptions, type ElementJSON,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import type { PlayerStateView } from '../runtime/index.js';

class FixtureCard extends Card<FixtureGame> { rank!: string; }

class FixtureGame extends Game<FixtureGame, Player> {
  score = 0;
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([FixtureCard]);
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(FixtureCard, `card-p${player.seat}`, { rank: String(player.seat) });
    }
    this.registerAction(
      Action.create<FixtureGame>('pass').execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}
```
Reuse this exact fixture shape (or extend it with a second, always-illegal action name) for the TST-01 RED test ("doAction with an unavailable action/wrong seat must throw with a message naming the action and including the availability trace; tryAction returns `{success:false}` without throwing") and the TST-02 RED test ("two TestGames constructed without seeds produce identical shuffles; testGame.seed returns the seed" — use a game with a shuffled deck, e.g. add a `Deck`/`shuffle()` call in the constructor, to make the determinism observable).

**Insertion point:** append new `describe()` blocks to `src/testing/test-game.test.ts` (co-located with the class this behavior lives on) rather than a new file — matches existing file organization (one `*.test.ts` per source file in `src/testing/`).

## Shared Patterns

### Error-class shape for library-owned throw
**Source:** `src/testing/simulate-action.ts` lines 194-221 (`GameStuckError`)
**Apply to:** the new `doAction`-throw error class
- `extends Error`, `readonly name = '<ClassName>' as const`
- Structured `readonly` fields carrying diagnostic context (not just a message string)
- `Object.setPrototypeOf(this, <ClassName>.prototype)` in the constructor for `instanceof` safety when extending built-ins in TS

### Fail-loud-by-default / deterministic-by-default doctrine
**Source:** `src/testing/simulate-action.ts` lines 258-268, 279-289, 311-315
**Apply to:** `TestGame.doAction` (throw) and `TestGame.create` (fixed seed)
- No-argument call is deterministic and throws on the first real problem — matches CONTEXT.md's "TestGame's default behavior matches the library's own deterministic, fail-loud doctrine"
- Escape hatches (`tryAction()` for expected-failure tests, explicit `seed` for varied runs) are opt-in, not the default

### Rich actionable-error trace
**Source:** `src/testing/assertions.ts` lines 207-242 (`assertActionAvailable`), built on `game.debugActionAvailability()` (`src/engine/element/game.ts:1252`)
**Apply to:** the new `doAction` throw message
- Only computed on the failure path (no perf cost on success)
- Includes: action name, seat, available actions, `debugInfo.reason`, per-selection pass/fail + choice counts, `Flow position: ...describe()`
- Now also include `testGame.seed` per TST-02, so failures are one copy-paste from a deterministic repro

## No Analog Found

None — all required patterns (fail-loud error class, deterministic seed doctrine, rich trace, fixture test scaffold) already exist in `src/testing/`. This phase composes existing house patterns rather than introducing new ones.

## Metadata

**Analog search scope:** `src/testing/` (test-game.ts, simulate-action.ts, assertions.ts, action-builder.ts, random-simulation.ts, simulate-tutorial.ts, *.test.ts), `src/engine/element/game.ts` (`debugActionAvailability`), `src/runtime/runner.ts` (`ActionExecutionResult`), `docs/api/testing.md`, `docs/agent-control.md`
**Files scanned:** 11 (7 source, 1 engine, 1 runtime, 2 docs) + grep sweep of all `.doAction(` call sites across `src/`
**doAction call-site sweep (grep `\.doAction(` across src/, excluding JSDoc comments):**

| File:line | Classification | Action |
|-----------|----------------|--------|
| `src/testing/simulate-tutorial.ts:228` | (b) checks failure, custom message | migrate to `tryAction()` |
| `src/testing/random-simulation.ts:402` | (b) expects/handles failure as normal branch | migrate to `tryAction()` |
| `src/testing/simulate-action.ts:55` (`simulateAction`) | (b) returns result for caller to check | migrate to `tryAction()` |
| `src/testing/simulate-action.ts:383` (`playUntilComplete`) | (b) batches multi-seat failures | migrate to `tryAction()` |
| `src/testing/action-builder.ts:92` (`ActionBuilder.execute`) | (c) redundant with new default throw | simplify — drop manual check |
| `src/testing/assertions.test.ts:325` | (a) ignore result, action succeeds | no change |

JSDoc-only mentions (update as examples, not runtime code): `test-game.ts:101, 266, 451`, `debug.ts:380`, `docs/api/testing.md:100, 175-179, 404`, `docs/agent-control.md:47-48, 63-72, 165`.
**Pattern extraction date:** 2026-07-03
