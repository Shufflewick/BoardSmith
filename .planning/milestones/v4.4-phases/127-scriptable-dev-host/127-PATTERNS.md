# Phase 127: Scriptable Dev Host - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 7 (2 modified in-repo protocol files, 2 modified host/UI files, 1 modified client file, 2 new test files + 1 optional new client helper)
**Analogs found:** 7 / 7 (all patterns exist in-repo already — this phase is purely additive; RESEARCH.md already did line-precise archaeology, this file re-verifies and packages it for the planner)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli/dev-host/multiplayer-host.ts` (add `getState`/`getLobby`/`debugToggle`/`uiSwitch` to `ClientInbound`/`HostOutbound` + handlers) | controller (WS message router) | request-response (getState/getLobby) + event-driven relay (debugToggle/uiSwitch) | itself — `handleFollow`/`handleServerRequest`/`reinitSeat` in the same file | exact (same file, same role, same class) |
| `src/cli/dev-host/DevHost.vue` (add `onHostMessage` cases for `debugToggle`/`uiSwitch`) | component (Vue, WS message switch → postMessage relay) | event-driven | itself — the existing `case 'follow':` handler (line 177-179) | exact |
| `src/client/game-connection.ts` (fix `new WebSocket()` / `WebSocket.OPEN`/`.CONNECTING` → injectable `wsCtor`) | service (client SDK, WebSocket wrapper) | streaming / request-response | itself — no other file has this exact shape | exact (self-analog; only a runtime-environment fix, not a new pattern) |
| `src/client/types.ts` (optional: add `wsImplementation?` to `GameConnectionConfig`) | config/types | — | itself — `GameConnectionConfig` interface | exact |
| `src/types/protocol.ts` (verify/extend `GetStateMessage`/`GetLobbyMessage` response shapes if missing) | model/types | request-response | itself — `GetStateMessage`/`GetLobbyMessage` already defined lines 319-326 | exact |
| `src/cli/dev-host/multiplayer-host.test.ts` (add unit test cases for the 4 new ops) | test | request-response / event-driven | itself — existing in-process fake-`send` test harness | exact |
| `src/cli/dev-host/DevHost.debug-relay.test.ts` (NEW) | test | event-driven | `src/cli/dev-host/DevHost.restart.test.ts` — `FakeWebSocket` harness | exact |
| `src/cli/dev-host/<name>.integration.test.ts` (NEW) | test | request-response, real WS | `src/cli/commands/dev.ts` lines 516-583 (`WebSocketServer`/`MultiplayerHost` wiring) | role-match (test replicates production wiring, not a test file itself) |
| `src/client/game-connection.test.ts` (NEW) | test | request-response | `multiplayer-host.test.ts`'s general vitest style (no direct GameConnection test precedent exists) | no direct analog — see "No Analog Found" |
| dev-host protocol client helper (e.g. `createDevHostClient`, NEW — exported from `boardsmith/client` per CONTEXT.md amendment) | service (small Node/browser WS client) | request-response | `DevHost.vue`'s own `ws`/`wsSend`/`connect()` block (lines 105-137) — same wire protocol, different runtime | role-match (protocol match, different environment: Vue reactive state → plain class) |

## Pattern Assignments

### `src/cli/dev-host/multiplayer-host.ts` — add `getState`/`getLobby` (controller, request-response)

**Analog:** itself — `handleServerRequest` (guard chain) + `reinitSeat` (view/meta builder) + `handleFollow` (union-member + switch-case wiring pattern)

**Union member pattern** (lines 39-55 — add new variants exactly like this):
```typescript
export type HostOutbound =
  | { type: 'lobby'; phase: LobbyPhase; seats: SeatInfo[]; minPlayers: number; playerCount: number }
  | { type: 'joined'; seat: number }
  | { type: 'error'; message: string }
  | { type: 'init'; seat: number }
  | { type: 'game_state'; view: unknown; isComplete: boolean; winners: number[] }
  | { type: 'server_response'; requestId: string | null; result: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean; seat: number };

export type ClientInbound =
  | { type: 'hello' }
  | { type: 'join'; seat: number; name?: string; color?: string }
  | { type: 'leave' }
  | { type: 'restart' }
  | { type: 'server_request'; requestId: string; op: string; payload: Record<string, unknown> }
  | { type: 'follow'; enabled: boolean };
```
New variants to add (mirror the `requestId` field style already used on `server_request`/`server_response`):
```typescript
// ClientInbound additions
| { type: 'getState'; requestId?: string }
| { type: 'getLobby'; requestId?: string }
// HostOutbound additions — reuse the EXISTING 'game_state'/'lobby' shapes plus requestId,
// do not invent new response type names (keeps getState provably = the broadcast shape)
| { type: 'game_state'; view: unknown; isComplete: boolean; winners: number[]; requestId?: string | null }
```

**Dispatch switch pattern** (lines 206-221 — add two `case` arms exactly like the existing ones):
```typescript
async handleMessage(clientId: string, msg: ClientInbound): Promise<void> {
  switch (msg.type) {
    case 'hello':
      return this.hello(clientId);
    case 'join':
      return this.handleJoin(clientId, msg);
    case 'leave':
      return this.handleLeave(clientId);
    case 'restart':
      return this.handleRestart(clientId);
    case 'server_request':
      return this.handleServerRequest(clientId, msg);
    case 'follow':
      return this.handleFollow(clientId, msg);
    // ADD: case 'getState': return this.handleGetState(clientId, msg);
    // ADD: case 'getLobby': return this.handleGetLobby(clientId, msg);
  }
}
```

**Guard-chain + view-builder pattern to copy verbatim** (`handleServerRequest`, lines 314-333, and `reinitSeat`, lines 477-484):
```typescript
private async handleServerRequest(
  clientId: string,
  msg: Extract<ClientInbound, { type: 'server_request' }>,
): Promise<void> {
  if (this.phase !== 'playing' || !this.session) {
    this.send(clientId, { type: 'error', message: 'Game has not started.' });
    return;
  }
  // A follower acts as whichever seat is currently due, not its own seat.
  const seat =
    clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
  if (seat === undefined) {
    this.send(clientId, { type: 'error', message: 'You are not seated in this game.' });
    return;
  }
  ...
}

private reinitSeat(clientId: string, seat: number): void {
  this.send(clientId, { type: 'init', seat });
  const view = this.session?.viewForSeat(seat);
  if (view !== undefined && this.session) {
    const meta = this.session.meta();
    this.send(clientId, { type: 'game_state', view, isComplete: meta.isComplete, winners: meta.winners });
  }
}
```
`getState` must copy BOTH guards (phase-not-playing, then seat-not-found) before calling `viewForSeat` — this is the exact chain research Pitfall 5 flags as easy to under-copy. `getLobby` must NOT be gated behind `phase === 'playing'` (it needs to work in lobby phase too, unlike `getState`) — reuse `lobbyMessage()` (lines 564-572) directly:
```typescript
private lobbyMessage(): HostOutbound {
  return {
    type: 'lobby',
    phase: this.phase,
    seats: [...this.seats.values()].map((s) => ({ ...s })),
    minPlayers: this.opts.minPlayers,
    playerCount: this.opts.playerCount,
  };
}
```

**Security-critical rule (from `handleServerRequest`'s own pattern):** seat must ONLY ever be resolved from server-tracked `clientSeat`/`followerClientId` — never accept a client-supplied `seat` field on `getState` (would leak another seat's hidden-info view).

---

### `src/cli/dev-host/multiplayer-host.ts` — add `debugToggle`/`uiSwitch` (controller, event-driven relay)

**Analog:** `handleFollow`'s outbound relay half + `broadcastLobby`'s fan-out pattern

**Fan-out relay pattern to copy** (`broadcastLobby`, lines 574-577 — the template for "send to every connected client"):
```typescript
private broadcastLobby(): void {
  const message = this.lobbyMessage();
  for (const clientId of this.connected) this.send(clientId, message);
}
```
New handlers follow this shape exactly (broadcast to all connected browser tabs, since neither op has a single canonical "the" target — see research Pitfall 4):
```typescript
private handleDebugToggle(clientId: string, msg: Extract<ClientInbound, { type: 'debugToggle' }>): void {
  for (const cid of this.connected) this.send(cid, { type: 'debugToggle' });
  // Optional: ack the requester specifically so a headless script can confirm dispatch
  // even when it has no iframe of its own to observe an effect in.
}
```

**The `follow` round-trip is the canonical precedent for "WS message → page reacts locally, no bridge.ts involvement"** (lines 240-272 host-side / DevHost.vue lines 177-179, 278-280 page-side) — copy this shape, not `server_request`'s bridge-routed shape, for both new relay ops.

---

### `src/cli/dev-host/DevHost.vue` — add `onHostMessage` relay cases (component, event-driven)

**Analog:** itself — the existing `case 'follow':` arm

**Exact insertion point** (`onHostMessage`, lines 139-181):
```typescript
function onHostMessage(msg: Record<string, unknown>): void {
  connected.value = true;
  switch (msg.type) {
    case 'lobby': { ... }
    case 'joined': ...
    case 'error': ...
    case 'init': ...
    case 'game_state': ...
    case 'server_response': ...
    case 'follow':
      followActive.value = msg.enabled as boolean;
      break;
    // ADD:
    // case 'debugToggle':
    //   toggleDebug(); // exact same function the header button already calls
    //   break;
    // case 'uiSwitch':
    //   selectedUi.value = msg.name as string; onUiSelect();
    //   break;
  }
}
```

**The two page-local functions the new cases must drive (do not duplicate their logic — call them):**
```typescript
// lines 281-283
function onUiSelect(): void {
  postToGame({ type: 'dev-ui-select', name: selectedUi.value });
}
// lines 301-303
function toggleDebug(): void {
  postToGame({ type: 'dev-debug-toggle' });
}
```

**`wsSend` pattern** (lines 118-120) — used by the page to send the NEW ops if the page itself ever triggers them (not required for this phase but shows the wire-send convention):
```typescript
function wsSend(message: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
```

---

### `src/client/game-connection.ts` — Node-capability fix (service, streaming/request-response)

**Analog:** itself (the only two browser-global touch points in the whole file)

**Current code to change** (lines 71, 80):
```typescript
connect(): void {
  if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
    return; // Already connected or connecting
  }
  this.setStatus('connecting');
  this.clearReconnectTimer();
  try {
    const wsUrl = this.buildWebSocketUrl();
    this.ws = new WebSocket(wsUrl);
    this.setupWebSocketHandlers();
  } catch (error) {
    this.handleError(error instanceof Error ? error : new Error(String(error)));
    this.scheduleReconnect();
  }
}
```
**Target pattern** — introduce a private `#WS` (or `wsCtor`) field resolved once in the constructor from `config.wsImplementation ?? globalThis.WebSocket`, with a fail-loud guard (per CLAUDE.md's "fail fast and loud, actionable errors" rule) when neither is available:
```typescript
constructor(baseUrl: string, config: GameConnectionConfig) {
  ...
  this.wsCtor = config.wsImplementation ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!this.wsCtor) {
    throw new Error(
      'GameConnection requires a WebSocket implementation. Node <22.4 has no global WebSocket — ' +
      'either upgrade to Node >=22.4 or pass `wsImplementation` in GameConnectionConfig.',
    );
  }
}
```
All other `WebSocket.OPEN`/`.CONNECTING` static reads (lines 71, 118, 156, 361, 422) and the `new WebSocket(wsUrl)` call (line 80) route through `this.wsCtor` instead of the bare global.

**Config type to extend** (`src/client/types.ts` — `GameConnectionConfig`, add alongside existing fields the RESEARCH.md references, e.g. `gameId`/`playerId`):
```typescript
wsImplementation?: typeof WebSocket;
```

---

### `src/client/index.ts` — export surface (config, no data flow)

**Current exports** (lines 34-80) already export `GameConnection` and its config types. If a new dev-host protocol client is added per CONTEXT.md's amendment (`createDevHostClient` or similar), add it here as a new named export alongside `GameConnection` — do not fold it into `GameConnection`'s class (Anti-Pattern flagged in RESEARCH.md: "Building a second `GameConnection`-shaped class that speaks the dev-host protocol" — keep them separate, siblings, not one bilingual class):
```typescript
export { GameConnection } from './game-connection.js';
// ADD (if built): export { createDevHostClient } from './dev-host-client.js';
```

---

### `src/cli/dev-host/multiplayer-host.test.ts` — unit tests for 4 new ops (test)

**Analog:** itself — existing in-process fake-`send` harness (no real sockets)
```typescript
// lines 1-24 — the existing pattern: build a MultiplayerHostOptions with a
// fake `send` callback that just records outbound messages, then call
// handleMessage(clientId, msg) directly and assert on the recorded sends.
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
```
New test cases for `getState`/`getLobby`/`debugToggle`/`uiSwitch` should follow this exact "construct a minimal PassGame, drive `handleMessage`, assert recorded `send` calls" style — no new test infrastructure needed.

---

### `src/cli/dev-host/DevHost.debug-relay.test.ts` (NEW) — component test (test)

**Analog:** `src/cli/dev-host/DevHost.restart.test.ts` — `FakeWebSocket` harness (CONFIRMED, do not invent a new harness)
```typescript
// DevHost.restart.test.ts lines 27-61 (approx) — hand-rolled FakeWebSocket,
// NOT a mocking library, assigned to global.WebSocket, with
// simulateOpen()/simulateMessage() helpers driven by the test:
interface MockWS {
  simulateOpen(): void;
  simulateMessage(data: Record<string, unknown>): void;
}
class FakeWebSocket { /* readyState, send/close stubs, event listener registry */ }
// Setup pattern (line 120):
vi.stubGlobal('WebSocket', FakeWebSocket);
// Usage pattern (lines 100-104, 217, 235):
ws.simulateOpen();
ws.simulateMessage(SEAT_LOBBY);
ws.simulateMessage({ type: 'init', seat: 1 });
ws.simulateMessage({ type: 'game_state', view: {}, isComplete: false, winners: [] });
```
Run under `@vitest-environment jsdom` + `@vue/test-utils` `mount(DevHost, {props: {config}})`, exactly as `DevHost.restart.test.ts`/`DevHost.seats.test.ts` already do. New test simulates `{type:'debugToggle'}` / the uiSwitch message and asserts `toggleDebug()`/`onUiSelect()`'s resulting `postToGame` call (spy on `iframeRef.contentWindow.postMessage` or assert on the emitted message).

---

### `src/cli/dev-host/<name>.integration.test.ts` (NEW) — real-WS integration test (test)

**Analog:** `src/cli/commands/dev.ts` lines 516-583 — the exact production wiring to replicate minus the Vite `httpServer` attachment
```typescript
// dev.ts's real pattern (adapt: use new WebSocketServer({ port: 0 }) standalone
// instead of { noServer: true } + vite.httpServer.on('upgrade', ...))
const clients = new Map<string, WebSocket>();
const mpHost = new MultiplayerHost({
  playerCount: effectivePlayerCount,
  minPlayers,
  executeOp: (gameOptions, snapshot, pendingState, op) => runExecuteOp(gameDef, gameOptions, snapshot, pendingState, op),
  send: (clientId, message) => {
    const sock = clients.get(clientId);
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(message));
  },
});
const wss = new WebSocketServer({ port: 0 }); // standalone — no Vite httpServer needed in a test
wss.on('connection', (socket) => {
  let clientId: string | null = null;
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'hello') {
      clientId = typeof msg.clientId === 'string' ? msg.clientId : `anon-${Math.random().toString(36).slice(2)}`;
      clients.set(clientId, socket);
      mpHost.handleMessage(clientId, { type: 'hello' });
      return;
    }
    if (!clientId) return;
    mpHost.handleMessage(clientId, msg);
  });
  socket.on('close', () => { if (clientId) { clients.delete(clientId); mpHost.disconnect(clientId); } });
});
```
The test's driving client speaks the SAME `hello`/`join`/`server_request`/`getState`/`getLobby` protocol directly via `globalThis.WebSocket` (or a small dedicated helper) — it is NOT `GameConnection` (protocol mismatch, see Shared Patterns below). Test flow: connect → `hello` → `join` seat → `getState` → assert `game_state` echo with `requestId` → perform an action via `server_request` → `debugToggle`/`uiSwitch` → assert broadcast received.

## Shared Patterns

### `requestId` echo convention
**Source:** `src/cli/dev-host/multiplayer-host.ts` lines 112-119 (`requestOrigin` map doc comment), 330-333 (`server_request` usage)
**Apply to:** `getState`/`getLobby` handlers — but NOTE: unlike `server_request` (which needs the `requestOrigin` map because a follower may act as a seat it doesn't occupy, requiring response routing back to the original asker), `getState`/`getLobby` respond synchronously to the SAME client that asked. Do not build a `requestOrigin`-map for these — just echo `msg.requestId` directly in the reply, in the same handler, as research Pitfall 6 explicitly calls out.

### Broadcast-to-all-connected fan-out
**Source:** `src/cli/dev-host/multiplayer-host.ts` lines 574-577 (`broadcastLobby`)
**Apply to:** `debugToggle`/`uiSwitch` handlers (no single canonical target client exists for these ops — see Pitfall 4 in RESEARCH.md)
```typescript
for (const clientId of this.connected) this.send(clientId, message);
```

### Host→page relay, no bridge.ts involvement
**Source:** `src/cli/dev-host/multiplayer-host.ts` `handleFollow` (lines 240-272) + `DevHost.vue` `case 'follow':` (lines 177-179)
**Apply to:** `debugToggle`/`uiSwitch` — the ONLY existing precedent in the codebase for "WS message in → page reacts locally with zero SnapshotSessionHost/bridge.ts involvement." Do not route these through `bridge.ts`'s `WireOp`/`translateOp` — that machinery is exclusively for game-state-mutating ops.

### Seat resolution — never trust client-supplied seat
**Source:** `src/cli/dev-host/multiplayer-host.ts` `handleServerRequest` (lines 322-324)
```typescript
const seat =
  clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
```
**Apply to:** `getState` — resolve seat ONLY from server-tracked state, never from a client-supplied `seat` field on the inbound message (prevents cross-seat hidden-info leaks; V4 Access Control per RESEARCH.md's security section).

### Fail-loud actionable errors for missing runtime capability
**Source:** CLAUDE.md project rule ("Error messages should be actionable") + RESEARCH.md Pitfall 2
**Apply to:** `GameConnection` constructor when `globalThis.WebSocket` is undefined and no `wsImplementation` override was supplied — throw a clear, actionable message naming the Node version requirement and the override escape hatch, never let it fall through to a bare `ReferenceError`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/client/game-connection.test.ts` (NEW) | test | request-response | No existing `GameConnection`-specific test file in `src/client/` to pattern-match against; planner should follow the general vitest conventions used in `multiplayer-host.test.ts` (plain `describe`/`it`/`expect`, no special mocking library) plus a minimal fake `WebSocket` class assigned via constructor injection (`wsImplementation`) rather than `vi.stubGlobal` (unlike the jsdom-environment `DevHost.restart.test.ts`, this file runs in the default Node vitest environment where `global.WebSocket` may not exist at all until Node ≥22.4) |
| dev-host protocol client helper (`createDevHostClient`, NEW) | service | request-response | No existing standalone class speaks the dev-host's `hello`/`join`/`server_request` protocol outside of `DevHost.vue`'s inline reactive-state functions; the closest analog is DevHost.vue's own `ws`/`wsSend`/`connect()` block (lines 105-137), which must be adapted from Vue-reactive-ref style to a plain class/closure with promise-based request/response correlation (borrow the `pendingActions` Map + timeout pattern from `GameConnection.action()`, lines 41-48, 117-153 — same correlation idea, different wire protocol) |

## Metadata

**Analog search scope:** `src/cli/dev-host/` (multiplayer-host.ts, multiplayer-host.test.ts, DevHost.vue, DevHost.restart.test.ts, bridge.ts, dev.ts wiring), `src/client/` (game-connection.ts, types.ts, index.ts), `src/types/protocol.ts`
**Files scanned:** 9 read directly (full or targeted ranges) + grep sweeps across the same set
**Pattern extraction date:** 2026-07-02
