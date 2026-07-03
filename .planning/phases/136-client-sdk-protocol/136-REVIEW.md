---
phase: 136-client-sdk-protocol
reviewed: 2026-07-03T22:25:47Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - docs/api/client.md
  - src/client/client.test.ts
  - src/client/client.ts
  - src/client/game-connection.test.ts
  - src/client/game-connection.ts
  - src/client/index.ts
  - src/client/types.ts
  - src/client/vue.test.ts
  - src/client/vue.ts
  - src/types/protocol.ts
  - src/ui/components/GameShell.vue
findings:
  critical: 2
  warning: 7
  info: 8
  total: 17
status: issues_found
---

# Phase 136: Code Review Report

**Reviewed:** 2026-07-03T22:25:47Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The core SDK work is solid: the `opened` promise plumbing, `#userDisconnected` flag, and the single `parseResponse` chokepoint are well-tested (unhandled-rejection guard via the no-op `.catch()`, reconnect-timer cancellation via `cleanup() -> clearReconnectTimer()`, and the `#userDisconnected` vs `autoReconnect` interplay all check out). The GameShell lobby migration is complete — no remaining `.success` reads on any of the 21 now-throwing `MeepleClient` methods; the `result.success` reads at GameShell.vue:654/669 are raw `fetch`/`platformRequest` calls, not MeepleClient.

However, two blockers remain. The `opened` promise has a lifecycle hole: `disconnect()` or `reconnect()` while the socket is still CONNECTING strands the pending promise forever — the exact `await connection.opened` pattern the new docs teach can hang. And GameShell mints playerId capability tokens with `Math.random()` in two places, directly violating the security invariant that `client.ts` and `protocol.ts` were hardened to enforce in this same phase.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: GameShell mints playerId capability tokens with Math.random()

**File:** `src/ui/components/GameShell.vue:73` and `src/ui/components/GameShell.vue:1359`
**Issue:** `protocol.ts` (LobbySlot.playerId) documents playerId as "a per-seat capability — used as the identity proof on WebSocket connect and for host-only authorization checks," and `client.ts:generatePlayerId()` was hardened this phase with "it MUST be cryptographically unguessable — never Math.random()." GameShell violates this in both ID-minting sites:

```ts
// line 73 (getPlayerId, persistent identity)
id = Math.random().toString(36).substring(2) + Date.now().toString(36);
// line 1359 (same-browser joiner re-mint in joinGame)
const newPlayerId = Math.random().toString(36).substring(2) + Date.now().toString(36);
```

A `Math.random()`-derived token is guessable/predictable, enabling seat hijack and host-authorization bypass against any deployed worker. Worse, GameShell constructs `MeepleClient` (line 317) letting it mint a *secure* crypto ID, then immediately overwrites it with the insecure one via `client.setPlayerId(playerId.value)` (line 323).
**Fix:** Use the Web Crypto API in both sites (available in every browser GameShell can run in):
```ts
id = crypto.randomUUID();
// and
const newPlayerId = crypto.randomUUID();
```
Better (pit of success): pass the stored id into the constructor — `new MeepleClient({ baseUrl: props.apiUrl, playerId: getPlayerId() ?? undefined })` — and let `generatePlayerId()` be the only minting path, persisting `client.getPlayerId()` back to localStorage.

### CR-02: `opened` promise stranded forever by disconnect()/reconnect() while CONNECTING

**File:** `src/client/game-connection.ts:140-156, 522-544`
**Issue:** `cleanup()` rejects all `pendingActions` but never settles a pending `opened` promise. It also nulls `ws.onclose` *before* calling `ws.close()`, so the close event that would have fired `#rejectOpen()` is swallowed. Sequence:

1. `connect()` → socket CONNECTING, `opened` pending (`#openPending = true`).
2. `disconnect()` (or `reconnect()`, which also calls `cleanup()` first) → handlers nulled, socket closed. `#rejectOpen` is never invoked; `#openPending` stays `true`.
3. The `opened` promise never settles. Any caller following the documented pattern from `docs/api/client.md` (`await connection.opened;`) hangs forever.
4. A later `connect()` reassigns `this.opened` and overwrites `#openedResolve/#openedReject`, so the *old* promise's resolvers are lost permanently — old awaiters can never be released even by a successful reconnect.

This is reachable from shipped code: `vue.ts:setupConnection` calls `connection.disconnect()` on the previous connection on every gameId change; if that connection was mid-handshake, its `opened` (with the `.then/.catch` handlers attached at vue.ts:126-133) never settles, retaining those closures for the life of the app. An `action()` in flight inside `awaitOpen()` at that moment only escapes via the `connectionTimeout` race — with a "timed out" error instead of the truthful "connection was closed."
**Fix:** Reject the pending open during teardown:
```ts
private cleanup(): void {
  this.#rejectOpen(
    new Error('GameConnection: connection closed while the socket was still opening.')
  );
  this.clearReconnectTimer();
  // ... rest unchanged
}
```
(`#rejectOpen` is already a no-op when nothing is pending, so this is safe on every cleanup path; the no-op `.catch()` attached in `connect()` prevents unhandled rejections.)

## Warnings

### WR-01: connect() over a CLOSING socket lets stale handlers tear down the new connection

**File:** `src/client/game-connection.ts:102-138`
**Issue:** The re-entry guard only returns early for `OPEN`/`CONNECTING`. If the previous socket is `CLOSING` (server-initiated close in progress, handlers still attached because no cleanup ran), `connect()` overwrites `this.ws` with a fresh socket — but the old socket's `onclose` closure still fires when its close completes. That closure operates on `this`: it calls `#rejectOpen()` (rejecting the NEW `opened` promise), `cleanup()` (closing and nulling the NEW socket), and `scheduleReconnect()`. The fresh connection is destroyed by its predecessor's death rattle.
**Fix:** Detach the old socket before dialing:
```ts
connect(): void {
  if (this.ws && (this.ws.readyState === this.#wsCtor.OPEN || this.ws.readyState === this.#wsCtor.CONNECTING)) {
    return;
  }
  this.#userDisconnected = false;
  if (!this.config.connectImmediately) return;
  if (this.ws) this.cleanup(); // detach stale CLOSING/CLOSED socket handlers
  ...
}
```

### WR-02: joinGame lobby fall-through string-matches error prose the new error contract no longer guarantees

**File:** `src/ui/components/GameShell.vue:1403-1410`
**Issue:**
```ts
} catch (e) {
  // Only fall through if lobby doesn't exist
  if (e instanceof Error && !e.message.includes('lobby')) {
    throw e;
  }
}
```
Under the new `parseResponse` contract, `getLobby()` against a server without lobby support throws `HTTP 404: Not Found` — no lowercase `'lobby'` substring — so the legacy direct-join fall-through is dead code for the most common failure shape, and the user gets a raw `HTTP 404` toast instead of a direct join. The check is also case-sensitive (`'Lobby not found'` would NOT match) and inverted relative to its stale comment ("Re-throw other errors (like joinLobby failures)" — joinLobby errors are already caught at line 1385 and never reach here). `MeepleClientError.errorCode` was introduced this phase precisely to eliminate string matching, and this is the one call site that still depends on prose.
**Fix:** Branch on error type/status, not message text:
```ts
} catch (e) {
  const is404 = e instanceof Error && /HTTP 404/.test(e.message);
  const isClientErr = e instanceof MeepleClientError; // server answered: game/lobby state error
  if (!is404 && !isClientErr) throw e; // network/5xx: surface it
  // otherwise fall through to legacy direct join
}
```
(Or better: have the server populate `errorCode` for "no lobby" and switch on it.)

### WR-03: vue.ts stale `opened` handlers are not guarded by connection identity

**File:** `src/client/vue.ts:126-133`
**Issue:** `setupConnection` attaches `.then/.catch` to `connection.opened` but the handlers close over the shared `isSettingUp`/`error` without checking whether their connection is still the current one. If `setupConnection` runs again (gameId change) while the previous socket is mid-handshake and that old socket then settles (e.g. its `onerror` fired just before `disconnect()`), the old `.catch` clears `isSettingUp` while the NEW connection is still setting up, and writes a stale error into `error.value`. This re-opens the exact race the deleted `setTimeout(100)` hack was replaced to fix — the playerSeat watcher can now reconnect mid-setup.
**Fix:** Capture and compare:
```ts
const thisConnection = connection;
thisConnection.opened
  .then(() => { if (connection === thisConnection) isSettingUp = false; })
  .catch((err) => {
    if (connection !== thisConnection) return;
    isSettingUp = false;
    error.value = err instanceof Error ? err : new Error(String(err));
  });
```

### WR-04: playerSeat-watcher debounce timer survives unmount and stacks

**File:** `src/client/vue.ts:159-171`
**Issue:** The 50ms debounce `setTimeout` is never stored or cancelled. (a) If the component unmounts within the window, the callback still runs `setupConnection(gameIdRef.value)` *after* `onUnmounted` already disconnected — opening a brand-new WebSocket that nothing will ever disconnect (socket + memory leak). (b) Rapid consecutive seat changes queue multiple timers, each tearing down and re-dialing a connection ("debounce" is actually a delay, not a debounce).
**Fix:** Track the handle, clear it on re-trigger and in `onUnmounted`, and guard the callback with an `isUnmounted` flag set in `onUnmounted`.

### WR-05: docs/api/client.md teaches APIs that don't exist or silently misbehave

**File:** `docs/api/client.md:99, 132, 245`
**Issue:** Three examples drift from the real API surface added/canonicalized this phase:
- Line 245: `createGame({ ..., withLobby: true })` — the field is `useLobby` (`CreateGameRequest`, protocol.ts:227). Copy-pasting this example silently creates a lobby-less game (extra unknown fields are ignored).
- Line 132: `findMatch('go-fish', { playerCount: 4, playerId: 'user-123', ... })` — `FindMatchOptions` has no `playerId`; the client always sends `this.playerId`. The example implies per-call identity override that doesn't exist.
- Lines 99/107: `connect(gameId, { playerSeat: 0 })` — seats are 1-indexed; `buildWebSocketUrl` only appends the `player` param when `playerSeat >= 1`, so seat 0 is silently dropped and the comment `currentPlayer === 0` reinforces the off-by-one.
**Fix:** `withLobby` → `useLobby`; drop `playerId` from the findMatch example (note it's set via `MeepleClientConfig.playerId`); use `playerSeat: 1` and `currentPlayer === 1` in the connect examples.

### WR-06: action() during auto-reconnect backoff throws a misleading "Call connect() first" error

**File:** `src/client/game-connection.ts:179-183`
**Issue:** After an unclean close, `cleanup()` nulls `this.ws` and `scheduleReconnect()` arms a timer. An `action()` call in that backoff window hits the `!this.ws` guard and throws `"not connected. Call connect() first."` — wrong advice (auto-reconnect is already in progress; calling `connect()` is unnecessary and resets nothing) and inconsistent with the CONNECTING window, where `action()` patiently awaits `opened`. Error messages must be actionable (CLAUDE.md).
**Fix:** When `status === 'reconnecting'`, either await the next `opened` bounded by `connectionTimeout` (symmetric with the CONNECTING path), or throw an error that says reconnection is in progress and the action should be retried.

### WR-07: getMatchStatus double-prefixes baseUrl when it contains a path

**File:** `src/client/client.ts:98-103, 567-568`
**Issue:** `getMatchStatus` builds `new URL(\`${baseUrl}/matchmaking/status\`)` then passes `url.pathname + url.search` back into `this.fetch`, which prepends `baseUrl` again. For `baseUrl = 'https://host/api'` this produces `https://host/api/api/matchmaking/status`. Every other method passes a relative path, so this is the one inconsistent construction.
**Fix:**
```ts
const params = new URLSearchParams({ playerId: this.playerId });
const response = await this.fetch(`/matchmaking/status?${params}`);
```

## Info

### IN-01: MeepleClient.config.playerId goes stale after setPlayerId()

**File:** `src/client/client.ts:44-58, 534-536`
**Issue:** `Required<MeepleClientConfig>` stores `playerId`, but `setPlayerId()` only updates `this.playerId`. `this.config.playerId` is never read today, making it a drift trap for the next reader/feature.
**Fix:** Don't store `playerId` in `this.config` (type it `Required<Omit<MeepleClientConfig, 'playerId'>>`), or update both in `setPlayerId()`.

### IN-02: Barrel omits types the public surface needs

**File:** `src/client/index.ts:56-92`
**Issue:** `GameConnection.onLobbyChange` is documented in client.md, but `LobbyChangeCallback` is not exported from the barrel (its siblings `StateChangeCallback`/`ErrorCallback`/`ConnectionCallback` are). `JoinLobbyResponse` and `LobbyResponse` — return types of exported `MeepleClient` methods — are likewise missing, so consumers can't name them without deep imports.
**Fix:** Add `LobbyChangeCallback`, `JoinLobbyResponse`, `LobbyResponse` to the type re-exports (and to the docs export list).

### IN-03: health() has no response.ok check at all

**File:** `src/client/client.ts:515-518`
**Issue:** The parseResponse exemption is documented and reasonable, but `health()` also skips the `response.ok` check, so a 502 with an HTML body surfaces as a raw `SyntaxError: Unexpected token '<'` instead of an actionable HTTP error.
**Fix:** `if (!response.ok) throw new Error(\`HTTP ${response.status}: ...\`);` before `.json()`.

### IN-04: connectionTimeout is silently overloaded as the action-response timeout

**File:** `src/client/game-connection.ts:207-214`, `src/client/types.ts:231-236`
**Issue:** The `connectionTimeout` doc says it bounds "action()-awaits-open and the connection handshake," but `action()` also reuses it as the server-response deadline for the actionResult round-trip (line 211). A caller tuning connection dialing down to e.g. 2s unknowingly caps slow game actions too.
**Fix:** Document the third use in the `connectionTimeout` JSDoc, or split out an `actionTimeout` config.

### IN-05: UpdateSlotPlayerOptionsMessage has no in-repo consumer

**File:** `src/types/protocol.ts:474-480, 508`
**Issue:** The new union variant is dispatched by no in-repo server (lobby mutations travel over HTTP; `GameConnection` never sends it, per the `WebSocketOutgoingMessage` narrowing). It exists only for external workers — verify at least one deployed worker actually handles `type: 'updateSlotPlayerOptions'` before any client relies on the WS route.
**Fix:** Add a comment on the variant noting it is currently HTTP-only client-side, or wire a server dispatch case.

### IN-06: waitForMatch timeout path can mask its own timeout error

**File:** `src/client/client.ts:167-169`
**Issue:** On timeout, `await this.leaveMatchmaking()` runs before `throw new Error('Matchmaking timeout')`. If the leave call itself throws (network blip, 502), the caller sees that error instead of the timeout.
**Fix:** `await this.leaveMatchmaking().catch(() => {});` (best-effort cleanup) before throwing the timeout.

### IN-07: handleUpdateLobbyName swallows failures with no user feedback

**File:** `src/ui/components/GameShell.vue:1468-1470`
**Issue:** Every sibling lobby handler pairs `console.error` with a `toast.error`; this one only logs. A rejected rename (e.g. `NOT_AUTHORIZED`) leaves the user with a silently unchanged name.
**Fix:** Add `toast.error(err instanceof Error ? err.message : 'Failed to update name.');`.

### IN-08: isRef helper misdetects any object with a `value` key

**File:** `src/client/vue.ts:58-60`
**Issue:** `'value' in value` treats a plain `{ value: 3 }` as a Ref. Vue exports a real `isRef` that checks the internal ref marker.
**Fix:** `import { isRef } from 'vue';` and delete the local helper.

---

_Reviewed: 2026-07-03T22:25:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
