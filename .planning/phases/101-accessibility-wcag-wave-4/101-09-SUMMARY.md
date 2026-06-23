---
phase: 101-accessibility-wcag-wave-4
plan: "09"
subsystem: ui/cli-dev
tags: [accessibility, a11y, aria, focus, target-size, dev-tools]
dependency_graph:
  requires: [101-01]
  provides: [A11Y-06-dev, A11Y-09-dev]
  affects: [src/cli/dev-host/DevHost.vue, src/ui/components/DebugPanel.vue]
tech_stack:
  added: []
  patterns:
    - aria-label on icon-only buttons
    - aria-pressed for toggle state
    - aria-expanded on collapsible panel trigger
    - aria-hidden on decorative glyphs
    - min-width/min-height 24px WCAG 2.5.8 target floor
    - button element for click-interactive controls (replacing div+@click)
key_files:
  created: []
  modified:
    - src/cli/dev-host/DevHost.vue
    - src/ui/components/DebugPanel.vue
decisions:
  - color-swatch aria-label bound to c.label (same as title attribute) — direct mapping, no extra string
  - aria-pressed added to swatches (Rule 2: missing state attribute for toggle = missing critical ARIA) 
  - .debug-toggle converted from div to button — required for global :focus-visible ring to apply
  - min-height: 44px on .debug-toggle — layout permits it as a side-tab with no adjacent controls
  - .card-action-btn: bumped to 24px (not 44px) — constrained by compact card row layout
  - TreeNode copy button labelled 'Copy JSON to clipboard' to distinguish from other Copy buttons
metrics:
  duration: 12m
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 101 Plan 09: Dev A11y — Names, Focus Ring, Target Size Summary

Dev chrome (DevHost + DebugPanel) brought to the wave's minimum a11y floor. Every icon-only dev control has an accessible name and inherits the global `:focus-visible` ring; color swatches and the smallest card-action buttons meet the 24px WCAG 2.5.8 target minimum.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DevHost dev controls — names + swatch target floor | 2194c34 | src/cli/dev-host/DevHost.vue |
| 2 | DebugPanel controls — names + focus reachability | 2fabedd | src/ui/components/DebugPanel.vue |

## What Was Built

### Task 1: DevHost.vue

Color swatches were the only icon-only controls in DevHost — all other controls already had visible text labels. Changes:

- Added `:aria-label="c.label"` to each color swatch `<button>` — provides AT-readable name from the palette label
- Added `:aria-pressed="colorInput === c.value"` to communicate selected/unselected toggle state (Rule 2: missing ARIA state attribute)
- Bumped `.color-swatch` from `22×22px` to `24×24px` (WCAG 2.5.8 24px minimum; space is constrained in the inline palette row so 44px is not feasible)
- No new hex literals introduced; all other buttons had text labels already

### Task 2: DebugPanel.vue

Multiple icon-only controls across the panel. Changes:

**Focus reachability:**
- `.debug-toggle` converted from `<div @click>` to `<button type="button">` — only real buttons receive the global `:focus-visible` ring. Added `aria-expanded` for open/close state and `aria-label="Toggle debug panel"`. Added `border: none` to reset UA button border. Added `min-height: 44px` since the side-tab has no adjacent controls and can absorb the full target.

**Names on icon-only controls:**
- Header close button `✕`: `aria-label="Close debug panel"`, glyph wrapped in `aria-hidden` span
- Deck action buttons (shuffle 🔀, copy 📋): `aria-label` matching `title` attribute; glyphs `aria-hidden`
- Card action buttons (move-to-top ⬆️, move-up ↑, move-down ↓, transfer ➡️): same pattern
- Transfer dialog close button `×`: `aria-label="Close transfer dialog"`
- TreeNode copy button `⎘` (in render function): `aria-label: 'Copy JSON to clipboard'`

**Target size floor:**
- `.card-action-btn` bumped from `22×22px` to `24×24px` — meets WCAG 2.5.8 24px minimum; constrained by compact card list row layout

**Phase-102 deferral boundary:**
- No `role="tab"` or `role="tablist"` added
- No DebugPanel reskin, no D-shortcut gating, no seat switcher introduced

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing ARIA State] Added aria-pressed to color swatches**
- **Found during:** Task 1
- **Issue:** WCAG 4.1.2 requires name, role, AND value for UI components. Color swatches are toggle buttons; their selected state was only expressed via CSS class, invisible to AT.
- **Fix:** Added `:aria-pressed="colorInput === c.value"` to each swatch button.
- **Files modified:** src/cli/dev-host/DevHost.vue
- **Commit:** 2194c34

**2. [Rule 2 - Missing ARIA State] Added aria-expanded to .debug-toggle**
- **Found during:** Task 2 (converting div to button)
- **Issue:** As a disclosure button, the toggle must expose its open/close state.
- **Fix:** Added `:aria-expanded="panelExpanded"` to the button.
- **Files modified:** src/ui/components/DebugPanel.vue
- **Commit:** 2fabedd

## Known Stubs

None. Both controls are fully wired — no placeholder values, no mock data.

## Threat Flags

None. Accessibility changes only; no new network endpoints, auth paths, or schema changes.

## Self-Check

- [x] src/cli/dev-host/DevHost.vue exists and modified
- [x] src/ui/components/DebugPanel.vue exists and modified
- [x] Commit 2194c34 exists
- [x] Commit 2fabedd exists
- [x] `grep -c "aria-label" src/cli/dev-host/DevHost.vue` = 1 (>= 1)
- [x] `grep -c "aria-label" src/ui/components/DebugPanel.vue` = 10 (>= 1)
- [x] `grep -c 'role="tab"' src/ui/components/DebugPanel.vue` = 0 (deferral held)
- [x] `npm run lint:css` exits 0
- [x] `npx vitest run src/ui/` — 428/428 passed

## Self-Check: PASSED
