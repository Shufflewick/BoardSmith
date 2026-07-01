---
phase: 123-determinism-flow-introspection
reviewed: 2026-07-01T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - src/cli/dev-host/bridge.ts
  - src/cli/dev-host/DevHost.vue
  - src/engine/element/element-collection.test.ts
  - src/engine/element/element-collection.ts
  - src/engine/element/game.ts
  - src/engine/element/space.test.ts
  - src/engine/element/space.ts
  - src/engine/flow/describe-flow-position.test.ts
  - src/engine/flow/describe-flow-position.ts
  - src/engine/flow/index.ts
  - src/engine/flow/types.ts
  - src/engine/index.ts
  - src/runtime/runner.ts
  - src/session/game-session.test.ts
  - src/session/game-session.ts
  - src/session/snapshot-session-host.test.ts
  - src/session/snapshot-session-host.ts
  - src/session/stateless-ops.test.ts
  - src/session/stateless-ops.ts
  - src/session/types.ts
  - src/session/utils.ts
  - src/testing/assertions.test.ts
  - src/testing/assertions.ts
  - src/testing/debug.test.ts
  - src/testing/debug.ts
  - src/testing/play-until-complete.test.ts
  - src/testing/simulate-action.ts
  - src/testing/test-game.test.ts
  - src/testing/test-game.ts
  - src/ui/components/DebugPanel.vue
  - src/ui/components/GameShell.devtools.test.ts
  - src/ui/components/GameShell.devtools.ts
  - src/ui/components/GameShell.vue
  - src/ui/global.d.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: fixed
fixed_at: 2026-07-01T00:00:00Z
fix_commits:
  - 3950a30
  - 65bdb1b
  - f30f46c
---

# Phase 123: Code Review Report

**Reviewed:** 2026-07-01
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found -> fixed (see per-finding Resolution notes; fixed 2026-07-01, commits `3950a30`, `65bdb1b`, `f30f46c`)

## Summary

This phase adds flow-position introspection (`FlowDebugInfo`/`describeFlowPosition`), pending-action introspection (`GameRunner`/`TestGame.getPendingAction`), determinism enforcement (kills `Math.random` fallbacks in `Space.shuffleInternal`/`ElementCollection.shuffle`/`playUntilComplete`), and wires both introspection surfaces through session broadcasts, the `debug:flow-state` WS op, and the `__BOARDSMITH_DEVTOOLS` bridge.

The flow-position walker (`describe-flow-position.ts`) correctly mirrors `FlowEngine.getChildNode()`'s child-selection switch, degrades gracefully on invalid paths, and the sentinel "no active flow" behavior is well-handled. The determinism work (`space.ts`, `element-collection.ts`, `simulate-action.ts`, `runner.ts`) is clean: the `Math.random` fallbacks are genuinely removed and replaced with actionable throws or fixed-seed defaults, and the regression tests actually assert same-seed-twice equality. The perspective-isolation testing layer (`game-session.test.ts`, `snapshot-session-host.test.ts`) has a real multi-seat leak test that would catch a naive cross-seat pendingAction bug.

However, the phase's own stated security contract — "`getPendingAction` always returns a deep copy... never the live mutable `PendingActionState`" — is only honored on the `GameRunner`/`TestGame` testing path. The production `GameSession` broadcast path (the code that actually ships to real deployed games) returns the live, mutable `PendingActionManager` map entry directly, and broadcasts it without the JSON-safety serialization (`Set` → array) that the codebase already established elsewhere (`pick-handler.ts`'s `serializePendingState`) for this exact same type. This is a genuine correctness/data-integrity bug in the newly-added broadcast injection, not a hypothetical — see CR-01 below.

## Critical Issues

### CR-01: GameSession broadcasts the live, non-JSON-safe PendingActionState (not the documented deep copy)

**File:** `src/session/pending-action-manager.ts:235-237`, `src/session/game-session.ts:1885-1887`, `src/session/game-session.ts:2014-2015`, `src/session/types.ts:528`

**Issue:**
`GameSession.broadcast()` (game-session.ts:2014) injects `this.getPendingAction(effectivePosition)` into `state.pendingAction`, which is broadcast to the seat's WebSocket/network transport (`BroadcastAdapter.send(session, message: unknown)` — a network boundary that will `JSON.stringify` the payload in any real transport). `GameSession.getPendingAction()` delegates straight to `PendingActionManager.getPendingAction()`:

```ts
// pending-action-manager.ts:235-237
getPendingAction(playerPosition: number): PendingActionState | undefined {
  return this.#pendingActions.get(playerPosition);
}
```

This returns the **live** map entry — not a copy. Two problems follow directly from this:

1. **Mutable-state aliasing**: any caller holding a reference to a broadcast `state.pendingAction` (a synchronous in-process broadcast adapter, a state-history/time-travel consumer, a test harness capturing broadcasts) is holding the actual object the engine continues to mutate via `processSelectionStep`/`processRepeatingStep` on subsequent selection steps. This directly contradicts the phase's own documented decision (123-03 SUMMARY key-decisions): *"getPendingAction always returns a deep copy... never the live mutable PendingActionState."* That guarantee was implemented for `GameRunner.getPendingAction()` (runner.ts:422-434, correctly deep-copies) but **not** for the actual production broadcast path through `PendingActionManager`/`GameSession`.
2. **`Set` does not survive JSON serialization**: `PendingActionState.onSelectFired` is typed `Set<number>` (engine/action/types.ts:149). `JSON.stringify(new Set([1,2]))` produces `"{}"` — the client silently receives an empty object instead of the accumulated onSelectFired indices. The codebase already solved this exact problem for the *other* PendingActionState wire path: `src/session/pick-handler.ts:20-23` has a dedicated `serializePendingState()` (`Set` → `Array`) used for the `selectionStep`/`resolveChoices` responses. The new `state.pendingAction` broadcast field bypasses that helper entirely, so the two wire paths for the same conceptual data (PendingActionState over the wire) have inconsistent, and in the broadcast case broken, JSON-safety.

This is a silent data-loss bug (contra CLAUDE.md's "fail fast and loud, not silently" and "never use... fallbacks that mask real problems") introduced by this phase's new broadcast injection, and it diverges from the parallel `SnapshotSessionHost`/`stateless-ops.ts` path, which correctly threads only already-serialized `Record<string, unknown>` pending state (via `PickHandler`'s `serializePendingState`) through `debugFlowState`'s `pendingAction` field — i.e. the dev-host path is fine, but the primary production `GameSession` path is not.

**Fix:** Add a `serializeFlowDebugInfo`-style shared serializer for pendingAction (e.g. `serializePendingActionState()` in `session/utils.ts`, reusing the existing `Set`→`Array` logic from `pick-handler.ts`'s `serializePendingState`), and have `GameSession.broadcast()` inject the serialized form into `state.pendingAction` instead of the raw live object:

```ts
// session/utils.ts
export function serializePendingActionState(s: PendingActionState): SerializedPendingActionState {
  return {
    ...s,
    collectedArgs: { ...s.collectedArgs },
    repeating: s.repeating ? { ...s.repeating, accumulated: [...s.repeating.accumulated] } : undefined,
    onSelectFired: s.onSelectFired ? Array.from(s.onSelectFired) : undefined,
  };
}

// game-session.ts broadcast()
const pendingAction = this.getPendingAction(effectivePosition);
if (pendingAction) state.pendingAction = serializePendingActionState(pendingAction);
```

And update `PlayerGameState.pendingAction?: PendingActionState` (session/types.ts:528) to a new `SerializedPendingActionState` wire type (mirroring `SerializedFlowDebugInfo`) so the type system reflects what actually goes over the wire, rather than reusing the live-engine `PendingActionState` type which is not JSON-safe.

**Resolution (fixed, commit `3950a30`):** Added `serializePendingActionState()`/`deserializePendingActionState()` to `session/utils.ts` (Set→array + one-level-deep copy of `collectedArgs`/`repeating.accumulated`, mirroring `pick-handler.ts`'s existing convention), routed `GameSession.broadcast()` through it, and introduced `SerializedPendingActionState` in `session/types.ts` as the wire type for `PlayerGameState.pendingAction` (also applied to `stateless-ops.ts`, `snapshot-session-host.ts`, and `GameShell.devtools.ts`, resolving WR-01 in the same commit). Added a regression test (`game-session.test.ts`, "pendingAction is serialized, not the live state (CR-01)") asserting `onSelectFired` is a plain array in the broadcast payload and that the payload is not identity-equal to (nor shares `collectedArgs` with) the live `PendingActionManager` state. Full test suite green (143 files / 1910 tests), `tsc --noEmit` clean on touched files.

## Warnings

### WR-01: `PlayerGameState.pendingAction` is typed as the raw engine `PendingActionState`, not a JSON-safe wire type

**File:** `src/session/types.ts:528`, `src/ui/components/GameShell.devtools.ts:12,34,54`

**Issue:** Unlike `flowDebugInfo`, which got a dedicated `SerializedFlowDebugInfo` wire type specifically because the engine's `FlowDebugInfo.describe()` method doesn't survive serialization, `pendingAction` reuses `PendingActionState` verbatim (including its `Set<number>` field) as the wire/broadcast type. This is misleading on two fronts: (1) it hides the CR-01 bug behind a type that looks correct, and (2) client-side consumers (`GameShell.devtools.ts`, `DebugPanel.vue`) that type-check against `PendingActionState.onSelectFired: Set<number>` will actually receive either an empty object (`GameSession` path, post-JSON) or a plain array (`SnapshotSessionHost` path, already serialized) at runtime — the two hosts produce different runtime shapes under the same declared type.

**Fix:** Introduce `SerializedPendingActionState` (onSelectFired as `number[]`) in `session/types.ts`, use it for `PlayerGameState.pendingAction`, `SnapshotSessionAdapters`, and the devtools bridge types, and route both hosts through the same serializer (see CR-01 fix).

**Resolution (fixed, commit `3950a30`, same commit as CR-01):** `SerializedPendingActionState` added to `session/types.ts` and applied to `PlayerGameState.pendingAction`, `stateless-ops.ts`'s `OpResult.pendingAction`, `snapshot-session-host.ts`'s cast, and `GameShell.devtools.ts`'s `DevtoolsStateMessage`/`DevtoolsParams` — one wire type across all three channels (`GameSession.broadcast()`, `SnapshotSessionHost`/`stateless-ops.ts`, `debug:flow-state`).

### WR-02: `GameRunner.getPendingAction()`'s "deep copy" is only a shallow copy of nested collected values

**File:** `src/runtime/runner.ts:422-434`

**Issue:** The method's doc comment states: *"Always returns a deep copy: mutating the returned object never affects subsequent calls or game state."* The implementation is:

```ts
return {
  ...state,
  collectedArgs: { ...state.collectedArgs },
  repeating: state.repeating
    ? { ...state.repeating, accumulated: [...state.repeating.accumulated] }
    : undefined,
  onSelectFired: state.onSelectFired ? new Set(state.onSelectFired) : undefined,
};
```

This is a one-level-deep copy: `collectedArgs`'s own values (and `repeating.accumulated`'s elements) are copied by reference, not cloned. If any selection's collected value is itself an object or array (e.g., a repeating selection accumulating structured picks, or an element-selection value stored as a reference object rather than a raw id), a caller mutating that nested value would still corrupt the live internal state. Low risk in the common case where collected values are primitives/ids, but the doc comment overstates the guarantee it actually provides.

**Fix:** Either genuinely deep-clone (`structuredClone` on `collectedArgs`/`accumulated`, guarding for non-serializable values), or soften the doc comment to state the guarantee precisely: "top-level fields and known containers are copied; nested object/array values inside collected args are not cloned."

**Resolution (fixed, commit `65bdb1b`):** Chose the doc-comment fix over `structuredClone` — `collectedArgs` may legitimately hold non-structured-cloneable values (e.g. element references), and `structuredClone` would throw fail-loud in that case rather than silently doing the wrong thing, which is a bigger behavior change than this low-severity finding warrants. Reworded `GameRunner.getPendingAction()`'s doc comment in `runtime/runner.ts` to state precisely what is and is not copied. No behavior change.

### WR-03: `describeFlowPosition`'s `switch` node fallback can silently point at the wrong case if `cases[index]` is legitimately absent for a reason other than out-of-range

**File:** `src/engine/flow/describe-flow-position.ts:51-54`

**Issue:**
```ts
case 'switch': {
  const cases = Object.values(node.config.cases);
  return cases[index] ?? node.config.default;
}
```
This mirrors `FlowEngine.getChildNode()`'s convention (confirmed matching), so it is *consistent* with engine navigation. However, it means the walker's `step` output degrades to whatever `default` resolves to (or to the parent's name, if `default` is also absent) with no signal to the caller that the path segment didn't resolve to a genuine `cases` entry. For a `FlowDebugInfo` consumer surfaced to end users/agents (the entire purpose of this phase), an out-of-range switch index due to a stale/corrupted `FlowPosition.path` (e.g., after a hot-reload that changed `switch` case ordering) produces a plausible-looking `step` string pointing at the `default` branch instead of any diagnostic indicating the path was actually invalid at that segment. `walkPath`'s general out-of-range handling (line 28-31) does stop the walk and is fine for genuinely-missing children, but for `switch` specifically `getChildNode` never returns `undefined` unless `default` is also absent, so the generic "stop here, degrade gracefully" branch in `walkPath` is unreachable for `switch` nodes with a `default` — the degradation is silent rather than visible.

**Fix:** This is a design nuance, not a regression — the same behavior exists in the engine's real navigation (`getChildNode`), so `describeFlowPosition` is correctly consistent with it. Flagging only because the doc-comment's "degrades gracefully on invalid/partial path" claim is not fully true for `switch` nodes with a `default` case (there is no way to distinguish a real "this switch resolved to its default case" from "this path segment was out of range" in the returned `FlowDebugInfo`). Low severity — the same ambiguity exists in the engine itself, so this is inherited, not introduced.

**Resolution (skipped: false positive / no fix needed):** Reviewer's own analysis confirms this is inherited engine behavior (`FlowEngine.getChildNode()`'s convention), not a regression introduced by this phase, and flags it at low severity for awareness only — no `describeFlowPosition` code change is warranted without also changing the engine's own switch-node navigation semantics, which is out of scope for this phase.

## Info

### IN-01: `debug:flow-state` wire op accepts a client-supplied `player` override that is unused beyond bounds validation

**File:** `src/cli/dev-host/bridge.ts:181-182`, `src/session/stateless-ops.ts:909-933`

**Issue:** `translateOp('debug:flow-state', seat, payload)` builds `{ type: 'debugFlowState', player: (payload.player as number) ?? seat }`, letting the connecting client request an arbitrary `player` value. Verified this does **not** leak another seat's `pendingAction` — `handleDebugFlowState`'s `pendingAction` comes from the `pendingState` parameter, which `SnapshotSessionHost.handleOp` threads from `this.pendingStates.get(seat)` using the real connection `seat`, not `op.player` (the T-123-10 comment at stateless-ops.ts:921-923 documents this correctly). `op.player` is only used for a range-validation check. Not a vulnerability, but the parameter is confusing: a caller could reasonably expect `payload.player: 3` to fetch seat 3's pending action, and instead silently gets their own seat's data (or a validation error if `payload.player` is out of range while their own seat isn't). Consider either removing the client-supplied override for `debug:flow-state` (always use `seat`) or renaming/documenting it as "validation only, has no effect on which seat's data is returned."

**Fix:** Drop the `payload.player` override for `debug:flow-state` (use `seat` directly, matching the actual data source), or add a doc-comment on the op stating the `player` field is present for parity with other debug ops but does not change which seat's pendingAction is returned.

**Resolution (fixed, commit `f30f46c`):** Dropped the `payload.player` override in `bridge.ts`'s `translateOp('debug:flow-state', ...)` — always uses `seat` now, matching the actual data source and removing the confusing (though non-vulnerable) parameter.

---

_Reviewed: 2026-07-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
