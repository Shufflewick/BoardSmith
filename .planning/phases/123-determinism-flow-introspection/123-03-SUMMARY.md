---
phase: 123-determinism-flow-introspection
plan: 03
subsystem: testing
tags: [typescript, testing, flow-engine, introspection, pending-action, disabled-choices]

# Dependency graph
requires:
  - phase: 123-01
    provides: "FlowDebugInfo type + Game.getFlowDebugInfo() facade (flow-position introspection primitive)"
  - phase: 123-02
    provides: "determinism guarantees (unrelated surface, same phase)"
provides:
  - "GameRunner.startPendingAction/processSelectionStep/getPendingAction — session-free multi-step action tracking, built on ActionExecutor.createPendingActionState (mirrors PendingActionManager minus storage/broadcast)"
  - "GameRunner.getFlowDebugInfo() passthrough"
  - "TestGame.getPendingAction(seat) — read-only PendingActionState snapshot (deep copy)"
  - "TestGame.getFlowDebugInfo() — passthrough to the FlowDebugInfo primitive"
  - "TestGame.getActionSpaceWithChoices(seat) — full action space with disabled choices + reasons, one call"
  - "GameStuckError, assertActionAvailable, toDebugString all embed the readable flow position"
  - "FlowDebugInfo now exported from engine/index.ts and flow/index.ts (was previously unexported — a Plan 01 gap)"
affects: [124-vis-hidden-info, 125-headless-simulation, dev-host-devtools-bridge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session-free pending-action machinery: GameRunner drives ActionExecutor.createPendingActionState/processSelectionStep/processRepeatingStep/isPendingActionComplete/executePendingAction directly — same primitives PendingActionManager uses on the session layer, but with no storage/broadcast callback plumbing (GameRunner has no GameSession)"
    - "getPendingAction always returns a deep copy (collectedArgs spread, repeating.accumulated array copy, onSelectFired Set copy) — never the live mutable PendingActionState"
    - "getActionSpaceWithChoices composes two existing engine primitives (getActionSpace for the legal action/selection set, getSelectionChoices for AnnotatedChoice.disabled per selection) rather than building a parallel disabled-choice evaluator"

key-files:
  created:
    - src/testing/debug.test.ts
  modified:
    - src/runtime/runner.ts
    - src/testing/test-game.ts
    - src/testing/test-game.test.ts
    - src/testing/simulate-action.ts
    - src/testing/assertions.ts
    - src/testing/assertions.test.ts
    - src/testing/debug.ts
    - src/engine/index.ts
    - src/engine/flow/index.ts

key-decisions:
  - "A2 VERIFIED (RESEARCH Open Question 2): reuse ActionExecutor.createPendingActionState/processSelectionStep/isPendingActionComplete/executePendingAction directly — confirmed session-free by tracing src/engine/action/action.test.ts:1684-1757 ('onSelect in processSelectionStep' describe block), which exercises `new ActionExecutor(game)` + `executor.createPendingActionState('test', 1)` + `executor.processSelectionStep(...)` with NO GameSession/PendingActionManager involved. src/session/pending-action-manager.ts:104-105 confirms the session layer uses the exact same two calls (`this.#runner.game.getActionExecutor()` + `executor.createPendingActionState(...)`) — GameRunner needed only its own Map<playerPosition, PendingActionState> plus a completion funnel (serializeForHistory → executePendingAction → recordSerializedAction → continueFlowAfterPendingAction), mirroring PendingActionManager#completePendingAction minus save()/broadcast()/scheduleAICheck(). No new tracking primitive was needed — reuse was sufficient, so Task 1 was NOT split."
  - "GameRunner needed brand-new startPendingAction/processSelectionStep methods (not just a getPendingAction passthrough) because GameRunner.performAction always submits full args in one synchronous continueFlow() call — there was no existing route to observe a multi-step action mid-flight from a TestGame-driven test. This satisfies the plan's 'track pending-action state as multi-step actions progress' requirement without touching ActionBuilder (which remains a separate, all-args-at-once ergonomic wrapper) — test-game.test.ts exercises the new state machine directly via testGame.runner.startPendingAction/processSelectionStep since TestGame.runner is public."
  - "FlowDebugInfo (added to flow/types.ts in Plan 01) was never re-exported from flow/index.ts or engine/index.ts — a Rule 3 blocking-fix discovered while importing the type for runner.ts/test-game.ts. Exported it in both barrels alongside FlowState/FlowDefinition."
  - "getActionSpaceWithChoices fetches each selection's choices with empty upstream args ({}), so a dependsOn/filterBy selection reflects its pre-selection (unfiltered) choice set — documented in the method's JSDoc rather than building dependent-selection resolution, which ActionBuilder already covers for that use case."

requirements-completed: [FLOW-01, FLOW-02, FLOW-03]

# Metrics
duration: 45min
completed: 2026-07-01
---

# Phase 123 Plan 03: Testing-Layer Flow Introspection Summary

**TestGame.getPendingAction()/getFlowDebugInfo()/getActionSpaceWithChoices() expose flow-position, mid-multi-step-action state, and disabled-choice reasons through the testing layer, backed by a new session-free pending-action state machine on GameRunner and embedded into GameStuckError/assertActionAvailable/toDebugString failure messages.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-01T22:xx:00Z (approx)
- **Tasks:** 3 completed
- **Files modified:** 10 (1 created, 9 modified)

## Accomplishments

- `GameRunner` gained a session-free pending-action state machine (`startPendingAction`, `processSelectionStep`, `getPendingAction`) built directly on `ActionExecutor.createPendingActionState`/`processSelectionStep`/`processRepeatingStep`/`isPendingActionComplete`/`executePendingAction` — the same primitives `PendingActionManager` uses on the session layer, minus storage/broadcast callbacks GameRunner doesn't have.
- `TestGame.getPendingAction(seat)` returns a deep-copied, read-only `PendingActionState` snapshot; mutating it never leaks back. Returns `undefined` for no pending action or an out-of-range seat (no throw).
- `TestGame.getFlowDebugInfo()` and `GameRunner.getFlowDebugInfo()` passthroughs added, mirroring the existing `getFlowState()` passthrough shape.
- `TestGame.getActionSpaceWithChoices(seat)` surfaces a seat's full action space with every selection's enabled AND disabled choices (each disabled choice carrying its reason) in one call — built entirely on existing `Game.getActionSpace()` + `Game.getSelectionChoices()` (v2.8 `AnnotatedChoice.disabled`), no parallel evaluator. `pick-handler.ts` verified untouched.
- `GameStuckError` (all 4 throw sites in `playUntilComplete`), `assertActionAvailable`'s two failure messages, and `toDebugString(game)` all now embed the readable flow position via `getFlowDebugInfo().describe()`. `GameStuckError`'s class shape is unchanged — only message text was enriched.
- Rule 3 fix: `FlowDebugInfo` (added in Plan 01) was never exported from `flow/index.ts`/`engine/index.ts`, which blocked this plan's imports — exported it in both barrels.

## Task Commits

Each task was committed atomically:

1. **Task 1: GameRunner pending-action tracking + TestGame.getPendingAction(seat) (FLOW-03)** - `951ed93` (feat)
2. **Task 2: Disabled-choices introspection helper on TestGame (FLOW-02)** - `6851049` (feat)
3. **Task 3: Embed readable flow position in GameStuckError/assertActionAvailable/toDebugString (FLOW-01)** - `43d0095` (feat)

**Plan metadata:** (this commit, following this Summary)

## Files Created/Modified

- `src/runtime/runner.ts` - `pendingActions` Map + `startPendingAction`/`processSelectionStep`/`getPendingAction`/`getFlowDebugInfo`/private `completePendingAction`
- `src/testing/test-game.ts` - `getPendingAction`, `getFlowDebugInfo`, `getActionSpaceWithChoices` passthroughs/helpers + new `ActionSpaceWithChoicesView`/`ActionChoicesView`/`SelectionChoicesView` interfaces
- `src/testing/test-game.test.ts` - New fixtures (`MultiStepGame`, `DisabledChoiceGame`) + tests for pending-action snapshot correctness/immutability/out-of-range, flow-debug-info passthrough, disabled-choice surfacing
- `src/testing/simulate-action.ts` - All 4 `GameStuckError` throw sites in `playUntilComplete` append a `Flow position: ...` line
- `src/testing/assertions.ts` - `assertActionAvailable`'s two failure messages append the flow-position line
- `src/testing/assertions.test.ts` - New test asserting the failure message contains `Flow position:`
- `src/testing/debug.ts` - `toDebugString` adds a `Flow position: ...` line sourced from `game.getFlowDebugInfo().describe()`
- `src/testing/debug.test.ts` (new) - First test file for `debug.ts`; covers `toDebugString`'s flow-position line and its "no active flow" degradation
- `src/engine/index.ts`, `src/engine/flow/index.ts` - Export `FlowDebugInfo` type (Rule 3 fix)

## Decisions Made

- A2 (RESEARCH Open Question 2) resolved as **reuse** `createPendingActionState`, confirmed empirically by tracing `action.test.ts:1684-1757` — see frontmatter `key-decisions` for full evidence trail. Task 1 was NOT split (scope note in the plan's objective did not trigger).
- GameRunner needed genuinely new `startPendingAction`/`processSelectionStep` methods, not just a `getPendingAction` passthrough, because `performAction` is always a single synchronous full-args call with no existing mid-flight observation point. `ActionBuilder` was left untouched (still all-args-at-once); the new state machine is exercised directly via the public `testGame.runner` in tests.
- `getActionSpaceWithChoices` intentionally fetches choices with empty upstream args, documented as a known limitation for `dependsOn`/`filterBy` selections (use `ActionBuilder` for those).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `FlowDebugInfo` from `engine/flow/index.ts` and `engine/index.ts`**
- **Found during:** Task 1 (GameRunner pending-action tracking)
- **Issue:** Plan 01 added the `FlowDebugInfo` interface to `flow/types.ts` and used it internally in `game.ts`, but never re-exported it through either public barrel (`flow/index.ts`, `engine/index.ts`). This blocked `import type { FlowDebugInfo } from '../engine/index.js'` in `runner.ts`/`test-game.ts`.
- **Fix:** Added `FlowDebugInfo` to the `export type {...}` list in both `src/engine/flow/index.ts` and `src/engine/index.ts`, alongside the existing `FlowState`/`FlowDefinition` exports.
- **Files modified:** `src/engine/flow/index.ts`, `src/engine/index.ts`
- **Verification:** `npx tsc --noEmit` shows no new errors from `runner.ts`/`test-game.ts`; full suite green.
- **Committed in:** `951ed93` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for Task 1 to compile at all; zero scope creep — a straight missing-export fix.

## Issues Encountered

- First test-game.test.ts fixture for the pending-action tests used `loop({ while: () => false, maxIterations: 10, do: eachPlayer(...) })` (copied from the existing `FixtureGame` pattern in the same file), which caused the flow to complete immediately with `awaitingInput: false` (loop `while` is checked BEFORE the body runs, so `while: () => false` means zero iterations). Fixed by using `while: () => true, maxIterations: 1` so `eachPlayer` runs exactly once. This surfaced during Task 1 test-writing, not by RESEARCH/interfaces — a plain fixture-authoring bug, fixed inline before commit.
- `toEqual()` on two `FlowDebugInfo` objects false-failed in the `getFlowDebugInfo` passthrough test because `describe()` is a fresh closure per call (functions are never reference-equal in `toEqual`). Fixed by comparing structural fields (`phase`/`step`/`path`/`awaiting`) plus the formatted `describe()` string separately.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FLOW-01/FLOW-02/FLOW-03 fully satisfied through the testing layer: `TestGame.getFlowDebugInfo()`, `TestGame.getPendingAction()`, `TestGame.getActionSpaceWithChoices()`, and enriched `GameStuckError`/`assertActionAvailable`/`toDebugString` messages.
- Full BoardSmith suite green: 142 test files, 1896 tests passing (`npm test`).
- `pick-handler.ts` verified untouched (`git diff --stat` clean) — gameplay disabled-choice rejection path unaffected.
- Phase 125 (headless simulation) and the dev-host devtools bridge can now rely on the same `FlowDebugInfo`/`PendingActionState` introspection surface the testing layer exposes.

## Self-Check: PASSED

All created/modified files verified present on disk; all task commits (`951ed93`, `6851049`, `43d0095`) verified present in git log.

---
*Phase: 123-determinism-flow-introspection*
*Completed: 2026-07-01*
