---
phase: 136-client-sdk-protocol
plan: 03
subsystem: client-sdk-protocol
tags: [client-sdk, websocket, lifecycle, tdd]
dependency-graph:
  requires: [136-01, 136-02]
  provides:
    - "GameConnection.opened: awaitable, fail-loud socket-open signal"
    - "GameConnection.action(): await-then-send instead of silent {success:false}"
    - "GameConnection #userDisconnected flag (config.autoReconnect never mutated)"
    - "GameConnection connectImmediately honored in connect()"
  affects:
    - "136-04 (MeepleClient.connect() will expose/consume GameConnection.opened)"
    - "136-05 (useGame composable will consume connectImmediately + opened)"
tech-stack:
  added: []
  patterns:
    - "Awaitable connection lifecycle: opened: Promise<void> constructed per connect() call, resolved/rejected from the existing onopen/onclose/onerror assignment idiom (not addEventListener), with a no-op .catch() guard mirroring dev-host-client.ts"
    - "await-then-send divergence: action() AWAITS opened (bounded by connectionTimeout) rather than throwing synchronously the way dev-host-client.ts's send() does, so existing action()-immediately-after-connect() call sites keep working without every caller adding an explicit await"
    - "Private suppression flag over config mutation: #userDisconnected tracks user-initiated disconnect instead of overwriting config.autoReconnect, preserving the caller's config object as a read-only contract"
key-files:
  created: []
  modified:
    - src/client/game-connection.ts
    - src/client/game-connection.test.ts
decisions:
  - "action()'s not-connected/timeout/open-failure paths all REJECT (throw) instead of resolving {success:false} — only a genuine server-reported action failure resolves {success:false}, preserving the distinction the audit flagged as missing"
  - "cleanup()'s pending-action rejection was corrected to actually reject (pending.reject(...)) instead of resolving {success:false} — its own comment already said 'Reject all pending actions' but the code resolved; fixed as part of the same fail-loud principle (Rule 1)"
  - "connectImmediately gates connect() unconditionally (every call, not just an implicit auto-dial), per the plan's locked acceptance criteria and RED test — a caller constructing with connectImmediately:false and later calling connect() must still get no socket; wiring an actual manual-connect trigger through this gate is Plan 04/05's scope (MeepleClient.connect()/useGame), not this plan's"
  - "reconnect() simplified to delegate entirely to connect() (reset reconnectAttempts, cleanup, connect) since connect() now clears #userDisconnected itself — removed the divergent 4-step restore path flagged by 136-RESEARCH.md Pitfall 1"
metrics:
  duration: "~40 min"
  completed: 2026-07-03
---

# Phase 136 Plan 03: GameConnection Lifecycle Fix (SDK-01/SDK-02) Summary

`GameConnection` is now awaitable and fail-loud: an `opened` promise mirrors the dev-host-client house pattern (resolve on open, reject with an actionable message on error/close-before-open), `action()` awaits that promise (bounded by `config.connectionTimeout`) instead of silently resolving `{success:false}` for a not-yet-open socket, `disconnect()` tracks suppression via a private `#userDisconnected` flag instead of mutating the caller's `config.autoReconnect`, and `connect()` now honors `connectImmediately:false` by skipping socket creation entirely.

## What Was Built

**Task 1 — `opened` promise + await-then-send `action()` (SDK-01).** Added a readonly `opened: Promise<void>` field, reconstructed on every `connect()` call via `#openedResolve`/`#openedReject`/`#openPending` private state, with a no-op `.catch(() => {})` attached immediately (mirroring `dev-host-client.ts:112-135`'s unhandled-rejection guard). `onopen` resolves it (`#resolveOpen()`); `onclose`/`onerror` reject it with an actionable `"connection to '{baseUrl}' failed/closed before opening"` message (`#rejectOpen()`) — both are no-ops once the promise has already settled, so a later clean/unclean close doesn't try to reject an already-resolved promise. `action()` was rewritten: spectator-check first, then a `!this.ws` immediate throw ("not connected, call connect() first"), then `await this.awaitOpen(actionName)` (a `Promise.race` between `this.opened` and a `config.connectionTimeout`-bounded timeout) if the socket isn't yet `OPEN`, then a post-await re-check before sending. The bare `10000`-literal action-response timeout was replaced with `config.connectionTimeout`, and the response-timeout path now rejects instead of resolving `{success:false}`. Fixed a related bug found in `cleanup()` along the way: its own comment said "Reject all pending actions" but the code called `pending.resolve({success:false, ...})` — corrected to `pending.reject(new Error(...))` to match the fail-loud principle this whole plan enforces (Rule 1).

**Task 2 — `#userDisconnected` flag + `connectImmediately` honoring (SDK-02).** Added a private `#userDisconnected` field. `disconnect()` now sets it and no longer touches `config.autoReconnect`. `connect()` clears `#userDisconnected` at entry (restoring `disconnect()`→`connect()` symmetry) and, per the plan's locked acceptance criteria, unconditionally skips socket creation when `config.connectImmediately` is `false` (not just on an implicit auto-dial path). `scheduleReconnect()` gained an `if (this.#userDisconnected) return;` guard alongside the pre-existing `autoReconnect` opt-out check. `reconnect()` was simplified per 136-RESEARCH.md's Pitfall 1 flag: it now just resets `reconnectAttempts`, calls `cleanup()`, and delegates to `connect()` — the old 4-step sequence that separately re-set `config.autoReconnect = true` is gone since `connect()` itself now handles restoring the connectable state.

## Verification

- `npx vitest run src/client/game-connection.test.ts` — 12/12 pass (3 pre-existing DRIVE-02 tests + 9 new PROC-02 regression tests).
- `npx vitest run src/client/` — 12/12 pass, no lifecycle regressions (only test file in `src/client/`).
- `npx tsc --noEmit` — zero errors under `src/client/` (remaining repo-wide tsc errors are pre-existing, unrelated test-file looseness in `src/session/`, `src/ui/` — confirmed untouched by this plan).
- Grepped for other `GameConnection` consumers in test files: only `game-connection.test.ts` references it; `client.ts`/`vue.ts` call `.disconnect()`/`.reconnect()` without reading internal config state, so no other call sites were affected by the mutation-to-flag change (those files' `connectImmediately`/`opened` wiring is explicitly Plan 04/05 scope per this plan's `<objective>`).

### PROC-02 RED State (recorded before each fix)

**Task 1 RED (commit `d94920b2`):** 5 of the newly added tests failed against pre-fix `game-connection.ts` — `opened` didn't exist (`TypeError`/`undefined`), `action()` called before open resolved `{success:false, error:'Not connected'}` instead of awaiting-then-sending, and the connectionTimeout-bound rejection path hung/resolved silently instead of rejecting. Confirmed via `npx vitest run` showing `5 failed | 3 passed`.

**Task 2 RED (commit `368c8754`):** 3 of the newly added tests failed against the Task-1-fixed-but-Task-2-unfixed code — `disconnect()` still mutated `config.autoReconnect` (assertion `expected false to be true`), `disconnect()`→`connect()` did not restore auto-reconnect (a subsequent unclean close never rescheduled), and `connectImmediately:false` still opened a real `FakeWebSocket`. Confirmed via `npx vitest run` showing `3 failed | 9 passed`.

Both RED states are recorded in this SUMMARY and in the corresponding `test(136-03): ...` commit messages, per PROC-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `cleanup()`'s pending-action handling silently resolved `{success:false}` despite its own "Reject all pending actions" comment**
- **Found during:** Task 1
- **Issue:** When a connection closes with actions still in flight, `cleanup()` called `pending.resolve({success:false, error:'Connection closed'})` — a genuine connection-closed failure was indistinguishable from a resolved (if unsuccessful) server response, contradicting the comment directly above it and the plan's own "no path returns `{success:false}` for a precondition/connection failure" requirement.
- **Fix:** Changed to `pending.reject(new Error('GameConnection: connection closed while an action was pending.'))`, matching the comment's stated intent.
- **Files modified:** `src/client/game-connection.ts`
- **Commit:** `322a993e`

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data introduced by this plan.

## Threat Flags

None — both fixes (`action()`'s await-then-send, `#userDisconnected`) stay within the trust boundary the plan's own `<threat_model>` already scoped (UI/caller → `GameConnection.action()`, and `disconnect()`'s config-mutation surface); no new network endpoints, auth paths, or schema changes were introduced. T-136-05 and T-136-06 are both directly closed by this plan's changes.

## Self-Check: PASSED

- `src/client/game-connection.ts` — FOUND, contains `opened`, `#userDisconnected`, `connectImmediately` gating in `connect()`.
- `src/client/game-connection.test.ts` — FOUND, contains 9 new PROC-02 regression tests plus the 3 pre-existing DRIVE-02 tests (12 total).
- Commit `d94920b2` (test RED, Task 1) — FOUND in `git log`.
- Commit `322a993e` (feat GREEN, Task 1) — FOUND in `git log`.
- Commit `368c8754` (test RED, Task 2) — FOUND in `git log`.
- Commit `8ae83a3f` (feat GREEN, Task 2) — FOUND in `git log`.
