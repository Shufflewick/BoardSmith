---
phase: 106-predicate-triggers-ci-verifiable-authoring
plan: "01"
subsystem: engine/tutorial
tags: [tutorial, predicates, MR-02, MR-03, evaluator]
dependency_graph:
  requires: []
  provides: [evaluateConditionWithTrace-export, TutorialGateCondition, TutorialAdvanceCondition, progress.ts]
  affects: [src/engine/tutorial, src/engine/action, src/session/types.ts]
tech_stack:
  added: []
  patterns: [generic-evaluator, labeled-condition-record, forward-only-pump]
key_files:
  created:
    - src/engine/tutorial/progress.ts
    - src/engine/tutorial/gate.test.ts
    - src/engine/tutorial/progress.test.ts
  modified:
    - src/engine/action/action.ts
    - src/engine/tutorial/types.ts
    - src/engine/tutorial/gate.ts
    - src/engine/action/tutorial-gate.test.ts
    - src/session/types.ts
decisions:
  - "Generic evaluateConditionWithTrace<Ctx> via single function with no overloads — TypeScript infers Ctx from both arguments"
  - "TutorialGateCondition and TutorialAdvanceCondition are type aliases for the same Record shape, both exported separately for clarity"
  - "isAllowListGate discriminates via typeof gate.action === 'string' — safe because TutorialGateCondition values are always functions, never 'string'"
  - "autoAdvanceTutorial is bounded by def.steps.length iterations, making even a runaway always-true predicate terminate at tutorial completion"
  - "validateTutorialDefinition operates on the raw definition object (not after type narrowing) so it catches runtime shape violations from game authors who bypass TypeScript"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-26T04:37:29Z"
  tasks_completed: 2
  tests_added: 34
  files_created: 3
  files_modified: 5
---

# Phase 106 Plan 01: Predicate Substrate + MR-02/MR-03 Summary

**One-liner:** Context-generic `evaluateConditionWithTrace<Ctx>` exported; tutorial gates and `advanceWhen` unified to labeled `ObjectCondition` records; `progress.ts` delivers the bounded auto-advance pump and fail-loud validation.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Shared evaluator + labeled types + MR-02 gate refactor | b54f417 | action.ts, types.ts, gate.ts, gate.test.ts, tutorial-gate.test.ts, session/types.ts |
| 2 | progress.ts — step-transition, pump, validation | 6f89766 | progress.ts, progress.test.ts |

## What Was Built

### Task 1 — Shared evaluator + MR-02 fix

`evaluateConditionWithTrace` in `action.ts` was made generic (`<Ctx>`) and exported. Previously it was a module-private function typed to `ActionContext` only. All action-side callers (`evaluateCondition`, `traceActionAvailability`) still delegate to it and typecheck identically.

`TutorialGatePredicate` (bare `(ctx) => boolean`) was replaced with:
- `TutorialGateCondition = Record<string, (ctx: TutorialGateContext) => boolean>` — labeled predicate record, same shape as action `ObjectCondition`
- `TutorialAdvanceCondition` — alias of the same shape for `advanceWhen`
- `TutorialGate = TutorialGateAllowList | TutorialGateCondition` — updated union

In `gate.ts`:
- Added `isAllowListGate(gate)` type guard (checks `typeof gate.action === 'string'`)
- `getGateReasonForValue`: uses `isAllowListGate` instead of `typeof gate === 'function'`
- `getActionLevelDisabledReasons`: labeled-condition branch evaluates via `evaluateConditionWithTrace({ game, seat })` and surfaces the **first failing label** in the reason string (MR-02 fix)

`session/types.ts` re-exports updated: `TutorialGatePredicate` removed, `TutorialGateCondition` + `TutorialAdvanceCondition` added.

Existing tests in `tutorial-gate.test.ts` updated from bare-function gates to labeled-condition form (no backward compatibility).

### Task 2 — progress.ts

New `src/engine/tutorial/progress.ts` with five exported functions:

- **`initialProgress(def)`** — returns `{ stepId: steps[0].id, status: 'running' }`; throws if empty
- **`nextProgress(def, currentStepId)`** — pure forward transition; `{ stepId: last, status: 'completed' }` when past end
- **`evaluateAdvanceWhen(game, seat)`** — resolves active step via `getActiveStep`, evaluates `advanceWhen` via shared evaluator; `{ fired: false }` when absent
- **`autoAdvanceTutorial(game, seat)`** — bounded pump (≤ `def.steps.length` iterations), forward-only, terminates on completion; sole writer to `game.tutorialProgress` for auto-advance
- **`validateTutorialDefinition(def)`** — throws actionable error on empty steps, non-function gate values, non-function/non-object `advanceWhen`; names the offending step and field

## Test Coverage

- `gate.test.ts` (new, 9 tests): labeled predicate gate blocks with failing label in reason; passing predicate permits; allow-list unchanged; no per-value gating for condition gates
- `progress.test.ts` (new, 24 tests): all five functions; 3-step pump chain (steps 1+2 always-true → lands on step-3, does NOT complete); bounded runaway test; `validateTutorialDefinition` throws on empty/non-function
- Full suite: **1405 tests, all passing** (was 1371 before this plan; +34 new)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing tutorial-gate.test.ts used the old bare-function gate API**
- **Found during:** Task 1 — tests failed after `typeof gate === 'function'` checks were removed
- **Issue:** `gate: (_ctx) => false` is now an empty `TutorialGateCondition` record (functions have no Object.entries), so the gate passed instead of blocking
- **Fix:** Updated all three predicate-gate test cases to use labeled form `{ 'must be player turn': (_ctx) => false }`. Added a new test case verifying the failing label appears in the reason string.
- **Files modified:** `src/engine/action/tutorial-gate.test.ts`
- **Commit:** b54f417

## Known Stubs

None. All functions are fully implemented; `advanceWhen` is narrowed from `unknown` to `TutorialAdvanceCondition`.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The `evaluateConditionWithTrace` generic wrapper is purely in-process. T-106-01 (predicate mutation): handled — context is read-only `{ game, seat }` with no mutation API. T-106-02 (infinite loop): handled — `autoAdvanceTutorial` is bounded by `def.steps.length`. T-106-03 (predicate throws): handled — `evaluateConditionWithTrace` try/catch treats throws as `passed=false`.

## Self-Check: PASSED

- `/Users/jtsmith/BoardSmith/src/engine/tutorial/progress.ts` — exists
- `/Users/jtsmith/BoardSmith/src/engine/tutorial/gate.test.ts` — exists
- `/Users/jtsmith/BoardSmith/src/engine/tutorial/progress.test.ts` — exists
- Commit b54f417 — verified in git log
- Commit 6f89766 — verified in git log
- `export function evaluateConditionWithTrace<Ctx>` at action.ts:40 — verified
- No `typeof gate === 'function'` in gate.ts — verified
- `advanceWhen?: TutorialAdvanceCondition` in types.ts — verified
- Full suite: 1405/1405 passing — verified
