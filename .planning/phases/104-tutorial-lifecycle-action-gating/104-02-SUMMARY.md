---
phase: 104-tutorial-lifecycle-action-gating
plan: "02"
subsystem: engine/tutorial
tags: [tutorial, action-gating, disabled-path, tdd, tut-02]
dependency_graph:
  requires: ["104-01"]
  provides: ["getActiveStep", "getGateReasonForValue", "getActionLevelDisabledReasons", "getTutorialDisabledActions"]
  affects:
    - src/engine/action/action.ts
    - src/engine/element/game.ts
tech_stack:
  added: []
  patterns:
    - "OR-in gate disabled reason into existing v2.8 AnnotatedChoice.disabled path"
    - "Optional actionName param propagated through hasValidSelectionPath / validateSelection"
    - "type-only import of Game in gate.ts avoids runtime circular dependency"
key_files:
  created:
    - src/engine/tutorial/gate.ts
    - src/engine/action/tutorial-gate.test.ts
  modified:
    - src/engine/action/action.ts
    - src/engine/element/game.ts
decisions:
  - "Per-value gating skips predicate gates (predicate has no value parameter); predicate gates apply action-level only via getTutorialDisabledActionsForSeat"
  - "actionName optional param (not stored on executor) keeps getChoices stateless and thread-safe"
  - "gate.ts uses import type { Game } so no runtime circular dep: game.ts->gate.ts->type Game"
metrics:
  duration: "~30 minutes"
  completed: "2026-06-25"
  tasks: 3
  files: 4
---

# Phase 104 Plan 02: Tutorial Gate Evaluation Summary

Tutorial action/target gating delivered entirely inside the engine's existing v2.8 disabled path — no parallel validator. All downstream consumers (validation, availability, UI metadata, pick-handler) inherit the gate for free.

## What Was Built

**`src/engine/tutorial/gate.ts`** — Pure, cycle-free gate-evaluation helpers:
- `getActiveStep(game, seat)`: resolves the running tutorial step for a seat (null when no tutorial active, zero overhead in normal play)
- `getGateReasonForValue(step, actionName, value)`: returns a disabled reason string when the value is not in the step's allow-list `from`/`to` set, null when allowed; supports both allow-list and predicate gate forms
- `getActionLevelDisabledReasons(game, seat, availableActionNames)`: returns `Record<actionName, reason>` for available actions excluded by the active step (the net-new surface called out in RESEARCH Pitfall 3)

**`src/engine/action/action.ts`** — Gate wired into the existing disabled path:
- `getChoices` receives optional `actionName?: string`; when provided, ORs in gate reason per choice (after game-defined `disabled` is checked — never overrides an existing reason)
- `validateSelection` receives optional `actionName?`; passes to `getChoices` so disabled-first check at line 678 catches gated values with their reason
- `hasValidSelectionPath` receives optional `actionName?` and propagates through all recursive calls; gated actions remain available when ≥1 enabled choice exists
- `isActionAvailable` passes `action.name` to `hasValidSelectionPath`
- `validateAction` passes `action.name` to `validateSelection`
- `processSelectionStep` passes `action.name` to `validateSelection`

**`src/engine/element/game.ts`** — New method + wired caller:
- `getTutorialDisabledActions(seat: number): Record<string, string>` — sibling to `getAvailableActions`, delegates to `getActionLevelDisabledReasons`; gated actions remain in `getAvailableActions` (binary, unchanged per Pitfall 3)
- `getSelectionChoices` now passes `actionName` to `getChoices` so UI gets gate annotations

**`src/engine/action/tutorial-gate.test.ts`** — 21 tests covering all 5 TUT-02 behaviors:
1. Out-of-step action (`pass`) appears in `getTutorialDisabledActions` with a reason; allowed action (`move`) does not
2. Target gating: allowed target (`d4`) enabled, non-allowed (`f6`) disabled with reason string
3. `hasValidSelectionPath` keeps `move` available when ≥1 enabled target exists
4. `validateSelection` rejects non-allowed target with "Selection disabled: <reason>"
5. No tutorial → fully inert (all choices enabled, empty map)
6. Also: predicate gate escape hatch, completed/exited status lifts gate, per-seat isolation (player 2 unaffected)

## Test Results

- `npx vitest run src/engine/action/tutorial-gate.test.ts` — 21/21 passed
- `npx vitest run src/engine/action` — 141/141 passed (120 pre-existing + 21 new)
- `npx vitest run src/engine` — 438/438 passed (zero regressions)

## Deviations from Plan

**None** — plan executed exactly as written.

The only implementation decision was to add `actionName` as an optional parameter to `getChoices`, `validateSelection`, and `hasValidSelectionPath` (propagated through all recursive calls). This keeps the gate evaluation stateless and avoids storing executor-level state. Existing callers that don't pass `actionName` get no gating behavior, preserving byte-identical output for normal play (success criterion — Behavior 5 test verifies this explicitly).

## Known Stubs

None. This plan implements the gate evaluation layer only. The session-layer consumer (`buildPlayerState`, `PlayerGameState.disabledActions`) is reserved for Plan 104-04 per the dependency graph. The engine gate itself is complete.

## Threat Flags

None. T-104-03 (tampered target) is mitigated: `validateSelection` checks `disabled` FIRST (action.ts:678) and rejects server-side with the gate reason. T-104-04 (gating mistaken for auth) is accepted per the threat register — the existing `canPlayerAct` / seat-activity remains the authority.

## Self-Check

- [x] `src/engine/tutorial/gate.ts` exists and exports 3 functions
- [x] `src/engine/action/tutorial-gate.test.ts` exists with 21 tests
- [x] `src/engine/action/action.ts` modified (getChoices, validateSelection, hasValidSelectionPath, isActionAvailable, validateAction, processSelectionStep)
- [x] `src/engine/element/game.ts` modified (getTutorialDisabledActions added, getSelectionChoices updated)
