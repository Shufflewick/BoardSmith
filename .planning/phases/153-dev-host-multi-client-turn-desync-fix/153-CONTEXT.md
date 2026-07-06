# Phase 153: Dev-Host Multi-Client Turn-Desync Fix - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The dev-host multiplayer path (`MultiplayerHost` + `SnapshotSessionHost`) keeps every connected
client's turn view (`isMyTurn`/`currentPlayer`) consistent with the server across reload, reconnect,
and AI-seat takeover — a client is never told it's its turn when it isn't. This is a **prove-before-fix
debugging phase** (CLAUDE.md): reliably reproduce + root-cause DEF-C FIRST (DEVHOST-01), then fix at
source with a multi-client regression test (DEVHOST-02).

DEF-C history (from `v4.6-phases/149-HUMAN-UAT.md` + `151-VERIFICATION.md`): during a 2-browser
human-vs-human replay, Seat 1's action was rejected "Not Player 1's turn" while its own panel showed
its turn; correlated with a reload/reconnect storm. The v4.6 investigation proved the UI pipeline and
broadcasts were correct and **could not reproduce it post-DEF-B-fix** — it became a watch item. The
crux of THIS phase is turning that "didn't reproduce" into a reliable, seeded reproduction (or a
proven invariant — see Acceptance below).

Out of scope (per REQUIREMENTS.md): broader dev-host multiplayer redesign; the AI insta-acknowledge
race (dev-host-ai-op-race #2, separate latent issue).
</domain>

<decisions>
## Implementation Decisions

### Reproduction Methodology (DEVHOST-01)
- Primary harness: **in-process `MultiplayerHost` + `executeOp`** (deterministic, CI-friendly), the
  on-file technique from the [[dev-host-ai-op-race]] memory — `send` captured as a callback, seats
  driven from broadcasts, no browser/WS. Broadcast shape: `msg.view.state` is PlayerStateView.
- Exercise **all three scenarios the goal names**: reload/reconnect storm, AI-seat takeover, and a
  seat handed to AI and back — driven across **many iterations/seeds** to surface the intermittent
  desync (a single happy-path run is NOT sufficient).
- Invariant asserted: **per-client turn view (`isMyTurn`/`currentPlayer`) always equals the
  server-authoritative turn** after every op / reconnect / takeover — a client is never told it's its
  turn when it is not.
- SC-3 human-facing check: a **scripted 2-client dev-host session** (reload mid-game → reconnect →
  hand a seat to AI → back), driven headless via **Playwright** (the Chrome extension is currently
  unavailable — Playwright is the standing fallback).

### Fix Locus & Root-Cause Focus (DEVHOST-02)
- Investigate the **`hello`/reconnect → `reinitSeat` path first** (`src/cli/dev-host/multiplayer-host.ts`):
  a reconnecting client (page reload / HMR) resumes its seat via `reinitSeat` — the prime suspect is
  it receiving a stale snapshot/turn view because server state moved on during the client's absence.
- Fix principle: **server-authoritative, recompute-on-delivery** — a (re)connecting client always
  receives a fresh authoritative snapshot with turn recomputed from current state, never a cached or
  stale one.
- Explicitly **determine whether DEF-C was a symptom of DEF-B** (the lost-update race fixed by the
  per-host `opChain` at `281e8155`) vs a distinct reconnect-path bug — the harness must distinguish
  them (e.g. does the desync only appear if you revert the opChain serialization, or independently?).

### Acceptance if It Won't Reliably Reproduce
- If a **rigorous, seeded, many-iteration harness across all three scenarios** cannot surface any
  turn-view inconsistency AND we can prove *why* (DEF-B's serialization + broadcast-per-move already
  guarantee it), the deliverable becomes an **invariant regression test** that locks the guarantee
  (fails if you revert the serialization / fresh-snapshot behavior) PLUS a documented root-cause
  finding that DEF-C was a DEF-B symptom.
- This outcome is acceptable **only after a genuinely hard reproduction effort** — a real harness that
  WOULD catch the desync if the invariant could break, not a few manual attempts. A weak
  non-reproduction is not acceptable (SC-1 demands reliable repro or a proven invariant with cause).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/dev-host/multiplayer-host.ts` — `MultiplayerHost`; `hello(clientId)` reconnect path,
  `reinitSeat`, `assignSeat`, `clientSeat` map (survives disconnect for reconnect), `followerClientId`.
- `src/session/snapshot-session-host.ts` — `SnapshotSessionHost`; per-host `opChain` serialization
  (DEF-B fix, `281e8155`), `handleOp`/`runAITurns`/`runAITurnsInner`.
- `src/cli/dev-host/multiplayer-host.test.ts`, `dev-host.integration.test.ts`,
  `DevHost.restart.test.ts`, `DevHost.seats.test.ts` — existing dev-host test harnesses to extend.
- `src/session/snapshot-session-host.test.ts` — existing DEF-B serialization / lost-update regression
  tests (no-overlap + human-op-mid-pump); the new turn-view invariant test belongs alongside.

### Established Patterns
- Repro-harness technique ([[dev-host-ai-op-race]]): instantiate `MultiplayerHost` + `executeOp` in
  process, `send` as a callback, drive seat 1 from broadcasts. WS wire (if a WS-level check is added):
  path `ws://localhost:5173/__boardsmith/ws`, client sends `{type:'hello', clientId}` first,
  server_request shape `{type:'server_request', requestId, op, payload}`.
- Instrumentation + guided/seeded reproduction cracked DEF-B/DEF-C intermittency where headless
  happy-path automation could not (per `151-SUMMARY.md`).
- Playwright fallback for browser checks ([[browser-testing-playwright-fallback]]) when the extension
  is down — used successfully in Phase 152.

### Integration Points
- The turn view surfaces via the session's PlayerStateView (`isMyTurn`/`currentPlayer`) — see
  `src/session/build-player-state.*`, `stateless-ops.ts`, `game-session.ts`.
- Historical related note in STATE.md: 138-02 CLI dev-host seat-identity mismatch in the
  solo-human+AI-seat path — relevant prior context, not necessarily the same bug.
</code_context>

<specifics>
## Specific Ideas

- The v4.6 instrumentation approach is explicitly on file to "re-open if it recurs" — this phase IS
  that re-open. Lean on the documented client+host instrumentation (per-seat `currentPlayer`/`isMyTurn`
  in `deliverGameState`) rather than re-deriving it.
- The regression test must genuinely **fail on pre-fix code and pass on post-fix code** (SC-2) — if the
  outcome is the invariant-lock path, the test must fail when the serialization/fresh-snapshot
  guarantee is reverted.
</specifics>

<deferred>
## Deferred Ideas

- AI insta-acknowledge race (dev-host-ai-op-race #2) — deferred per REQUIREMENTS.md.
- Broader dev-host multiplayer redesign — out of scope.
</deferred>
</content>
