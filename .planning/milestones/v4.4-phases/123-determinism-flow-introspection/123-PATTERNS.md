# Phase 123: Determinism & Flow Introspection - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 12 (new + modified, per CONTEXT.md/RESEARCH.md scope)
**Analogs found:** 10 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/engine/flow/describe-flow-position.ts` (NEW) | utility (tree-walker) | transform | `src/engine/flow/walk-flow-nodes.ts` (traversal shape) + `src/engine/element/game.ts:1237` `debugActionAvailability` (structured-debug-output shape) | role-match (composite) |
| `src/engine/flow/types.ts` (ADD `FlowDebugInfo`) | model (type) | transform | `FlowState`/`FlowPosition` interfaces, same file (lines 38-49, 240-270) | exact (same file, same conventions) |
| `src/engine/element/game.ts` (ADD `getFlowDebugInfo()`) | controller (engine facade method) | request-response | `debugActionAvailability()` — `game.ts:1237-1255` | exact |
| `src/engine/element/space.ts` (FIX `shuffleInternal`) | service (engine primitive) | transform | itself, in-place fix; error-message style analog: `restoreFlow()` throw pattern — `game.ts:1762-1776` | role-match |
| `src/engine/element/element-collection.ts` (FIX `shuffle()`) | service (engine primitive) | transform | `space.ts` `shuffleInternal()` (sibling shuffle, same Fisher-Yates shape) | exact (sibling algorithm) |
| `src/testing/test-game.ts` (ADD `getFlowDebugInfo()`, `getPendingAction(seat)`) | service (test facade passthrough) | request-response | `getFlowState()` — `test-game.ts:128-129`; `getPlayerView()` — `test-game.ts:294-295` | exact |
| `src/testing/simulate-action.ts` (FIX `playUntilComplete` rng default; embed flow describe in `GameStuckError`) | utility (test driver) | event-driven | `random-simulation.ts` seed-and-record pattern (lines 37-42, 519, 534-535) | role-match |
| `src/testing/assertions.ts` (embed flow describe in `assertActionAvailable`) | test (assertion helper) | request-response | itself — existing `debugActionAvailability` embed pattern at `assertions.ts:206-238` | exact (extend existing pattern) |
| `src/session/pick-handler.ts` (NO CHANGE — verify only) | middleware (session pick filtering) | request-response | itself, `pick-handler.ts:200-241` (already correct) | exact (regression-check only) |
| `src/session/pending-action-manager.ts` (NO CHANGE — reference only) | service (session state owner) | CRUD | itself — `getPendingAction()` at `pending-action-manager.ts:235-238` | exact (reference for TestGame's read-only snapshot shape) |
| `src/ui/components/GameShell.devtools.ts` (ADD `flowDebugInfo`/`pendingAction` fields) | provider (devtools bridge payload builder) | event-driven | itself — `buildDevtoolsPayload()` at lines 51-67 | exact |
| `src/ui/global.d.ts` (ADD methods to `BoardsmithDevtools`) | config (ambient type declarations) | transform | itself — `BoardsmithDevtools` interface, lines 4-13 | exact |
| `src/cli/dev-host/DevHost.vue` (ADD bridge methods) | provider (dev-host window global) | event-driven | existing `getState`/`getAvailableActions`/`getActionMetadata` wiring (no analog read in this pass — file not opened; low risk, thin wiring) | no analog read (see below) |

## Pattern Assignments

### `src/engine/flow/describe-flow-position.ts` (NEW utility, transform)

**Analog A (traversal shape):** `src/engine/flow/walk-flow-nodes.ts` (full file, 67 lines)

```typescript
// Source: src/engine/flow/walk-flow-nodes.ts:21-66 (existing, verified)
export function* walkFlowNodes(node: FlowNode): Generator<FlowNode> {
  yield node;
  switch (node.type) {
    case 'sequence':
      for (const step of node.config.steps) { yield* walkFlowNodes(step); }
      break;
    case 'loop':
    case 'repeat':
    case 'each-player':
    case 'for-each':
    case 'phase':
      yield* walkFlowNodes(node.config.do);
      break;
    case 'if':
      yield* walkFlowNodes(node.config.then);
      if (node.config.else) { yield* walkFlowNodes(node.config.else); }
      break;
    case 'switch':
      for (const caseNode of Object.values(node.config.cases)) { yield* walkFlowNodes(caseNode); }
      if (node.config.default) { yield* walkFlowNodes(node.config.default); }
      break;
    case 'action-step':
    case 'simultaneous-action-step':
    case 'execute':
      break; // leaves
    default: {
      const _exhaustive: never = node; // exhaustiveness guard
      return _exhaustive;
    }
  }
}
```

**Key difference for the new walker:** unlike `walkFlowNodes` (visits every node, ignores position), `describeFlowPosition` must follow `FlowPosition.path: number[]` as an index stack — at each node, only descend into the child whose index equals `path[depth]` (for `sequence.config.steps[path[depth]]`, `switch` needs a stable case-key ordering matching how `FlowEngine` assigns indices — verify against `src/engine/flow/engine.ts` index-assignment before implementing, RESEARCH.md flags this). Reuse the same `switch (node.type)` + exhaustiveness-guard shape from `walkFlowNodes` verbatim — do not invent a new node-type dispatch convention.

**Per CONTEXT.md/RESEARCH.md Pitfall 1:** do NOT recompute `phase` name from the path — pull it directly from `FlowState.currentPhase` (already correctly tracked, `game.ts` `_flowEngine` bookkeeping). Only use the path-walker for the "step" breadcrumb / most-specific-named-node detail.

**Fallback rule (Pitfall 2):** `BaseFlowConfig.name` is optional on every node type except `PhaseConfig.name` (required — `flow/types.ts:202-204`). When `config.name` is absent for a step node, fall back to `node.type` string (e.g. `"action-step"`), never throw and never emit `"undefined"`.

**Analog B (structured-debug-info return shape to mirror):** `src/engine/element/game.ts:1237-1255` (`debugActionAvailability`) — same "structured object + human string" shape `getFlowDebugInfo()` should follow:

```typescript
// Source: src/engine/element/game.ts:1237-1255 (existing, verified)
debugActionAvailability(actionName: string, player: P): ActionDebugInfo {
  const action = this._actions.get(actionName);
  if (!action) {
    return {
      actionName, available: false,
      reason: `Action '${actionName}' does not exist`,
      details: { conditionPassed: false, conditionNote: `...`, selections: [] },
    };
  }
  const trace = this._actionExecutor.traceActionAvailability(action, player);
  return this._formatActionDebugInfo(trace);
}
```

`getFlowDebugInfo()` should follow the same shape: gather raw data (path walk + `FlowState`), then format into `{ phase, step, path, awaiting, describe() }` via a private formatter method, mirroring `_formatActionDebugInfo` at `game.ts:1458`.

---

### `src/engine/flow/types.ts` (ADD `FlowDebugInfo`)

**Analog:** same-file sibling interfaces `FlowPosition` (lines 38-49) and `FlowState` (lines 240-270) — follow identical doc-comment style (`/** ... */` per field) and flat structure (no nested classes, plain data + one method for `describe()`).

```typescript
// Source: src/engine/flow/types.ts:38-49 (existing, verified — style to mirror)
export interface FlowPosition {
  /** Stack of node indices (path through nested flows) */
  path: number[];
  /** Current iteration counts for loops */
  iterations: Record<string, number>;
  /** Per-frame execution metadata needed for accurate restore */
  frameData?: Record<string, Record<string, unknown>>;
  /** Current player index for eachPlayer */
  playerIndex?: number;
  /** Variables stored in flow context */
  variables: Record<string, unknown>;
}
```

`FlowState.currentPhase?: string` (line 254) is the field `getFlowDebugInfo().phase` should read directly, not recompute.

---

### `src/engine/element/game.ts` (ADD `getFlowDebugInfo()`)

**Analog:** `debugActionAvailability()` / `debugAllActions()` — `game.ts:1213-1273`

**Imports pattern** (already present in file — no new imports needed beyond the new `describeFlowPosition` helper and `FlowDebugInfo` type from `./flow/types.js` / `./flow/describe-flow-position.js`).

**Placement:** insert as a peer method immediately adjacent to `getFlowState()` (line 1754) or `debugActionAvailability()` (line 1237) — CONTEXT.md explicitly calls it "peer of `debugActionAvailability`."

**Core pattern to copy** (doc-comment + `@example` style, JSDoc referencing return-shape fields exactly like `debugActionAvailability`'s doc at lines 1213-1236):

```typescript
// Style template — Source: game.ts:1213-1237 JSDoc conventions (existing, verified)
/**
 * Get a human-readable snapshot of the current flow position.
 *
 * @example
 * ```typescript
 * const info = game.getFlowDebugInfo();
 * console.log(info.describe());
 * // "phase *pegging* -> step *player-turn*, waiting on seat 2"
 * ```
 */
getFlowDebugInfo(): FlowDebugInfo { /* ... */ }
```

**Existing methods to reuse, not duplicate** (per RESEARCH.md "Don't Hand-Roll" + Anti-Patterns):
- `this.getFlowState()` (line 1754) for `currentPhase`/`currentPlayer`/`awaitingPlayers`.
- `this._flowDefinition` (already stored) as the `root` argument to `describeFlowPosition`.

---

### `src/engine/element/space.ts` (FIX `shuffleInternal`, line 279)

**Current code (to fix):**
```typescript
// Source: src/engine/element/space.ts:277-279 (existing, verified)
shuffleInternal(): void {
  const random = this._ctx.random ?? Math.random;
  // Fisher-Yates shuffle using `random`...
}
```

**Analog for the throw-with-actionable-message style:** `game.ts` `restoreFlow()` (lines 1762-1776) — throws with a specific, contextual message rather than silently degrading:

```typescript
// Source: src/engine/element/game.ts:1762-1776 (existing, verified — actionable-throw style to mirror)
restoreFlow(position: FlowPosition): void {
  if (!this._flowDefinition) {
    throw new Error('No flow definition set');
  }
  // ...
  if (!result.success) {
    throw new Error(
      `Flow position invalid: ${result.error}. ` +
      `Valid path prefix: [${result.validPath.join(', ')}]`
    );
  }
}
```

**Applied fix shape:** replace `this._ctx.random ?? Math.random` with a check that throws when `this._ctx.random` is absent, message should name the actionable fix (attach element to a game via constructor, or the element tree is disconnected) — per CONTEXT.md: "if no seeded RNG is reachable, throw with an actionable message — never silently fall back to `Math.random`."

---

### `src/engine/element/element-collection.ts` (FIX `shuffle()`, line 211)

**Current code (to fix):**
```typescript
// Source: src/engine/element/element-collection.ts:210-217 (existing, verified)
shuffle(random: () => number = Math.random): ElementCollection<T> {
  for (let i = this.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [this[i], this[j]] = [this[j], this[i]];
  }
  return this;
}
```

**Sibling algorithm (same Fisher-Yates, same shape)** — `space.ts` `shuffleInternal()`:
```typescript
// Source: src/engine/element/space.ts:274-283 (existing, verified — identical FY loop)
for (let i = this._t.children.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [this._t.children[i], this._t.children[j]] = [this._t.children[j], this._t.children[i]];
}
```

**Applied fix:** per CONTEXT.md, this is a clean break (zero callers in repo/games/MERC) — remove the `= Math.random` default entirely, making `random` a required parameter. Add regression test per RESEARCH.md Pitfall 4 (`element-collection.test.ts` has no existing `.shuffle(` test).

---

### `src/testing/test-game.ts` (ADD `getFlowDebugInfo()`, `getPendingAction(seat)`)

**Analog:** existing thin-passthrough methods, same file:

```typescript
// Source: src/testing/test-game.ts:128-129 (existing, verified — exact shape to copy)
getFlowState(): FlowState | undefined {
  return this.runner.getFlowState();
}
```
```typescript
// Source: src/testing/test-game.ts:294-295 (existing, verified — same passthrough shape)
getPlayerView(playerSeat: number): PlayerStateView {
  return this.runner.getPlayerView(playerSeat);
}
```

**`getFlowDebugInfo()`** — straightforward passthrough to `this.runner.game.getFlowDebugInfo()` (or add a `GameRunner.getFlowDebugInfo()` passthrough first, mirroring `runner.ts:257` `getFlowState()`), following the exact one-line-delegate shape above.

**`getPendingAction(seat)` — NO DIRECT ANALOG, confirmed gap (verified this pass):**
- `TestGame.doAction()` (`test-game.ts:203-209`) delegates to `this.runner.performAction(...)`.
- `GameRunner.performAction` (`src/runtime/runner.ts:128-195`) calls `this.game.continueFlow(actionName, args, playerIndex)` directly — **it does NOT go through `PendingActionManager`** at all. `GameRunner` has no pending-action instance.
- `PendingActionManager`/`getPendingAction()` (`src/session/pending-action-manager.ts:235-238`, `game-session.ts:1885-1886`) is **session-layer only**:
  ```typescript
  // Source: src/session/game-session.ts:1885-1886 (existing, verified)
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    return this.#pendingActionManager.getPendingAction(playerPosition);
  }
  ```
- **Confirms RESEARCH.md Assumption A2 as TRUE:** `TestGame`/`GameRunner` has no pending-action tracking today. `TestGame.getPendingAction(seat)` is **not** a one-line passthrough — it needs new plumbing, most likely via `ActionExecutor.createPendingActionState`/`isPendingActionComplete` (referenced in `pending-action-manager.ts:105`) called directly by `GameRunner`, OR a lightweight `GameRunner`-owned `PendingActionManager` instance mirroring the session one. Flag this to the planner as a design decision, not a simple copy.
- **Read-only snapshot requirement (CONTEXT.md/Anti-Patterns):** whatever the plumbing, the returned value must be a spread-copy of `PendingActionState`, never the live mutable object — follow `PendingActionState` type shape at `src/engine/action/types.ts:137`.

---

### `src/testing/simulate-action.ts` (FIX `playUntilComplete` rng default; embed flow describe in `GameStuckError`)

**Current code (to fix):**
```typescript
// Source: src/testing/simulate-action.ts:297 (existing, verified)
const rng = options?.rng ?? Math.random;
```

**Analog — seed-and-record pattern to mirror:** `src/testing/random-simulation.ts`

```typescript
// Source: src/testing/random-simulation.ts:36-42 (existing, verified — comment describing the pattern)
// "Base seed for the whole run. Per-game seeds are derived deterministically
//  from it, so re-running with the same base seed reproduces the same games.
//  When omitted, a random base seed is generated and returned on
//  SimulationResults.seed so a run can still be replayed."
```
```typescript
// Source: src/testing/random-simulation.ts:23,519,534-535 (existing, verified)
import { SeededRandom } from '../utils/random.js';
// ...
seed: baseSeed = crypto.randomUUID(),
// ...
// Deterministic per-game seed: re-running with the same base seed
// reproduces this exact game; the seed is also replayable on its own.
```

**Applied fix per CONTEXT.md:** add `options.seed` (not `options.rng`) defaulting to a fixed literal (e.g. `'playUntilComplete-default'`) when neither `seed` nor `rng` is supplied; construct via `new SeededRandom(seed)` / `createSeededRandom(seed)` from `src/utils/random.ts` (exports confirmed: `SeededRandom` class, `createSeededRandom()` function). Keep `options.rng` as an escape hatch (already documented at `simulate-action.ts:244-254`), but the *default* must never be `Math.random`.

**`GameStuckError` embed** — existing structured-error shape already carries `flowState`:
```typescript
// Source: src/testing/simulate-action.ts:193-219 (existing, verified)
export class GameStuckError extends Error {
  readonly name = 'GameStuckError' as const;
  readonly iteration: number;
  readonly availableActions: string[];
  readonly flowState: FlowState | undefined;
  constructor(message: string, iteration: number, availableActions: string[], flowState: FlowState | undefined) {
    super(message);
    // ...
    Object.setPrototypeOf(this, GameStuckError.prototype);
  }
}
```
Add the readable `getFlowDebugInfo().describe()` string into the `message` argument at each `throw new GameStuckError(...)` call site (lines ~343, ~388, ~399, ~424) — no structural change to the class itself, just enrich the message text passed in.

---

### `src/testing/assertions.ts` (embed flow describe in `assertActionAvailable`)

**Analog:** the file's own existing `debugActionAvailability` embed pattern — extend it, don't replace it:

```typescript
// Source: src/testing/assertions.ts:206-238 (existing, verified — exact pattern to extend)
export function assertActionAvailable(testGame: TestGame, playerSeat: number, actionName: string): void {
  const flowState = testGame.getFlowState();
  if (!canSeatAct(flowState, playerSeat)) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} — seat is not active. ` +
      `currentPlayer=${flowState?.currentPlayer}, ` +
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}`
    );
  }
  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    const player = testGame.getPlayer(playerSeat);
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
}
```

**Applied fix:** add one more line to both thrown-error messages embedding `testGame.getFlowDebugInfo().describe()` (or `testGame.game.getFlowDebugInfo().describe()`), following the exact string-concatenation style already used (`\n`-joined sections, labeled with `Why:`/`Available actions:`).

---

### `src/session/pick-handler.ts` (verify-only, no change expected)

**Existing correct pattern (already forwards `disabled`, per RESEARCH.md — do not duplicate):**
```typescript
// Source: src/session/pick-handler.ts:239-241 (existing, verified)
if (disabled !== false) {
  choice.disabled = disabled;
}
```
Regression-check only: confirm `pick-handler.test.ts` covers "disabled choice submission rejected" — do not add a parallel filtering/introspection mechanism here (Anti-Pattern flagged in RESEARCH.md).

---

### `src/ui/components/GameShell.devtools.ts` (ADD `flowDebugInfo`/`pendingAction` fields)

**Analog:** `buildDevtoolsPayload()` — same file, lines 51-67:

```typescript
// Source: src/ui/components/GameShell.devtools.ts:51-67 (existing, verified)
export function buildDevtoolsPayload(params: DevtoolsParams): DevtoolsStateMessage {
  return {
    source: 'shufflewick-game',
    type: 'boardsmith:devtools-state-update',
    seat: params.seat,
    state: params.state,
    availableActions: params.availableActions,
    actionMetadata: params.actionMetadata,
    boardInteraction: {
      activeAction: params.boardInteraction.currentAction,
      currentSelectionStep: params.boardInteraction.currentPickIndex,
      validElements: params.boardInteraction.validElements.filter(v => !v.disabled).map(v => v.id),
    },
  };
}
```

**Applied fix:** add `flowDebugInfo: params.flowDebugInfo` and `pendingAction: params.pendingAction` to both `DevtoolsStateMessage` (interface, lines 17-29) and `DevtoolsParams` (interface, lines 35-44) and the return object above — purely additive fields, no structural change. Security note (already enforced, preserve as-is): this whole module is only invoked inside `if (isDevBuild)` in `GameShell.vue` (module-level comment, lines 6-8) — new fields must stay inside that same guard, never leak to production builds.

---

### `src/ui/global.d.ts` (ADD methods to `BoardsmithDevtools`)

**Analog:** existing interface, same file, lines 4-13:

```typescript
// Source: src/ui/global.d.ts:4-13 (existing, verified)
interface BoardsmithDevtools {
  getState(seat?: number): unknown | null;
  getAvailableActions(seat?: number): string[];
  getActionMetadata(seat?: number): Record<string, unknown> | undefined;
  getBoardInteractionState(): { activeAction: string | null; currentSelectionStep: number; validElements: number[] } | null;
}
```

**Applied fix:** add `getFlowDebugInfo(seat?: number): FlowDebugInfo | null;` and `getPendingAction(seat?: number): PendingActionState | null;` (or plain-object equivalents, matching the existing `unknown | null` / structural-object return convention already used by the other four methods — never `undefined`, always `null` for "not applicable").

---

### `src/cli/dev-host/DevHost.vue` (ADD bridge methods)

**No analog read this pass** — file not opened (out of budget; existing `getState`/`getAvailableActions`/`getActionMetadata`/`getBoardInteractionState` wiring referenced only via `global.d.ts` interface and `GameShell.devtools.ts` payload). Low risk: this is thin postMessage-listener wiring that mirrors the four existing methods 1:1. **Planner should grep `DevHost.vue` for `__BOARDSMITH_DEVTOOLS =` or `getState:` to find the exact assignment block before writing this task** — the shape will be a direct sibling of the other four methods, reading the last-received `boardsmith:devtools-state-update` postMessage payload's new `flowDebugInfo`/`pendingAction` fields.

## Shared Patterns

### Structured-debug-info response shape (engine-level)
**Source:** `src/engine/element/game.ts:1237-1273` (`debugActionAvailability`/`debugAllActions`)
**Apply to:** `getFlowDebugInfo()` (new), any future "why" introspection method
**Shape:** plain data object with a `reason`/`describe()` human string field alongside machine-branchable structured fields (`available`, `details.selections`, etc.) — never a bare string, never a bare boolean.

### Thin TestGame passthrough (testing-layer)
**Source:** `src/testing/test-game.ts:128-129`, `:294-295`
**Apply to:** `TestGame.getFlowDebugInfo()` (one-line delegate — has a home to delegate to); `TestGame.getPendingAction()` (needs new plumbing first, see gap noted above — do not force a one-line delegate where the underlying state doesn't exist yet)
```typescript
getFlowState(): FlowState | undefined {
  return this.runner.getFlowState();
}
```

### Seed-and-record (determinism)
**Source:** `src/testing/random-simulation.ts` (lines 36-42, 519, 534-535), `src/utils/random.ts` (`SeededRandom` class, `createSeededRandom()` function — both exported)
**Apply to:** `playUntilComplete` default rng/seed; any future auto-seed-generation retrievability fix (`game.ts:591`, `game-session.ts:520`, `runner.ts:83-91` — note `GameRunner.seed` is read from `options.gameOptions.seed` BEFORE `Game`'s constructor auto-generates one at `game.ts:591`, so an auto-generated seed is currently **not** captured on `GameRunner.seed`; confirmed gap matching RESEARCH.md Pitfall 3/Assumption A3 — planner should have `GameRunner` read the seed back from `this.game.getConstructorOptions().seed` or add `Game.getSeed()` after construction).

### Actionable-throw style (no silent fallback)
**Source:** `src/engine/element/game.ts:1762-1776` (`restoreFlow`)
**Apply to:** `Space.shuffleInternal()`'s new throw-when-no-rng guard — message must name the concrete fix (e.g. "attach this element to a Game via the constructor, or shuffle with an explicit rng").

### Devtools bridge additive-field pattern
**Source:** `src/ui/components/GameShell.devtools.ts:51-67`, `src/ui/global.d.ts:4-13`
**Apply to:** `flowDebugInfo`/`pendingAction` exposure — always additive to the existing payload/interface shape, always inside the existing `isDevBuild` guard, never a new bridge mechanism.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/engine/flow/describe-flow-position.ts` (path-following walker itself) | utility | transform | No existing function walks `FlowPosition.path` as an index stack (confirmed — `walkFlowNodes` is pre-order-only, ignores position); genuinely new algorithm, composited from two analogs above (traversal shape + debug-output shape) |
| `TestGame.getPendingAction(seat)` (underlying plumbing) | service | CRUD | Confirmed gap: `GameRunner.performAction` bypasses `PendingActionManager` entirely (verified `runner.ts:128-195` calls `game.continueFlow` directly); session-layer `PendingActionManager` pattern is the closest reference but is not a directly reusable dependency for the testing-layer (`GameRunner` has no session) |
| `src/cli/dev-host/DevHost.vue` bridge wiring | provider | event-driven | Not read this pass (budget) — low-risk thin wiring, planner should grep the assignment block directly before writing the task |

## Metadata

**Analog search scope:** `src/engine/element/`, `src/engine/flow/`, `src/session/`, `src/testing/`, `src/ui/components/`, `src/ui/global.d.ts`, `src/utils/random.ts`, `src/runtime/runner.ts`
**Files scanned:** 15 read directly (game.ts, space.ts, element-collection.ts, flow/types.ts, walk-flow-nodes.ts, test-game.ts, simulate-action.ts, assertions.ts, random-simulation.ts, pick-handler.ts, pending-action-manager.ts, game-session.ts, GameShell.devtools.ts, global.d.ts, runner.ts) + CONTEXT.md/RESEARCH.md
**Pattern extraction date:** 2026-07-01
