# Phase 136: Client SDK & Protocol - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

The public client SDK gives callers an awaitable connection lifecycle, one consistent error contract, and types that match the canonical protocol — no silent drops, no forked type drift. Covers audit findings F23, F24, F25, F26, F35, F38 (requirements SDK-01..06; PROC-01/PROC-02 discipline applies fractally). Scope: `src/client/` (game-connection.ts, client.ts, types.ts, vue.ts) + `src/types/protocol.ts`.

</domain>

<decisions>
## Implementation Decisions

### Connection Lifecycle
- **SDK-01 (F23)**: **`GameConnection.opened` promise** (mirroring the dev-host-client pattern). `action()` called before open **awaits the open** (bounded by the connection timeout) and then sends; genuine failures **reject loudly** — never resolve `{success:false}` silently. `MeepleClient.connect()` exposes the awaitable open. Delete the `setTimeout(100)` hack in `vue.ts`.
- **SDK-02 (F24)**: Suppression tracked in a **private `#userDisconnected` flag** instead of mutating `config.autoReconnect`; `connect()` clears the flag (disconnect→connect symmetry restored). Add an explicit **`connectImmediately`** option to `GameConnectionConfig` so `useGame({autoConnect:false})` no longer opens-and-kills a socket.
- **SDK-06 (F38)**: **Add `playerId?: string` to `MeepleClientConfig`** — constructor skips `generatePlayerId()` when provided; the no-Web-Crypto error message now points at a field that exists.

### Error Contract & Protocol Types
- **SDK-03 (F25)**: **One contract: all `MeepleClient` methods throw** with the server's ErrorCode on `!data.success`, and also on non-2xx HTTP (no more unrelated JSON parse errors). createGame, claimSeat, joinLobby, setReady, addSlot, removeSlot, setSlotAI, leavePosition, kickPlayer, updatePlayerOptions, updateSlotPlayerOptions, updateGameOptions all migrate to the throwing contract.
- **SDK-04 (F26)**: **Delete the duplicated request types from `src/client/types.ts`; re-export the canonical ones from `src/types/protocol.js`** (as the file already does for Lobby types). Replace `WebSocketOutgoingMessage`/`WebSocketIncomingMessage` all-optional bags with the canonical discriminated `WebSocketMessage` union narrowed to client-sent variants and a discriminated incoming union keyed on `type`. Resolve the existing drift (client `CreateGameRequest` lost `playerIds`).
- **SDK-05 (F35)**: **Add `UpdateSlotPlayerOptionsMessage` to the `WebSocketMessage` union** in protocol.ts (its siblings UpdatePlayerOptionsMessage/UpdateGameOptionsMessage are already members; the advertised exhaustive-switch pattern requires it).

### Process (carried over from Phases 131-135 locked decisions)
- PROC-01 verify-first: per-finding verdict in `136-FINDINGS-VERIFICATION.md` BEFORE any fix.
- PROC-02: red-then-green regression test per fix, RED recorded in SUMMARY.
- Same-phase doc updates (DOCX-04). Full suite green per wave.

### Claude's Discretion
- Exact shape of the opened promise API (`connection.opened: Promise<void>` vs `connect(): Promise<GameConnection>` — pick the one that composes best with the existing consumer surface incl. vue.ts and dev-host-client precedent; both may exist if clean).
- Error class shape for the unified throwing contract (reuse existing SDK error types if any; include ErrorCode + server message).
- Timeout semantics for action()-awaits-open (reuse the existing connection timeout config).
- Whether the narrowed client-sent union lives in protocol.ts or client/types.ts (re-export from canonical source either way).

</decisions>

<code_context>
## Existing Code Insights

### Key trace points (from audit; re-verify per PROC-01)
- `src/client/game-connection.ts:81` (connect), `:99-103` (disconnect mutates config.autoReconnect), `:105-110` (reconnect restores), `:128-131` (action resolves {success:false} when not OPEN).
- `src/client/client.ts:171-186` (connect fire-and-forget), `:215-222` (createGame raw JSON), `:336-362` (claimSeat/joinLobby raw), `:585` (generatePlayerId error message).
- `src/client/types.ts:12-27` (MeepleClientConfig — no playerId), `:237-276` (all-optional WS bags), `:288` (CreateGameRequest drifted — lost playerIds), `:327` (existing Lobby re-export precedent), `:330-394` (duplicated request types).
- `src/types/protocol.ts:293-300` (unrepresentable-invalid-states claim), `:401` (UpdateSlotPlayerOptionsMessage defined), `:420-435` (union missing it).
- `src/client/vue.ts` — setTimeout(100) hack; useGame autoConnect:false opens-and-kills.
- Dev-host-client (v4.4 DRIVE work) — the in-repo awaitable-open precedent to mirror.

### Established Patterns
- v4.4 SDK work fixed 3 promise-lifecycle criticals in dev-host-client — that code is the house pattern for awaitable connection lifecycles.
- Fail-loud error conventions from Phases 131-135.
- protocol.ts discriminated-union style with `type` discriminants.

### Integration Points
- vue.ts `useGame` consumes GameConnection — must migrate off the setTimeout hack and open-and-kill pattern.
- Games/MERC consuming MeepleClient lobby methods with the raw-JSON contract will break (intentional, Phase 138 migrates); BoardSmith-internal tests/fixtures must be updated this phase.
- Platform implementers consume protocol.ts — adding to the union is additive; the client-types deletion is SDK-internal.

</code_context>

<specifics>
## Specific Ideas

- SDK-01's regression test: `connect(); await conn.action(...)` immediately — must not silently drop; assert the action sends after open or rejects loudly on timeout/failure.
- SDK-03's test sweep: every public MeepleClient method has a failure-contract test (throws with ErrorCode on !success and on non-2xx).
- Suite baseline after Phase 135: 172 files / 2285 tests green.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
