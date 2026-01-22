# boardsmith/server

> Platform-agnostic game server core.

## When to Use

Import from `boardsmith/server` when building self-hosted game servers. This package provides HTTP/WebSocket handlers, storage adapters, and matchmaking that works with both Node.js and edge runtimes.

## Usage

```typescript
import {
  GameServerCore,
  InMemoryGameStore,
  SqliteGameStore,
  handleCreateGame,
  handleAction,
} from 'boardsmith/server';
```

## Exports

### Core

- `GameServerCore` - Main server class

### Storage Implementations

- `InMemoryGameStore` - In-memory game storage
- `SimpleGameRegistry` - Simple game registry
- `InMemoryMatchmakingStore` - In-memory matchmaking
- `SqliteGameStore` - SQLite game storage
- `SqliteStorageAdapter` - SQLite storage adapter
- `initSqliteSchema()` - Initialize SQLite schema

### Request Handlers

- `handleCreateGame()` - Handle game creation
- `handleGetGame()` - Handle get game state
- `handleAction()` - Handle action execution
- `handleGetHistory()` - Handle get action history
- `handleGetStateAt()` - Handle get state at action index
- `handleGetStateDiff()` - Handle get state diff
- `handleUndo()` - Handle undo request
- `handleRestart()` - Handle game restart
- `handleHealth()` - Handle health check
- `handleRewind()` - Handle rewind to action

### Matchmaking Handlers

- `handleMatchmakingJoin()` - Handle join matchmaking
- `handleMatchmakingStatus()` - Handle matchmaking status check
- `handleMatchmakingLeave()` - Handle leave matchmaking

### Types

- `ServerRequest` - Server request type
- `ServerResponse` - Server response type
- `GameServerCoreOptions` - Server options
- `CreateGameOptions` - Create game options
- `CreateGameResult` - Create game result
- `GameStore` - Game storage interface
- `GameRegistry` - Game registry interface
- `MatchmakingStore` - Matchmaking storage interface
- `QueueEntry` - Matchmaking queue entry
- `MatchInfo` - Match information
- `WaitingInfo` - Waiting information
- `MatchmakingRequest` - Matchmaking request
- `WebSocketAdapter` - WebSocket adapter interface
- `WebSocketSession` - WebSocket session
- `GameSessionWithBroadcaster` - Session with broadcaster
- `BroadcasterFactory` - Broadcaster factory function
- `GameDefinition` - Game definition
- `GameClass` - Game class type
- `GameConfig` - Game configuration
- `StoredGameState` - Stored game state
- `PlayerGameState` - Player game state
- `SessionInfo` - Session information
- `AIConfig` - AI configuration
- `BroadcastAdapter` - Broadcast adapter
- `StorageAdapter` - Storage adapter
- `CreateGameRequest` - Create game request
- `ActionRequest` - Action request
- `WebSocketMessage` - WebSocket message

## Examples

### Basic Express Server

```typescript
import express from 'express';
import { GameServerCore, InMemoryGameStore, SimpleGameRegistry } from 'boardsmith/server';
import { GoFishGame } from './games/go-fish/game';

const app = express();
app.use(express.json());

// Set up game registry
const registry = new SimpleGameRegistry();
registry.set({
  gameType: 'go-fish',
  gameClass: GoFishGame,
  minPlayers: 2,
  maxPlayers: 6,
});

// Set up server
const server = new GameServerCore({
  gameRegistry: registry,
  gameStore: new InMemoryGameStore(),
});

// REST endpoints
app.post('/games', async (req, res) => {
  const result = await server.createGame(req.body);
  res.status(result.success ? 201 : 400).json(result);
});

app.get('/games/:id', async (req, res) => {
  const player = parseInt(req.query.player as string) || 0;
  const result = await server.getGame(req.params.id, player);
  res.json(result);
});

app.post('/games/:id/action', async (req, res) => {
  const result = await server.performAction(req.params.id, req.body);
  res.json(result);
});

app.listen(3000);
```

### With SQLite Persistence

```typescript
import { GameServerCore, SqliteGameStore, SimpleGameRegistry } from 'boardsmith/server';
import Database from 'better-sqlite3';

// Initialize SQLite
const db = new Database('./games.db');
const gameStore = new SqliteGameStore(db);

const server = new GameServerCore({
  gameRegistry: registry,
  gameStore: gameStore,
});

// Games now persist across restarts
```

### WebSocket Support

```typescript
import { WebSocketServer } from 'ws';
import { GameServerCore, InMemoryGameStore } from 'boardsmith/server';

const wss = new WebSocketServer({ port: 8080 });
const server = new GameServerCore({
  gameRegistry: registry,
  gameStore: new InMemoryGameStore(),
});

wss.on('connection', (ws, req) => {
  const gameId = new URL(req.url!, 'http://localhost').searchParams.get('gameId');
  const player = parseInt(new URL(req.url!, 'http://localhost').searchParams.get('player') || '0');

  // Register connection for broadcasts
  server.registerConnection(gameId!, {
    playerSeat: player,
    send: (msg) => ws.send(JSON.stringify(msg)),
  });

  ws.on('message', async (data) => {
    const message = JSON.parse(data.toString());

    if (message.type === 'action') {
      const result = await server.performAction(gameId!, {
        action: message.action,
        player: player,
        args: message.args,
      });

      ws.send(JSON.stringify({ type: 'actionResult', ...result }));
    }
  });

  ws.on('close', () => {
    server.unregisterConnection(gameId!, player);
  });
});
```

### Using Individual Handlers

```typescript
import {
  handleCreateGame,
  handleGetGame,
  handleAction,
  InMemoryGameStore,
  SimpleGameRegistry,
} from 'boardsmith/server';

const gameStore = new InMemoryGameStore();
const registry = new SimpleGameRegistry();
registry.set(gameDefinition);

// In your request handler
async function createGame(req: Request): Promise<Response> {
  const body = await req.json();

  const result = await handleCreateGame(gameStore, registry, body);

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### Matchmaking

```typescript
import {
  InMemoryMatchmakingStore,
  handleMatchmakingJoin,
  handleMatchmakingStatus,
  handleMatchmakingLeave,
} from 'boardsmith/server';

const matchmaking = new InMemoryMatchmakingStore();

app.post('/matchmaking/join', async (req, res) => {
  const result = await handleMatchmakingJoin(
    matchmaking,
    registry,
    req.body,
    async (gameType, playerCount, playerNames, playerIds) => {
      // Create game when match is found
      const game = await server.createGame({
        gameType,
        playerCount,
        playerNames,
        playerIds,
      });
      return game.gameId!;
    },
  );
  res.status(result.status).json(result.body);
});

app.get('/matchmaking/status', async (req, res) => {
  const result = await handleMatchmakingStatus(matchmaking, req.query.playerId as string);
  res.status(result.status).json(result.body);
});

app.post('/matchmaking/leave', async (req, res) => {
  const result = await handleMatchmakingLeave(matchmaking, req.body.playerId);
  res.status(result.status).json(result.body);
});
```

### Custom Storage Adapter

```typescript
import type { GameStore, StoredGameState } from 'boardsmith/server';

class RedisGameStore implements GameStore {
  constructor(private redis: Redis) {}

  async get(gameId: string): Promise<StoredGameState | null> {
    const data = await this.redis.get(`game:${gameId}`);
    return data ? JSON.parse(data) : null;
  }

  async set(gameId: string, state: StoredGameState): Promise<void> {
    await this.redis.set(`game:${gameId}`, JSON.stringify(state));
  }

  async delete(gameId: string): Promise<void> {
    await this.redis.del(`game:${gameId}`);
  }

  async list(): Promise<string[]> {
    const keys = await this.redis.keys('game:*');
    return keys.map((k) => k.replace('game:', ''));
  }
}
```

### Multiple Game Types

```typescript
import { SimpleGameRegistry } from 'boardsmith/server';
import { GoFishGame } from './games/go-fish/game';
import { CheckersGame } from './games/checkers/game';
import { TicTacToeGame } from './games/tic-tac-toe/game';

const registry = new SimpleGameRegistry();

registry.set({
  gameType: 'go-fish',
  gameClass: GoFishGame,
  minPlayers: 2,
  maxPlayers: 6,
});

registry.set({
  gameType: 'checkers',
  gameClass: CheckersGame,
  minPlayers: 2,
  maxPlayers: 2,
});

registry.set({
  gameType: 'tic-tac-toe',
  gameClass: TicTacToeGame,
  minPlayers: 2,
  maxPlayers: 2,
});

// Server automatically handles all game types
```

## See Also

- [boardsmith/client](./client.md) - Browser client SDK
- [boardsmith/worker](./worker.md) - Cloudflare Workers deployment
- [boardsmith/session](./session.md) - Session management
