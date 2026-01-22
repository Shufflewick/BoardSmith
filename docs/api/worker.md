# boardsmith/worker

> Cloudflare Workers game deployment.

## When to Use

Import from `boardsmith/worker` when deploying games to Cloudflare Workers. This package provides Durable Objects for game state persistence and WebSocket connections, plus KV-based matchmaking.

## Usage

```typescript
import {
  createGameWorker,
  createGameStateDurableObject,
  buildRegistries,
} from 'boardsmith/worker';
```

## Exports

### Factory Functions

- `createGameWorker()` - Create a Worker fetch handler
- `createGameStateDurableObject()` - Create a Durable Object class
- `buildRegistries()` - Build registries from game definitions

### Types

- `GameRegistry` - Map of game type to game class
- `GameConfigRegistry` - Map of game type to config
- `Env` - Worker environment bindings
- `CreateGameRequest` - Create game request
- `ActionRequest` - Action request
- `MatchmakingRequest` - Matchmaking request
- `GameResponse` - Game operation response
- `WebSocketMessage` - WebSocket message type
- `WebSocketSession` - WebSocket session info
- `WorkerConfig` - Worker configuration
- `GameClass` - Game class type
- `GameDefinition` - Game definition
- `GameConfig` - Game configuration
- `StoredGameState` - Stored game state
- `PlayerGameState` - Player game state
- `AIConfig` - AI configuration

## Examples

### Basic Worker Setup

```typescript
// src/worker.ts
import { createGameWorker, createGameStateDurableObject, buildRegistries } from 'boardsmith/worker';
import { GoFishGame, goFishDefinition } from './games/go-fish/game';

// Build registries from game definitions
const { gameRegistry, gameConfigRegistry } = buildRegistries([goFishDefinition]);

// Export Durable Object class
export const GameState = createGameStateDurableObject(gameRegistry);

// Export Worker
export default createGameWorker({
  gameRegistry,
  gameConfigRegistry,
});
```

### wrangler.toml Configuration

```toml
name = "my-game-server"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[durable_objects.bindings]]
name = "GAME_STATE"
class_name = "GameState"

[[migrations]]
tag = "v1"
new_classes = ["GameState"]

[[kv_namespaces]]
binding = "MATCHMAKING"
id = "your-kv-namespace-id"
```

### Game Definition

```typescript
// games/go-fish/game.ts
import { Game, Player, Card, Hand, Deck } from 'boardsmith';
import type { GameDefinition } from 'boardsmith/worker';

export class GoFishGame extends Game<GoFishGame, GoFishPlayer> {
  deck!: Deck<GoFishGame, GoFishPlayer>;

  defineElements() {
    this.deck = this.create(Deck, 'deck');
    // ... setup cards
  }

  defineActions() {
    this.defineAction('ask', {
      prompt: 'Ask a player for a rank',
      // ... action definition
    });
  }
}

export const goFishDefinition: GameDefinition = {
  gameType: 'go-fish',
  gameClass: GoFishGame,
  minPlayers: 2,
  maxPlayers: 6,
};
```

### Multiple Games

```typescript
import { buildRegistries, createGameWorker, createGameStateDurableObject } from 'boardsmith/worker';
import { goFishDefinition } from './games/go-fish/game';
import { checkersDefinition } from './games/checkers/game';
import { ticTacToeDefinition } from './games/tic-tac-toe/game';

const { gameRegistry, gameConfigRegistry } = buildRegistries([
  goFishDefinition,
  checkersDefinition,
  ticTacToeDefinition,
]);

export const GameState = createGameStateDurableObject(gameRegistry);

export default createGameWorker({
  gameRegistry,
  gameConfigRegistry,
});
```

### API Routes

The worker automatically handles these routes:

```
POST /games                    - Create a new game
GET  /games/:id                - Get game state
GET  /games/:id (WebSocket)    - Connect via WebSocket
POST /games/:id/action         - Perform an action
GET  /games/:id/history        - Get action history
GET  /games/:id/state-at/:n    - Get state at action N
GET  /games/:id/state-diff/:from/:to - Get state diff
POST /games/:id/undo           - Undo last action
POST /games/:id/restart        - Restart game

POST /matchmaking/join         - Join matchmaking queue
GET  /matchmaking/status       - Check matchmaking status
POST /matchmaking/leave        - Leave matchmaking queue

GET  /health                   - Health check
```

### Creating a Game

```typescript
// From client
const response = await fetch('https://your-worker.workers.dev/games', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    gameType: 'go-fish',
    playerCount: 3,
    playerNames: ['Alice', 'Bob', 'Charlie'],
    aiPlayers: [2], // Player 2 is AI
    aiLevel: 'medium',
  }),
});

const { gameId } = await response.json();
```

### WebSocket Connection

```typescript
// Connect to game
const ws = new WebSocket(`wss://your-worker.workers.dev/games/${gameId}?player=0`);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'state':
      // Initial state or update
      updateUI(message.state, message.flowState);
      break;

    case 'actionResult':
      // Response to action
      if (!message.success) {
        showError(message.error);
      }
      break;

    case 'error':
      showError(message.error);
      break;
  }
};

// Perform an action
ws.send(
  JSON.stringify({
    type: 'action',
    action: 'ask',
    args: { target: 1, rank: '7' },
    requestId: 'unique-id-123',
  }),
);
```

### With Lobby System

```typescript
// Create game with lobby
const { gameId } = await fetch('/games', {
  method: 'POST',
  body: JSON.stringify({
    gameType: 'go-fish',
    playerCount: 4,
    withLobby: true,
  }),
}).then((r) => r.json());

// Connect with playerId
const ws = new WebSocket(`wss://example.com/games/${gameId}?playerId=user-123`);

// Claim a position
await fetch(`/games/${gameId}/claim-position`, {
  method: 'POST',
  body: JSON.stringify({
    position: 0,
    playerId: 'user-123',
    name: 'Alice',
  }),
});

// Set ready
await fetch(`/games/${gameId}/set-ready`, {
  method: 'POST',
  body: JSON.stringify({
    playerId: 'user-123',
    ready: true,
  }),
});
```

### Matchmaking

```typescript
// Join matchmaking
const result = await fetch('/matchmaking/join', {
  method: 'POST',
  body: JSON.stringify({
    gameType: 'go-fish',
    playerCount: 4,
    playerId: 'user-123',
    playerName: 'Alice',
  }),
}).then((r) => r.json());

if (result.status === 'matched') {
  // Game created!
  const ws = new WebSocket(
    `wss://example.com/games/${result.gameId}?player=${result.playerSeat}`,
  );
} else if (result.status === 'waiting') {
  // Poll for status
  const poll = setInterval(async () => {
    const status = await fetch(`/matchmaking/status?playerId=user-123`).then((r) => r.json());

    if (status.status === 'matched') {
      clearInterval(poll);
      // Connect to game
    }
  }, 1000);
}
```

### Environment Variables

```typescript
interface Env {
  GAME_STATE: DurableObjectNamespace; // Required: Durable Object binding
  MATCHMAKING: KVNamespace; // Required: KV for matchmaking
  ENVIRONMENT: string; // Optional: 'development' | 'production'
}
```

## See Also

- [boardsmith/server](./server.md) - Node.js server implementation
- [boardsmith/client](./client.md) - Browser client SDK
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
