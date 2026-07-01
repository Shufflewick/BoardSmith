# Agent Control: Driving a Game Headlessly

This guide is for AI agents (and developers writing bots, tree-search AI, or
CI harnesses) that need to drive a BoardSmith game **without a browser** —
no DOM, no WebSocket, no UI. Everything here runs in-process against a
`Game` instance.

If you instead want to drive the game **through the real UI in a browser**
(clicking elements, listening for `boardsmith:action-resolved`), see
[Browser Testing](./browser-testing.md). For test-specific ergonomics
(`TestGame`, `playUntilComplete`, assertions), see
[boardsmith/testing](./api/testing.md) — this guide focuses on the raw
engine introspection APIs those utilities are built on.

## The Headless Loop

Every headless agent follows the same five steps:

1. **Create** — construct a game (directly, or via `TestGame` for
   convenience).
2. **Inspect** — read the current legal action space for a seat.
3. **Enumerate** — expand that action space into concrete, ready-to-submit
   moves (useful for tree search / MCTS-style agents).
4. **Submit** — build validated args and perform the action.
5. **Assert** — read the resulting state back through a perspective-aware
   view.

```typescript
import { createTestGame } from 'boardsmith/testing';
import { GoFishGame } from '../src/rules/game.js';

// 1. Create
const testGame = createTestGame(GoFishGame, {
  playerCount: 2,
  seed: 'agent-demo',
});

// 2. Inspect — what can seat 1 legally do right now?
const space = testGame.game.getActionSpace(1);
console.log(space.actions.map(a => a.name)); // e.g. ['ask']

// 3. Enumerate — every concrete legal move for seat 1
const moves = enumerateLegalMoves(testGame.game, 1);
console.log(moves[0]); // { action: 'ask', args: { target: 2, rank: '7' } }

// 4. Submit
const result = testGame.doAction(1, moves[0].action, moves[0].args);
if (!result.success) throw new Error(result.error);

// 5. Assert — perspective-correct state, hidden info excluded
const view = testGame.getPlayerView(1);
console.log(view.flowState?.availableActions);
```

`enumerateLegalMoves` is imported from `'boardsmith'` (the engine package),
not from `'boardsmith/testing'`:

```typescript
import { enumerateLegalMoves } from 'boardsmith';
```

`TestGame` (from `boardsmith/testing`) is the recommended entry point for
headless driving — it wraps `GameRunner` and exposes `doAction`,
`getPlayerView`, `getFlowState`, and `getSnapshot` without any server or
transport concerns. `createTestGame(GameClass, options)` is a thin
convenience wrapper around `TestGame.create`. See
[boardsmith/testing](./api/testing.md) for the full surface (assertions,
`playUntilComplete`, `ActionBuilder`, etc.) — this guide only covers the
introspection primitives those utilities are built on.

All player seats throughout the engine, session, and testing layers are
**1-indexed** (`Player.seat`, `doAction(1, ...)`, `getActionSpace(1)`).

## Introspection APIs

These five methods/functions are the complete headless introspection
surface. All of them are pure reads (or, for `buildActionArgs`, pure
validation) — none of them mutate game state.

### `game.getActionSpace(seat)`

Returns every action `seat` can **legally execute right now** — condition
already checked — with static selection metadata and a ready-to-submit
"arg template" that shows which selections still need a value.

```typescript
interface ActionSpaceView {
  actions: ActionSchemaView[];
}

interface ActionSchemaView {
  name: string;
  prompt?: string;
  help?: string;
  selections: PickMetadata[];          // one entry per chooseFrom()/chooseElement()
  argTemplate: Record<string, null | { __required: true }>;
}
```

`argTemplate` uses `null` for optional selections (a natural "not yet
filled, and that's fine") and `{ __required: true }` as a sentinel for
required selections that still need a value — a plain empty string or `-1`
would be ambiguous for a legitimately-empty required text field.

```typescript
const space = testGame.game.getActionSpace(1);
for (const action of space.actions) {
  console.log(action.name, action.argTemplate);
  // 'move' { target: { __required: true }, note: null }
}
```

`getActionSpace` returns only actions whose `condition()` currently passes.
If an action is registered but its condition is false, it does not appear
here — use `getActionSchema` if you need the schema regardless of current
availability.

### `game.getActionSchema(actionName, seat)`

Returns the static schema (`ActionMetadata`) for a single named action,
**without checking whether it's currently available**. Use this to inspect
a registered action's shape up front (e.g. for a UI skeleton, a tutorial
overlay, or building a static agent action catalog) — use `getActionSpace`
when you need condition-filtered, currently-legal actions only.

```typescript
interface ActionMetadata {
  name: string;
  prompt?: string;
  help?: string;
  selections: PickMetadata[];
}
```

```typescript
const schema = testGame.game.getActionSchema('ask', 1);
// schema?.selections → [{ name: 'target', type: 'choice', ... }, { name: 'rank', type: 'choice', ... }]
```

For **dynamic** choices (what values a selection currently accepts, given
values chosen for earlier selections), call
`game.getSelectionChoices(actionName, selectionName, player, currentArgs)`
directly — no server round-trip is required for in-process/headless use:

```typescript
const player = testGame.getPlayer(1);
const rankChoices = testGame.game.getSelectionChoices('ask', 'rank', player, { target: 2 });
// AnnotatedChoice<unknown>[] — filter to `c.disabled === false` for legal choices
```

(`ActionBuilder`, from `boardsmith/testing`, wraps exactly this call for
ergonomic multi-step selection — see
[boardsmith/testing](./api/testing.md#actionbuilder-multi-step--dependent-selections).)

### `buildActionArgs(actionName, selectionValues, game, seat, options?)`

Validates a record of plain selection values (element objects, strings,
numbers, …) against an action's declared selections and returns
ready-to-submit args.

```typescript
import { buildActionArgs } from 'boardsmith';

const args = buildActionArgs('ask', { target: 2, rank: '7' }, testGame.game, 1);
testGame.doAction(1, 'ask', args);
```

Throws (with an actionable message) if the action is unknown, the seat has
no player, a supplied key isn't a declared selection name, or a required
selection is missing.

By default (`format: 'in-process'`), element-object values pass through
unchanged — the result is ready for `testGame.doAction` /
`runner.performAction` in the same process. Pass `{ format: 'wire' }` to
convert element/player values to `{ __elementId }` / `{ __playerRef }`
references for cross-process transmission (e.g. a remote agent submitting
an action over WebSocket):

```typescript
const wireArgs = buildActionArgs('move', { target: token }, game, 1, { format: 'wire' });
// JSON.stringify-safe — send this over the wire, not the in-process form
```

### `enumerateLegalMoves(game, seat, options?)`

Expands the current action space into every **concrete** legal move —
each declared selection resolved to every combination of its legal
choices. This is the primitive tree-search agents (MCTS, minimax, random
playout) need: a flat list of `{ action, args }` pairs, each one directly
submittable.

```typescript
import { enumerateLegalMoves } from 'boardsmith';

const moves = enumerateLegalMoves(testGame.game, 1);
// [{ action: 'ask', args: { target: 2, rank: '7' } }, { action: 'ask', args: { target: 2, rank: 'K' } }, ...]

const move = moves[Math.floor(Math.random() * moves.length)];
testGame.doAction(1, move.action, move.args);
```

Args are returned in **in-process** format (element objects, not IDs) —
pass them straight to `doAction`/`performAction`, or run them through
`buildActionArgs(..., { format: 'wire' })` for cross-process use.

By default enumeration is exhaustive. `text`/`number` selections and
function-based `multiSelect` configs cannot be statically enumerated —
optional ones are skipped, required ones block the whole action from
appearing (you'll need `doAction` directly for those). Pass
`{ maxPerAction: N }` to cap the number of moves returned per action name
(useful when an action's combinatorics are large and you only need a
sample):

```typescript
enumerateLegalMoves(testGame.game, 1, { maxPerAction: 20 });
```

`playUntilComplete` (from `boardsmith/testing`) is built directly on this
function — see [boardsmith/testing](./api/testing.md#driving-a-game-to-completion)
if you just need "drive to completion," not raw enumeration.

### `game.getPlayerView(seat)` / `testGame.getPlayerView(seat)`

Returns a **perspective-aware, typed** snapshot of the game as `seat` sees
it — hidden information (opponents' hands, face-down decks, etc.) is
already filtered out. This is the same view the production UI receives;
never read state via raw `game.toJSON()` for agent decision-making, or
you'll leak hidden information the agent isn't entitled to see.

```typescript
interface PlayerStateView {
  player: number;
  state: ElementJSON;                    // UI-shaped state tree; hidden elements obscured
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
  };
  messages: Array<{ text: string; data?: Record<string, unknown> }>;
  phase: string;
  complete: boolean;
  winners?: number[];
}
```

```typescript
const view = testGame.getPlayerView(1);
if (view.complete) console.log('winners:', view.winners);
```

`view.state` is an `ElementJSON` tree shaped for the UI renderer — don't
parse it to read game-specific domain properties. In-process (headless or
test) callers should read typed custom properties directly off the game
instance instead:

```typescript
testGame.game.score;      // typed as your Game subclass property
testGame.game.deckSize;   // no JSON parsing, full IDE autocomplete
```

`createPlayerView(game, seat)` (from `'boardsmith'`) is the lower-level
function `getPlayerView` delegates to, for callers that only have a raw
`Game` instance and not a `TestGame`/`GameRunner`.

## Undo, Checkpoint & Replay

BoardSmith's game state is event-sourced: every action appends to a
recorded history, and the current state is always reconstructible by
replaying that history from the start. Time-travel — undo, rewind, and
diffing — is built on this, not on ad-hoc snapshots.

These five methods live on `GameSession` (`boardsmith/session`) — the
stateful session wrapper used by the dev server and production hosts, not
on the lower-level `TestGame`/`GameRunner`. If you're writing a headless
in-process test or bot, you likely only need `TestGame.getSnapshot()`
(below); reach for `GameSession` when you need turn-scoped undo or
debug-time-travel semantics (e.g. building a dev tool or an "undo my last
move" feature for a real session).

```typescript
import { GameSession, type UndoResult, type ElementDiff } from 'boardsmith/session';
```

- **`session.getStateAtAction(actionIndex, playerPosition)`** — reconstruct
  the perspective-correct state as of a specific point in the action
  history (replays a temporary game up to that index). Returns
  `{ success, state?, error? }`.
- **`session.getStateDiff(fromIndex, toIndex, playerPosition)`** — compute
  which element IDs were added, removed, or changed between two action
  indices. Returns `{ success, diff?: ElementDiff, error? }`.
- **`session.getActionTraces(playerPosition)`** — availability traces for
  every registered action (why each is/isn't currently available),
  equivalent to `game.debugActionAvailability()` run over the full action
  set.
- **`await session.undoToTurnStart(playerPosition)`** — undo all of a
  player's actions back to the start of their current turn. Only succeeds
  if it's currently that player's turn and they've made at least one
  action this turn. Returns a `Promise<UndoResult>`.
- **`await session.rewindToAction(targetActionIndex)`** — discard every
  action after `targetActionIndex` and continue play from there. Intended
  for debug/development use, not normal gameplay undo.

For lighter-weight snapshotting in a headless test or agent loop —
capturing the full game state to restore later without going through
`GameSession` — use `TestGame`/`GameRunner`:

```typescript
const snapshot = testGame.getSnapshot();   // GameStateSnapshot — action history + seed + metadata
```

A `GameStateSnapshot` is a self-contained, JSON-serializable record of the
game type, seed, and full action history (`SerializedAction[]`) — the
canonical way to persist a game and later reconstruct it exactly, since
the game state is fully determined by replaying that history against the
seed (see Determinism below).

## Determinism & Seeding

Every `Game` owns a seeded RNG (`game.random`, a `SeededRandom` — a
mulberry32 generator whose internal numeric state can be read and
restored). Games never call `Math.random()` directly; any in-game
randomness (shuffles, dice rolls, `choices` selection) goes through
`game.random()` so a recorded seed + action history fully determines a
replay.

```typescript
const testGame = createTestGame(GoFishGame, {
  playerCount: 2,
  seed: 'my-fixed-seed',   // any string; same seed + same actions → identical game
});
```

If you don't supply a seed, `TestGame.create` generates one
(`` `test-${Date.now()}` ``) — fine for one-off tests, but not reproducible
across runs. **Always pass an explicit `seed` when you need a reproducible
agent run** (e.g. debugging a specific failure, or comparing two agent
strategies against the identical shuffle).

```typescript
game.getRandomState(): number       // read the RNG's internal state (for custom snapshots)
game.setRandomState(state): void    // restore it — the next game.random() draw matches exactly
```

Because state is fully determined by `(seed, actionHistory)`, a replay is
just: construct a new game with the same seed, then re-submit the same
sequence of actions in order. This is exactly what
`GameSession.getStateAtAction` / `rewindToAction` do internally, and what
`GameStuckError`'s recorded `flowState` + `TestGame.getActionHistory()`
give you enough information to reproduce by hand.

```typescript
const seed = testGame.getSnapshot().seed;
const actions = testGame.getActionHistory();

const replay = createTestGame(GoFishGame, { playerCount: 2, seed });
for (const action of actions) {
  replay.doAction(action.player, action.name, action.args);
}
// `replay` now reaches the identical state as `testGame`.
```

## See Also

- [boardsmith/testing](./api/testing.md) — `TestGame`, `playUntilComplete`,
  `ActionBuilder`, assertions with auto-trace failures.
- [Browser Testing](./browser-testing.md) — driving a game through the real
  UI in a browser (DOM selection, `window.__BOARDSMITH_DEVTOOLS`,
  `boardsmith:action-resolved`).
- [Common Pitfalls](./common-pitfalls.md) — footguns to avoid, including
  unbounded `loop()` and unregistered element classes.
