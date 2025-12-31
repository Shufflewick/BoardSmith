# @boardsmith/testing

Testing utilities for BoardSmith games. Provides helpers for simulating games, asserting state, and debugging issues.

## Installation

```bash
npm install --save-dev @boardsmith/testing
```

## Quick Start

```typescript
import { createTestGame, simulateAction, assertFlowState } from '@boardsmith/testing';
import { gameDefinition } from './game';

describe('MyGame', () => {
  it('should deal cards to all players', async () => {
    const testGame = await createTestGame(gameDefinition, {
      playerCount: 2,
      seed: 12345,
    });

    // Verify initial state
    assertFlowState(testGame, { phase: 'setup' });

    // Each player should have 5 cards
    for (const player of testGame.game.players) {
      expect(player.hand.count()).toBe(5);
    }
  });
});
```

## Test Game Setup

### createTestGame

Create a game instance for testing:

```typescript
const testGame = await createTestGame(gameDefinition, {
  playerCount: 3,
  playerNames: ['Alice', 'Bob', 'Carol'],
  seed: 42,  // Optional: deterministic randomness
  gameOptions: { variant: 'advanced' },
});
```

### TestGame Object

```typescript
interface TestGame {
  game: Game;           // The game instance
  runner: GameRunner;   // Flow/action runner
  session: GameSession; // Full session (for state access)
}
```

## Simulating Actions

### simulateAction

Execute a single action:

```typescript
import { simulateAction, assertActionSucceeds } from '@boardsmith/testing';

const result = await simulateAction(testGame, 'playCard', {
  card: testGame.game.players[0].hand.first(),
});

// Or assert it succeeds
await assertActionSucceeds(testGame, 'playCard', { card: someCard });
```

### simulateActions

Execute multiple actions in sequence:

```typescript
import { simulateActions } from '@boardsmith/testing';

await simulateActions(testGame, [
  { name: 'draw', args: {} },
  { name: 'playCard', args: { card: firstCard } },
  { name: 'endTurn', args: {} },
]);
```

### assertActionFails

Verify an action cannot be taken:

```typescript
import { assertActionFails } from '@boardsmith/testing';

// Ensure player can't play a card they don't have
await assertActionFails(testGame, 'playCard', {
  card: otherPlayerCard,
});
```

## Assertions

### assertFlowState

Check the current flow state:

```typescript
import { assertFlowState } from '@boardsmith/testing';

assertFlowState(testGame, {
  phase: 'playing',
  currentPlayer: 0,  // Player position
  actions: ['play', 'draw', 'pass'],  // Available actions
});
```

### assertPlayerHas

Check elements in player zones:

```typescript
import { assertPlayerHas } from '@boardsmith/testing';

assertPlayerHas(testGame, 0, 'hand', { count: 5 });
assertPlayerHas(testGame, 0, 'hand', { element: specificCard });
assertPlayerHas(testGame, 0, 'board', { elementType: Piece, count: 3 });
```

### assertElementCount

Check element counts globally:

```typescript
import { assertElementCount } from '@boardsmith/testing';

assertElementCount(testGame, Card, 52);
assertElementCount(testGame, Piece, { min: 1, max: 10 });
```

### assertGameFinished

Verify game completion:

```typescript
import { assertGameFinished } from '@boardsmith/testing';

assertGameFinished(testGame, {
  winner: testGame.game.players[0],
});

// Or just check it's finished
assertGameFinished(testGame);
```

### assertActionAvailable / assertActionNotAvailable

Check action availability:

```typescript
import { assertActionAvailable, assertActionNotAvailable } from '@boardsmith/testing';

assertActionAvailable(testGame, 0, 'draw');  // Player 0 can draw
assertActionNotAvailable(testGame, 1, 'draw');  // Player 1 cannot
```

## Fixtures and Scenarios

### ScenarioBuilder

Build game scenarios fluently:

```typescript
import { scenario } from '@boardsmith/testing';

const testGame = await scenario(gameDefinition)
  .withPlayers(3)
  .withSeed(42)
  .setup((game) => {
    // Custom setup
    game.deck.shuffle();
    game.players[0].hand.createMany(3, Card, 'card', { suit: 'hearts' });
  })
  .build();
```

### quickGame

Create a game and advance to a specific state:

```typescript
import { quickGame } from '@boardsmith/testing';

const testGame = await quickGame(gameDefinition, {
  players: 2,
  advanceTo: 'playing',  // Phase name or predicate
});
```

### playSequence

Play a sequence of actions:

```typescript
import { playSequence } from '@boardsmith/testing';

const { testGame, results } = await playSequence(gameDefinition, [
  { player: 0, action: 'draw' },
  { player: 0, action: 'playCard', args: { cardIndex: 0 } },
  { player: 1, action: 'draw' },
]);
```

### playUntil

Play random actions until a condition:

```typescript
import { playUntil } from '@boardsmith/testing';

const testGame = await playUntil(
  gameDefinition,
  (game) => game.phase === 'endgame',
  { maxActions: 100 }
);
```

### createMultiple

Create multiple elements easily:

```typescript
import { createMultiple } from '@boardsmith/testing';

// In scenario setup:
createMultiple(player.hand, Card, 5, (i) => ({
  suit: 'hearts',
  rank: i + 1,
}));
```

## Debug Utilities

### toDebugString

Get a human-readable game state:

```typescript
import { toDebugString } from '@boardsmith/testing';

console.log(toDebugString(testGame.game));
// Game: MyGame
// Phase: playing
// Current Player: Alice (position 0)
//
// Players:
//   [0] Alice: hand(5), score=10
//   [1] Bob: hand(4), score=15
//
// Elements:
//   Deck (id=1): 32 children
//   DiscardPile (id=2): 10 children
```

### debugActionAvailability (Recommended)

The engine provides a built-in method for debugging action availability with human-readable explanations:

```typescript
// Using the engine's built-in method (recommended)
const debug = testGame.game.debugActionAvailability('move', player);
console.log(debug.reason);
// "Selection 'destination' has no valid choices (Depends on 'piece' - no valid combinations found)"

for (const sel of debug.details.selections) {
  const status = sel.passed ? '✓' : '✗';
  console.log(`${status} ${sel.name}: ${sel.choices} choices`);
  if (sel.note) console.log(`    ${sel.note}`);
}
// ✓ piece: 3 choices
//     3 valid choices
// ✗ destination: 0 choices
//     Depends on 'piece' - no valid combinations found

// Debug all actions at once
const allDebug = testGame.game.debugAllActions(player);
for (const d of allDebug.filter(d => !d.available)) {
  console.log(`${d.actionName}: ${d.reason}`);
}
```

### traceAction

Legacy testing utility for action debugging (prefer `game.debugActionAvailability()` above):

```typescript
import { traceAction } from '@boardsmith/testing';

const trace = traceAction(testGame.game, 'move', player);
console.log(trace.reason);
// "No valid elements for selection 'destination'"

for (const detail of trace.details) {
  console.log(`${detail.step}: ${detail.passed ? '✓' : '✗'} ${detail.info}`);
}
// Lookup: ✓ Found action 'move'
// Condition: ✓ Condition returned true
// Selection 'piece': ✓ 3 valid elements (5 before filter)
// Selection 'destination': ✗ 0 valid elements (24 before filter)
```

### visualizeFlow

Print the flow structure:

```typescript
import { visualizeFlow } from '@boardsmith/testing';

console.log(visualizeFlow(gameDefinition.flow));
// sequence "main"
//   ├─ phase "setup"
//   │  └─ execute
//   ├─ loop (while: ...)
//   │  └─ eachPlayer
//   │     └─ action-step [play, draw, pass]
//   └─ execute
```

### logAvailableActions

Show all actions and their status:

```typescript
import { logAvailableActions } from '@boardsmith/testing';

console.log(logAvailableActions(testGame.game));
// Available actions for Alice:
//   ✓ playCard - Action available
//   ✓ draw - Action available
//   ✗ attack - No valid elements for selection 'target'
//   ✗ rest - Action condition returned false
```

### diffSnapshots

Compare game states before/after:

```typescript
import { diffSnapshots } from '@boardsmith/testing';

const before = JSON.stringify(getSnapshot(testGame.game));
await simulateAction(testGame, 'move', args);
const after = JSON.stringify(getSnapshot(testGame.game));

console.log(diffSnapshots(before, after));
// Changes:
//   players[0].position: 3 → 5
//   board.cells[5].occupant: null → {id: 42}
```

### debugFlowState

Get detailed info about current flow position:

```typescript
import { debugFlowState } from '@boardsmith/testing';

const flowState = debugFlowState(testGame);
console.log(flowState.description);
// "In phase 'playing', waiting for Player 0 to choose: [play, draw, pass]"

console.log(flowState.nodeStack);
// ["sequence 'main'", "loop 'rounds'", "eachPlayer", "actionStep"]

console.log(flowState.currentPhase);      // "playing"
console.log(flowState.currentPlayer);      // 0
console.log(flowState.availableActions);   // ["play", "draw", "pass"]
console.log(flowState.awaitingInput);      // true
```

### visualizeFlowWithPosition

Show flow structure with current position highlighted:

```typescript
import { visualizeFlowWithPosition } from '@boardsmith/testing';

console.log(visualizeFlowWithPosition(gameDefinition.flow, testGame));
// sequence "main"
//   ├─ phase "setup"
//   ├─ loop "rounds"
//   │  ├─ eachPlayer
//   │  │  └─ actionStep [play, draw, pass] ← CURRENT
//   │  └─ execute
//   └─ phase "endgame"
```

## Random Simulation

### simulateRandomGames

Run random games for stress testing:

```typescript
import { simulateRandomGames } from '@boardsmith/testing';

const results = await simulateRandomGames(gameDefinition, {
  count: 100,
  maxActionsPerGame: 500,
  playerCount: 4,
});

console.log(`Completed: ${results.completed}/${results.total}`);
console.log(`Avg actions: ${results.averageActions}`);
console.log(`Errors: ${results.errors.length}`);
```

## Best Practices

1. **Use deterministic seeds** for reproducible tests
2. **Test edge cases** with specific scenarios
3. **Use assertions** instead of manual checks
4. **Use traceAction** to debug failing action tests
5. **Run random simulations** to catch edge cases

## API Reference

### Test Game Creation

```typescript
function createTestGame(definition, options): Promise<TestGame>;
function scenario(definition): ScenarioBuilder;
function quickGame(definition, options): Promise<TestGame>;
```

### Action Simulation

```typescript
function simulateAction(testGame, name, args): Promise<SimulateActionResult>;
function simulateActions(testGame, actions): Promise<SimulateActionResult[]>;
function assertActionSucceeds(testGame, name, args): Promise<void>;
function assertActionFails(testGame, name, args): Promise<void>;
```

### Assertions

```typescript
function assertFlowState(testGame, expected): void;
function assertPlayerHas(testGame, playerIndex, zone, criteria): void;
function assertElementCount(testGame, elementClass, count): void;
function assertGameFinished(testGame, options?): void;
function assertActionAvailable(testGame, playerIndex, actionName, options?): void;
function assertActionNotAvailable(testGame, playerIndex, actionName, options?): void;
```

### Debug Utilities

```typescript
function toDebugString(game, options?): string;
function traceAction(game, actionName, player?): ActionTraceResult;
function visualizeFlow(flow): string;
function visualizeFlowWithPosition(flow, testGame?): string;
function debugFlowState(testGame): FlowStateDebug;
function logAvailableActions(game, player?): string;
function diffSnapshots(before, after): string;
```
