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

- `serializeValue()` - Serialize game values for transfer
- `deserializeValue()` - Deserialize game values
- `serializeAction()` - Serialize an action with arguments
- `deserializeAction()` - Deserialize an action
- `isSerializedReference()` - Check if value is an element reference

### State Snapshots

- `createSnapshot()` - Create a full game state snapshot
- `createPlayerView()` - Create player-specific state view
- `createAllPlayerViews()` - Create views for all players

### Replay

- `createReplayFile()` - Create a replay file from game history
- `validateReplayFile()` - Validate replay file format
- `parseReplayFile()` - Parse replay file content

### Types

- `GameRunnerOptions` - Runner configuration
- `ActionExecutionResult` - Action execution result
- `SerializedReference` - Serialized element reference
- `SerializeOptions` - Serialization options
- `GameStateSnapshot` - Full game state snapshot
- `PlayerStateView` - Player-specific view
- `ReplayFile` - Replay file format

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

// Perform an action (actionName, player, args)
const result = runner.performAction('move', 0, { from: 'a1', to: 'b2' });

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

// On the client
const action = {
  action: 'play',
  player: 0,
  args: {
    card: cardElement, // GameElement reference
    target: spaceElement,
  },
};

// Serialize for network transfer
const serialized = serializeAction(action, game);
// { action: 'play', player: 0, args: { card: { _ref: 'card-123' }, target: { _ref: 'space-456' } } }

// Send over WebSocket
ws.send(JSON.stringify(serialized));

// On the server
const received = JSON.parse(message);
const deserialized = deserializeAction(received, game);
// { action: 'play', player: 0, args: { card: <Card element>, target: <Space element> } }
```

### Creating Player Views

```typescript
import { createSnapshot, createPlayerView, createAllPlayerViews } from 'boardsmith/runtime';

// Create full snapshot (includes all hidden information)
const fullSnapshot = createSnapshot(game);

// Create view for specific player (respects visibility)
const player0View = createPlayerView(game, 0);
// Player 0 can see their own hand but not opponent's

// Create views for all players at once
const allViews = createAllPlayerViews(game);
// { 0: player0View, 1: player1View, ... }

// Views hide information the player shouldn't see
console.log(player0View.elements);
// Cards in opponent's hand show as { type: 'card', faceDown: true }
```

### Working with Replays

```typescript
import { createReplayFile, validateReplayFile, parseReplayFile } from 'boardsmith/runtime';

// Create a replay file from completed game
const replay = createReplayFile({
  gameType: 'checkers',
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
  actionHistory: session.getHistory().actionHistory,
  initialSeed: session.getSeed(),
  result: {
    winner: 0,
    reason: 'checkmate',
  },
});

// Save to file
const replayJson = JSON.stringify(replay, null, 2);
fs.writeFileSync('game-replay.json', replayJson);

// Later, load and validate
const loaded = JSON.parse(fs.readFileSync('game-replay.json', 'utf-8'));
const validation = validateReplayFile(loaded);

if (validation.valid) {
  const parsed = parseReplayFile(loaded);
  console.log(`Replay: ${parsed.playerNames.join(' vs ')}`);
  console.log(`Actions: ${parsed.actionHistory.length}`);
  console.log(`Winner: ${parsed.result.winner}`);
} else {
  console.error('Invalid replay:', validation.errors);
}
```

### Serialization Details

```typescript
import { serializeValue, deserializeValue, isSerializedReference } from 'boardsmith/runtime';

// Serialize various value types
serializeValue(42); // 42
serializeValue('hello'); // 'hello'
serializeValue(true); // true
serializeValue(null); // null
serializeValue([1, 2, 3]); // [1, 2, 3]
serializeValue({ x: 1, y: 2 }); // { x: 1, y: 2 }

// GameElements become references
serializeValue(cardElement, game);
// { _ref: 'card-123' }

// Check for references
isSerializedReference({ _ref: 'card-123' }); // true
isSerializedReference({ x: 1 }); // false

// Deserialize back
const card = deserializeValue({ _ref: 'card-123' }, game);
// Returns the actual Card element
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

// Perform a series of actions (actionName, player, args)
runner.performAction('draw', 0, {});
runner.performAction('play', 0, { card: 'card-1' });
runner.performAction('draw', 1, {});

// Read the recorded action history (a public readonly field)
console.log(`${runner.actionHistory.length} actions played`);

// Capture the current state as a snapshot
const snapshot = runner.getSnapshot();
console.log('Current flow state:', runner.getFlowState());
```

## See Also

- [boardsmith/session](./session.md) - Higher-level session management
- [boardsmith](./index.md) - Core game engine
