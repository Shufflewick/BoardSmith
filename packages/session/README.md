# @boardsmith/session

Game session management for BoardSmith. Handles game lifecycle, state synchronization, action processing, and AI players.

## Installation

```bash
npm install @boardsmith/session
```

## Overview

The session package provides a unified API for managing game sessions across different platforms (local development, Cloudflare Workers, etc.) while keeping game designers isolated from implementation details.

## Quick Start

```typescript
import { GameSession, generateGameId } from '@boardsmith/session';
import { CheckersGame, gameDefinition } from './my-game';

// Create a new game session
const session = await GameSession.create({
  gameType: 'checkers',
  GameClass: CheckersGame,
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
  seed: 12345,  // Optional: for reproducible games
});

// Get state for a specific player
const playerState = session.getState(0);  // Alice's view

// Perform an action
const result = await session.performAction('move', 0, {
  piece: pieceId,
  destination: cellId,
});

if (result.success) {
  console.log('Move successful!');
} else {
  console.log(`Error: ${result.error}`);
}
```

## GameSession

The main class for managing a game instance.

### Creation

```typescript
// Create a new game
const session = await GameSession.create({
  gameType: 'my-game',
  GameClass: MyGame,
  playerCount: 4,
  playerNames: ['Alice', 'Bob', 'Carol', 'Dave'],
  gameOptions: { variant: 'advanced' },
  seed: Date.now(),  // Optional random seed
  storage: myStorageAdapter,  // Optional persistence
});

// Restore from saved state
const session = await GameSession.restore(
  gameDefinition,
  storedState,
  { storage: myStorageAdapter }
);
```

### Getting State

```typescript
// Get state for a specific player (with hidden info filtered)
const playerState = session.getState(playerPosition);

interface PlayerGameState {
  game: any;              // Serialized game state (player's view)
  flowState: FlowState;   // Current flow state
  playerNames: string[];  // All player names
  playerPosition: number; // This player's position
  finished: boolean;      // Is game over
  winners?: number[];     // Winning player positions
}
```

### Performing Actions

```typescript
const result = await session.performAction(
  'playCard',      // Action name
  0,               // Player position
  { card: cardId } // Action arguments
);

interface ActionResult {
  success: boolean;
  error?: string;
  state?: PlayerGameState;
  pendingAction?: PendingActionInfo;
}
```

### Undo

```typescript
// Undo to turn start
const result = await session.undoToTurnStart(playerPosition);

// Undo last action (with limits)
const result = await session.undo(playerPosition);

interface UndoResult {
  success: boolean;
  error?: string;
  actionsUndone?: number;
}
```

### History and Replay

```typescript
// Get state at a specific action index (for time travel)
const historicalState = session.getStateAtAction(actionIndex);

// Rewind game to an action and continue from there
const result = await session.rewindToAction(actionIndex);

// Get action history
const history = session.getActionHistory();
```

## Storage Adapters

Persist game state with storage adapters:

```typescript
interface StorageAdapter {
  save(state: StoredGameState): Promise<void>;
  load(): Promise<StoredGameState | null>;
}

// Example: SQLite adapter
class SqliteStorage implements StorageAdapter {
  constructor(private db: Database, private gameId: string) {}

  async save(state: StoredGameState): Promise<void> {
    this.db.run(
      'INSERT OR REPLACE INTO games (id, state) VALUES (?, ?)',
      [this.gameId, JSON.stringify(state)]
    );
  }

  async load(): Promise<StoredGameState | null> {
    const row = this.db.get('SELECT state FROM games WHERE id = ?', [this.gameId]);
    return row ? JSON.parse(row.state) : null;
  }
}
```

## Broadcast Adapters

Notify connected clients of state changes:

```typescript
interface BroadcastAdapter<TSession extends SessionInfo> {
  addSession(session: TSession): void;
  removeSession(session: TSession): void;
  getSessions(): TSession[];
  send(session: TSession, message: unknown): void;
  broadcast(message: unknown): void;
}

interface SessionInfo {
  playerPosition: number;
  isSpectator: boolean;
  playerId?: string;
}
```

## AI Controller

Built-in AI player support using Monte Carlo Tree Search:

```typescript
import { AIController } from '@boardsmith/session';

const ai = new AIController({
  level: 'medium',  // 'easy' | 'medium' | 'hard' | 'expert' or iteration count
  players: [1, 3],  // AI-controlled player positions
});

// Check if current player is AI
if (ai.isAIPlayer(currentPlayerPosition)) {
  const move = await ai.getMove(session);
  await session.performAction(move.action, move.player, move.args);
}
```

### AI Levels

| Level | Iterations | Description |
|-------|------------|-------------|
| easy | 100 | Quick, makes mistakes |
| medium | 500 | Balanced play |
| hard | 1500 | Strong play |
| expert | 5000 | Very strong, slower |

## Lobby System

Manage pre-game player setup:

```typescript
// Lobby is integrated into GameSession
const lobby = session.lobby;

// Claim a position
await session.claimPosition(playerId, playerPosition);

// Update player name
await session.updatePlayerName(playerId, 'New Name');

// Check if ready to start
if (lobby.canStart()) {
  await session.startGame();
}

interface LobbyState {
  slots: LobbySlot[];
  minPlayers: number;
  maxPlayers: number;
  isStarted: boolean;
}

interface LobbySlot {
  position: number;
  status: 'open' | 'claimed' | 'ai' | 'locked';
  playerId?: string;
  playerName?: string;
  isConnected: boolean;
}
```

## Player Options

Configure per-player settings:

```typescript
interface PlayerOptionDefinition {
  id: string;
  type: 'standard' | 'exclusive';
  choices: { id: string; label: string }[];
  defaultValue: string;
}

// Standard option: each player picks independently
const colorOption: StandardPlayerOption = {
  id: 'color',
  type: 'standard',
  choices: [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
    { id: 'green', label: 'Green' },
  ],
  defaultValue: 'red',
};

// Exclusive option: first-come-first-served
const factionOption: ExclusivePlayerOption = {
  id: 'faction',
  type: 'exclusive',
  choices: [
    { id: 'empire', label: 'Empire' },
    { id: 'rebels', label: 'Rebels' },
  ],
  defaultValue: 'empire',
};
```

### Color Options

Built-in color picker:

```typescript
import { createColorOption, STANDARD_PLAYER_COLORS } from '@boardsmith/session';

const colorOption = createColorOption({
  defaultColors: ['red', 'blue', 'green', 'yellow'],
});

// Available colors
console.log(STANDARD_PLAYER_COLORS);
// ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan', ...]
```

## Utility Functions

### generateGameId

Create unique game identifiers:

```typescript
import { generateGameId } from '@boardsmith/session';

const gameId = generateGameId();  // e.g., 'abc123xyz'
```

### buildPlayerState

Create player-specific state view:

```typescript
import { buildPlayerState } from '@boardsmith/session';

const playerView = buildPlayerState(
  gameRunner,
  playerNames,
  playerPosition,
  { includeActionMetadata: true }
);
```

### isPlayersTurn

Check if it's a player's turn:

```typescript
import { isPlayersTurn } from '@boardsmith/session';

const canAct = isPlayersTurn(flowState, playerPosition);
```

## Type Definitions

### GameDefinition

```typescript
interface GameDefinition {
  gameType: string;
  displayName?: string;
  gameClass: GameClass;
  flow: FlowNode;
  actions: Record<string, Action>;
  minPlayers: number;
  maxPlayers: number;
  playerOptions?: PlayerOptionDefinition[];
  gameOptions?: GameOptionDefinition[];
  presets?: GamePreset[];
}
```

### StoredGameState

```typescript
interface StoredGameState {
  gameType: string;
  playerCount: number;
  playerNames: string[];
  seed: number;
  gameOptions?: Record<string, unknown>;
  playerConfigs?: PlayerConfig[];
  actionHistory: SerializedAction[];
  version: number;
}
```

### WebSocketMessage

```typescript
type WebSocketMessage =
  | { type: 'action'; action: string; args: unknown }
  | { type: 'undo' }
  | { type: 'undoToTurnStart' }
  | { type: 'ping' };
```

## Error Handling

```typescript
const result = await session.performAction('move', 0, args);

if (!result.success) {
  switch (result.error) {
    case 'Not your turn':
      // Handle wrong player
      break;
    case 'Action not available':
      // Handle invalid action
      break;
    case 'Invalid selection':
      // Handle invalid arguments
      break;
    default:
      console.error('Unknown error:', result.error);
  }
}
```

## Best Practices

1. **Use storage adapters** for game persistence
2. **Implement broadcast adapters** for multiplayer
3. **Set random seeds** for reproducible games
4. **Check isPlayersTurn** before allowing actions
5. **Handle pending actions** for multi-step selections
6. **Use lobby system** for proper game setup

## See Also

- [Getting Started](../../docs/getting-started.md)
- [@boardsmith/engine](../engine/README.md) - Core game engine
- [@boardsmith/server](../server/README.md) - HTTP/WebSocket server
