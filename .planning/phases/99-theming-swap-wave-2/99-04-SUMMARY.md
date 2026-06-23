---
phase: 99-theming-swap-wave-2
plan: "04"
subsystem: ui/renderers
tags: [theming, tokens, slate, board-renderers, hex, svg, css-custom-properties]
dependency_graph:
  requires: [99-01]
  provides: [grid-board-tokenized, hex-board-tokenized, space-tokenized, element-renderer-confirmed-clean]
  affects: [GridBoardRenderer.vue, HexBoardRenderer.vue, SpaceRenderer.vue, ElementRenderer.vue]
tech_stack:
  added: []
  patterns: [css-custom-property token sweep, SVG CSS fill/stroke via var(), color-mix tints for danger states]
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
  confirmed_clean:
    - src/ui/components/auto-ui/renderers/ElementRenderer.vue
decisions:
  - "SVG polygon uses CSS stroke for selection indicator (not CSS outline) since SVG elements have no layout box; stroke-dasharray distinguishes selectable (4 2) from droptarget (3 2)"
  - "hex-polygon action-selectable drops neon pulse-hex keyframe; static dashed stroke on var(--bsg-accent) is sufficient affordance and avoids rgba(46,204,113) literals"
  - "hex-polygon.has-children uses var(--bsg-surface-2) (lighter surface tier) to signal occupancy without a literal"
  - "error panel backgrounds use color-mix(in srgb, var(--bsg-danger) N%, transparent) matching the pattern from theme.ts for selectable/droptarget tints"
  - "ElementRenderer.vue has no <style> block at all — confirmed clean, zero changes needed"
metrics:
  duration: "8 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 99 Plan 04: Slate Sweep — GridBoard + HexBoard + Space Summary

**One-liner:** Replaced all neon/hex literals in GridBoardRenderer, HexBoardRenderer (incl. hex `<g>` polygon states), and SpaceRenderer with Slate `var(--bsg-*)` tokens; confirmed ElementRenderer has no color literals.

## What Was Built

Atomic token sweep of the three board-topology renderers:

**GridBoardRenderer.vue**
- Container background: `rgba(255,255,255,0.05)` → `var(--bsg-surface)`
- Cell base: `rgba(255,255,255,0.1)` → `var(--bsg-cell)`
- `action-selectable`: removed neon `pulse-cell` keyframe; now `outline: 2px dashed var(--bsg-accent)` + `background: var(--bsg-selectable)`
- `is-board-selected`: `outline: 2px solid var(--bsg-accent)` + `background: var(--bsg-selected)` + `box-shadow: var(--bsg-ring)` + `scale(1.04)`
- `is-drop-target`: added `outline: 2px dotted var(--bsg-accent-2)` alongside existing droptarget bg tokens
- `is-board-highlighted`: `var(--bsg-selectable)` bg
- `color: #fff/#888/#666` → `var(--bsg-ink)/var(--bsg-ink-3)` on header, labels, notation
- Error panel: `color-mix(in srgb, var(--bsg-danger) 10%, transparent)` bg + 40% border tint; text `var(--bsg-danger)`

**SpaceRenderer.vue**
- Container: `rgba(255,255,255,0.03)` bg + `rgba(255,255,255,0.1)` border → `var(--bsg-surface)` + `var(--bsg-line)`
- `action-selectable`: removed neon `pulse-space` keyframe; now `outline: 2px dashed var(--bsg-accent)` + `var(--bsg-selectable)` bg
- `is-board-selected`: `outline: 2px solid var(--bsg-accent)` + `var(--bsg-selected)` bg + `var(--bsg-ring)` + `scale(1.02)`
- `is-drop-target`: `outline: 2px dotted var(--bsg-accent-2)` (removed neon `border-color: rgba(0,255,136,0.5)`)
- `is-board-highlighted`: `var(--bsg-selectable)` bg + `outline: 1px solid var(--bsg-accent)`
- `space-label`/`space-count`: `#aaa/#666` → `var(--bsg-ink-2)/var(--bsg-ink-3)`

**HexBoardRenderer.vue**
- Container: `rgba(255,255,255,0.05)` → `var(--bsg-surface)`; header `#fff` → `var(--bsg-ink)`
- `hex-polygon` base: `fill: rgba(255,255,255,0.1)` + `stroke: rgba(255,255,255,0.3)` → `var(--bsg-cell)` + `var(--bsg-cell-line)`
- Hover: `rgba(0,217,255,...)` neon → `var(--bsg-selectable)` fill + `var(--bsg-accent)` stroke
- `has-children`: `rgba(255,255,255,0.15)` → `var(--bsg-surface-2)`
- `action-selectable`: removed neon `pulse-hex`; now `fill: var(--bsg-selectable)`, `stroke: var(--bsg-accent)`, `stroke-dasharray: 4 2`
- `is-board-highlighted`: `var(--bsg-selectable)` + `var(--bsg-accent)` stroke
- `is-board-selected`: `var(--bsg-selected)` fill + `var(--bsg-accent)` stroke
- `is-drop-target`: `var(--bsg-droptarget)` fill + `var(--bsg-accent-2)` dotted stroke (`stroke-dasharray: 3 2`)
- `is-disabled:hover`: reset to `var(--bsg-cell)` + `var(--bsg-cell-line)`
- `hex-piece-circle`: `fill: #888` → `var(--bsg-ink-3)`
- `hex-label`: `fill: #888` → `var(--bsg-ink-3)`

**ElementRenderer.vue — confirmed clean**
- Has no `<style>` block; zero color literals anywhere. No changes made. Ready to pass the Wave 4 gate once the renderers glob is removed from ignoreFiles.

## Tasks

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Sweep GridBoardRenderer + SpaceRenderer | 27ad371 | done |
| 2 | Sweep HexBoardRenderer + confirm ElementRenderer clean | 1d12556 | done |

## Verification

- `npx stylelint` (color-no-hex, postcss-html) on all four files: 0 errors
- `! grep -nE '#00d9ff|#00ff88|rgba\(46, ?204, ?113'` on grid/hex/space: 0 matches
- `npx vitest run src/ui/components/auto-ui`: 65/65 tests pass

## Deviations from Plan

None — plan executed exactly as written. The SVG-specific note in the plan ("If fill/stroke are set via inline SVG attributes referencing literals, move them to CSS classes") was pre-empted: the existing code already used CSS classes on `<polygon>`, so no template changes were needed.

## Known Stubs

None.

## Threat Flags

None — pure CSS token substitution with no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` — no hex literals (grep + stylelint confirm)
- `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` — no hex literals
- `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` — no hex literals; hex `<g>` polygon uses dashed accent stroke for selectable, dotted accent-2 for droptarget
- `src/ui/components/auto-ui/renderers/ElementRenderer.vue` — no style block; zero color literals confirmed
- Commit `27ad371` exists (Task 1)
- Commit `1d12556` exists (Task 2)
- 65/65 vitest tests pass
