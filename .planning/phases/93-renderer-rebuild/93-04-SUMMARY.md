---
phase: 93-renderer-rebuild
plan: 04
subsystem: ui/auto-ui
tags: [die-renderer, space-renderer, Die3D-delegation, container-renderer, never-blank]
dependency_graph:
  requires:
    - renderer-registry.ts (from 93-01)
    - renderers/ElementRenderer.vue (from 93-01)
  provides:
    - renderers/DieRenderer.vue (Die3D delegation renderer)
    - renderers/SpaceRenderer.vue (generic container dispatching children via ElementRenderer)
  affects:
    - Plan 93-06 (built-in registration will register DieRenderer and SpaceRenderer with the registry)
tech_stack:
  added: []
  patterns:
    - Die3D delegation — no new die visual logic, all 3D rendering owned by Die3D component
    - CSS custom properties for layout (--layout-gap, --layout-direction, --layout-fan, etc.)
    - tryUseBoardInteraction defensive guard pattern (returns undefined outside GameShell)
    - Never-blank 60px min-height floor on generic container
    - Text-only interpolation via {{ }} (no v-html) — T-93-11 mitigation
key_files:
  created:
    - src/ui/components/auto-ui/renderers/DieRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
  modified: []
decisions:
  - "DieRenderer uses dieId=element.id to preserve Die3D animation-state tracking (rollCount/shouldAnimateDie)"
  - "SpaceRenderer shows header only when element.name is present — no header for unnamed containers"
  - "SpaceRenderer hasOverlap/hasFan computed drive CSS class bindings from element attributes"
  - "Both renderers use tryUseBoardInteraction (not useBoardInteraction directly) — defensive guard pattern"
metrics:
  duration_minutes: 8
  completed_date: "2026-06-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
requirements_satisfied: [RENDER-01]
---

# Phase 93 Plan 04: DieRenderer and SpaceRenderer Summary

**One-liner:** DieRenderer delegates all die rendering to Die3D via attribute mapping; SpaceRenderer recurses children through ElementRenderer with CSS-var layout and a 60px never-blank container floor.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DieRenderer.vue (delegate to Die3D) | 7b89b60 | renderers/DieRenderer.vue |
| 2 | SpaceRenderer.vue (generic container — never blank) | 7ef51dc | renderers/SpaceRenderer.vue |

## What Was Built

### DieRenderer.vue (RENDER-01 die slice)

Pure delegation to the existing `Die3D` component. Maps element attributes to Die3D props:
- `sides` (default 6), `value` (default 1), `color`, `rolling`, `rollCount`, `faceLabels`, `faceImages`
- Passes `dieId=element.id` so Die3D's global animation-state tracking (`shouldAnimateDie`/`markAnimated`) continues to work correctly per die identity
- `tryUseBoardInteraction()` for action-selectable state with green pulse animation matching AutoElement.vue's die section

Board interaction: `isActionSelectable` computed with defensive guard (returns false outside GameShell). Checks `isSelectableElement` and `isDraggableSelectedElement` to match AutoElement's existing logic.

CSS: die-container with inline-flex column layout, action-selectable green outline + 2s pulse animation, hover scale(1.05). All extracted from AutoElement.vue die section styles.

No new visual die logic introduced. Die3D owns all 3D rendering, face labels, animation, and color defaults.

### SpaceRenderer.vue (RENDER-01 space slice)

Generic container renderer that dispatches all children through `ElementRenderer` (registry-based dispatch — no direct recursion to any specific element renderer).

Layout drivers (CSS custom properties on `.space-children`):
- `--layout-direction` from `$direction` attribute (column for vertical, row for horizontal)
- `--layout-gap` from `$gap` attribute (default 8px)
- `--layout-overlap` from `$overlap` attribute (negative margin percentage for stacked elements)
- `--layout-fan` and `--layout-fan-angle` from `$fan`/`$fanAngle` (rotation around center-bottom transform-origin)
- `--layout-align` from `$align` (flex-start/center/flex-end/stretch)

Never-blank guarantee: `min-height: 60px` on `.space-container` ensures an empty space always has visible extent. No "Empty" text label — an empty space is just an empty styled container.

Optional header: rendered only when `element.name` is present, showing the name (bold, #aaa, 16px) and child count in parentheses (13px, #666).

Board interaction: `isActionSelectable`, `isBoardHighlighted`, `isBoardSelected` computeds all with defensive tryUseBoardInteraction guard.

Security: All text rendered via `{{ }}` template interpolation only — no `v-html` (T-93-11 mitigation).

## Deviations from Plan

**Auto-fixed (Rule 1 - quality):** Comments in SpaceRenderer.vue initially included the string "AutoElement" in two doc comments, which would have caused the acceptance criterion `grep -c "AutoElement" ... returns 0` to fail. Rewrote comments to refer to "direct recursion" instead — functionally identical intent, satisfies the structural verification gate.

## Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` — same pre-existing failure documented in 93-01 SUMMARY. Not touched by any plan 93 work; confirmed by test count remaining 197 (196 pass + 1 pre-existing fail).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Known Stubs

None — no hardcoded empty values or placeholder text that flow to UI rendering.

## Self-Check

### Created Files
- [x] `src/ui/components/auto-ui/renderers/DieRenderer.vue` — FOUND
- [x] `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` — FOUND

### Commits
- [x] 7b89b60: feat(93-04): DieRenderer delegating to Die3D with board interaction
- [x] 7ef51dc: feat(93-04): SpaceRenderer generic container with never-blank 60px floor

## Self-Check: PASSED
