# boardsmith/session

> Game session management for local and multiplayer games.

## When to Use

Import from `boardsmith/session` when managing game sessions, handling bot opponents, or building multiplayer infrastructure. This package provides a unified API for game state management across different platforms.

## Usage

```typescript
import {
  GameSession,
  BotController,
  generateGameId,
  type GameDefinition,
  type StorageAdapter,
} from 'boardsmith/session';
```

## Exports

### Core Classes

- `GameSession` - Main session manager for game state
- `BotController` - Manages bot player turns

### Utilities

- `generateGameId()` - Generate unique game ID
- `isPlayersTurn()` - Check if it's a player's turn
- `buildPlayerState()` - Build player-specific state view

### Player Colors

- `STANDARD_PLAYER_COLORS` - Full color palette (8 colors)
- `createColorOption()` - Create color selection option (used internally; define colors via `colorPalette` in boardsmith.json)

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
- `BotStrategy` - bot player configuration
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
- `ClaimSeatRequest` - Claim seat request
- `ClaimSeatResponse` - Claim seat response
- `UpdateNameRequest` - Update name request
- `GameSessionOptions` - Session constructor options
- `SessionActionResult` - What `GameSession.performAction()` returns
- `UndoResult` - Undo operation result
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

// Get state for a specific player (seats are 1-indexed)
const { flowState, state } = session.getState(1);
console.log('Current player:', flowState.currentPlayer);
console.log('Available actions:', flowState.actions);

// Perform an action
const result = await session.performAction('move', 1, {
  from: 'a1',
  to: 'b2',
});

if (result.success) {
  console.log('Move successful!');
} else {
  console.error('Move failed:', result.error);
}
```

### Adding bot Opponents

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game';

const session = GameSession.create({
  gameType: 'my-game',
  GameClass: MyGame,
  playerCount: 2,
  playerNames: ['Human', 'Bot'],
  botSeatConfig: {
    players: [1], // Player 1 is a bot
    level: 'hard',
  },
});

// bot moves are handled automatically when it's the bot's turn.
// Player 1 is a bot here, so the human plays seat 2.
const result = await session.performAction('move', 2, { from: 'a1', to: 'b2' });
// After the human moves, bot will automatically play
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

  // Continue playing (seats are 1-indexed)
  const { flowState, state } = session.getState(1);
}
```

### Multiplayer with Broadcast

```typescript
import type { BroadcastAdapter, SessionInfo } from 'boardsmith/session';

class WebSocketBroadcaster implements BroadcastAdapter<SessionInfo & { ws: WebSocket }> {
  // One entry per open socket, made when it opens, with an id never reused.
  private connections = new Map<string, SessionInfo & { ws: WebSocket }>();

  open(ws: WebSocket, playerSeat: number): void {
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, { connectionId, playerSeat, isSpectator: playerSeat === 0, ws });
    ws.addEventListener('close', () => this.connections.delete(connectionId));
  }

  getSessions() {
    return [...this.connections.values()];
  }

  send(session: SessionInfo & { ws: WebSocket }, message: unknown): void {
    session.ws.send(JSON.stringify(message));
  }
}

const broadcaster = new WebSocketBroadcaster();
session.setBroadcaster(broadcaster);

// When a socket opens: list it, then broadcast. The new socket gets the full
// state; every other connection is pushed nothing, because nothing it may see
// changed.
broadcaster.open(ws, seat);
session.broadcast();
```

`broadcast()` never pushes a connection a state identical to the last one it
sent it. In a simultaneous step where a seat acts in secret, that push would
tell everyone else the seat acted, so a seat whose view did not change hears
nothing (#487). Two consequences for a host:

- `connectionId` names a connection, not a seat. A page that reconnects must
  arrive under a new id, or it is compared against what its old socket was sent
  and may be sent nothing.
- Give a new connection its first state with `broadcast()`, not by sending it
  `getState()` yourself: the session does not know what you sent, so its next
  push to that connection would repeat it, and the repeat is itself a signal.
  A host that must send outside `broadcast()` keeps its own `StatePushGate`
  (below).

### `SnapshotSessionHost` compares for you

`SnapshotSessionHost` (from `boardsmith/session-host`) hands its adapter two
things after every change, and decides itself which seats changed:

```typescript
const host = new SnapshotSessionHost({
  // ...
  // The state of record: every seat's view and the spectator's. Serve a page
  // that connects or reconnects from these. Not a push.
  record: ({ players, spectator }, meta) => {
    lastViews = { players, spectator };
  },
  // Only the seats whose view changed (seat 0 is the spectators). A plain loop
  // is correct: a seat that saw nothing new is not in the list.
  push: (changed, meta) => {
    for (const { seat, view } of changed) {
      for (const socket of socketsOf(seat)) socket.send(JSON.stringify({ view, serverNow: Date.now() }));
    }
  },
});
```

Stamp per-push fields such as a send time in `push`, after the host has
compared. `meta.cause` says why the host published: `change` when the game
changed, `republish` when it restated an unchanged game (a hint, a demo frame,
`broadcastCurrent()`), `restore` and `roster` as below. Keep per-change
bookkeeping, such as reporting a turn, to `change`.

The host owns the bot roster. Tell it which seats a bot plays with
`host.setBotSeats(seats)` before `start()`, and again whenever that changes (a
seat passes between a person and the bot, or anything a derived roster depends
on changes). It publishes with cause `roster` only when whether a bot plays here
changed, so calling it with the same answer costs nothing. It does not wake the
bot pump; send `convertSeatToBot` for that.

A host that wakes from hibernation is built with
`SnapshotSessionHost.restore(adapters, { ...state, playerViews, spectatorView, botSeats })`.
`state` is the `SnapshotHostState` the `persist` adapter was handed (and
`host.durableState()` returns): `snapshot` and `pendingStates`. Store it whole.
The views are the ones the host last recorded, which the pages still show.
`botSeats` is required (`[]` when no bot plays): a restore that left it out
would publish "no bots" and push every page again once the roster was set.
`restore` publishes once, with cause `restore`, pushing only what differs from
them (a seat that passed between a person and the bot while the host slept),
and nothing when nothing does.

The snapshot carries the flow state and the winners the game declared, so read
them through `flowStateOf(state)`, `isCompleteOf(state)` and `winnersOf(state)`
(all from `boardsmith/session-host`) instead of storing copies beside it.

### Pushing state from your own host

A host that builds frames outside both of those keeps a `StatePushGate` and
asks it before every push. It is exported from `boardsmith/session` and from
`boardsmith/session-host`.

```typescript
import { StatePushGate } from 'boardsmith/session-host';

const gate = new StatePushGate<string, Frame>({
  // Where the PlayerGameState sits in your frame.
  playerState: (frame) => frame.view.state,
  // Fields you stamp fresh on every push. They never make two frames differ,
  // so they advance only when something else does.
  perPushFields: ['serverNow'],
});

// The push path, per socket:
if (gate.shouldPush(socketId, frame)) socket.send(JSON.stringify(frame));

// A frame sent outside the push path (connect, reconnect, an answer to a
// request) is recorded, in the same shape the push path builds:
gate.recordSent(socketId, frame);

// When the socket closes:
gate.forget(socketId);
```

Animation events are compared by id, not by content: the engine empties its
buffer at the start of every action, so a buffer emptied by another seat's
action is not news, and only an event with a higher id than the connection was
last sent is.

## See Also

- [boardsmith/client](./client.md) - Browser client SDK
- [boardsmith/bot](./bot.md) - bot opponent system
