# Phase 118: Test Ergonomics — Research

**Researched:** 2026-06-30
**Domain:** BoardSmith testing module (`src/testing/`) + engine primitives from Phase 117
**Confidence:** HIGH — all findings verified by direct `src/` inspection with file:line evidence

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All surface decisions are **locked** in the approved design doc (Part 2 TEST section, `.planning/v4.3-API-DESIGN.md`). Build to it exactly. Per-surface dispositions:

- **TEST-01** — EXPOSE/DOCUMENT `testGame.getPlayerView(seat)` (`src/testing/test-game.ts:243`) plus a thin typed accessor. Reuse Phase 117 perspective view; do not build a parallel filter.
- **TEST-02** — BUILD `playUntilComplete(testGame, options?)` in `src/testing/`. Must drive moves via Phase 117 `enumerateLegalMoves`. Throws `GameStuckError` (with `iteration`, `availableActions`, `flowState`, actionable message). Default: `maxMoves=1000`, `strategy='random'`, `rng=Math.random`.
- **TEST-03** — BUILD: wire `game.debugActionAvailability()` (`game.ts:1072`) into `assertActionAvailable` (`assertions.ts:180`). Signature unchanged — behavior change only. Per D-05: use `debugActionAvailability()`, NOT `traceAction()` from debug.ts.
- **TEST-04** — BUILD: extend `assertFlowState` (`assertions.ts:64`) with `actionsMode?: 'exact' | 'contains'`. Per D-06, default is `'exact'` (backward compatible); `'contains'` must be opted into.
- **TEST-05** — BUILD `ActionBuilder` class in `src/testing/action-builder.ts` using `game.getSelectionChoices()` for in-process choice resolution. No session/server primitives.

### Claude's Discretion
- Exact internal structure of the typed observable accessor (TEST-01) and the ActionBuilder fluent API shape, as long as the locked names/signatures hold and the design doc's return shapes are honored.
- `GameStuckError` message wording (must be actionable per CLAUDE.md).
- Test structure; new test files per TEST requirement; integration test per cross-layer boundary (CLAUDE.md).
- Wave/plan decomposition (planner's call).

### Deferred Ideas (OUT OF SCOPE)
- First-class hidden-info leak assertion `assertNoLeakFrom` (TEST-F1).
- Devtools/browser driving (Phase 119); authoring guards (Phase 120); migration (Phase 121); docs (Phase 122).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | A test author can read observable game state through a typed API without parsing snapshot JSON or knowing per-game accessor methods. | `testGame.getPlayerView(seat): PlayerStateView` already exists at `src/testing/test-game.ts:243`; needs documentation and a thin ergonomic layer. |
| TEST-02 | A test author can play a game to completion with one call that guards against infinite/stuck loops and throws a structured, actionable diagnostic instead of hanging. | `enumerateLegalMoves(game, seat)` from Phase 117 is the move-picker primitive; `testGame.isComplete()` detects completion; stuck = empty moves and not complete. |
| TEST-03 | When an availability/action assertion fails, the failure message automatically includes a trace explaining why the action is unavailable. | `game.debugActionAvailability(actionName, player): ActionDebugInfo` at `src/engine/element/game.ts:1200` already returns the trace; `assertActionAvailable` just needs to call it on failure. |
| TEST-04 | Action-list assertions support both permissive ("contains these") and exact ("only these") modes, chosen explicitly rather than exact-by-default. | `assertFlowState` extra-actions check at `assertions.ts:103-106` is the single block to guard behind `actionsMode !== 'contains'`. |
| TEST-05 | A test author can drive multi-step / dependent selections through an ergonomic builder rather than low-level calls. | `game.getSelectionChoices(actionName, selectionName, player, args): AnnotatedChoice[]` at `src/engine/element/game.ts:978` provides in-process choice resolution for the builder. |
</phase_requirements>

---

## Summary

Phase 118 is a pure ergonomics layer over existing engine primitives — nothing is built from scratch. All five TEST requirements have a corresponding primitive that already exists in the engine; the work is wiring, extending, and exposing. Phase 117 (shipped) provides the three critical new primitives this phase depends on: `enumerateLegalMoves`, `getActionSpace`/`getActionSchema`, and documented `getPlayerView`. The surface footprint is confined to `src/testing/` (four files: `assertions.ts`, `simulate-action.ts`, a new `action-builder.ts`, and `index.ts` barrel additions), with no engine changes required.

The highest-risk item is TEST-02's `playUntilComplete` — it must handle simultaneous-action games (where `flowState.awaitingPlayers` is set instead of `flowState.currentPlayer`) without hanging. TEST-03's trace wiring requires calling `testGame.getPlayer(seat)` before passing to `debugActionAvailability`; the existing `assertActionAvailable` does NOT call `getPlayer` today, so the Player object must be resolved in the failure branch. TEST-05's `ActionBuilder` is straightforward but needs a careful mapping of `AnnotatedChoice.disabled` filtering to only surface enabled choices via `getChoices()`.

**Primary recommendation:** Implement in four tasks: (1) TEST-01 documentation + thin accessor on TestGame, (2) TEST-02 `playUntilComplete` + `GameStuckError` in `simulate-action.ts`, (3) TEST-03 + TEST-04 extensions to `assertions.ts` (small and co-located), (4) TEST-05 `ActionBuilder` + barrel exports.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Observable state access (TEST-01) | Testing | Engine (read-only) | `getPlayerView` delegates to `runner.getPlayerView` which calls `createPlayerView` — the testing tier is a thin wrapper |
| Drive game to completion (TEST-02) | Testing | Engine (read-only) | `enumerateLegalMoves` and `isComplete` are engine reads; execution via `testGame.doAction` |
| Availability trace (TEST-03) | Testing | Engine (read-only) | `debugActionAvailability` is on the engine `Game` class; assertion wires it in |
| Action-list assertion mode (TEST-04) | Testing | — | Internal logic change in `assertions.ts`; no engine involvement |
| Multi-step builder (TEST-05) | Testing | Engine (read-only) | `getSelectionChoices` is on `Game`; builder is testing-layer only |

---

## Standard Stack

No new dependencies. All implementation uses:

| Module | Version | Role |
|--------|---------|------|
| `src/testing/` | (this repo) | Owning module for all five deliverables |
| `src/engine/utils/enumerate-moves.ts` | Phase 117, shipped | `enumerateLegalMoves` — move enumeration for TEST-02 |
| `src/engine/element/game.ts` | existing | `debugActionAvailability` (TEST-03), `getSelectionChoices` (TEST-05), `getFlowState`, `getPlayer` |
| `src/engine/action/types.ts` | existing | `ActionDebugInfo`, `PickDebugInfo` types consumed in TEST-03 error message |

**Installation:** none — zero new packages.

---

## Package Legitimacy Audit

Not applicable — this phase installs no external packages.

---

## Architecture Patterns

### Recommended Project Structure (testing module after Phase 118)

```
src/testing/
├── test-game.ts              # TestGame class — gains action() convenience factory (TEST-05)
├── assertions.ts             # assertFlowState + assertActionAvailable — extended (TEST-03, TEST-04)
├── simulate-action.ts        # simulateAction, simulateActions, assertActionSucceeds/Fails
│                             #   + playUntilComplete + GameStuckError (TEST-02)
├── action-builder.ts         # ActionBuilder class — NEW (TEST-05)
├── debug.ts                  # traceAction (stale — do not modify; kept for backward compat)
├── random-simulation.ts      # existing, unchanged
├── simulate-tutorial.ts      # existing, unchanged
├── tutorial-assertions.ts    # existing, unchanged
└── index.ts                  # barrel — add GameStuckError, playUntilComplete, ActionBuilder
```

### System Architecture Diagram

```
Test Author
    │
    ▼
TestGame (src/testing/test-game.ts)
    │
    ├─[TEST-01]── getPlayerView(seat) ──► GameRunner.getPlayerView ──► createPlayerView(game, pos)
    │                                                                         │
    │                                                                    PlayerStateView
    │
    ├─[TEST-02]── playUntilComplete(testGame, opts) ──► enumerateLegalMoves(game, seat)
    │                │                                          │
    │                │                              flowState.currentPlayer / awaitingPlayers
    │                │                                          │
    │                └─ pick move ──► testGame.doAction(seat, action, args)
    │                │
    │                └─ stuck? ──► throw GameStuckError { iteration, availableActions, flowState }
    │
    ├─[TEST-03]── assertActionAvailable(testGame, seat, name) ──► flowState check
    │                │ (on failure)
    │                └────────────► game.debugActionAvailability(name, player): ActionDebugInfo
    │                                   └─► formatted into Error message
    │
    ├─[TEST-04]── assertFlowState(testGame, { actions, actionsMode:'contains'|'exact' })
    │                └─ 'exact' (default): check missing AND extra actions
    │                   'contains': check missing actions only
    │
    └─[TEST-05]── new ActionBuilder(testGame, actionName, seat)
                     │
                     ├─ .getChoices(selectionName) ──► game.getSelectionChoices(...)
                     │                                      └─ AnnotatedChoice[] (filter disabled)
                     ├─ .select(selectionName, value)  → stores in internal args
                     ├─ .execute()                     → testGame.doAction(seat, actionName, args)
                     └─ .buildArgs()                   → returns args Record
```

---

## TEST-01: Typed Observable State — Full Detail

### Current state (`src/testing/test-game.ts:243`)

```typescript
// VERIFIED: src/testing/test-game.ts:243
getPlayerView(playerSeat: number) {
  return this.runner.getPlayerView(playerSeat);
}
```

Return type is `PlayerStateView` (inferred — the explicit annotation is on `runner.getPlayerView`). The `PlayerStateView` interface (confirmed at `src/engine/utils/snapshot.ts:97`):

```typescript
interface PlayerStateView {
  player: number;
  state: ElementJSON;            // hidden elements obscured — NOT typed domain model
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
  };
  messages: Array<{ text: string; data?: Record<string, unknown> }>;
  phase: string;
  complete: boolean;
  winners?: number[];
  actionMetadata?: Record<string, unknown>;
  tutorial?: TutorialStepView;
  disabledActions?: Record<string, string>;
}
```

### Gap: `.state` is untyped `ElementJSON`

The `state` field reflects the element tree as JSON. Per-game custom properties on `Game` subclasses (e.g., `game.score`) are accessible via `testGame.game.score` (typed, direct). The correct pattern for per-game typed access is `testGame.game` (which is typed as `G` — the game class).

### Implementation: thin typed accessor (Claude's discretion)

The design doc says to add a "thin typed accessor" so a test author reads observable state without parsing JSON. The minimal correct implementation is:

```typescript
// src/testing/test-game.ts — add convenience method
/**
 * Get the current game instance with full typing.
 * Use this for per-game custom properties.
 *
 * @example
 * // Typed access to game-specific properties:
 * const score = testGame.game.score;      // typed as G
 *
 * // Perspective-correct hidden-info view:
 * const view = testGame.getPlayerView(1); // PlayerStateView
 * const isComplete = view.complete;
 */
// No new method needed — `testGame.game` is already `G` (typed).
// The deliverable for TEST-01 is documentation + explicit return type annotation on getPlayerView.
```

Concretely: add an explicit `: PlayerStateView` return type annotation to `getPlayerView` so IDEs surface it, and add JSDoc showing both `testGame.game.customProp` and `testGame.getPlayerView(seat).flowState` patterns.

---

## TEST-02: `playUntilComplete` + `GameStuckError` — Full Detail

### Target file: `src/testing/simulate-action.ts`

The design doc says "simulate-action.ts or test-game.ts". `simulate-action.ts` is the better home — it already hosts simulation helpers (`simulateAction`, `simulateActions`, `assertActionSucceeds`), and `playUntilComplete` is conceptually a higher-level simulation helper, not a class method on TestGame.

### Phase 117 primitive: `enumerateLegalMoves` (confirmed)

```typescript
// VERIFIED: src/engine/utils/enumerate-moves.ts:34
export function enumerateLegalMoves(
  game: Game,
  seat: number,
  options?: { maxPerAction?: number },
): Array<{ action: string; args: Record<string, unknown> }>
```

Exported from `src/engine/index.ts:209`. Returns in-process element objects (not wire IDs). Returns `[]` when `game.getFlowState()` returns falsy.

### Detecting "complete"

```typescript
// VERIFIED: src/runtime/runner.ts:295
isComplete(): boolean {
  return this.game.getFlowState()?.complete ?? false;
}
// TestGame delegates: testGame.isComplete() → this.runner.isComplete()
```

### Detecting "stuck" (key insight for simultaneous-action games)

`FlowState.currentPlayer` is set for sequential turns (one active seat). `FlowState.awaitingPlayers` is set for simultaneous turns (multiple seats active at once). `playUntilComplete` must handle both:

```typescript
// FlowState shape (VERIFIED: src/engine/flow/types.ts:240)
interface FlowState {
  complete: boolean;
  awaitingInput: boolean;
  currentPlayer?: number;           // sequential: one seat active
  awaitingPlayers?: PlayerAwaitingState[];  // simultaneous: multiple seats
}
interface PlayerAwaitingState {
  playerIndex: number;   // 1-indexed seat
  availableActions: string[];
  completed: boolean;
}
```

**Stuck detection algorithm:**
1. Get `flowState = testGame.getFlowState()`
2. If `flowState?.complete` → done (game finished, exit loop)
3. Determine active seats:
   - Sequential: `[flowState.currentPlayer]` if defined
   - Simultaneous: `flowState.awaitingPlayers?.filter(p => !p.completed).map(p => p.playerIndex)` if defined
   - Neither: game is not awaiting input → increment moves, continue (some flow nodes auto-advance)
4. For each active seat, call `enumerateLegalMoves(testGame.game, seat)`
5. If ALL active seats have zero legal moves AND game is not complete → throw `GameStuckError`

### `GameStuckError` shape

```typescript
// src/testing/simulate-action.ts — new class
class GameStuckError extends Error {
  readonly name = 'GameStuckError' as const;
  readonly iteration: number;
  readonly availableActions: string[];  // from flowState.availableActions or awaitingPlayers
  readonly flowState: FlowState | undefined;
}
// Error message must include all three fields for immediate actionability (CLAUDE.md hard rule)
// Example: "Game stuck after 1000 iterations. Active seat: 1. Legal moves: [].
//           FlowState: { awaitingInput: true, currentPlayer: 1, availableActions: ['move'] }
//           Hint: the action exists in availableActions but enumerateLegalMoves returned []
//           — check that required selections have valid choices."
```

The message distinguishes "no legal moves" from "maxMoves exceeded" — the latter means the game is progressing but too slowly:
- `availableActions` non-empty + `enumerateLegalMoves` = `[]`: action exists but all selections dead-end. Include the action name.
- `availableActions` empty: no action reachable from the flow step.
- `iteration === maxMoves`: game is progressing but not finishing. Note the iteration count.

### Exported from

`src/testing/index.ts` — add `GameStuckError` and `playUntilComplete` to the barrel.

---

## TEST-03: Assertion Trace — Full Detail

### Current `assertActionAvailable` (VERIFIED: `src/testing/assertions.ts:180`)

```typescript
export function assertActionAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  if (flowState?.currentPlayer !== playerSeat) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} - current player is ${flowState?.currentPlayer}`
    );
  }

  const availableActions = flowState?.availableActions ?? [];
  if (!availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" is not available for player ${playerSeat}. Available actions: [${availableActions.join(', ')}]`
    );
  }
}
```

### Engine primitive: `game.debugActionAvailability` (VERIFIED: `src/engine/element/game.ts:1200`)

```typescript
debugActionAvailability(actionName: string, player: P): ActionDebugInfo
```

Returns `ActionDebugInfo` (VERIFIED: `src/engine/action/types.ts:646`):

```typescript
interface ActionDebugInfo {
  actionName: string;
  available: boolean;
  reason: string;             // human-readable, e.g. "Selection 'equipment' has no valid choices"
  details: {
    conditionPassed: boolean;
    conditionNote?: string;
    selections: PickDebugInfo[];  // each: { name, choices, passed, note? }
  };
}
interface PickDebugInfo {
  name: string;
  choices: number;
  passed: boolean;
  note?: string;
}
```

### Change: resolve Player then call on failure branch only

```typescript
// In the failure branch of assertActionAvailable:
const player = testGame.getPlayer(playerSeat);  // TestGame.getPlayer(position) at :178
const debugInfo = testGame.game.debugActionAvailability(actionName, player);

// Build failure message including the trace:
const selectionLines = debugInfo.details.selections.map(s =>
  `  ${s.passed ? '✓' : '✗'} selection '${s.name}': ${s.choices} choices${s.note ? ` — ${s.note}` : ''}`
).join('\n');

throw new Error(
  `Action "${actionName}" is not available for player ${playerSeat}.\n` +
  `Available actions: [${availableActions.join(', ')}]\n` +
  `Why: ${debugInfo.reason}\n` +
  (selectionLines ? `Selections:\n${selectionLines}` : '')
);
```

`testGame.getPlayer(position)` already exists at `src/testing/test-game.ts:178` and throws if position invalid — safe to call directly.

### Why NOT `traceAction()` from `src/testing/debug.ts` (D-05)

`traceAction()` (at `src/testing/debug.ts:174`) accesses `(game as any).actions` (plain object, line 183). The engine stores actions in `game._actions` (a private `Map`, confirmed by the `_actions.get(name)` calls throughout `game.ts`). The `.actions` plain-object path is stale — it would return `undefined` for any action, making every `traceAction` call silently return "not found." `debugActionAvailability` uses `this._actions.get(actionName)` and is actively maintained and tested.

---

## TEST-04: `actionsMode` — Full Detail

### Current extra-actions check (VERIFIED: `src/testing/assertions.ts:103`)

```typescript
// lines 95–107 (verbatim):
if (expected.actions !== undefined) {
  const actualActions = actual.actions ?? [];
  const missingActions = expected.actions.filter(a => !actualActions.includes(a));
  if (missingActions.length > 0) {
    errors.push(`Missing expected actions: ${missingActions.join(', ')}`);
  }
  // Exact-set match: extra available actions are a failure too
  const extraActions = actualActions.filter(a => !expected.actions!.includes(a));
  if (extraActions.length > 0) {
    errors.push(`Unexpected available actions: ${extraActions.join(', ')}`);
  }
}
```

### Change: add `actionsMode` to `ExpectedFlowState`, guard extra-actions block

```typescript
// Add to ExpectedFlowState interface:
/**
 * How to compare the `actions` list.
 * - 'exact' (default): both missing AND extra actions fail (backward-compatible behavior).
 * - 'contains': only missing actions fail; extra actions are allowed.
 */
actionsMode?: 'exact' | 'contains';
```

In the assertion body, gate the extra-actions check:

```typescript
// Guard the extra-actions block (the missing-actions block is always checked):
const mode = expected.actionsMode ?? 'exact';
if (mode === 'exact') {
  const extraActions = actualActions.filter(a => !expected.actions!.includes(a));
  if (extraActions.length > 0) {
    errors.push(`Unexpected available actions: ${extraActions.join(', ')}`);
  }
}
```

This is a pure additive change. All callers that omit `actionsMode` get `'exact'` (unchanged behavior, no migration).

---

## TEST-05: `ActionBuilder` — Full Detail

### Current low-level multi-step path

Today, test authors drive multi-step actions via `testGame.doAction(seat, 'actionName', { selKey: value })` with manually-constructed args. To find valid values for element selections, authors must inspect `testGame.game` directly — there is no in-process "what choices are available for this selection right now?" API in the testing module. The engine has it: `game.getSelectionChoices(actionName, selectionName, player, args)`.

### Engine primitive: `game.getSelectionChoices` (VERIFIED: `src/engine/element/game.ts:978`)

```typescript
getSelectionChoices(
  actionName: string,
  selectionName: string,
  player: P,
  args: Record<string, unknown> = {}
): AnnotatedChoice<unknown>[]
```

`AnnotatedChoice` has at minimum: `{ value: unknown; disabled: boolean; ... }`. The method filters disabled choices in-process (no server round-trip). To get only enabled choices: `result.filter(c => c.disabled === false).map(c => c.value)`.

### `ActionBuilder` implementation

```typescript
// src/testing/action-builder.ts — new file
class ActionBuilder {
  private readonly _testGame: TestGame;
  private readonly _actionName: string;
  private readonly _seat: number;
  private _args: Record<string, unknown> = {};

  constructor(testGame: TestGame, actionName: string, seat: number)

  /**
   * Get available choices for a selection (only enabled choices returned).
   * Dependent selections respect already-set selections via accumulated args.
   */
  getChoices(selectionName: string): unknown[] {
    const player = this._testGame.getPlayer(this._seat);
    return this._testGame.game
      .getSelectionChoices(this._actionName, selectionName, player, this._args)
      .filter(c => c.disabled === false)
      .map(c => c.value);
  }

  /** Set a selection value (fluent). */
  select(selectionName: string, value: unknown): this {
    this._args = { ...this._args, [selectionName]: value };
    return this;
  }

  /** Execute the fully-built action. Throws on failure. */
  execute(): void {
    const result = this._testGame.doAction(this._seat, this._actionName, this._args);
    if (!result.success) {
      throw new Error(
        `ActionBuilder.execute(): action '${this._actionName}' failed for seat ${this._seat}: ${result.error}`
      );
    }
  }

  /** Build args without executing — useful for asserting arg shape. */
  buildArgs(): Record<string, unknown> {
    return { ...this._args };
  }
}
```

**Convenience factory on TestGame (Claude's discretion — reduces import burden):**

```typescript
// src/testing/test-game.ts — add method
action(actionName: string, seat: number): ActionBuilder {
  return new ActionBuilder(this, actionName, seat);
}
```

This follows the locked design doc's "optional convenience factory" note.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Move enumeration for TEST-02 | Custom selection traversal | `enumerateLegalMoves(game, seat)` from `src/engine/utils/enumerate-moves.ts` | Phase 117 extracted the full `dependsOn`/`multiSelect`/`optional` combinatorics from MCTSBot — duplicating this is a maintenance disaster |
| Action availability trace | Adapt `traceAction()` from `src/testing/debug.ts` | `game.debugActionAvailability(name, player)` at `game.ts:1200` | `traceAction()` accesses `(game as any).actions` (plain object, line 183) while engine uses `game._actions` (private Map) — returns "not found" for every action |
| In-process choice resolution | Custom selection evaluation | `game.getSelectionChoices(actionName, selName, player, args)` at `game.ts:978` | Already handles `dependsOn`, disabled states, filter callbacks — do not duplicate |
| Perspective-aware state | New JSON filter | `testGame.getPlayerView(seat)` → `createPlayerView()` | Hidden-info filtering is security-critical; `image-leak.test.ts` proves the sanctioned path |

**Key insight:** Every non-trivial primitive needed by Phase 118 was already shipped in Phase 117 or earlier. This phase's value is the ergonomic assembly, not new engine logic.

---

## Common Pitfalls

### Pitfall 1: Using `traceAction()` for TEST-03 instead of `debugActionAvailability()`

**What goes wrong:** `traceAction()` at `src/testing/debug.ts:183` accesses `(game as any).actions` expecting a plain `{ [name]: ActionDefinition }` object. The engine stores actions in `game._actions: Map<string, ActionDefinition>` (private Map). The plain-object lookup returns `undefined` for every action, causing `traceAction` to always report "Action not found" — a false, misleading trace.

**Why it happens:** `debug.ts` was written before the engine moved to a private Map-based registry. It was not updated.

**How to avoid:** Exclusively use `game.debugActionAvailability(actionName, player)` (design doc D-05). The locked decision exists precisely to prevent this mistake.

**Warning signs:** `traceAction(...)` returning `{ available: false, reason: "Action '...' not found in game.actions" }` for a known-registered action.

### Pitfall 2: `playUntilComplete` ignoring simultaneous-action turns

**What goes wrong:** Using only `flowState.currentPlayer` to determine which seat to enumerate moves for. In simultaneous-action steps, `currentPlayer` is `undefined` and `awaitingPlayers` is set. Treating `undefined` seat as "no active player" causes an infinite loop (the function keeps iterating without making any moves).

**How to avoid:** Check both `flowState.currentPlayer` (sequential) and `flowState.awaitingPlayers?.filter(p => !p.completed)` (simultaneous). Act on all seats that have incomplete pending input.

**Warning signs:** `playUntilComplete` hanging (never completing or throwing `GameStuckError`) on a game that uses simultaneous action steps.

### Pitfall 3: `ActionBuilder.getChoices()` returning disabled choices

**What goes wrong:** Returning all `AnnotatedChoice` values including `.disabled === true`. Passing a disabled choice to `.select()` and then `.execute()` produces a "no valid choices" action failure.

**How to avoid:** Filter `c.disabled === false` before returning from `getChoices()`. The locked API shows the contract: `getChoices()` returns enabled values only.

### Pitfall 4: `assertActionAvailable` calling `debugActionAvailability` unconditionally

**What goes wrong:** Calling `debugActionAvailability` on every `assertActionAvailable` invocation (including successful ones). This is a performance regression for game suites with many assertions.

**How to avoid:** Call `debugActionAvailability` only in the failure branch — after confirming the action is NOT in `availableActions`. The trace is needed only to enrich the error message.

---

## Code Examples

### TEST-02: `playUntilComplete` loop skeleton

```typescript
// Source: design doc Part 2 TEST-02 + FlowState inspection at src/engine/flow/types.ts:240
import { enumerateLegalMoves } from '../engine/index.js';

export function playUntilComplete(testGame: TestGame, options?: PlayUntilCompleteOptions): void {
  const maxMoves = options?.maxMoves ?? 1000;
  const strategy = options?.strategy ?? 'random';
  const rng = options?.rng ?? Math.random;

  for (let i = 0; i < maxMoves; i++) {
    if (testGame.isComplete()) return;

    const flowState = testGame.getFlowState();
    if (!flowState?.awaitingInput) {
      // Flow is processing (not waiting on a player) — nothing to do this iteration
      continue;
    }

    // Determine active seats (sequential vs simultaneous)
    const activeSeats: number[] = [];
    if (flowState.currentPlayer !== undefined) {
      activeSeats.push(flowState.currentPlayer);
    } else if (flowState.awaitingPlayers) {
      for (const p of flowState.awaitingPlayers) {
        if (!p.completed) activeSeats.push(p.playerIndex);
      }
    }

    // Enumerate and pick a move for each active seat
    let anyMoveMade = false;
    for (const seat of activeSeats) {
      const moves = enumerateLegalMoves(testGame.game, seat);
      if (moves.length === 0) continue;
      const move = strategy === 'first'
        ? moves[0]
        : moves[Math.floor(rng() * moves.length)];
      testGame.doAction(seat, move.action, move.args);
      anyMoveMade = true;
    }

    if (!anyMoveMade && activeSeats.length > 0) {
      // Active seats exist but no legal moves — truly stuck
      throw new GameStuckError(/* ... */);
    }
  }

  if (!testGame.isComplete()) {
    throw new GameStuckError(/* maxMoves exceeded variant */);
  }
}
```

### TEST-03: Trace wiring in `assertActionAvailable`

```typescript
// Source: design doc Part 2 TEST-03; assertActionAvailable at src/testing/assertions.ts:180
if (!availableActions.includes(actionName)) {
  const player = testGame.getPlayer(playerSeat);  // TestGame.getPlayer() at :178
  const debugInfo = testGame.game.debugActionAvailability(actionName, player);
  const selLines = debugInfo.details.selections
    .map(s => `  ${s.passed ? '✓' : '✗'} '${s.name}': ${s.choices} choices${s.note ? ` — ${s.note}` : ''}`)
    .join('\n');
  throw new Error(
    `Action "${actionName}" is not available for player ${playerSeat}.\n` +
    `Available actions: [${availableActions.join(', ')}]\n` +
    `Why: ${debugInfo.reason}` +
    (selLines ? `\nSelections:\n${selLines}` : '')
  );
}
```

### TEST-05: ActionBuilder usage pattern

```typescript
// Source: design doc Part 2 TEST-05
const builder = new ActionBuilder(testGame, 'move', 1);
// or: testGame.action('move', 1)  ← convenience factory

const validDestinations = builder.getChoices('destination');
// [<Space id=5>, <Space id=6>, ...]  — enabled choices only

builder.select('destination', validDestinations[0]);
builder.execute();  // throws if action fails
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (detected: `src/testing/random-simulation.test.ts` uses `import { describe, it, expect } from 'vitest'`) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/testing/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `testGame.getPlayerView(seat)` returns typed `PlayerStateView` with correct hidden-info exclusion | integration | `npx vitest run src/testing/test-game.test.ts` | ❌ Wave 0 |
| TEST-01 | `testGame.game` typed as `G` allows per-game property access | unit | `npx vitest run src/testing/test-game.test.ts` | ❌ Wave 0 |
| TEST-02 | `playUntilComplete` drives a 2-player sequential game to completion | integration | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ Wave 0 |
| TEST-02 | `playUntilComplete` with `strategy:'first'` is deterministic | unit | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ Wave 0 |
| TEST-02 | `GameStuckError` thrown when all selections dead-end (stuck game) | integration | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ Wave 0 |
| TEST-02 | `GameStuckError` thrown when `maxMoves` exceeded | integration | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ Wave 0 |
| TEST-02 | `playUntilComplete` handles simultaneous-action turns (awaitingPlayers) | integration | `npx vitest run src/testing/play-until-complete.test.ts` | ❌ Wave 0 |
| TEST-03 | Failed `assertActionAvailable` includes `reason` from `debugActionAvailability` | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-03 | Failed `assertActionAvailable` includes per-selection `note` lines | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-03 | Passing `assertActionAvailable` does NOT call `debugActionAvailability` (no perf regression) | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-04 | `assertFlowState({ actions: ['x'], actionsMode: 'exact' })` fails on extra action | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-04 | `assertFlowState({ actions: ['x'], actionsMode: 'contains' })` passes with extra action | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-04 | `assertFlowState({ actions: ['x'] })` (no actionsMode) fails on extra action (default=exact) | unit | `npx vitest run src/testing/assertions.test.ts` | ❌ Wave 0 |
| TEST-05 | `ActionBuilder.getChoices()` returns only enabled choices | unit | `npx vitest run src/testing/action-builder.test.ts` | ❌ Wave 0 |
| TEST-05 | `ActionBuilder.getChoices()` for dependent selection respects accumulated args | integration | `npx vitest run src/testing/action-builder.test.ts` | ❌ Wave 0 |
| TEST-05 | `ActionBuilder.execute()` throws descriptive error on action failure | unit | `npx vitest run src/testing/action-builder.test.ts` | ❌ Wave 0 |
| TEST-05 | `ActionBuilder.buildArgs()` returns accumulated selection values | unit | `npx vitest run src/testing/action-builder.test.ts` | ❌ Wave 0 |
| TEST-05 | `testGame.action(name, seat)` factory creates an `ActionBuilder` | unit | `npx vitest run src/testing/action-builder.test.ts` | ❌ Wave 0 |

### Cross-Layer Boundary Integration Tests (CLAUDE.md requirement)

Per CLAUDE.md: "Write at least one integration test per cross-layer boundary the change touches."

| Boundary | Layer A | Layer B | Test Location | Covers |
|----------|---------|---------|---------------|--------|
| testing → engine (enumerateLegalMoves) | `playUntilComplete` in testing | `enumerateLegalMoves` in engine | `play-until-complete.test.ts` | TEST-02: move enumeration drives game to completion |
| testing → engine (debugActionAvailability) | `assertActionAvailable` in testing | `debugActionAvailability` in engine | `assertions.test.ts` | TEST-03: trace flows from engine through assertion error message |
| testing → engine (getSelectionChoices) | `ActionBuilder.getChoices()` in testing | `getSelectionChoices` in engine | `action-builder.test.ts` | TEST-05: in-process choice resolution for dependent selections |

### Sampling Rate

- **Per task commit:** `npx vitest run src/testing/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

The following test files do not exist and must be created before implementation:

- [ ] `src/testing/play-until-complete.test.ts` — covers TEST-02 (`playUntilComplete`, `GameStuckError`)
- [ ] `src/testing/assertions.test.ts` — covers TEST-03 (trace wiring) + TEST-04 (`actionsMode`)
- [ ] `src/testing/action-builder.test.ts` — covers TEST-05 (`ActionBuilder`)
- [ ] `src/testing/test-game.test.ts` — covers TEST-01 (typed state access, `getPlayerView` return type)

Note: `src/testing/random-simulation.test.ts`, `simulate-tutorial.test.ts`, and `tutorial-ci-demo.test.ts` already exist (confirmed) and cover their respective modules — no Wave 0 gap for those.

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 118 |
|--------------|------------------|---------------------|
| `traceAction()` in `debug.ts` — accesses `(game as any).actions` plain object | `game.debugActionAvailability()` — uses `game._actions` Map, actively maintained | TEST-03 must use the new approach; `traceAction` is stale but kept in barrel for backward compat |
| `MCTSBot.enumerateAllMoves()` (private) — bot-specific logic | `enumerateLegalMoves(game, seat)` (public, Phase 117) — extracted to engine | TEST-02 delegates entirely to this; no duplication |
| No in-process multi-step builder | `ActionBuilder` (Phase 118) + `game.getSelectionChoices()` (existing) | TEST-05 assembles these for the first time |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AnnotatedChoice<unknown>` has a `.disabled: boolean` field that is `false` for valid choices | TEST-05 implementation detail | `getChoices()` would return wrong set; mitigation: verify `AnnotatedChoice` type definition before coding `ActionBuilder.getChoices()` |

**Verification path for A1:** `grep -n "AnnotatedChoice\|disabled" /Users/jtsmith/BoardSmith/src/engine/action/types.ts` — confirmed at research time: `_getChoices` in `enumerate-moves.ts:250` uses `c.disabled === false` filter, confirming the field name and semantics. [VERIFIED by cross-reference with `src/engine/utils/enumerate-moves.ts:250`]

Assumption A1 is **resolved LOW-risk** — the `c.disabled === false` filter pattern is used in the shipped Phase 117 code and confirmed working.

---

## Open Questions

All design questions are locked by the approved design doc. No open questions remain.

**Previously open, now RESOLVED:**

1. **Where should `playUntilComplete` live?** RESOLVED: `src/testing/simulate-action.ts`. The design doc permitted both `simulate-action.ts` and `test-game.ts`; `simulate-action.ts` is the better home (existing simulation helpers; function not a class method).

2. **How to handle simultaneous-action turns in `playUntilComplete`?** RESOLVED: enumerate from `flowState.awaitingPlayers` (filter `!p.completed`) when `flowState.currentPlayer` is undefined. See TEST-02 full detail above.

3. **Should `ActionBuilder` be a new file or added to `simulate-action.ts`?** RESOLVED: new file `src/testing/action-builder.ts` — the design doc specifies this location explicitly.

4. **Is `traceAction()` in `debug.ts` safe to use for TEST-03?** RESOLVED NO: it accesses `(game as any).actions` (line 183) which is stale; the engine uses `game._actions` (private Map). D-05 locks this: use `debugActionAvailability()` only.

---

## Environment Availability

This phase is code/config-only within the existing repo. No external tools beyond Node.js + Vitest are required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + test | ✓ | (project standard) | — |
| Vitest | Test runner | ✓ | (project standard) | — |
| Phase 117 deliverables | TEST-02, TEST-03, TEST-05 | ✓ | Shipped (confirmed by file existence check) | — |

---

## Security Domain

No security-sensitive surface. This phase is internal testing utilities:
- No network calls
- No auth/session handling
- No user-facing input validation
- Hidden-info filtering is handled by `getPlayerView` (Phase 117's INTRO-05 path) — Phase 118 does not alter or bypass it

ASVS categories: not applicable to test-only utilities.

---

## Sources

### Primary (HIGH confidence)
- `src/testing/test-game.ts` — full file inspection (TestGame API, getPlayerView, getPlayer, doAction, getFlowState, isComplete)
- `src/testing/assertions.ts` — full file inspection (assertFlowState:64, assertActionAvailable:180, ExpectedFlowState interface:15)
- `src/testing/simulate-action.ts` — full file inspection (simulateAction, simulateActions, assertActionSucceeds, assertActionFails)
- `src/testing/debug.ts` — full file inspection (traceAction:174 — confirmed stale via `(game as any).actions` at :183)
- `src/testing/index.ts` — full file inspection (current barrel exports)
- `src/engine/element/game.ts:978` — `getSelectionChoices` signature + body verified
- `src/engine/element/game.ts:1200` — `debugActionAvailability` signature + body verified
- `src/engine/action/types.ts:619,646` — `PickDebugInfo`, `ActionDebugInfo` interfaces verified
- `src/engine/utils/enumerate-moves.ts` — full file inspection (enumerateLegalMoves:34, return shape, `_getChoices` filtering at :250)
- `src/engine/flow/types.ts:228,240` — `PlayerAwaitingState`, `FlowState` interfaces verified
- `src/engine/index.ts` — export of `buildActionArgs:208`, `enumerateLegalMoves:209`, `ActionSpaceView:43`, `ActionSchemaView:44`
- `.planning/v4.3-API-DESIGN.md` — locked surface specification (Part 2 TEST section)
- `.planning/phases/118-test-ergonomics/118-CONTEXT.md` — locked decisions for this phase
- `.planning/phases/117-action-space-introspection/117-04-SUMMARY.md` — Phase 117 deliverables confirmed

### Secondary (MEDIUM confidence)
- `src/testing/random-simulation.test.ts` — confirms Vitest import pattern for testing module test files

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all Phase 117 primitives confirmed by file existence and signature inspection
- Architecture: HIGH — all file:line references verified directly against live `src/`
- Pitfalls: HIGH — `traceAction` stale access verified at `debug.ts:183`; simultaneous-action handling verified via `FlowState` type at `types.ts:252`

**Research date:** 2026-06-30
**Valid until:** 2026-07-30 (stable — testing module changes slowly)
