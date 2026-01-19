# boardsmith/session

> Game session management for local and multiplayer games.

## When to Use

Import from `boardsmith/session` when managing game sessions, handling AI opponents, or building multiplayer infrastructure. This package provides a unified API for game state management across different platforms.

## Usage

```typescript
import {
  GameSession,
  AIController,
  CheckpointManager,
  generateGameId,
  type GameDefinition,
  type StorageAdapter,
} from 'boardsmith/session';
```

## Exports

### Core Classes

- `GameSession` - Main session manager for game state
- `AIController` - Manages AI player turns
- `CheckpointManager` - Manages state checkpoints for HMR

### Utilities

- `generateGameId()` - Generate unique game ID
- `isPlayersTurn()` - Check if it's a player's turn
- `buildPlayerState()` - Build player-specific state view

### Player Colors

- `STANDARD_PLAYER_COLORS` - Full color palette
- `DEFAULT_PLAYER_COLORS` - Default 6 player colors
- `createColorOption()` - Create color selection option

### Error Handling

- `ErrorCode` - Error code enum for session errors

### Types

- `GameClass` - Game class constructor type
- `GameDefinition` - Game definition with metadata
- `GameConfig` - Game configuration options
- `StoredGameState` - Persisted game state
- `PlayerGameState` - Player-specific state view
- `SessionInfo` - Session metadata
- `StateUpdate` - State update message
- `AIConfig` - AI player configuration
- `StorageAdapter` - Storage backend interface
- `BroadcastAdapter` - WebSocket broadcast interface
- `CreateGameRequest` - Create game request
- `ActionRequest` - Action request message
- `WebSocketMessage` - WebSocket message type
- `PlayerOptionDefinition` - Player option definition
- `StandardPlayerOption` - Standard player option
- `ExclusivePlayerOption` - Exclusive player option
- `PlayerConfig` - Player configuration
- `GamePreset` - Game preset definition
- `GameOptionDefinition` - Game option definition
- `NumberOption` - Numeric option
- `SelectOption` - Selection option
- `BooleanOption` - Boolean option
- `LobbyState` - Lobby state enum
- `SlotStatus` - Slot status enum
- `LobbySlot` - Lobby slot data
- `LobbyInfo` - Lobby information
- `LobbyUpdate` - Lobby update message
- `ClaimPositionRequest` - Claim position request
- `ClaimPositionResponse` - Claim position response
- `UpdateNameRequest` - Update name request
- `GameSessionOptions` - Session constructor options
- `ActionResult` - Action execution result
- `UndoResult` - Undo operation result
- `CheckpointManagerOptions` - Checkpoint manager options
- `ColorChoice` - Color choice option
- `ColorOptionDefinition` - Color option definition

## Examples

### Creating a Local Game Session

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game';

// Create a new game session
const session = GameSession.create({
  gameType: 'my-game',
  GameClass: MyGame,
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
});

// Get state for a specific player
const { flowState, state } = session.getState(0);
console.log('Current player:', flowState.currentPlayer);
console.log('Available actions:', flowState.actions);

// Perform an action
const result = await session.performAction('move', 0, {
  from: 'a1',
  to: 'b2',
});

if (result.success) {
  console.log('Move successful!');
} else {
  console.error('Move failed:', result.error);
}
```

### Adding AI Opponents

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game';

const session = GameSession.create({
  gameType: 'my-game',
  GameClass: MyGame,
  playerCount: 2,
  playerNames: ['Human', 'Bot'],
  aiConfig: {
    players: [1], // Player 1 is AI
    level: 'hard',
  },
});

// AI moves are handled automatically when it's the AI's turn
const result = await session.performAction('move', 0, { from: 'a1', to: 'b2' });
// After the human moves, AI will automatically play
```

### Implementing Storage Adapter

```typescript
import type { StorageAdapter, StoredGameState } from 'boardsmith/session';

class LocalStorageAdapter implements StorageAdapter {
  constructor(private gameId: string) {}

  async save(state: StoredGameState): Promise<void> {
    localStorage.setItem(`game:${this.gameId}`, JSON.stringify(state));
  }

  async load(): Promise<StoredGameState | null> {
    const data = localStorage.getItem(`game:${this.gameId}`);
    return data ? JSON.parse(data) : null;
  }
}

const session = GameSession.create({
  gameType: 'my-game',
  GameClass: MyGame,
  playerCount: 2,
  playerNames: ['Alice', 'Bob'],
  storage: new LocalStorageAdapter('game-123'),
});
```

### Restoring a Saved Game

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game';

// Load stored state
const storedState = await storage.load();

if (storedState) {
  // Restore from saved state
  const session = GameSession.restore(storedState, MyGame, storage);

  // Continue playing
  const { flowState, state } = session.getState(0);
}
```

### Multiplayer with Broadcast

```typescript
import type { BroadcastAdapter, SessionInfo } from 'boardsmith/session';

class WebSocketBroadcaster implements BroadcastAdapter<SessionInfo> {
  constructor(private connections: Map<number, WebSocket>) {}

  getSessions(): SessionInfo[] {
    return Array.from(this.connections.keys()).map((pos) => ({
      playerPosition: pos,
      isSpectator: false,
    }));
  }

  send(session: SessionInfo, message: unknown): void {
    const ws = this.connections.get(session.playerPosition);
    ws?.send(JSON.stringify(message));
  }
}

// Set up broadcasting
session.setBroadcaster(new WebSocketBroadcaster(connections));

// State updates are now automatically broadcast to all players
```

## See Also

- [boardsmith/server](./server.md) - Server-side game hosting
- [boardsmith/client](./client.md) - Browser client SDK
- [boardsmith/ai](./ai.md) - AI opponent system
