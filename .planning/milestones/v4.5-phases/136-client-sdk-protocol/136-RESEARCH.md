# Phase 136: Client SDK & Protocol - Research

**Researched:** 2026-07-03
**Domain:** TypeScript client SDK (WebSocket connection lifecycle, HTTP lobby API, discriminated-union protocol types)
**Confidence:** HIGH

## Summary

Phase 136 fixes six audit-confirmed findings (F23, F24, F25, F26, F35, F38) in `src/client/` and `src/types/protocol.ts`. All six are independently re-verified against current source in this research pass — every file:line cited in CONTEXT.md checks out with only minor line-number drift (documented below). No finding is REJECTED.

The work has two genuinely separate root causes, matching the CONTEXT.md decision to fix them together in one phase because they touch the same disjoint files (not because they share a cause):

1. **Connection lifecycle races** (SDK-01, SDK-02, SDK-06) — `GameConnection`/`MeepleClient` have no awaitable "opened" signal, `disconnect()` mutates user config as its suppression mechanism, and a thrown error names a config field that doesn't exist. The fix pattern already exists in-repo: `src/client/dev-host-client.ts`'s `opened: Promise<void>` + throw-on-not-open `send()` is the house pattern to mirror (explicitly called out in its own file header as intentionally NOT shared with GameConnection — mirror the pattern, do not import/extend the class).
2. **Inconsistent/duplicated protocol surface** (SDK-03, SDK-04, SDK-05) — 12 of 18 `MeepleClient` HTTP methods return raw JSON instead of throwing, `src/client/types.ts` redefines request types that `src/types/protocol.ts` already owns (and the copies have drifted — `CreateGameRequest` lost `playerIds`), and `WebSocketMessage` is missing one of its three sibling lobby-mutation variants.

**Primary recommendation:** Fix the lifecycle races first (SDK-01/02/06 — pure `src/client/` internals, dev-host-client precedent to mirror), then the protocol/error-contract unification (SDK-03/04/05 — touches the public method surface and forces an in-repo consumer fixup in `GameShell.vue`). Both waves require doc updates in `docs/api/client.md` in the same phase (its quickstart currently demonstrates the exact SDK-01 and SDK-03 traps as "correct" usage).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebSocket connection lifecycle (open/close/reconnect) | Client SDK (`src/client/game-connection.ts`) | — | Sole owner; no server-side component to this phase |
| Awaitable "opened" signal | Client SDK (`GameConnection`, `MeepleClient.connect`) | — | Pure client-side promise wrapping existing `onopen`/`onerror` handlers |
| HTTP lobby error contract | Client SDK (`MeepleClient` fetch methods) | Session (`lobby-manager.ts` — NOT touched this phase) | Client decides throw-vs-return; server (`lobby-manager.ts`) decides whether `errorCode` is populated — the latter is out of phase scope (see Open Questions) |
| Canonical protocol types | `src/types/protocol.ts` | Client SDK (`src/client/types.ts` re-exports only) | protocol.ts's own header already declares itself the single source of truth |
| WS message union completeness | `src/types/protocol.ts` | Server/session consumers (external to this repo for the reference worker) | Additive union change; downstream WS-transport implementers benefit, HTTP-only current usage unaffected |
| Vue composable connection wiring (`useGame`) | Client SDK (`src/client/vue.ts`) | UI (`GameShell.vue` — consumer, in-repo fixup) | vue.ts owns the setTimeout hack and open-and-kill bug; GameShell.vue is a call site that must adapt to the new throwing contract |

## Standard Stack

No new dependencies. This phase is internal refactoring of existing TypeScript files using the existing `WebSocket` global / `resolveWsCtor` injection pattern already established for `dev-host-client.ts` (Node 22.4+ or injected `wsImplementation`).

### Package Legitimacy Audit

Not applicable — no external packages are added, removed, or upgraded by this phase. `[VERIFIED: package.json — no dependency changes required]`.

## Architecture Patterns

### System Architecture Diagram

```
Caller code
   │
   │ new MeepleClient(config)
   ▼
MeepleClient (client.ts)
   │
   ├─ HTTP methods (createGame, claimSeat, joinLobby, setReady, addSlot,
   │  removeSlot, setSlotAI, leavePosition, kickPlayer, updatePlayerOptions,
   │  updateSlotPlayerOptions, updateGameOptions, getGameState, performAction,
   │  getHistory, restartGame, getLobby, updateLobbyName)
   │      │
   │      ▼
   │  private fetch() ──► BoardSmith server (external, out of repo)
   │      │  (currently: no response.ok check; response.json() throws
   │      │   an unrelated parse error on non-2xx non-JSON bodies)
   │      ▼
   │  ONE contract after SDK-03: throw on !data.success OR non-2xx
   │
   └─ connect(gameId, opts) ──► new GameConnection(baseUrl, config)
                                     │
                                     │ .connect() — fire-and-forget today
                                     │ (SDK-01: needs `opened` promise)
                                     ▼
                                new WebSocket(wsUrl)
                                     │
                              onopen/onclose/onerror/onmessage
                                     │
                              ┌──────┴───────┐
                              ▼              ▼
                       state/lobby/error   actionResult
                       broadcasts          (request/response via
                       (state callbacks)    pendingActions Map,
                                             keyed by requestId)

vue.ts useGame(client, gameIdRef, opts)
   │  wraps GameConnection: setupConnection() creates connection,
   │  subscribes state/connection/error callbacks
   │  SDK-01: setTimeout(100) "allow connection to establish" hack
   │           papers over the missing `opened` signal — delete once
   │           GameConnection exposes it
   │  SDK-02: autoConnect:false calls connection.disconnect() right after
   │           creation — opens a real WS handshake then kills it
   │           (needs connectImmediately:false threaded into GameConnectionConfig
   │           instead)

GameShell.vue (in-repo consumer, fixed THIS phase — not deferred to Phase 138)
   │  calls client.createGame/joinLobby/updateSlotPlayerOptions today with
   │  defensive try/catch AND `if (result.success)` checks simultaneously
   │  (client.ts:1613, :1372, :1235-1240) — proof the current split contract
   │  is unworkable even for first-party code. Must migrate to try/catch-only
   │  once SDK-03 makes every method throw.
```

### Recommended Project Structure

No new files/folders — all changes are in-place edits to:
```
src/client/
├── game-connection.ts   # SDK-01 (opened promise, action-awaits-open), SDK-02 (#userDisconnected flag, connectImmediately)
├── client.ts             # SDK-01 (connect() exposes opened), SDK-03 (throw contract, non-2xx handling), SDK-06 (playerId config)
├── types.ts               # SDK-04 (delete duplicated types, re-export protocol.ts), SDK-06 (MeepleClientConfig.playerId)
├── vue.ts                 # SDK-01 (delete setTimeout hack), SDK-02 (connectImmediately wiring)
└── dev-host-client.ts     # READ-ONLY reference pattern — do not modify, do not extend/import into GameConnection

src/types/
└── protocol.ts             # SDK-04 (already canonical — client re-exports from here), SDK-05 (add UpdateSlotPlayerOptionsMessage to union)

src/ui/components/
└── GameShell.vue           # In-repo consumer fixup for SDK-03 (12 methods migrate from raw-JSON to throw)

docs/api/client.md          # Same-phase doc update (PROC decision) — quickstart currently teaches both traps
```

### Pattern 1: Awaitable connection lifecycle (mirror dev-host-client.ts)
**What:** Wrap the WebSocket's native `open`/`error`/`close` events in a `Promise<void>` created eagerly in the constructor (or at `connect()` time), stored as a readonly field, with a `.catch(() => {})` no-op handler attached immediately to prevent unhandled-rejection crashes for callers who rely on the synchronous not-open guard in `send()`/`action()` instead of awaiting `opened` directly.
**When to use:** Any place `GameConnection.action()` is called before the socket is confirmed open.
**Example (existing house pattern, `src/client/dev-host-client.ts:112-135`):**
```typescript
// Source: src/client/dev-host-client.ts:112-135 (in-repo, already shipped)
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
And the throw-on-not-open guard it pairs with (`dev-host-client.ts:171-179`):
```typescript
function send(message: Record<string, unknown>): void {
  if (socket.readyState !== wsCtor.OPEN) {
    throw new Error(
      `... cannot send '${String(message.type)}' — socket is not open ` +
        `(readyState=${socket.readyState}). Await \`client.opened\` before sending.`,
    );
  }
  socket.send(JSON.stringify(message));
}
```
**Divergence GameConnection needs vs. this pattern:** `GameConnection.action()` is documented (CONTEXT.md locked decision) to **await** the open (bounded by the connection timeout) rather than throw synchronously — dev-host-client's `send()` throws synchronously and expects the *caller* to await `opened` first. `GameConnection.action()`'s existing callers (including `vue.ts`) call it fire-and-forget-ish immediately after `connect()`, so the awaiting variant is the right choice for GameConnection specifically — it composes with the existing consumer surface without forcing every call site to add an explicit `await conn.opened` first. Reuse the promise-construction half of the pattern; adapt the send-guard half from throw-now to await-then-send/reject-on-timeout.

### Anti-Patterns to Avoid
- **Mutating `config.autoReconnect` as a suppression mechanism (current `disconnect()`):** invisible to the caller, breaks the `connect()`/`disconnect()` symmetry every dev expects. Use a private flag instead (`#userDisconnected`), cleared by `connect()`.
- **`setTimeout(100)` as a substitute for a real completion signal (current `vue.ts:120-122`):** a fixed-duration guess is either too short (race persists on slow networks) or wastes 100ms on fast ones. Delete once `opened` exists.
- **Resolving `{success: false}` for a client-side precondition failure (not-connected, spectator-cannot-act) instead of rejecting:** makes genuine failures indistinguishable from "you forgot to check `.success`" — CONTEXT.md's locked decision is explicit that these must reject loudly instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Awaitable WebSocket-open signal | A new promise-wrapping abstraction from scratch | Mirror `dev-host-client.ts`'s `opened` promise construction verbatim (event listener + `.catch(()=>{})` no-op pattern) | Already proven, already tested precedent in the same repo; CONTEXT.md explicitly names it "the exact promise mechanics to mirror" |
| Discriminated WS message types | A parallel narrowed union hand-authored in `client/types.ts` | `Extract<WebSocketMessage, {type: 'action'|'ping'|'getState'}>` (or equivalent) narrowing the canonical `protocol.ts` union | protocol.ts is the documented single source of truth; hand-authoring a second union is exactly the SDK-04 drift that already bit `CreateGameRequest` |
| Error classes for the throw contract | A bespoke exception hierarchy | Reuse `ErrorCode` enum already exported from `protocol.ts`/`session` (`import { ErrorCode } from 'boardsmith/session'`) — throw a plain `Error` (or minimal subclass) carrying `.errorCode` | `ErrorCode` is already the house convention (`GameSession.performAction` results carry it); inventing a second error taxonomy would fragment the one documented in protocol.ts's own JSDoc example (lines 27-40) |

**Key insight:** Every piece needed already exists in this repo under a different name (dev-host-client's promise pattern, protocol.ts's discriminated union, session's ErrorCode enum). This phase is unification, not invention — resist the urge to design something new.

## Common Pitfalls

### Pitfall 1: `disconnect()`/`connect()` "fix" that still isn't symmetric
**What goes wrong:** Adding `#userDisconnected` but forgetting `reconnect()` also needs to interact with it (or intentionally bypass it), leaves a second asymmetry.
**Why it happens:** `reconnect()` (game-connection.ts:105-110) currently does `config.autoReconnect = true; reconnectAttempts = 0; cleanup(); connect()` — a different reset sequence than plain `connect()`.
**How to avoid:** Decide explicitly whether `reconnect()` becomes a thin wrapper around `connect()` (now that `connect()` itself clears `#userDisconnected`) or stays a distinct method. CONTEXT.md's locked decision only mandates `connect()` clears the flag — audit `reconnect()`'s behavior for redundancy once that's true, and simplify if `reconnect()` no longer does anything `connect()` doesn't.
**Warning signs:** Two code paths that both "restore" auto-reconnect with slightly different side effects (one resets `reconnectAttempts`, one doesn't).

### Pitfall 2: `connectImmediately` addition breaks `MeepleClient.connect()`'s current unconditional `connection.connect()` call
**What goes wrong:** `client.ts:182-183` does `const connection = new GameConnection(...); connection.connect(); return connection;` unconditionally. If `GameConnectionConfig` gains `connectImmediately`, `MeepleClient.connect()` must respect it (currently it has no such option to pass through) or the option is dead for the primary `MeepleClient.connect()` path and only reachable via constructing `GameConnection` directly.
**Why it happens:** SDK-02's suggested fix targets `useGame({autoConnect:false})`'s open-and-kill specifically, but the option lives on `GameConnectionConfig`, which both `MeepleClient.connect()` and `vue.ts`'s `setupConnection()` construct.
**How to avoid:** Trace every `GameConnectionConfig` construction site (`client.ts:172-180`, `vue.ts:113-117`) and confirm `connectImmediately` is threaded through consistently, not just in vue.ts.
**Warning signs:** `MeepleClient.connect()` still always opens a socket even when a caller wants a connection object without immediately dialing.

### Pitfall 3: Migrating all 12 raw-JSON methods to throw, but leaving `getLobby`'s already-throwing behavior inconsistent with the new methods' error shape
**What goes wrong:** The 6 already-throwing methods (`getGameState`, `performAction`, `getHistory`, `restartGame`, `getLobby`, `updateLobbyName`) throw a plain `new Error(data.error || '...')` with NO `errorCode` attached. If the 12 newly-migrated methods attach `errorCode` but the original 6 don't, the "ONE consistent error contract" requirement (SDK-03) is only half satisfied.
**Why it happens:** Easy to treat "add throw to the 12 raw-JSON methods" as the whole task and forget the 6 pre-existing throwers need the same `errorCode`-carrying upgrade.
**How to avoid:** Design one shared private helper (e.g. `private async parseResponse<T>(response: Response): Promise<T>` or similar) that ALL 18 methods route through, so there is exactly one code path that decides throw-vs-return and exactly one place `errorCode` attachment happens.
**Warning signs:** grep for `data.error ||` across client.ts turns up multiple slightly different throw expressions instead of one shared helper.

### Pitfall 4: Assuming every server error response carries an `errorCode`
**What goes wrong:** `lobby-manager.ts` (session layer, NOT touched by this phase's file scope) currently returns `{success: false, error: '...'}` with NO `errorCode` field on any of its ~15 failure paths (verified: zero `errorCode` occurrences in `src/session/lobby-manager.ts`). If the client throw contract's error class *requires* `errorCode`, lobby failures will surface `errorCode: undefined` — technically satisfying "throw with the server's ErrorCode" only when the server happens to send one.
**Why it happens:** CONTEXT.md's SDK-03 decision says "throw with the server's ErrorCode on `!data.success`" — but the server-side ErrorCode population for lobby operations is a session-layer concern (`lobby-manager.ts`), out of this phase's file scope (`src/client/`, `src/types/protocol.ts`).
**How to avoid:** Make the error type's `errorCode` field optional (`errorCode?: ErrorCode`) and document that lobby-originated errors may not carry one yet — do NOT silently fabricate an ErrorCode client-side to paper over the gap (that would violate "fail loud, don't fake it"). Flag this explicitly as a known scope boundary, not a bug to fix in this phase (would require touching `src/session/lobby-manager.ts`, outside SDK phase's declared scope).
**Warning signs:** A test asserting `expect(err.errorCode).toBe(ErrorCode.SEAT_ALREADY_CLAIMED)` for a lobby method fails because the server-side lobby-manager never actually sets that field.

### Pitfall 5: `fetch()` private helper's missing `response.ok` check causes a confusing second failure mode
**What goes wrong:** `client.ts:550-570`'s private `fetch()` helper never checks `response.ok`. On a non-2xx response with a non-JSON body (e.g. a Cloudflare 502 HTML error page, or a 401 from an auth proxy in front of the worker), `response.json()` throws an unrelated `SyntaxError: Unexpected token '<'` instead of a meaningful error — exactly the failure mode CONTEXT.md's SDK-03 decision calls out ("no more unrelated JSON parse errors").
**Why it happens:** The current code assumes every HTTP response is a well-formed `{success, error}` JSON body; that's true for the app's own 200/4xx JSON responses but not for infrastructure-layer failures upstream of the app.
**How to avoid:** Check `response.ok` (or explicitly branch on status before parsing) in the shared parse helper from Pitfall 3, and throw a clear "HTTP {status}: {statusText}" error when the body isn't parseable JSON, rather than letting `.json()`'s parse error leak through unmodified.
**Warning signs:** A test that mocks a non-JSON error response (e.g. `new Response('Bad Gateway', {status: 502})`) still produces a `SyntaxError` instead of an actionable `Error`.

### Pitfall 6: Deleting `client/types.ts`'s duplicated request types breaks the barrel export surface silently
**What goes wrong:** `src/client/index.ts` re-exports `CreateGameRequest`, `ClaimSeatRequest`, etc. FROM `./types.js` (lines 56-83). If SDK-04 deletes these interfaces from `types.ts` without adding re-export lines (`export type { CreateGameRequest } from '../types/protocol.js';`) inside `types.ts` itself (matching the existing Lobby-types precedent at `types.ts:326-327`), the public `boardsmith/client` import surface breaks with a TS2305 "has no exported member" error at every consumer, including in-repo `GameShell.vue` and any external game.
**Why it happens:** Easy to delete the interface bodies and forget `types.ts` is itself a re-export layer for `index.ts`, two levels removed from `protocol.ts`.
**How to avoid:** For every type deleted from `client/types.ts`, add a `export type { X } from '../types/protocol.js';` line in the same file, mirroring the existing `export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };` line at `types.ts:327`. Verify `src/client/index.ts`'s export list still resolves (run `tsc --noEmit` or the existing typecheck script) before considering the task done.
**Warning signs:** `npm run typecheck` (or build) fails with "Module './types.js' has no exported member 'CreateGameRequest'" pointing at `index.ts`.

### Pitfall 7: `WebSocketOutgoingMessage`'s narrowed union must still admit `ping`/`getState` (no `requestId`, no `action`/`args`) alongside `action`
**What goes wrong:** If SDK-04's narrowing is done carelessly (e.g. `Extract<WebSocketMessage, {type: 'action'}>` only), `game-connection.ts`'s `requestState()` (sends `{type: 'getState'}`) and ping interval (sends `{type: 'ping'}`) break, since `GetStateMessage`/`PingMessage` aren't in the narrowed set.
**Why it happens:** The three client-sent-over-WS variants actually used today are `action`, `ping`, `getState` (confirmed via `game-connection.ts:140-145,169,383`) — NOT the full client-to-server set in `WebSocketMessage` (which also includes `claimSeat`, `joinLobby`, `setReady`, etc. — those all currently go over HTTP via `MeepleClient`'s fetch methods, per F35's verifier finding that "ALL lobby operations including updateSlotPlayerOptions go over HTTP POST").
**How to avoid:** Narrow to exactly `ActionMessage | PingMessage | GetStateMessage` (matching game-connection.ts's actual 3 outgoing message constructions), not the full lobby-mutation set — CONTEXT.md's Claude's Discretion section explicitly leaves the exact narrowing mechanism open but the *set* of variants is dictated by what `game-connection.ts` actually sends.

## Code Examples

### Current `MeepleClient.connect()` — fire-and-forget (SDK-01 target)
```typescript
// Source: src/client/client.ts:171-186 (current, pre-fix)
connect(gameId: string, options?: Partial<GameConnectionConfig>): GameConnection {
  const connectionConfig: GameConnectionConfig = { /* ... */ };
  const connection = new GameConnection(this.config.baseUrl, connectionConfig);
  connection.connect();   // <-- fires WS handshake, returns synchronously
  return connection;      // <-- caller has no way to know when it's open
}
```

### Current `GameConnection.action()` — resolves `{success:false}` instead of rejecting (SDK-01 target)
```typescript
// Source: src/client/game-connection.ts:128-131 (current, pre-fix)
async action(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
  if (!this.ws || this.ws.readyState !== this.#wsCtor.OPEN) {
    return { success: false, error: 'Not connected' };   // <-- silent, awaitable, looks like a normal failure
  }
  // ...
}
```

### Current `disconnect()`/`connect()` asymmetry (SDK-02 target)
```typescript
// Source: src/client/game-connection.ts:99-110 (current, pre-fix)
disconnect(): void {
  this.config.autoReconnect = false; // Prevent auto-reconnect — mutates USER config
  this.cleanup();
  this.setStatus('disconnected');
}
// connect() (line 81) never restores autoReconnect — only reconnect() does:
reconnect(): void {
  this.config.autoReconnect = true;
  this.reconnectAttempts = 0;
  this.cleanup();
  this.connect();
}
```

### Current split error contract — confirmed method-by-method (SDK-03 migration table)

| Method | File:line | Current behavior | Target behavior |
|--------|-----------|-------------------|------------------|
| `findMatch` | client.ts:48-77 | throws | throws (unchanged) |
| `getMatchStatus` | client.ts:82-104 | throws | throws (unchanged) |
| `leaveMatchmaking` | client.ts:109-120 | throws | throws (unchanged) |
| `getGameState` | client.ts:227-246 | throws | throws (unify via shared helper, add errorCode) |
| `performAction` | client.ts:251-272 | throws | throws (unify via shared helper, add errorCode) |
| `getHistory` | client.ts:277-292 | throws | throws (unify via shared helper, add errorCode) |
| `restartGame` | client.ts:298-313 | throws | throws (unify via shared helper, add errorCode) |
| `getLobby` | client.ts:322-331 | throws | throws (unify via shared helper, add errorCode) |
| `updateLobbyName` | client.ts:367-381 | throws | throws (unify via shared helper, add errorCode) |
| **`createGame`** | client.ts:215-222 | **raw JSON, no check** | **throw on `!success` / non-2xx** |
| **`claimSeat`** | client.ts:336-347 | **raw JSON, no check** | **throw** |
| **`joinLobby`** | client.ts:352-362 | **raw JSON, no check** | **throw** |
| **`setReady`** | client.ts:386-396 | **raw JSON, no check** | **throw** |
| **`addSlot`** | client.ts:401-410 | **raw JSON, no check** | **throw** |
| **`removeSlot`** | client.ts:415-425 | **raw JSON, no check** | **throw** |
| **`setSlotAI`** | client.ts:430-442 | **raw JSON, no check** | **throw** |
| **`leavePosition`** | client.ts:447-456 | **raw JSON, no check** | **throw** |
| **`kickPlayer`** | client.ts:461-471 | **raw JSON, no check** | **throw** |
| **`updatePlayerOptions`** | client.ts:476-486 | **raw JSON, no check** | **throw** |
| **`updateSlotPlayerOptions`** | client.ts:492-503 | **raw JSON, no check** | **throw** |
| **`updateGameOptions`** | client.ts:508-518 | **raw JSON, no check** | **throw** |
| `health` | client.ts:523-526 | raw JSON, no `.success` field in shape | leave as-is (not a `{success}` response — pure status probe) |

`[VERIFIED: src/client/client.ts, re-read in full during this research session — 18 public async methods enumerated, matches audit's count exactly]`

### `GameShell.vue`'s in-repo defensive double-handling — proof the split contract is already unworkable
```vue
<!-- Source: src/ui/components/GameShell.vue:1608-1620 (current) -->
async function handleUpdateSlotPlayerOptions(position: number, options: Record<string, unknown>) {
  if (!createdGameId.value) return;
  try {
    const result = await client.updateSlotPlayerOptions(createdGameId.value, position, options);
    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to update slot options');
    }
  } catch (err) {
    // try/catch here is currently DEAD CODE for this method (it never throws)
    // — but was clearly copy-pasted from a throwing method, proving the
    // inconsistency already confuses first-party maintainers.
    console.error('Failed to update slot player options:', err);
    toast.error('Failed to update slot options');
  }
}
```
This exact pattern repeats at `GameShell.vue:1235` (createGame), `:1372` (joinLobby auto-join), `:1437` (handleJoinLobby) — every raw-JSON method call site in GameShell.vue independently re-invents a `.success` check inside a `try/catch` it doesn't need (yet). **All of these must be simplified to try/catch-only once SDK-03 lands** — this is the in-repo consumer fixup the phase must include (not deferred to Phase 138, which is games/MERC only).

### `CreateGameRequest` drift — confirmed field-by-field (SDK-04)
```typescript
// src/types/protocol.ts:212-227 (canonical)
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];        // <-- PRESENT in canonical
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
  gameOptions?: Record<string, unknown>;
  playerConfigs?: PlayerConfig[];
  useLobby?: boolean;
  creatorId?: string;
}

// src/client/types.ts:288-310 (drifted duplicate)
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  // playerIds MISSING — confirmed absent
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
  gameOptions?: Record<string, unknown>;
  playerConfigs?: Array<{ name?: string; isAI?: boolean; aiLevel?: string; [key: string]: unknown }>; // also a looser inline shape vs. protocol.ts's named PlayerConfig
  useLobby?: boolean;
  creatorId?: string;
}
```
`[VERIFIED: field-by-field diff performed against both files in this research session]`. `playerIds` is consumed by `game-session.ts:2285` per the audit's verifier note (seat-identity security mechanism) — this is not a cosmetic field.

### `WebSocketMessage` union — confirmed missing member (SDK-05)
```typescript
// src/types/protocol.ts:401-406 — defined but orphaned
export interface UpdateSlotPlayerOptionsMessage {
  type: 'updateSlotPlayerOptions';
  seat: number;
  playerOptions: Record<string, unknown>;
}

// src/types/protocol.ts:420-435 — union, UpdateSlotPlayerOptionsMessage absent,
// its two siblings present:
export type WebSocketMessage =
  | ActionMessage | PingMessage | GetStateMessage | GetLobbyMessage
  | ClaimSeatMessage | JoinLobbyMessage | UpdateNameMessage | SetReadyMessage
  | AddSlotMessage | RemoveSlotMessage | SetSlotAIMessage | LeaveSeatMessage
  | KickPlayerMessage
  | UpdatePlayerOptionsMessage   // <-- sibling present
  | UpdateGameOptionsMessage;    // <-- sibling present
  // UpdateSlotPlayerOptionsMessage NOT listed
```
`[VERIFIED: read protocol.ts:390-435 in full during this research session]`. Confirmed no in-repo consumer dispatches on `WebSocketMessage` over the wire for this operation — `GameShell.vue:1613` calls the HTTP method `client.updateSlotPlayerOptions()`, and `game-connection.ts` only ever constructs `action`/`ping`/`getState` outgoing messages. The fix is purely a type-completeness correction (additive, zero runtime behavior change) — matches the audit verifier's `adjustedSeverity: low`.

### `MeepleClientConfig` missing `playerId` (SDK-06)
```typescript
// src/client/types.ts:12-27 (current) — no playerId field
export interface MeepleClientConfig {
  baseUrl: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  requestTimeout?: number;
}

// src/client/client.ts:585-589 — error message references a field that doesn't exist
throw new Error(
  'No cryptographically secure RNG available to mint a playerId. ' +
    'Provide an explicit playerId in MeepleClientConfig, or run in an environment ' +
    'with the Web Crypto API (modern browser or Node 16+).'
);
```
Note also: the error message's "Node 16+" claim is itself inaccurate — `globalThis.crypto` landed unflagged in Node 19, not 16 (per audit verifier finding, low priority but worth a same-phase wording fix since it's in the file already being touched).

## Runtime State Inventory

Not applicable — this phase changes source code and type definitions only (no rename/refactor of stored identifiers, no database/config-store migration). Confirmed: `playerId` values themselves are not being renamed or restructured; only the *config field name* to pass one explicitly is being added. `player Id` generation logic, storage in `sessionStorage`/`localStorage` (see `GameShell.vue`'s `setSessionPlayerId`), and wire format are unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The error class for the unified throw contract should carry an optional `errorCode?: ErrorCode` (not required) | Pitfall 4, Code Examples | If lobby-manager.ts is expected to always populate errorCode, tests asserting errorCode on lobby-originated errors will need lobby-manager.ts changes out of this phase's declared file scope — flagged as an Open Question, not silently assumed away |
| A2 | `GameConnection.action()`'s bounded wait for `opened` should reuse the existing per-action 10-second timeout (`game-connection.ts:150-153`), not a separate "connection timeout" config value | Pattern 1 divergence note | CONTEXT.md's Claude's Discretion section explicitly says "reuse the existing connection timeout config" — no such config currently exists (only the per-action 10s timeout and the reconnect-delay config exist); if the planner intends a NEW distinct connect-timeout config field, that's an additive config surface not yet decided |
| A3 | `reconnect()` can likely be simplified to delegate to `connect()` once `#userDisconnected` exists, but this research does not mandate that refactor — flagged as Pitfall 1, left to planner/implementer judgment | Pitfall 1 | If reconnect() and connect() diverge further instead of converging, the SDK-02 fix may leave a second latent asymmetry |

## Open Questions

1. **Does SDK-03's "throw with the server's ErrorCode" require session-layer changes to `lobby-manager.ts`?**
   - What we know: `lobby-manager.ts` (session layer, NOT in this phase's `src/client/` + `src/types/protocol.ts` scope) has zero `errorCode` occurrences across ~15 lobby failure paths — every lobby error is currently `{success: false, error: 'string only'}`.
   - What's unclear: Whether CONTEXT.md's phrase "the server's ErrorCode" was written assuming lobby-manager already populates one (it doesn't) or whether the planner should treat `errorCode` as best-effort/optional for lobby-originated errors in this phase, deferring lobby-manager's own errorCode population to a future phase.
   - Recommendation: Design the client-side error type with `errorCode?: ErrorCode` (optional), document in the phase SUMMARY that lobby methods may throw without an errorCode today, and treat populating `lobby-manager.ts`'s errorCode field as explicitly out of scope (file outside phase boundary) unless the user confirms otherwise during planning.

2. **Should `GameConnectionConfig` gain a distinct "connect timeout" (for the `opened` bound) separate from the existing per-action 10s timeout and the `reconnectDelay`?**
   - What we know: No connect-specific timeout config exists today; the only timeouts are the hardcoded 10s action-response timeout (`game-connection.ts:150`) and the hardcoded 10s pong timeout (`game-connection.ts:388`), both currently bare literals, not config fields.
   - What's unclear: CONTEXT.md's discretion note says "reuse the existing connection timeout config" as if one exists — it doesn't, under that name.
   - Recommendation: Planner should either (a) introduce a new `connectionTimeout` config field defaulting to a sane value (e.g. reuse the 10s literal as default), or (b) explicitly bound `action()`'s await-open behavior by the same 10s action-timeout literal, avoiding a new config surface. Both are reasonable; pick one and document the choice in the phase's decisions log.

## Environment Availability

Skipped — this phase has no external tool/service/runtime dependencies beyond the existing Node/TypeScript/Vitest toolchain already in use by the repo (confirmed via `package.json`: `vitest run` test runner, no new packages needed).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing repo standard) |
| Config file | `vitest.config.ts` (repo root, pre-existing) |
| Quick run command | `npx vitest run src/client/` |
| Full suite command | `npm run test` (baseline per CONTEXT.md: 172 files / 2285 tests green after Phase 135) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SDK-01 | `connect(); await conn.action(...)` immediately does not silently drop; rejects loudly on timeout/failure, resolves after open on success | unit | `npx vitest run src/client/game-connection.test.ts` | ✅ (extend existing file) |
| SDK-01 | `MeepleClient.connect()` exposes the awaitable open | unit | `npx vitest run src/client/client.test.ts` | ❌ Wave 0 (no `client.test.ts` exists yet — only `game-connection.test.ts` and `dev-host-client` tests exist under `src/client/`) |
| SDK-02 | `disconnect()` then `connect()` restores auto-reconnect (a subsequent unclean close triggers `scheduleReconnect`) | unit | `npx vitest run src/client/game-connection.test.ts` | ✅ (extend) |
| SDK-02 | `useGame({autoConnect:false})` does not open a real socket that gets immediately killed | unit | `npx vitest run src/client/vue.test.ts` | ❌ Wave 0 (no `vue.test.ts` exists — `vue.ts`'s composables are currently untested by dedicated unit tests; only exercised indirectly via `GameShell` component tests) |
| SDK-03 | Every public `MeepleClient` method throws with `error`/`errorCode` on `!success` and on non-2xx HTTP | unit | `npx vitest run src/client/client.test.ts` | ❌ Wave 0 (new file — 18-method sweep per CONTEXT.md's "Specific Ideas" test-sweep note) |
| SDK-04 | `client/types.ts` re-exports (not redefines) `CreateGameRequest`/`ClaimSeatRequest`/etc.; `playerIds` field reachable via `boardsmith/client` import | type-level (`tsc --noEmit` / compile-time) | `npx tsc --noEmit` (existing typecheck) | N/A — compile-time check, no runtime test file needed |
| SDK-05 | `UpdateSlotPlayerOptionsMessage` is a member of `WebSocketMessage` | type-level | `npx tsc --noEmit`, optionally a `satisfies`/exhaustive-switch compile test | N/A — compile-time; consider one runtime unit test in `src/types/protocol.test.ts` if that file exists |
| SDK-06 | `new MeepleClient({baseUrl, playerId})` skips `generatePlayerId()`; error message names a field that exists | unit | `npx vitest run src/client/client.test.ts` | ❌ Wave 0 (same new file as SDK-03) |

`[VERIFIED: find src/client -iname "*.test.ts" — only game-connection.test.ts (87 lines, DRIVE-02-focused, does not exercise action()/connect() lifecycle promises) currently exists under src/client/]`

### Sampling Rate
- **Per task commit:** `npx vitest run src/client/`
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/client/client.test.ts` — new file; covers SDK-01 (`connect()` awaitable), SDK-03 (18-method throw sweep incl. non-2xx), SDK-06 (playerId config)
- [ ] `src/client/vue.test.ts` — new file, OR extend GameShell's existing composable-level tests; covers SDK-02's `autoConnect:false` open-and-kill regression
- [ ] Mock `fetch`/`Response` fixture for non-2xx non-JSON body scenarios (Pitfall 5) — needed for SDK-03's "no more unrelated JSON parse errors" acceptance test
- [ ] `src/ui/components/GameShell.vue` consumer fixup is NOT itself a new test file, but existing GameShell tests (`GameShell.ia.test.ts` and any others) must be checked for assertions against the OLD raw-JSON `updateSlotPlayerOptions`/`createGame`/`joinLobby` return shapes — those will need updating alongside the source change

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Partial | `playerId` is the seat-identity capability token (per protocol.ts comments and `game-session.ts:2285`); SDK-04's `CreateGameRequest.playerIds` fix restores the client's ability to pass this security-relevant field. SDK-06's `MeepleClientConfig.playerId` addition is an identity-persistence convenience, not a new auth mechanism — no new attack surface (mirrors existing `setPlayerId()` capability, just reachable earlier) |
| V3 Session Management | No | No session/cookie handling in this phase's scope — playerId is a bearer-token-like opaque string generated client-side via `crypto.randomUUID()`, unchanged by this phase |
| V4 Access Control | No | Server-side seat/host authorization (`lobby-manager.ts`) is out of this phase's file scope; client-side changes don't alter who is authorized to do what, only how failures are reported |
| V5 Input Validation | No | This phase reshapes TypeScript type declarations and error-handling control flow; no new user-supplied input parsing is introduced |
| V6 Cryptography | No new work | `generatePlayerId()`'s existing `crypto.randomUUID()` / `crypto.getRandomValues()` fallback chain is unchanged by SDK-06 — only the error message and config surface change, not the RNG logic itself |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Silent action drop before connection open (SDK-01) could theoretically be exploited to make a UI appear to accept an action that never reached the server (e.g. a rage-quit/undo race) | Repudiation (a player could later claim "the app said it worked") | The `opened`-await fix directly closes this: the promise either resolves before send or the caller gets a loud rejection, eliminating the silent-success illusion |
| Duplicated/drifted type definitions (SDK-04) risk a security-relevant field (`playerIds`) silently failing to compile-error when omitted, encouraging devs to route around type safety | Tampering (weaker types make it easier to pass malformed/incomplete identity data without a compiler catching it) | Deleting the duplicate and re-exporting the canonical type restores TypeScript's excess-property/missing-property checks as a guardrail |

No new authentication, session, or crypto primitives are introduced by this phase — the security domain here is narrowly about *type-safety-as-a-guardrail* for an existing identity mechanism (`playerId`), not new controls.

## Project Constraints (from CLAUDE.md)

- **Pit of Success**: every fix in this phase must make the correct API the easy path (e.g., `opened` promise + throw-on-failure, not an opt-in escape hatch)
- **No Backward Compatibility**: the raw-JSON-returning 12 methods are a clean breaking change to throw — no deprecation shim, no dual-mode flag. `GameShell.vue`, in-repo, must be updated in the same phase, not left on the old contract
- **Prove Before Fix**: this research independently re-traced every file:line cited in CONTEXT.md against current source (all confirmed, zero REJECTED findings) — the planner should still re-verify per PROC-01 discipline before writing fixes, per the phase's own locked process decision
- **No new dependencies without discussion**: confirmed zero new packages needed for this phase
- **Never leave a dev server running**: N/A — this phase's verification is unit-test-driven (`npx vitest run`), no `boardsmith dev` browser session is required unless the planner adds a GameShell.vue browser-verification checkpoint (optional, given GameShell.vue is touched)
- **Error messages must be actionable**: SDK-06 is precisely a violation of this rule being fixed (error names a nonexistent field) — the fix's own new/adjusted error message must be verified actionable (name a field that actually exists, post-fix)

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

**Connection Lifecycle**
- **SDK-01 (F23)**: `GameConnection.opened` promise (mirroring the dev-host-client pattern). `action()` called before open awaits the open (bounded by the connection timeout) and then sends; genuine failures reject loudly — never resolve `{success:false}` silently. `MeepleClient.connect()` exposes the awaitable open. Delete the `setTimeout(100)` hack in `vue.ts`.
- **SDK-02 (F24)**: Suppression tracked in a private `#userDisconnected` flag instead of mutating `config.autoReconnect`; `connect()` clears the flag (disconnect→connect symmetry restored). Add an explicit `connectImmediately` option to `GameConnectionConfig` so `useGame({autoConnect:false})` no longer opens-and-kills a socket.
- **SDK-06 (F38)**: Add `playerId?: string` to `MeepleClientConfig` — constructor skips `generatePlayerId()` when provided; the no-Web-Crypto error message now points at a field that exists.

**Error Contract & Protocol Types**
- **SDK-03 (F25)**: One contract: all `MeepleClient` methods throw with the server's ErrorCode on `!data.success`, and also on non-2xx HTTP (no more unrelated JSON parse errors). createGame, claimSeat, joinLobby, setReady, addSlot, removeSlot, setSlotAI, leavePosition, kickPlayer, updatePlayerOptions, updateSlotPlayerOptions, updateGameOptions all migrate to the throwing contract.
- **SDK-04 (F26)**: Delete the duplicated request types from `src/client/types.ts`; re-export the canonical ones from `src/types/protocol.js` (as the file already does for Lobby types). Replace `WebSocketOutgoingMessage`/`WebSocketIncomingMessage` all-optional bags with the canonical discriminated `WebSocketMessage` union narrowed to client-sent variants and a discriminated incoming union keyed on `type`. Resolve the existing drift (client `CreateGameRequest` lost `playerIds`).
- **SDK-05 (F35)**: Add `UpdateSlotPlayerOptionsMessage` to the `WebSocketMessage` union in protocol.ts (its siblings UpdatePlayerOptionsMessage/UpdateGameOptionsMessage are already members; the advertised exhaustive-switch pattern requires it).

**Process (carried over from Phases 131-135 locked decisions)**
- PROC-01 verify-first: per-finding verdict in `136-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.

### Claude's Discretion
- Exact shape of the opened promise API (`connection.opened: Promise<void>` vs `connect(): Promise<GameConnection>` — pick the one that composes best with the existing consumer surface incl. vue.ts and dev-host-client precedent; both may exist if clean).
- Error class shape for the unified throwing contract (reuse existing SDK error types if any; include ErrorCode + server message).
- Timeout semantics for action()-awaits-open (reuse the existing connection timeout config).
- Whether the narrowed client-sent union lives in protocol.ts or client/types.ts (re-export from canonical source either way).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SDK-01 | Callers can await `GameConnection` becoming open; actions sent before open fail loudly rather than resolving `{success:false}` silently | Pattern 1 (dev-host-client precedent), Code Examples (current fire-and-forget `connect()` and silent-resolve `action()`), test map row SDK-01 |
| SDK-02 | `disconnect()` → `connect()` restores auto-reconnect predictably; asymmetry removed | Code Examples (current mutation), Pitfall 1 (reconnect() redundancy), Pitfall 2 (connectImmediately threading), test map row SDK-02 |
| SDK-03 | `MeepleClient` methods have ONE consistent error contract | Full 18-method migration table, Pitfall 3 (shared helper), Pitfall 4 (errorCode availability gap), Pitfall 5 (non-2xx handling), GameShell.vue consumer-fixup evidence |
| SDK-04 | Client SDK imports canonical protocol types instead of redefining; drift resolved | Field-by-field `CreateGameRequest` diff, Pitfall 6 (barrel re-export chain), Pitfall 7 (WS union narrowing correctness) |
| SDK-05 | `WebSocketMessage` union includes `UpdateSlotPlayerOptionsMessage` | Code Examples (union diff), confirmed zero in-repo WS-transport consumers of this variant (low blast radius) |
| SDK-06 | playerId error message points at a field that exists | Code Examples (current mismatched error text + missing config field), Project Constraints (actionable-errors rule) |
| PROC-01 | Verify-first: per-finding verdict before fix | This research independently re-traced every cited file:line; see Summary ("zero REJECTED") |
| PROC-02 | Red-then-green regression test per fix | Validation Architecture section maps every SDK-0X requirement to a specific test file/command |
</phase_requirements>

## Sources

### Primary (HIGH confidence — direct file reads during this research session)
- `src/client/game-connection.ts` (490 lines, read in full)
- `src/client/client.ts` (595 lines, read in full)
- `src/client/types.ts` (394 lines, read in full)
- `src/client/vue.ts` (486 lines, read in full)
- `src/client/dev-host-client.ts` (276 lines, read in full — reference pattern)
- `src/client/index.ts` (barrel exports, read in full)
- `src/client/game-connection.test.ts` (87 lines, existing test file, read in full)
- `src/types/protocol.ts` (relevant sections: header/ErrorCode enum lines 1-90, request/response types lines 190-300, WS message types lines 300-440, read directly)
- `src/session/lobby-manager.ts` (grepped for `errorCode`/`success: false` patterns — confirmed zero errorCode fields)
- `src/session/game-session.ts` (grepped for `errorCode` usage pattern, confirmed ErrorCode is the house convention)
- `src/ui/components/GameShell.vue` (grepped + read relevant call sites: lines 320-345, 1200-1260, 1360-1450, 1600-1625)
- `docs/api/client.md` (read lines 1-100 — confirmed quickstart teaches the SDK-01/SDK-03 traps as correct usage)
- `.planning/tmp/v4.5-audit-findings.json` (indices 22-25, 34, 37 — full verifier reasoning for F23, F24, F25, F26, F35, F38)
- `.planning/phases/136-client-sdk-protocol/136-CONTEXT.md` (locked decisions)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` (phase sequencing and traceability confirmation)

### Secondary (MEDIUM confidence)
None used — all findings were verifiable directly against in-repo source in this session; no external web research was needed for this phase (pure internal refactor of already-authored code, no third-party library research required).

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, pure internal refactor
- Architecture: HIGH — every pattern cited (dev-host-client's `opened` promise, protocol.ts's discriminated union, ErrorCode enum) is read directly from in-repo source, not inferred
- Pitfalls: HIGH — all 7 pitfalls derived from direct code tracing (barrel export chain, lobby-manager errorCode gap, GameShell.vue's defensive double-handling, WS union narrowing correctness) rather than general domain knowledge

**Research date:** 2026-07-03
**Valid until:** Stable until this phase's fixes land (internal-only research, no external API/library to go stale) — effectively valid for the duration of Phase 136's execution window.
