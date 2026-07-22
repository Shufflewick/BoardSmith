# Phase 160: Simultaneous-Step Correctness - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make simultaneous steps (the battery's #2 structural weak point) correct under undo and status
display, closing four defects:
- **D3/SIM-01:** per-seat `completed` is aliased, not checkpointed → simultaneous undo desyncs/hangs.
- **D4/SIM-02:** simultaneous undo is pinned to `currentPlayer` (seat-1) → must work for any awaiting seat.
- **D21/SIM-03:** `simultaneousActionStep` crashes when `awaitingPlayers` is empty but `allDone` is set.
- **D27/SIM-04:** the shell shows a contradictory seat status ("Your move" + "waiting") and leaks a
  commit, deriving status from turn-based (single `currentPlayer`) assumptions.

IN SCOPE: `src/engine/flow/engine.ts` (getState copy, executeSimultaneousActionStep allDone-on-empty),
`src/session/utils.ts` + `src/session/state-history.ts` + `src/session/stateless-ops.ts` (per-seat
simultaneous undo), `src/ui/components/GameShell.vue` + `ActionPanel.vue` (seat status + commit gate),
and net-new tests incl. a reusable simultaneous fixture.

OUT OF SCOPE: the MCTS-side `undoCommands` flow-bookkeeping gap (see backlog `v4.8-MCTS-UNDO`) — the
ENGINE's session undo is fixed here by D3; MCTS's incremental-undo path is separate and re-checked in
Phase 169. Also out: removing per-game simultaneous workarounds (Phase 169).
</domain>

<decisions>
## Implementation Decisions

### D3 — Per-Seat `completed` Checkpointing (the aliasing fix)
- **Deep-copy `awaitingPlayers` in `getState()` (`engine.ts:619`)** so the returned `FlowState` is
  always a value, never a live alias of the private `FlowEngine.awaitingPlayers` array. This fixes the
  footgun for ALL consumers (checkpoints, UI, MCTS) — single source. Copy is a shallow
  `awaitingPlayers.map(p => ({ ...p }))` of a tiny per-seat array; perf is negligible.
- **Root cause (load-bearing):** `completed` lives only on the transient private array (`engine.ts:257`),
  is excluded from `FlowPosition`, and is included by-reference in `ActionCheckpoint.flowState`
  (`snapshot.ts:236`) — then mutated in place by `resumeSimultaneousAction` (`engine.ts:569/584`),
  retroactively overwriting every prior checkpoint's `completed:false`. Restore already defensively
  copies (`restoreFullState` `engine.ts:759-761`), but the loss is at capture, so restore can't recover
  it. Copying at `getState()` is the capture-side fix.
- Add a test that a post-capture `completed` flip does NOT retroactively mutate an earlier checkpoint.
- Audit `getState()` consumers to confirm none RELY on mutating the returned `awaitingPlayers`.

### D4 — Per-Seat Simultaneous Undo Semantics
- A simultaneous undo rewinds **only the requesting seat's own committed action(s) this step** —
  co-deciders' actions are left intact (each seat's simultaneous action is independent).
- **Replace the `currentPlayer` gate with awaiting-aware logic**: in a simultaneous step, allow undo
  for any seat that is in `awaitingPlayers` and has completed an action — not just
  `flowState.currentPlayer`. Sites: `canUndo` (`utils.ts:317`), `undoToTurnStart`
  (`state-history.ts:281`), `handleUndo` (`stateless-ops.ts:467`), and `computeUndoInfo`
  (`utils.ts:174-195`, which bails when `currentPlayer === undefined`).
- **Boundary from the seat's own action in history**, NOT the turn-wide `moveCount` (which assumes
  sequential turns). Compute the rewind point from that specific seat's committed simultaneous action.
- **Phase 155's fences still apply per-seat**: `assertUndoAllowed` (`.notUndoable()` / `finished` /
  `executeBarrierIndex`) is layered on top of the per-seat boundary, never bypassed for simultaneous.

### D21 — allDone on Empty `awaitingPlayers`
- In `executeSimultaneousActionStep`, when `awaitingPlayers` is empty, **consult `allDone` and complete
  cleanly** rather than short-circuiting before the `allDone` check. Today the empty-guard
  (`engine.ts:1534`) runs before the `allDone` evaluation (`:1540`), leaving the frame awaiting with no
  eligible seats → the next `resume` throws at `engine.ts:519-520`. Fix at the source (the step entry),
  not just the crash site.

### D27 — Shell Seat Status + Commit Leak
- **Filter the viewer's own seat out of `awaitingPlayerNames`** (add a `!== playerSeat` filter,
  `GameShell.vue:655-664`) so "Waiting for: …" lists only co-deciders. Show "Your move" only when the
  viewer's own seat is awaiting AND not completed.
- **Gate the execute path on the viewer's own `completed` flag** (`ActionPanel.vue:726` currently only
  checks `!props.isMyTurn`) — a seat that already committed (`completed:true`) cannot re-submit. This
  closes the commit leak.
- **Do NOT derive "It is X's turn" from a single `currentPlayer` when `awaitingPlayers` is non-empty**
  (`currentPlayerName`/`activePlayer` `GameShell.vue:639-683`, ActionPanel `:1157-1159`) — show a
  simultaneous-appropriate status instead.
- Keep it targeted — fix the contradiction + leak; no wholesale status redesign.

### Test & Verification Strategy (PROC-01)
- Create a **net-new reusable `simultaneous-fixture.ts`** under `src/session/testing/fixtures/`
  (none exists — sim games are inline today) driving `simultaneousActionStep` with ≥2 awaiting seats.
- **D3 RED**: capture a turn-start checkpoint, flip a seat's `completed`, undo → assert the checkpoint
  still has `completed:false` (aliasing pre-fix) and the step does not hang.
- **D4 RED**: undo seat-2's simultaneous action (not seat-1) → refused pre-fix, works after; seat-1's
  action untouched.
- **D21 RED**: reach an empty `awaitingPlayers` with `allDone` true → crashes pre-fix, completes after.
- **D27 RED**: component test — during a simultaneous step the viewer's own seat is NOT in the waiting
  list, and a completed seat cannot re-execute.

### Claude's Discretion
- Exact shape of the awaiting-aware undo-eligibility predicate and where the per-seat boundary is
  computed (a helper in `utils.ts` reused by both executors is preferred for parity).
- Whether an explicit `isSimultaneous`/`awaitingPlayers?.length > 0` derivation is added to drive shell
  status, vs inline checks — Claude's call, provided the contradiction and leak are gone.
- How the reusable fixture models per-seat `playerDone`/`allDone`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `simultaneousActionStep` builder (`builders.ts:280-296`); `PlayerAwaitingState {playerIndex,
  availableActions, completed}` (`types.ts:238-260`); `FlowState.awaitingPlayers` (`types.ts:260`).
- Entry `executeSimultaneousActionStep` (`engine.ts:1478-1551`); resume `resumeSimultaneousAction`
  (`engine.ts:501-607`); `getState()` (`engine.ts:619`, returns awaitingPlayers BY REFERENCE — the bug).
- Restore already deep-copies (`restoreFullState` `engine.ts:759-761`) — mirror that copy at capture.
- Phase 155 undo machinery to extend (not bypass): `computeUndoInfo`/`assertUndoAllowed`
  (`session/utils.ts`), executors `state-history.ts:271-359` / `stateless-ops.ts` handleUndo.
- `canSeatAct`/`isPlayersTurn` (`utils.ts:46-47`) is already awaiting-aware — reuse for undo eligibility.

### Established Patterns
- `frame.data` (moveCount/iteration/eligibleSeats/forEachItems) DOES survive the position round-trip
  (`getPosition` `engine.ts:902-931`); `awaitingPlayers` does NOT — it's only in the richer FlowState.
- Shell learns "simultaneous" solely via `flowState.awaitingPlayers?.length > 0` (no `isSimultaneous`
  flag) — `GameShell.vue:422, 648, 657`.
- `availableActions` already checks `!myPlayerState.completed` (`GameShell.vue:426`) — but the
  turn-status/token/waiting strings and the execute guard do NOT; that inconsistency is D27.

### Integration Points
- D21 crash: `engine.ts:519-520` (throw), root cause the empty-guard/allDone ordering at `:1534`/`:1540`.
- D3 aliasing: `engine.ts:619` (getState) + `snapshot.ts:236` (createActionCheckpoint stores by ref).
- D4 pins: `utils.ts:317` (canUndo), `state-history.ts:281`, `stateless-ops.ts:467`, `computeUndoInfo`
  `utils.ts:174-195`.
- D27: `GameShell.vue:655-664` (awaitingPlayerNames, no self-filter), `:639-683` (currentPlayer-derived
  identity), `ActionPanel.vue:726` (execute guard), `:1146-1152` (waiting block).

</code_context>

<specifics>
## Specific Ideas

- D3 hits 2 games (latent→blocker); D4 2 games; D21 OTP; D27 Seven. All at the library/shell layer;
  Phase 169 removes game-side workarounds.
- The Phase 159 scout confirmed the ENGINE undo has the SAME class of gap as MCTS (completed aliased) —
  D3's getState copy fixes the engine/session side. The MCTS `undoCommands` (element-tree-only) path is
  a SEPARATE backlog item (`v4.8-MCTS-UNDO`); note for Phase 169, do not conflate.
- D27's "Your move" + "waiting" contradiction presents to a Seven player as the panel saying act while
  the status says wait — the RED should assert on the rendered contradiction, not internal flags.

</specifics>

<deferred>
## Deferred Ideas

- MCTS `undoCommands` flow-bookkeeping revert (`v4.8-MCTS-UNDO` backlog) — separate mechanism, Phase 169.
- Removing per-game simultaneous workarounds and re-verifying — Phase 169.
- Any explicit `isSimultaneous` flag on FlowState as a broader API addition (beyond what D27 needs).

</deferred>
