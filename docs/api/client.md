# boardsmith/client

> The dev-host driver, the shell's audio service, and the state types a host sends.

## When to Use

A game does not connect to a server itself. A host (ShufflewickPub in
production, `boardsmith dev` locally) mounts `GameShell` in an iframe and feeds
it state over postMessage. Opened directly, outside a host, `GameShell` shows one
sentence saying how to run the game.

Import from `boardsmith/client` when you want to:

- drive a running `boardsmith dev` host from a script (`createDevHostClient`),
- control the shell's sounds (`audioService`), or
- type the state a board receives (`GameState`, `PlayerState`, `PublicFlowState`).

## Exports

### Functions

- `createDevHostClient(url, options?)` - A WebSocket client for the `boardsmith dev` host. See [Agent control](../agent-control.md#createdevhostclient--drive-the-dev-host-from-node).

### Audio

- `audioService` - The shell's notification sounds (the "your turn" chime).

### Types

- `DevHostClient`, `DevHostClientOptions`, `DevHostSeatInfo`, `DevHostLobbyReply`, `DevHostStateReply`, `DevHostInboundMessage` - The dev-host client and its replies
- `GameState` - What a host sends one seat: `{ flowState, state, playerSeat, isSpectator }`
- `PlayerState` - The seat's own state (`players`, `view`, `isMyTurn`, `actionMetadata`, `messages`, ...)
- `PublicFlowState` - What a seat is told of the flow
- `AudioServiceOptions` - Audio service options

## Examples

### Driving the dev host

<!-- typecheck: game scripts/drive.ts -->
```typescript
import { createDevHostClient } from 'boardsmith/client';

const client = createDevHostClient('ws://localhost:5173/__boardsmith/ws');
await client.opened;
client.hello();
const state = await client.getState();
```

### Audio Service

`GameShell` initialises the service and plays the turn chime itself. Every
game's controls menu has a "Sound" switch and a "Volume" slider in
"Preferences", in GameShell and WorldShell, that set it. The settings are saved
in this browser for every BoardSmith game. A game that makes its own sound reads
them when it plays, and can change them or follow a change:

<!-- typecheck: game src/ui/sound.ts -->
```typescript
import { audioService } from 'boardsmith/client';

audioService.setEnabled(false);   // mute
audioService.setVolume(0.5);      // 0..1; persisted for the next visit
audioService.isEnabled();         // read back
audioService.getVolume();
const off = audioService.onChange(() => { /* settings changed */ });
off();                            // stop listening
```

Browsers play no sound until the player has clicked or pressed a key in the
game, and after that every sound plays. When the browser blocks the turn chime,
`audioService` warns in the console. A host page that frames the game from
another origin gives its iframe `allow="autoplay"`, so the player's clicks on
the host page count too. Without it, sound waits for the first click inside the
game frame. `boardsmith dev` serves its frame from the same origin as its host page, so
it needs no `allow`.

## See Also

- [Agent control](../agent-control.md) - Driving `boardsmith dev` from a script
- [boardsmith/session](./session.md) - Session management
- [UI Components Guide](../ui-components.md) - Building game UIs
