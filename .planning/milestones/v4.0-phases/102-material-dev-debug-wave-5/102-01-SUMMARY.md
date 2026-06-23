---
phase: 102-material-dev-debug-wave-5
plan: "01"
subsystem: ui
tags: [debug-panel, a11y, aria, slate, keyboard]
dependency_graph:
  requires: []
  provides: [DEV-01]
  affects: [DebugPanel.vue]
tech_stack:
  added: []
  patterns: [ARIA tablist/tab/tabpanel, two-click confirm, CSS custom properties, v-show for tabpanel]
key_files:
  created:
    - src/ui/components/DebugPanel.shortcut.test.ts
    - src/ui/components/DebugPanel.tabs.test.ts
  modified:
    - src/ui/components/DebugPanel.vue
decisions:
  - "Switch tab panels from v-if to v-show for ARIA correctness (aria-controls must point to existing elements)"
  - "Use handleTabKeydown per tab button (not tablist container) to receive keydown events reliably in jsdom"
  - "Two-click restart: 5-second auto-cancel timer; button label changes in-place; no modal"
metrics:
  duration_minutes: 15
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 102 Plan 01: DebugPanel A11y, Reskin & Two-Click Restart Summary

**One-liner:** ARIA-tabs DebugPanel with guarded Ctrl/Cmd+D shortcut, Slate --bsg-mono reskin, phone bottom-sheet, and two-click restart confirm replacing window.confirm.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Guard D shortcut + ARIA tabs pattern | f667b85 | DebugPanel.vue, DebugPanel.shortcut.test.ts, DebugPanel.tabs.test.ts |
| 2 | Slate reskin, flex height, phone bottom-sheet, two-click restart | e72a398 | DebugPanel.vue |

## What Was Built

**Task 1 — Shortcut guard + ARIA tabs**
- `handleKeyDown` now gates on `ctrlKey || metaKey`; returns early for `HTMLInputElement`, `HTMLTextAreaElement`, `HTMLSelectElement`, and `isContentEditable` targets. Calls `e.preventDefault()` before `togglePanel()` to suppress the browser bookmark dialog.
- Hint text updated from "(Press D to toggle)" to "(Ctrl/Cmd+D to toggle)"; Controls kbd label updated.
- Tab strip converted from 6 plain `<button>` elements to a `v-for` over `DEBUG_TABS` descriptor array with `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `tabindex`, and `@keydown="handleTabKeydown"`.
- `handleTabKeydown` handles ArrowLeft/Right (wrapping), Home, End; uses `nextTick` to focus the new tab button.
- All 6 tab panels converted from `v-if` to `v-show` with `role="tabpanel"`, `id`, `aria-labelledby`.
- 9 shortcut tests + 21 tab tests — all green.

**Task 2 — Slate reskin + phone bottom-sheet + two-click restart**
- All `'Monaco', 'Menlo', monospace` font-family literals replaced with `var(--bsg-mono)`.
- `.state-display` `max-height: calc(100vh - 280px)` removed; replaced with `flex: 1; min-height: 0` for flex-driven scroll height. `.tab-content` also gets `min-height: 0; display: flex; flex-direction: column`.
- Active tab indicator: `border-bottom: 2px solid var(--bsg-accent)`, inactive use `--bsg-ink-3`, active use `--bsg-ink`.
- Phone bottom-sheet: `@media (max-width: 639px)` re-docks `.debug-drawer.open` to `left:0; right:0; bottom:0; top:auto; width:100%; height:60dvh; border-radius: var(--bsg-r-sm) var(--bsg-r-sm) 0 0` with `translateY(100%) → translateY(0)` transition.
- `restartGame()` with `window.confirm` replaced by `handleRestartClick()` + `restartConfirming ref`. First click arms state with 5s auto-cancel; second click clears timer and emits `restart-game`. Button label: "Restart game" → "Confirm restart?"; `--bsg-danger` border/color on confirming state.
- `lint:css` green — no raw hex values introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing ARIA Correctness] Changed tab panels from v-if to v-show**
- **Found during:** Task 1 test authoring
- **Issue:** The plan said "keep v-if" but ARIA requires `aria-controls` to point to existing DOM elements. With `v-if`, inactive panels are removed from the DOM so the `aria-controls` reference is broken and tests can't query them. `v-show` is the correct ARIA pattern (panels remain in DOM with `display:none`).
- **Fix:** Changed all 6 `v-if="activeTab === '...'` to `v-show="activeTab === '...'` on the tabpanel divs.
- **Files modified:** `src/ui/components/DebugPanel.vue`
- **Commit:** f667b85

## Known Stubs

None. All behaviors are fully implemented.

## Threat Flags

None. Changes are confined to the DebugPanel UI layer (gated by `debugMode && platformMode && isDevBuild` in GameShell).

## Self-Check: PASSED

- [x] `src/ui/components/DebugPanel.vue` exists and modified
- [x] `src/ui/components/DebugPanel.shortcut.test.ts` created — 9 tests pass
- [x] `src/ui/components/DebugPanel.tabs.test.ts` created — 21 tests pass
- [x] Commits f667b85 and e72a398 exist in git log
- [x] `npm run lint:css` exits 0
- [x] `grep -n 'ctrlKey'` hits inside handleKeyDown
- [x] `grep -n 'isContentEditable'` hits inside handleKeyDown
- [x] `role="tablist"` and `role="tabpanel"` present
- [x] `grep -n 'Monaco'` returns nothing (all replaced)
- [x] `grep -n 'calc(100vh - 280px)'` only returns `.history-list` (not `.state-display`)
- [x] `grep -n 'restartConfirming'` returns 8 hits; `confirm(` only in unrelated `rewindToAction()`
