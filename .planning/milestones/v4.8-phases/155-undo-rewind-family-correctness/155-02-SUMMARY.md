---
requirements-completed: [UNDO-02, PROC-01]
---

# Plan 155-02 Summary — Durable execute()-Barrier Fence (UNDO-02, PROC-01)

**Plan:** 155-02 (execute — durable `executeBarrierIndex` fence closing the `execute()`
half of UNDO-02, extending Plan 01's shared `assertUndoAllowed` guard)
**Completed:** 2026-07-20
**Result:** PASS — a monotonic `executeBarrierIndex` on `GameRunner`, persisted as a
`GameStateSnapshot` sibling of `actionCheckpoints` and re-adopted/clamped on every
restore, backs a third composable check in `assertUndoAllowed`. Undo and rewind can no
longer silently roll back a committed `execute()` side effect, and the refusal survives
a full snapshot round-trip (the durability defect this plan closes). PROC-01's
RED-before-GREEN and adversarial-bypass gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/session/testing/fixtures/execute-barrier-fixture.ts`
   (single player; `sequence(actionStep(act1), execute(score += 1), actionStep(act2,
   maxMoves: 2), actionStep(idle))`) and `execute-barrier-undo.test.ts`, driving both the
   stateless (`createHeadlessSession`) and stateful (`GameSession`) undo/rewind paths
   against current, unfixed source. Manually traced the pre-fix defect: `FlowState.moveCount`
   is only reported while an action-step config declares `minMoves`/`maxMoves`; once
   `act2`'s two required moves are made, `currentActionConfig` clears and
   `computeUndoInfo` falls back to its same-player backward scan, which has no concept
   of the `execute()` node and walks straight past it. Confirmed by trace: post-undo,
   `game.score` reverted from `1` to `0` and the flow rewound to before `act1` — the
   `execute()` node's committed side effect was silently discarded. Ran and captured the
   real failure (6 of 8 tests fail for that reason; the 2 negative-control tests pass,
   proving the fixture doesn't refuse everything). No production source touched.
2. **Task 2 (GREEN):** `FlowEngine` gains a public monotonic `executeNodeCompletions`
   counter, incremented in `executeExecute` alongside `frame.completed` (kept — still
   load-bearing for flow advancement, just no longer for undo). `GameRunner` gains
   `executeBarrierIndex` (default `0`) and a private `lastSeenExecuteNodeCompletions`
   baseline; `recordExecuteBarrierAdvance()` compares the two and, on an advance, extends
   `executeBarrierIndex` to the current action-history length. `getSnapshot()` emits it;
   `fromSnapshot()` adopts it (`?? 0` for older snapshots — the honest "no barrier
   recorded" reading, not a compat shim) and re-baselines the last-seen counter to the
   freshly-built `FlowEngine`'s own value; `fromCheckpoint()` clamps the adopted barrier
   to `min(persisted barrier, actionIndex)`.
3. **Task 3 (GREEN):** Extended `assertUndoAllowed` (Plan 01) with a third check —
   `turnStartActionIndex < executeBarrierIndex` refuses, naming the committing action
   index. Wired at all four entry points (`stateless-ops.ts`'s `handleUndo` +
   `handleDebugRewind`, `state-history.ts`'s `undoToTurnStart` + `rewindToAction`), each
   passing its reconstructed runner's `executeBarrierIndex`. Extended
   `parity-contract.test.ts` with an execute-barrier block mirroring the existing
   undo-fence block (stateless/stateful agree on refusal + message, plus four
   adversarial bypass attempts). Ran the full suite; fixed two test files whose
   expectations were superseded by the new fence (see Deviations).

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateless) > refuses an undo that would rewind past a completed execute() node
AssertionError: expected true to be false // Object.is equality
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateless) > the execute() side effect survives the refused undo attempt
AssertionError: expected true to be false // Object.is equality
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateless) > debugRewind targeting an index before the barrier is refused
AssertionError: expected true to be false // Object.is equality
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateful) > refuses an undo that would rewind past a completed execute() node
AssertionError: expected true to be false // Object.is equality
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateful) > the execute() side effect survives the refused undo attempt
AssertionError: expected +0 to be 1 // Object.is equality
 FAIL  .../execute-barrier-undo.test.ts > UNDO-02 execute-barrier (stateful) > rewindToAction() targeting an index before the barrier is refused
AssertionError: expected true to be false // Object.is equality

Test Files  1 failed (1)
     Tests  6 failed | 2 passed (8)
```
The 2 passing tests were the negative controls (undo mid `actionStep2`, before crossing
the barrier) — proving the fixture doesn't refuse everything. All 6 failures are the real
defect: undo/rewind SUCCEEDS when it must be refused, and (confirmed by manual trace
before writing the assertions) the `execute()` node's committed `score` increment is
silently discarded along with it. Not a missing-symbol or import error — every failure
is `expected true to be false` / a wrong data value, i.e. wrong runtime behavior.

## PROC-01 verbatim GREEN output (Task 3, after the fix)

```
✓ src/session/testing/execute-barrier-undo.test.ts (8 tests) 15ms
✓ src/session/testing/parity-contract.test.ts (15 tests) 28ms

Test Files  2 passed (2)
     Tests  23 passed (23)
```

## Adversarial verification (Task 3, real attack attempted)

- Hand-crafted raw `{ type: 'undo', player: 1 }` op sent after crossing the barrier,
  without ever reading `state.canUndo` → refused.
- `GameSession.undoToTurnStart(1)` called directly, bypassing any UI layer → refused.
- Hand-crafted raw `{ type: 'debugRewind', actionIndex: 0 }` op targeting an index before
  the barrier → refused.
- `GameSession.rewindToAction(0)` called directly, same crossing → refused.

All four bypass attempts failed to defeat the guard (see `parity-contract.test.ts`,
`describe('execute-barrier adversarial verification (bypassing canUndo)')`).

## Verification

- `npx vitest run src/session/testing/execute-barrier-undo.test.ts src/session/testing/parity-contract.test.ts` — 2/2 files, 23/23 tests pass.
- `npm test` — **192 files / 2744 tests pass**, up from the pre-plan baseline (191/2729);
  zero regressions. `undo-authoritative.test.ts` and `stateful-undo-authoritative.test.ts`
  (Plan 03's `moveCount`-scope territory) remain green, unmodified by this plan.
- Grep gate: `grep -v '^\s*\*' src/runtime/runner.ts | grep -c 'executeBarrierIndex'` → `7` (≥5 required).
- Grep gate: `grep -v '^\s*\*' src/session/stateless-ops.ts src/session/state-history.ts | grep -c 'executeBarrierIndex'` → `4` (≥4 required).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `recordExecuteBarrierAdvance` wired into `captureCheckpoint()`, not
the two `<interfaces>`-cited history-append call sites**
- **Found during:** Task 2 implementation, before any test ran.
- **Issue:** The plan's interface note said to update the barrier "after BOTH
  history-append paths (`performAction` and `recordSerializedAction`)". Tracing the
  multi-step / repeating-selection completion funnel (`GameRunner.completePendingAction`,
  and its session-layer mirror `PendingActionManager`) showed `recordSerializedAction` is
  called BEFORE `continueFlowAfterPendingAction` — the call that actually advances the
  flow through any trailing `execute()` node. Checking the barrier signal at the append
  site would therefore miss an `execute()` node that runs as part of finishing THIS
  action's own flow step (exactly the shape this plan's fixture and the real MERC-style
  games use).
- **Fix:** Moved the check into `captureCheckpoint()` instead — the one chokepoint both
  executors already call once the WHOLE op (including any trailing flow advance) has
  settled: the stateless path via `getSnapshot()`, the stateful path via
  `GameSession.broadcast()` (already documented there as "the universal post-mutation
  funnel"). This also naturally covers `runner.start()`'s initial `captureCheckpoint()`
  call, correctly capturing a barrier if a flow's `setup`/pre-first-action-step runs an
  `execute()` node before any action is ever taken.
- **Files modified:** `src/runtime/runner.ts`
- **Commit:** `8833447b`

**2. [Rule 3 - Blocking] Added `Game.getExecuteNodeCompletions()`**
- **Found during:** Task 2, wiring `GameRunner` to read the flow engine's counter.
- **Issue:** `Game._flowEngine` is a private field with no existing accessor; `GameRunner`
  has no other way to observe `FlowEngine.executeNodeCompletions`.
- **Fix:** Added a thin passthrough method on `Game`, mirroring the existing
  `getFlowState()`/`getFlowDebugInfo()` pattern (`return this._flowEngine?.X ?? default`).
- **Files modified:** `src/engine/element/game.ts` (not in the plan's `files_modified`
  list, but required — no scope creep beyond the one accessor method).
- **Commit:** `8833447b`

**3. [Rule 1 - Bug] Two pre-existing tests targeted rewind indices that now legitimately
cross a barrier; retargeted rather than weakening the fence**
- **Found during:** Task 3's full-suite run — flagged in advance by RESEARCH.md §E as
  MEDIUM risk for `stateful-timetravel-authoritative.test.ts`.
- **Issue:** Both `collect-turns-fixture.ts` and the animation-watermark test's local
  `TickGame` fixture use an `execute()` node to advance `activeSeat` at the end of every
  turn. `stateful-timetravel-authoritative.test.ts`'s `rewindToAction` test and two cases
  in `rewind-animation-watermark.test.ts` rewound to an index BEFORE a turn-advance
  `execute()` had already committed — which is now correctly refused, since
  `rewindToAction`/`debugRewind` are two of the four fenced entry points, not just live
  gameplay `undo`.
- **Fix:**
  - `stateful-timetravel-authoritative.test.ts`: renamed the failing test to assert the
    refusal (`rewindToAction refuses to cross the turn-advance execute() barrier`), with
    a comment explaining why this is the correct new behavior. Added a NEW test
    (`rewindToAction restores the collected equipment when the target does not cross an
    execute() barrier`) that rewinds to a target landing exactly AT a barrier (not before
    it) and still proves the original intent: authoritative checkpoint restore preserves
    a `Piece.putInto` mutation that replay would lose.
  - `rewind-animation-watermark.test.ts`: retargeted the debug-rewind case to stop
    player 2's second tick (keeping the barrier at 2 instead of letting it advance to 4)
    and rewind to exactly that barrier; retargeted the direct-`rewindToAction()`
    adversarial case from index 1 (crossing player 1's own turn-ending barrier) to index 2
    (landing at it). Animation-watermark coverage is unaffected — only the specific
    rewind target moved to one the new fence correctly allows.
- **Files modified:** `src/session/testing/stateful-timetravel-authoritative.test.ts`,
  `src/session/testing/rewind-animation-watermark.test.ts`
- **Commit:** `fc27c01d`

---

**Total deviations:** 3 auto-fixed (1 bug in the plan's own interface note, 1 blocking
accessor, 1 bug from newly-correct refusals in sibling test files).
**Impact on plan:** All three necessary for correctness. Deviation 1 is what makes the
fence actually durable through the multi-step/pending-action path (the exact path
Plan 01's own undo-authoritative fixtures exercise); deviations 2-3 have zero effect on
the fence's behavior itself.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in its own threat model
(T-155-05 through T-155-08); no new, unlisted security-relevant surface was introduced.

## Self-Check: PASSED

- `src/session/testing/fixtures/execute-barrier-fixture.ts` — FOUND
- `src/session/testing/execute-barrier-undo.test.ts` — FOUND
- `src/engine/utils/snapshot.ts` (`executeBarrierIndex`) — FOUND
- `src/runtime/runner.ts` (`executeBarrierIndex` tracking + snapshot plumbing) — FOUND
- `src/session/utils.ts` (`assertUndoAllowed`'s third check) — FOUND
- Commit `7fb3f808` (RED) — FOUND in `git log`
- Commit `8833447b` (GREEN — barrier plumbing) — FOUND in `git log`
- Commit `fc27c01d` (GREEN — guard + parity + adversarial) — FOUND in `git log`
