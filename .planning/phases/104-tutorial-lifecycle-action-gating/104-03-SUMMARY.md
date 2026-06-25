---
phase: 104-tutorial-lifecycle-action-gating
plan: 03
subsystem: ui
tags: [vue, composable, tutorial, auto-fill, tdd]

# Dependency graph
requires:
  - phase: 104-tutorial-lifecycle-action-gating
    plan: 01
    provides: "TutorialStep.suppressAutoFill and TutorialStepView types (named client-projection contract)"

provides:
  - "useActionController.tryAutoFillSelection respects TutorialStepView.suppressAutoFill — taught selections are NOT auto-filled"
  - "suppressAutoFillFor field on TutorialStep / TutorialStepView for per-selection scoping"
  - "tutorialStep option on UseActionControllerOptions threading the active step to the composable"
  - "isTutorialSuppressingAutoFill() guard wired into both auto-fill paths (start and fill inline)"
  - "Three-case test coverage: Case A (default unchanged), Case B (step-wide suppressed), Case C (scoped to one selection)"

affects:
  - "104-04: buildPlayerState must populate PlayerGameState.tutorial to activate this substrate"
  - "Phase 105: annotation overlay consumer of TutorialStepView.content shares the same tutorialStep option wire"
  - "Phase 109: checkers tutorial content authors set suppressAutoFill on steps that teach click interactions"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isTutorialSuppressingAutoFill(): read TutorialStepView from options.tutorialStep Ref, check scoping via suppressAutoFillFor"
    - "Tutorial suppression is an additional per-selection gate layered on top of the existing getAutoFill() global knob"
    - "Both auto-fill paths (tryAutoFillSelection for start() and fill() inline check for next-selection) share the same guard"

key-files:
  created: []
  modified:
    - src/engine/tutorial/types.ts
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useActionController.ts
    - src/ui/composables/useActionController.helpers.ts
    - src/ui/composables/useActionController.test.ts

key-decisions:
  - "suppressAutoFillFor? string field added to TutorialStep and TutorialStepView for per-selection scoping (not in 104-01 types)"
  - "isTutorialSuppressingAutoFill() is a private composable helper — not exposed on the UseActionControllerReturn surface"
  - "Guard wired into BOTH auto-fill paths (tryAutoFillSelection and fill() inline) so step-wide suppression covers multi-selection actions"
  - "tutorialStep imported into useActionControllerTypes.ts from engine/tutorial/types.ts (UI importing engine types is the correct dependency direction)"

patterns-established:
  - "Pattern: Per-step tutorial signals from PlayerGameState.tutorial propagate to the UI composable via Ref<TutorialStepView | undefined> option"

requirements-completed: [TUT-02]

# Metrics
duration: 20min
completed: 2026-06-25
---

# Phase 104 Plan 03: Tutorial Auto-Fill Suppression Summary

**Per-selection `suppressAutoFill` guard wired into `useActionController.tryAutoFillSelection` so tutorial steps can preserve the learner's click when a single enabled choice would otherwise auto-resolve**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-25T20:14:00Z
- **Completed:** 2026-06-25T20:26:00Z
- **Tasks:** 2 (TDD)
- **Files modified:** 5

## Accomplishments

- Added `suppressAutoFillFor?: string` to `TutorialStep` and `TutorialStepView` for per-selection scoping of suppression
- Added `tutorialStep?: Ref<TutorialStepView | undefined>` to `UseActionControllerOptions` as the composable's channel to the active tutorial step
- Implemented `isTutorialSuppressingAutoFill()` private guard and wired it into both auto-fill paths in `useActionController.ts`
- Added `twoStepSingle` test action to helpers (two required single-choice selections for Case C)
- Three new test cases cover the full matrix: Case A (default unchanged), Case B (step-wide suppression), Case C (scoped to one selection while the other auto-fills)
- Full test suite 1286/1286 green with no regressions

## Task Commits

1. **Task 1 RED (types + tests)** - `75ae099` (test): add failing tests for tutorial auto-fill suppression
2. **Task 1/2 GREEN (implementation)** - `0d789bb` (feat): honor suppressAutoFill in tryAutoFillSelection

## Files Created/Modified

- `src/engine/tutorial/types.ts` — Added `suppressAutoFillFor?: string` to `TutorialStep` and `TutorialStepView`
- `src/ui/composables/useActionControllerTypes.ts` — Added `TutorialStepView` import and `tutorialStep` option to `UseActionControllerOptions`
- `src/ui/composables/useActionController.ts` — Added `isTutorialSuppressingAutoFill()` helper and wired guard into `tryAutoFillSelection` and `fill()` inline auto-fill
- `src/ui/composables/useActionController.helpers.ts` — Added `twoStepSingle` test action (two required single-choice selections)
- `src/ui/composables/useActionController.test.ts` — Added `TutorialStepView` import, `twoStepSingle` to `availableActions`, and `describe('tutorial suppressAutoFill')` block with Cases A, B, C

## Decisions Made

- Added `suppressAutoFillFor?: string` to both `TutorialStep` and `TutorialStepView` even though 104-01 defined the types. The plan explicitly required per-selection scoping, and the field is a natural extension of the existing `suppressAutoFill` boolean with no backward-compat concern.
- The guard (`isTutorialSuppressingAutoFill`) is private to `useActionController` — not part of `UseActionControllerReturn`. It's an internal coordination mechanism, not a public API surface.
- Added the check to the inline auto-fill in `fill()` (not just `tryAutoFillSelection`) so step-wide suppression (`suppressAutoFill: true`, no `suppressAutoFillFor`) also covers the next-selection auto-fill that fires after the user manually fills a selection. Without this, a step-wide suppression would only suppress the first selection's initial auto-fill, not subsequent ones.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended auto-fill suppression check to fill() inline auto-fill path**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified wiring into `tryAutoFillSelection` (used by `start()` / `fetchAndAutoFill`). The `fill()` function has a SECOND inline auto-fill check for the NEXT selection (lines ~1225-1239) that is NOT routed through `tryAutoFillSelection`. If only `tryAutoFillSelection` got the guard, a step-wide `suppressAutoFill: true` would fail to suppress the next-selection auto-fill after the user manually fills one selection.
- **Fix:** Added `&& !isTutorialSuppressingAutoFill(nextSel.name)` to the inline auto-fill condition in `fill()`
- **Files modified:** `src/ui/composables/useActionController.ts`
- **Verification:** Case C tests both paths; step-wide suppression (Case B) only has one selection so the fill() path isn't exercised, but correctness is maintained for any future two-selection step with step-wide suppression
- **Committed in:** `0d789bb` (GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical correctness)
**Impact on plan:** Essential for correctness of step-wide suppression across multi-selection actions. No scope creep.

## Issues Encountered

None. The pre-existing TypeScript errors in `src/engine/element/image-leak.test.ts` and other unrelated test files are pre-existing; none were introduced by this plan's changes.

## Next Phase Readiness

- The `tutorialStep` option is wired and proven. The full session→UI integration trace (real `PlayerGameState.tutorial` from `buildPlayerState` flowing through to the composable) is explicitly deferred to Plan 104-04 per the plan's `<note>`.
- Plan 104-04 must populate `PlayerGameState.tutorial` (the `TutorialStepView` projection) in `buildPlayerState` — at that point the substrate from this plan becomes end-to-end active.
- No blockers for 104-04.

## Self-Check: PASSED

- `src/ui/composables/useActionController.ts` modified with guard: FOUND
- `src/ui/composables/useActionController.test.ts` with 3 tutorial test cases: FOUND
- Commits `75ae099` (RED) and `0d789bb` (GREEN): FOUND
- 1286/1286 tests green: CONFIRMED
