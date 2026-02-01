# BoardSmith Async Gameplay Analysis

## Executive Summary

**Good news: BoardSmith already has most of the infrastructure needed for asynchronous gameplay.** The architecture is fundamentally sound for asynchronous play because:

1. **Games are event-sourced** - Every action is serialized and stored, allowing full game state reconstruction
2. **Persistence is already built** - `SqliteGameStore` persists games to disk
3. **Reconnection is seamless** - Clients can reconnect via the same URL and receive current state
4. **Turn tracking exists** - `FlowState.currentPlayer` and `awaitingInput` already track whose turn it is

**What's missing** are the hooks for external systems (notifications, game listing services) to integrate.

---

## Part 1: What Already Works

### 1.1 Game Identification & Retrieval

Games are identified by a unique `gameId` (string). Players can return to a game simply by knowing the URL:

```
ws://host/games/{gameId}?playerId={id}&player={seat}
```

The architecture supports this pattern at `src/server/core.ts`:
- `POST /games` creates a new game
- `GET /games/:gameId` retrieves current state
- `GET /games/list` lists persisted games (for resume feature)

### 1.2 State Persistence

From `src/session/types.ts`, `StoredGameState` captures everything needed:

```typescript
interface StoredGameState {
  gameType: string;
  playerCount: number;
  playerNames: string[];
  playerIds?: string[];           // For identifying returning players
  seed?: string;                  // Deterministic RNG
  actionHistory: SerializedAction[]; // Full history for replay
  createdAt: number;
  lobbyState?: 'waiting' | 'playing' | 'finished';
  lobbySlots?: LobbySlot[];       // Who's in which seat
  creatorId?: string;
  // ...
}
```

Storage is handled by `SqliteStorageAdapter` (`src/server/stores/sqlite-storage.ts`):
- Simple schema: `games(game_id, state_json, updated_at)`
- State saved as JSON after every action
- Index on `updated_at` for listing games by recency

### 1.3 Reconnection Flow

From `src/client/game-connection.ts`, reconnection is automatic:

1. Client opens WebSocket with same `gameId` + `playerId` + `playerSeat`
2. Client sends `getState` message
3. Server responds with complete `PlayerGameState` + `FlowState`
4. Auto-reconnect with exponential backoff (5 attempts, capped at 30s)
5. Keep-alive pings every 30 seconds

**This means: A player can close their browser, come back hours/days later, and resume exactly where they left off.**

### 1.4 Turn Tracking

From `src/engine/flow/types.ts`, `FlowState` includes:

```typescript
interface FlowState {
  complete: boolean;              // Is game finished?
  awaitingInput: boolean;         // Waiting for player action?
  currentPlayer?: number;         // Whose turn (1-indexed)
  availableActions?: string[];    // What they can do
  currentPhase?: string;          // Game phase name
  // ...
}
```

Every state broadcast includes this, so clients always know whose turn it is.

### 1.5 Lobby System for Async Setup

The lobby flow (`src/session/lobby-manager.ts`) already supports asynchronous player joining:

1. Host creates game with `useLobby: true`
2. Game sits in `lobbyState: 'waiting'`
3. Players can join at any time via `claimSeat()`
4. Each player marks `ready` when they're set
5. Game starts when all ready

**This enables "create now, play later" patterns.**

---

## Part 2: What's Missing for Full Async Support

### 2.1 Game Lifecycle Events (Critical Gap)

**Current state:** There's an internal `onGameStart` callback in `LobbyManager`, but:
- No `onGameEnd` callback exists
- No `onTurnChange` callback exists
- No external event emission mechanism

From `src/session/lobby-manager.ts`:
```typescript
interface LobbyManagerCallbacks {
  onGameStart: () => void;        // Exists - but only triggers AI
  onAIConfigChanged: (aiSlots: LobbySlot[]) => void;
  // No onGameEnd
  // No onTurnChange
}
```

**Impact:** External systems (notification service, game listing service) have no way to know when:
- A game starts
- A game ends
- A turn changes

### 2.2 Game Listing by Player (Missing)

**Current state:** `SqliteGameStore.listGames()` returns all game IDs, but there's no way to:
- Query games by player ID
- Filter to only incomplete games
- Get summary info (whose turn, last activity, etc.)

The current schema (`src/server/stores/sqlite-storage.ts`) only has:
```sql
CREATE TABLE games (
  game_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

To find a player's games, you'd have to:
1. Load all games
2. Parse all JSON
3. Check `playerIds` array for each

**Not scalable.**

### 2.3 Turn Notifications (Missing)

**Current state:** The server broadcasts state to all connected WebSocket clients, but:
- No mechanism to notify disconnected players
- No webhook/callback when turn changes
- No email/push notification infrastructure

The broadcast happens in `src/session/game-session.ts`, but only to active WebSocket connections:
```typescript
broadcast(): void {
  const sessions = this.#broadcaster.getSessions();
  for (const session of sessions) {
    this.#broadcaster.send(session, update);
  }
}
```

---

## Part 3: Recommended Implementation

### 3.1 Lifecycle Event System

Add an event emitter interface that external systems can subscribe to:

```typescript
// New file: src/session/lifecycle-events.ts

export type GameLifecycleEvent =
  | { type: 'game:started'; gameId: string; gameType: string; playerIds: string[]; timestamp: number }
  | { type: 'game:ended'; gameId: string; winners: number[]; reason: 'complete' | 'abandoned'; timestamp: number }
  | { type: 'turn:changed'; gameId: string; previousPlayer: number; currentPlayer: number; playerIds: string[]; timestamp: number };

export interface LifecycleEventHandler {
  emit(event: GameLifecycleEvent): void | Promise<void>;
}
```

This would be configured at server startup and called from:
- `LobbyManager` when transitioning to 'playing' → `game:started`
- `GameSession.performAction()` when `flowState.complete` becomes true → `game:ended`
- `GameSession.performAction()` when `currentPlayer` changes → `turn:changed`

### 3.2 Implementation Points for Lifecycle Events

**game:started** - Add to `src/session/lobby-manager.ts` in `startGame()`:
```typescript
// After transitioning state
if (this.#eventHandler) {
  this.#eventHandler.emit({
    type: 'game:started',
    gameId: this.#storedState.gameId,
    gameType: this.#storedState.gameType,
    playerIds: this.#storedState.playerIds ?? [],
    timestamp: Date.now(),
  });
}
```

**game:ended** - Add to `src/session/game-session.ts` in `performAction()`:
```typescript
// After action execution, check if game ended
const flowState = this.#runner.getFlowState();
if (flowState?.complete && this.#storedState.lobbyState !== 'finished') {
  this.#storedState.lobbyState = 'finished';
  if (this.#eventHandler) {
    this.#eventHandler.emit({
      type: 'game:ended',
      gameId: this.#gameId,
      winners: flowState.winners ?? [],
      reason: 'complete',
      timestamp: Date.now(),
    });
  }
}
```

**turn:changed** - Add to `src/session/game-session.ts` in `performAction()`:
```typescript
// Track previous player before action
const previousPlayer = flowState?.currentPlayer;

// ... perform action ...

// After action, check if turn changed
const newFlowState = this.#runner.getFlowState();
if (newFlowState?.currentPlayer !== previousPlayer && this.#eventHandler) {
  this.#eventHandler.emit({
    type: 'turn:changed',
    gameId: this.#gameId,
    previousPlayer: previousPlayer ?? 0,
    currentPlayer: newFlowState?.currentPlayer ?? 0,
    playerIds: this.#storedState.playerIds ?? [],
    timestamp: Date.now(),
  });
}
```

### 3.3 Pluggable Event Handlers

The event handler should be injectable at multiple levels:

```typescript
// Server-level handler (for notification service)
const notificationHandler: LifecycleEventHandler = {
  emit: async (event) => {
    if (event.type === 'turn:changed') {
      const playerId = event.playerIds[event.currentPlayer - 1];
      await sendPushNotification(playerId, `It's your turn in game ${event.gameId}`);
    }
  }
};

// GameStore constructor
const store = new SqliteGameStore(dbPath, registry, broadcasterFactory, {
  eventHandler: notificationHandler
});
```

### 3.4 Database Schema for Player Game Queries

To efficiently query "what games does this player have?", extend the schema:

```sql
-- New table: player_games (for O(1) lookup by player)
CREATE TABLE IF NOT EXISTS player_games (
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  status TEXT NOT NULL,  -- 'waiting' | 'playing' | 'finished'
  is_current_turn BOOLEAN DEFAULT FALSE,
  last_activity INTEGER NOT NULL,
  PRIMARY KEY (player_id, game_id)
);

CREATE INDEX idx_player_games_active ON player_games (player_id, status, is_current_turn);
```

This would be maintained by the lifecycle event handler:
- `game:started` → Insert rows for all players
- `game:ended` → Update `status = 'finished'` for all players
- `turn:changed` → Update `is_current_turn` flags

### 3.5 New API Endpoints

```typescript
// GET /players/:playerId/games - Get all games for a player
// Query params: status (waiting|playing|finished|all), myTurn (true|false)
{
  games: [
    {
      gameId: string;
      gameType: string;
      displayName: string;
      status: 'waiting' | 'playing' | 'finished';
      isMyTurn: boolean;
      lastActivity: number;
      playerCount: number;
      currentPhase?: string;
    }
  ]
}
```

---

## Part 4: Notification System Architecture

### 4.1 Event Flow

```
GameSession.performAction()
    │
    ├──▶ Update state
    ├──▶ Broadcast to WebSocket clients (existing)
    └──▶ Emit lifecycle event (new)
              │
              ▼
    LifecycleEventHandler
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
  Queue    Database   Direct
  (async)  (tracking) (webhook)
```

### 4.2 Notification Strategies

**Option A: Push to external service (recommended for production)**
```typescript
// Your game server emits events
eventHandler.emit({ type: 'turn:changed', ... });

// External notification service consumes them
// - Email service sends "It's your turn!"
// - Push notification service sends mobile alerts
// - Browser tab titles update via server-sent events
```

**Option B: In-browser polling**
```typescript
// Client polls /players/:id/games?myTurn=true
// Shows badge/notification in browser
// No server infrastructure needed
```

**Option C: WebSocket presence tracking**
```typescript
// Server tracks which players are "online"
// Only send external notifications to offline players
// Online players get real-time WebSocket updates
```

### 4.3 Email/Push Notification Content

When `turn:changed` fires:
```typescript
const event = {
  type: 'turn:changed',
  gameId: 'abc123',
  currentPlayer: 2,
  playerIds: ['user-alice', 'user-bob', 'user-carol'],
  timestamp: Date.now(),
};

// Determine who to notify
const playerIdToNotify = event.playerIds[event.currentPlayer - 1]; // 'user-bob'

// Send notification
await notificationService.send({
  userId: playerIdToNotify,
  title: "Your turn!",
  body: "It's your turn in Chess Match #abc123",
  url: `https://yourgame.com/games/abc123`,
});
```

---

## Part 5: Implementation Phases

### Phase 1: Core Events (Foundation)
**Effort: ~2-3 days**

1. Add `gameId` to `StoredGameState` (currently only exists as key in the store)
2. Create `LifecycleEventHandler` interface
3. Add event emission points in `GameSession` and `LobbyManager`
4. Add event handler configuration to `GameServerCore`

**Files to modify:**
- `src/session/types.ts` - Add event types
- `src/session/game-session.ts` - Emit events
- `src/session/lobby-manager.ts` - Emit game:started
- `src/server/types.ts` - Add handler config
- `src/server/core.ts` - Wire up handler

### Phase 2: Player Game Tracking (Database)
**Effort: ~1-2 days**

1. Extend SQLite schema with `player_games` table
2. Create event handler that maintains the table
3. Add `listPlayerGames()` method to store
4. Add `/players/:id/games` endpoint

**Files to modify/create:**
- `src/server/stores/sqlite-storage.ts` - Schema update
- `src/server/stores/sqlite-games.ts` - New methods
- `src/server/handlers/players.ts` - New handlers
- `src/server/core.ts` - New routes

### Phase 3: Notification Integration (External)
**Effort: Depends on notification infrastructure**

This phase would be implemented by the consumer of BoardSmith, not in BoardSmith itself:

1. Implement `LifecycleEventHandler` that pushes to notification service
2. Set up email/push notification templates
3. Track user preferences (notify by email? push? both?)
4. Handle rate limiting (don't spam if turns are rapid)

---

## Part 6: Verification Checklist

Before declaring async support complete, verify these scenarios:

### Reconnection Scenarios
- [ ] Player closes browser, reopens same URL → sees current game state
- [ ] Player's internet drops mid-turn → auto-reconnects and can continue
- [ ] Player returns after 24 hours → game loads correctly
- [ ] Server restarts → all games survive and are playable

### Turn Flow Scenarios
- [ ] Player 1 takes turn, Player 2 receives state update
- [ ] Player 2 is disconnected when turn changes → receives notification
- [ ] AI player takes turn → human players see update
- [ ] Simultaneous actions → all players see resolution

### Game Lifecycle Scenarios
- [ ] Game created with lobby → `game:started` fires when all ready
- [ ] Game reaches win condition → `game:ended` fires
- [ ] Player abandons game → can be marked finished manually

### Player Games Query Scenarios
- [ ] New player → empty games list
- [ ] Player in 3 active games → sees all 3
- [ ] Filter by "my turn" → only shows games where it's their turn
- [ ] Game finishes → moves to "finished" list

---

## Conclusion

BoardSmith is **architecturally ready** for async gameplay. The event-sourced state, persistent storage, and reconnection handling are all in place.

The main work needed is:

| Phase | Work | Effort |
|-------|------|--------|
| 1 | Adding lifecycle event hooks | ~2-3 days |
| 2 | Player game tracking | ~1-2 days |
| 3 | Notification integration | External |

The core gameplay loop of "visit URL → see game → take action → disconnect → return later" **already works today** if you're using `SqliteGameStore` with `--persist`.

---

## Appendix: Key File Locations

| Purpose | File Path |
|---------|-----------|
| Game session management | `src/session/game-session.ts` |
| Stored state types | `src/session/types.ts` |
| Lobby management | `src/session/lobby-manager.ts` |
| HTTP/WebSocket server | `src/server/core.ts` |
| SQLite game store | `src/server/stores/sqlite-games.ts` |
| SQLite storage adapter | `src/server/stores/sqlite-storage.ts` |
| Client reconnection | `src/client/game-connection.ts` |
| Game runner & replay | `src/runtime/runner.ts` |
