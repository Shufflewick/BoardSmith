# Phase 136: Client SDK & Protocol - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 8 (5 modified source files + 3 test files, 1 new)
**Analogs found:** 8 / 8 (all in-repo, same repo self-analogs — this is an internal-consistency phase, not new-territory)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/client/game-connection.ts` | service (WebSocket connection manager) | streaming + request-response | `src/client/dev-host-client.ts` | exact (same repo, same problem — awaitable-open + throw-on-not-open) |
| `src/client/client.ts` | service (HTTP + WS client facade) | request-response (CRUD-ish over HTTP) | `src/client/client.ts` itself — the 6 already-throwing methods (`getGameState`, `performAction`, `getHistory`, `restartGame`, `getLobby`, `updateLobbyName`) are the analog for the 12 methods being migrated | exact (self-analog, same file, same class) |
| `src/client/types.ts` | model/types (re-export + config shapes) | transform (re-export/narrowing) | `src/client/types.ts:326-327` existing `LobbyState/SlotStatus/LobbySlot/LobbyInfo` re-export block | exact (explicit precedent for the SDK-04 pattern) |
| `src/client/vue.ts` | provider/hook (Vue composable) | event-driven (reactive state sync) | `src/client/vue.ts` itself (`useGame`'s `setupConnection`) — will consume the new `opened` promise instead of the `setTimeout` hack | exact (self-modify) |
| `src/types/protocol.ts` | model (canonical discriminated-union protocol types) | transform | `src/types/protocol.ts:394-414` (`UpdatePlayerOptionsMessage`/`UpdateGameOptionsMessage` — the two already-unioned siblings) | exact (this is a copy-the-sibling-pattern addition) |
| `src/client/client.test.ts` (new) | test | request-response | `src/client/game-connection.test.ts` (mock-transport pattern) + `src/client/dev-host-client.ts` (no test file exists — protocol reference only) | role-match (adapt WS mock pattern to fetch-mock) |
| `src/client/vue.test.ts` (new) | test | event-driven | none in-repo for `vue.ts` composables directly; `src/client/game-connection.test.ts` is the closest structural analog (Vitest + fake transport) | partial (no Vue composable test precedent in `src/client/`; must establish new convention) |
| `src/client/game-connection.test.ts` (extended) | test | streaming + request-response | itself (extend `FakeWebSocket`-based existing file) | exact |

## Pattern Assignments

### `src/client/game-connection.ts` (service, streaming + request-response) — SDK-01, SDK-02

**Analog:** `src/client/dev-host-client.ts` (explicitly named in CONTEXT.md/RESEARCH.md as "the house pattern to mirror, do not import/extend")

**Opened-promise construction pattern** (`dev-host-client.ts:112-135`):
```typescript
const opened = new Promise<void>((resolve, reject) => {
  socket.addEventListener('open', () => resolve(), { once: true });
  socket.addEventListener('error', () => {
    if (socket.readyState !== wsCtor.OPEN) {
      reject(new Error(`... WebSocket connection to '${url}' failed before opening.`));
    }
  }, { once: true });
  socket.addEventListener('close', () => {
    reject(new Error(`... connection to '${url}' closed before opening.`));
  }, { once: true });
});
// Prevent an unhandled-rejection crash for callers who rely on send()'s
// synchronous not-open guard instead of awaiting/catching `opened` directly.
opened.catch(() => {});
```
Note: `GameConnection` uses `this.ws.onopen =` assignment style (not `addEventListener`), see `game-connection.ts:241-267` (`setupWebSocketHandlers`) — adapt the promise construction to that assignment style rather than switching the whole file to `addEventListener`, to stay consistent with the file's existing idiom.

**Divergence required (per CONTEXT.md locked decision + RESEARCH.md Pattern 1 note):** `GameConnection.action()` must **await** `opened` (bounded by timeout) rather than throw synchronously like `dev-host-client.ts`'s `send()` (`dev-host-client.ts:171-179`):
```typescript
function send(message: Record<string, unknown>): void {
  if (socket.readyState !== wsCtor.OPEN) {
    throw new Error(
      `createDevHostClient: cannot send '${String(message.type)}' — socket is not open ` +
        `(readyState=${socket.readyState}). Await \`client.opened\` before sending.`,
    );
  }
  socket.send(JSON.stringify(message));
}
```
Reuse the promise-construction half verbatim-in-spirit; adapt the send-guard half to `action()`'s await-then-send/reject-on-timeout requirement.

**Current fire-and-forget target for replacement** (`game-connection.ts:128-131`):
```typescript
async action(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!this.ws || this.ws.readyState !== this.#wsCtor.OPEN) {
    return { success: false, error: 'Not connected' };
  }
  ...
```

**Current `disconnect()`/`connect()`/`reconnect()` asymmetry to fix (SDK-02)** (`game-connection.ts:99-110`):
```typescript
disconnect(): void {
  this.config.autoReconnect = false; // Prevent auto-reconnect
  this.cleanup();
  this.setStatus('disconnected');
}

reconnect(): void {
  this.config.autoReconnect = true;
  this.reconnectAttempts = 0;
  this.cleanup();
  this.connect();
}
```
Target: private `#userDisconnected` flag, `connect()` clears it; `disconnect()` sets it; `scheduleReconnect()` (`game-connection.ts:337-338`, `if (!this.config.autoReconnect) return;`) gains an additional `if (this.#userDisconnected) return;` guard (or replaces the `autoReconnect`-mutation check entirely — planner's call per Pitfall 1).

**`connectImmediately` threading (SDK-02):** `GameConnectionConfig` (`types.ts:167-196`) needs a new optional field; both construction sites must respect it:
- `client.ts:171-186` (`MeepleClient.connect()` — currently unconditional `connection.connect()`)
- `vue.ts:112-117` (`setupConnection`'s `client.connect(id, {...})` call)

---

### `src/client/client.ts` (service, request-response) — SDK-01, SDK-03, SDK-06

**Analog:** the file's own 6 already-throwing methods are the exact target shape for the 12 migrating methods.

**Throwing pattern to replicate across all 18 methods** (`client.ts:227-246`, `getGameState`):
```typescript
async getGameState(gameId: string, playerSeat?: number): Promise<{ flowState: FlowState; state: PlayerState }> {
  const url = playerSeat !== undefined
    ? `/games/${gameId}?player=${playerSeat}`
    : `/games/${gameId}`;

  const response = await this.fetch(url);
  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Failed to get game state');
  }

  return { flowState: data.flowState, state: data.state };
}
```

**Raw-JSON pattern to migrate (12 instances, e.g. `createGame` `client.ts:215-222`, `claimSeat` `client.ts:336-347`):**
```typescript
async createGame(options: CreateGameRequest): Promise<CreateGameResponse> {
  const response = await this.fetch('/games', {
    method: 'POST',
    body: JSON.stringify(options),
  });

  return await response.json();   // <-- no success/errorCode check, no response.ok check
}
```
Per Pitfall 3/5 (RESEARCH.md): route ALL 18 methods through one shared private helper (e.g. `parseResponse<T>(response: Response): Promise<T>`) that (a) checks `response.ok` before `.json()` to avoid `SyntaxError` on non-JSON error bodies (Pitfall 5), and (b) throws with `errorCode` attached (optional field, per Assumption A1 — lobby-manager.ts doesn't populate it yet) on `!data.success`. This unifies the 6 existing ad-hoc `throw new Error(data.error || '...')` call sites AND the 12 raw-return call sites into one code path — do not leave the original 6 with their own inline throw expressions once the shared helper exists.

**`connect()` fire-and-forget to fix (SDK-01)** (`client.ts:171-186`):
```typescript
connect(gameId: string, options?: Partial<GameConnectionConfig>): GameConnection {
  const connectionConfig: GameConnectionConfig = { /* ... */ };
  const connection = new GameConnection(this.config.baseUrl, connectionConfig);
  connection.connect();
  return connection;
}
```
Target: expose the awaitable open (per CONTEXT.md discretion — either `connection.opened` directly usable by callers, or a `connect()` variant returning a promise; GameConnection itself owns `opened`).

**`playerId` config + error message (SDK-06)** (`client.ts:27-38` constructor, `:585-589` error):
```typescript
constructor(config: MeepleClientConfig) {
  this.config = { baseUrl: ..., autoReconnect: ..., ... };
  this.playerId = this.generatePlayerId();   // always calls generatePlayerId — target: skip if config.playerId provided
}
...
throw new Error(
  'No cryptographically secure RNG available to mint a playerId. ' +
    'Provide an explicit playerId in MeepleClientConfig, or run in an environment ' +
    'with the Web Crypto API (modern browser or Node 16+).'   // <-- MeepleClientConfig has no playerId field today; also "Node 16+" is factually wrong (should be Node 19+)
);
```

**Private `fetch()` helper to extend for `response.ok` check** (`client.ts:550-570`):
```typescript
private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout);
  try {
    const response = await fetch(url, { ...options, headers: {...}, signal: controller.signal });
    return response;   // <-- returns raw Response; .ok is never checked here or by any caller
  } finally {
    clearTimeout(timeout);
  }
}
```

---

### `src/client/types.ts` (model/types) — SDK-04, SDK-06

**Analog:** the file's own existing re-export precedent for Lobby types.

**Re-export pattern to replicate** (`types.ts:322-327`):
```typescript
// ============================================
// Lobby Types
// ============================================

// Re-export lobby types from canonical source
export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };
```
(Import already at top of file: `import type { LobbyState, SlotStatus, LobbySlot, LobbyInfo } from '../types/protocol.js';` — `types.ts:5`.)

**Types to delete and re-export instead (SDK-04):** `CreateGameRequest` (`types.ts:288-310`, confirmed drifted — missing `playerIds` vs. canonical `protocol.ts:212-230`), `ClaimSeatRequest` (`types.ts:330-334`, canonical at `protocol.ts:246-253`), `JoinLobbyResponse`/`ClaimSeatResponse`/`LobbyResponse` and the various `*Request` interfaces (`types.ts:336-394`) — each has a canonical counterpart in `protocol.ts` to re-export from instead (`ClaimSeatResponse` at `protocol.ts:258-265`, `JoinLobbyResponse` at `protocol.ts:280-287`; some — `SetReadyRequest`, `AddSlotRequest`, `RemoveSlotRequest`, `SetSlotAIRequest`, `UpdateGameOptionsRequest`, `UpdatePlayerOptionsRequest` — may need a canonical protocol.ts twin added if one doesn't already exist for that exact shape; check before assuming 1:1 mapping).

**CRITICAL — barrel export chain (Pitfall 6):** `src/client/index.ts:80-83` re-exports `CreateGameRequest, CreateGameResponse, ApiResponse` FROM `./types.js`. Every type deleted from `client/types.ts` needs a `export type { X } from '../types/protocol.js';` replacement line in `types.ts` itself — deleting without re-exporting breaks `index.ts`'s public surface with TS2305.

**`WebSocketOutgoingMessage`/`WebSocketIncomingMessage` narrowing target** (current all-optional bags, `types.ts:237-276`):
```typescript
export interface WebSocketOutgoingMessage {
  type: 'action' | 'ping' | 'getState';
  action?: string;
  args?: Record<string, unknown>;
  requestId?: string;
}
```
Target per SDK-04 + Pitfall 7: `Extract<WebSocketMessage, {type: 'action'|'ping'|'getState'}>` (or equivalent) narrowing the canonical `protocol.ts` `WebSocketMessage` union — NOT the full lobby-mutation set, since `game-connection.ts` only ever constructs `action`/`ping`/`getState` outgoing messages (confirmed at `game-connection.ts:140-145,169,383`).

**`MeepleClientConfig.playerId` addition (SDK-06)** (`types.ts:12-27`):
```typescript
export interface MeepleClientConfig {
  baseUrl: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  requestTimeout?: number;
  // ADD: playerId?: string;
}
```

**`GameConnectionConfig.connectImmediately` addition (SDK-02)** (`types.ts:167-196`, add alongside existing `wsImplementation` optional field at the bottom of the interface).

---

### `src/client/vue.ts` (provider/hook) — SDK-01, SDK-02

**Analog:** self — `useGame`'s `setupConnection` is both the anti-pattern source and the file to fix.

**`setTimeout(100)` hack to delete (SDK-01)** (`vue.ts:112-122`):
```typescript
connection = client.connect(id, {
  playerSeat: getPlayerSeat(),
  spectator,
  autoReconnect: true,
});

// Mark setup complete after a short delay to allow connection to establish
setTimeout(() => {
  isSettingUp = false;
}, 100);
```
Target: use the new `opened` promise (via `connection.opened` or the exposed awaitable from `MeepleClient.connect()`) to resolve `isSettingUp = false` deterministically instead of a fixed 100ms guess.

**Open-and-kill anti-pattern to fix (SDK-02)** (`vue.ts:140-143`):
```typescript
// Auto-connect is handled by client.connect()
if (!autoConnect) {
  connection.disconnect();
}
```
Target: thread `connectImmediately: autoConnect` (or equivalent) into the `client.connect(id, {...})` call at `vue.ts:113-117` so a socket is never opened just to be immediately killed.

---

### `src/types/protocol.ts` (model, canonical union) — SDK-04, SDK-05

**Analog:** `UpdatePlayerOptionsMessage`/`UpdateGameOptionsMessage` — its own already-unioned siblings, exact same shape family.

**Sibling pattern already correct** (`protocol.ts:393-414`):
```typescript
/** The calling player updates their own per-player options. */
export interface UpdatePlayerOptionsMessage {
  type: 'updatePlayerOptions';
  playerOptions: Record<string, unknown>;
}

/** Host updates the per-player options of a specific slot. */
export interface UpdateSlotPlayerOptionsMessage {
  type: 'updateSlotPlayerOptions';
  seat: number;
  playerOptions: Record<string, unknown>;
}

/** Host updates the game-level options. */
export interface UpdateGameOptionsMessage {
  type: 'updateGameOptions';
  gameOptions: Record<string, unknown>;
}
```

**Union missing the member (SDK-05 fix location)** (`protocol.ts:420-435`):
```typescript
export type WebSocketMessage =
  | ActionMessage
  | PingMessage
  | GetStateMessage
  | GetLobbyMessage
  | ClaimSeatMessage
  | JoinLobbyMessage
  | UpdateNameMessage
  | SetReadyMessage
  | AddSlotMessage
  | RemoveSlotMessage
  | SetSlotAIMessage
  | LeaveSeatMessage
  | KickPlayerMessage
  | UpdatePlayerOptionsMessage
  | UpdateGameOptionsMessage;
  // ADD: | UpdateSlotPlayerOptionsMessage (insert next to its two siblings above)
```

**`CreateGameRequest` canonical shape (already correct, source of truth for SDK-04's re-export)** (`protocol.ts:212-230`):
```typescript
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
  gameOptions?: Record<string, unknown>;
  playerConfigs?: PlayerConfig[];
  useLobby?: boolean;
  creatorId?: string;
}
```

---

### `src/client/client.test.ts` (new file) — SDK-01, SDK-03, SDK-06

**Analog:** `src/client/game-connection.test.ts` for the mock-transport/Vitest structural pattern (describe/it, minimal fake), adapted from a WS mock to a `fetch` mock since `client.ts` is HTTP-primary.

**Structural pattern to mirror** (`game-connection.test.ts:1-31`, minimal fake + injected constructor):
```typescript
import { describe, it, expect } from 'vitest';
import { GameConnection } from './game-connection.js';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean; code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {}
  send(): void {}
  close(): void { this.readyState = FakeWebSocket.CLOSED; }
}
```
For `client.test.ts`, the equivalent fixture is a `vi.stubGlobal('fetch', ...)` or per-test `Response` mock returning both `{success: true/false, errorCode}` JSON bodies AND non-2xx non-JSON bodies (per Pitfall 5's acceptance test: `new Response('Bad Gateway', {status: 502})`). No existing in-repo fetch-mock fixture was found for `client.ts` — this is Wave 0 net-new test infrastructure per RESEARCH.md's Validation Architecture section (`client.test.ts` does not exist yet).

**Test-sweep target:** all 18 public `MeepleClient` methods need a `!success` throw test and a non-2xx throw test (RESEARCH.md's 18-method migration table is the authoritative checklist), plus SDK-01's `connect(); await conn.action(...)` immediately (loud reject or send-after-open) and SDK-06's `new MeepleClient({baseUrl, playerId})` skip-generation test.

---

### `src/client/vue.test.ts` (new file) — SDK-02

**Analog:** none in-repo for `vue.ts` composables directly (RESEARCH.md's Wave 0 Gaps confirms). Closest structural precedent is `game-connection.test.ts`'s Vitest + fake-transport pattern; will need `@vue/test-utils` or bare `effectScope`-based composable invocation (check `package.json`/existing Vue test files elsewhere in the repo, e.g. `src/ui/components/*.test.ts`, for the house Vue-composable-testing convention before inventing one — none was found under `src/client/` specifically).

**Test target:** `useGame({autoConnect:false})` must NOT open a real socket that gets immediately killed — assert `client.connect`/`GameConnection.connect` is not invoked (or `connectImmediately: false` is threaded through) when `autoConnect: false`.

---

### `src/client/game-connection.test.ts` (extend existing) — SDK-01, SDK-02

**Analog:** itself — extend the existing `FakeWebSocket` fixture (`game-connection.test.ts:9-30`) with `open`/`close` event triggering (currently the fake has `onopen`/`onclose` slots but no test exercises them) to drive the new `opened` promise through resolve/reject paths, plus the `#userDisconnected`/`connectImmediately` regression tests named in CONTEXT.md's Specifics section.

## Shared Patterns

### Awaitable connection lifecycle (the SDK-01 house pattern)
**Source:** `src/client/dev-host-client.ts:112-135` (promise construction) + `:171-179` (throw-on-not-open guard, adapted to await-then-send for `GameConnection`)
**Apply to:** `src/client/game-connection.ts` (`GameConnection.opened`, `action()`), `src/client/client.ts` (`MeepleClient.connect()` exposing the awaitable open), `src/client/vue.ts` (`useGame`'s `setupConnection` consuming it instead of `setTimeout(100)`)
```typescript
const opened = new Promise<void>((resolve, reject) => {
  socket.addEventListener('open', () => resolve(), { once: true });
  socket.addEventListener('error', () => { /* reject if not yet OPEN */ }, { once: true });
  socket.addEventListener('close', () => { /* reject with "closed before opening" */ }, { once: true });
});
opened.catch(() => {}); // prevent unhandled-rejection crash for non-awaiting callers
```

### One consistent throw contract (SDK-03)
**Source:** `src/client/client.ts:227-246` (`getGameState`, the existing correct shape)
**Apply to:** all 18 public `MeepleClient` HTTP methods, routed through one shared private parse/throw helper (Pitfall 3) that also checks `response.ok` before `.json()` (Pitfall 5)
```typescript
if (!data.success) {
  throw new Error(data.error || 'Failed to <verb>');   // extend: attach optional errorCode field
}
```

### Canonical-source re-export, never redefine (SDK-04)
**Source:** `src/client/types.ts:322-327` (`export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };`)
**Apply to:** every request/response type currently duplicated in `client/types.ts` that has (or gains) a canonical twin in `src/types/protocol.ts`; remember the `src/client/index.ts` barrel re-export chain (Pitfall 6) — deletions require matching re-export lines, not silent removal.

### Sibling-union-member addition (SDK-05)
**Source:** `src/types/protocol.ts:420-435`, `UpdatePlayerOptionsMessage`/`UpdateGameOptionsMessage`'s existing membership
**Apply to:** adding `UpdateSlotPlayerOptionsMessage` to the `WebSocketMessage` union — purely additive, zero runtime behavior change, matches the exhaustive-switch-pattern requirement already implied by the two siblings.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/client/vue.test.ts` | test | event-driven | No existing test file exercises `vue.ts`'s composables directly (`useGame`, `useMatchmaking`, `useGameWithMatchmaking`); nearest is `game-connection.test.ts`'s Vitest+fake-transport convention (structural only, not Vue-composable-specific). Check `src/ui/components/*.test.ts` for the repo's Vue-testing convention (Vue Test Utils vs. bare composable invocation) before writing — not covered in the files read for this pattern map. |
| Fetch-mock fixture for `client.test.ts` | test infra | request-response | No existing `fetch`-mock fixture exists under `src/client/`; `game-connection.test.ts`'s `FakeWebSocket` is a WS-specific analog only. Must construct a `vi.stubGlobal('fetch', ...)`-based fixture from scratch, including a non-JSON/non-2xx `Response` case for Pitfall 5's acceptance test. |

## Metadata

**Analog search scope:** `src/client/`, `src/types/protocol.ts`, `src/session/lobby-manager.ts` (grepped, not read in full), `src/ui/components/GameShell.vue` (grepped for consumer call sites)
**Files scanned:** `dev-host-client.ts` (276 lines, full read), `game-connection.ts` (490 lines, full read), `client.ts` (595 lines, full read), `types.ts` (394 lines, full read), `vue.ts` (487 lines, full read), `game-connection.test.ts` (87 lines, full read), `index.ts` (lines 1-90, targeted read), `protocol.ts` (lines 1-90 and 190-440, targeted reads)
**Pattern extraction date:** 2026-07-03
