---
phase: 100-ia-responsive-wave-3
plan: "02"
subsystem: ui/auto-ui
tags: [fluid-sizing, container-queries, grid-renderer, hex-renderer, archetype, ia-05]
dependency_graph:
  requires: []
  provides: [fluid-grid-cells, fluid-hex-board, container-query-archetype]
  affects: [GridBoardRenderer, HexBoardRenderer, GridBoardTemplate, Phase-103-regression-surface]
tech_stack:
  added: []
  patterns:
    - "CSS container queries (container-type:size / container-type:inline-size) for board sizing"
    - "--cell clamp driven by --cols/--rows custom properties from renderer's gridResult"
    - "Fluid clamp() hand strip instead of viewport-relative max-height"
key_files:
  created:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts
  modified:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
    - src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue
decisions:
  - "Set --cols/--rows via :style binding on .board-with-labels wrapper (not the root element) so the container-query context and the custom props are co-located"
  - "container-type:inline-size on .board-with-labels provides a local CQ context so --cell resolves even when GridBoardRenderer is used outside GridBoardTemplate's size container"
  - "Corner-cell strategy in test: provide a child at (rows-1, cols-1) to drive resolveGridSize to the expected dimensions; $rows/$cols attributes are not read by the helper"
  - "max-height:100% added to .hex-board-svg (alongside existing max-width:100%; height:auto) so SVG cannot exceed container height — no viewport units"
  - "container-type:size on .grid-board-template__board (not the template root) so cqw/cqh resolve to the board slot's size, not the full archetype width"
metrics:
  duration: "~6 minutes"
  completed: "2026-06-23"
  tasks_completed: 3
  files_changed: 4
---

# Phase 100 Plan 02: Fluid Grid + Hex Board Sizing Summary

**One-liner:** Retired fixed 50px/20px grid cells and 80vh hex clamp; boards now self-size to their container via `--cell: clamp(28px, min(calc(100cqw/var(--cols)), calc(100cqh/var(--rows))), 96px)` driven by the board's column/row counts.

## What Was Built

### Task 1: Fluid --cell clamp for grid cells + aligned labels (GridBoardRenderer.vue)

`GridBoardRenderer.vue` now exposes `--cols` and `--rows` as inline CSS custom properties on the `.board-with-labels` wrapper (set from `gridResult.cols` / `gridResult.rows` via a new `boardSizeStyle` computed). The `--cell` clamp is defined in scoped CSS on `.board-with-labels` alongside `container-type: inline-size`. All fixed pixel values replaced:

| Before | After |
|--------|-------|
| `.grid-cell { width: 50px; height: 50px }` | `width: var(--cell); height: var(--cell)` |
| `.board-label { width: 50px; height: 20px }` | `width: var(--cell); height: auto` |
| `.board-label.corner { width: 20px }` | `width: calc(var(--cell) * 0.4)` |
| `.board-row-labels .board-label { width: 20px; height: 50px }` | `width: calc(var(--cell) * 0.4); height: var(--cell)` |

### Task 2: Hex board scales to its container (HexBoardRenderer.vue)

Removed `max-height: 80vh` and `overflow: hidden` from `.hex-board-container`. Added `min-height: 0; max-width: 100%` so the container can shrink. Added `max-height: 100%; width: auto` to `.hex-board-svg` alongside the existing `max-width: 100%; height: auto` so the SVG cannot exceed the container in either dimension. The SVG scales via its computed `viewBox` with no viewport-relative units.

### Task 3: Grid archetype owns container-type + fluid hand strip (GridBoardTemplate.vue)

Added `container-type: size` and `min-height: 0` to `.grid-board-template__board` (the dominant 1fr board area). This ensures `cqw`/`cqh` units resolve against the archetype's board slot even when the archetype is used outside GameShell's `boardregion` (Assumption A3 robustness). Replaced `max-height: 30vh` on the hand strip with `max-height: clamp(96px, 22vh, 180px)`.

## Phase 103 Regression Surface

**The following files changed fluid sizing behavior and MUST be re-checked against all 9 games + MERC in Phase 103:**

1. `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` — cells and labels now fluid via `--cell` clamp; no fixed 50px/20px remain
2. `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` — SVG now container-constrained; no `80vh` / `overflow:hidden`
3. `src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue` — board area is a `container-type:size` context; hand strip uses `clamp(96px, 22vh, 180px)`

Games using a grid board (Checkers, Go, custom grid games) will exercise `GridBoardRenderer` + `GridBoardTemplate`. Games using `$layout:'hex-grid'` will exercise `HexBoardRenderer`. Phase 103 should verify both in the browser across all game bundles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test factory built invalid grid element for resolveGridSize**

- **Found during:** Task 1 GREEN phase (test showed `--cols: 0; --rows: 0`)
- **Issue:** Test factory used `$rows`/`$cols` attributes which `resolveGridSize` does not read. The helper infers grid size from children's coordinate attributes (reading the `$rowCoord`/`$colCoord` coordinate field values). An element with no matching children returned `rows: 0, cols: 0`.
- **Fix:** Changed factory to provide a corner cell at `(rows-1, cols-1)` so `resolveGridSize` returns the expected `{rows, cols}`.
- **Files modified:** `GridBoardRenderer.fluid.test.ts`
- **Commit:** 164ebab (GREEN phase combined with Vue fix)

**2. [Rule 2 - Missing critical] container-type:inline-size added to GridBoardRenderer's board-with-labels**

- **Found during:** Task 1 implementation
- **Issue:** Plan called for `container-type:size` only on the archetype (Task 3). But if `GridBoardRenderer` is used outside the archetype (e.g. in a custom layout or standalone test), the `cqw`/`cqh` units in `--cell` would have no ancestor container-type, resolving to the viewport. This would silently break correct sizing.
- **Fix:** Added `container-type: inline-size` to `.board-with-labels` in `GridBoardRenderer.vue`. This creates a local CQ context at the renderer level. When inside the archetype's `container-type:size` board slot, the archetype container wins (outer CQ context is established first), so normal usage is unaffected. Standalone usage is now also safe.
- **Files modified:** `GridBoardRenderer.vue`
- **Commit:** 164ebab

## Known Stubs

None — all sizing changes are wired to real data from `gridResult.cols` / `gridResult.rows`.

## Threat Flags

None — pure CSS/template changes; no new network endpoints, auth paths, or file access patterns.

## Self-Check: PASSED

All created/modified files exist on disk. All task commits verified in git log:
- `babf308` test(100-02): RED phase fluid sizing test
- `164ebab` feat(100-02): GridBoardRenderer fluid --cell clamp
- `becee90` feat(100-02): HexBoardRenderer container fit
- `7d06106` feat(100-02): GridBoardTemplate container-type + hand clamp
