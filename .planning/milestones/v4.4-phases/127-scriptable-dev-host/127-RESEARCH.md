# Phase 127: Scriptable Dev Host - Research

**Researched:** 2026-07-02
**Domain:** WebSocket protocol design (Node `ws` server + native/browser `WebSocket` client), dev-host host-level ops, Vue-side postMessage relay
**Confidence:** HIGH (all claims verified by direct file:line reading of this repo's source — no external library research was needed; the one external fact checked, Node's native WebSocket stability, was verified via official Node.js release notes)

## Summary

Phase 127 adds four new host-level WS ops (`getState`, `getLobby`, a debug-panel toggle, a UI-switch op) to `MultiplayerHost`'s existing `ClientInbound`/`HostOutbound` union in `src/cli/dev-host/multiplayer-host.ts`, and makes `GameConnection` (`src/client/game-connection.ts`) usable from a Node process by replacing its hard reference to the `WebSocket` browser global with `globalThis.WebSocket` (optionally overridable via constructor injection). The work is small and additive — the existing `join`/`leave`/`restart`/`follow` ops are the template for `getState`/`getLobby`, and `follow`'s outbound round-trip to `DevHost.vue` is the template for the debug-toggle/UI-switch ops (both of which currently only exist as page-local functions with no WS surface at all).

The single biggest risk this research surfaces is **not** in the ops themselves — it's a **pre-existing protocol mismatch** between `GameConnection` and the dev host. `GameConnection` was written for a *different, not-yet-existing* production server (a ShufflewickPub-style REST+WS host at `/games/:gameId`, speaking `{type:'state'|'restart'|'lobby'|'error'|'actionResult'|'pong'}`), while `boardsmith dev`'s actual WS server (wired in `src/cli/commands/dev.ts`) speaks a completely different wire protocol (`{type:'hello'|'join'|'leave'|'restart'|'follow'|'server_request'}` in, `{type:'lobby'|'joined'|'error'|'init'|'game_state'|'server_response'|'follow'}` out, at `/__boardsmith/ws`). **`GameConnection` cannot drive `boardsmith dev` today, and DRIVE-02's "Node integration test that drives a real dev-host session" cannot literally instantiate `GameConnection` against the dev host without first resolving this mismatch.** This must be an explicit planning decision, not discovered mid-implementation. See Pitfall 1 and Open Question 1.

**Primary recommendation:** Add `getState`/`getLobby`/`debug:toggle`/`ui:select` as new `ClientInbound`/`HostOutbound` variants in `multiplayer-host.ts` (mirroring `follow`'s pattern exactly — request in, single relay/ack out, correlated by `requestId` where a direct reply makes sense). Fix `GameConnection`'s `new WebSocket(...)` call sites to use `globalThis.WebSocket` with a constructor-injectable override. For the Node integration test (the phase's actual acceptance proof), write a small dedicated dev-host wire client scoped to `src/cli/dev-host/` (or a thin test helper) that speaks the `hello`/`join`/`server_request` protocol directly — do not attempt to bend `GameConnection` into speaking two incompatible protocols.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**getState/getLobby Ops (DRIVE-01)**
- `getState` returns the requesting client's current `PlayerGameState` (same shape as the `game_state` broadcast); `getLobby` returns `LobbyInfo` — both correlated via the existing optional `requestId`
- Implemented in `multiplayer-host.ts`'s message handler (host-level queries like join/follow/restart — not game ops through the bridge)

**Node-Capable Client (DRIVE-02)**
- Use `globalThis.WebSocket` — native in Node ≥22 (project runs Node 22) and browsers; ZERO new dependencies; optional constructor-injected WebSocket implementation override for exotic runtimes
- Proof: a Node integration test that drives a real dev-host session over WS (connect, join, getState, perform an action) — the agent-usage scenario itself

**UI-Only Controls → WS Ops (DRIVE-03)**
- Debug-panel toggle: host-level WS message (like `follow`) that the DevHost page receives and forwards to the iframe via the existing postMessage path
- UI switcher: host-level WS message driving the exact same code path as the dropdown (no parallel logic)
- Both ops added to the dev-host wire protocol types (typed + greppable)

### Claude's Discretion
- Exact message type names (follow the existing host-op naming: 'join'/'leave'/'follow'/'restart' style); how the integration test hosts the WS server (real dev host vs in-process SnapshotSessionHost+ws bridge)

### Deferred Ideas (OUT OF SCOPE)
- HTTP REST endpoints (`/api/state`) — v2 (TOOL-02)
- Multi-client follow mode — out of scope (YAGNI)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DRIVE-01 | `getState`/`getLobby` ops implemented in the dev host | `multiplayer-host.ts` `ClientInbound`/`HostOutbound` union and `handleMessage` switch (lines 39-56, 206-221) is the exact insertion point; `reinitSeat`'s `session.viewForSeat(seat)` + `session.meta()` (lines 477-484) is the reusable "build a `game_state`-shaped payload for one seat" builder `getState` must call |
| DRIVE-02 | `GameConnection` works in Node | `game-connection.ts:80` (`new WebSocket(wsUrl)`) and `:71` (`WebSocket.OPEN`/`.CONNECTING` static reads) are the only two browser-global touch points; both are fixable via `globalThis.WebSocket` |
| DRIVE-03 | Debug toggle + UI switcher via WS ops | `DevHost.vue` `toggleDebug()` (line 301-303) and `onUiSelect()` (line 281-283) are pure page-local functions today with zero WS surface; `onHostMessage`'s `follow` case (line 177-179) is the template for a new host→page relay message the new ops must add |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `getState`/`getLobby` WS ops | Node dev-host process (`multiplayer-host.ts`) | — | Host-level query against in-memory lobby/session state; no browser involvement needed to answer it |
| `GameConnection` Node-capability | Client SDK (`src/client/`) | — | Pure runtime-environment fix (browser global → `globalThis`); does not touch server or protocol shape |
| Debug-panel toggle / UI switcher WS ops | Node dev-host process (relay only) | Browser page (`DevHost.vue`, actual state mutation) | The debug panel and UI selection are Vue component state living **inside the game iframe**; the host process has no DOM to act on — it can only relay the command to a connected page, which then drives its own iframe via the existing `postToGame()` postMessage path |
| Node integration test transport | Test-only Node script / vitest test | Dev-host WS server (`ws` package, already a dependency) | Proves the whole DRIVE promise without a browser; must speak `multiplayer-host.ts`'s actual wire protocol, not `GameConnection`'s |

## Standard Stack

### Core
No new libraries. This phase is 100% additive to existing in-repo code.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ws` | `^8.16.0` (already in `package.json` `dependencies`) [VERIFIED: package.json] | Node-side WebSocket **server** — used today in `src/cli/commands/dev.ts:7,540` to run the real `boardsmith dev` WS endpoint | Already a direct dependency; zero new install needed for either the ops themselves or the integration test |
| `globalThis.WebSocket` (Node built-in, ≥22 stable) | Node ≥22.4 stable [VERIFIED: Node.js official release notes] | Node-side WebSocket **client** — for `GameConnection` and the integration test's driving script | Native, zero-dependency, browser-API-compatible; matches CONTEXT.md's locked decision |

### Supporting
None — no new packages needed anywhere in this phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `globalThis.WebSocket` (native) | `ws` npm package as the *client* too (`import WebSocket from 'ws'`) | `ws`'s client class is API-compatible with the browser `WebSocket` but is a project dependency, not a language built-in; CONTEXT.md explicitly locked in the zero-new-dependency native path since `ws` is currently only used server-side. No reason to introduce a second usage pattern when Node 22 already provides this natively. |

**Installation:**
```bash
# No installation needed — ws is already a dependency; globalThis.WebSocket is Node-native.
```

**Version verification:**
```bash
npm view ws version   # confirms latest 8.x still current for the server side (unchanged by this phase)
node --version         # confirms the dev machine is on Node 22.21.1 — globalThis.WebSocket is stable
```
Verified in this session: `ws@^8.16.0` already present in `package.json`; `node --version` on this machine returns `v22.21.1`. Node's global `WebSocket` was marked stable in v22.4.0 per the official Node.js v22 release blog — confirm the CI/deploy Node version is ≥22.4, not just ≥22.0, before relying on it without a runtime guard.

## Package Legitimacy Audit

**Not applicable** — this phase installs zero external packages. `ws` is an existing dependency being reused as-is; `globalThis.WebSocket` is a Node built-in. No `slopcheck`/registry verification step is required.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │   boardsmith dev  (Node CLI process)     │
                         │                                           │
   Browser tab A ──WS──▶ │  wss.on('connection') [dev.ts:559]       │
   (DevHost.vue)         │        │                                  │
                         │        ▼                                  │
   Scripted Node    ──WS──▶  MultiplayerHost.handleMessage() ────────┼──▶ SnapshotSessionHost
   client (NEW,             (multiplayer-host.ts:206)                │    (via bridge.ts's
   DRIVE-02 proof)          │   join/leave/restart/follow             │     createDevSession)
                            │   + NEW: getState/getLobby              │
                            │   + NEW: debug:toggle/ui:select         │
                            │        │                                │
                            │        ▼                                │
                            │  send(clientId, HostOutbound) ───────────┼──▶ per-client WS send
                            └───────────────────────────────────────────┘
                                     │
                                     │ (only for debug:toggle / ui:select,
                                     │  relayed BACK to a browser page)
                                     ▼
                         DevHost.vue onHostMessage() [DevHost.vue:139]
                                     │
                                     ▼  postToGame() [DevHost.vue:186] — postMessage
                         Game iframe (GameShell, platform mode)
                                     │
                                     ▼
                         DebugPanel / dev-ui-select handlers (existing, untouched)
```

Trace for `getState`: scripted client sends `{type:'getState', requestId}` over WS → `MultiplayerHost.handleMessage` → new `handleGetState` (mirrors `reinitSeat`'s `session.viewForSeat(seat)` + `session.meta()` lookup, requires the caller to already hold a seat, mirrors `handleServerRequest`'s "not seated" guard) → `send(clientId, {type:'state', requestId, view, isComplete, winners})` directly back to the SAME client that asked. No relay to a browser page needed — this is a pure host-side read.

Trace for `debug:toggle`: scripted OR browser client sends `{type:'debugToggle'}` → `MultiplayerHost.handleMessage` → new `handleDebugToggle` → **must decide a target**: the simplest correct default (see Pitfall 4) is to relay the message to *every currently connected client* (`for (const clientId of this.connected) this.send(clientide, {type:'debugToggle'})`), mirroring `broadcastLobby()`'s existing fan-out pattern — each connected `DevHost.vue` page receives it and calls the exact same `toggleDebug()` body that its own header button calls today.

### Recommended Project Structure
No new files/directories required. All changes land in existing files:
```
src/
├── cli/dev-host/
│   ├── multiplayer-host.ts   # ADD: getState/getLobby/debugToggle/uiSwitch to ClientInbound + HostOutbound + handleMessage
│   ├── multiplayer-host.test.ts  # ADD: unit tests for the 4 new ops (in-process fake `send`, same pattern as existing tests)
│   └── DevHost.vue           # ADD: onHostMessage cases relaying debugToggle→toggleDebug(), uiSwitch→onUiSelect()-equivalent
├── client/
│   ├── game-connection.ts    # FIX: `new WebSocket(...)` → `new (this.wsCtor)(...)`, wsCtor defaults to globalThis.WebSocket
│   └── types.ts              # ADD (optional): wsImplementation? constructor-injection field on GameConnectionConfig
└── cli/dev-host/
    └── <new>.integration.test.ts   # NEW: real-`ws`-server Node integration test (the DRIVE-01..03 acceptance proof)
```

### Pattern 1: Host-level query op (getState/getLobby)
**What:** A `ClientInbound` message that the host answers directly and immediately from in-memory state, without touching the game session's `server_request`/bridge machinery.
**When to use:** Any op that only needs host-owned data (seat map, lobby phase, last-broadcast view) — never for anything that mutates game state (that stays on `server_request`).
**Example (pattern to follow, adapted from `handleServerRequest`'s seat-resolution + `reinitSeat`'s view lookup):**
```typescript
// Source: src/cli/dev-host/multiplayer-host.ts:314-333 (handleServerRequest) and :477-484 (reinitSeat) — existing patterns this op reuses
private handleGetState(clientId: string, msg: Extract<ClientInbound, { type: 'getState' }>): void {
  const seat = clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
  if (seat === undefined || this.phase !== 'playing' || !this.session) {
    this.send(clientId, { type: 'error', message: 'You are not seated in an active game.' });
    return;
  }
  const view = this.session.viewForSeat(seat);
  const meta = this.session.meta();
  this.send(clientId, { type: 'state', requestId: msg.requestId ?? null, view, isComplete: meta.isComplete, winners: meta.winners });
}

private handleGetLobby(clientId: string, msg: Extract<ClientInbound, { type: 'getLobby' }>): void {
  this.send(clientId, { ...this.lobbyMessage(), requestId: msg.requestId ?? null });
}
```
Note: `lobbyMessage()` (line 564-572) already returns a `{type:'lobby', ...}` shape but it is NOT `protocol.ts`'s `LobbyInfo` shape (no `slots`/`gameType`/`isReady` etc — it's the dev-host's own lighter `SeatInfo[]`-based shape). Decide explicitly whether `getLobby` should return this existing dev-host lobby shape (cheap, consistent with what `DevHost.vue` already renders) or transform it into `protocol.ts`'s `LobbyInfo` (matches CONTEXT.md's literal wording "returns `LobbyInfo`" but requires new mapping code with no current producer in the dev host). See Open Question 2.

### Pattern 2: Host→page relay op (debug toggle / UI switch)
**What:** A `ClientInbound` message with no independent host-side effect — the host's only job is to re-emit it (as a `HostOutbound` of the same or a mapped type) to the connected browser page(s), which then run their EXISTING page-local handler.
**When to use:** Any control whose real effect lives in browser/iframe state that the Node process cannot reach directly (mirrors `follow`, which already does this: `handleFollow` mutates host bookkeeping AND pushes a `{type:'follow', enabled, seat}` message the page reads in `onHostMessage`'s `case 'follow'`).
**Example:**
```typescript
// multiplayer-host.ts — new outbound relay, no new host-side state needed
private handleDebugToggle(_clientId: string): void {
  for (const cid of this.connected) this.send(cid, { type: 'debugToggle' });
}
```
```typescript
// DevHost.vue — onHostMessage, new case (mirrors the existing 'follow' case at line 177-179)
case 'debugToggle':
  toggleDebug(); // exact same function the header button already calls (line 301)
  break;
```

### Anti-Patterns to Avoid
- **Routing `getState`/`getLobby` through `server_request`/`bridge.ts`:** These are host-level (lobby/session) concerns, not game-op concerns. CONTEXT.md's locked decision already rules this out explicitly — do not add `getState`/`getLobby` as new `WireOp` entries in `bridge.ts`.
- **Duplicating `toggleDebug()`/`onUiSelect()` logic server-side:** The host process has no DOM; it must never try to reconstruct what these functions do. It only relays the command. All actual behavior stays in the one place it already lives (`DevHost.vue`).
- **Building a second `GameConnection`-shaped class that speaks the dev-host protocol:** Given the protocol mismatch (Pitfall 1), the temptation is to make `GameConnection` bilingual. Resist this — it turns a clean, single-purpose SDK class into a protocol-detecting shape-shifter. Keep the Node integration test's driver as a small, separate, test-scoped client.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Node-side WebSocket server for the integration test | A custom raw TCP/HTTP upgrade handler | `ws`'s `WebSocketServer` (already a dependency), same as `dev.ts` | It already correctly handles the HTTP upgrade handshake, framing, and close codes; `dev.ts:540` is the exact reference implementation, just without needing to attach to a Vite `httpServer` — `new WebSocketServer({ port: 0 })` standalone is sufficient for a test |
| Correlating request/response across the WS wire | A new ad-hoc "wait for next message of type X" polling helper | The existing `requestId` echo convention already used by `ActionMessage`/`server_request` (`multiplayer-host.ts:112-119`, `requestOrigin` map) | Consistent with the rest of the protocol; CONTEXT.md's locked decision already requires `getState`/`getLobby` to use this exact convention |
| Building a game-state shape for one seat | Re-deriving `PlayerGameState` from raw session internals | `session.viewForSeat(seat)` + `session.meta()` (`bridge.ts`'s `DevSession` interface, already used by `reinitSeat`) | Single source of truth for "what does seat N currently see" — this is the same call the ordinary `game_state` broadcast path uses; reusing it makes `getState` provably consistent with what a reconnecting browser sees |

**Key insight:** Every capability this phase needs already exists somewhere in the codebase in a form built for a slightly different trigger (page load / button click / periodic broadcast). The entire phase is "give these existing code paths a WS-triggerable entry point," never "build new state-computation logic."

## Common Pitfalls

### Pitfall 1: `GameConnection`'s wire protocol does not match `boardsmith dev`'s wire protocol — at all
**What goes wrong:** A plan that says "DRIVE-02: fix `GameConnection`'s `new WebSocket()` call, done" will produce a class that constructs correctly in Node but cannot successfully complete a single round-trip against `boardsmith dev`, because the message shapes are entirely incompatible on both directions.
**Why it happens:** `GameConnection` (`src/client/game-connection.ts`) was built for `MeepleClient`'s target — a production, ShufflewickPub-shaped game server reachable at `${baseUrl}/games/${gameId}` with `?playerId=&player=&spectator=` query params, sending `{type:'action'|'ping'|'getState'}` and expecting `{type:'state'|'restart'|'error'|'pong'|'lobby'|'actionResult'}` back (`src/client/types.ts:229-252`). `boardsmith dev`'s actual WS server (`src/cli/commands/dev.ts:539-583` wired to `MultiplayerHost`) speaks `{type:'hello'|'join'|'leave'|'restart'|'follow'|'server_request'}` in and `{type:'lobby'|'joined'|'error'|'init'|'game_state'|'server_response'|'follow'}` out, at a fixed `/__boardsmith/ws` path with a `hello`-first handshake and no query-param auth. These were built at different times for different purposes and were never reconciled.
**How to avoid:** Treat DRIVE-02's Node-capability fix and DRIVE-01/03's phase-acceptance proof as two SEPARATE deliverables that happen to land in the same phase: (1) fix `GameConnection`'s browser-global dependency (a small, generically useful fix regardless of which server it eventually talks to), and (2) write the Node integration test against a small dedicated dev-host wire client that speaks the REAL `hello`/`join`/`server_request`/`getState` protocol (does not have to be `GameConnection` — could be a ~40-line test helper using `globalThis.WebSocket` directly). Do not claim DRIVE-02 "proves" `GameConnection` drives the dev host; the plan should be explicit that `GameConnection` targets a different (currently theoretical, out-of-repo) production server shape.
**Warning signs:** A plan task titled "use `GameConnection` to connect to `boardsmith dev`" without first reconciling the URL scheme (`/games/:id` vs `/__boardsmith/ws`), the handshake (`hello` vs query-param), and every message type name.

### Pitfall 2: `package.json`'s `engines.node` (`>=20`) is inconsistent with the "native `globalThis.WebSocket`" decision
**What goes wrong:** A consumer running BoardSmith's declared minimum Node version (20) gets `ReferenceError: WebSocket is not defined` the moment they call `GameConnection.connect()` without supplying a `wsImplementation` override — silently violating the "zero new dependencies" promise, since the promise only holds on Node ≥22.
**Why it happens:** Node's native global `WebSocket` client was added experimentally in v21 (behind `--experimental-websocket`) and only marked stable in v22.4 [VERIFIED: Node.js v22 official release blog]. `package.json:107` currently declares `"node": ">=20"`.
**How to avoid:** Either (a) bump `engines.node` to `>=22.4` as part of this phase (a real, user-visible constraint change — flag it in the plan and in `BREAKING.md` scope for Phase 130), or (b) throw an actionable error from `GameConnection`'s constructor/`connect()` when `globalThis.WebSocket` is undefined and no override was supplied (fail loud, not `ReferenceError`), so a Node 20 user gets a clear message instead of a cryptic crash. Given CLAUDE.md's "fail fast and loud, actionable errors" rule, prefer (b) as a guard regardless of whether (a) is also done.
**Warning signs:** Any test or CI matrix still running against Node 20/21 for this package after this phase ships.

### Pitfall 3: `lobbyMessage()`'s existing shape is NOT `protocol.ts`'s `LobbyInfo`
**What goes wrong:** Implementing `getLobby` by literally returning `protocol.ts`'s `LobbyInfo` type requires building a brand-new mapping (dev-host `SeatInfo[]` → `LobbySlot[]` with `playerId` masking, `gameOptionsDefinitions`, `colors`, etc.) that has no current producer anywhere in the dev-host code — a much bigger task than CONTEXT.md's framing ("`getLobby` returns `LobbyInfo`") suggests at a glance.
**Why it happens:** `protocol.ts`'s `LobbyInfo`/`LobbySlot` types (lines 106-168) were designed for the production lobby flow (`ClaimSeatRequest`/`JoinLobbyRequest` etc. — none of which the dev host implements; the dev host has its own simpler auto-seat/seat-picker model). `multiplayer-host.ts`'s `lobbyMessage()` (line 564-572) returns a much smaller ad-hoc shape (`phase`, `seats: SeatInfo[]`, `minPlayers`, `playerCount`) that has served DevHost.vue fine so far.
**How to avoid:** Decide explicitly (flagged in Open Question 2) whether `getLobby` returns the dev host's own existing `lobbyMessage()` shape (cheap, honest about what data actually exists) or a genuinely-mapped `LobbyInfo` (more work, but matches the wire type already defined in `protocol.ts:143` and gives external tooling a stable, documented shape). Do not silently type-cast the existing shape AS `LobbyInfo` — the fields don't match and this would be a lie the type checker won't catch (since the current `lobbyMessage()` return type is a separate `HostOutbound` union member, not `LobbyInfo`).

### Pitfall 4: Debug-toggle/UI-switch have no server-side notion of "which client" to target
**What goes wrong:** A single-target design (relay only to the requesting client, or only to "the active seat's client") silently does nothing when the requester itself has no iframe (e.g. the scripted Node client in the DRIVE-02 integration test) — the op appears to succeed (no error) but nothing observable happens anywhere.
**Why it happens:** The debug panel and UI selector are per-browser-tab Vue state inside `DevHost.vue`+iframe; there is no single canonical "the" debug panel when N browser tabs are open, and a headless Node caller has no tab at all.
**How to avoid:** Broadcast the relay to every currently-connected client (mirrors `broadcastLobby()`'s existing fan-out — simplest correct default for a single-agent dev tool per CONTEXT.md's YAGNI framing on multi-client scenarios). Document clearly in the op's JSDoc that a scripted-only client sending this op will see no visible effect unless a browser tab is also connected — this is expected, not a bug. Consider adding a lightweight ack (`{type:'debugToggle', acked:true}`) sent back to the ORIGINAL requester specifically, distinct from the broadcast to browser tabs, so a Node script can at least confirm the op was received and dispatched.

### Pitfall 5: `getState` before the game has started (lobby phase) / for an unseated or spectating client
**What goes wrong:** Calling `session.viewForSeat(seat)` when `this.session` is `null` (still in `'lobby'` phase) throws or returns `undefined`, and an unseated client has no `seat` at all — both are real states a scripted client could easily hit if it queries `getState` immediately after connecting, before `join`.
**Why it happens:** `handleServerRequest` (multiplayer-host.ts:314-333) already guards this exact case for `server_request` (`if (this.phase !== 'playing' || !this.session)` and `if (seat === undefined)`) — the new `getState`/`getLobby` handlers must copy both guards, not just one.
**How to avoid:** Mirror `handleServerRequest`'s full guard chain verbatim: phase-not-playing error, then seat-not-found error, THEN call `viewForSeat`. `getLobby`, by contrast, should work in EVERY phase (including before any seat is claimed) since it's specifically the mechanism for a not-yet-seated client to discover open seats — do not gate `getLobby` behind `phase === 'playing'`.
**Warning signs:** A test that only exercises `getState`/`getLobby` after `join` + game start will not catch either guard being missing.

### Pitfall 6: `requestId` echo is currently only wired on `ActionMessage`/`server_request` — extending it consistently
**What goes wrong:** If `getState`/`getLobby`'s `requestId` field is added to `ClientInbound` but the corresponding `HostOutbound` reply doesn't echo it back (or echoes it under a different field name than the client expects), a scripted client using promise-based request/response correlation (the way `GameConnection.action()` already does for `ActionMessage`, lines 127-153) will hang forever waiting for a response it can't match.
**Why it happens:** `multiplayer-host.ts`'s existing `requestId` handling is bespoke to `server_request`/`server_response` (the `requestOrigin` map, lines 112-119, 330-333) — it is NOT a generic "any inbound message with a requestId gets a correlated response" mechanism. Each new op must wire its own echo.
**How to avoid:** For `getState`/`getLobby`, since the response always goes straight back to the SAME requesting client (no follower-routing complexity like `server_request` has), a `requestOrigin`-style map is unnecessary — just echo `msg.requestId` straight into the reply synchronously in the same handler. Keep it that simple; do not copy the `requestOrigin` map pattern where it isn't needed.

## Code Examples

### Existing `follow` round-trip (the exact template for debug-toggle/ui-switch)
```typescript
// Source: src/cli/dev-host/multiplayer-host.ts:240-272 (handleFollow) — host-side
// Source: src/cli/dev-host/DevHost.vue:177-179, 278-280 (onHostMessage 'follow' case + toggleFollow) — page-side
// This is the ONLY existing precedent in the codebase for "WS message → page reacts locally,
// no game-op/bridge.ts involvement" — copy this shape for debugToggle/uiSwitch.
```

### Existing seat-resolution + view-lookup (the exact template for getState)
```typescript
// Source: src/cli/dev-host/multiplayer-host.ts:314-333 (handleServerRequest guard chain)
//         and :477-484 (reinitSeat's view + meta lookup)
const seat = clientId === this.followerClientId ? this.effectiveActiveSeat() : this.clientSeat.get(clientId);
if (seat === undefined) { /* not seated — error */ }
const view = this.session?.viewForSeat(seat);
const meta = this.session.meta(); // { isComplete, winners }
```

### `GameConnection`'s only two browser-global touch points (what DRIVE-02 must change)
```typescript
// Source: src/client/game-connection.ts:71, 80
if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
  return;
}
// ...
this.ws = new WebSocket(wsUrl);
```
Both `WebSocket.OPEN`/`WebSocket.CONNECTING` (static enum reads) and `new WebSocket(...)` need to route through an injectable reference — e.g. a private `#WS: typeof WebSocket` field defaulted from `config.wsImplementation ?? globalThis.WebSocket` in the constructor, used for both the static reads and the `new` call.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dev-host is browser-only (every capability requires a browser tab + button click) | Dev-host has a scriptable WS surface for state/lobby queries and the last two UI-only controls | This phase (127) | Closes the last gap identified in the 2026-07-01 agent-ergonomics audit; combined with Phase 126's `debug:logs`, the dev host is now fully observable and (mostly) drivable without a human watching a screen |

**Deprecated/outdated:** Nothing removed in this phase — purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getLobby` should return the dev host's own existing `lobbyMessage()` shape rather than transforming it into `protocol.ts`'s `LobbyInfo` (recommendation, not yet a locked decision) | Pitfall 3, Open Question 2 | If the planner instead commits to full `LobbyInfo` mapping, a non-trivial new mapping module is needed (masking playerId, deriving `isReady`/`openSlots`, sourcing `gameOptionsDefinitions`) that this research did not scope in detail |
| A2 | Debug-toggle/UI-switch should broadcast to ALL connected clients (not just the requester or the active seat) | Pitfall 4 | If a future multi-tab dev workflow needs per-tab-targeted toggles, broadcast-to-all would visibly misbehave (every open tab's debug panel toggles together); currently out of scope per CONTEXT.md's "multi-client follow mode is YAGNI" framing, but debug-toggle is a distinct feature from follow-mode and wasn't explicitly covered by that deferral |
| A3 | The Node integration test should use a small dedicated test-scoped WS client speaking the dev-host's native protocol, rather than extending `GameConnection` to speak two protocols | Summary, Pitfall 1 | If the planner instead wants `GameConnection` itself to be provably dev-host-capable (not just Node-capable), this recommendation under-delivers; that would require a much larger scope change to `GameConnection`'s protocol layer that CONTEXT.md's locked decisions do not appear to anticipate |

## Open Questions (RESOLVED)

> **RESOLVED:** Q1 — resolved by 127-CONTEXT.md's "Protocol-mismatch resolution" amendment: GameConnection stays scoped to its own production protocol (Plan 127-02); a separate `createDevHostClient` sibling ships from `boardsmith/client` (Plan 127-03). Q2 — resolved by Plan 127-01: getLobby reuses the existing dev-host `lobbyMessage()` shape (Assumption A1 recommendation), not protocol.ts's `LobbyInfo`.

1. **Should `GameConnection` ever actually speak `boardsmith dev`'s wire protocol, or does DRIVE-02 only mean "fix the browser-global dependency, wherever it eventually gets pointed"?**
   - What we know: CONTEXT.md locks in `globalThis.WebSocket` + a Node integration test as "the agent-usage scenario itself," strongly implying the test should exercise `GameConnection` specifically.
   - What's unclear: `GameConnection`'s wire protocol has zero overlap with the dev host's actual protocol (see Pitfall 1) — reconciling them is a much larger task than "swap `new WebSocket()` for `globalThis.WebSocket`."
   - Recommendation: Surface this explicitly to the user/planner as a scoping decision BEFORE planning tasks: either (a) narrow DRIVE-02's proof to a dedicated dev-host-protocol test client (not `GameConnection`), documenting that `GameConnection` targets a separate future production server, or (b) expand DRIVE-02's scope to make `GameConnection` (or a new dev-host-specific sibling class) actually speak the dev host's protocol. This research recommends (a) as the minimal, non-scope-creeping interpretation, but it changes what "the agent-usage scenario" literally exercises.

2. **Does `getLobby` need to return `protocol.ts`'s `LobbyInfo` type verbatim, or the dev host's existing simpler shape?**
   - What we know: CONTEXT.md's wording says "returns `LobbyInfo`"; the dev host's `lobbyMessage()` already returns a working (but differently-shaped) lobby payload that `DevHost.vue` renders today.
   - What's unclear: whether "LobbyInfo" in CONTEXT.md was meant as the literal `protocol.ts` type or shorthand for "lobby information."
   - Recommendation: Default to the dev host's existing shape (Assumption A1) unless the user confirms they specifically want the `protocol.ts` `LobbyInfo` contract (which would require new mapping code with no current producer).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ws` (npm package) | WS server (existing, unchanged) + integration test's standalone server | ✓ | ^8.16.0 [VERIFIED: package.json] | — |
| `globalThis.WebSocket` (Node built-in) | `GameConnection` Node-capability, integration test client | ✓ on this dev machine (Node 22.21.1) | Stable since Node 22.4 [VERIFIED: Node.js official release notes] | Constructor-injected override (locked decision) for pre-22.4 runtimes; `engines.node` currently under-declares this requirement (Pitfall 2) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `globalThis.WebSocket` on Node <22.4 — falls back to the constructor-injected `wsImplementation` override (already part of the locked decision) or, if unset, should fail loud with an actionable error rather than a bare `ReferenceError` (Pitfall 2).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2.1.0, `environment: 'node'` [VERIFIED: vitest.config.ts] |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts` |
| Full suite command | `npm run test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DRIVE-01 | `getState` returns the requesting seat's view; `getLobby` returns lobby info; both correlate `requestId` | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "getState"` | ❌ Wave 0 — add cases to existing `multiplayer-host.test.ts` (in-process fake `send`, same pattern as current tests) |
| DRIVE-01 | `getState` guards unseated / not-yet-started game (mirrors `handleServerRequest`'s guard chain) | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "getState"` | ❌ Wave 0 |
| DRIVE-02 | `GameConnection` constructs and connects using `globalThis.WebSocket` (or injected override) without throwing in a Node environment | unit | `npx vitest run src/client/game-connection.test.ts` (new file) | ❌ Wave 0 — no existing `game-connection.test.ts` found in `src/client/` |
| DRIVE-02 | End-to-end: a Node script connects to a REAL dev-host WS server, joins a seat, queries `getState`/`getLobby`, performs an action | integration | `npx vitest run src/cli/dev-host/<new>.integration.test.ts` | ❌ Wave 0 — new file; spin up `new WebSocketServer({ port: 0 })` wired to `MultiplayerHost` exactly as `dev.ts:539-583` does, minus the Vite `httpServer` attachment |
| DRIVE-03 | `debugToggle`/`uiSwitch` ops are accepted host-side and relayed to connected clients | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts -t "debug"` | ❌ Wave 0 |
| DRIVE-03 | `DevHost.vue`'s `onHostMessage` correctly maps `debugToggle`→`toggleDebug()` and the UI-switch relay→`onUiSelect()`-equivalent | component | `npx vitest run src/cli/dev-host/DevHost.debug-relay.test.ts` (new file, `@vitest-environment jsdom`) | ❌ Wave 0 — CONFIRMED pattern: `DevHost.restart.test.ts`/`DevHost.seats.test.ts` use `@vitest-environment jsdom` + `@vue/test-utils` `mount(DevHost, ...)` + a hand-rolled `FakeWebSocket` class assigned to `global.WebSocket` (not a mocking library) with `simulateOpen()`/`simulateMessage()` helpers — follow this exact structure, do not invent a new test harness |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/client/game-connection.test.ts`
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus the new integration test specifically (it is the phase's literal acceptance proof per CONTEXT.md)

### Wave 0 Gaps
- [ ] `src/client/game-connection.test.ts` — does not currently exist; needed to cover DRIVE-02's Node-capability fix in isolation (constructor injection, `globalThis.WebSocket` fallback, actionable error when neither is available)
- [ ] `src/cli/dev-host/<name>.integration.test.ts` — new file; the real-`ws`-server end-to-end test that is the phase's core acceptance proof (see Don't Hand-Roll: reuse `ws`'s `WebSocketServer`, not a custom transport)
- [ ] `src/cli/dev-host/DevHost.debug-relay.test.ts` — new file covering the DRIVE-03 relay; CONFIRMED via direct read of `DevHost.restart.test.ts` that the established pattern is `@vitest-environment jsdom` + `mount(DevHost, {props: {config}})` + a hand-rolled `FakeWebSocket` class (assigned to `global.WebSocket`) with `simulateOpen()`/`simulateMessage()` — reuse this harness verbatim rather than inventing a new one
- [ ] No new framework install needed — Vitest + `ws` are both already present

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Dev-host has no auth model at all (loopback-only dev tool by design); out of scope for this phase — do not introduce one |
| V3 Session Management | Partial | `clientId` is a client-supplied, unauthenticated string (`hello` message) — this is PRE-EXISTING behavior, unchanged by this phase. New ops (`getState`/`getLobby`) must reuse the SAME seat-ownership check (`this.clientSeat.get(clientId)`) as `server_request` already does — no new trust boundary is introduced or should be introduced |
| V4 Access Control | Yes | `getState` must only ever return the CALLING client's own seat view (never another seat's, which could leak hidden information across seats in a hidden-info game) — this is exactly what `viewForSeat(seat)` already guarantees when `seat` is resolved from `clientSeat`/`followerClientId`, never from a client-supplied `seat` parameter. Do NOT accept a client-supplied `seat` field on `getState` (unlike some `debug:*` ops that legitimately do, per-player debug tooling — see `debug:state-at`'s `payload.player` override, which is explicitly commented as a debug-only exception in `bridge.ts:190-195`) |
| V5 Input Validation | Yes | New `ClientInbound` variants are discriminated-union members (TypeScript-narrowed) — same pattern as all existing ops; the `dev.ts:561-567` `JSON.parse` + type guard on `msg.type` already exists and needs no change |
| V6 Cryptography | No | Not applicable — no crypto touched by this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-seat hidden-information leak via a query op | Information Disclosure | `getState` resolves `seat` ONLY from server-tracked `clientSeat`/`followerClientId` state, never from client-supplied input — this is already the pattern `handleServerRequest` uses and must be copied exactly, not reinvented |
| Unauthenticated `clientId` spoofing (pre-existing, out of scope) | Spoofing | Dev-host is a loopback/LAN dev tool with no auth model by design (documented in `multiplayer-host.ts`'s module doc as the "stand-in for ShufflewickPub's game Durable Object" — production auth lives elsewhere); this phase must not attempt to bolt on auth as a side effect of adding new ops |

## Sources

### Primary (HIGH confidence — direct repo file reads)
- `src/cli/dev-host/multiplayer-host.ts` (full file read) — `ClientInbound`/`HostOutbound` union, `handleMessage` switch, `handleFollow`/`handleJoin`/`handleLeave`/`handleServerRequest`/`reinitSeat`/`lobbyMessage`/`broadcastLobby`
- `src/cli/dev-host/bridge.ts` (full file read) — `WireOp` union, `translateOp`/`shapeResult`, `debug:logs` host-lifecycle marker pattern (the ERR-04 precedent for a non-game host op)
- `src/cli/dev-host/DevHost.vue` (lines 1-330 read) — `onHostMessage`, `postToGame`, `toggleDebug`, `onUiSelect`, `onWindowMessage`'s `dev-debug-state`/`dev-ui-list` handling
- `src/cli/commands/dev.ts` (lines 480-610 read) — the real `ws`-based `WebSocketServer` wiring (`noServer: true` + manual upgrade routing to avoid colliding with Vite HMR), `hello`-first handshake, `clients: Map<string, WebSocket>`
- `src/client/game-connection.ts` (full file read) — the two browser-global touch points (`new WebSocket`, `WebSocket.OPEN`/`.CONNECTING`), full message-handling switch (`state`/`restart`/`lobby`/`error`/`actionResult`/`pong`)
- `src/client/types.ts` (lines 229-252 read) — `WebSocketOutgoingMessage`/`WebSocketIncomingMessage` type shapes, confirming the protocol mismatch with the dev host
- `src/client/index.ts` (full file read) — confirms `GameConnection`/`MeepleClient` public export surface, module doc frames it as "connecting to BoardSmith game servers" (production, not dev-host-specific)
- `src/types/protocol.ts` (full file read) — `GetStateMessage`/`GetLobbyMessage` (lines 318-326, already defined, zero handlers anywhere in the codebase confirmed by the earlier audit and re-confirmed here), `LobbyInfo`/`LobbySlot` shape (lines 106-168)
- `package.json` — `ws@^8.16.0` dependency (not dev-dependency), `engines.node: >=20`
- `vitest.config.ts` — test framework config, `environment: 'node'`, no existing WS-server integration test pattern found
- `src/cli/dev-host/multiplayer-host.test.ts` (partial read) — existing unit test pattern (in-process fake `send` callback, no real sockets)

### Secondary (MEDIUM confidence — official external docs)
- [Node.js v22 release announcement](https://nodejs.org/en/blog/announcements/v22-release-announce) and [Node.js 22.0.0 release notes](https://nodejs.org/en/blog/release/v22.0.0) — confirms native `WebSocket` client stabilized (no flag) starting Node 22, fully stable (not experimental) as of v22.4
- Node.js official "Native WebSocket Client" learn page (nodejs.org/learn/getting-started/websocket) — confirms `--experimental-websocket` was required in v21, removed as default-on requirement in v22

### Tertiary (LOW confidence)
- None — all findings were verified either by direct repo inspection or official Node.js release documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, both `ws` and `globalThis.WebSocket` versions verified directly (package.json read, `node --version` run, Node.js official release notes read)
- Architecture: HIGH — every pattern recommendation is a direct line-numbered citation of existing, working, tested code in this exact repo (no external-library architecture guesswork involved)
- Pitfalls: HIGH for the protocol-mismatch finding (directly verified by reading both `game-connection.ts`/`types.ts` and `multiplayer-host.ts`/`dev.ts` side by side — this is a fact about this repo's code, not a training-data guess); HIGH for the Node engines-version gap (verified against official Node.js release notes + `package.json`); MEDIUM for the debug-toggle/UI-switch broadcast-target design recommendation (a reasonable architectural inference from existing patterns, but not something the codebase already implements one way or the other — flagged as Assumption A2)

**Research date:** 2026-07-02
**Valid until:** 30 days (stable, in-repo architecture; the one external fact — Node WebSocket stability — is settled/shipped, not fast-moving)
