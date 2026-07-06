---
phase: 153-dev-host-multi-client-turn-desync-fix
reviewed: 2026-07-06T16:32:01Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/cli/commands/dev.ts
  - src/cli/dev-host/dev-host.integration.test.ts
  - src/cli/dev-host/multiplayer-host.test.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: resolved
resolution: "WR-01 fixed — extracted the WS connection/close handler into a shared, exported createDevHostConnectionHandler (src/cli/dev-host/connection-handler.ts) that both dev.ts and the DEF-C regression test now import, eliminating the hand-mirror drift risk and giving the test teeth against the literal code (verified: neutering the guard fails the stale-close test). IN-01 (20ms sleep) left as-is — de-risked by the subsequent polling waitFor. Full suite green (2677)."
---

# Phase 153: Code Review Report

**Reviewed:** 2026-07-06T16:32:01Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Small, well-scoped change: a one-line socket-identity guard added to `dev.ts`'s WS `close` handler, plus a real-`ws` integration test proving the DEF-C stale-close race and a fast `MultiplayerHost`-level canary documenting the session-layer consequence.

Traced the guard logic against all the edge cases called out in scope:
- **Normal disconnect** (socket closes, no reconnect happened): `clients.get(clientId) === socket` is still true (nothing else re-set the map entry), so cleanup (`clients.delete` + `mpHost.disconnect`) still runs. No leak introduced.
- **clientId null/undefined** (socket closed before ever sending `hello`): guarded by the existing `clientId &&` short-circuit — correctly a no-op, matching pre-fix behavior (there was nothing to tear down since `clients.set`/`mpHost` were never touched for this socket).
- **Stale close after reconnect** (page reload: new socket sends `hello` with the same persisted `clientId` before the old socket's `close` fires): `clients.set(clientId, newSocket)` on the `hello` handler (line 750) runs synchronously in the new socket's `message` handler, strictly before the old socket's `close` event can be observed by this guard (Node's event loop serializes handler execution; the test's `waitFor(() => s2Messages.some(m => m.type === 'init'))` forces this ordering deterministically before firing `s1.close()`). At guard-check time `clients.get(clientId) === newSocket !== oldSocket`, so cleanup is correctly skipped — no orphaning of the reconnected seat.
- **Genuine real disconnect with no newer connection** (no reload, WS just drops): `clients.get(clientId) === socket` still holds, so `mpHost.disconnect(clientId)` still fires. No path found where a real disconnect is now wrongly ignored.

Confirmed the fix is provably load-bearing rather than a placebo: `MultiplayerHost.disconnect()` deletes the clientId from the internal `connected` Set (multiplayer-host.ts:213), and every send/broadcast path (`multiplayer-host.ts:614`, `649`, `689`) gates on that same `connected` Set — so an unguarded stale `disconnect()` call genuinely silently drops all future broadcasts/responses to the reconnected socket, exactly as the DEF-C repro describes. I additionally read the RED commit (`1474375c`) showing the integration test's unguarded mirror handler failed pre-fix, and the GREEN commit (`43eab61c`) showing the real `dev.ts` diff is exactly the guard analyzed above — the RED→GREEN progression is genuine, not asserted after the fact. Ran both test files locally; all 41 tests pass.

Test-to-source fidelity: the integration test's hand-mirrored close handler (`dev-host.integration.test.ts:369-379`) is character-for-character equivalent to the real `dev.ts:766-769` guard, and the commit history shows both were edited together in the same commit. Low near-term drift risk, but see WR-01 below for a structural concern about this duplication persisting long-term.

The `MultiplayerHost` canary (`multiplayer-host.test.ts:246-276`) is not a tautology: it asserts a real, traceable consequence of the session layer's public contract (`disconnect()` called after a reconnected `hello` silently drops future `game_state`/`server_response` delivery to that seat) and is explicitly documented as "green and stays green" — i.e., it's a regression canary for the *session-layer* invariant that the *transport-layer* guard is required to protect, not a test of the fix itself. This is legitimate and correctly labeled.

## Warnings

### WR-01: Hand-mirrored close handler duplicated between test and production code, with no automated enforcement of sync

**File:** `src/cli/dev-host/dev-host.integration.test.ts:369-379` (vs. `src/cli/commands/dev.ts:757-770`)
**Issue:** The integration test's "stale close" `describe` block deliberately re-implements `dev.ts`'s `wss.on('connection')` handler (including the guard) rather than importing and exercising the real handler, because `dev.ts`'s connection-wiring is inline inside `devCommand` and not exported as a testable unit. The code comments on both sides acknowledge this ("two independent, hand-copied implementations that must be kept in sync") and rely entirely on developer discipline (a comment pointing at `153-RESEARCH.md`) to keep them aligned. If a future change touches `dev.ts`'s close-handler guard (e.g., additional cleanup logic, a different guard condition) without a matching edit to the test's mirror, the test will keep passing while the real handler silently regresses — the exact failure mode the scope prompt asked me to check for. There is no lint rule, shared helper, or CI check enforcing the two stay identical.
**Fix:** Extract the connection-handling logic (message dispatch + guarded close) out of `devCommand` into a small exported, unit-testable function (e.g. `createWsConnectionHandler({ clients, mpHost, dispatch })` returning the `(socket) => void` callback), and have both `dev.ts`'s `wss.on('connection', ...)` and the integration test call the *same* function instead of maintaining a hand-copied second implementation. This removes the sync-drift risk entirely rather than relying on comments and process discipline.

## Info

### IN-01: Fixed 20ms sleep after socket close, layered on top of an already-deterministic wait

**File:** `src/cli/dev-host/dev-host.integration.test.ts:444-448`
**Issue:** After `s1.close()` and `waitFor(() => s1.readyState === NodeWebSocket.CLOSED)` (which already deterministically confirms the close event has fired on the client side), the test adds an additional `await new Promise((resolve) => setTimeout(resolve, 20))` with the comment "Give the close handler's synchronous body a tick to run." This is a minor belt-and-suspenders timing assumption: on a loaded CI runner, 20ms could in principle not be enough for the server-side `close` event (a separate TCP-level event, not directly ordered with the client's own `readyState` transition) to have fired and the guard's synchronous body to have executed before the subsequent `s2.send(...)` — theoretically permitting rare flakiness, though the fact that the assertions that follow are themselves polled via `waitFor(...)` (with a 1500ms budget and a swallowed timeout) largely absorbs this risk in practice.
**Fix:** Not blocking — the swallowed-timeout + explicit-assertion pattern immediately after already provides a real safety net. If stricter determinism is wanted, the close handler's cleanup could be observed directly (e.g., poll `staleClients.get('seat-a') !== s1socket`) instead of a fixed sleep, but this is a nice-to-have, not a correctness gap.

---

_Reviewed: 2026-07-06T16:32:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
