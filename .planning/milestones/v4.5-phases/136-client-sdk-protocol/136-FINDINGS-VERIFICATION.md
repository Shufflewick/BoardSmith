# Phase 136: Findings Verification (PROC-01 Gate)

**Purpose:** Independent re-verification of the six audit findings in scope for Phase 136
(F23/SDK-01, F24/SDK-02, F25/SDK-03, F26/SDK-04, F35/SDK-05, F38/SDK-06), each re-traced
against the current HEAD source (post-Phase-135) before any fix task in Plans 02-05 runs.
No fix code is written in this document — verdicts and evidence only.

**Verified against:** repo HEAD, 2026-07-03 (post-Phase-135, pre-Phase-136 execution).
Audit source: `.planning/tmp/v4.5-audit-findings.json` (indices 22, 23, 24, 25, 34, 37).

---

## F23 / SDK-01 — No awaitable "open" signal; `action()` silently resolves `{success:false}`

**Audit claim:** `GameConnection` exposes no way to await the socket becoming open;
`action()` called before open resolves `{success:false}` (looks like a normal failure,
not a precondition error); `MeepleClient.connect()` is fire-and-forget.

**Current HEAD trace:**
- `src/client/game-connection.ts:128-131` — `action()`:
  ```
  async action(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    if (!this.ws || this.ws.readyState !== this.#wsCtor.OPEN) {
      return { success: false, error: 'Not connected' };
    }
  ```
  Confirmed: returns a resolved, awaitable `{success:false}` — no rejection, no distinction
  from a genuine server-side action failure.
- `src/client/client.ts:171-186` — `connect()`:
  ```
  connect(gameId: string, options?: Partial<GameConnectionConfig>): GameConnection {
    ...
    const connection = new GameConnection(this.config.baseUrl, connectionConfig);
    connection.connect();
    return connection;
  }
  ```
  Confirmed: `connection.connect()` (line 183, a `void`-returning method per
  `game-connection.ts:81`) is fired and the connection object is returned synchronously —
  no promise, no way to know when (or if) the socket opened.
- `src/client/game-connection.ts` — grepped in full: no `opened` field, no promise wrapping
  `onopen`/`onerror`/`onclose` anywhere in the file. Confirmed absent.
- `src/client/vue.ts:119-122` — `setupConnection()`:
  ```
  setTimeout(() => {
    isSettingUp = false;
  }, 100);
  ```
  Confirmed: the 100ms fixed-duration guess described by the audit exists verbatim at this
  location, immediately after `client.connect(...)` (line 113).
- Reference pattern confirmed present and unmodified at `src/client/dev-host-client.ts:112-135`
  (`opened: Promise<void>` construction) and `:171-179` (throw-on-not-open `send()` guard) —
  this is the house pattern Plan 02 must mirror, not import/extend (file's own header forbids
  sharing with `GameConnection`).

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 02, recorded here so the boundary is explicit before any fix is
written):** `GameConnection` gains an `opened: Promise<void>` mirroring
`dev-host-client.ts`'s promise-construction mechanics (event-listener + `.catch(()=>{})`
no-op guard) — but diverges on the consumption side: `action()` must **await** `opened`
(bounded by a timeout) and then send, rather than throwing synchronously the way
`dev-host-client.ts`'s `send()` does. This divergence is intentional — `action()`'s existing
callers (including `vue.ts`) invoke it immediately after `connect()` without first awaiting
an open signal, so an awaiting variant composes with the existing consumer surface without
forcing every call site to add an explicit `await conn.opened` first. Genuine
precondition/timeout failures must reject loudly (throw), never resolve `{success:false}`
silently. `MeepleClient.connect()` must expose the awaitable open (exact API shape — bare
`.opened` property vs. an async `connect()` variant — is implementer discretion per
136-RESEARCH.md Assumptions Log A2/A3). The `setTimeout(100)` hack in `vue.ts:119-122` is
deleted once `opened` exists.

---

## F24 / SDK-02 — `disconnect()`/`connect()` asymmetry via mutated `config.autoReconnect`

**Audit claim:** `disconnect()` suppresses auto-reconnect by mutating `this.config.autoReconnect`
directly (a copy of user config); only the differently-named `reconnect()` — not the symmetric
`connect()` — restores it; `useGame({autoConnect:false})` opens a real socket then immediately
kills it because there is no `connectImmediately`-style option to prevent the open in the first
place.

**Current HEAD trace:**
- `src/client/game-connection.ts:99-103` — `disconnect()`:
  ```
  disconnect(): void {
    this.config.autoReconnect = false; // Prevent auto-reconnect
    this.cleanup();
    this.setStatus('disconnected');
  }
  ```
  Confirmed: suppression mechanism is a mutation of `this.config.autoReconnect` (the
  constructor-copied config object, `game-connection.ts:64-72`), not a dedicated flag.
- `src/client/game-connection.ts:81-97` — `connect()`: confirmed it never touches
  `autoReconnect` — no restoration path.
- `src/client/game-connection.ts:105-110` — `reconnect()`:
  ```
  reconnect(): void {
    this.config.autoReconnect = true;
    this.reconnectAttempts = 0;
    this.cleanup();
    this.connect();
  }
  ```
  Confirmed: only `reconnect()` restores `autoReconnect`, via a distinct 4-step sequence
  (set flag, reset attempt counter, cleanup, connect) that `connect()` alone does not perform
  — i.e. calling plain `disconnect()` then plain `connect()` (the naturally symmetric pair a
  developer would reach for) leaves `autoReconnect` permanently `false`.
- `src/client/game-connection.ts:337-338` — `scheduleReconnect()`'s guard
  (`if (!this.config.autoReconnect) return;`) confirms the mutated flag is load-bearing for
  the reconnect path, not dead config.
- `src/client/vue.ts:140-143` — `setupConnection()`:
  ```
  // Auto-connect is handled by client.connect()
  if (!autoConnect) {
    connection.disconnect();
  }
  ```
  Confirmed: when `autoConnect:false`, `client.connect(id, {...})` (line 113, which
  unconditionally calls `GameConnection.connect()` per the F23 trace above) has already
  opened a real WebSocket handshake by the time this branch runs `disconnect()` — open-then-
  kill, exactly as audited.
- `src/client/types.ts:167-196` — `GameConnectionConfig`: grepped in full, confirmed no
  `connectImmediately` (or equivalently-named) field exists today.

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 02):** Suppression tracked via a private `#userDisconnected`
flag instead of mutating `config.autoReconnect`; `connect()` clears the flag, restoring
`disconnect()`→`connect()` symmetry. Add an explicit `connectImmediately?: boolean` option to
`GameConnectionConfig` so `useGame({autoConnect:false})` never opens a socket it immediately
kills. **Pitfall 1 flag (redundancy audit):** once `connect()` itself clears
`#userDisconnected`, `reconnect()`'s 4-step sequence (`game-connection.ts:105-110`) may become
partially or fully redundant with a plain `connect()` call — Plan 02 must audit `reconnect()`
for simplification once the flag exists, rather than leaving two independently-evolving
"restore auto-reconnect" code paths. **Pitfall 2 flag (threading):** `connectImmediately` must
be threaded through every `GameConnectionConfig` construction site, not just `vue.ts`'s —
confirmed sites are `client.ts:172-180` (`MeepleClient.connect()`) and `vue.ts:113-117`
(`setupConnection()`); `MeepleClient.connect()`'s current unconditional
`connection.connect()` call (`client.ts:183`) must respect the new option or it stays dead for
that path.

---

## F38 / SDK-06 — Error message names a `MeepleClientConfig` field that does not exist

**Audit claim:** `generatePlayerId()`'s no-Web-Crypto-available error tells the developer to
"Provide an explicit playerId in MeepleClientConfig" but `MeepleClientConfig` has no `playerId`
field to provide it in.

**Current HEAD trace:**
- `src/client/client.ts:585-589`:
  ```
  throw new Error(
    'No cryptographically secure RNG available to mint a playerId. ' +
      'Provide an explicit playerId in MeepleClientConfig, or run in an environment ' +
      'with the Web Crypto API (modern browser or Node 16+).'
  );
  ```
  Confirmed verbatim at HEAD (line numbers match research's citation exactly).
- `src/client/types.ts:12-27` — `MeepleClientConfig`: grepped in full — fields are `baseUrl`,
  `autoReconnect`, `maxReconnectAttempts`, `reconnectDelay`, `requestTimeout`. Confirmed: no
  `playerId` field exists. The error message names a field a developer cannot actually set —
  a direct violation of CLAUDE.md's "error messages must be actionable" rule.
- `src/client/client.ts:36-38` — constructor unconditionally calls
  `this.playerId = this.generatePlayerId();` — confirmed no existing bypass path via config;
  `setPlayerId()` (line 542) exists but is a post-construction setter, not a construction-time
  option, so it cannot prevent the throw from firing in a no-Web-Crypto environment.
- **Secondary, same-file correctness note (low severity, folded into this fix since the file is
  already being touched):** the message's "Node 16+" claim is inaccurate —
  `globalThis.crypto`/`crypto.randomUUID` landed unflagged in Node 19, not Node 16. Confirmed
  against Node's own release notes; not independently re-verified via a live Node 16 install in
  this pass (out of scope for a source-code trace), but the wording is being corrected as part
  of the same-phase actionable-error fix regardless.

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 02):** Add `playerId?: string` to `MeepleClientConfig`;
constructor skips `generatePlayerId()` when a `playerId` is supplied in config; the
no-Web-Crypto error message is corrected to reference the real field and the accurate Node
version (19+, not 16+).

---

## F25 / SDK-03 — Split error contract: 12 of 18 `MeepleClient` methods return raw JSON

**Audit claim:** `MeepleClient` has two incompatible error-handling styles across its 18
public async HTTP methods — some throw on `!data.success`, others return the raw parsed JSON
body with no check at all — and the private `fetch()` helper never checks `response.ok`,
so a non-2xx non-JSON response (e.g. an infrastructure-layer 502) produces an unrelated
`SyntaxError` from `.json()` instead of an actionable error.

**Current HEAD trace — full 18-method sweep (re-confirmed method-by-method, matches
136-RESEARCH.md's migration table with only trivial line-number drift):**

| Method | file:line (HEAD) | Current behavior |
|---|---|---|
| `findMatch` | client.ts:48-77 (check :64) | throws (`!data.success`) |
| `getMatchStatus` | client.ts:82-104 (check :89) | throws |
| `leaveMatchmaking` | client.ts:109-120 (check :117) | throws |
| `getGameState` | client.ts:227-246 (check :238) | throws |
| `performAction` | client.ts:251-272 (check :264) | throws |
| `getHistory` | client.ts:277-292 (check :284) | throws |
| `restartGame` | client.ts:298-313 (check :305) | throws |
| `getLobby` | client.ts:322-331 (check :326) | throws |
| `updateLobbyName` | client.ts:367-381 (check :378) | throws |
| **`createGame`** | client.ts:215-222 | **`return await response.json();` — no check** |
| **`claimSeat`** | client.ts:336-347 | **raw JSON, no check** |
| **`joinLobby`** | client.ts:352-362 | **raw JSON, no check** |
| **`setReady`** | client.ts:386-396 | **raw JSON, no check** |
| **`addSlot`** | client.ts:401-410 | **raw JSON, no check** |
| **`removeSlot`** | client.ts:415-425 | **raw JSON, no check** |
| **`setSlotAI`** | client.ts:430-442 | **raw JSON, no check** |
| **`leavePosition`** | client.ts:447-456 | **raw JSON, no check** |
| **`kickPlayer`** | client.ts:461-471 | **raw JSON, no check** |
| **`updatePlayerOptions`** | client.ts:476-486 | **raw JSON, no check** |
| **`updateSlotPlayerOptions`** | client.ts:492-503 | **raw JSON, no check** |
| **`updateGameOptions`** | client.ts:508-518 | **raw JSON, no check** |
| `health` | client.ts:523-526 | raw JSON — not a `{success}`-shaped response, pure status probe, correctly left as-is |

Confirmed by direct read of `src/client/client.ts` in full (595 lines): exactly 9 methods
throw on `!data.success` (all with a plain `new Error(data.error || '...')`, NO `errorCode`
attached to any of them), exactly 12 methods return raw JSON with zero success/failure check
(`createGame` through `updateGameOptions` inclusive), and `health` is correctly exempt (not a
`{success}` response shape).

- `src/client/client.ts:550-570` — private `fetch()` helper: confirmed, reads the
  `Response` and returns it directly; no `response.ok` check anywhere in the function body.
  A non-2xx response with a non-JSON body would cause the *caller's* `response.json()` to
  throw an unrelated `SyntaxError`, not a meaningful error — confirmed reachable from every
  one of the 18 call sites above, all of which call `await response.json()` immediately after
  `this.fetch(...)`.
- `src/session/lobby-manager.ts` — grepped for `errorCode`: **0 occurrences** (confirmed via
  `grep -c`). Every lobby-manager failure path is `{success: false, error: '<string>'}` only,
  with no `errorCode` field populated anywhere in the file.
- `src/ui/components/GameShell.vue` — confirmed in-repo defensive double-handling exists at
  all four cited call sites:
  - `:1235` — `createGame()` inside `try { ... }`, checking `result.success` at a nearby line
  - `:1372` — `joinLobby()` (auto-join path)
  - `:1437` — `handleJoinLobby()`
  - `:1613` — `updateSlotPlayerOptions()`, with a `try/catch` wrapping a call that (per the
    migration table above) never currently throws — proving the split contract already
    confuses first-party maintainers into copy-pasting defensive code that is presently dead.

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 03), including the two scope-boundary corrections this gate
exists to record authoritatively:**

1. **One shared helper.** All 18 methods route through a single shared private parse/throw
   helper (e.g. a `parseResponse<T>(response: Response)`), so there is exactly one code path
   that decides throw-vs-return and exactly one place `errorCode` attachment happens. This
   closes Pitfall 3 (leaving the 9 pre-existing throwers on a different, `errorCode`-less
   error shape than the 12 newly-migrated raw-JSON methods).
2. **`response.ok` check.** The shared helper checks `response.ok` (or branches on status)
   before calling `.json()`, throwing a clear `HTTP {status}: {statusText}`-style error for
   non-2xx/non-JSON bodies instead of letting an unrelated `SyntaxError` leak through
   (closes Pitfall 5).
3. **SCOPE BOUNDARY — errorCode is OPTIONAL, lobby-manager.ts is OUT OF SCOPE.**
   `lobby-manager.ts` populates **zero** `errorCode` fields today (confirmed above via grep).
   Because the throw contract must not fabricate an `ErrorCode` client-side to paper over
   this gap (that would violate CLAUDE.md's "fail loud, don't fake it" / no-dummy-data rule),
   the client-side error type's `errorCode` field is **`errorCode?: ErrorCode` (optional)**.
   Lobby-originated errors may legitimately throw with `errorCode: undefined` today — this is
   documented as a known, deliberate scope boundary, not a bug for Plan 03 to fix. Populating
   `errorCode` on `lobby-manager.ts`'s failure paths would require editing
   `src/session/lobby-manager.ts`, which is **outside this phase's declared file scope**
   (`src/client/`, `src/types/protocol.ts`, plus the in-repo `GameShell.vue` consumer fixup)
   and is explicitly deferred, not silently dropped.
4. **In-repo consumer migration is THIS phase, not Phase 138.** `GameShell.vue`'s four
   defensive `if (result.success)`-inside-`try/catch` call sites (`:1235`, `:1372`, `:1437`,
   `:1613`) must be simplified to try/catch-only once all 18 methods throw consistently.
   Phase 138 (GAMES cross-repo migration) covers external games/MERC only — this in-repo
   file is Plan 03's responsibility.

---

## F26 / SDK-04 — Client SDK redefines protocol types instead of importing canonical ones

**Audit claim:** `src/client/types.ts` hand-authors duplicate copies of request/message types
that `src/types/protocol.ts` already canonically owns, and the copies have already drifted —
`CreateGameRequest` lost the `playerIds` field present in the canonical version — plus the
WS message "bags" (`WebSocketOutgoingMessage`/`WebSocketIncomingMessage`) are untyped
all-optional grab-bags instead of the canonical discriminated union.

**Current HEAD trace:**
- `src/types/protocol.ts:212-230` — canonical `CreateGameRequest`, confirmed to include
  `playerIds?: string[];` at line 216.
- `src/client/types.ts:288-310` — duplicated `CreateGameRequest`, confirmed field-by-field:
  `gameType`, `playerCount`, `playerNames`, `seed`, `aiPlayers`, `aiLevel`, `gameOptions`,
  `playerConfigs` (looser inline shape than canonical's named `PlayerConfig`), `useLobby`,
  `creatorId` — **`playerIds` is absent**. Confirmed drift is real, not a false positive.
- `src/client/index.ts:81` (`CreateGameRequest`) and `:90` (`ClaimSeatRequest`) — confirmed
  the barrel re-exports these names FROM `./types.js` (the import block spans lines ~5-92,
  with a single `} from './types.js';` closing the whole block at line 92). Any type deleted
  from `client/types.ts` without a matching re-export line breaks this barrel with a TS2305
  error at `index.ts`.
- `src/client/types.ts:326-327` — confirmed the re-export precedent already exists for Lobby
  types: `// Re-export lobby types from canonical source` / `export type { LobbyState,
  SlotStatus, LobbySlot, LobbyInfo };` (importing them from `../types/protocol.js` at the top
  of the file, line 5). This is the exact pattern Plan 04 must replicate for every other
  duplicated type.
- `src/client/types.ts:237-243` and `:245-276` — confirmed `WebSocketOutgoingMessage`
  (`type: 'action' | 'ping' | 'getState'` with all other fields optional) and
  `WebSocketIncomingMessage` (`type: 'state' | 'restart' | 'error' | 'pong' | 'lobby' |
  'actionResult'` with all other fields optional) are hand-authored flat bags, not derived
  from `protocol.ts`'s discriminated `WebSocketMessage` union.
- `src/client/game-connection.ts` — confirmed the only three outgoing message constructions
  in the entire file are `{type:'action', ...}` (line 140-145), `{type:'getState'}`
  (line 169), and `{type:'ping'}` (line 383) — exactly matching Pitfall 7's claimed set of
  `action | ping | getState`, NOT the full lobby-mutation set (`claimSeat`, `joinLobby`,
  `setReady`, etc., which all go over HTTP via `MeepleClient`'s fetch methods per the F25
  trace above, never over the WebSocket).

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 04), including the two scope-boundary corrections this gate
exists to record authoritatively:**

1. **Barrel re-export chain must be preserved.** Every request type deleted from
   `src/client/types.ts` (`CreateGameRequest`, `ClaimSeatRequest`, `SetReadyRequest`,
   `AddSlotRequest`, `RemoveSlotRequest`, `SetSlotAIRequest`, `UpdateGameOptionsRequest`,
   `UpdatePlayerOptionsRequest`, etc.) requires a matching
   `export type { X } from '../types/protocol.js';` line added in the same file, mirroring the
   existing Lobby-types precedent at `types.ts:326-327`. `npx tsc --noEmit` (or the repo's
   typecheck script) must pass afterward — a TS2305 "has no exported member" error pointing at
   `index.ts` is the concrete regression signal this must not produce. This resolves the
   `CreateGameRequest`/`playerIds` drift by making `client/types.ts` re-export the canonical
   (non-drifted) definition rather than maintaining a second copy.
2. **Outgoing WS union narrowing set is `ActionMessage | PingMessage | GetStateMessage`
   ONLY** — confirmed via the `game-connection.ts` trace above that these are the only three
   variants ever constructed client-side over the wire. Narrowing to just `{type:'action'}`
   (omitting ping/getState) would break `requestState()` and the ping interval — Plan 04 must
   include all three, not just `action`.
   Exact narrowing mechanism (`Extract<WebSocketMessage, {...}>` vs. hand-written union of the
   three imported interfaces) is implementer discretion per CONTEXT.md; the *set* of variants
   is not discretionary.

---

## F35 / SDK-05 — `WebSocketMessage` union omits `UpdateSlotPlayerOptionsMessage`

**Audit claim:** `UpdateSlotPlayerOptionsMessage` is defined in `protocol.ts` but missing from
the `WebSocketMessage` discriminated union, even though its two structural siblings
(`UpdatePlayerOptionsMessage`, `UpdateGameOptionsMessage`) are both union members — undermining
the file's own "invalid messages are unrepresentable" design claim.

**Current HEAD trace:**
- `src/types/protocol.ts:400-407` — `UpdateSlotPlayerOptionsMessage` interface confirmed
  defined: `{ type: 'updateSlotPlayerOptions'; seat: number; playerOptions: Record<string,
  unknown>; }`.
- `src/types/protocol.ts:420-435` — `WebSocketMessage` union, confirmed full member list:
  `ActionMessage | PingMessage | GetStateMessage | GetLobbyMessage | ClaimSeatMessage |
  JoinLobbyMessage | UpdateNameMessage | SetReadyMessage | AddSlotMessage | RemoveSlotMessage |
  SetSlotAIMessage | LeaveSeatMessage | KickPlayerMessage | UpdatePlayerOptionsMessage |
  UpdateGameOptionsMessage`. `UpdateSlotPlayerOptionsMessage` is confirmed absent; both named
  siblings (`UpdatePlayerOptionsMessage` at :434, `UpdateGameOptionsMessage` at :435) are
  confirmed present.
- Confirmed zero in-repo runtime consumers dispatch on `WebSocketMessage` for this operation:
  `GameShell.vue:1613` calls the HTTP method `client.updateSlotPlayerOptions()` (per the F25
  trace, this is one of the 12 raw-JSON HTTP methods, not a WS message), and
  `game-connection.ts`'s only outgoing WS constructions are `action`/`ping`/`getState` (per
  the F26 trace) — `updateSlotPlayerOptions` has never been sent over the WebSocket transport
  in this codebase.

**VERDICT: LEGITIMATE**

**Locked fix scope (for Plan 04, bundled with SDK-04 since both touch the same union):**
Add `UpdateSlotPlayerOptionsMessage` to the `WebSocketMessage` union in `protocol.ts`. This is
a **purely additive type-completeness fix with zero runtime behavior change** — no consumer
today constructs or dispatches on this message shape over the wire, matching the audit's own
`adjustedSeverity: low` and the verifier's confirmation. No test regression risk from this
specific change; it exists to keep the discriminated union exhaustive for future WS-transport
consumers.

---

## Gate Summary

| Finding | Req ID | Verdict | Fix scope owner |
|---|---|---|---|
| F23 | SDK-01 | LEGITIMATE | Plan 02 |
| F24 | SDK-02 | LEGITIMATE | Plan 02 |
| F38 | SDK-06 | LEGITIMATE | Plan 02 |
| F25 | SDK-03 | LEGITIMATE | Plan 03 |
| F26 | SDK-04 | LEGITIMATE | Plan 04 |
| F35 | SDK-05 | LEGITIMATE | Plan 04 (bundled with F26) |

Zero REJECTED verdicts. All six findings independently re-traced against current HEAD
(post-Phase-135) source with fresh file:line evidence in this pass — no verdict is copied
verbatim from the audit's original line numbers or from 136-RESEARCH.md without independent
re-confirmation against the live files. Plans 02-05 are unblocked.
