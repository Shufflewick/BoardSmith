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

## Examples

### Basic Client Usage

```typescript
import { MeepleClient } from 'boardsmith/client';

// Create client
const client = new MeepleClient({
  baseUrl: 'https://game.example.com',
});

// Create a new game
const { gameId } = await client.createGame({
  gameType: 'go-fish',
  playerCount: 3,
  playerNames: ['Alice', 'Bob', 'Charlie'],
});

// Connect to the game
const connection = client.connect(gameId, {
  playerSeat: 0,
});

// Subscribe to state changes
connection.onStateChange((state) => {
  console.log('Game state updated:', state);
  console.log('Current player:', state.flowState.currentPlayer);
  console.log('Is my turn:', state.flowState.currentPlayer === 0);
});

// Perform an action when it's your turn
await connection.action('ask', {
  target: 1,
  rank: '7',
});
```

### Matchmaking

```typescript
import { MeepleClient } from 'boardsmith/client';

const client = new MeepleClient({
  baseUrl: 'https://game.example.com',
});

// Find a match
const match = await client.findMatch('go-fish', {
  playerCount: 4,
  playerId: 'user-123',
  playerName: 'Alice',
});

if (match.matched) {
  // Matched with other players!
  const connection = client.connect(match.gameId!, {
    playerSeat: match.playerSeat!,
  });
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
const connection = client.connect(gameId, { playerSeat: 0 });

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

// Create game with lobby
const { gameId } = await client.createGame({
  gameType: 'go-fish',
  playerCount: 4,
  withLobby: true,
});

// Connect to the lobby (lobby updates arrive over the connection)
const connection = client.connect(gameId, {
  spectator: true,
});

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
