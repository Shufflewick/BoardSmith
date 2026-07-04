---
phase: 136-client-sdk-protocol
plan: 02
subsystem: client-sdk-protocol
tags: [types, protocol, client-sdk, websocket, config]
dependency-graph:
  requires: [136-01]
  provides:
    - "protocol.ts: complete WebSocketMessage union (UpdateSlotPlayerOptionsMessage)"
    - "protocol.ts: LobbyResponse/SetReadyRequest/AddSlotRequest/RemoveSlotRequest/SetSlotAIRequest/UpdateGameOptionsRequest/UpdatePlayerOptionsRequest canonical interfaces"
    - "client/types.ts: re-export-only request/response layer over protocol.ts"
    - "client/types.ts: discriminated WebSocketOutgoingMessage/WebSocketIncomingMessage"
    - "client/types.ts: MeepleClientConfig.playerId?, GameConnectionConfig.connectImmediately?/connectionTimeout?"
  affects:
    - "136-03 (MeepleClient error-contract unification consumes connectionTimeout/playerId)"
    - "136-04 (GameConnection lifecycle fix consumes connectImmediately/#userDisconnected)"
    - "136-05 (useGame composable consumes connectImmediately)"
tech-stack:
  added: []
  patterns:
    - "Canonical-source re-export: client/types.ts re-exports request/response shapes from ../types/protocol.js instead of hand-duplicating them (mirrors the pre-existing Lobby-types precedent)"
    - "Discriminated-union narrowing: Extract<WebSocketMessage, {type: 'action'|'ping'|'getState'}> for outgoing; a hand-built type-keyed union for incoming (protocol.ts has no server-to-client union to derive from)"
key-files:
  created: []
  modified:
    - src/types/protocol.ts
    - src/client/types.ts
    - src/client/client.ts
    - src/client/game-connection.ts
decisions:
  - "protocol.ts gained 7 new HTTP-shape interfaces (LobbyResponse, SetReadyRequest, AddSlotRequest, RemoveSlotRequest, SetSlotAIRequest, UpdateGameOptionsRequest, UpdatePlayerOptionsRequest) because client/types.ts owned these shapes but protocol.ts had no exact twin (only structurally-different WS-message counterparts with no playerId field) — added canonical versions first, then re-exported, per plan instruction for non-exact-twin duplicates."
  - "WebSocketIncomingMessage discriminated union is client-local (not re-exported from protocol.ts) because protocol.ts's WebSocketMessage union is explicitly scoped to client-to-server messages only; there is no canonical server-to-client union to derive from."
  - "CreateGameResponse and ApiResponse were left untouched in client/types.ts — they have no protocol.ts twin and are not part of the duplicated-shape set the plan's acceptance criteria target."
  - "Rule 2/3 auto-fix: adding playerId/connectImmediately/connectionTimeout as MeepleClientConfig/GameConnectionConfig members broke the Required<> config literals in client.ts and game-connection.ts. Fixed by threading real default values through (config.playerId ?? generatePlayerId(), connectImmediately ?? true, connectionTimeout ?? 10000) rather than leaving tsc broken or faking values. This also resolves F38/SDK-06: the constructor now honors an explicit config.playerId, and the no-Web-Crypto error message's inaccurate 'Node 16+' claim was corrected to 'Node 19+' in the same pass."
metrics:
  duration: "~35 min"
  completed: 2026-07-03
---

# Phase 136 Plan 02: Client SDK Type Foundation Summary

Canonical protocol types are now the single source of truth for the client SDK: `WebSocketMessage`'s union is complete, `client/types.ts` re-exports every duplicated request/response shape from `../types/protocol.js` instead of maintaining drifted copies, the WS message bags are discriminated unions instead of all-optional grab-bags, and the config surface (`playerId`, `connectImmediately`, `connectionTimeout`) that Plans 03-05 build on now exists and type-checks cleanly.

## What Was Built

**Task 1 — `UpdateSlotPlayerOptionsMessage` union completeness (SDK-05/F35).** Added the missing union member alongside its two siblings in `WebSocketMessage` (`src/types/protocol.ts`). Purely additive; the interface definition was untouched. Confirmed zero runtime consumers dispatch on this variant over the wire (the operation goes over HTTP via `MeepleClient.updateSlotPlayerOptions()`).

**Task 2 — Canonical re-exports + discriminated WS unions (SDK-04/F26).** `src/client/types.ts` no longer hand-authors `CreateGameRequest`, `ClaimSeatRequest`, `ClaimSeatResponse`, `JoinLobbyResponse`, `LobbyResponse`, `SetReadyRequest`, `AddSlotRequest`, `RemoveSlotRequest`, `SetSlotAIRequest`, `UpdateGameOptionsRequest`, or `UpdatePlayerOptionsRequest` — every one is now `export type { X } from '../types/protocol.js'`, mirroring the pre-existing Lobby-types re-export precedent. Because protocol.ts had no exact twin for the last 7 (its WS-message counterparts carry `seat`/`ready`/etc. but never `playerId`, since WS messages get identity from the connection, not the payload), the canonical HTTP-shape interfaces were added to `protocol.ts` first. This resolves the `CreateGameRequest.playerIds` drift the audit flagged — the client type is now the non-drifted canonical one.

`WebSocketOutgoingMessage` is now `Extract<WebSocketMessage, {type: 'action'|'ping'|'getState'}>` — confirmed via `game-connection.ts` that these are the only three variants ever constructed client-side. `WebSocketIncomingMessage` is now a type-keyed discriminated union (`StateIncomingMessage | RestartIncomingMessage | LobbyIncomingMessage | ErrorIncomingMessage | ActionResultIncomingMessage | PongIncomingMessage`) built directly from the six cases `GameConnection.handleMessage()`'s switch dispatches on; this union is client-local since protocol.ts's `WebSocketMessage` is scoped to client-to-server traffic only.

`src/client/index.ts` needed no edits — the barrel's existing `from './types.js'` re-export list already resolved against the new re-export surface with zero TS2305 errors.

**Task 3 — Config fields for Plans 03/04/05 (SDK-02/SDK-06 scaffolding).** Added `playerId?: string` to `MeepleClientConfig` and `connectImmediately?: boolean` / `connectionTimeout?: number` to `GameConnectionConfig`, both with JSDoc documenting default behavior. Adding these fields broke the `Required<>` config literals in `client.ts` and `game-connection.ts` (missing-property compile errors) — fixed by threading real defaults through rather than leaving the build red: `MeepleClient`'s constructor now honors an explicit `config.playerId` and only mints one via `generatePlayerId()` when absent (this simultaneously closes F38/SDK-06 — the error message that told developers to "provide an explicit playerId in MeepleClientConfig" now has a real field to reference); `connectImmediately ?? true` / `connectionTimeout ?? 10000` were added to `GameConnection`'s config defaults. No `connect()`/`disconnect()` lifecycle behavior changed — that is Plan 04's scope.

## Verification

- `npx tsc --noEmit` — zero errors in `src/client/*` or `src/types/protocol.ts` (pre-existing, unrelated test-file errors elsewhere in the repo untouched).
- Zero `TS2305` / "has no exported member" errors (barrel surface intact).
- `npx vitest run src/client` — 3/3 tests pass (`game-connection.test.ts`, the only client test file).
- `UpdateSlotPlayerOptionsMessage` confirmed present as both interface and union member (`grep -c` → 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking compile error] `Required<MeepleClientConfig>` / `Required<Omit<GameConnectionConfig, 'wsImplementation'>>` literals broke when new optional config fields were added**
- **Found during:** Task 3
- **Issue:** Adding `playerId`/`connectImmediately`/`connectionTimeout` as interface members made TypeScript require them in the `Required<>`-typed internal config objects `client.ts` and `game-connection.ts` construct, which the plan's file scope (`src/client/types.ts` only) didn't anticipate touching.
- **Fix:** Threaded real default values through both constructors — `client.ts`: `this.playerId = config.playerId ?? this.generatePlayerId()`, stored on `this.config.playerId`; `game-connection.ts`: `connectImmediately: config.connectImmediately ?? true, connectionTimeout: config.connectionTimeout ?? 10000`. No new runtime lifecycle behavior wired (connect/disconnect symmetry is Plan 04's scope) — only the minimum needed to keep the config objects well-typed and to close the F38/SDK-06 finding, which this same field addition happens to complete.
- **Files modified:** `src/client/client.ts`, `src/client/game-connection.ts`
- **Commit:** c171d73b

**2. [Rule 1 - Bug, folded into the same fix] Inaccurate "Node 16+" claim in the no-Web-Crypto error message**
- **Found during:** Task 3 (same error string already being edited for F38)
- **Issue:** `globalThis.crypto`/`crypto.randomUUID` landed unflagged in Node 19, not Node 16, per the FINDINGS-VERIFICATION gate's note.
- **Fix:** Corrected "Node 16+" to "Node 19+" in the error string.
- **Files modified:** `src/client/client.ts`
- **Commit:** c171d73b

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — this plan's changes stay within the trust boundary the plan's own `<threat_model>` already scoped (client SDK types vs. canonical protocol types); no new network endpoints, auth paths, or schema changes at a trust boundary were introduced.

## Self-Check: PASSED

- `src/types/protocol.ts` — FOUND, contains `UpdateSlotPlayerOptionsMessage` (2 occurrences) and the 7 new HTTP-shape interfaces.
- `src/client/types.ts` — FOUND, re-export-only for request/response types; `WebSocketOutgoingMessage`/`WebSocketIncomingMessage` are discriminated.
- `src/client/index.ts` — FOUND, unmodified (barrel already resolved).
- `src/client/client.ts` — FOUND, constructor honors `config.playerId`.
- `src/client/game-connection.ts` — FOUND, `connectImmediately`/`connectionTimeout` defaulted.
- Commit `7a7d2bcc` — FOUND in `git log`.
- Commit `cf550b2d` — FOUND in `git log`.
- Commit `c171d73b` — FOUND in `git log`.
