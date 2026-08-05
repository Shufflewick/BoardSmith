# boardsmith/testing

> Test utilities for BoardSmith games.

## When to Use

Import from `boardsmith/testing` when writing tests for your game logic. This package provides utilities for creating test games, reading typed observable state, driving a game to completion, simulating individual actions, and making assertions with actionable failure messages.

## Usage

```typescript
import {
  TestGame,
  createTestGame,
  playUntilComplete,
  assertActionSucceeds,
  assertFlowState,
} from 'boardsmith/testing';
```

## Exports

### Test Game Creation

- `TestGame` - Test game wrapper around `GameRunner`; also exposes `getPlayerView()` (typed observable state) and `action()` (returns an `ActionBuilder`). `doAction()` throws an `ActionExecutionError` (with an actionable `debugActionAvailability` trace) on failure — use `tryAction()` for tests that deliberately exercise the failure path.
- `createTestGame()` - Convenience function wrapping `TestGame.create()`
- `ActionExecutionError` - Structured error thrown by `doAction()` on failure; carries `actionName`, `playerSeat`, `args`, and the engine `result` for `instanceof` handling in tests

### Action Simulation

- `simulateAction()` - Simulate a single action, returning a result annotated with the action/seat/args attempted
- `simulateActions()` - Simulate a sequence of `[playerSeat, actionName, args?]` tuples
- `assertActionSucceeds()` - Perform an action and throw (with the engine error) if it fails
- `assertActionFails()` - Perform an action and throw if it *succeeds*; optionally match the error message
- `playUntilComplete()` - Drive a game to completion by auto-selecting legal moves; throws `GameStuckError` instead of hanging
- `GameStuckError` - Structured error thrown by `playUntilComplete()` when the game cannot progress
- `ActionBuilder` - Fluent builder for multi-step / dependent-selection actions (returned by `TestGame.action()`)

### Random Simulation

- `simulateRandomGames()` - Run many randomized playthroughs for completeness/robustness testing
- `replayRandomGame()` - Replay a single random-simulation run from its recorded seed/moves for debugging

### Assertions

- `assertFlowState()` - Assert current player / available actions / phase / completion state
- `assertGameFinished()` - Assert the game is complete, optionally checking winner(s)
- `assertActionAvailable()` - Assert an action is available to a player; **auto-traces the failure** if not
- `assertActionNotAvailable()` - Assert an action is *not* available to a player

### Debug Utilities

- `toDebugString()` - Render game state (players, element tree) as a human-readable string
- `traceAction()` - Walk an action's condition + selections and report why it is/isn't available
- `logAvailableActions()` - Summarize every registered action's availability for a player
- `diffSnapshots()` - Diff two JSON-serialized snapshots and describe what changed

### Tutorial DSL

- `simulateTutorial()` - Drive a tutorial script through a sequence of expected steps
- `assertTutorialStep()` / `assertTutorialCompletes()` - Assertions over tutorial simulation results

### Types

- `TestGameOptions` - Test game creation options (`playerCount`, `playerNames`, `seed`, `autoStart`, plus any game-specific constructor options). `seed` defaults to a fixed literal (`'test-seed'`) — never `Date.now()`/`Math.random` — so two seedless `TestGame.create()`/`createTestGame()` calls are deterministic and reproduce identical shuffles/command history. The resolved seed (fixed default or caller-supplied) is exposed via `testGame.seed` and included in `doAction`/`assertActionAvailable`/`playUntilComplete` failure messages so a failing run is one copy-paste from a deterministic repro.
- `SimulateActionResult` - Action simulation result (extends `ActionExecutionResult` with `action`/`playerSeat`/`args`)
- `PlayUntilCompleteOptions` - Options for `playUntilComplete()` (`maxMoves`, `strategy`, `rng`)
- `SimulateRandomGamesOptions`, `ReplayRandomGameOptions`, `SingleGameResult`, `SimulationResults` - Random simulation types
- `ExpectedFlowState`, `FlowStateAssertionResult` - `assertFlowState()` input/output types
- `DebugStringOptions`, `ActionTraceResult`, `ActionTraceDetail` - Debug utility types
- `TutorialScenarioMove`, `SimulateTutorialOptions`, `SimulateTutorialResult` - Tutorial DSL types

## Examples

### Basic Test

```typescript
import { describe, test } from 'vitest';
import { createTestGame, assertFlowState, assertActionSucceeds } from 'boardsmith/testing';
import { GoFishGame } from '../src/game';

describe('Go Fish', () => {
  test('player can ask for a card', () => {
    const game = createTestGame(GoFishGame, { playerCount: 2 });

    // Verify initial state
    assertFlowState(game, {
      currentPlayer: 1,
      actions: ['ask'],
    });

    // Perform an action
    assertActionSucceeds(game, 1, 'ask', {
      target: 2,
      rank: '7',
    });
  });
});
```

Note: player seats throughout `boardsmith/testing` are **1-indexed** (`getPlayer(1)`, `doAction(1, ...)`), matching `Player.seat`.

### Reading Typed Observable State

Don't parse `getSnapshot()` JSON to check game-specific properties in tests. There are two correct read patterns, both on `TestGame`:

```typescript
import { createTestGame } from 'boardsmith/testing';
import { GoFishGame } from '../src/game';

const testGame = createTestGame(GoFishGame, { playerCount: 2 });

// Pattern 1 — perspective-correct observable state (flow/action assertions).
// getPlayerView() runs the state through the same per-player filtering the
// production UI receives, so hidden info (opponent hands, etc.) is excluded.
const view = testGame.getPlayerView(1);   // PlayerStateView
view.flowState?.availableActions;         // what actions are available to seat 1
view.complete;                            // has the game ended?
view.phase;                               // current game phase name

// Pattern 2 — typed per-game custom properties (domain state).
testGame.game.deckSize;   // typed as your Game subclass property, full IDE autocomplete
testGame.game.score;      // no JSON parsing required
```

`view.state` is an `ElementJSON` tree intended for the UI renderer, not for domain assertions — use `testGame.game.<prop>` for game-specific state instead.

### Driving a Game to Completion

`playUntilComplete()` auto-selects legal moves (via `enumerateLegalMoves`) for whichever seat(s) are active — sequential (`currentPlayer`) or simultaneous (`awaitingPlayers`) — until the game finishes. It never hangs: instead of looping forever on a stuck game, it throws a `GameStuckError` with enough detail to diagnose the cause.

```typescript
import { createTestGame, playUntilComplete, GameStuckError } from 'boardsmith/testing';

test('game always reaches a terminal state', () => {
  const testGame = createTestGame(MyGame, { playerCount: 2 });

  playUntilComplete(testGame);  // strategy: 'random' by default

  expect(testGame.isComplete()).toBe(true);
});

// Deterministic run for reproducible snapshots:
playUntilComplete(testGame, { strategy: 'first' });

// Reproducible random run with a stub rng:
playUntilComplete(testGame, { rng: () => 0 });
```

When the game can't progress, `playUntilComplete` throws instead of hanging:

```typescript
try {
  playUntilComplete(testGame, { maxMoves: 200 });
} catch (err) {
  if (err instanceof GameStuckError) {
    console.log(err.message);
    // "Game stuck at iteration 4: seat 2 has no enumerable legal moves.
    //  Available actions: [name]. If these actions require text/number
    //  input they cannot be auto-enumerated — use doAction() directly. ..."
    console.log(err.availableActions);  // ['name']
    console.log(err.flowState);         // full FlowState snapshot at failure
  }
}
```

`GameStuckError` fires in three cases, each with a distinct actionable message: a dead-end (active seat, zero enumerable legal moves — e.g. a text/number-input action that must be driven with `doAction()` directly), every enumerated move failing execution (a mismatch between `chooseFrom()` choices and `execute()` preconditions), or the `maxMoves` cap being reached without completion.

### Simulating Individual Actions

```typescript
import { createTestGame, simulateAction, assertActionSucceeds, assertActionFails } from 'boardsmith/testing';

const testGame = createTestGame(CheckersGame, { playerCount: 2 });

const result = simulateAction(testGame, 1, 'move', { from: 'a3', to: 'b4' });
expect(result.success).toBe(true);

// Throws with the engine's error message if the action fails.
assertActionSucceeds(testGame, 1, 'move', { from: 'a3', to: 'b4' });

// Throws if the action *succeeds* unexpectedly; optionally match the error.
assertActionFails(testGame, 2, 'move', { from: 'a3', to: 'b4' }, 'not your turn');
```

### ActionBuilder — Multi-Step / Dependent Selections

For actions with multiple `chooseFrom()` selections — especially where later choices depend on earlier ones — build args step by step instead of guessing valid combinations by hand. `TestGame.action(name, seat)` returns an `ActionBuilder`; `getChoices()` only ever returns **enabled** choices (`disabled === false`), so it's impossible to accidentally select an invalid value.

```typescript
// Action 'categorize': choose a category, then an item whose valid choices
// depend on which category was picked.
const builder = testGame.action('categorize', 1);

const categories = builder.getChoices('category');   // e.g. ['A'] — 'B' is disabled, filtered out
builder.select('category', categories[0]);

const items = builder.getChoices('item');             // choices for category='A', e.g. [10, 20, 30]
builder.select('item', items[0]).execute();            // throws a descriptive error on failure

// Or fully chained:
testGame.action('categorize', 1)
  .select('category', 'A')
  .select('item', 10)
  .execute();

// Inspect accumulated args without executing (e.g. to hand off to doAction directly):
const args = testGame.action('move', 1).select('destination', 'b4').buildArgs();
// { destination: 'b4' }
```

`ActionBuilder` delegates to `game.getSelectionChoices()`, the same engine call the production UI uses to resolve dependent selections — there's no separate evaluation logic to drift out of sync.

### Assertions with Auto-Trace

When `assertActionAvailable()` fails, it doesn't just say an action is unavailable — it calls `game.debugActionAvailability()` and includes *why*: the failing condition and, for each selection, whether it passed and how many choices it had.

```typescript
import { assertActionAvailable } from 'boardsmith/testing';

assertActionAvailable(testGame, 1, 'equipItem');
// Error: Action "equipItem" is not available for player 1.
// Available actions: [pick, pass]
// Why: Selection 'equipment' has no valid choices
// Selections:
//   ✓ 'slot': 1 choices
//   ✗ 'equipment': 0 choices — no unequipped items in inventory
```

`assertActionNotAvailable()` is the inverse — it passes if the seat can't act at all, or the action just isn't in that seat's available list.

### Flow State: `actionsMode` — exact vs. contains

`assertFlowState()`'s `actions` check is **exact by default**: both missing and extra available actions fail the assertion. Opt into `actionsMode: 'contains'` when a test only cares that certain actions are present and doesn't want to enumerate every other action the flow happens to expose.

```typescript
import { assertFlowState } from 'boardsmith/testing';

// Exact (default) — fails if 'pass' is also available but not listed here.
assertFlowState(testGame, {
  currentPlayer: 1,
  actions: ['move', 'attack'],
});

// Contains — only fails if 'move' is missing; other available actions are fine.
assertFlowState(testGame, {
  currentPlayer: 1,
  actions: ['move'],
  actionsMode: 'contains',
});
```

`assertFlowState` handles both sequential turns (`flowState.currentPlayer` / `availableActions`) and simultaneous turns (`flowState.awaitingPlayers[*].availableActions`) transparently — the `actions` check is against the union of available actions for whichever seats are currently active.

### Random Game Simulation

```typescript
import { simulateRandomGames } from 'boardsmith/testing';

test('game always terminates', async () => {
  const results = await simulateRandomGames(MyGame, {
    count: 100,
    playerCounts: [2],
    maxActions: 1000,
  });

  expect(results.completed).toBe(100);
  expect(results.stuck).toBe(0);
  expect(results.errors).toHaveLength(0);

  console.log(`Average game length: ${results.averageActions} actions`);
});
```

### Debugging Test Failures

```typescript
import { createTestGame, toDebugString, traceAction, logAvailableActions } from 'boardsmith/testing';

const testGame = createTestGame(MyGame, { playerCount: 2 });

// Print current game state
console.log(toDebugString(testGame.game));
// Game: MyGame
// Phase: playing
// Current Player: Player 1 (position 0)
//
// Players:
//   [1] Player 1: score=10, hand(5)
//   [2] Player 2: score=15, hand(4)
//
// Elements:
//   Deck (id=1): 32 children
//   DiscardPile (id=2): 10 children

// Trace why an action fails (game, actionName, player?)
const trace = traceAction(testGame.game, 'move', testGame.getPlayer(1));
console.log(trace.reason);
// "No valid elements for selection 'destination'"

// Summarize all actions' availability for a player
console.log(logAvailableActions(testGame.game, testGame.getPlayer(1)));
// Available actions for Player 1:
//   ✓ move - Action available
//   ✗ attack - No valid elements for selection 'target'
```

### Asserting Hidden Information (VIS)

Don't eyeball a `toJSON()` dump to check whether a card's rank leaked to the
wrong seat — assert it. These utilities are all derived from the same final,
post-`playerView` serialized tree the production UI actually receives
(`game.toJSONForPlayer(seat)`), so a passing assertion means the real wire
bytes are safe, not just that `element.isVisibleTo()` says so.

```typescript
import { isElementVisible, getVisibleElements, assertHidden, assertVisible } from 'boardsmith/testing';

const opponentHand = testGame.game.getPlayer(2)!.hand;

// Is a specific element visible to seat 1?
isElementVisible(opponentHand.first()!, 1); // false — opponent's hand is hidden

// All elements currently visible to seat 1
const visible = getVisibleElements(testGame.game, 1);

// Assertion form — throws with the surviving attribute keys on failure
assertHidden(opponentHand.first()!, 1);
assertVisible(testGame.game.getPlayer(1)!.hand.first()!, 1);
```

`TestGame` also exposes these as delegate methods: `testGame.isElementVisible(element, seat)` /
`testGame.getVisibleElements(seat)`.

**`diffPlayerViews(viewA, viewB)`** classifies every node across two
`PlayerStateView`s (e.g. two different seats' `getPlayerView()` results) into
`bothVisible` / `onlyInA` / `onlyInB` / `bothHidden` — useful for asserting
"this element is visible to me but not my opponent" without manually walking
both trees:

```typescript
import { diffPlayerViews } from 'boardsmith/testing';

const diff = diffPlayerViews(testGame.getPlayerView(1), testGame.getPlayerView(2));
// diff.onlyInA -- elements visible to seat 1 but hidden from seat 2 (e.g. seat 1's own hand)
```

Classification is judged purely by each node's `__hidden` flag (never by id),
which sidesteps the engine's zone-hidden-vs-individually-hidden
id-anonymization asymmetry.

**`renderAsSeat(testGame, seat, options?)` / `assertNoHiddenInfoLeak(testGame,
seat, options?)`** go one level deeper than JSON-tree checks: they mount a real
Vue renderer stack in `jsdom` and scan the actual rendered DOM for hidden-info
leaks — the class of bug a JSON-tree assertion can miss entirely (e.g. a
renderer that accidentally prints a hidden card's rank into a tooltip `title`
attribute). Both are `async` because mounting is real Vue component work, not a
synchronous JSON walk.

```typescript
import { assertNoHiddenInfoLeak } from 'boardsmith/testing';

test('opponent card rank/suit never appears in the DOM for seat 2', async () => {
  await assertNoHiddenInfoLeak(testGame, 2);
});
```

**If your game ships a custom board, pass `component`.** The default renders
AutoUI, and AutoUI's markup says nothing about markup your game wrote itself —
so for a custom-UI game a green result without this option is close to
meaningless, which is exactly the case hidden information matters most:

```typescript
import GameTable from '../src/ui/components/GameTable.vue';

await assertNoHiddenInfoLeak(testGame, 2, { component: GameTable });
```

The standard scaffold props (`playerSeat`, `isMyTurn`, `availableActions`,
`actionController`) are supplied automatically from real game state and
filtered to the props your component declares, so most boards need nothing
else. Add `componentProps` for anything beyond that contract. `gameView` is
always the real per-seat view and cannot be overridden through
`componentProps` — rendering any other tree would invalidate the scan.

`assertNoHiddenInfoLeak` derives forbidden markers by diffing each element's
*unfiltered* `toJSON()` against its node in the final `toJSONForPlayer(seat)`
tree, so it honors a game's `static playerView` hook automatically. Pass an
`allow` predicate to exclude known-safe, coincidentally-colliding substrings
(the predicate is scoped **per elementId**, not global):

```typescript
await assertNoHiddenInfoLeak(testGame, 2, {
  // e.g. single-character rank/suit values that legitimately collide with
  // unrelated visible text elsewhere in the DOM.
  allow: (marker, ctx) => ctx.attribute === 'rank' || ctx.attribute === 'suit',
});
```

**Always pair a leak assertion with a positive control** — a test that
deliberately splices a real hidden identity into the rendered view (via a
`gameViewOverride`) and asserts `assertNoHiddenInfoLeak` *throws*. Without
this, a broken matcher that never fires would pass silently forever. See
`~/BoardSmithGames/go-fish/tests/no-hidden-info-dom-leak.test.ts` for a
worked flagship example (natural leak-free assertion + positive control).

### Animation Traces (ANIM test mode)

Assert what actually animated — headlessly, no browser, no visual diffing —
by turning on animation test mode before driving actions and reading back a
structured trace afterward.

```typescript
import { enableAnimationTestMode, getAnimationTrace, clearAnimationTrace, disableAnimationTestMode } from 'boardsmith/testing';
// (also exported from 'boardsmith/ui' — same module, either import path works)

beforeEach(() => enableAnimationTestMode());
afterEach(() => disableAnimationTestMode());

test('asking for a card flies it from the pond to the hand', () => {
  clearAnimationTrace();
  testGame.doAction(1, 'ask', { target: 2, rank: '7' });

  const trace = getAnimationTrace();
  expect(trace).toContainEqual(
    expect.objectContaining({ kind: 'fly', element: '7', from: 'pond', to: 'hand' }),
  );
});
```

Each `AnimationTrace` entry has the shape `{ kind, element, from, to, meta? }` —
`element`/`from`/`to` hold assertable container/element **identity** strings
(never hidden-info payloads); richer data like rects/deltas lives under
`meta`. Test mode is `OFF` by default and independent of
`prefers-reduced-motion` (that's a distinct accessibility concern, not a
test-harness one) — always `enableAnimationTestMode()` explicitly in a
`beforeEach`, and `clearAnimationTrace()` between assertions in the same test
to avoid cross-action trace bleed. See
`~/BoardSmithGames/demo-animation/tests/animation-trace.test.ts` for a
worked composable-level example.

### Headless Simulation (SIM)

**`createHeadlessSession`** (from `boardsmith/session`) drives a game to
completion the same way a real hosted session would, without any WebSocket
or storage layer — the seeded-run building block behind CI smoke tests and
reproducible agent benchmarking:

```typescript
import { createHeadlessSession } from 'boardsmith/session';
import { gameDefinition } from '../src/rules/game.js'; // your game's exported GameDefinitionLike

const session = createHeadlessSession(
  gameDefinition,
  { playerCount: 2, seed: 'ci-seed-1' },
  [{ seat: 2, level: 'easy' }], // optional AI seats
);

await session.start();
await session.send(1, { type: 'action', actionName: 'ask', player: 1, args: { target: 2, rank: '7' } });
// session.broadcasts accumulates each structuredClone'd broadcast for assertions
```

For a project-level CI check with no test file to write at all, use the
`boardsmith simulate` CLI — it runs many randomized playthroughs of your
project's game and reports pass/stuck/error:

```bash
boardsmith simulate --games 50 --seed ci-run-1 --players 2 --json
```

- `--games` — number of games to simulate (default `10`)
- `--seed` — base seed; re-running with the same seed reproduces the same
  set of per-game seeds
- `--players` — player count for each simulated game (default `2`)
- `--json` — machine-readable output (array of `{ index, seed, status, turns, winner, error? }`)

Exit code is `0` only if every game reaches `status: 'complete'`; any
`'stuck'` or `'error'` game sets a non-zero exit code, so `boardsmith
simulate` can gate CI directly. A failing game's output includes a replay
line:

```
Game 3 stuck (seed ci-run-1-3).
Replay: boardsmith simulate --games 1 --seed ci-run-1-3
```

Re-running that single-game command reproduces the exact failure
deterministically — see [Determinism & Seeding](../agent-control.md#determinism--seeding)
for why the same seed always replays identically.

### Flow-Position Debugging (FLOW)

When a test or agent needs to know exactly where a game's flow currently is
— which phase, which named step, how deep into nested `loop()`/`eachPlayer()`
nodes — use `getFlowDebugInfo()`/`describeFlowPosition()` instead of manually
inspecting `FlowState`:

```typescript
const info = testGame.getFlowDebugInfo(); // FlowDebugInfo
console.log(info.describe()); // e.g. "phase 'playing', step 'discard', awaiting seat 1"
info.phase; // current FlowState.currentPhase
info.step;  // named step, or the node's type when unnamed
info.path;  // the raw FlowPosition path that produced this
```

`FlowDebugInfo` is also embedded automatically in `GameStuckError.flowState`
and in assertion failure messages (`assertActionAvailable`,
`toDebugString`) — you don't need to call it manually just to get a
readable diagnostic on a failing test.

For mid-multi-step-action state (a player is partway through a
multi-selection action), use `TestGame.getPendingAction(seat)`:

```typescript
const pending = testGame.getPendingAction(1); // PendingActionState | undefined
pending?.actionName;       // the action currently being built
pending?.completedSteps;   // selections already made
```

To see **why** a choice is disabled (not just that it is), use
`TestGame.getActionSpaceWithChoices(seat)` — it composes the existing
`getActionSpace()` + `getSelectionChoices()` calls into one view where every
choice carries a `disabled`/reason flag, rather than writing a new
availability evaluator per test:

```typescript
const spaceWithChoices = testGame.getActionSpaceWithChoices(1);
// spaceWithChoices.actions[0].selections[0].choices — [{ value, disabled, reason? }, ...]
```

## See Also

- [Common Pitfalls](../common-pitfalls.md) - Common issues and solutions
- [boardsmith](./index.md) - Core game engine
- [Agent Control](../agent-control.md) - Scriptable dev host, structured errors, determinism & seeding
