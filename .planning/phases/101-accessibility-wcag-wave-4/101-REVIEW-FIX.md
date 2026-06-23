---
phase: 101-accessibility-wcag-wave-4
fixed_at: 2026-06-23T06:06:00Z
review_path: .planning/phases/101-accessibility-wcag-wave-4/101-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 101: Code Review Fix Report

**Fixed at:** 2026-06-23T06:06:00Z
**Source review:** .planning/phases/101-accessibility-wcag-wave-4/101-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: useFocusTrap inert scope widened to body-level siblings

**Files modified:** `src/ui/composables/useFocusTrap.ts`, `src/ui/composables/useFocusTrap.test.ts`
**Commit:** 212c5d6
**Applied fix:** Added `getScopingRoot()` that walks up from `dialogRef.value` through parent elements until `node.parentElement === document.body`, returning the direct child of body (the modal host root). Both `applySiblingInert` and `removeSiblingInert` now operate on that node's siblings rather than the immediate parent's siblings. The scoping root is stored as `_inertRoot` (a plain variable, not a reactive ref) so cleanup survives Vue clearing template refs. Added two regression tests: one for deeply-nested dialog (mirrors HamburgerMenu DOM structure), one for the null-ref cleanup path.

---

### CR-02: GameOverCard uses onBeforeUnmount for focus trap cleanup

**Files modified:** `src/ui/components/GameOverCard.vue`
**Commit:** a820700
**Applied fix:** Changed `import { ..., onUnmounted }` to `import { ..., onBeforeUnmount }` and replaced `onUnmounted(() => closeTrap())` with `onBeforeUnmount(() => closeTrap())`. Vue 3 clears template refs before `onUnmounted` fires, making `removeSiblingInert` a no-op; `onBeforeUnmount` runs while the ref is still valid. HamburgerMenu and ControlsMenu were checked — neither uses `onUnmounted` for trap cleanup, so no changes needed there.

---

### WR-01: aria-selected replaced with aria-pressed on five role=button renderers

**Files modified:** `src/ui/components/auto-ui/renderers/CardRenderer.vue`, `src/ui/components/auto-ui/renderers/PieceRenderer.vue`, `src/ui/components/auto-ui/renderers/DeckRenderer.vue`, `src/ui/components/auto-ui/renderers/SpaceRenderer.vue`, `src/ui/components/auto-ui/renderers/DieRenderer.vue`
**Commit:** d4abbd5
**Applied fix:** Changed `:aria-selected="..."` to `:aria-pressed="..."` on all five renderer root elements. `useSelectable.attrs` injects `role="button"`; `aria-pressed` is the correct WAI-ARIA state attribute for toggled button elements. The CardRenderer.a11y.test.ts did not assert `aria-selected` so no test changes were needed.

---

### WR-02: HexBoardRenderer SVG root changed to role="grid" with aria-rowcount/colcount

**Files modified:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue`, `src/ui/components/auto-ui/renderers/HexBoardRenderer.a11y.test.ts`
**Commit:** 602f3dd
**Applied fix:** Changed `role="group"` to `role="grid"` on the SVG root, satisfying the WAI-ARIA ownership requirement for `role="gridcell"` children. Added `hexRows` computed property (r-coordinate range + 1) mirroring the existing `hexCols`. Bound `:aria-rowcount="hexRows"` and `:aria-colcount="hexCols"` on the SVG root. Updated HexBoardRenderer.a11y.test.ts with three new assertions: `role="grid"`, `aria-colcount="3"` (for the 3-cell single-row test fixture), and `aria-rowcount="1"`.

---

### WR-03: aria-selected removed from HandRenderer role=group container

**Files modified:** `src/ui/components/auto-ui/renderers/HandRenderer.vue`
**Commit:** 04ca696
**Applied fix:** Removed the `:aria-selected="isSelected || undefined"` binding from the `role="group"` container div. `aria-selected` is not a valid property for `role="group"`. Selection state is still conveyed via CSS classes and the aria-label which names card count. HandRenderer.a11y.test.ts did not assert `aria-selected` so no test changes were needed.

---

### WR-04: Conditionally-mounted aria-live prompt moved to always-mounted region

**Files modified:** `src/ui/components/GameShell.vue`
**Commit:** 0f44585
**Applied fix:** Added a new always-mounted `<span class="vh" aria-live="polite">` alongside the existing global live regions at line 1449. The span's content is the board prompt when `isMyTurn || awaitingPlayerNames.length`, empty otherwise — so the region is always in the DOM but only populated when the player is actionable. Removed the duplicate conditionally-mounted span that was inside the `<template v-if="isMyTurn || awaitingPlayerNames.length">` actionbar block.

---

### WR-05: GameHeader computed import moved before first use

**Files modified:** `src/ui/components/GameHeader.vue`
**Commit:** 9ec061d
**Applied fix:** Moved `import { computed } from 'vue'` from line 39 (after the `computed(() => ...)` call at line 37) to line 7 (top of `<script setup>`, before any other code). This was a merge artifact — ES module imports are hoisted at runtime so it worked, but the source was misleading and would emit `no-use-before-define` from TypeScript tooling.

---

### IN-01: Dead Enter/Space activation branch removed from useSelectableGrid

**Files modified:** `src/ui/composables/useSelectable.ts`, `src/ui/composables/useSelectable.test.ts`
**Commit:** 1e54725
**Applied fix:** Removed the `else if (k === 'Enter' || k === ' ')` branch from `handleGridKeydown`. Both grid renderer consumers (`GridBoardRenderer` and `HexBoardRenderer`) intercept Enter/Space before calling `_composableKeydown`, making the branch unreachable dead code. Updated the JSDoc to accurately describe `handleGridKeydown` as handling navigation only. Replaced three now-invalid "Enter/Space activate" tests in useSelectable.test.ts with a single test asserting Enter/Space are not handled by the composable (currentIdx unchanged, `triggerElementSelect` not called): requires human verification that renderers' own activation still works.

**Note:** Requires human verification — Tier 1/2 verify the composable's behavior but the key invariant (GridBoardRenderer + HexBoardRenderer still activate cells on Enter/Space via their own handlers) is tested indirectly. Renderers intercept Enter/Space in their own keydown handlers before delegating navigation to the composable. Manual or integration test confirmation recommended.

---

### IN-02: sw-btn demoted to aria-hidden div

**Files modified:** `src/ui/components/GameShell.vue`
**Commit:** 8197d3a
**Applied fix:** Changed `<button class="sw-btn" aria-label="..." type="button">` to `<div class="sw-btn" aria-hidden="true">` (also removed the redundant `aria-hidden="true"` from the inner `.sw-btn__mark` span since the whole element is now hidden). In platform mode, `GameHeader` is hidden via `v-if="!platformMode"`, so no `HamburgerMenu` toggle is available to wire. An interactive button with no handler is a misleading affordance. The `ControlsMenu` adjacent to it provides all accessible game-control affordances.

---

## Skipped Issues

None — all 9 findings were fixed.

---

_Fixed: 2026-06-23T06:06:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
