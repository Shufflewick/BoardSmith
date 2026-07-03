# boardsmith/client

> Browser SDK for multiplayer games.

## When to Use

Import from `boardsmith/client` when building the browser-side client for multiplayer games. This package provides WebSocket connectivity, state synchronization, and audio services.

## Usage

```typescript
import { MeepleClient, GameConnection, audioService } from 'boardsmith/client';
```

## Exports

### Classes

- `MeepleClient` - Main client for connecting to game servers
- `GameConnection` - Active connection to a game
- `MeepleClientError` - Thrown by `MeepleClient`'s HTTP methods (game/lobby management) on failure; extends `Error` and carries an optional `errorCode`

### Audio

- `audioService` - Audio playback service

### Types

- `MeepleClientConfig` - Client configuration
- `GameConnectionConfig` - Connection configuration
- `FindMatchOptions` - Matchmaking options
- `MatchmakingResult` - Matchmaking result
- `MatchmakingStatus` - Matchmaking status enum
- `FlowState` - Game flow state
- `PlayerState` - Player-specific state
- `GameState` - Combined game state
- `ConnectionStatus` - Connection status enum
- `ActionResult` - Action execution result
- `StateChangeCallback` - State change handler
- `ErrorCallback` - Error handler
- `ConnectionCallback` - Connection status handler
- `CreateGameRequest` - Create game request
- `CreateGameResponse` - Create game response
- `ApiResponse` - Generic API response
- `LobbyState` - Lobby state
- `SlotStatus` - Lobby slot status
- `LobbySlot` - Lobby slot data
- `LobbyInfo` - Lobby information
- `ClaimSeatRequest` - Claim seat request
- `ClaimSeatResponse` - Claim seat response
- `AudioServiceOptions` - Audio service options

## Error Handling

Every `MeepleClient` HTTP method (game creation, matchmaking, lobby management — `createGame`, `claimSeat`, `joinLobby`, `setReady`, `addSlot`, `removeSlot`, `setSlotAI`, `leavePosition`, `kickPlayer`, `updatePlayerOptions`, `updateSlotPlayerOptions`, `updateGameOptions`, `findMatch`, `getMatchStatus`, `leaveMatchmaking`, `getGameState`, `performAction`, `getHistory`, `restartGame`, `getLobby`, `updateLobbyName`) **throws** a `MeepleClientError` on failure — none of them return a `{ success: false }` value to check. Always call these inside a `try/catch`:

```typescript
import { MeepleClient, MeepleClientError } from 'boardsmith/client';

const client = new MeepleClient({ baseUrl: 'https://game.example.com' });

try {
  await client.setReady(gameId, true);
} catch (error) {
  if (error instanceof MeepleClientError) {
    console.error(error.message, error.errorCode);
  }
  showErrorToast(error instanceof Error ? error.message : 'Failed to mark as ready.');
}
```

`GameConnection.action()` (over the WebSocket, not `MeepleClient`'s HTTP surface) is the one exception: it resolves `{ success: false, error }` for a genuine server-reported action failure (checking `result.success` there is correct), but rejects for connection-level problems (not connected, timed out waiting to open, closed mid-flight) — see [Performing Actions](#performing-actions) below.

## Examples

### Basic Client Usage

```typescript
import { MeepleClient } from 'boardsmith/client';

// Create client
const client = new MeepleClient({
  baseUrl: 'https://game.example.com',
});

try {
  // Create a new game. Lobby/game-management methods throw a
  // MeepleClientError on failure — always wrap them in try/catch.
  const { gameId } = await client.createGame({
    gameType: 'go-fish',
    playerCount: 3,
    playerNames: ['Alice', 'Bob', 'Charlie'],
  });

  // Connect to the game. connect() returns immediately with a connection
  // object whose socket is still opening — await `.opened` before relying
  // on the connection being live (e.g. before sending an action).
  // Seats are 1-indexed (seat 0 is not a valid seat and is silently ignored).
  const connection = client.connect(gameId, {
    playerSeat: 1,
  });
  await connection.opened;

  // Subscribe to state changes
  connection.onStateChange((state) => {
    console.log('Game state updated:', state);
    console.log('Current player:', state.flowState.currentPlayer);
    console.log('Is my turn:', state.flowState.currentPlayer === 1);
  });

  // Perform an action when it's your turn
  await connection.action('ask', {
    target: 1,
    rank: '7',
  });
} catch (error) {
  console.error('Failed to start game:', error);
}
```

### Matchmaking

```typescript
import { MeepleClient } from 'boardsmith/client';

const client = new MeepleClient({
  baseUrl: 'https://game.example.com',
});

// Find a match. The client's own playerId is sent automatically — set it
// via `new MeepleClient({ ..., playerId })` if you need a specific identity.
const match = await client.findMatch('go-fish', {
  playerCount: 4,
  playerName: 'Alice',
});

if (match.matched) {
  // Matched with other players!
  const connection = client.connect(match.gameId!, {
    playerSeat: match.playerSeat!,
  });
  await connection.opened;
} else {
  // Waiting for more players
  console.log(`Position ${match.position} in queue`);

  // Poll for match status (uses the client's playerId)
  const status = await client.getMatchStatus();
  if (status.status === 'matched') {
    // Now matched!
  }
}

// Cancel matchmaking
await client.leaveMatchmaking();
```

### Connection Event Handling

```typescript
import { MeepleClient } from 'boardsmith/client';

const client = new MeepleClient({ baseUrl: 'https://game.example.com' });
const connection = client.connect(gameId, { playerSeat: 1 }); // seats are 1-indexed
await connection.opened; // wait for the socket to actually open before using it

// State changes
connection.onStateChange((state) => {
  updateUI(state);
});

// Connection status (called immediately with the current status, then on change)
connection.onConnectionChange((status) => {
  console.log('Connection status:', status); // 'connected' | 'connecting' | 'disconnected' | ...
  if (status === 'disconnected') {
    showReconnectButton();
  }
});

// Errors
connection.onError((error) => {
  console.error('Game error:', error);
  showErrorMessage(error.message);
});

// Action results are returned by awaiting the action itself
const result = await connection.action('draw');
if (!result.success) {
  showActionError(result.error);
}
```

### Performing Actions

```typescript
// Simple action
await connection.action('draw');

// Action with arguments
await connection.action('play', {
  card: 'card-123',
  target: 'space-456',
});

// Action with error handling
try {
  const result = await connection.action('move', {
    from: 'a1',
    to: 'b2',
  });

  if (!result.success) {
    console.error('Move failed:', result.error);
  }
} catch (error) {
  console.error('Connection error:', error);
}
```

### Game History

History is fetched from the client (keyed by game id), not the connection:

```typescript
const client = new MeepleClient({ baseUrl: 'https://game.example.com' });

// Get action history for a game
const history = await client.getHistory(gameId);
console.log(`${history.actionHistory.length} actions played`);
console.log('Created at:', new Date(history.createdAt));
```

### Lobby Management

```typescript
const client = new MeepleClient({ baseUrl: 'https://game.example.com' });

try {
  // Create game with lobby. Lobby mutations below all throw
  // MeepleClientError on failure — wrap them in try/catch, don't check
  // a `.success` field.
  const { gameId } = await client.createGame({
    gameType: 'go-fish',
    playerCount: 4,
    useLobby: true,
  });

  // Connect to the lobby (lobby updates arrive over the connection)
  const connection = client.connect(gameId, {
    spectator: true,
  });
  await connection.opened;

  // Listen for lobby updates
  connection.onLobbyChange((lobby) => {
    console.log('Lobby state:', lobby.state);
    console.log('Slots:', lobby.slots);
  });

  // Lobby mutations are performed on the client, keyed by game id

  // Claim a seat (seats are 1-indexed)
  await client.claimSeat(gameId, 1, 'Alice');

  // Update your display name
  await client.updateLobbyName(gameId, 'Alice the Great');

  // Set ready status
  await client.setReady(gameId, true);
} catch (error) {
  console.error('Lobby operation failed:', error);
  showErrorToast(error instanceof Error ? error.message : 'Lobby operation failed.');
}
```

### Audio Service

```typescript
import { audioService } from 'boardsmith/client';

// Configure audio
audioService.configure({
  basePath: '/sounds',
  enabled: true,
  volume: 0.8,
});

// Play sounds
audioService.play('card-play');
audioService.play('piece-capture');
audioService.play('victory');

// Toggle mute
audioService.mute();
audioService.unmute();

// Adjust volume
audioService.setVolume(0.5);
```

### Restart

Restart creates a fresh game state while keeping the same game id and players:

```typescript
const client = new MeepleClient({ baseUrl: 'https://game.example.com' });

// Restart the game
const { flowState, state } = await client.restartGame(gameId);
```

### Spectator Mode

```typescript
const connection = client.connect(gameId, {
  spectator: true,
});

// Spectators receive state updates but cannot perform actions
connection.onStateChange((state) => {
  // Watch the game
  renderGameBoard(state);
});

// This will fail for spectators
try {
  await connection.action('move', { from: 'a1', to: 'b2' });
} catch (error) {
  console.log('Spectators cannot perform actions');
}
```

## See Also

- [boardsmith/session](./session.md) - Session management
- [UI Components Guide](../ui-components.md) - Building game UIs
