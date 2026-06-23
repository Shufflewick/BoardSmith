---
phase: 101-accessibility-wcag-wave-4
plan: "04"
subsystem: ui/renderers
tags: [a11y, keyboard, aria, grid, hex, roving-tabindex, useSelectableGrid]
dependency_graph:
  requires: [101-01]
  provides: [GridBoardRenderer-a11y, HexBoardRenderer-a11y]
  affects: [AutoUI, GameShell]
tech_stack:
  added: []
  patterns:
    - useSelectableGrid grid mode (roving tabindex, role=grid/gridcell)
    - WCAG 1.4.1 non-color owner glyph (seat number text in hex piece tokens)
    - Custom handleGridKeydown wrapper preserving passive selectElement branch
key_files:
  created:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.a11y.test.ts
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.a11y.test.ts
  modified:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
decisions:
  - "Custom handleGridKeydown wrapper intercepts Enter/Space before delegating navigation to composable — preserves passive selectElement branch for non-selectable named cells"
  - "HexBoardRenderer uses role=group (not role=grid) on SVG root because hex grid is not a strict rectangular layout"
  - "hexCols computed from q-coordinate range (max-min+1) for ArrowDown row-skipping math"
  - "Non-color seat glyph shipped as <text> inside piece <g>; aria-hidden on piece group because cell aria-label includes occupant names"
  - "Worktree reset to d5c9297 (101-01 final commit) required — worktree was branched before 101-01 ran"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 101 Plan 04: Grid + Hex Board Renderer A11Y Migration Summary

**One-liner:** Roving-tabindex grid keyboard nav (role=grid/gridcell, Arrow/Home/End, Enter/Space) for GridBoardRenderer (HTML) and HexBoardRenderer (SVG `<g>`) via useSelectableGrid; non-color seat glyphs for hex pieces; 13 jsdom a11y tests green.

## What Was Built

### Task 1: GridBoardRenderer — grid mode + jsdom a11y test

Migrated `GridBoardRenderer.vue` from `handleCellClick` to `useSelectableGrid` grid mode:

- `board-grid` container: `role="grid"` + `:aria-label="Game board, N by M"` + `@keydown="handleGridKeydown"`
- Each `.grid-cell`: `role="gridcell"` + roving `:tabindex` + `:aria-label` (coord+state) + `:aria-selected` + `:aria-disabled` + `@focus="focusCell(idx)"`
- Custom `handleGridKeydown` intercepts Enter/Space to apply the selectable-vs-passive branch; delegates Arrow/Home/End to the composable
- `cellAriaLabel(cell, idx)` generates "coord, state" labels (e.g. "e5, selectable") mirroring the mockup pattern
- `setCellRef` stores DOM elements; `nextTick(() => cellRef.focus())` moves the actual focus ring after arrow navigation
- `GridBoardRenderer.a11y.test.ts`: 8 jsdom tests (role=grid, aria-label, role=gridcell, aria-label on cells, exactly one tabindex=0, ArrowRight advances tab stop, Enter triggers triggerElementSelect)

### Task 2: HexBoardRenderer — grid mode (SVG `<g>`) + jsdom a11y test

Migrated `HexBoardRenderer.vue` from `handleHexClick` to `useSelectableGrid` grid mode:

- SVG root: `role="group"` + `:aria-label="displayLabel"` + `@keydown="handleSvgKeydown"`
- Each `<g class="hex-cell-group">`: `role="gridcell"` + roving `:tabindex` + `:aria-label` (coord+occupants+state) + `:aria-selected` + `:aria-disabled` + `@focus="focusCell(idx)"`
- `hexCols` computed from q-coordinate range (max-min+1) for ArrowUp/Down row-skipping math
- Non-color owner glyph: `<text class="hex-piece-glyph">` inside each piece `<g>` showing seat number (WCAG 1.4.1 Use of Color); piece group is `aria-hidden` since cell label includes occupant names
- Manual VoiceOver/Safari verification note in both JSDoc and template comments (research Open Q3)
- `HexBoardRenderer.a11y.test.ts`: 5 jsdom tests (role=gridcell, aria-label, exactly one tabindex=0, ArrowRight advances tab stop)

## Verification Results

```
npx vitest run src/ui/components/auto-ui/renderers/
  4 test files, 30 tests — all passed

npm run lint:css — exit 0 (no hex color tokens; all var(--bsg-*))

grep -c "handleCellClick" GridBoardRenderer.vue: 0
grep -c "handleHexClick" HexBoardRenderer.vue: 0
grep -c "useSelectableGrid" GridBoardRenderer.vue: 4 (import + call + 2 comments)
grep -c "useSelectableGrid" HexBoardRenderer.vue: 4 (import + call + 2 comments)
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Procedural Notes

**Worktree reset required:** This worktree was branched from commit `3a26239` (before plan 101-01 ran). The `merge-base HEAD d5c9297` returned `3a26239` (not `d5c9297`), so `git reset --hard d5c9297` was applied per the `<worktree_branch_check>` protocol. After reset, all 101-01 source files (including `useSelectableGrid` in `useSelectable.ts`) were available. The untracked test file created before reset (`GridBoardRenderer.a11y.test.ts`) survived the reset as expected.

## Known Stubs

None — both renderers fully wired to `useSelectableGrid` with real `boardInteraction`. No hardcoded or placeholder values.

## Threat Flags

None — these changes add ARIA attributes and keyboard event handlers. No new network endpoints, auth paths, file access, or schema changes introduced.

## Manual Verification Required

**HexBoardRenderer VoiceOver/Safari (research Open Q3):** The `tabindex="0"` approach on SVG `<g>` elements is spec-valid and passes jsdom tests, but Safari/VoiceOver SVG focus behavior requires manual verification before marking A11Y-01 complete for HexBoardRenderer. If VoiceOver cannot land focus on hex cells, escalate to transparent overlay `<button>` elements positioned over each hex cell.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| GridBoardRenderer.vue | FOUND |
| HexBoardRenderer.vue | FOUND |
| GridBoardRenderer.a11y.test.ts | FOUND |
| HexBoardRenderer.a11y.test.ts | FOUND |
| Commit dcc1249 (Task 1) | FOUND |
| Commit 390c0a6 (Task 2) | FOUND |
