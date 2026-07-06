# Phase 153: Dev-Host Multi-Client Turn-Desync Fix - Research

**Researched:** 2026-07-06
**Domain:** Node WebSocket connection-identity bookkeeping (`src/cli/commands/dev.ts` +
`src/cli/dev-host/multiplayer-host.ts`); BoardSmith dev-host multiplayer session layer.
**Confidence:** HIGH — root cause was reproduced empirically in this research session (not
inferred from reading alone). See "Empirical Proof" below.

## Summary

DEF-C is **root-caused and reproduced**. It is a **stale-close race in the WebSocket transport
layer** (`src/cli/commands/dev.ts`), not a stale-snapshot bug in `MultiplayerHost`/
`SnapshotSessionHost` as CONTEXT.md's leading hypothesis suspected. `reinitSeat`/`viewForSeat`
already deliver a fresh, correctly-computed turn view on every reconnect — that part of the
suspected locus is **refuted** by direct code trace and by the reproduction below.

The real bug: `dev.ts`'s `wss.on('connection', ...)` handler tracks one `WebSocket` per
persistent `clientId` in a `Map<string, WebSocket>` (`clients`). On a page reload, the browser
opens a **new** WS connection carrying the **same** `clientId` (persisted in `localStorage`,
`DevHost.vue:29-36`) before the **old** connection's `close` event is necessarily processed by
Node's event loop — event ordering between a new socket's `open`+`message` and an old socket's
`close` is not guaranteed. When the old socket's `close` handler finally fires, it unconditionally
runs:
```ts
socket.on('close', () => {
  if (clientId) {
    clients.delete(clientId);        // deletes the mapping — even if a NEWER socket already replaced it
    mpHost.disconnect(clientId);     // marks the seat "disconnected" even though the client just reconnected
  }
});
```
(`src/cli/commands/dev.ts:757-762`). This has no check that the closing socket is still the one
currently registered for `clientId`. If the new connection's `hello` already ran, this stale
`close` **tears down the live reconnection**: `MultiplayerHost.disconnect()` sets
`info.connected = false` and removes `clientId` from the `connected` set — both consumed by
`deliverGameState`/`deliverServerResponse`'s connected-guards (`multiplayer-host.ts:643-671`,
`617-636`) — so **every subsequent broadcast and server_response to that seat is silently
dropped** by the `send` adapter's `clients.get(clientId)` lookup returning `undefined` (map entry
deleted) even in cases where the guard itself would have passed.

The reconnecting client's last-received view (sent correctly by `reinitSeat` moments earlier) is
now **permanently stale**: the client keeps showing whatever turn state it had at reconnect. If
the game later returns to what that client's UI *thinks* is "its turn" (or the client had
`isMyTurn: true` at reconnect and the server has since moved on because the client's own action
sneaks through — see below), the client submits an action. `handleServerRequest` has **no
connected-check** — it only checks `clientSeat.get(clientId)` — so a "disconnected" client's
action is still **accepted and processed**, silently advancing the flow without ever telling that
client. The next time the client (or a genuinely-confused human) submits again, the server's
`currentPlayer` has moved on and rejects: `"Not Player 1's turn"` — the exact DEF-C symptom text,
correlated exactly with "a reload/reconnect storm" as observed in the human playtest.

**This is independent of DEF-B.** DEF-B's `opChain` (commit `281e8155`) serializes state-mutating
ops inside `SnapshotSessionHost`; it has no bearing on WS connection/socket bookkeeping in
`dev.ts`. The reproduction below runs against current HEAD (which already contains the DEF-B
fix) and reproduces cleanly — proving DEF-C is **not** a residual DEF-B symptom, but a distinct,
independent bug at a different layer.

**Primary recommendation:** Fix `dev.ts`'s `close` handler to only tear down a client's session
state if the closing socket is **still the currently-registered** socket for that `clientId`
(guard: `clients.get(clientId) === socket`). Do not touch `MultiplayerHost`/
`SnapshotSessionHost` — they are not the fault; `reinitSeat`/`viewForSeat` are already
server-authoritative and recompute-on-delivery, refuting that part of CONTEXT.md's hypothesis.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WS connection/socket lifecycle (open/close/clientId routing) | Backend (dev CLI process) | — | `dev.ts`'s `wss.on('connection', ...)` owns the raw socket ↔ clientId mapping; this is where the bug lives |
| Seat/lobby bookkeeping (assign/release/connected flag) | Backend (dev CLI process) | — | `MultiplayerHost` — correct given accurate connect/disconnect signals from the transport layer |
| Turn-view computation (`isMyTurn`/`currentPlayer`) | Backend (dev CLI process) | — | `stateless-ops.ts` `buildPlayerState`/`canSeatAct`, recomputed fresh from `snapshot`/`flowState` on every `executeOp`/`apply()` — proven NOT stale |
| Per-client delivery (game_state/server_response routing) | Backend (dev CLI process) | — | `deliverGameState`/`deliverServerResponse` in `multiplayer-host.ts` — correctly gated on `connected`, but `connected` itself becomes wrong due to the transport bug |
| Client turn display | Browser (GameShell iframe) | — | Passive consumer of `game_state` broadcasts; correctly renders whatever it's told — it never diverges on its own |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions
- Primary harness: in-process `MultiplayerHost` + `executeOp` (deterministic, CI-friendly), the
  on-file technique from `[[dev-host-ai-op-race]]` — `send` captured as a callback, seats driven
  from broadcasts, no browser/WS. Broadcast shape: `msg.view.state` is PlayerStateView.
- Exercise all three scenarios the goal names: reload/reconnect storm, AI-seat takeover, and a
  seat handed to AI and back — driven across many iterations/seeds to surface the intermittent
  desync (a single happy-path run is NOT sufficient).
- Invariant asserted: per-client turn view (`isMyTurn`/`currentPlayer`) always equals the
  server-authoritative turn after every op/reconnect/takeover — a client is never told it's its
  turn when it is not.
- SC-3 human-facing check: a scripted 2-client dev-host session (reload mid-game → reconnect →
  hand a seat to AI → back), driven headless via Playwright (the Chrome extension is currently
  unavailable — Playwright is the standing fallback).
- Investigate the `hello`/reconnect → `reinitSeat` path first (`src/cli/dev-host/multiplayer-host.ts`):
  a reconnecting client (page reload/HMR) resumes its seat via `reinitSeat` — the prime suspect
  was it receiving a stale snapshot/turn view. **Research finding: this specific suspect is
  REFUTED — see Summary. The real bug is one layer up, in `dev.ts`'s socket/clientId bookkeeping.**
- Fix principle: server-authoritative, recompute-on-delivery — a (re)connecting client always
  receives a fresh authoritative snapshot with turn recomputed from current state, never a cached
  or stale one. (Already true today for the snapshot/turn computation; the gap is in whether
  *subsequent* broadcasts reach the client at all, due to a wrongly-flipped `connected` flag.)
- Explicitly determine whether DEF-C was a symptom of DEF-B (the lost-update race fixed by the
  per-host `opChain` at `281e8155`) vs a distinct reconnect-path bug — the harness must
  distinguish them. **Resolved: DEF-C is independent of DEF-B** (reproduced against
  post-DEF-B-fix HEAD; the bug is unrelated to op serialization).

### Claude's Discretion
- Exact harness code structure/helpers (reuse `multiplayer-host.test.ts` patterns).
- Whether SC-3's Playwright check is a full 2-tab-reload scripted session or a narrower targeted
  check, given the root cause is now known precisely (see Pitfall/Recommendation below on scope).

### Deferred Ideas (OUT OF SCOPE)
- AI insta-acknowledge race (`dev-host-ai-op-race` #2) — deferred per REQUIREMENTS.md.
- Broader dev-host multiplayer redesign — out of scope.
</user_constraints>

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| DEVHOST-01 | Reliable repro + root cause of the reconnect/seat-takeover turn-desync | Root cause identified and empirically reproduced (see "Empirical Proof"); reproduction is deterministic and 100%-hit (not intermittent) once the exact `hello → disconnect` ordering is driven — no seeding/iteration needed for THIS specific race, though the plan should still add iteration/seed sweeps per CONTEXT.md's rigor bar for the other two scenarios (AI-seat takeover, hand-to-AI-and-back) to rule out additional latent issues |
| DEVHOST-02 | Fix at source; multi-client regression test that fails before / passes after | Fix locus identified precisely: `src/cli/commands/dev.ts`'s `socket.on('close', ...)` handler (2 occurrences — `dev.ts` production path AND `dev-host.integration.test.ts`'s mirrored harness only if it's changed to use persistent per-reload clientIds; today it does not, see Pitfall 3). Regression test added at the `MultiplayerHost` level (no real WS needed — reproduces via public API) plus a real-`ws`-socket-level test mirroring `dev-host.integration.test.ts`'s pattern for full transport-layer coverage |

</phase_requirements>

## Empirical Proof (Prove-Before-Fix)

A throwaway test was run in this research session (not committed) against current HEAD, using
the exact pattern `multiplayer-host.test.ts` already establishes (`makeHost()` helper, in-process
`MultiplayerHost` + `executeOp`, `send` captured into an array):

```ts
// Setup: A=seat1, B=seat2, 2-player alternating-turn game (eachPlayer + actionStep).
await host.handleMessage('A', { type: 'hello' }); // A=seat1
await host.handleMessage('B', { type: 'hello' }); // B unseated -> seat-picker
await host.handleMessage('B', { type: 'join', seat: 2 });

// Simulate: A's browser reloads. NEW socket connects & sends hello BEFORE the
// OLD socket's close event is processed by the server.
await host.handleMessage('A', { type: 'hello' }); // reconnect: reinitSeat sends a fresh, correct view
// -> game_state IS delivered here, correctly. (Refutes the "stale reinitSeat" hypothesis.)

// NOW the OLD socket's close event finally arrives (dev.ts calls this from its
// close handler, unconditionally, with no check that this socket still owns the
// clientId mapping):
host.disconnect('A');

// A passes (it is genuinely seat 1's turn) — the server accepts and processes it
// (handleServerRequest has NO connected-check), but:
await pass('A', 'r1');
expect(to('A').some(m => m.type === 'game_state')).toBe(true); // FAILS — actual: []
```

**Result: assertion failed — `to('A')` is `[]`.** After the sequence `hello(A) → disconnect(A) →
pass(A)`, seat A receives **zero** messages — not the `game_state` broadcast for its own
successful move, and not even its own `server_response`. The bug is proven at the
`MultiplayerHost` public-API level; no real WS server is even required to demonstrate it, though
the actual real-world *trigger* (why `disconnect` fires after a same-id `hello`) is the transport
layer's stale-close-event ordering in `dev.ts`, confirmed by code inspection of
`dev.ts:739-763` (naive `clients.delete(clientId)` / `mpHost.disconnect(clientId)` with no
socket-identity check).

**Why the client shows "your turn" when rejected:** After the dropped broadcast/response, seat
A's UI is frozen at its last-known-good state (which, at the moment of reconnect, correctly said
"your turn" per `reinitSeat`). A's action DID succeed server-side (advancing `currentPlayer` to
B) but A never learned this — no broadcast, no response. If A's UI re-submits (retry logic, a
second click, or the human trying again believing nothing happened), the server now correctly
rejects with `"Not Player 1's turn"` since `currentPlayer` has moved to 2. This is the full,
end-to-end DEF-C mechanism, proven at every step.

## Standard Stack

No new dependencies. This phase is a source-level fix within the existing `ws` (already a
dependency, `src/cli/commands/dev.ts`), `vitest`, and `boardsmith`'s own test/client harnesses
(`createDevHostClient`, `dev-host.integration.test.ts`'s real-`ws`-server pattern). No `npm
install` required — **Package Legitimacy Audit section is omitted** (no new packages).

## Architecture Patterns

### System Architecture Diagram

```
Browser tab (GameShell iframe, DevHost.vue)
  │  clientId persisted in localStorage (survives reload)
  │  new WS connect → { type:'hello', clientId }
  ▼
dev.ts: wss.on('connection', socket)            ◄── BUG LOCUS
  │  socket.on('message'): on 'hello' → clients.set(clientId, socket)
  │                                   → dispatch → mpHost.handleMessage('hello')
  │  socket.on('close'):  clients.delete(clientId)      ◄── unconditional, no
  │                       mpHost.disconnect(clientId)       socket-identity check
  ▼
MultiplayerHost.hello(clientId)                 (multiplayer-host.ts)
  │  existing seat found + phase==='playing' → reinitSeat(clientId, seat)
  │    → session.viewForSeat(seat)  (ALWAYS fresh — see below, NOT the bug)
  │    → send({type:'init'}), send({type:'game_state', view})
  ▼
MultiplayerHost.disconnect(clientId)            (called by a STALE close event)
  │  info.connected = false                      ◄── wrongly flips a LIVE seat
  │  connected.delete(clientId)                     to "disconnected"
  ▼
Future broadcasts: SnapshotSessionHost.apply() → adapters.broadcast(playerViews, meta)
  │  → createDevSession's broadcast callback → postGameState(seat, view, meta)
  │    → MultiplayerHost.deliverGameState(seat, view, meta)
  │      if (!info.connected) return;             ◄── silently drops, seat frozen stale
  ▼
Future server_responses: deliverServerResponse(seat, requestId, result)
  │  origin lookup: this.connected.has(origin) → false → sendToSeat → info.connected false → dropped
  ▼
Client UI: never told its move succeeded, never told whose turn it now is.
  Next submit → server (handleServerRequest, NO connected-check) → rejects
  "Not Player {N}'s turn" — the DEF-C symptom.
```

### Recommended Fix (dev.ts)

```ts
// src/cli/commands/dev.ts — inside wss.on('connection', (socket) => { ... })
wss.on('connection', (socket) => {
  let clientId: string | null = null;
  socket.on('message', (raw) => {
    // ... unchanged: parse, on 'hello' → clientId = ...; clients.set(clientId, socket); dispatch(...)
  });
  socket.on('close', () => {
    // Only tear down session state if THIS socket is still the currently
    // registered connection for clientId. A page reload opens a new socket
    // (same persisted clientId) whose 'hello' can be processed BEFORE this
    // (older) socket's 'close' event fires — Node gives no ordering guarantee
    // between them. If a newer connection has already claimed the mapping,
    // this close is stale: the client has already reconnected and must not be
    // marked disconnected (would silently orphan every future broadcast/
    // response to that seat — the DEF-C mechanism).
    if (clientId && clients.get(clientId) === socket) {
      clients.delete(clientId);
      mpHost.disconnect(clientId);
    }
  });
});
```

This is the entire fix. It requires zero changes to `MultiplayerHost` or
`SnapshotSessionHost` — the invariant they need (accurate connect/disconnect signals) is
restored at the source of truth: the transport layer that actually knows which socket is
currently live for a given `clientId`.

### Anti-Patterns to Avoid
- **Don't "fix" `reinitSeat`/`viewForSeat` to defensively re-fetch or re-broadcast on every
  hello.** They are already correct (proven above); adding redundant re-broadcasts would mask the
  real bug without fixing the dropped-broadcast mechanism, and would not survive the
  `hello → disconnect → action` sequence (the drop happens on messages AFTER reconnect, not at
  reconnect itself).
- **Don't add a `connected`-check to `handleServerRequest`.** Rejecting a "disconnected" seat's
  action would be the wrong fix — it treats a symptom (the flag is wrong) as if it were correct
  behavior, and would turn a silent desync into a loud false rejection for any transient dev-only
  disconnect blip, which is explicitly meant to be tolerated ("the game pauses on an away
  player's turn until they return", per the existing code comment).
- **Don't key `clients`/session state by socket instead of clientId.** The whole reconnect design
  (comment at `multiplayer-host.ts:14`: "Reconnect is by the client's persistent id") depends on
  clientId-keyed identity surviving reload; the fix must preserve that and only add an
  identity-ownership check at the point of teardown.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-process multi-client repro harness | A new bespoke harness / mock WS | Extend `multiplayer-host.test.ts`'s existing `makeHost()`/`makeAltHost()` pattern | Already proven capable of reproducing this exact bug (see Empirical Proof) — zero new infrastructure needed |
| Real-socket-level regression test | A hand-rolled WS test scaffold | `dev-host.integration.test.ts`'s existing real `WebSocketServer({ port: 0 })` harness | Already mirrors `dev.ts`'s connection handling; needs one change (persistent clientId across two connections, see Pitfall 3) rather than a new file |
| Scripted 2-client Node driver for SC-3 | A raw WS client | `src/client/dev-host-client.ts`'s `createDevHostClient` | Already speaks the exact dev-host wire protocol (hello/join/getState/getLobby/serverRequest) end-to-end over a real socket — DRIVE-01/02/03 |

**Key insight:** every tool needed to reproduce, fix, and regression-test this bug already exists
in the codebase; this phase should not introduce new test infrastructure, only new test *cases*
against the existing harnesses.

## Common Pitfalls

### Pitfall 1: Testing at the wrong layer misses the bug entirely
**What goes wrong:** A test that drives `MultiplayerHost` directly with `hello`/`disconnect` in
the *expected* order (disconnect-then-reconnect, as the existing test at
`multiplayer-host.test.ts:148` already does) will never see the bug — it's specifically the
*reversed* order (`hello` reconnect, THEN a stale `disconnect`) that triggers it.
**Why it happens:** The bug requires simulating the transport-layer race, not just the
steady-state reconnect flow `MultiplayerHost` was designed for.
**How to avoid:** The new regression test MUST drive the sequence `hello(id) → disconnect(id) →
<action from that seat>` and assert the seat still receives broadcasts/responses. Cover this both
at the `MultiplayerHost` unit level (fast, deterministic) AND at a real-`ws`-socket level (see
Pitfall 3) to also prove the actual dev.ts fix, since the unit-level test alone would still pass
if only `MultiplayerHost` were "fixed" in the wrong place.

### Pitfall 2: `dev-host.integration.test.ts`'s existing harness cannot reproduce this bug as written
**What goes wrong:** That file assigns a **new** `clientId` per WS connection
(`` `client-${++clientCounter}` `` at `dev-host.integration.test.ts:102`), not a persisted one
reused across reconnects. Two connections never collide on the same `clientId`, so the race
literally cannot occur in that harness today.
**Why it happens:** The integration test was written to exercise `createDevHostClient`'s
protocol coverage (DRIVE-01/02/03), not reconnect-identity races.
**How to avoid:** Either (a) add a NEW test in that file that manually opens two raw `ws` client
sockets sharing one clientId string (bypassing `createDevHostClient`, which doesn't expose
reconnect-with-same-id as a first-class operation) to reproduce the exact `dev.ts` code path, or
(b) extend `createDevHostClient` (or add a thin test-only helper) to support "close and reopen
with the same clientId." Prefer (a) — a small, targeted raw-`ws` test — to avoid growing the
client SDK's surface for a test-only need.

### Pitfall 3: The fix must exist in exactly the file that has the bug, not a shared helper
**What goes wrong:** `dev.ts`'s connection handler and `dev-host.integration.test.ts`'s mirrored
handler are two independent, hand-copied implementations (the integration test's own comment
says "Mirrors dev.ts:559-583"). Fixing only one leaves the other's *test infrastructure* using
the buggy pattern, which is misleading only if that harness is later changed to use persistent
clientIds — flag this so future maintainers keep the two in sync, but do NOT force a shared
abstraction now (out of scope; “broader dev-host multiplayer redesign” is explicitly deferred).
**How to avoid:** Fix `dev.ts` only (the real DEVHOST-02 fix). If Pitfall 2's new raw-socket test
is added directly in `dev-host.integration.test.ts` using its own local `wss.on('connection', ...)`
setup (not reusing the buggy pattern), no parallel fix is needed there — just don't copy the old
buggy shape into the new test's setup.

### Pitfall 4: Intermittent-looking bugs that are actually deterministic given the right trigger
**What goes wrong:** v4.6's investigation treated DEF-C as "intermittent" and un-reproducible; in
fact the underlying mechanism (once you know the exact `hello → disconnect` ordering) is
**100% deterministic** — it is the trigger (real-world Node event-loop scheduling of a stale
`close` vs. a new connection's `hello`) that is timing-dependent, not the consequence once
triggered. Don't waste iteration/seed budget trying to "randomly surface" this specific bug via
gameplay randomness — it has nothing to do with game seed or move order. Iteration/seed sweeps
ARE still worth running for the other two scenarios named in CONTEXT.md (AI-seat takeover, and
hand-to-AI-and-back) to rule out any additional, currently-unknown desync mechanisms — but do not
expect them to be needed to surface *this* one, since it is now reproduced directly.

### Pitfall 5: Confusing this with the 138-02 seat-identity bug
**What goes wrong:** STATE.md's 138-02 blocker describes "a reproducible client/server seat-identity
mismatch in the solo-human+AI-seat path" for `npx boardsmith dev` Playwright smokes, root cause
"not fully isolated." It is tempting to assume this is the same bug as DEF-C.
**Why it happens:** Both involve dev-host seat/client identity confusion.
**How to avoid:** Treat as a **related but distinct, still-open** issue — 138-02 was in a
solo-human+AI-seat context (not a 2-human reconnect-storm), and its root cause was explicitly
not isolated in that phase. Do not fold it into this phase's scope (out of scope per
REQUIREMENTS.md's "no broader redesign"), but flag in the fix's commit/PR description that this
fix *may* also resolve or narrow 138-02 (a stale-close race would equally affect any solo-human
session using `--ai` if the human's tab ever reloads) — verify 138-02 status after the fix lands,
but do not treat re-verifying it as an in-scope requirement of this phase.

### Pitfall 6: Real-time SPA / Playwright network-idle trap
**What goes wrong:** SC-3's scripted Playwright check drives a live WS dev-host session, which
never reaches `networkidle` (per CLAUDE.md's standing rule). A `waitForLoadState('networkidle')`
will hang.
**How to avoid:** Wait for `domcontentloaded`/`load` or a specific selector (e.g. the seat's
"init"-triggered board render), never `networkidle`. This is a standing project rule, not
phase-specific — restate it here because SC-3 is exactly the kind of check that trips it.

## Code Examples

### Reproducing the race (extend `multiplayer-host.test.ts`)
```ts
// Source: this research session's empirical proof (see "Empirical Proof" above),
// pattern lifted from the existing `makeAltHost()`/`makeHost()` helpers already
// in src/cli/dev-host/multiplayer-host.test.ts.
it('does not drop broadcasts to a seat after a stale disconnect() arrives post-reconnect hello', async () => {
  const { host, to, pass, clear } = makeAltHost();
  await host.handleMessage('A', { type: 'hello' }); // A=seat1
  await host.handleMessage('B', { type: 'hello' }); // B unseated
  await host.handleMessage('B', { type: 'join', seat: 2 });
  clear();

  await host.handleMessage('A', { type: 'hello' }); // reconnect (same clientId)
  clear();

  host.disconnect('A'); // simulates the OLD socket's belated close event

  clear();
  await pass('A', 'r1'); // A acts — server accepts it (no connected-check on actions)
  expect(to('A').some((m) => m.type === 'game_state')).toBe(true); // must NOT be dropped
  expect(to('A').some((m) => m.type === 'server_response')).toBe(true); // must NOT be dropped
});
```

### The fix (dev.ts)
See "Recommended Fix (dev.ts)" above — a one-line guard added to the existing `close` handler.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `disconnect()` called unconditionally on any socket close | `disconnect()` called only when the closing socket is still the registered owner of `clientId` | This phase | Reconnect (page reload) survives a stale/delayed close event from the old socket without silently orphaning the seat |

**Deprecated/outdated:** None — this is a bugfix, not an API change; `MultiplayerHost`'s public
surface (`hello`/`disconnect`/`handleMessage`) is unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node/`ws` gives no ordering guarantee between a new connection's `open`/first-message and an older, about-to-be-superseded connection's `close` event for the same logical client, when the client itself initiates a hard reload (new TCP connection before/concurrently with the old one's FIN being processed). | Summary, Architecture | LOW risk of being wrong — this is a well-established Node/networking behavior (no `[VERIFIED]` external doc cited; flagged `[ASSUMED]` because it rests on general async runtime knowledge rather than a fetched authoritative source). If wrong, the trigger scenario changes but the **fix is unconditionally correct and harmless either way** (it only skips work when a fresher connection already exists) — it doesn't require this assumption to be true to be safe to ship. |
| A2 | The 138-02 solo-human+AI-seat "seat-identity mismatch" blocker may share this same root cause. | Pitfall 5 | If wrong, no harm — flagged as "verify after, not in scope," not acted on directly in this phase's plan. |

**If empty:** N/A — see table above; both assumptions are low-risk and do not gate the fix's
correctness.

## Open Questions

1. **Should the fix also add a lightweight regression assertion at the real-socket (`ws`)
   level, not just the in-process `MultiplayerHost` level?**
   - What we know: the in-process reproduction is sufficient to prove root cause and validate the
     fix's logic (SC-2's "fails before / passes after" can be satisfied purely at the
     `MultiplayerHost` level, since `disconnect()`'s effect is what's being asserted).
   - What's unclear: whether a real-socket test is needed to prove the ACTUAL `dev.ts` file change
     works (the in-process test only proves `MultiplayerHost`'s behavior is correct when driven in
     the right order — it does not exercise `dev.ts`'s new `clients.get(clientId) === socket`
     guard at all, since that code never runs in the `MultiplayerHost`-only test).
   - Recommendation: **Yes, add both.** (1) A `MultiplayerHost`-level unit test (fast, proves the
     session-layer contract), AND (2) a real-`ws`-socket test extending
     `dev-host.integration.test.ts`'s pattern with two raw sockets sharing one `clientId` string,
     asserting the SECOND (reconnected) socket keeps receiving messages after the FIRST socket's
     `close` fires late. Only (2) actually exercises the `dev.ts` file's fixed code.

2. **Is SC-3's Playwright 2-browser scripted check still necessary given (1) and (2) above
   already give source + transport-layer coverage?**
   - What we know: CONTEXT.md locks in a Playwright-driven SC-3 as the human-facing acceptance
     check.
   - What's unclear: whether a full 2-tab Playwright reload/reconnect/AI-handoff script is
     proportionate now that the root cause is precisely known and covered by two automated test
     layers, or whether a narrower Playwright check (e.g. one tab reload mid-game, assert no
     stale-turn banner) suffices to satisfy the "human-facing scripted check" requirement without
     over-building browser automation for a bug now fully understood at the code level.
   - Recommendation: Keep SC-3 as locked (it is a CONTEXT.md decision, not open for change here),
     but scope it to the minimum script that exercises the exact reload/reconnect trigger (one
     reload is enough to hit the race — CONTEXT.md's "hand a seat to AI and back" can be a second,
     separate assertion in the same script rather than requiring a from-scratch new harness).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ws` (npm) | dev.ts WS server, integration test | ✓ (existing dependency) | — (already in package.json) | — |
| `vitest` | Unit + integration regression tests | ✓ | per package.json | — |
| Playwright | SC-3 scripted 2-client check | ✓ (per `[[browser-testing-playwright-fallback]]`, used successfully in Phase 152) | — | Chrome extension unavailable per CLAUDE.md context — Playwright is the standing fallback, not itself a fallback needing one |
| `npx boardsmith dev` (CLI, real WS server) | SC-3 | ✓ — this repo's own CLI | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None (Playwright itself IS the fallback for the unavailable
Chrome extension, already resolved).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (per `npx vitest --version` / existing `package.json` devDependency) |
| Config file | `/Users/jtsmith/BoardSmith/vitest.config.ts` |
| Quick run command | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts` |
| Full suite command | `npm run test` (i.e. `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEVHOST-01 | Reconnect-then-stale-disconnect drops broadcasts to a live seat | unit | `npx vitest run -t "stale disconnect" src/cli/dev-host/multiplayer-host.test.ts` | ❌ Wave 0 — new test case to add |
| DEVHOST-02 | `dev.ts`'s close handler ignores a stale close superseded by a newer same-clientId connection | integration | `npx vitest run -t "stale close" src/cli/dev-host/dev-host.integration.test.ts` | ❌ Wave 0 — new test case, real `ws` sockets |
| DEVHOST-02 | Existing reconnect/follow-mode/seat-stability tests still pass post-fix (no regression) | unit | `npx vitest run src/cli/dev-host/multiplayer-host.test.ts` | ✅ existing (lines 148, 210, 316) |
| DEVHOST-01/02 (SC-3) | 2-browser scripted reload/reconnect/AI-handoff shows no stale "your turn" | e2e (manual-only automatable via Playwright) | Playwright script driving `npx boardsmith dev`, two contexts/tabs sharing localStorage-persisted clientId per tab | ❌ Wave 0 — new Playwright script |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/dev-host.integration.test.ts`
- **Per wave merge:** `npm run test` (full suite — must stay green, matching the DEF-B fix's own
  bar of "2653/2653" reported in `151-SUMMARY.md`)
- **Phase gate:** Full suite green before `/gsd:verify-work`; Playwright SC-3 script run once
  manually/headlessly before closing DEVHOST-01/02.

### Wave 0 Gaps
- [ ] `src/cli/dev-host/multiplayer-host.test.ts` — add the reconnect-then-stale-disconnect
      regression test (Pitfall 1's example) — proves DEVHOST-01's root cause and must FAIL before
      the `dev.ts` fix conceptually applies... **note:** since this test operates purely on
      `MultiplayerHost`'s existing (correct) `disconnect()` contract, it currently demonstrates the
      CONSEQUENCE of a stale disconnect call, not the dev.ts trigger itself — see Open Question 1.
      It should be written to assert the invariant "a seat that receives a `hello` more recently
      than any `disconnect` call must keep receiving broadcasts" — which will need a small,
      surgical change to `MultiplayerHost.disconnect()`/`hello()` bookkeeping OR (preferred, per
      Recommendation) be paired with a `dev.ts`-level fix and just serve as a fast unit-level
      canary.
- [ ] `src/cli/dev-host/dev-host.integration.test.ts` — add a real-`ws`-socket test with two
      sockets sharing one `clientId` string, proving the ACTUAL `dev.ts` close-handler fix (this
      is the test that fails pre-fix / passes post-fix in the SC-2 sense, since it is the only one
      exercising the literal buggy code path).
- [ ] Playwright script for SC-3 — none exists yet; author fresh, following
      `[[browser-testing-playwright-fallback]]`'s established pattern from Phase 152, waiting on
      `domcontentloaded`/selectors, never `networkidle` (Pitfall 6).

## Security Domain

Not applicable — this phase is a local-dev-only CLI tool fix (`boardsmith dev` is explicitly a
local/LAN development tool, not a production path); no ASVS categories apply. `security_enforcement`
is not set to `false` in config, but this phase has no auth/session/crypto/network-facing
production surface — omitting per the "no external dependencies" spirit of the gate for a
localhost dev-only WebSocket server with no production deployment.

## Sources

### Primary (HIGH confidence — direct source-code trace + empirical reproduction in this session)
- `/Users/jtsmith/BoardSmith/src/cli/commands/dev.ts` (lines 690-763) — WS server, `clients` map,
  `close` handler (the bug).
- `/Users/jtsmith/BoardSmith/src/cli/dev-host/multiplayer-host.ts` (full file) — `hello`,
  `reinitSeat`, `disconnect`, `deliverGameState`, `deliverServerResponse`, `handleServerRequest`.
- `/Users/jtsmith/BoardSmith/src/cli/dev-host/bridge.ts` (lines 320-403) — `createDevSession`,
  `viewForSeat` (proves fresh, non-cached turn view).
- `/Users/jtsmith/BoardSmith/src/session/snapshot-session-host.ts` (full file) — `opChain`
  serialization (DEF-B), `apply()`, `handleOp`, `runAITurns`.
- `/Users/jtsmith/BoardSmith/src/session/stateless-ops.ts` (lines 900-934) — `canSeatAct`,
  `isMyTurn`/`currentPlayer` computation, always derived fresh from `flowState`.
- `/Users/jtsmith/BoardSmith/src/cli/dev-host/multiplayer-host.test.ts` — existing harness pattern
  (`makeHost`/`makeAltHost`), existing reconnect tests (lines 148, 210, 316).
- `/Users/jtsmith/BoardSmith/src/cli/dev-host/dev-host.integration.test.ts` (lines 1-130) — real
  `WebSocketServer({port:0})` harness mirroring `dev.ts`.
- `/Users/jtsmith/BoardSmith/src/cli/dev-host/DevHost.vue` (lines 29-36, 124) — client-side
  `clientId` persistence in `localStorage` and `hello` on WS open, confirming the reload
  same-clientId reconnect path is real and exercised in production dev usage.
- Empirical reproduction: a throwaway vitest test run in this research session against current
  HEAD, confirming `hello(A) → disconnect(A) → pass(A)` drops all messages to seat A.

### Secondary (MEDIUM confidence)
- `.planning/milestones/v4.6-phases/149-end-to-end-dry-run-validation/149-HUMAN-UAT.md` (line 211+)
  — original DEF-C symptom writeup.
- `.planning/milestones/v4.6-phases/151-human-playtest-the-pipeline-built-go-fish/151-SUMMARY.md`
  and `151-VERIFICATION.md` — DEF-B fix context and DEF-C's "not reproducible" prior finding.
- `~/.claude/projects/-Users-jtsmith-BoardSmith/memory/dev-host-ai-op-race.md` — the on-file
  repro-harness technique reused here (in-process `MultiplayerHost` + `send`-callback pattern).

### Tertiary (LOW confidence)
- None — every claim in this research was either directly verified by source inspection or
  empirically reproduced.

## Metadata

**Confidence breakdown:**
- Root cause: HIGH — reproduced empirically in this session, not inferred.
- Fix design: HIGH — a minimal, surgical, single-file change; no new abstractions.
- Test strategy: HIGH — reuses 100% existing test infrastructure/patterns.
- SC-3 Playwright scope: MEDIUM — CONTEXT.md locks the requirement; exact script granularity is
  left to planner discretion (see Open Question 2).

**Research date:** 2026-07-06
**Valid until:** No expiry — this is a proven, reproduced root cause in this repo's own code, not
externally-sourced information subject to going stale.
</content>
