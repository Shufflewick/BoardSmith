# boardsmith/runtime

> Game runner and serialization utilities.

## When to Use

Import from `boardsmith/runtime` when you need low-level game execution, serialization for network transfer, or replay functionality. This package is used internally by both client and server packages.

## Usage

```typescript
import {
  GameRunner,
  serializeAction,
  deserializeAction,
  createSnapshot,
  createPlayerView,
} from 'boardsmith/runtime';
```

## Exports

### Game Runner

- `GameRunner` - Execute game instances with action handling

### Serialization

- `serializeAction()` - Serialize an action with arguments
- `deserializeAction()` - Deserialize an action
- `isSerializedReference()` - Check if value is an element reference

### State Snapshots

- `createSnapshot()` - Create a full game state snapshot
- `createPlayerView()` - Create player-specific state view
- `createAllPlayerViews()` - Create views for all players

### Types

- `GameRunnerOptions` - Runner configuration
- `ActionExecutionResult` - Action execution result
- `SerializedReference` - Serialized element reference
- `GameStateSnapshot` - Full game state snapshot
- `PlayerStateView` - Player-specific view

## Examples

### Using GameRunner

```typescript
import { GameRunner } from 'boardsmith/runtime';
import { MyGame } from './game';

// Create a game runner
const runner = new GameRunner({
  GameClass: MyGame,
  gameType: 'my-game',
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
});

// Get current state
const snapshot = runner.getSnapshot();
console.log('Current player:', snapshot.flowState.currentPlayer);

// Perform an action (actionName, player, args) -- player seats are 1-indexed
const result = runner.performAction('move', 1, { from: 'a1', to: 'b2' });

if (result.success) {
  console.log('Move executed');
  console.log('New flow state:', result.flowState);
} else {
  console.error('Move failed:', result.error);
}
```

### Serializing Actions for Network

```typescript
import { serializeAction, deserializeAction } from 'boardsmith/runtime';

// On the client -- takes the real Player element (seats are 1-indexed) and
// a game reference so GameElement args can be resolved to references
const player = game.getPlayer(1)!;
const serialized = serializeAction('play', player, {
  card: cardElement, // GameElement reference
  target: spaceElement,
}, game);
// { name: 'play', player: 1, args: { card: { __elementRef: '0/2/5' }, target: { __elementRef: '0/1' } } }

// Send over WebSocket
ws.send(JSON.stringify(serialized));

// On the server -- resolves back to the real Player element and GameElement args
const received = JSON.parse(message);
const deserialized = deserializeAction(received, game);
// { actionName: 'play', player: <Player element>, args: { card: <Card element>, target: <Space element> } }
```

### Creating Player Views

```typescript
import { createSnapshot, createPlayerView, createAllPlayerViews } from 'boardsmith/runtime';

// Create full snapshot (includes all hidden information)
const fullSnapshot = createSnapshot(game);

// Create view for specific player (respects visibility) -- seats are 1-indexed
const player1View = createPlayerView(game, 1);
// Player 1 can see their own hand but not opponent's

// Create views for all players at once -- returns a plain array (0-indexed
// by array position, NOT by seat); each entry's `.player` field holds the
// actual 1-indexed seat
const allViews = createAllPlayerViews(game);
// allViews[0].player === 1 (first player's view), allViews[1].player === 2, ...

// Views hide information the player shouldn't see
console.log(player1View.state);
// Cards in opponent's hand show as { type: 'card', faceDown: true }
```

### Serialization Details

Action arguments are written by the same codec as element attributes, so an
argument keeps every shape an attribute keeps:

- A `GameElement` becomes `{ __elementRef: '<branch>' }`, or `{ __elementId }`
  in world mode. A player becomes `{ __playerRef, seat, color, name }`.
- A `Map`, `Set` or typed array round-trips with its contents and type.
- A circular value, or one nested past `GameElement.MAX_SERIALIZE_DEPTH`, is
  refused with an error naming the property path.

```typescript
import { serializeAction, deserializeAction, isSerializedReference } from 'boardsmith/runtime';

const saved = JSON.parse(JSON.stringify(
  serializeAction('bid', player, { bids: new Map([['ace', card]]), seats: new Set([1, 2]) }, game),
));
deserializeAction(saved, game).args;
// { bids: Map { 'ace' => <Card element> }, seats: Set { 1, 2 } }

isSerializedReference({ __elementRef: '0/1' }); // true
isSerializedReference({ x: 1 }); // false
```

### Runner with Action History

```typescript
import { GameRunner } from 'boardsmith/runtime';

const runner = new GameRunner({
  GameClass: MyGame,
  gameType: 'my-game',
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
  seed: 'deterministic-seed',
});

// Perform a series of actions (actionName, player, args) -- player seats are 1-indexed
runner.performAction('draw', 1, {});
runner.performAction('play', 1, { card: 'card-1' });
runner.performAction('draw', 2, {});

// Read the recorded action history (a public readonly field)
console.log(`${runner.actionHistory.length} actions played`);

// Capture the current state as a snapshot
const snapshot = runner.getSnapshot();
console.log('Current flow state:', runner.getFlowState());
```

## See Also

- [boardsmith/session](./session.md) - Higher-level session management
- [boardsmith](./index.md) - Core game engine
