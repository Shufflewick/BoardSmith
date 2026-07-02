# Phase 127: Scriptable Dev Host - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Every remaining dev-host capability — state/lobby queries, the client SDK, and the last UI-only controls — is drivable by a scripted (non-browser) client. Covers DRIVE-01 (`getState`/`getLobby` WS ops implemented), DRIVE-02 (`GameConnection` works in Node), DRIVE-03 (debug-panel toggle + UI switcher via WS ops).

Scope: `src/cli/dev-host/` (WS op handlers), `src/client/` (GameConnection WebSocket abstraction), `src/types/protocol.ts` (already defines getState/getLobby).

</domain>

<decisions>
## Implementation Decisions

### getState/getLobby Ops (DRIVE-01)
- `getState` returns the requesting client's current `PlayerGameState` (same shape as the `game_state` broadcast); `getLobby` returns `LobbyInfo` — both correlated via the existing optional `requestId`
- Implemented in `multiplayer-host.ts`'s message handler (host-level queries like join/follow/restart — not game ops through the bridge)

### Node-Capable Client (DRIVE-02)
- Use `globalThis.WebSocket` — native in Node ≥22 (project runs Node 22) and browsers; ZERO new dependencies; optional constructor-injected WebSocket implementation override for exotic runtimes
- Proof: a Node integration test that drives a real dev-host session over WS (connect, join, getState, perform an action) — the agent-usage scenario itself

### UI-Only Controls → WS Ops (DRIVE-03)
- Debug-panel toggle: host-level WS message (like `follow`) that the DevHost page receives and forwards to the iframe via the existing postMessage path
- UI switcher: host-level WS message driving the exact same code path as the dropdown (no parallel logic)
- Both ops added to the dev-host wire protocol types (typed + greppable)

### Claude's Discretion
- Exact message type names (follow the existing host-op naming: 'join'/'leave'/'follow'/'restart' style); how the integration test hosts the WS server (real dev host vs in-process SnapshotSessionHost+ws bridge)

</decisions>

<code_context>
## Existing Code Insights

(From the verified audit + Phases 123-126.)

### Verified gaps this phase closes
- protocol.ts:316,321 define `getState`/`getLobby` message types; zero handlers in multiplayer-host.ts/bridge.ts (verified by grep during the audit)
- src/client/game-connection.ts:80 — bare `new WebSocket(wsUrl)` (browser global; dead in Node <22 without native WS; works with globalThis.WebSocket in Node 22+ but verify the import pattern/typing)
- DevHost.vue debug toggle (postMessage-only from Dev chrome) + UI switcher dropdown — no WS ops

### Reusable Assets
- multiplayer-host.ts host-op handlers: `join` (~275), `leave` (~298), `restart` (~223), `follow` (~241) — the pattern for getState/getLobby/debug-toggle/ui-switch handlers
- The `game_state` broadcast build path (post-Phase 123/126: includes flowDebugInfo, per-seat pendingAction, warnings) — getState should reuse the same builder for one source of truth
- DevHost.vue toggleDebug postMessage (~301) and UI-switcher logic — the code paths the new ops must drive (no parallel logic)
- Phase 126's log-capture + debug:logs — new ops should record failures there as appropriate
- client SDK: src/client/game-connection.ts + src/client/index.ts exports

### Established Patterns
- Host-level ops handled in multiplayer-host handleMessage switch; game ops translated via bridge.ts
- requestId correlation exists on ActionMessage; extend consistently

### Integration Points
- src/types/protocol.ts (GetStateMessage/GetLobbyMessage already exist; add response message types if missing + the two new control ops)
- multiplayer-host.ts handleMessage; DevHost.vue WS message handling (it receives host messages too — check how 'follow' state reaches the page)
- game-connection.ts constructor + connect()

</code_context>

<specifics>
## Specifics

- The Node integration test IS the acceptance test for the whole phase promise: a Node script (no browser) connects to a running dev host, joins a seat, queries getState/getLobby, performs an action, toggles the debug panel, switches UI — every DRIVE requirement exercised in one flow where feasible
- getState must include the Phase 123/126 enrichments (flowDebugInfo, pendingAction, warnings) since agents are the consumer
- Keep the single-source-of-truth rule: getState reuses the broadcast builder; control ops reuse the UI code paths

</specifics>

<deferred>
## Deferred Ideas

- HTTP REST endpoints (/api/state) — v2 (TOOL-02)
- Multi-client follow mode — out of scope (YAGNI)

</deferred>
