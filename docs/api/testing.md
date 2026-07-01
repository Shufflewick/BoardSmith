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

- `TestGame` - Test game wrapper around `GameRunner`; also exposes `getPlayerView()` (typed observable state) and `action()` (returns an `ActionBuilder`)
- `createTestGame()` - Convenience function wrapping `TestGame.create()`

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

- `TestGameOptions` - Test game creation options (`playerCount`, `playerNames`, `seed`, `autoStart`, plus any game-specific constructor options)
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
    playerCount: 2,
    gameCount: 100,
    maxActions: 1000,
  });

  expect(results.completed).toBe(100);
  expect(results.stuck).toBe(0);
  expect(results.errors).toHaveLength(0);

  console.log(`Average game length: ${results.averageActions} actions`);
  console.log(`Win rates: ${JSON.stringify(results.winRates)}`);
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

## See Also

- [Common Pitfalls](../common-pitfalls.md) - Common issues and solutions
- [boardsmith](./index.md) - Core game engine
