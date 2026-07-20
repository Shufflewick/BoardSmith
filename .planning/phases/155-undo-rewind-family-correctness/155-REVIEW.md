---
phase: 155-undo-rewind-family-correctness
reviewed: 2026-07-20T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/session/utils.ts
  - src/session/stateless-ops.ts
  - src/session/state-history.ts
  - src/session/types.ts
  - src/runtime/runner.ts
  - src/engine/flow/engine.ts
  - src/engine/flow/types.ts
  - src/engine/utils/snapshot.ts
  - src/engine/element/game.ts
  - src/ui/composables/useAnimationEvents.ts
  - src/ui/components/GameShell.vue
  - src/client/types.ts
  - src/types/protocol.ts
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: resolved
---

# Phase 155: Code Review Report

**Reviewed:** 2026-07-20T00:00:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Traced the full undo/rewind chain across both executors (`stateless-ops.ts` /
`state-history.ts`), the shared `assertUndoAllowed` guard, `executeBarrierIndex`
durability through `getSnapshot`/`fromSnapshot`/`fromCheckpoint`, the
`animationSeqFloor` direction fix in `game.ts`, `computeUndoInfo`'s
branch-C deletion, and the `actionCount` rewind-detection signal in
`useAnimationEvents.ts`.

The core safety mechanics hold up under adversarial tracing:

- `assertUndoAllowed` is genuinely the single shared gate for all four entry
  points (`handleUndo`, `handleDebugRewind`, `undoToTurnStart`,
  `rewindToAction`), and its three checks (finished-phase, non-undoable,
  execute-barrier) are identical across both executors.
- `UndoRefusedError` cannot escape unhandled: the stateless path's own
  try/catch converts it to `errorResult(..., ErrorCode.UNDO_NOT_ALLOWED)`
  and re-throws anything else into `executeOp`'s outer catch; the stateful
  path's try/catch converts any thrown error (including non-`UndoRefusedError`
  errors) into `{ success: false, error }`. Neither swallows nor lets it
  propagate as an unhandled rejection across the WS boundary.
- `executeBarrierIndex`'s re-baselining on restore (`lastSeenExecuteNodeCompletions`
  reset to the fresh `FlowEngine`'s own counter) and the `Math.min(barrier,
  actionIndex)` clamp in `fromCheckpoint` are correct: the clamp only ever
  reduces the barrier at restore points that already passed (or bypass, for
  read-only time-travel views) the `assertUndoAllowed` check, so it cannot
  create a bypass.
- `animationSeqFloor` only ever flows forward (never regresses the live seq)
  and `game.toJSON()`'s `animationEventSeq > 0` gating (independent of buffer
  emptiness) is correctly unconditional, matching the documented fix.
- `computeUndoInfo` has no remaining backward-scan fallback; a missing
  `moveCount` unconditionally returns `actionsThisTurn: 0`, which forces
  `canUndo: false` in `buildPlayerState`.

Three parity/robustness gaps remain (all WARNING, no BLOCKER found), plus one
dead error code (INFO).

## Warnings

### WR-01: `handleUndo` (stateless) drops `errorCode` on two rejections that `undoToTurnStart` (stateful) sets

**File:** `src/session/stateless-ops.ts:459` and `:472`
**Issue:** The two undo executors are supposed to be parity-locked (the
whole point of `assertUndoAllowed`), but the pre-guard rejections diverge:

- `state-history.ts:282` returns `{ success: false, error: "It's not your turn", errorCode: ErrorCode.NOT_YOUR_TURN }`.
- `stateless-ops.ts:459` returns `errorResult("It's not your turn")` — no `errorCode` at all (`errorCode` stays `undefined`).
- `state-history.ts:297` returns `{ success: false, error: 'No actions to undo', errorCode: ErrorCode.NO_ACTIONS_TO_UNDO }`.
- `stateless-ops.ts:472` returns `errorResult('No actions to undo')` — again no `errorCode`.

Additionally, `undoToTurnStart` validates `playerPosition` bounds up front and
returns `ErrorCode.INVALID_PLAYER` (`state-history.ts:274`); `handleUndo` has
no equivalent bounds check — an out-of-range `op.player` simply falls through
to the generic "It's not your turn" message with no error code.

A client that switches on `errorCode` (the pattern the protocol.ts JSDoc
itself advertises, e.g. `case ErrorCode.NOT_YOUR_TURN`) gets structured,
actionable codes from the WebSocket/`GameSession` path but only a bare string
from the stateless-executor path (used by the dev-host bridge and the
production executor worker). This is exactly the kind of "guard present in
one path, subtly different in the other" the phase is meant to close out —
it just landed on the metadata layer instead of the enforcement logic.

**Fix:**
```typescript
// stateless-ops.ts handleUndo
if (flowState?.currentPlayer !== op.player) {
  return errorResult("It's not your turn", 'bundle', ErrorCode.NOT_YOUR_TURN);
}
...
if (actionsThisTurn === 0) {
  return errorResult('No actions to undo', 'bundle', ErrorCode.NO_ACTIONS_TO_UNDO);
}
```
Consider also validating `op.player` against `gameOptions.playerCount` up
front (mirroring `undoToTurnStart`'s `INVALID_PLAYER` check) so an
out-of-range seat gets a distinguishable code instead of a generic
"not your turn."

### WR-02: `useAnimationEvents`'s `actionCount` rewind-detection is skipped on ticks with no events, weakening the reconnect-time defense-in-depth

**File:** `src/ui/composables/useAnimationEvents.ts:391-413`
**Issue:** The `watch(getEvents, ...)` callback returns immediately when
`events` is empty/undefined, **before** the `actionCount` decrease check runs:

```typescript
watch(
  getEvents,
  (events) => {
    if (!events || events.length === 0) {
      return; // <-- lastActionCount is never updated here
    }
    if (getActionCount) {
      const currentActionCount = getActionCount();
      if (currentActionCount !== undefined && lastActionCount !== undefined && currentActionCount < lastActionCount) {
        lastQueuedId = 0;
        lastProcessedId = 0;
      }
      lastActionCount = currentActionCount;
    }
    ...
  },
  { immediate: true }
);
```

`PlayerGameState.animationEvents` is only present when the buffer is
non-empty (`buildPlayerState`, `session/utils.ts:392-396`), so most state
broadcasts carry `animationEvents: undefined` and this watch callback never
fires for them at all (Vue's default `Object.is` comparison sees
`undefined === undefined` and skips the callback). Consequently, if an
undo/rewind happens during a stretch with no pending animation events, and
then several new actions occur post-rewind before the next event-bearing
broadcast, `lastActionCount` can still hold its pre-rewind value when the
next comparison finally runs — and if `actionCount` has since climbed back
above that stale value, the `currentActionCount < lastActionCount` decrease
is never observed, so the local watermark reset never fires for that rewind.

In the currently-connected-client case this is masked by the independent
server-side fix (the `animationSeqFloor` mechanism in `game.ts` already
keeps animation-event ids globally monotonic across an undo, so filtering by
`e.id > lastQueuedId` still works even without the client-side reset). But
the doc comment on `actionCount` explicitly calls this out as the defense
for "a client that reconnects or joins mid-rewind," and the early return
means the bookkeeping this defense relies on (`lastActionCount` tracking the
true current value on every state tick) silently goes stale whenever no
events happen to be in flight — undermining the "defense-in-depth" contract
for exactly the scenario it was added for, and making the mechanism fragile
if the server-side monotonic-id guarantee is ever weakened.

**Fix:** Run the `actionCount` comparison unconditionally, before the
early return on empty events:
```typescript
watch(
  getEvents,
  (events) => {
    if (getActionCount) {
      const currentActionCount = getActionCount();
      if (
        currentActionCount !== undefined &&
        lastActionCount !== undefined &&
        currentActionCount < lastActionCount
      ) {
        lastQueuedId = 0;
        lastProcessedId = 0;
      }
      lastActionCount = currentActionCount;
    }

    if (!events || events.length === 0) {
      return;
    }
    ...
  },
  { immediate: true }
);
```
Note this alone isn't sufficient either — `watch(getEvents, ...)` still only
fires when the *events* getter's return value changes, so a rewind with an
empty buffer that stays empty across several ticks still won't trigger the
callback. If precise reconnect-time tracking matters, `actionCount` should be
its own `watch` source (or merged into a combined getter), not piggybacked on
the events getter's change detection.

### WR-03: `handleDebugRewind` (stateless) and `rewindToAction` (stateful) disagree on whether the current action index is a valid rewind target

**File:** `src/session/stateless-ops.ts:989-996` vs `src/session/state-history.ts:380-382`
**Issue:** `handleDebugRewind` validates `op.actionIndex < 0 || op.actionIndex > historyLength` — i.e. rewinding to the *current* length (a no-op) is accepted. `rewindToAction` validates `targetActionIndex >= currentLength` — i.e. rewinding to the current length is explicitly rejected with "Cannot rewind forward." Minor behavioral drift between the two "debug rewind" twins that the phase's own doc comments (`T-155-02`) describe as required to stay in lockstep for the undo/notUndoable/finished-phase fences; this particular divergence is outside those fences (it's the pre-guard bounds check) but is still an inconsistency between what is meant to be the same operation on two executors.
**Fix:** Pick one contract (recommend rejecting `actionIndex === historyLength` as a no-op rewind, consistent with `rewindToAction`) and apply it in both `handleDebugRewind` and the stateless `debugStateAt`/`debugStateDiff` bound checks where relevant, or explicitly document why a no-op rewind is intentionally allowed on the stateless path.

## Info

### IN-01: `ErrorCode.CANNOT_REWIND_FORWARD` is declared but never used

**File:** `src/types/protocol.ts:60`
**Issue:** The enum defines `CANNOT_REWIND_FORWARD`, but neither `rewindToAction` (which returns the matching "Cannot rewind forward" message with no `errorCode`, `state-history.ts:381`) nor `handleDebugRewind` sets it. Dead API surface that also compounds WR-03/WR-01: the enum exists precisely for this case but nothing wires it up.
**Fix:** Either set `errorCode: ErrorCode.CANNOT_REWIND_FORWARD` on the forward-rewind rejection in `rewindToAction`, or remove the unused enum member if forward-rewind rejection is meant to stay untyped.

---

_Reviewed: 2026-07-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
