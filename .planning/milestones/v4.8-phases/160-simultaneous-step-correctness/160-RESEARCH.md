# Phase 160: Simultaneous-Step Correctness - Research

**Researched:** 2026-07-20
**Confidence:** HIGH (all four defects root-caused via codebase scout)

## Summary

Four defects in the simultaneous-step subsystem. The load-bearing one (D3) is a capture-time aliasing
bug: per-seat `completed` is returned by reference from `getState()` and mutated in place, so it never
truly snapshots. The other three are a crash-ordering bug (D21), a turn-pinned undo gate (D4), and
turn-based shell status (D27).

## D3 / SIM-01 — per-seat `completed` aliasing

- `completed` lives on the private `FlowEngine.awaitingPlayers` array (`engine.ts:257`); excluded from
  `FlowPosition` (`getPosition` `engine.ts:902-931`); included BY REFERENCE in
  `ActionCheckpoint.flowState` via `getState()` (`engine.ts:619`) and stored un-cloned by
  `createActionCheckpoint` (`snapshot.ts:236`).
- `resumeSimultaneousAction` flips `playerState.completed = true` (`engine.ts:569/584`) — mutating the
  same array every checkpoint captured. Restore deep-copies (`engine.ts:759-761`) but the loss is at
  capture. **Fix: deep-copy `awaitingPlayers` in `getState()`** (`.map(p => ({...p}))`).

## D4 / SIM-02 — turn-pinned undo

- `canUndo` (`utils.ts:317`) requires `flowState?.currentPlayer === playerPosition`.
- Executors gate on `currentPlayer`: `state-history.ts:281`, `stateless-ops.ts:467`.
- `computeUndoInfo` (`utils.ts:174-195`) bails when `currentPlayer === undefined` and uses turn-wide
  `moveCount`. In a simultaneous step `currentPlayer` is a single/undefined seat → non-current awaiting
  seats can't undo. **Fix: awaiting-aware eligibility (any seat in `awaitingPlayers` that acted) +
  per-seat boundary from that seat's own history action, not moveCount.** Reuse `canSeatAct`
  (`utils.ts:46-47`, already awaiting-aware). Keep `assertUndoAllowed` fences per-seat.

## D21 / SIM-03 — allDone on empty awaitingPlayers

- `executeSimultaneousActionStep` empty-guard `engine.ts:1534` (`awaitingPlayers.length === 0 → frame
  completed`) runs BEFORE the `allDone` check `:1540`. When entered empty-but-awaiting, a later
  `resume` throws at `engine.ts:519-520` ("No player specified and no awaiting players found"). **Fix:
  consult `allDone` on empty `awaitingPlayers` at the step entry and complete cleanly.**

## D27 / SIM-04 — shell status + commit leak

- `awaitingPlayerNames` (`GameShell.vue:655-664`) includes the viewer's own seat (no `!== playerSeat`).
- Identity from single `currentPlayer` (`:639-683`, ActionPanel `:1157-1159`) → disagrees with the
  awaiting-aware `isMyTurn`.
- Execute guard only `!props.isMyTurn` (`ActionPanel.vue:726`) — no per-seat `completed` check → a
  committed seat can re-submit (commit leak). `availableActions` DOES check `!completed`
  (`GameShell.vue:426`) but the status strings + execute guard don't.
- **Fix:** self-filter the waiting list; gate execute on own `completed`; don't derive turn identity
  from `currentPlayer` during a simultaneous step.

## Pitfalls

- Do NOT bypass Phase 155's `assertUndoAllowed` fences for simultaneous undo — layer per-seat boundary
  on top.
- The MCTS `undoCommands` (element-tree-only) gap is SEPARATE (`v4.8-MCTS-UNDO` backlog) — D3's getState
  copy fixes the ENGINE/session path, not MCTS's incremental undo. Don't conflate.
- `getState()` is called frequently — confirm no consumer mutates the returned `awaitingPlayers` (the
  copy makes such mutation a silent no-op, which is the desired safety, but audit for surprise).

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| SIM-01 | D3 | engine checkpoint | RED: post-capture `completed` flip mutates an earlier checkpoint (aliasing) + simultaneous undo hangs; post-fix checkpoint immutable, undo completes. | new `simultaneous-fixture.ts` + engine/session test |
| SIM-02 | D4 | session undo | RED: undo seat-2's simultaneous action refused pre-fix (currentPlayer pin); post-fix works, seat-1 untouched. Both executors (parity). | session undo test |
| SIM-03 | D21 | engine flow | RED: empty `awaitingPlayers` + `allDone` crashes pre-fix; post-fix completes. | engine flow test |
| SIM-04 | D27 | shell | RED: viewer's own seat appears in "waiting" + a completed seat can re-execute pre-fix; post-fix self-filtered + execute gated on `completed`. | GameShell/ActionPanel component test |
| PROC-01 | — | process | Each: fix at correct layer + RED on pre-fix + adversarial before close. | git RED→GREEN |

### Wave 0 gaps
- No reusable simultaneous fixture exists — net-new.
- No test asserts per-seat `completed` survives a checkpoint — net-new.
- No test drives non-seat-1 simultaneous undo — net-new.
- No shell test asserts the self-filtered waiting list / commit-gate — net-new.
