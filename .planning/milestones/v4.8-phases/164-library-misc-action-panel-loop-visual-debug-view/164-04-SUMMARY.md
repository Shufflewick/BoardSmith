---
phase: 164-library-misc-action-panel-loop-visual-debug-view
plan: 04
subsystem: ui
tags: [vue3, gameshell, time-travel, debug-panel, useBoardActionBridge, pit-of-success]

# Dependency graph
requires:
  - phase: 164-03
    provides: platformActionPanelEscapeHatch rename + allDockActionsSuppressed (independent, same file — no direct code dependency)
provides:
  - "GameShell.displayedState computed — single source of truth for the board's displayed state (historical during time-travel, live otherwise), re-wrapping the shallower historical PlayerGameState into the GameState shape"
  - "useBoardActionBridge BoardActionBridgeOptions.isViewingHistory — independent early-return guard in all four mutating functions (startAction, executeAction, setSelectionValue, toggleMultiSelectValue)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shape-mismatch re-wrap: when two data sources are the same logical value at different nesting depths (GameState vs PlayerGameState), a single computed re-wraps the shallower one into the deeper shape at its declaration site, so no downstream consumer needs a shape-aware branch (mirrors the existing gameView computed)."
    - "Defense-in-depth guard placement: a security/correctness invariant (no live-engine mutation while viewing history) is enforced independently at EVERY mutating entry point, not derived from a compound condition (isMyTurn && !isViewingHistory) that a mid-flow state (a pick already in progress) could bypass."

key-files:
  created:
    - src/ui/components/GameShell.time-travel-desync.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/composables/useBoardActionBridge.ts
    - src/ui/composables/useBoardActionBridge.test.ts
    - src/ui/composables/interaction-integration.test.ts

key-decisions:
  - "displayedState computed placed directly next to gameView (same re-wrap pattern, same file location) rather than a separate composable — GameShell already owns state/timeTravelState/gameView, so the new computed stays colocated with its inputs."
  - "isViewingHistory guarded independently in ALL FOUR mutating bridge functions, not derived from isMyTurn && !isViewingHistory — setSelectionValue/toggleMultiSelectValue never re-check isMyTurn mid-action, so a compound condition would leave a mid-pick-then-time-travel gap (RESEARCH's named anti-pattern)."
  - "Existing useBoardActionBridge.test.ts and interaction-integration.test.ts call sites updated to pass isViewingHistory: ref(false) (new required option) rather than making it optional-with-a-default — an omitted history guard on a live-engine mutation path should be a type error, not a silent default (Pit of Success)."

patterns-established:
  - "Re-wrap-at-the-boundary: any future GameShell computed that needs to unify a live vs. historical/alternate data source of a slightly different shape should re-wrap at ONE declaration site (like gameView/displayedState), not push shape-awareness into every consumer."

requirements-completed: [LIBX-04, PROC-01]

duration: 6min
completed: 2026-07-21
---

# Phase 164 Plan 04: Time-Travel Debug-View #game-board Desync Summary

**Unified GameShell's board + sidebar-extra `:state` slots on a single `displayedState` computed (historical during time-travel, live otherwise) and gated all four `useBoardActionBridge` mutating functions on `isViewingHistory`, so a board click during time-travel is now a defense-in-depth inert no-op instead of a possible live-engine mutation.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-21T15:03:20-05:00 (prior plan's completion commit, session start)
- **Completed:** 2026-07-21T15:09:14-05:00
- **Tasks:** 2/2 completed
- **Files modified:** 5 (1 new test file, 4 modified source/test files)

## Accomplishments
- Added `displayedState` computed to `GameShell.vue`, mirroring the existing `gameView` computed's normalization pattern: re-wraps the historical (one-level-shallower) `PlayerGameState` from `timeTravelState` into the `GameState`-shaped object every `:state` consumer already expects, eliminating the shape-aware branching risk.
- Replaced `:state="state"` with `:state="displayedState"` at all THREE required sites (`#sidebar-extra`, the dynamic-component board branch, the `#game-board` slot fallback branch) — grep-verified count dropped from 4 to exactly 1 (`DebugPanel`, which correctly stays live as the time-travel control surface).
- Added `isViewingHistory` to `useBoardActionBridge`'s `BoardActionBridgeOptions` and an independent `if (isViewingHistory.value) return;` guard as the first line of all four mutating functions (`startAction`, `executeAction`, `setSelectionValue`, `toggleMultiSelectValue`) — a board click, a fresh action start, a selection fill, and a multi-select toggle are all inert no-ops while viewing history, verified against the REAL composable (not a mock) including a mid-pick-then-time-travel adversarial case.
- Wired GameShell's existing `isViewingHistory` computed into the `useBoardActionBridge({...})` call site.

## Task Commits

Each task was committed atomically:

1. **Task 1: displayedState computed + unify all three board/sidebar :state sites** - `35734cf8` (feat)
2. **Task 2: isViewingHistory guard on all four mutating bridge functions** - `a6c1caef` (feat)

**Plan metadata:** (this commit, follows)

_Note: both tasks were TDD (`tdd="true"`); source + test were committed together in each atomic task commit, matching plan 164-03's established convention for this phase._

## Files Created/Modified
- `src/ui/components/GameShell.vue` - New `displayedState` computed next to `gameView`; `:state="state"` → `:state="displayedState"` at 3 sites (sidebar-extra, dynamic-component board, `#game-board` slot); `isViewingHistory` passed into the `useBoardActionBridge({...})` call
- `src/ui/composables/useBoardActionBridge.ts` - `isViewingHistory: Ref<boolean> | ComputedRef<boolean>` added to `BoardActionBridgeOptions`; `if (isViewingHistory.value) return;` guard added to `startAction`, `executeAction`, `setSelectionValue`, `toggleMultiSelectValue`
- `src/ui/components/GameShell.time-travel-desync.test.ts` - New file (PROC-01): harness proving both board-render branches (dynamic-component + slot) show historical state during time-travel and restore to live on exit; direct tests against the real `useBoardActionBridge` proving all four mutators are inert no-ops during history (including the mid-pick-then-time-travel case) with live behavior unregressed; source-string assertions confirming the exact `:state` site counts and the `isViewingHistory` wiring in both files
- `src/ui/composables/useBoardActionBridge.test.ts` - Existing 20 call sites of `useBoardActionBridge({...})` updated to pass `isViewingHistory: ref(false)` (new required option; behavior unchanged)
- `src/ui/composables/interaction-integration.test.ts` - Existing 4 call sites updated to pass `isViewingHistory: ref(false)` (new required option; behavior unchanged)

## Decisions Made
- `displayedState` re-wraps at its single declaration site (`state.value ? { ...state.value, state: timeTravelState.value } : null`) rather than pushing a shape-aware branch into every board/sidebar consumer — mirrors `gameView`'s existing pattern exactly.
- `isViewingHistory` guards are independent per-function, not composed with `isMyTurn` — `setSelectionValue`/`toggleMultiSelectValue` have no turn re-check today, so a compound condition would leave the mid-pick-then-time-travel gap the RESEARCH doc explicitly warned against. The plan's own test covers this adversarial case directly.
- Made `isViewingHistory` a required (not optional-with-default) field on `BoardActionBridgeOptions` — an author forgetting to wire the history guard on a live-mutation entry point should be a compile error, not a silently-defaulted `false`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing `useBoardActionBridge` consumers (test files) broken by the new required option**
- **Found during:** Task 2 verification (`npx vitest run src/ui/composables/useBoardActionBridge.test.ts`)
- **Issue:** Adding `isViewingHistory` as a required field on `BoardActionBridgeOptions` (correct per Pit of Success — no silent default) broke every existing call site that didn't pass it: `useBoardActionBridge.test.ts` (20 call sites) threw `Cannot read properties of undefined (reading 'value')` inside `tryAutoStartSingleAction`'s auto-start path, and `interaction-integration.test.ts` (4 call sites) had the same latent break (caught before it could regress in the full-suite run).
- **Fix:** Added `isViewingHistory: ref(false),` to all 24 existing call sites across both files (scripted with a Python regex pass, then hand-verified against both the multi-line and single-line call-site shapes).
- **Files modified:** `src/ui/composables/useBoardActionBridge.test.ts`, `src/ui/composables/interaction-integration.test.ts`
- **Verification:** Both files green (19/19 and 6/6 respectively) after the fix; full suite green.
- **Committed in:** `a6c1caef` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 - bug, caused directly by Task 2's own required-option addition, same file family, zero scope creep)
**Impact on plan:** Necessary correctness fix for a break the plan's own Task 2 change introduced in sibling test files; no unrelated code touched.

## Issues Encountered
- TypeScript overload-resolution errors in the new test file's `computed()`/`h()` calls (a `ReturnType<typeof ref<T>>` parameter type and an inferred `h()` props object) — fixed by typing the helper's parameters as plain `Ref<T>` and casting the dynamic `h()` props object to `Record<string, unknown>`. Confirmed via a baseline diff (`git checkout` to the pre-plan commit and back) that the repo's pre-existing 88 `tsc --noEmit` errors are unchanged — no new errors introduced by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LIBX-04 fully closed: the board/sidebar `:state` desync is eliminated at the source (single `displayedState` computed) and the action-bridge mutators are independently guarded (defense in depth) — a board click during time-travel is now provably inert at both the display layer and the commit layer.
- Full suite green: 3007 tests / 214 files passing (baseline ~2923; growth reflects prior 164-0{1,2,3} plans' new tests plus this plan's 8 new test cases across the 4 mutator guards + 11 displayedState/source-assertion cases).
- `npx tsc --noEmit`: 88 pre-existing errors, unchanged by this plan (confirmed via before/after diff).
- Phase 164 (LIBX-01 through LIBX-04, all four independent single-game library defects) is now fully delivered across plans 01-04.

## Self-Check

- `test -f src/ui/components/GameShell.vue && grep -q "const displayedState = computed" src/ui/components/GameShell.vue` → FOUND
- `test -f src/ui/composables/useBoardActionBridge.ts && grep -q "isViewingHistory" src/ui/composables/useBoardActionBridge.ts` → FOUND
- `test -f src/ui/components/GameShell.time-travel-desync.test.ts` → FOUND
- `grep -c ':state="displayedState"' src/ui/components/GameShell.vue` → 3
- `grep -c ':state="state"' src/ui/components/GameShell.vue` → 1
- `grep -c "isViewingHistory.value) return" src/ui/composables/useBoardActionBridge.ts` → 4
- Commit `35734cf8` → FOUND in `git log --oneline --all`
- Commit `a6c1caef` → FOUND in `git log --oneline --all`

## Self-Check: PASSED

---
*Phase: 164-library-misc-action-panel-loop-visual-debug-view*
*Completed: 2026-07-21*
