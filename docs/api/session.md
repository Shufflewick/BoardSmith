# boardsmith/session

> Game session management for local and multiplayer games.

## When to Use

Import from `boardsmith/session` when hosting a game, running one headlessly in
a test or simulation, adding bot opponents, or building multiplayer
infrastructure.

Every host runs a game the same way: a `SnapshotSessionHost` holds the game's
snapshot and runs each op through the pure `executeOp`, which rebuilds the game
from that snapshot, runs the op and answers with the new snapshot and every
seat's view. The `boardsmith dev` host, `createHeadlessSession` and
ShufflewickPub all run it.

## Usage

```typescript
import {
  createHeadlessSession,
  SnapshotSessionHost,
  executeOp,
  generateGameId,
  type GameDefinition,
  type Op,
} from 'boardsmith/session';
```

## Exports

### Session Host

- `SnapshotSessionHost` - Holds one game's snapshot, runs ops on it through an `executeOp` adapter, publishes views and drives bot seats
- `SnapshotSessionAdapters` - What a host is built with: `playerCount`, `executeOp`, `record`, `push`, and optionally `persist`, `onPersistenceError`, `debug`, `teachingDisabled`, `narrateMove`, `hostWork`
- `SnapshotHostState` - The durable state a host hands `persist`: `snapshot` and `pendingStates`
- `HostRestore` - What `SnapshotSessionHost.restore` takes: the durable state, the last views and the bot roster
- `BotSeat` - A seat a bot plays, and how strongly: `{ seat, level? }`
- `PublishMeta` - Handed beside every record and push: `cause`, `isComplete`, `winners`, `isDraw`, `turnBoundary`
- `flowStateOf()`, `isCompleteOf()`, `winnersOf()` - Read the flow state, the game's end and its winners out of a snapshot
- `StatePushGate` - Decides per connection whether a frame is news, for a host that pushes outside `SnapshotSessionHost`

### Headless Session

- `createHeadlessSession(definition, tableOptions, botSeats?)` - Runs a `SnapshotSessionHost` in process over `executeOp`, for tests, simulations and agents
- `HeadlessSession<G>` - The table `createHeadlessSession` returns
- `HeadlessGameOptions` - `{ playerCount, seed?, playerNames?, options?, teachingDisabled? }`; `teachingDisabled` locks hints, the heatmap, the demo and the tutorial at both the host and `executeOp`

### Utilities

- `generateGameId()` - Generate unique game ID
- `isPlayersTurn()` - Check if it's a player's turn
- `buildPlayerState()` - Build player-specific state view

### Game Options

- `selectGameOptions()` - The one way a player's choice of the game's declared options is admitted; returns a `GameOptionSelection`
- `GameOptionSelection` - An admitted choice of game options

### Player Colors

- `STANDARD_PLAYER_COLORS` - Full color palette (8 colors)
- `createColorOption()` - Create color selection option (used internally; define colors via `colorPalette` in boardsmith.json)

### Executor Op Contract

- `executeOp(definition, gameOptions, snapshot, pendingState, op, hostOptions?)` - Run one op against a snapshot, statelessly
- `parseExecutorOp(value)` - Check a value read off a wire is an `ExecutorOp`; returns `{ ok: true, op }` or `{ ok: false, error }`
- `ParsedExecutorOp` - What `parseExecutorOp` returns
- `ExecutorOp` - The ops a platform executor runs: `start`, `action`, `expireSeat`, `selectionStep`, `resolveChoices`, `cancelAction`, `undo`, `botTurn`
- `DevOp` - Ops `executeOp` runs only inside `boardsmith dev` (the `debug*` family, `restoreEarlier`, tutorial, `hint`, `heatmapToggle`, `botSuggest`)
- `HostOp` - Lifecycle ops `SnapshotSessionHost.handleOp` handles itself and `executeOp` never sees (`demoStart`, `demoStop`, `demoControl`, `convertSeatToBot`)
- `Op` - `ExecutorOp | DevOp | HostOp`, what `handleOp` takes
- `OpResultFor<T>` - What an op of type `T` answers: its own success shape, or the shared `OpFailure`
- `OpResult` - What any op answers; narrow it with `OpResultFor`
- `OpFailure` - Every refusal: `{ success: false, error, errorCode?, category }`
- `ElementDiff` - What a `debugStateDiff` op answers in `diff`: the element IDs added, removed and changed

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
- `ColorChoice` - Color choice option
- `ColorOptionDefinition` - Color option definition

## Examples

### Running a game headlessly

`createHeadlessSession` drives a `SnapshotSessionHost` in process, so a test or
a simulation plays the game exactly as a host does. Pass the game's exported
`gameDefinition`, so its checkpoint and undo policies, tutorial and bot
strategy apply.

```typescript
import { createHeadlessSession } from 'boardsmith/session';
import { gameDefinition } from './index.js';

const session = createHeadlessSession(gameDefinition, {
  playerCount: 2,
  seed: 'repro-1',
  playerNames: ['Alice', 'Bob'],
});
await session.start(); // required before anything else

// Seats are 1-indexed. `send` stamps the current boundaryKey on a submission.
const result = await session.send(1, {
  type: 'action',
  actionName: 'move',
  player: 1,
  args: { from: 'a1', to: 'b2' },
});
if (!result.success) throw new Error(result.error);

// What seat 1 was last published, as a page receives it.
const state = session.playerState(1);
console.log('Seat 1 may act:', state.isMyTurn);

// The flow state and the end of the game, read off the host.
console.log(session.host.flowState?.awaitingInput, session.host.isComplete, session.host.winners);
```

`send` answers each op with that op's own result; narrow it with
`if (!result.success)` before reading its fields. An `action` result carries
`followUp`, `data` and `message`. Every other op works the same way, for
example `{ type: 'resolveChoices', actionName, selectionName, player, args }`,
`{ type: 'selectionStep', player, selectionName, value, actionName }`,
`{ type: 'undo', player }` and the debug ops (`createHeadlessSession` runs with
debugging on).

The table records everything the host published: `broadcasts` (every seat's
view, one entry per publish), `spectatorViews`, `metas` (each publish's
`PublishMeta`, whose `turnBoundary` is the engine's statement of which seats
owe a move) and `pushes` (only the seats whose view changed).

### Reading and arranging the game

`readGame()` returns a copy of the game rebuilt from the host's snapshot, the
way every op rebuilds it. Read typed properties from it, and read it again
after every move: a copy taken before a move is stale, and an edit to it
changes nothing at the table.

To set up a position between moves, use `arrange`. It edits a copy and then
restores that copy as a debug restore does, so every seat is published the new
position and the next move plays from it.

```typescript
// `round` stands for any property your game class declares; the copy is typed
// as your game, from the definition's gameClass.
const game = session.readGame();
console.log(game.round);

await session.arrange((game) => {
  game.round = 5;
});
```

### Adding bot opponents

The third argument names the seats a bot plays. The game definition's `bot`
field carries its `BotStrategy`.

```typescript
const session = createHeadlessSession(
  gameDefinition,
  { playerCount: 2, playerNames: ['Human', 'Bot'] },
  [{ seat: 2, level: 'hard' }],
);
await session.start();

// After the human's move the host runs its bot pump, so seat 2 replies
// before `send` resolves.
await session.send(1, { type: 'action', actionName: 'move', player: 1, args: { from: 'a1', to: 'b2' } });
```

`start()` does not run the bot pump. When a bot seat moves first, run it once
with `await session.host.runBotTurns()`. To hand a seat to the bot mid-game,
call `session.makeSeatBot(seat, level)` and then send
`{ type: 'convertSeatToBot', seat }`: the first changes the roster, the second
wakes the pump.

On your own `SnapshotSessionHost`, state the roster with
`host.setBotSeats(seats)` (see below).

### Saving and restoring a game

A host built with a `persist` adapter hands it the whole durable state after
every op that changes the game. Store that value as given, and build the host
again from it with `SnapshotSessionHost.restore`:

```typescript
import { SnapshotSessionHost, type SnapshotHostState } from 'boardsmith/session';

let saved: SnapshotHostState | null = null;
const host = new SnapshotSessionHost({ ...adapters, persist: (state) => { saved = state; } });

// Later, in a new process:
const restored = SnapshotSessionHost.restore(adapters, { ...saved!, botSeats: [] });
```

`host.durableState()` returns the same value on demand. The restore refuses a
state with no snapshot, or one that does not belong to this table, with a
message saying what to store instead.

### `SnapshotSessionHost` compares for you

`SnapshotSessionHost` (from `boardsmith/session`, and from
`boardsmith/session-host`) hands its adapter two things after every change,
and decides itself which seats changed. It never pushes a seat a view
identical to the last one it pushed it: in a simultaneous step where a seat
acts in secret, that push would tell everyone else the seat acted, so a seat
whose view did not change hears nothing (#487).

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

A host that builds frames outside `SnapshotSessionHost`'s `push` keeps a `StatePushGate` and
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

### Running ops from a platform executor

An executor receives ops over a network hop. Parse each one with
`parseExecutorOp` instead of restating the op shapes in your own schema: it
refuses a key the op does not declare (a schema that strips unknown keys would
silently lose a `boundaryKey`), requires `boundaryKey` on every submission op,
and its error names the field and the fix. It never throws.

```typescript
import { executeOp, parseExecutorOp, ErrorCode, type OpResultFor } from 'boardsmith/session';

const parsed = parseExecutorOp(await request.json());
if (!parsed.ok) return new Response(parsed.error, { status: 400 });

const result = await executeOp(definition, gameOptions, snapshot, pendingState, parsed.op);
```

`executeOp` returns `OpResultFor<T>` for the op type it was given, so each
op's result says what it carries. A success that ran the game carries one
state envelope: `snapshot` (which holds the flow state and winners; read them
with `flowStateOf`, `isCompleteOf` and `winnersOf`), `playerViews`,
`spectatorView`, `flowDebugInfo` and `persistCommit`, plus the op's own fields
(`followUp`, `data` and `message` on an `action`; `botMoved`, `botPlayer` and
`botStalled` on a `botTurn`). A `resolveChoices` success carries only its
answer and no envelope, because a query changes nothing and answers one seat:

```typescript
function reply(result: OpResultFor<'resolveChoices'>) {
  if (!result.success) return { error: result.error };
  return { choices: result.choices, validElements: result.validElements };
  // result.snapshot does not compile: a choices query returns no state.
}
```

The views and the snapshot are for the host to publish, not a reply to the
seat that sent the op: shape a reply from the op's own fields.

`persistCommit` is what the game asked the host to store (its reserved
`persist` and `persistPrivate` root attributes). No view carries either; hand
the result's `persistCommit` to `PersistenceStore.commit` at game over.

Every refusal is an `OpFailure`. Tell refusals apart by `errorCode`, never by
the message text, which is copy. A submission whose `boundaryKey` names a round
that has closed is refused with `ErrorCode.STALE_SUBMISSION`; that refusal is
normal (the round resolved without it), where any other refusal of a
host-composed op is a fault.

## See Also

- [boardsmith/client](./client.md) - Browser client SDK
- [boardsmith/bot](./bot.md) - bot opponent system
