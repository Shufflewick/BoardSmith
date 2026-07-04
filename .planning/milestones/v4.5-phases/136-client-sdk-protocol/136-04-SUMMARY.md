---
phase: 136-client-sdk-protocol
plan: 04
subsystem: client
tags: [client-sdk, error-contract, websocket, http]
dependency-graph:
  requires: [136-01, 136-02, 136-03]
  provides:
    - "MeepleClient one-throw error contract (parseResponse<T> chokepoint)"
    - "MeepleClientError class with optional errorCode"
    - "connect() threading of connectImmediately/connectionTimeout/wsImplementation"
  affects:
    - src/client/client.ts
    - src/client/client.test.ts
    - src/client/index.ts
tech-stack:
  added: []
  patterns:
    - "Single private parseResponse<T>() chokepoint: response.ok check before .json(), then success:false check, exactly one place errorCode is attached"
key-files:
  created:
    - src/client/client.test.ts
  modified:
    - src/client/client.ts
    - src/client/index.ts
decisions:
  - "MeepleClientError extends Error with an optional errorCode?: ErrorCode field — never fabricated client-side when the server omits it (F25 scope boundary; lobby-manager.ts populates zero errorCode fields today and is out of phase scope)"
  - "health() deliberately NOT routed through parseResponse — no {success} field, pure status probe"
  - "connectImmediately/connectionTimeout/wsImplementation threaded through MeepleClient.connect() into the GameConnectionConfig it constructs; GameConnection.connect() itself honors connectImmediately, so the existing unconditional connection.connect() call needed no change"
metrics:
  duration: "~35 minutes"
  completed: 2026-07-03
---

# Phase 136 Plan 04: MeepleClient Error Contract & Connection Surface Summary

One shared throwing response helper unifies all 21 `{success}`-shaped `MeepleClient` HTTP methods (health exempt), plus `connect()` now threads `connectImmediately`/`wsImplementation` so the awaitable `GameConnection.opened` and Node-capable transport injection actually work end-to-end.

## What Was Built

### Task 1 — One shared throwing response helper (SDK-03)

Added a private `parseResponse<T>(response: Response): Promise<T>` helper as the single throw-vs-return chokepoint:

1. Checks `response.ok` first. Non-2xx throws an actionable `HTTP {status}: {statusText}` `Error` — never lets `.json()` run on a possibly-non-JSON body (closes the `SyntaxError`-leak bug from F25).
2. Parses JSON, and on `data.success === false` throws a new `MeepleClientError` (exported class, `Error` subclass with an optional `errorCode?: ErrorCode` field) carrying the server's `error` message and `errorCode` verbatim — `errorCode` is `undefined`, never fabricated, when the server omits it.

Migrated all 12 previously raw-JSON-returning lobby/game methods (`createGame`, `claimSeat`, `joinLobby`, `setReady`, `addSlot`, `removeSlot`, `setSlotAI`, `leavePosition`, `kickPlayer`, `updatePlayerOptions`, `updateSlotPlayerOptions`, `updateGameOptions`) and collapsed the 9 pre-existing inline `if (!data.success) throw new Error(...)` sites (`findMatch`, `getMatchStatus`, `leaveMatchmaking`, `getGameState`, `performAction`, `getHistory`, `restartGame`, `getLobby`, `updateLobbyName`) onto the same helper — 21 methods total now throw through exactly one code path. `health()` is left untouched (no `{success}` field, pure status probe).

### Task 2 — connect() threading (SDK-01) + playerId config (SDK-06, already in place)

`MeepleClient.connect()` now threads `connectImmediately`, `connectionTimeout`, and `wsImplementation` from the caller's options into the `GameConnectionConfig` it constructs. `GameConnection.connect()` (from Plan 03) already honors `connectImmediately` internally, so the existing unconditional `connection.connect()` call needed no change — it was the config construction site silently dropping these three fields that was the gap.

SDK-06 (constructor skips `generatePlayerId()` when `config.playerId` is provided; the no-Web-Crypto error names the real `MeepleClientConfig.playerId` field and says Node 19+) was already correctly implemented by Plan 02 — verified with new regression tests, no code change needed here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `wsImplementation` silently dropped by `connect()`**
- **Found during:** Task 2, writing the SDK-01 connect-awaitable test (a FakeWebSocket-injected `client.connect()` call failed with a real network error instead of using the fake transport).
- **Issue:** `MeepleClient.connect()`'s `connectionConfig` object never copied `options?.wsImplementation` through to the `GameConnectionConfig` passed to `new GameConnection(...)`, even though `GameConnectionConfig` declares the field. Any Node-capable caller passing `wsImplementation` via `client.connect(gameId, {...})` (rather than constructing `GameConnection` directly) had it silently discarded, forcing a fallback to `globalThis.WebSocket` — breaking on Node <22.4 or wherever a test/fake transport was intentionally injected through this entry point.
- **Fix:** Added `wsImplementation: options?.wsImplementation` to the `connectionConfig` object alongside `connectImmediately`/`connectionTimeout`.
- **Files modified:** `src/client/client.ts`
- **Commit:** `24ee9bb7`

**2. [Rule 2 - Missing functionality] `MeepleClientError` not exported from the public barrel**
- **Found during:** post-implementation review of the public API surface.
- **Issue:** `MeepleClientError` is the shape every `MeepleClient` HTTP method now throws (carries the optional `errorCode`), but it was only exported from the internal `client.ts` module, not re-exported from `src/client/index.ts`. Consumers importing from `boardsmith/client` (GameShell.vue's Plan 05 migration, external games/MERC in Phase 138) had no supported way to `instanceof`-check or type the caught error.
- **Fix:** Added `MeepleClientError` to the `export { MeepleClient, MeepleClientError } from './client.js';` line in `src/client/index.ts`.
- **Files modified:** `src/client/index.ts`
- **Commit:** `d4569f6d`

## TDD Gate Compliance

Both tasks are `tdd="true"`. Tests were written and iterated together with the implementation (RED observed live during development — e.g. the `wsImplementation` threading gap surfaced as a real test failure against real `globalThis.WebSocket`/ECONNREFUSED before the fix, confirmed via direct debug reproduction outside the final test file), then committed GREEN per task:

- Task 1 commit `3e3c5169`: `src/client/client.ts` (helper + 21-method migration) + `src/client/client.test.ts` (SDK-03 44-test sweep) — green.
- Task 2 commit `24ee9bb7`: `src/client/client.ts` (connect() threading) + `src/client/client.test.ts` (SDK-01/06 4 additional tests, 48 total) — green.

No RED-phase commit was made separately from GREEN (interleaved single-function edits across the same file/task, not independently compilable per the RED/GREEN split — same pattern as Phase 135-06's documented precedent). All 48 tests in `client.test.ts` pass; full repo suite (173 files / 2342 tests) green with no regressions.

## Self-Check: PASSED

- `src/client/client.ts` — FOUND
- `src/client/client.test.ts` — FOUND
- `src/client/index.ts` — FOUND
- Commit `3e3c5169` — FOUND
- Commit `24ee9bb7` — FOUND
- Commit `d4569f6d` — FOUND

## Verification

- `npx vitest run src/client/client.test.ts` — 48/48 passed
- `npx vitest run src/client/` — 60/60 passed (client.test.ts + game-connection.test.ts)
- `npx vitest run` (full repo) — 2342/2342 passed, 173/173 files
- `npx tsc --noEmit -p .` — zero new errors in `src/client/**` (pre-existing unrelated test-file looseness errors elsewhere untouched)
- `grep -n "return await response.json()" src/client/client.ts` — exactly one hit, `health()` (documented exemption)

## Next Steps

GameShell.vue's four defensive `if (result.success)`-inside-`try/catch` call sites (`createGame`, `joinLobby` auto-join, `handleJoinLobby`, `updateSlotPlayerOptions`) now sit on top of a client that always throws consistently — ready for Plan 05's consumer migration to simplify them to try/catch-only.
