# boardsmith/testing

> Test utilities for BoardSmith games.

## When to Use

Import from `boardsmith/testing` when writing tests for your game logic. This package provides utilities for creating test games, simulating actions, making assertions, and debugging game state.

## Usage

```typescript
import {
  createTestGame,
  simulateAction,
  assertFlowState,
  assertActionSucceeds,
  toDebugString,
} from 'boardsmith/testing';
```

## Exports

### Test Game Creation

- `TestGame` - Test game wrapper class
- `createTestGame()` - Create a test game instance

### Action Simulation

- `simulateAction()` - Simulate a single action
- `simulateActions()` - Simulate multiple actions
- `assertActionSucceeds()` - Assert action succeeds
- `assertActionFails()` - Assert action fails

### Random Simulation

- `simulateRandomGames()` - Run random game simulations for completeness testing

### Assertions

- `assertFlowState()` - Assert flow state matches expected
- `assertPlayerHas()` - Assert player has specific elements
- `assertElementCount()` - Assert element count
- `assertGameFinished()` - Assert game is finished
- `assertActionAvailable()` - Assert action is available
- `assertActionNotAvailable()` - Assert action is not available

### Fixtures and Scenarios

- `ScenarioBuilder` - Build test scenarios fluently
- `scenario()` - Create a scenario builder
- `quickGame()` - Create a quick game setup
- `playSequence()` - Play a sequence of actions
- `playUntil()` - Play until condition is met
- `createMultiple()` - Create multiple test games

### Debug Utilities

- `toDebugString()` - Convert game state to debug string
- `traceAction()` - Trace action execution
- `visualizeFlow()` - Visualize flow definition
- `visualizeFlowWithPosition()` - Visualize with current position
- `debugFlowState()` - Debug flow state
- `logAvailableActions()` - Log available actions
- `diffSnapshots()` - Diff two state snapshots

### Types

- `TestGameOptions` - Test game creation options
- `SimulateActionResult` - Action simulation result
- `SimulateRandomGamesOptions` - Random simulation options
- `SingleGameResult` - Single game simulation result
- `SimulationResults` - Aggregated simulation results
- `ExpectedFlowState` - Expected flow state
- `FlowStateAssertionResult` - Assertion result
- `DebugStringOptions` - Debug string options
- `ActionTraceResult` - Action trace result
- `ActionTraceDetail` - Action trace detail
- `FlowStateDebug` - Flow state debug info

## Examples

### Basic Test

```typescript
import { describe, test, expect } from 'vitest';
import { createTestGame, assertFlowState, assertActionSucceeds } from 'boardsmith/testing';
import { GoFishGame } from '../src/game';

describe('Go Fish', () => {
  test('player can ask for a card', () => {
    const game = createTestGame(GoFishGame, { playerCount: 2 });

    // Verify initial state
    assertFlowState(game, {
      currentPlayer: 0,
      actions: ['ask'],
    });

    // Perform an action
    assertActionSucceeds(game, 0, 'ask', {
      target: 1,
      rank: '7',
    });
  });
});
```

### Simulating Actions

```typescript
import { createTestGame, simulateAction } from 'boardsmith/testing';

const game = createTestGame(CheckersGame, { playerCount: 2 });

// Simulate a move
const result = simulateAction(game, 0, 'move', {
  from: 'a3',
  to: 'b4',
});

expect(result.success).toBe(true);
expect(result.state.board.children).toHaveLength(24);
```

### Using Scenario Builder

```typescript
import { scenario } from 'boardsmith/testing';

test('capturing a piece', () => {
  const game = scenario(CheckersGame)
    .withPlayers(2)
    .setup((g) => {
      // Set up specific board position
      g.board.at(2, 2).create(Piece, 'checker', { player: 0 });
      g.board.at(3, 3).create(Piece, 'checker', { player: 1 });
    })
    .build();

  // Test capturing
  assertActionSucceeds(game, 0, 'move', {
    from: { row: 2, col: 2 },
    to: { row: 4, col: 4 },
  });

  // Verify piece was captured
  assertElementCount(game, Piece, 1);
});
```

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
import { createTestGame, toDebugString, traceAction, visualizeFlow } from 'boardsmith/testing';

const game = createTestGame(MyGame, { playerCount: 2 });

// Print current game state
console.log(toDebugString(game));
// Output:
// Game: MyGame
// Phase: playing
// Current Player: 0
// Board:
//   - Space "a1": Piece(white)
//   - Space "a2": empty
//   ...

// Trace why an action fails
const trace = traceAction(game, 0, 'move', { from: 'a1', to: 'c3' });
console.log(trace);
// Output:
// Action: move
// Player: 0
// Args: { from: "a1", to: "c3" }
// Status: FAILED
// Reason: Target space is not adjacent
// Conditions evaluated:
//   - isValidPiece: true
//   - isAdjacent: false (c3 is 2 squares away)

// Visualize game flow
console.log(visualizeFlow(game));
// Output:
// sequence
// ├── setup
// ├── loop (until: game.isOver())
// │   └── eachPlayer
// │       └── actionStep [current] -> "move"
// └── scoring
```

### Testing Edge Cases

```typescript
import { createTestGame, playUntil, assertGameFinished } from 'boardsmith/testing';

test('game handles draw correctly', () => {
  const game = createTestGame(TicTacToeGame, { playerCount: 2 });

  // Play until board is full (draw scenario)
  playUntil(game, (g) => g.board.all(Piece).length === 9);

  assertGameFinished(game, {
    winner: null, // Draw
    reason: 'board-full',
  });
});
```

## See Also

- [Common Pitfalls](../common-pitfalls.md) - Common issues and solutions
- [boardsmith](./index.md) - Core game engine
