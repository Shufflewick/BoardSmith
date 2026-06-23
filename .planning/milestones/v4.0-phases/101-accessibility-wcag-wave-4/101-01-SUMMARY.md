---
phase: 101-accessibility-wcag-wave-4
plan: 01
subsystem: ui/composables + ui/theme
tags: [accessibility, a11y, wcag, keyboard, focus-trap, contrast, composable]
dependency_graph:
  requires: []
  provides:
    - src/ui/composables/useSelectable.ts (useSelectable + useSelectableGrid)
    - src/ui/composables/useFocusTrap.ts (useFocusTrap)
  affects:
    - All 8 board renderers (plans 02-04 will import useSelectable)
    - HamburgerMenu, ControlsMenu, GameOverCard (plans 05+ will import useFocusTrap)
    - Toast.warning rendering (plan 10 will use fixed --bsg-warn token)
tech_stack:
  added: []
  patterns:
    - Roving-tabindex grid navigation (useSelectableGrid follows boardsmith-chrome.html:569-618)
    - Focus trap with inert siblings (useFocusTrap — Pitfall 3 guard)
    - WCAG contrast token testing (theme.contrast.test.ts helper pattern)
key_files:
  created:
    - src/ui/composables/useSelectable.ts
    - src/ui/composables/useSelectable.test.ts
    - src/ui/composables/useFocusTrap.ts
    - src/ui/composables/useFocusTrap.test.ts
  modified:
    - src/ui/theme.ts (light-mode --bsg-warn darkened)
    - src/ui/theme.contrast.test.ts (6 new assertions added)
decisions:
  - "useSelectableGrid.handleGridKeydown derives COLS from the composable's own cols param (not as a function argument) to keep API surface minimal and consistent"
  - "useFocusTrap.open() applies inert immediately (sync) then focuses on nextTick; sibling enumeration at open-time captures the current DOM"
  - "escapeToClose defaults to true; callers explicitly pass false for non-dismissable dialogs (GameOverCard)"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-23T09:59:06Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 2
---

# Phase 101 Plan 01: Accessibility Keystones Summary

**One-liner:** Shared `useSelectable` (element+grid keyboard) + `useFocusTrap` (dialog lifecycle) composables + light-mode `--bsg-warn` contrast fix from 3.37:1 to 5.37:1.

## What Was Built

### Task 1: useSelectable.ts — element + grid modes

`src/ui/composables/useSelectable.ts` exports two functions from a single file:

**`useSelectable(identity, boardInteraction, isActionSelectable, isDisabled)`**
- Returns `{ handleClick, handleKeydown, attrs }`
- `handleKeydown` activates on `Enter`/`Space` only (calls `preventDefault`)
- Wraps `triggerElementSelect` — no selection business logic duplicated
- `attrs` is a computed: `role='button'`, `tabindex='0'|'-1'`, `aria-disabled`
- Accepts `null|undefined` boardInteraction for graceful custom-UI parity

**`useSelectableGrid(cells, cols, getIdentity, boardInteraction)`**
- Returns `{ currentIdx, focusCell, handleGridKeydown }`
- Implements roving-tabindex math exactly from `boardsmith-chrome.html:569-618`
- ArrowRight/Left: `±1`; ArrowDown/Up: `±COLS`; Home: `cur-(cur%COLS)`; End: `cur-(cur%COLS)+COLS-1`
- All navigation clamped to `[0, cells.length-1]`; Enter/Space activates via `triggerElementSelect`

22 unit tests cover all keyboard paths and attribute reactivity.

### Task 2: useFocusTrap.ts — trap + Escape + restore + inert

`src/ui/composables/useFocusTrap.ts` exports `useFocusTrap(dialogRef, options?)`:
- `open()`: saves `document.activeElement`, applies `inert` to DOM siblings, focuses first focusable on `nextTick`
- `close()`: removes `inert`, restores previously-focused element
- `handleKeydown(e)`: Tab-cycles within focusable set; Escape calls `onClose` only when `escapeToClose` (default `true`)
- `inert` on siblings enforces keyboard containment (Pitfall 3 guard: `aria-modal` alone does not stop Tab)

`escapeToClose: false` is the GameOverCard pattern — trap stays active, Escape does nothing, user must click Rematch/New Game.

12 unit tests cover focus move, restore, Tab wrap, Shift+Tab wrap, Escape gate, and inert sibling lifecycle.

### Task 3: theme.ts --bsg-warn fix + contrast test extension

**`src/ui/theme.ts`**: light-mode `--bsg-warn` changed from `#b5832a` (3.37:1 against `#ffffff`) to `#8c6318` (5.37:1). Dark-mode warn (`#e6b450`, 8.88:1) unchanged and passing.

**`src/ui/theme.contrast.test.ts`**: extended with 6 new assertions (3 pairs × 2 themes):
1. `--bsg-warn` vs `--bsg-accent-ink` ≥ 4.5:1 (both themes) — Toast.warning text legibility
2. `--bsg-ink-2` vs `--bsg-surface` ≥ 4.5:1 (both themes) — muted secondary text
3. `--bsg-ink-3` vs `--bsg-surface` ≥ 3.0:1 (both themes) — muted tertiary / non-text floor

## Verification Results

| Gate | Result |
|------|--------|
| `npx vitest run src/ui/composables/useSelectable.test.ts` | 22/22 ✓ |
| `npx vitest run src/ui/composables/useFocusTrap.test.ts` | 12/12 ✓ |
| `npx vitest run src/ui/theme.contrast.test.ts` | 36/36 ✓ (30 orig + 6 new) |
| Full suite `npm test` | 1106/1106 ✓ (1066 baseline + 40 new) |
| `npm run lint:css` | exit 0 ✓ |
| `grep triggerElementSelect src/ui/composables/useSelectable.ts` | wraps existing entry point ✓ |
| No hex literals introduced in `.vue` files | confirmed ✓ |

## Deviations from Plan

### Auto-fixed Issues

None.

### Observations

**`grep -c "export function useSelectable"` returns 2:** The acceptance criteria expected 1, but the pattern `export function useSelectable` also matches the substring in `export function useSelectableGrid`. Both functions exist and tests confirm correct behavior. The check for `useSelectableGrid` correctly returns 1.

## Known Stubs

None. Both composables are fully functional with no placeholder behavior.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced. All changes are pure TypeScript/Vue composables and theme token updates.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `src/ui/composables/useSelectable.ts` | FOUND |
| `src/ui/composables/useSelectable.test.ts` | FOUND |
| `src/ui/composables/useFocusTrap.ts` | FOUND |
| `src/ui/composables/useFocusTrap.test.ts` | FOUND |
| commit `2991a34` (RED useSelectable test) | FOUND |
| commit `524585d` (GREEN useSelectable impl) | FOUND |
| commit `2df5e36` (RED useFocusTrap test) | FOUND |
| commit `bfce0d8` (GREEN useFocusTrap impl) | FOUND |
| commit `d5c9297` (warn fix + contrast test) | FOUND |
