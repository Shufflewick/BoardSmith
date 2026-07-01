---
phase: 123-determinism-flow-introspection
fixed_at: 2026-07-01T00:00:00Z
review_path: .planning/phases/123-determinism-flow-introspection/123-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
skipped: 1
status: partial
---

# Phase 123: Code Review Fix Report

**Fixed at:** 2026-07-01
**Source review:** .planning/phases/123-determinism-flow-introspection/123-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 critical, 3 warning, 1 info — `fix_scope: all`)
- Fixed: 4
- Skipped: 1 (false positive / no fix warranted)

## Fixed Issues

### CR-01: GameSession broadcasts the live, non-JSON-safe PendingActionState (not the documented deep copy)

**Files modified:** `src/session/types.ts`, `src/session/utils.ts`, `src/session/game-session.ts`, `src/session/snapshot-session-host.ts`, `src/session/stateless-ops.ts`, `src/ui/components/GameShell.devtools.ts`, `src/session/game-session.test.ts`
**Commit:** `3950a30`
**Applied fix:** Added `serializePendingActionState()`/`deserializePendingActionState()` to `session/utils.ts` (Set→array + one-level-deep copy of `collectedArgs`/`repeating.accumulated`, mirroring the existing `pick-handler.ts` convention). Routed `GameSession.broadcast()` through it instead of injecting the live `PendingActionManager` entry. Added `SerializedPendingActionState` to `session/types.ts` as the wire type for `PlayerGameState.pendingAction`. Added a regression test asserting the broadcast payload's `onSelectFired` is a plain array (not a `Set`) and is not identity-equal to (nor shares `collectedArgs` with) the live manager state.

### WR-01: `PlayerGameState.pendingAction` is typed as the raw engine `PendingActionState`, not a JSON-safe wire type

**Files modified:** same as CR-01 (fixed together — identical root cause and fix)
**Commit:** `3950a30`
**Applied fix:** `SerializedPendingActionState` is now used consistently for `PlayerGameState.pendingAction`, `SnapshotSessionAdapters`/`OpResult.pendingAction` in `stateless-ops.ts`, `snapshot-session-host.ts`'s cast, and `GameShell.devtools.ts`'s `DevtoolsStateMessage`/`DevtoolsParams` — one wire shape across all three channels.

### WR-02: `GameRunner.getPendingAction()`'s "deep copy" is only a shallow copy of nested collected values

**Files modified:** `src/runtime/runner.ts`
**Commit:** `65bdb1b`
**Applied fix:** Reworded the doc comment to precisely state the copy guarantee (top-level fields, `collectedArgs`, `repeating.accumulated`, and `onSelectFired` are copied; nested object/array values inside `collectedArgs` are not). Chose this over `structuredClone` because `collectedArgs` may legitimately hold non-structured-cloneable values, and a throwing deep-clone would be a larger, riskier behavior change than this low-severity finding warrants. No behavior change.

### IN-01: `debug:flow-state` wire op accepts a client-supplied `player` override that is unused beyond bounds validation

**Files modified:** `src/cli/dev-host/bridge.ts`
**Commit:** `f30f46c`
**Applied fix:** Dropped the `payload.player` override for `debug:flow-state` — always uses the connection's own `seat` now, matching the actual data source.

## Skipped Issues

### WR-03: `describeFlowPosition`'s `switch` node fallback can silently point at the wrong case if `cases[index]` is legitimately absent for a reason other than out-of-range

**File:** `src/engine/flow/describe-flow-position.ts:51-54`
**Reason:** False positive / no fix warranted this phase — the reviewer's own analysis confirms this mirrors inherited engine behavior (`FlowEngine.getChildNode()`'s switch-node navigation convention), not a regression introduced by this phase. Fixing it would require changing the engine's own switch-node semantics, which is out of scope here. Documented in REVIEW.md as a low-severity, inherited design nuance.
**Original issue:** `describeFlowPosition`'s doc comment claims "degrades gracefully on invalid/partial path," but for `switch` nodes with a `default` case, an out-of-range index and a genuine default-case resolution are indistinguishable in the returned `FlowDebugInfo`.

---

_Fixed: 2026-07-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
