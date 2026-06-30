---
phase: 93-renderer-rebuild
plan: 05
subsystem: ui/auto-ui
tags: [archetype-templates, grid-board, card, tableau, unsupported-topology, honest-fail, render-03, render-04]
dependency_graph:
  requires:
    - renderer-registry.ts (93-01)
    - archetype-selector.ts (93-01)
    - renderers/ElementRenderer.vue (93-01)
  provides:
    - archetypes/GridBoardTemplate.vue (focal-board/docked-hand/peripheral-chrome CSS grid-template-areas layout)
    - archetypes/CardTemplate.vue (hand-dominant flex-column layout)
    - archetypes/TableauTemplate.vue (flex-wrap general catch-all)
    - archetypes/UnsupportedTopologyPanel.vue (RENDER-04 honest-fail amber boundary)
  affects:
    - AutoRenderer.vue (93-06) — selects among these four via selectArchetype()
tech_stack:
  added: []
  patterns:
    - CSS grid-template-areas with 1fr dominant board area (hierarchy encoding, not equal subdivision)
    - Local GameElement interface per component (dependency-free, no engine imports)
    - ElementRenderer-only child dispatch (no direct element rendering in templates)
    - Locked static copy pattern (no props, no dynamic content, no v-html)
key_files:
  created:
    - src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue
    - src/ui/components/auto-ui/archetypes/CardTemplate.vue
    - src/ui/components/auto-ui/archetypes/TableauTemplate.vue
    - src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue
  modified: []
decisions:
  - "C6 anti-pattern explicitly avoided: GridBoardTemplate uses 1fr board area + auto chrome/hand — never equal-space subdivision"
  - "Hand strip in GridBoardTemplate collapses entirely via v-if when no hand elements present"
  - "Chrome row in GridBoardTemplate collapses entirely via v-if when no peripheral elements present"
  - "UnsupportedTopologyPanel takes no required props — copy is fully static (locked Copywriting Contract)"
  - "v-html not used anywhere in archetype templates (XSS guard; CLAUDE.md never-leak rule)"
metrics:
  duration_minutes: 6
  completed_date: "2026-06-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 0
requirements_satisfied: [RENDER-03, RENDER-04]
---

# Phase 93 Plan 05: Archetype Templates + UnsupportedTopologyPanel Summary

**One-liner:** Four hierarchy-bearing archetype templates (GridBoard/Card/Tableau/UnsupportedTopology) with CSS grid-template-areas dominant-area layout and ElementRenderer-exclusive child dispatch, satisfying RENDER-03 and RENDER-04.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | GridBoardTemplate.vue (focal board + docked hand + peripheral chrome) | 5811fa8 | archetypes/GridBoardTemplate.vue |
| 2 | CardTemplate.vue + TableauTemplate.vue | e8f1159 | archetypes/CardTemplate.vue, archetypes/TableauTemplate.vue |
| 3 | UnsupportedTopologyPanel.vue (loud honest-fail boundary) | c24c763 | archetypes/UnsupportedTopologyPanel.vue |

## What Was Built

### GridBoardTemplate.vue (RENDER-03)

CSS `grid-template-areas: "chrome" / "board" / "hand"` with `grid-template-rows: auto 1fr auto`. The board area gets `1fr` (dominant); chrome row and hand strip are `auto`. Collapses via `v-if` when empty — hand strip disappears entirely when no hand elements exist.

Three computed classifiers:
- `boardElements`: `$layout === 'grid' || 'hex-grid'`
- `handElements`: `$type === 'hand'`
- `chromeElements`: everything else (decks, discards, scores — docked in chrome, never given equal area)

C6 anti-pattern explicitly avoided: non-board elements go in the chrome slot at auto height.

### CardTemplate.vue (RENDER-03)

Flex column layout. `handElements` (className=Hand or `$type=hand`) get `flex: 1` — the dominant area. `peripheralElements` (decks, discards) are auto-height above. Hand zone centered with `align-items: center; justify-content: center`.

### TableauTemplate.vue (RENDER-03)

General catch-all: `display: flex; flex-wrap: wrap; gap: 32px`. Renders every child via `ElementRenderer` unconditionally — guaranteed to never produce a blank screen (T-93-15 mitigation).

### UnsupportedTopologyPanel.vue (RENDER-04)

Locked amber panel with no props. Heading: "This layout cannot be auto-generated" (#f59e0b, 20px, 700 weight). Body: "This game uses a layout that is outside the auto-UI's supported set (grid, hex, stack, hand). Build a custom UI component for this game — see the custom UI guide." No `v-html`, no element IDs, no stack traces, no TypeScript types exposed.

## Carry-Forward Requirement: Grid Error Copy (D-03)

This plan does not contain GridBoardRenderer — the grid-error-panel copy parity requirement (carry-forward #3: exact string `Grid "<id>" can't render — declare $rowCoord/$colCoord on the Grid element`) applies to GridBoardRenderer.vue (plan 93-04 or future plan). Not applicable to this plan's files.

## Deviations from Plan

None — plan executed exactly as written.

## Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` fails with `expected 'endTurn' to be 'collectEquipment'`. This failure exists on the worktree base commit (6555231) before any of my changes — confirmed by 93-01 SUMMARY. Out of scope per deviation boundary rule.

## Known Stubs

None — all copy is locked static text; no hardcoded empty values or placeholder data flow to UI rendering.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. T-93-13 (information disclosure) mitigated: UnsupportedTopologyPanel renders only static locked copy with no implementation details. T-93-14 (XSS) mitigated: no `v-html` in any template; all author content flows through per-element renderers. T-93-15 (availability) mitigated: TableauTemplate renders every zone unconditionally.

## Self-Check

### Created Files
- [x] `src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue` — FOUND
- [x] `src/ui/components/auto-ui/archetypes/CardTemplate.vue` — FOUND
- [x] `src/ui/components/auto-ui/archetypes/TableauTemplate.vue` — FOUND
- [x] `src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue` — FOUND

### Commits
- [x] 5811fa8: feat(93-05): GridBoardTemplate focal-board/docked-hand/peripheral-chrome archetype
- [x] e8f1159: feat(93-05): CardTemplate hand-dominant + TableauTemplate flex-wrap fallback archetypes
- [x] c24c763: feat(93-05): UnsupportedTopologyPanel loud amber honest-fail boundary (RENDER-04)

## Self-Check: PASSED
