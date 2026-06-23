---
phase: 101-accessibility-wcag-wave-4
plan: 10
subsystem: ui/renderers
tags: [accessibility, a11y, css, disabled-state, reduced-motion, wcag-2.2-aa]
dependency_graph:
  requires: [101-02, 101-03, 101-04]
  provides: [A11Y-08-renderer-guards, A11Y-09-hatch-pattern]
  affects: [src/ui/components/auto-ui/renderers]
tech_stack:
  added: []
  patterns:
    - repeating-linear-gradient hatch for disabled state (non-color cue)
    - "@media (prefers-reduced-motion: reduce) animation: none per-renderer guard"
    - SVG stroke-dasharray as disabled non-color cue for polygon elements
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/DeckRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
    - src/ui/components/auto-ui/renderers/DieRenderer.vue
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
decisions:
  - CSS-only sweep: script/template sections not touched, only <style> blocks modified
  - Hatch via repeating-linear-gradient using var(--bsg-cell) token — no hex literals
  - HexBoardRenderer uses stroke-dasharray (SVG cannot use CSS background-image)
  - Mild opacity:0.6 retained alongside hatch for softness; 0.35 fully removed
  - Per-renderer @media(prefers-reduced-motion:reduce){animation:none} guard for three pulse animations
metrics:
  duration_minutes: 5
  completed_date: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
---

# Phase 101 Plan 10: Renderer Disabled Hatch + Reduced-Motion Guards Summary

**One-liner:** CSS-only sweep replacing `opacity:0.35` disabled states with `repeating-linear-gradient(var(--bsg-cell))` hatch across all 8 renderers, with SVG stroke-dasharray for HexBoardRenderer, plus explicit `prefers-reduced-motion:reduce` guards on the three renderer pulse animations.

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Disabled hatch for 6 element/HTML renderers | 96b915b | CardRenderer, DeckRenderer, HandRenderer, PieceRenderer, SpaceRenderer, DieRenderer |
| 2 | Grid + Hex hatch + reduced-motion pulse guards | a75121a | GridBoardRenderer, HexBoardRenderer, CardRenderer (pulse), HandRenderer (pulse) |

## What Was Done

### A11Y-09: Disabled State — Non-Color Cue

All 8 renderers previously used `opacity: 0.35` as the sole disabled signal, which is a color/faintness cue that fails WCAG 1.4.1 (Use of Color) for users who cannot perceive low contrast.

**HTML renderers (6):** `opacity: 0.35` replaced with:
```css
background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
opacity: 0.6;
```
The 45deg diagonal hatch using the `--bsg-cell` surface token creates a clearly perceivable pattern regardless of color perception. A mild `opacity: 0.6` (up from 0.35) is retained as secondary softness — the hatch is now the primary signal.

**GridBoardRenderer:** Same hatch pattern applied to `.grid-cell.is-disabled`.

**HexBoardRenderer:** SVG `<polygon>` elements cannot use CSS `background-image`. Instead:
```css
opacity: 0.4;
stroke: var(--bsg-ink-3);
stroke-width: 2;
stroke-dasharray: 4 3;
```
The dashed stroke is the non-color cue — it is visually distinct from the solid, dashed-accent (selectable), or dotted (drop-target) stroke states already defined. `aria-disabled` is already present on the `<g>` from Wave 2 migration.

### A11Y-08: Reduced-Motion Pulse Guards

Three renderer pulse animations previously had no per-renderer reduced-motion guard (relying only on the global block in GameShell.vue):

| Renderer | Animation | Guard Added |
|----------|-----------|-------------|
| CardRenderer | `pulse-card 2s ease-in-out infinite` | `@media (prefers-reduced-motion: reduce) { .card-container.action-selectable { animation: none } }` |
| GridBoardRenderer | `pulse-drop-target 1s ease-in-out infinite` | `@media (prefers-reduced-motion: reduce) { .grid-cell.is-drop-target { animation: none } }` |
| HandRenderer | `pulse-hand 2s ease-in-out infinite` | `@media (prefers-reduced-motion: reduce) { .hand-container.action-selectable { animation: none } }` |

These guards are belt-and-suspenders over the global block — they ensure the intent is locally documented and survives any future refactoring that moves or removes the global block.

## Verification

- `opacity: 0.35` count across all 8 renderers: **0** (verified by grep)
- `npm run lint:css` exit code: **0** (all colors via `var(--bsg-*)` tokens, no hex literals)
- `npx vitest run src/ui/components/auto-ui/renderers/`: **49/49 tests pass** (CSS-only changes; no script/template wiring altered)

## Deviations from Plan

None — plan executed exactly as written. The SVG hatch approach (stroke-dasharray instead of background-image) is explicitly anticipated by the plan ("or token stroke") and the research document.

## Known Stubs

None. This plan is CSS-only; no data wiring or UI features.

## Threat Flags

None. CSS-only changes; no network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- Commits 96b915b and a75121a exist in git log
- All 8 renderer files modified (confirmed by git diff)
- `opacity: 0.35` removed from all 8 renderers (grep returns 0)
- `npm run lint:css` exits 0
- 49 renderer tests pass
