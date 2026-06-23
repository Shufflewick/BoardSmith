---
phase: 101-accessibility-wcag-wave-4
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/ui/composables/useSelectable.ts
  - src/ui/composables/useFocusTrap.ts
  - src/ui/composables/liveRegionAnnouncer.ts
  - src/ui/components/auto-ui/renderers/CardRenderer.vue
  - src/ui/components/auto-ui/renderers/PieceRenderer.vue
  - src/ui/components/auto-ui/renderers/DeckRenderer.vue
  - src/ui/components/auto-ui/renderers/HandRenderer.vue
  - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
  - src/ui/components/auto-ui/renderers/DieRenderer.vue
  - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
  - src/ui/components/auto-ui/action-panel-helpers.ts
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/auto-ui/AutoUI.vue
  - src/ui/components/auto-ui/BoardLegend.vue
  - src/ui/components/GameShell.vue
  - src/ui/components/GameHeader.vue
  - src/ui/components/GameHistory.vue
  - src/ui/components/PlayersPanel.vue
  - src/ui/components/Toast.vue
  - src/ui/components/HamburgerMenu.vue
  - src/ui/components/ControlsMenu.vue
  - src/ui/components/GameOverCard.vue
  - src/ui/components/DebugPanel.vue
findings:
  critical: 2
  warning: 5
  info: 2
  total: 9
status: resolved
---

# Phase 101: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 101 added WCAG 2.2 AA accessibility across 8 parallel worktrees merged manually. No git conflict markers remain. The `useSelectable` API (returning `{ onActivate, onKeydown, attrs }`) is uniformly consumed across all six element renderers — no renderer references a dead key. Roving-tabindex math in `GridBoardRenderer` and `HexBoardRenderer` is correct (Home/End off-by-one check passed). Live-region watchers all use `immediate: false` as specified.

Two blockers exist. The first is the most impactful: the `useFocusTrap` composable applies `inert` to siblings at the dialog's *immediate parent* level, which is too narrow to prevent Tab from escaping to the rest of the game UI in all three dialog usages. The second is a Vue 3 lifecycle ordering issue in `GameOverCard` that makes trap cleanup a no-op. Five additional ARIA semantic violations and a duplicate live-region are flagged as warnings.

---

## Critical Issues

### CR-01: `useFocusTrap.applySiblingInert` scope too narrow — focus escapes all three dialogs

**Files:**
- `src/ui/composables/useFocusTrap.ts:126-134`
- `src/ui/components/HamburgerMenu.vue` (uses `drawerRef`)
- `src/ui/components/ControlsMenu.vue` (uses `menuRef`)
- `src/ui/components/GameOverCard.vue` (uses `cardRef`)

**Issue:** `applySiblingInert()` applies the `inert` attribute to siblings of `dialogRef.value` within `dialogRef.value.parentElement`. In all three consumers the parent is too narrow:

- **HamburgerMenu:** `drawerRef` = `.menu-drawer`; parent = `.hamburger-menu`. Siblings inerted: `.hamburger-btn` + `.menu-overlay`. The rest of the page (`.sidebar`, `.boardregion`, `.actionbar`) is not inerted — Tab escapes the drawer.
- **ControlsMenu:** `menuRef` = `.menu`; parent = `.controls-menu`. Siblings inerted: `.menubtn` only. Tab escapes to the board.
- **GameOverCard:** `cardRef` = `.game-over-card`; parent = `.game-over-scrim`. `.game-over-scrim` has **no other children**, so `applySiblingInert` applies `inert` to zero elements. The trap is completely non-functional. Keyboard users can Tab from the "Rematch / New Game" buttons into the live game board or action panel.

The composable's own comment (line 15-18) states: "`inert` on background siblings is the only mechanism that prevents Tab from escaping the dialog." The current implementation does not satisfy that contract for any of the three call sites.

**Fix:** The inert scope must be applied at a level that covers the entire page background. The standard pattern is to inert all direct children of `<body>` (or the modal host root) except the dialog itself:

```ts
// In useFocusTrap.ts — replace applySiblingInert / removeSiblingInert with:

function getScopingRoot(): HTMLElement {
  // Walk up from the dialog until we find a node whose parent is <body>
  // (or any suitable modal host). That node is where we want inert siblings.
  let node: HTMLElement | null = dialogRef.value;
  while (node && node.parentElement && node.parentElement !== document.body) {
    node = node.parentElement;
  }
  return node ?? (dialogRef.value as HTMLElement);
}

function applySiblingInert() {
  const target = getScopingRoot();
  const parent = target?.parentElement;
  if (!parent) return;
  for (const child of Array.from(parent.children)) {
    if (child !== target) {
      (child as HTMLElement).setAttribute('inert', '');
    }
  }
  _inertRoot = target;  // save for cleanup
}

function removeSiblingInert() {
  const parent = _inertRoot?.parentElement;
  if (!parent) return;
  for (const child of Array.from(parent.children)) {
    if (child !== _inertRoot) {
      (child as HTMLElement).removeAttribute('inert');
    }
  }
  _inertRoot = null;
}
```

Alternatively, add a required `scopeRoot?: Ref<HTMLElement | null>` option so callers that already sit inside a modal host (like `.game-over-scrim`) can pass the scrim as the scope root.

---

### CR-02: `GameOverCard.onUnmounted(() => closeTrap())` — Vue ref is null at `onUnmounted`, cleanup is a no-op

**File:** `src/ui/components/GameOverCard.vue:43`

**Issue:** In Vue 3, template refs are cleared **before** `onUnmounted` fires. When `GameOverCard` unmounts (e.g., a Rematch resets `flowState.complete`), `cardRef.value` is already `null`. `closeTrap()` calls `removeSiblingInert()`, which reads `dialogRef.value?.parentElement` → `undefined`, so the cleanup loop never runs. Any `inert` attributes that were legitimately placed would never be removed.

In the current code this is masked by CR-01 (no inert is ever applied for GameOverCard), but fixing CR-01 without fixing this would leave `inert` permanently on page siblings after the overlay closes, making the game inaccessible until reload.

**Fix:** Use `onBeforeUnmount` instead of `onUnmounted`, where the ref is still valid:

```ts
// GameOverCard.vue — change:
onUnmounted(() => closeTrap());
// to:
onBeforeUnmount(() => closeTrap());
```

Apply the same correction defensively to `HamburgerMenu` and `ControlsMenu` if they ever add `onUnmounted` cleanup paths.

---

## Warnings

### WR-01: `aria-selected` on `role="button"` — invalid ARIA in five element renderers

**Files:**
- `src/ui/components/auto-ui/renderers/CardRenderer.vue:356`
- `src/ui/components/auto-ui/renderers/PieceRenderer.vue:150`
- `src/ui/components/auto-ui/renderers/DeckRenderer.vue:135`
- `src/ui/components/auto-ui/renderers/SpaceRenderer.vue:166`
- `src/ui/components/auto-ui/renderers/DieRenderer.vue:108`

**Issue:** `useSelectable.attrs` always injects `role: 'button'` (line 53 of `useSelectable.ts`). All five renderers then bind `:aria-selected` on the same element. Per WAI-ARIA 1.2, `aria-selected` is not a permitted property on `role="button"` — valid roles for `aria-selected` are `gridcell`, `option`, `row`, `tab`, `treeitem`, `columnheader`, `rowheader`. Screen readers encountering `role="button" aria-selected="true"` have undefined behavior; many will silently ignore the attribute, causing selected state to be inaudible to AT users.

**Fix (two options):**

Option A — use `aria-pressed` instead of `aria-selected` for button semantics:
```ts
// In each renderer, change:
:aria-selected="isSelected || undefined"
// to:
:aria-pressed="isSelected || undefined"
```

Option B — have `useSelectable.attrs` omit `role="button"` when the element is not interactive, and renderers that need `aria-selected` switch to a role that supports it (`option` inside a `listbox`, or `gridcell`). This is more invasive but architecturally cleaner.

---

### WR-02: `role="gridcell"` inside `role="group"` — invalid ARIA ownership in HexBoardRenderer

**File:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue:328,313`

**Issue:** Each hex `<g>` cell uses `role="gridcell"` (line 328). The SVG container uses `role="group"` (line 313). Per WAI-ARIA 1.2, `role="gridcell"` requires an ancestor with `role="grid"`, `rowgroup`, or `row`. A `gridcell` inside a `group` violates the required context ownership and produces undefined AT behavior — screen readers may not announce navigation position (e.g., "row 2, column 3 of 7") without the owning `grid` role.

**Fix:** Change the SVG root role from `group` to `grid` and provide `aria-rowcount`/`aria-colcount` so ATs can announce grid dimensions. If the non-rectangular nature of hex makes `grid` semantically awkward, use `role="application"` on the SVG and manage virtual cursor announcements manually via `aria-live` on activation.

```html
<!-- HexBoardRenderer.vue: change -->
role="group"
:aria-label="displayLabel"
<!-- to -->
role="grid"
:aria-label="displayLabel"
:aria-rowcount="/* hex row count */"
:aria-colcount="hexCols"
```

---

### WR-03: `aria-selected` on `role="group"` — invalid ARIA in HandRenderer

**File:** `src/ui/components/auto-ui/renderers/HandRenderer.vue:277`

**Issue:** HandRenderer uses `role="group"` (a semantic grouping container) and binds `:aria-selected="isSelected || undefined"`. `aria-selected` is not a valid property for `role="group"` per WAI-ARIA 1.2. Unlike WR-01 (where `role="button"` was composed from the shared attr object), HandRenderer deliberately overrides the role to `group` (correct, since a hand container is not a button) but then adds `aria-selected` which is incompatible with that role.

**Fix:** Remove `:aria-selected` from HandRenderer or change the role to one that supports selection semantics (`role="listbox"` or `role="option"` if the hand is itself a selectable unit).

```html
<!-- HandRenderer.vue — remove this line: -->
:aria-selected="isSelected || undefined"
```

---

### WR-04: Conditionally-mounted `aria-live` region inside actionbar violates Pitfall 2

**File:** `src/ui/components/GameShell.vue:1667`

**Issue:** A second `aria-live="polite"` region exists inside the `<template v-if="isMyTurn || awaitingPlayerNames.length">` block:

```html
<span class="vh" aria-live="polite">{{ boardPrompt ?? actionController.currentPick.value?.prompt }}</span>
```

This violates the project's own Pitfall 2 rule (documented in `liveRegionAnnouncer.ts` line 6): live regions must be mounted before content is written into them. When it's the player's turn for the first time, the `v-if` mounts both the region and its content simultaneously — some ATs do not announce the initial content of a freshly-mounted live region. Additionally, the already-mounted global polite region at line 1449 creates a competing polite region that may cause queuing or suppression in some AT+browser combinations.

**Fix:** Move this prompt live region to sit alongside the always-mounted global regions (outside the `v-if`), and let it be empty when it's not the player's turn:

```html
<!-- Always-mounted, near line 1449: -->
<p class="vh" role="status" aria-live="polite">{{ politeMessage }}</p>
<p class="vh" role="alert" aria-live="assertive">{{ assertiveMessage }}</p>
<!-- Add this always-mounted prompt region: -->
<span class="vh" aria-live="polite">
  {{ (isMyTurn || awaitingPlayerNames.length) ? (boardPrompt ?? actionController.currentPick.value?.prompt) : '' }}
</span>
```

Then remove the inline span at line 1667.

---

### WR-05: `GameHeader.vue` — `import { computed }` appears after first use

**File:** `src/ui/components/GameHeader.vue:37-39`

**Issue:** `computed` is used at line 37 (`const zoomPercent = computed(...)`) but the import statement `import { computed } from 'vue'` is on line 39. ES module imports are hoisted by the runtime, so this works at execution time, but TypeScript will emit a `no-use-before-define` violation and the source is misleading to readers. It is likely a merge artifact.

**Fix:** Move the import to the top of the `<script setup>` block alongside other Vue imports:

```ts
// GameHeader.vue — move to top:
import { computed } from 'vue';
// ... then use computed on line 37
```

---

## Info

### IN-01: Dead Enter/Space activation branch in `useSelectableGrid`

**File:** `src/ui/composables/useSelectable.ts:132-136`

**Issue:** The composable's `handleGridKeydown` has an Enter/Space activation branch (lines 132-136) that calls `boardInteraction?.triggerElementSelect(...)`. Both consumers (`GridBoardRenderer` and `HexBoardRenderer`) intercept Enter/Space before calling `_composableKeydown`, causing this branch to be unreachable dead code. The composable documents `handleGridKeydown` as handling "Enter/Space activation" but that description only applies to callers that don't override it — which is currently no one.

**Fix:** Remove the Enter/Space branch from `useSelectableGrid.handleGridKeydown` and update the JSDoc. The composable should only handle navigation (Arrow/Home/End); activation is the renderer's responsibility.

---

### IN-02: `.sw-btn` in GameShell has `aria-label` but no `@click` handler

**File:** `src/ui/components/GameShell.vue:1518`

**Issue:** The Shufflewick host button in the sidebar rail is rendered as a `<button>` with a descriptive `aria-label="Shufflewick — host menu and leave game"` but has no `@click` handler. AT users who Tab to this button will expect it to be activatable (as labeled), but pressing Enter/Space does nothing. This creates a misleading interactive affordance.

**Fix:** Either wire the button to the `HamburgerMenu` toggle (so clicking the wordmark opens the menu), or replace the outer `<button>` with a `<div>` and add `aria-hidden="true"` if it is purely decorative.

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
