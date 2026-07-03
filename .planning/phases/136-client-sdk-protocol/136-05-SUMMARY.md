---
phase: 136-client-sdk-protocol
plan: 05
subsystem: client
tags: [client-sdk, vue-composables, error-contract, gameshell, docs]
requires:
  - phase: 136-02
    provides: "GameConnection.opened, connectImmediately, #userDisconnected"
  - phase: 136-03
    provides: "GameConnection.action() awaiting opened with bounded timeout"
  - phase: 136-04
    provides: "MeepleClient one-throw error contract (parseResponse<T>), MeepleClientError, connect() threading connectImmediately/wsImplementation"
provides:
  - "useGame's setupConnection consumes GameConnection.opened instead of a fixed setTimeout(100) guess"
  - "useGame({autoConnect:false}) threads connectImmediately:false into client.connect() — no open-then-kill socket"
  - "GameShell.vue lobby handlers are try/catch-only against the throwing MeepleClient contract"
  - "docs/api/client.md quickstart teaches await connection.opened + try/catch, not fire-and-forget connect() or raw-JSON .success checks"
affects: [138-games-cross-repo-migration]

tech-stack:
  added: []
  patterns:
    - "Vue composable regression tests use effectScope() (not full component mount) to host onUnmounted/watch-bearing composables under test, mirroring useActionController.test.ts's precedent"
    - "FakeWebSocket + vi.useFakeTimers()/advanceTimersByTimeAsync to prove opened-driven timing without a real socket, mirroring game-connection.test.ts"

key-files:
  created:
    - src/client/vue.test.ts
  modified:
    - src/client/vue.ts
    - src/ui/components/GameShell.vue
    - docs/api/client.md

decisions:
  - "isSettingUp cleared via connection.opened.then()/.catch() rather than exposing a new public API — the fix is entirely internal to setupConnection, no UseGameReturn signature change"
  - "connectImmediately: autoConnect is threaded into client.connect()'s options object directly; the old open-then-disconnect fallback block is deleted entirely since GameConnection.connect() already honors connectImmediately (from Plan 02/04)"
  - "GameShell.vue's inner joinLobby auto-join fallback (show lobby anyway so the user can retry manually) is preserved by nesting a local try/catch around just that call, rather than letting the failure bubble to the outer joinGame() catch and lose the fallback UX"
  - "toast.error messages in the six simple lobby handlers (addSlot/removeSlot/setSlotAI/kickPlayer/updatePlayerOptions/updateGameOptions/updateSlotPlayerOptions) now surface err.message when available (falling back to the prior generic string) instead of a static string, since the thrown MeepleClientError carries the real server message"
  - "docs/api/client.md: GameConnection.action()'s {success:false} resolution over the WebSocket is explicitly documented as a deliberate exception to the throwing contract — it is not the SDK-03 trap, since only a genuine server-reported action failure resolves that way (connection-level failures still reject)"

metrics:
  duration: "~40 minutes"
  completed: 2026-07-03
---

# Phase 136 Plan 05: Client SDK Consumer Migration Summary

`useGame`'s `setTimeout(100)` isSettingUp guess and open-then-disconnect autoConnect:false pattern are gone, replaced by `GameConnection.opened`-driven signaling; every `GameShell.vue` lobby handler now consumes the Plan 03/04 throwing `MeepleClient` contract via try/catch only; and `docs/api/client.md`'s quickstart teaches `await connection.opened` + try/catch instead of the two audited traps.

## What Was Built

### Task 1 — useGame consumes opened + threads connectImmediately (SDK-01, SDK-02)

`src/client/vue.ts`'s `setupConnection()`:
- Deleted the `setTimeout(() => { isSettingUp = false }, 100)` hack. `isSettingUp` now clears via `connection.opened.then(() => { isSettingUp = false }).catch((err) => { isSettingUp = false; error.value = ... })` — deterministic on the real open/fail signal, not a fixed-duration guess. Open-failure errors are now surfaced through the existing `error` ref instead of silently swallowed.
- Threaded `connectImmediately: autoConnect` into the `client.connect(id, {...})` options object. Deleted the now-unnecessary open-then-`disconnect()` fallback block (`if (!autoConnect) { connection.disconnect(); }`) — `GameConnection.connect()` (Plan 02/04) already skips dialing when `connectImmediately` is `false`, so no socket is ever opened for `useGame({ autoConnect: false })`.

New file `src/client/vue.test.ts` (2 tests, RED-confirmed against pre-fix code — see TDD Gate Compliance below):
1. `useGame({ autoConnect: false })` threads `connectImmediately: false` into `client.connect()` and opens zero `FakeWebSocket` instances.
2. `isSettingUp` clearing is tied to `opened` resolving, not a fixed delay — proven by advancing fake timers 150ms (past the deleted 100ms hack) without firing the fake socket's `onopen`, confirming a `playerSeat` change is still ignored (connection count stays at 1), then firing `onopen` and confirming the same `playerSeat` change now triggers a reconnect (count becomes 2).

### Task 2 — GameShell.vue lobby handlers migrated to try/catch-only + docs (SDK-03, DOCX-04)

Every `GameShell.vue` lobby call site (`createGame`, the `joinGame()` auto-join block, `handleJoinLobby`, `handleSetReady`, `handleAddSlot`, `handleRemoveSlot`, `handleSetSlotAI`, `handleKickPlayer`, `handleUpdatePlayerOptions`, `handleUpdateGameOptions`, `handleUpdateSlotPlayerOptions`) had its `if (result.success && result.lobby) {...} else { toast.error(result.error) }` guard collapsed to a straight-line body (`if (result.lobby) {...}`) since `result.success` is now guaranteed true or the call has already thrown. Catch blocks surface `err.message` via `toast.error` where the plan's acceptance criteria called for it (the six simple slot/option handlers previously used a static error string; now they use the real thrown message with a fallback).

The `joinGame()` auto-join block's prior "join failed, show the lobby anyway so the user can retry manually" fallback UX is preserved by nesting a local `try/catch` around just the `client.joinLobby()` call, rather than letting a join failure bubble to the outer `joinGame()` catch (which would show a generic "Failed to join game" toast and skip the manual-retry lobby view).

The `:654`/`:669` `handleUndo()` sites were checked per the plan's read_first — confirmed they call `platformRequest()`/a raw `fetch()` to a non-`MeepleClient` `/undo` endpoint, not one of the 21 throwing `MeepleClient` HTTP methods, so they are correctly left untouched.

No `GameShell.*.test.ts` files asserted the old raw-JSON return shapes for these lobby methods (confirmed via grep for `.success` across all `GameShell*.test.ts` — zero matches), so no test files needed updates.

`docs/api/client.md`:
- New "Error Handling" section explicitly lists all 21 throwing `MeepleClient` HTTP methods and documents `MeepleClientError` (also added to the Classes export list), with a `try/catch` + `instanceof MeepleClientError` example.
- Explicitly documents `GameConnection.action()`'s `{success:false}` resolution as the deliberate, non-trap exception (genuine server-reported action failure only; connection-level failures still reject).
- "Basic Client Usage" example now wraps `createGame`/`connect`/`action` in try/catch and awaits `connection.opened` before subscribing/acting.
- "Matchmaking" and "Connection Event Handling" examples add `await connection.opened` after `client.connect(...)`.
- "Lobby Management" example wraps the whole flow in try/catch instead of showing bare unguarded lobby-mutation calls.

## Task Commits

1. **Task 1: useGame consumes opened + threads connectImmediately (SDK-01, SDK-02)** - `903e9914` (test)
2. **Task 2: Migrate GameShell.vue lobby handlers to try/catch-only + doc corrections (SDK-03, DOCX-04)** - `f2e226f9` (fix)

## Files Created/Modified

- `src/client/vue.ts` - deleted setTimeout(100) hack + open-then-disconnect block; isSettingUp now opened-driven; connectImmediately threaded from autoConnect
- `src/client/vue.test.ts` (new) - SDK-01/SDK-02 regression coverage, RED-confirmed
- `src/ui/components/GameShell.vue` - 11 lobby call sites migrated from defensive `if (result.success)` to try/catch-only against the throwing contract
- `docs/api/client.md` - Error Handling section, MeepleClientError export doc, quickstart examples now await `connection.opened` and wrap lobby mutations in try/catch

## Decisions Made

See frontmatter `decisions` for the full list; the two most consequential:
- `connection.opened` consumption is entirely internal to `setupConnection()` — no `UseGameReturn` API surface change, so this is a pure bugfix from the perspective of `useGame` callers.
- The `joinGame()` auto-join fallback UX (show lobby anyway on join failure) is preserved via a nested try/catch rather than letting the failure propagate to the outer catch, which would have silently changed user-facing behavior on join failure (a Rule 1 regression this plan deliberately avoided introducing).

## Deviations from Plan

None — plan executed exactly as written. The six simple lobby handlers' toast messages were upgraded from static strings to `err.message` (with the prior string as fallback) per the plan's own acceptance criteria ("Catch blocks surface the thrown `err.message` (and errorCode when present) to the user"), not a deviation.

## TDD Gate Compliance

Task 1 is `tdd="true"`. RED was recorded live: `src/client/vue.ts` was stashed back to its pre-fix state and `npx vitest run src/client/vue.test.ts` was run against it, producing 2 failing tests (one for the missing `connectImmediately: false` threading, one for the `isSettingUp` fixed-delay behavior letting a stale reconnect through). The stash was then restored (fix re-applied) and both tests turned GREEN. Because the RED/GREEN split was verified via a stash round-trip rather than two separate commits (the fix is a single small diff, not independently compilable mid-way), only one commit (`903e9914`) covers both the test file and the fix — matching the documented precedent from 136-04 and 135-06 for single-function, non-decomposable edits.

## Self-Check: PASSED

- `src/client/vue.ts` — FOUND
- `src/client/vue.test.ts` — FOUND
- `src/ui/components/GameShell.vue` — FOUND
- `docs/api/client.md` — FOUND
- Commit `903e9914` — FOUND
- Commit `f2e226f9` — FOUND

## Verification

- `npx vitest run src/client/vue.test.ts` — 2/2 passed
- `npx vitest run src/client/` — 62/62 passed (client.test.ts + game-connection.test.ts + vue.test.ts)
- `npx vitest run src/ui/components/` — 460/460 passed
- `npx vitest run` (full repo) — 2344/2344 passed, 174/174 files (baseline 173 files/2342 tests + 1 new file/2 new tests)
- `npx tsc --noEmit -p .` — zero errors in `src/client/vue.ts`, `src/client/vue.test.ts`, `src/ui/components/GameShell.vue` (pre-existing unrelated test-file looseness errors elsewhere untouched, matching 136-04's documented baseline)
- `grep -n "if (result.success" src/ui/components/GameShell.vue` — zero matches
- `grep -n "if (!result.success" src/ui/components/GameShell.vue` — 2 matches, both at the out-of-scope `handleUndo()` raw-`/undo`-fetch sites (not a `MeepleClient` throwing method)

## Next Phase Readiness

Phase 136 (Client SDK & Protocol) is now fully verifiable end-to-end: `GameConnection` exposes `opened`/`connectImmediately`/`#userDisconnected` (Plan 02/03), `MeepleClient` throws consistently through one chokepoint (Plan 04), and the in-repo consumers (`useGame`, `GameShell.vue`, `docs/api/client.md`) all use the new contracts (Plan 05). Phase 138 (GAMES cross-repo migration) can proceed against a stable, fully-migrated first-party reference implementation.
