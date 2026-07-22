---
requirements-completed: [UNDO-04, PROC-01]
---

# Plan 155-04 Summary — Animation-Event Watermark Survives Undo/Rewind (UNDO-04, PROC-01)

**Plan:** 155-04 (execute — monotonic animation-event id sequence across undo/rewind checkpoint restore)
**Completed:** 2026-07-20
**Result:** PASS — `Game.loadSerializedState` gains an `animationSeqFloor` option, supplied only by
`GameRunner.fromCheckpoint`; every animation beat delivered after an undo or rewind survives the
client's real monotonic watermark. PROC-01's RED-before-GREEN and adversarial gates both satisfied.

## What was done

1. **Task 1 (RED):** Added `src/session/testing/rewind-animation-watermark.test.ts` with a
   purpose-built local fixture (`TickGame`, mirroring `collect-turns-fixture.ts`'s two-actions-per-turn
   shape but with a single `tick` action that calls `game.animate()`). Drove real headless-session ops
   (`{type:'action'}`, `{type:'undo'}`, `{type:'debugRewind'}`) and fed every delivered
   `state.animationEvents` batch through a tiny in-test helper that mirrors
   `useAnimationEvents.ts:381,389` EXACTLY (`filter(id > lastQueuedId)`, then advance the watermark by
   the new events only). Asserted on **beats delivered**, not on raw `_animationEventSeq` values. Ran
   and captured the real failure (see verbatim RED output below). No production source touched in this
   commit.
2. **Task 2 (GREEN):** `Game.loadSerializedState(json, options?: { animationSeqFloor?: number })`.
   Absent (full restore, `GameSession.restore` / `mcts-bot`, via `fromSnapshot` with no options):
   unchanged, unconditionally adopts the persisted seq. Present (checkpoint/undo/rewind restore only):
   `_animationEventSeq` never drops below the floor, applied unconditionally (even when the
   checkpoint's buffer was empty), and every restored buffered event is re-stamped with a fresh id
   above the floor. `GameRunner.fromCheckpoint` derives the floor from the **enclosing live snapshot's**
   `animationEventSeq` (not the historical checkpoint) and forwards it through `fromSnapshot`'s new
   optional third argument — self-serving from this single call site; none of the four undo/rewind
   call sites (`handleUndo`, `handleDebugRewind`, `undoToTurnStart`, `rewindToAction`) needed to change.
3. **Task 3 (full-restore non-regression + adversarial):** Added three cases to the same test file:
   `GameSession.restore` (the exact production no-floor call) still adopts the persisted seq unchanged;
   5x `undo -> act -> undo -> act` cycles within one turn never produce a non-increasing delivered id;
   a direct `GameSession.rewindToAction()` call (bypassing the op layer entirely) also preserves
   monotonicity. **The repeated undo->act adversarial case failed against the Task 2 GREEN commit
   alone** — not because `animationSeqFloor` was wrong, but because `Game.toJSON()` only serialized
   `animationEventSeq` when the *current* buffer was non-empty. Since the buffer clears at the start of
   every `performAction`, any op whose restored/produced buffer was empty (every undo, by construction)
   dropped the seq out of the snapshot entirely; the *next* `loadSerializedState` reconstruction (every
   op in the stateless executor rebuilds `Game` from scratch) then defaulted the fresh instance's
   counter back to `0` — reproducing the exact id-collision UNDO-04 exists to prevent, via the
   empty-buffer path instead of the undo-restore path, and on every op, not only undo/rewind. Fixed
   (Rule 1 — bug directly caused by this plan's own change surfacing a real, previously-latent defect
   in the same method): `toJSON()` now serializes `animationEventSeq` whenever it is nonzero,
   independent of whether `animationEvents` is non-empty; `loadSerializedState`'s full-restore
   (no-floor) branch adopts the seq whenever the field is present, not only when the events array is
   also present. Re-ran and confirmed GREEN, then ran the full suite.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
❯ src/session/testing/rewind-animation-watermark.test.ts (2 tests | 2 failed)
  × UNDO-04: animation-event watermark survives undo/rewind
    > every beat after an undo is delivered under the real client watermark,
      with strictly increasing ids
    → AssertionError: expected 5 to be greater than 5
  × UNDO-04: animation-event watermark survives undo/rewind
    > every beat after a debug-rewind is delivered under the real client
      watermark, with strictly increasing ids
    → AssertionError: expected 4 to be greater than 4

Test Files  1 failed (1)
     Tests  2 failed (2)
```
Both failures were the real defect: `Game.loadSerializedState` overwrote the live animation-event
seq back down to the checkpoint's stale value, so the next minted id collided with one the client
watermark had already passed — the beat was silently dropped, exactly as a designer would report
"undo eats my animations." Not a mechanical/import error.

## PROC-01 verbatim GREEN output (Task 2, after `animationSeqFloor`)

```
✓ src/engine/element/animation-events.test.ts (20 tests) 8ms
✓ src/session/testing/rewind-animation-watermark.test.ts (2 tests) 25ms

Test Files  2 passed (2)
     Tests  22 passed (22)
```

## Adversarial verification (Task 3) + the seq-loss bug it surfaced

- 5x `undo -> act -> undo -> act` within player 1's opening turn: **initially failed**
  (`expected 1 to be greater than or equal to 6` — every post-undo tick re-minted id `1`), root-caused
  to the `toJSON()` buffer-gate bug above, not the `animationSeqFloor` mechanism itself. Fixed, then
  passed.
- Direct `GameSession.rewindToAction()` call, bypassing the op layer entirely: monotonic ids preserved.
- `GameSession.restore` (full session restore, the exact `game-session.ts:865` call with **no**
  `animationSeqFloor`) still adopts the persisted seq verbatim — proves the two `loadSerializedState`
  callers stayed distinguished; the floor did not leak into the full-restore path.

Final verbatim (Task 3, full test file):
```
✓ src/engine/element/animation-events.test.ts (20 tests) 8ms
✓ src/session/testing/rewind-animation-watermark.test.ts (5 tests) 22ms

Test Files  2 passed (2)
     Tests  25 passed (25)
```

## Verification

- `npx vitest run src/session/testing/rewind-animation-watermark.test.ts src/engine/element/animation-events.test.ts` — 2/2 files, 25/25 tests pass.
- `npm test` — **191 files / 2729 tests pass**, at/above the pre-phase baseline (188/2712); zero
  regressions. `undo-authoritative.test.ts` and `stateful-undo-authoritative.test.ts` (Plan 03's
  territory) remain green, unmodified by this plan.
- Grep gate: `git diff --name-only | grep -c 'volatile-state.ts'` → `0` (this plan never touched the
  HMR warning list — the CONTEXT's original "the exclusion hook exists" premise was corrected by
  RESEARCH.md §C: `SAFE_PROPERTIES` there has zero effect on serialization/restore; the real fix site
  is `Game.loadSerializedState`, as implemented here).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Game.toJSON()` dropped `animationEventSeq` whenever the current animation buffer
was empty, independent of undo/rewind**
- **Found during:** Task 3's adversarial repeated-undo test.
- **Issue:** `toJSON()` gated BOTH `animationEvents` and `animationEventSeq` behind
  `this._animationEvents.length > 0`. Since the buffer clears at the start of every `performAction`,
  any op producing an empty buffer (every undo restore, and any ordinary non-animating action) omitted
  the seq from its output snapshot entirely. The next `loadSerializedState` call (every op, in the
  stateless executor, rebuilds `Game` from scratch) then defaulted the fresh instance's counter to `0`
  — the exact animation-id collision this plan exists to prevent, reachable via a path this plan's own
  `animationSeqFloor` mechanism could not protect against (the floor is only as good as the seq value
  in the snapshot it reads).
- **Fix:** `toJSON()` now includes `animationEventSeq` whenever it is nonzero, independent of
  `animationEvents` array presence; `loadSerializedState`'s full-restore (no-floor) branch adopts the
  seq whenever the field is present, not only when the events array is also present.
- **Files modified:** `src/engine/element/game.ts`
- **Commit:** `8ab331f7`

### Process note (not a code deviation, but load-bearing for reviewers)

**Concurrent-execution git-index race with sibling plan 155-01, self-corrected.** This repo is not
worktree-isolated for parallel phase-155 plan execution — 155-01 and 155-04 ran in the same working
tree simultaneously. Mid-Task-2, a `git add`/`git commit` race swept 155-01's staged-but-uncommitted
edits to `state-history.ts`/`stateless-ops.ts`/`utils.ts`/`types/protocol.ts` into this plan's GREEN
commit (`fe1cdc0c`) alongside its own unrelated `game.ts`/`runner.ts` changes. Caught immediately via
`git show --stat HEAD` before moving on; corrected with an explicit follow-up commit (`085fd236`) that
reverted those 4 files' content back to pre-155-04 state via `git checkout HEAD~1 -- <files>`, then
reapplied 155-01's original diff to the working tree via a saved patch (`git diff HEAD~1 HEAD -- <files>
> patch; git apply patch`) so their in-progress edits were restored exactly, unstaged, with zero loss.
Re-verified with `git status --short` and the target test suite before continuing. No code or test
content was lost. Flagging for the orchestrator: concurrent plan execution in this phase should use
isolated worktrees rather than relying on this kind of self-correction.

### Auth gates
None encountered.

## Known Stubs
None — no stub patterns introduced.

## Threat Flags
None — this plan implements the mitigations specified in the plan's own threat model (T-155-09
through T-155-11); no new, unlisted security-relevant surface was introduced. The `toJSON()` fix
(Deviation 1) only widens WHEN an already-broadcast field is included, not WHAT is disclosed.

## Self-Check: PASSED

- `src/session/testing/rewind-animation-watermark.test.ts` — FOUND
- `src/engine/element/game.ts` (`animationSeqFloor`) — FOUND
- `src/runtime/runner.ts` (`animationSeqFloor` threaded through `fromSnapshot`/`fromCheckpoint`) — FOUND
- Commit `49e29aa3` (RED) — FOUND in `git log`
- Commit `fe1cdc0c` (GREEN, animationSeqFloor) — FOUND in `git log`
- Commit `085fd236` (concurrent-race correction) — FOUND in `git log`
- Commit `8ab331f7` (full-restore + adversarial + toJSON seq-loss fix) — FOUND in `git log`
