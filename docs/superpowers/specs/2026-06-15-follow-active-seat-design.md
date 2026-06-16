# Follow Active Seat (dev-host) — Design

**Date:** 2026-06-15
**Status:** Approved design, pending implementation plan
**Module(s):** `cli` (dev-host), `types` (protocol)

## Problem

When testing a game on the dev server, automation (AI bots) plays the open
seats. A human or browser-automation **agent** can already `join` a specific
seat and take it from the AI — but a game's *active* seat changes every turn.
To drive a full game solo, the agent would have to claim each seat in turn.

There is no way to control **whichever seat is currently awaiting input**
without manually re-joining. This feature adds that.

## Goal

A runtime toggle ("follow active seat"). When a client (the **follower**)
enables it, that one client controls whichever seat the flow is currently
awaiting input from, turn after turn, and AI is paused. A browser-automation
agent flips it on once and then drives the entire game as a single client.

Non-goals:
- No CLI startup flag (runtime control only).
- No change to engine/session action-attribution semantics.
- Not a production/lobby feature — dev-host only.

## Key architecture facts (verified in code)

- **Active seat is computable**: `dueSeats(flowState)` in
  `src/engine/flow/seat-activity.ts` returns the seat numbers awaiting input
  (sequential → `[currentPlayer]`; simultaneous → incomplete `awaitingPlayers`
  with available actions). The AI pump already uses it via `selectDueAISeat`.
- **Seat authority is single-point**: `MultiplayerHost.handleServerRequest`
  (`src/cli/dev-host/multiplayer-host.ts`) resolves `clientId → seat` from the
  `clientSeat` map *before* delegating to the session;
  `bridge.ts#translateOp` bakes `player: seat` into the action op. Overriding
  the follower's seat is a one-line substitution at this chokepoint.
- **AI pump reads a shared array**: `MultiplayerHost.aiSeats` is shared by
  reference with the session's AI pump (`SnapshotSessionHost.runAITurns`).
  Mutating it in place pauses/resumes AI.
- **Per-seat views already exist**: `session.viewForSeat(seat)` and
  `reinitSeat(clientId, seat)` (sends `init` + `game_state`) produce the
  correct fog-of-war view for any seat.

## Design — override, don't reassign

The follower keeps its own seat (e.g. auto-seated as seat 1). Follow-mode
**overrides what that client sees and how its actions are attributed** — it
never moves the client between seats, so the `seats`/`clientSeat` maps don't
churn each turn.

### State added to `MultiplayerHost`

- `followerClientId: string | null` — single owner. A second client enabling
  follow takes over (the previous follower is notified via the echoed state).
- `lastFollowerSeat: number | null` — last active seat shown to the follower,
  so we only re-`init` when the active seat actually changes.

### `effectiveActiveSeat(): number`

```
const due = session.activeSeats();         // dueSeats(flowState)
return due[0] ?? clientSeat.get(followerClientId);  // fall back to own seat
```

The follower steals **every** active seat unconditionally (no deferral to
other connected humans — agent-testing is effectively solo). Fallback to the
follower's own seat covers execute blocks and game-over (nothing due).

### Three hook points (all in `MultiplayerHost`)

1. **Action attribution** — in `handleServerRequest`: if
   `clientId === followerClientId`, use `effectiveActiveSeat()` instead of
   `clientSeat.get(clientId)`. (A follower is always "seated enough" to act,
   even if `dueSeats` is empty it falls back to its own seat.)

2. **View routing** — in the `postGameState(seat, view, meta)` callback
   (fired per-seat in the broadcast loop). When the target seat's client is
   the follower: compute `active = effectiveActiveSeat()`; if
   `active !== lastFollowerSeat`, send `{ type: 'init', seat: active }` and set
   `lastFollowerSeat = active`; then send `game_state` with
   `viewForSeat(active)` (ignoring the passed-in own-seat `view`). Because the
   follower occupies exactly one seat, only that seat's iteration sends to it;
   other (AI/open) seats route to no client.

3. **AI suppression** — enabling clears `aiSeats` in place (pump goes quiet);
   disabling rebuilds `aiSeats` from currently-open seats and calls
   `session.resumeAI()` to re-kick the pump.

### Enable / disable handlers

**Precondition**: follow can only be enabled by a client that currently holds a
seat (`clientSeat.has(clientId)`). A spectator request is rejected with an
actionable `error` ("Take a seat before enabling follow-active-seat."). This
guarantees the view-routing hook (which fires per occupied seat) and the
attribution fallback always have a real seat to anchor on. In practice the
dev-host auto-seats the first client, so the agent already satisfies this.

- **Enable** `{ type: 'follow', enabled: true }`: set `followerClientId`,
  clear `aiSeats`, reset `lastFollowerSeat = null`, immediately push
  `init` + `game_state` for the current active seat to the follower, echo
  `{ type: 'follow', enabled: true, seat: activeSeat }`.
- **Disable** `{ type: 'follow', enabled: false }`: clear `followerClientId`,
  rebuild `aiSeats` from open seats, `resumeAI()`, re-`init` the (ex-)follower
  to its own seat, echo `{ type: 'follow', enabled: false, seat: ownSeat }`.

### No new session accessors needed

The host computes the active seat from `session.host.flowState` — a public field
on `SnapshotSessionHost` that `apply()` sets *before* each broadcast, so it
already reflects the post-op state during the `postGameState` callback. AI is
resumed with the existing `session.host.runAITurns()` (already used by the host
on seat-leave and game start). So this feature touches only `multiplayer-host.ts`
plus the DevHost UI — `bridge.ts` is unchanged.

## Control surface (both button + WS op)

- **WS op**: add `{ type: 'follow'; enabled: boolean }` to `ClientInbound` and
  `{ type: 'follow'; enabled: boolean; seat: number }` to `HostOutbound` —
  these live in `src/cli/dev-host/multiplayer-host.ts` (the dev-host WS protocol
  is defined there, not in `src/types/protocol.ts`). Handled in
  `MultiplayerHost.handleMessage`.
- **Button**: a "Follow active seat" toggle in the DevHost host-chrome toolbar
  (`src/cli/dev-host/DevHost.vue`). Sends the WS op; reflects the echoed state.
  A browser-automation agent can click it or send the op via `javascript_tool`.

**Parity**: the toggle is dev-host chrome, not a game action, so the
"custom UI + action panel parity" rule does not apply to it. The *effect* —
actions for the borrowed seat — flows through the existing
`server_request → action` path, which already behaves identically in custom UI
and action panel. Parity is preserved by reuse.

## Edge cases

- **Follower disconnects** (socket close / `leave`): auto-disable follow,
  rebuild `aiSeats`, `resumeAI()` — never leave the game stuck on a gone client.
- **Game over / execute blocks**: `activeSeats()` empty → follower sees
  own-seat/final state; toggle still functions.
- **Restart**: resets follow-mode (fresh game = clean slate). The host clears
  the follower and echoes `{ follow, enabled: false }` so the toolbar untoggles;
  the agent re-enables it if it wants to drive the new game. Simpler and
  less error-prone than re-pausing AI mid-(re)start.
- **Simultaneous-action steps** (`dueSeats` returns multiple): follower acts
  for the first due seat; it completes; the next becomes effective. Multiple
  `init` flips, correct result.

## Testing

- **Integration test** at the `MultiplayerHost` ↔ session boundary
  (two-player game, single client):
  - Enable follow while the AI seat is active → follower receives an `init`
    for that seat plus its `viewForSeat`.
  - An action submitted by the follower is attributed to the active seat and
    advances the flow.
  - AI makes no move while follow is enabled.
  - Disabling resumes AI (the open seat gets played by the bot again).
  - Follower disconnect auto-disables and resumes AI.
- **Unit test**: `activeSeats()` returns the expected due seats for sequential
  vs. simultaneous flow states (asserts the host's source of truth).

## Files touched

- `src/cli/dev-host/multiplayer-host.ts` — `ClientInbound` / `HostOutbound`
  `follow` messages (the dev-host protocol lives here), follower state, three
  hook points, enable/disable/disconnect handling.
- `src/cli/dev-host/bridge.ts` — `activeSeats()` + `resumeAI()` accessors.
- `src/cli/dev-host/DevHost.vue` — toolbar toggle + echoed-state reflection.
- Tests as above.
