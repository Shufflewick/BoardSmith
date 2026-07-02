---
phase: 127-scriptable-dev-host
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/cli/dev-host/dev-host.integration.test.ts
  - src/cli/dev-host/DevHost.debug-relay.test.ts
  - src/cli/dev-host/DevHost.vue
  - src/cli/dev-host/multiplayer-host.test.ts
  - src/cli/dev-host/multiplayer-host.ts
  - src/client/dev-host-client.ts
  - src/client/game-connection.test.ts
  - src/client/game-connection.ts
  - src/client/index.ts
  - src/client/types.ts
  - src/client/ws-ctor.ts
findings:
  critical: 3
  warning: 2
  info: 1
  total: 6
status: fixed
fixed_at: 2026-07-02T10:44:00Z
resolutions:
  CR-01: fixed (commit cdfe940)
  CR-02: fixed (commit 51debc7)
  CR-03: fixed (commit 51debc7)
  WR-01: fixed (commit d75f594)
  WR-02: fixed (resolved by CR-01, commit cdfe940)
  IN-01: fixed (commit d75f594)
---

# Phase 127: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 11
**Status:** fixed (see Resolutions below)

## Resolutions

- **CR-01** (`multiplayer-host.ts`): Added `requestId?: string | null` to the `error` variant and threaded `msg.requestId ?? null` through `handleGetState`'s and `handleServerRequest`'s guard-clause error sends. `dev-host-client.ts`'s existing requestId-correlation logic now rejects these promises immediately, no client-side change needed there. Commit `cdfe940`.
- **CR-02** (`dev-host-client.ts`): Added a `close` listener that rejects every pending correlated request and `opened` (if unsettled) with an actionable "connection closed" error, then clears the pending map. Commit `51debc7`.
- **CR-03** (`dev-host-client.ts`): Attached a permanent internal `opened.catch(() => {})` so a caller who never awaits/catches `opened` doesn't crash the process with an unhandled rejection; external callers can still await/catch the same promise object. The integration test's `deadClient.opened.catch(() => {})` workaround was removed since the SDK now handles this natively. Commit `51debc7` (fix), `0f2c388` (test update).
- **WR-01** (`dev-host-client.ts`): Added `expectType()`, a minimal runtime guard that verifies a correlated reply's `type` matches the expected reply shape before trusting its fields, failing loud with an actionable message on mismatch instead of silently producing garbage typed as valid. Commit `d75f594`.
- **WR-02**: Resolved by CR-01 — guard-clause errors now reject with the specific host-reported message via requestId correlation instead of falling through to the generic timeout. Verified via the new CR-01 regression test (`dev-host.integration.test.ts`, "rejects a correlated getState request promptly with the host error, not a timeout"). Commit `cdfe940`.
- **IN-01** (`dev-host-client.ts`): Hoisted the duplicated `10000` literal into a named `DEFAULT_REQUEST_TIMEOUT_MS` constant. Commit `d75f594`.

Regression tests added in `dev-host.integration.test.ts` (commit `0f2c388`): CR-01 (unseated `getState` rejects promptly, not via timeout) and CR-02 (socket close mid-request rejects the pending promise immediately). Full suite: 2018/2018 passing; `tsc --noEmit` clean on all touched files.

## Summary

The four new host-level WS ops (`getState`/`getLobby`/`debugToggle`/`uiSwitch`), `GameConnection`'s injectable-WebSocket change, and `createDevHostClient` are each individually well-structured and the phase's stated design goals (own-seat-only `getState`, relay-only `debugToggle`/`uiSwitch`, production-protocol-untouched `GameConnection`) all check out under direct inspection and grep verification. However, `createDevHostClient`'s promise/requestId correlation layer — the review's primary focus area — has a real, provable gap: the wire protocol's `error` message (`HostOutbound`'s `{type:'error', message}` variant) carries no `requestId` field at all, so every guard-clause error the host sends in response to a correlated `getState`/`getLobby`/`serverRequest` call is silently dropped by the client's correlation logic instead of rejecting the caller's promise. Combined with the total absence of a `close`/`error`-after-open listener on the client's socket, this produces two flavors of "dangling promise" that the review was specifically asked to check for: requests that hang for the full timeout instead of failing fast on a host-reported error, and (in one path) a promise that can hang forever with no bound at all. There is also an unhandled-rejection crash risk on `client.opened` for any caller who doesn't explicitly await/catch it before sending — the integration test's author clearly hit this (see the explicit `.catch(() => {})` at dev-host.integration.test.ts:184) but did not fix it in the client itself.

All other focus areas passed: `getState`'s seat resolution never reads a client-supplied seat (verified in code and by `multiplayer-host.test.ts`'s "ignores any client-supplied seat field" test), `DevHost.vue`'s relay cases drive the pre-existing `toggleDebug()`/`onUiSelect()` functions with zero parallel logic and no production code path touches them, `ws-ctor.ts`'s guard is correct on Node 22.4+ (verified live: `typeof globalThis.WebSocket === 'function'` on Node 22.21.1) and produces an actionable message, the integration test tears down its `WebSocketServer` and sockets deterministically (`afterAll`, port 0, no fixed sleeps — polling `waitFor` with a hard cap), and `game-connection.ts`'s production wire protocol is behavior-preserving (only the six `WebSocket`/`WebSocket.OPEN`/`.CONNECTING` touch points were routed through `#wsCtor`; `tsc --noEmit` and `eslint` are clean on all reviewed files).

## Critical Issues

### CR-01: `getState`/`getLobby`/`serverRequest` guard-clause errors have no `requestId` — correlated promises never reject on host-reported errors, only time out

**File:** `src/cli/dev-host/multiplayer-host.ts:39-61` (the `HostOutbound` union), and every guard-clause `send` call that uses it, e.g. `multiplayer-host.ts:376` (`handleGetState`), `multiplayer-host.ts:346` (`handleServerRequest`)
**Also affects:** `src/client/dev-host-client.ts:117-136` (the correlation logic that this bug silently defeats)

**Issue:** `HostOutbound`'s `error` variant is declared as:
```ts
| { type: 'error'; message: string }
```
with no `requestId` field — and every guard clause that rejects a correlated request (`handleGetState`'s "Game has not started." / "You are not seated in this game.", `handleServerRequest`'s identical guards) sends exactly this shape:
```ts
this.send(clientId, { type: 'error', message: 'Game has not started.' });
```
`createDevHostClient`'s message handler correlates replies to pending requests strictly by `requestId`:
```ts
const requestId = msg.requestId;
if (typeof requestId !== 'string' || !pending.has(requestId)) return;
```
Since these error messages never carry a `requestId`, this check always fails for them, and the corresponding `getState()`/`getLobby()`/`serverRequest()` promise is **never rejected by the host's actual error** — it silently falls through to the `requestTimeoutMs` (default 10000ms) timeout instead, which then rejects with a generic "timed out ... waiting for a dev host response" message that actively hides the real, actionable host error ("Game has not started.", "You are not seated in this game.") the developer/agent actually needs to see. This directly contradicts the client's own JSDoc: `getState()`/`getLobby()` are documented as "Rejects on host-reported error or timeout" — the "host-reported error" half of that contract is unreachable dead code for any correlated request, for the entire lifetime of the API.

This is untested: `multiplayer-host.test.ts`'s `getState`/`getLobby` describe blocks only assert the raw host-side `send` calls (never through `createDevHostClient`), so the correlation gap never surfaces there. `dev-host.integration.test.ts`'s only two error-path tests are "socket never opens" and "socket open but nothing replies" — neither exercises a host `error` response to a correlated request.

**Fix:** Add `requestId` to the `error` variant and thread it through every guard clause that can occur in response to a correlated request:
```ts
// multiplayer-host.ts
| { type: 'error'; message: string; requestId?: string | null }

// handleGetState / handleServerRequest guard clauses:
this.send(clientId, { type: 'error', message: 'Game has not started.', requestId: msg.requestId ?? null });
```
And in `dev-host-client.ts`, the existing check already works once `requestId` is present — no client-side change needed beyond that. (Guard clauses that are NOT in response to a requestId-bearing message, e.g. `handleFollow`'s enable-guard, can safely omit `requestId` since nothing is waiting on them.)

### CR-02: `createDevHostClient` has no `close`/late-`error` handling — pending requests and the `opened` promise can hang past what the timeout guarantees

**File:** `src/client/dev-host-client.ts:104-136` (the `opened` promise and `message` listener); no `close` listener exists anywhere in the file (`grep -n "close" dev-host-client.ts` only matches the `close()` method itself and `socket.close()`)

**Issue:** Two related gaps, both inside the review's explicit focus ("socket close mid-request — no dangling promises... resource cleanup (close() semantics)"):

1. **No `close` event listener at all.** If the underlying socket closes while requests are pending in the `pending` map — e.g., the dev server process exits, the host restarts, or the caller invokes `client.close()` itself while a `getState()`/`getLobby()`/`serverRequest()` is in flight — none of those pending promises are rejected immediately. They are left to hang until their individual `requestTimeoutMs` (default 10s) fires, at which point they reject with a misleading "timed out ... waiting for a dev host response" message even when the real cause was an intentional or observed close, not a slow host. Calling `client.close()` should synchronously reject every pending request with an actionable "socket closed" error and clear their timers — instead it does nothing to the `pending` map, leaving `setTimeout` handles alive (referenced, i.e. keeping the event loop open) for up to 10 more seconds after the caller believed the connection was closed.
2. **The `opened` promise can hang forever, not just until a bounded timeout.** `opened` only settles via the `open` event or the `error` event (checked against `readyState !== OPEN`). If the socket closes cleanly without ever emitting `error` before `open` (a real `ws`/browser-`WebSocket` behavior on some abrupt server-side closes, and always true if the caller calls `client.close()` before the socket ever opens), `opened` never resolves or rejects — a genuinely dangling promise with no bound at all, unlike the requestId-correlated paths which are at least bounded by `requestTimeoutMs`.

**Fix:** Add a `close` listener that rejects `opened` (if still pending) and every entry in `pending`, then clears the map:
```ts
socket.addEventListener('close', () => {
  const closeErr = new Error(`createDevHostClient: connection to '${url}' closed.`);
  for (const [requestId, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.reject(closeErr);
  }
  pending.clear();
}, { once: true });
```
and route `opened`'s rejection through the same `close` event (in addition to `error`) so it cannot hang unboundedly.

### CR-03: `client.opened` can crash the Node process with an unhandled promise rejection if the caller doesn't explicitly await/catch it

**File:** `src/client/dev-host-client.ts:104-115`

**Issue:** `opened` is a plain `Promise` returned as a public field, constructed eagerly inside `createDevHostClient` with no internal `.catch()`. Node terminates the process by default on an unhandled promise rejection. The documented usage pattern is "Await before sending anything" (JSDoc at `dev-host-client.ts:56`) — but nothing prevents (or even warns against) a caller who instead relies on `send()`'s synchronous not-open guard and never touches `.opened` at all. If the connection then fails (bad URL, host down, `ECONNREFUSED`), `opened` rejects with zero attached handlers and Node crashes the whole script — not a caught, actionable error, a hard process exit. The integration test's author independently discovered this exact failure mode and worked around it locally rather than fixing the SDK:
```ts
// dev-host.integration.test.ts:184
deadClient.opened.catch(() => {}); // connection failure is expected; avoid an unhandled rejection
```
That comment is a tell that this is a known, reproduced defect, not a hypothetical — it was patched over in the test file instead of in `dev-host-client.ts`, so every other consumer of this client remains exposed.

**Fix:** Attach a permanent internal no-op handler to silence Node's unhandled-rejection detector while still returning the same promise object for external callers to await/catch (Node marks a promise "handled" once any handler is attached to it, regardless of how many):
```ts
const opened = new Promise<void>((resolve, reject) => { /* ... */ });
opened.catch(() => {}); // prevent an unhandled-rejection crash for callers who rely on send()'s guard instead of awaiting `opened`
return { opened, /* ... */ };
```

## Warnings

### WR-01: `getState()`/`getLobby()`/`serverRequest()` responses are cast with `as` from `unknown` fields with no runtime validation

**File:** `src/client/dev-host-client.ts:191-210`
**Issue:** `msg.isComplete as boolean`, `msg.winners as number[]`, `msg.phase as 'lobby' | 'playing'`, `msg.seats as DevHostSeatInfo[]`, and `msg.result as Record<string, unknown>` all trust the wire payload's shape purely via TypeScript type assertions, with no runtime guard. A malformed or version-skewed host response (e.g., an older dev-host build lacking a field, or a manual test hitting the wire directly) would silently produce `undefined`/garbage values typed as if they were valid, rather than a clear parse/validation error. This is consistent with the codebase's existing looseness in `game-connection.ts`'s `handleMessage` (also uses bare `as` casts), so it's not a new pattern, but it compounds the correlation gaps above: a malformed error-shaped response could resolve as if it were a valid `getState` reply.
**Fix:** Not blocking for this phase (matches existing project convention), but worth a follow-up: at minimum, guard `msg.type === 'game_state'` / `msg.type === 'lobby'` before assuming the corresponding fields exist, rather than assuming any non-`'error'` message is the expected reply shape.

### WR-02: `requestWithId`'s timeout rejection path does not distinguish "host reported error but we couldn't correlate it" from "host truly never replied"

**File:** `src/client/dev-host-client.ts:150-158`
**Issue:** This is the visible symptom of CR-01: because uncorrelated `error` messages are silently dropped, every guard-clause failure surfaces to the caller as a generic timeout message ("timed out after Nms waiting for a dev host response") rather than the specific, actionable error the host actually sent ("Game has not started.", "You are not seated in this game."). This directly conflicts with the CLAUDE.md house rule "Error messages should be actionable."
**Fix:** Resolved by fixing CR-01 (once errors carry `requestId`, this path is naturally bypassed for those cases). No separate client-side fix needed beyond CR-01.

## Info

### IN-01: `DevHostClientOptions.requestTimeoutMs` default of 10000ms is a magic number duplicated from `GameConnection`'s unrelated 10-second action timeout

**File:** `src/client/dev-host-client.ts:97` (`opts.requestTimeoutMs ?? 10000`), compare `src/client/game-connection.ts:153` (`}, 10000);` for actions) and `game-connection.ts:395` (pong timeout, also `10000`)
**Issue:** Three independent 10000ms literals across the two files with no shared named constant. Not a bug — each is a legitimately independent timeout for a different protocol — but the duplication makes intent ("why 10 seconds, and are these meant to stay in sync?") ambiguous to a future reader.
**Fix:** Optional: extract a shared `const DEFAULT_REQUEST_TIMEOUT_MS = 10_000` per file (or one shared constant if the three are meant to represent "the same design choice"), primarily as a documentation aid.

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
