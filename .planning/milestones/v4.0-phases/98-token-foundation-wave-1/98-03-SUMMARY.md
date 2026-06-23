---
phase: 98-token-foundation-wave-1
plan: "03"
subsystem: ui/renderers
tags: [tokens, css-custom-properties, namespace-rename, drag-drop, hex-board]
dependency_graph:
  requires: [98-01]
  provides: [bsg-namespace-complete, seat-color-tokens]
  affects:
    - src/ui/animation/drag-drop.css
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
tech_stack:
  added: []
  patterns: [css-custom-properties, single-source-of-truth, token-reference]
key_files:
  created: []
  modified:
    - src/ui/animation/drag-drop.css
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
decisions:
  - "drag-drop.css :root block deleted entirely — theme.ts is sole owner of --bsg-droptarget* defaults (No Backward Compatibility)"
  - "Seatless HexBoardRenderer pieces fall back to var(--bsg-ink-3) not a seat-cycle color — neutral pieces should not claim a player seat slot"
  - "getPieceColor pieceIndex param renamed to _pieceIndex (underscore convention) since it is no longer consumed after removing the index-based seat cycle fallback"
metrics:
  duration: "10 minutes"
  completed: "2026-06-23"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 6
---

# Phase 98 Plan 03: --bs-* Namespace Rename + HexBoardRenderer Seat Tokens Summary

**One-liner:** Mechanical TOKEN-01/TOKEN-02 rename collapsing the `--bs-*` custom-property namespace into `--bsg-*` across drag-drop.css and five renderers, plus wiring HexBoardRenderer seat coloring to the single `--bsg-seat-1..6` token source in theme.ts.

## What Was Built

### Task 1 — drag-drop.css (TOKEN-01)

Deleted the entire `:root { ... }` block (12 neon `--bs-*` default declarations) from `drag-drop.css`. The theme.ts `STATIC_TOKENS` block now owns those defaults (registered in Plan 98-01). Every `var(--bs-*)` reference in the `.bs-draggable`, `.bs-dragging`, `.bs-drop-target`, and `.bs-drop-hover` rule blocks was renamed to its `--bsg-*` equivalent per the plan interface map. Inline neon rgba fallbacks were dropped (theme.ts provides the value). The header doc comment was updated to use `applyTheme()` override pattern with `--bsg-*` names.

### Task 2 — Five renderer files (TOKEN-01)

All `var(--bs-*)` references across five renderer `.vue` files renamed to `--bsg-*` equivalents, with neon rgba inline fallbacks removed:

- **HandRenderer.vue** (lines 431, 436): `--bs-drop-target-bg` / `--bs-drop-hover-bg` → `--bsg-droptarget` / `--bsg-droptarget-hover`
- **CardRenderer.vue** (lines 488–497): `--bs-dragging-opacity/scale` and `--bs-drop-target-bg/hover-bg` renamed; CardRenderer already had no inline fallbacks on the drop-target/hover refs
- **GridBoardRenderer.vue** (lines 324, 329, 338, 339): drop-target/hover renamed in both the direct rules and the `@keyframes pulse-drop-target` blocks
- **SpaceRenderer.vue** (lines 221, 226): drop-target/hover renamed
- **HexBoardRenderer.vue** (line 325): SVG `fill` drop-target renamed (seat cycle handled in Task 3)

### Task 3 — HexBoardRenderer seat colors (TOKEN-02)

Removed the `PLAYER_COLOR_CYCLE` Flat-UI hex array (`#e74c3c`, `#3498db`, `#2ecc71`, `#f39c12`, `#9b59b6`, `#1abc9c`). Rewrote `getPieceColor`:

- `player.color` short-circuit preserved (explicit per-player color wins)
- Seated pieces: `var(--bsg-seat-${(player.seat % 6) + 1})` — resolves from theme.ts `SEAT_PALETTE` single source; `applyTheme()` overrides re-skin seats automatically
- Seatless pieces: `var(--bsg-ink-3)` neutral (instead of `#888` raw hex)

The `pieceIndex` parameter is now unused; renamed to `_pieceIndex` per TS convention.

## Token Rename Map Applied

| Old name | New name |
|----------|----------|
| `--bs-draggable-cursor` | `--bsg-draggable-cursor` |
| `--bs-dragging-cursor` | `--bsg-dragging-cursor` |
| `--bs-dragging-opacity` | `--bsg-dragging-opacity` |
| `--bs-dragging-scale` | `--bsg-dragging-scale` |
| `--bs-drag-transition` | `--bsg-drag-transition` |
| `--bs-drop-target-bg` | `--bsg-droptarget` |
| `--bs-drop-target-border-color` | `--bsg-droptarget-border` |
| `--bs-drop-target-shadow` | `--bsg-droptarget-shadow` |
| `--bs-drop-hover-bg` | `--bsg-droptarget-hover` |
| `--bs-drop-hover-border-color` | `--bsg-droptarget-hover-border` |
| `--bs-drop-hover-shadow` | `--bsg-droptarget-hover-shadow` |
| `--bs-drop-hover-scale` | `--bsg-droptarget-hover-scale` |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan is a mechanical rename with no new UI rendering or data wiring.

## Threat Flags

None. Pure CSS-variable rename; no new network endpoints, auth paths, or trust boundary crossings introduced.

## Verification Results

- `grep -rn -- '--bs-' src/ui | grep -v -- '--bsg-'` → no matches (PASS)
- `grep -- '--bsg-seat-' src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` → 2 matches (PASS)
- `npx vitest run` → 959/959 pass
- PLAYER_COLOR_CYCLE and Flat-UI hex literals absent from HexBoardRenderer.vue (PASS)
- drag-drop.css contains no `:root` block (PASS)

## Self-Check: PASSED

- `src/ui/animation/drag-drop.css` — exists, no :root block, no --bs-* custom props
- `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` — PLAYER_COLOR_CYCLE gone, --bsg-seat- present
- All 5 renderers: no --bs-* custom-property references remain
- Commits: `ef321b8` (Task 1), `6de1e68` (Task 2), `d078e62` (Task 3)
