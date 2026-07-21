---
phase: 164-library-misc-action-panel-loop-visual-debug-view
fixed_at: 2026-07-21T21:00:00Z
review_path: .planning/phases/164-library-misc-action-panel-loop-visual-debug-view/164-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 1
status: partial
---

# Phase 164: Code Review Fix Report

**Fixed at:** 2026-07-21T21:00:00Z
**Source review:** .planning/phases/164-library-misc-action-panel-loop-visual-debug-view/164-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (per fix_direction): 6 (CR-01, CR-02, WR-01, WR-02, WR-03, IN-02)
- Fixed: 6
- Skipped: 1 (IN-01, intentionally out of scope per instructions)

**Full suite after fixes:** `npm run test` — 214 test files, 3032 tests, all green.

## Fixed Issues

### CR-01: LIBX-04 time-travel commit guard does not cover the ActionPanel / auto-execute path

**Files modified:** `src/ui/components/GameShell.vue`, `src/ui/composables/useActionController.ts`, `src/ui/composables/useActionControllerTypes.ts`, `src/ui/composables/useActionController.test.ts`
**Commit:** f9df8b3c
**Applied fix:** Threaded `isViewingHistory` into `useActionController` itself (new optional `UseActionControllerOptions.isViewingHistory: Ref<boolean>`, defaults to `false` when unwired) and gated the shared chokepoints every commit path funnels through: `fill()`, `start()`, the internal auto-execute `watch(isReady, ...)`, and `executeCurrentAction()` (last-line-of-defense). GameShell now passes its existing `isViewingHistory` computed into `useActionController({ ... isViewingHistory })`. Since `confirmMultiSelect()`/`toggleMultiSelect()`'s auto-confirm path routes through `fill()`, this single set of guards covers ActionPanel's `setSelectionValue`/`toggleMultiSelectValue`/`startAction` as well, without re-implementing the guard per caller. Added 4 new tests in `useActionController.test.ts` reproducing the reviewed repro (start → fill one selection → enter history → confirm the remaining fill/auto-execute never reaches `sendAction`).

### CR-02: `contrastInk()` crashes `PlayerToken` render for any non-hex/rgb color string

**Files modified:** `src/ui/utils/color-contrast.ts`, `src/ui/utils/color-contrast.test.ts`, `src/ui/components/PlayerToken.vue`, `src/ui/components/PlayerToken.contrast.test.ts`
**Commit:** 8301ab2a (combined with WR-03, same root cause / same touched files)
**Applied fix:** Extended `parseColor()` to also accept the 148 standard CSS named colors and `hsl()`/`hsla()`, keeping `contrastInk()`'s fail-loud contract for genuinely unparseable input (the pure WCAG helper stays throwing/testable, per its own docstring). `PlayerToken.vue`'s `ink` computed now wraps the `contrastInk()` call in try/catch, degrading to `DEFAULT_INK` and emitting a one-time actionable `devWarn` (naming the offending color + accepted formats) instead of letting the throw propagate into the render path. Added tests for a named color, `hsl()`, and PlayerToken's crash-guard (renders, warns once, never throws).

### WR-01: `allDockActionsSuppressed` removes ActionPanel's keyboard/SR fallback

**Files modified:** `src/ui/components/GameShell.vue`, `src/ui/components/GameShell.action-panel-suppression.test.ts`
**Commit:** 2012b645
**Applied fix:** Added a `hasInProgressPick` computed (`actionController.currentAction.value !== null`) and used it to override `allDockActionsSuppressed`: ActionPanel now stays mounted (rendering only its anchored-choices/`Done` fallback — dock buttons are already filtered by ActionPanel's own `suppressFromDock` filter) whenever a pick is actively in progress, even if every currently-available action is `suppressFromDock`. The turn-strip fallback yields to ActionPanel in that case; the explicit `platformActionPanelEscapeHatch` still wins unconditionally. Extended the existing dock-suppression harness test with cases (d)/(e) and updated its source-assertion regexes for the new `v-if` conditions.

### WR-02: `displayedState` leaves `flowState` pointing at live data during time-travel

**Files modified:** `src/ui/components/GameShell.vue`, `src/ui/components/GameShell.time-travel-desync.test.ts`
**Commit:** 95aabb0b
**Applied fix:** `displayedState` now nulls out `flowState` during time-travel (`{ ...state.value, state: timeTravelState.value, flowState: null }`), matching `DebugPanel.vue`'s own internal-state-view precedent for the identical hard constraint (no historical flowState exists to substitute). Widened the local computed's return type to `Omit<GameState, 'flowState'> & { flowState: FlowState | null }` rather than loosening the shared `GameState` type (which many live-only call sites depend on staying non-nullable). Updated the existing harness test's expectation (was asserting the live `flowState` leaked through — that was the bug) and added a dedicated enter/exit-history test plus a source assertion.

### WR-03: `parseColor`'s `rgb()`/`rgba()` regex accepts out-of-gamut channel values

**Files modified:** `src/ui/utils/color-contrast.ts`, `src/ui/utils/color-contrast.test.ts`
**Commit:** 8301ab2a (combined with CR-02)
**Applied fix:** `rgb()`/`rgba()` now reject any channel `> 255` (throws, naming the input) instead of silently accepting it; `hsl()`/`hsla()` (newly added for CR-02) similarly reject saturation/lightness `> 100%`. Added tests for out-of-range rejection on both forms and a boundary-value (255) no-throw check.

### IN-02: `unbounded: true` + explicit `maxIterations` silently prefers `maxIterations`

**Files modified:** `src/engine/flow/builders.ts`, `src/engine/flow/builders.test.ts`
**Commit:** 5c2a7a17
**Applied fix:** `loop()` now throws an actionable construction-time error when both `unbounded: true` and an explicit `maxIterations` are provided ("cannot combine unbounded: true with an explicit maxIterations ... choose one"), matching the existing missing-cap guard's fail-fast pattern instead of a silent, confusing precedence rule. Added tests for the conflict (throws, names the value, says "choose one") and no-regression coverage for each valve used alone.

## Skipped Issues

### IN-01: Stale `suppressActionPanel` name survives in an untouched pre-existing test harness

**File:** `src/ui/components/GameShell.ia.test.ts:35,45,58`
**Reason:** Explicitly out of scope per the fix_direction instructions ("IN-01 = inert stale name in a pre-existing test harness — leave it, or delete the dead reference only if trivially safe; do not chase it"). The review itself frames this as optional cleanup not worth a dedicated change, and the harness is a self-contained mock component whose local `suppressActionPanel` prop never references the real, renamed `GameShell.vue` prop — functionally inert, not a live defect.
**Original issue:** Two stray non-test-file-scope matches of the removed `suppressActionPanel` prop name; one is an intentional negative assertion verifying the rename landed, the other is a self-contained mock harness with its own unrelated local prop of the same (now stale) name.

---

_Fixed: 2026-07-21T21:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
