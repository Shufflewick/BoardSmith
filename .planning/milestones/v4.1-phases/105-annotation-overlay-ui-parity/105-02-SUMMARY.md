---
phase: 105-annotation-overlay-ui-parity
plan: "02"
subsystem: ui
tags: [anchor-attrs, structural-parity, auto-ui, selectable, annotation]
dependency_graph:
  requires: [105-01]
  provides: [anchorAttrs, cellAttrs, data-bs-el-* anchors on all board targets]
  affects: [useBoardInteraction, useSelectable, GridBoardRenderer, HexBoardRenderer, HandRenderer, ActionPanel]
tech_stack:
  added: []
  patterns:
    - "anchorAttrs single-source: all data-bs-el-* literals live only in one function"
    - "useSelectableGrid.cellAttrs: v-bind pattern for grid cell anchor propagation"
    - "HandRenderer v-bind merge: anchorAttrs alongside cherry-picked a11y attrs"
key_files:
  created:
    - src/ui/composables/anchorAttrs.test.ts
  modified:
    - src/ui/composables/useBoardInteraction.ts
    - src/ui/composables/useSelectable.ts
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.a11y.test.ts
decisions:
  - "anchorAttrs emits ALL present keys (id + notation + name when available) rather than applying matchesRef precedence at emit time — overlay resolves precedence at query time, letting notation/name-keyed custom UIs also match"
  - "useSelectable.ts comments must not contain data-bs-el-* literals (strict single-source grep guard)"
  - "HandRenderer uses separate v-bind for anchor (not spreading full selectableAttrs) to preserve existing :data-zone-id + cherry-picked :tabindex/:aria-disabled pattern"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-25"
  tasks_completed: 3
  tests_after: 1343
---

# Phase 105 Plan 02: Structural-Parity Anchor Substrate Summary

Export `anchorAttrs(ref)` as the single source mapping any `ElementRef` to `data-bs-el-id/notation/name` HTML attributes; merge it into `useSelectable.attrs` and `useSelectableGrid.cellAttrs` so all board element targets, grid cells, HandRenderer zones, and ActionPanel controls carry stable queryable anchors with zero per-renderer attribute logic.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | anchorAttrs single source (TDD RED) | 60ec8a3 | anchorAttrs.test.ts (created) |
| 1 | anchorAttrs single source (TDD GREEN) | f6eec0a | useBoardInteraction.ts, useSelectable.ts |
| 2 | Emit anchors on grid cells, HandRenderer, ActionPanel | 3650fd6 | GridBoardRenderer.vue, HexBoardRenderer.vue, HandRenderer.vue, ActionPanel.vue, HandRenderer.a11y.test.ts |

(Task 3 test coverage was established in Task 1 RED commit and is fully passing.)

## What Was Built

**`anchorAttrs(ref: ElementRef): Record<string, string>`** — exported from `useBoardInteraction.ts`. Maps id → `data-bs-el-id`, notation → `data-bs-el-notation`, name → `data-bs-el-name`. Only present keys are emitted; values are `String()`-coerced. Attribute name literals live ONLY here (`grep "data-bs-el" useSelectable.ts` = 0).

**`useSelectable.attrs`** — now spreads `anchorAttrs(identity())` so the 5 element-mode renderers (Card, Piece, Die, Deck, Space) inherit anchors for free via their existing `v-bind="selectableAttrs"` without any renderer changes.

**`useSelectableGrid.cellAttrs(cell)`** — new return value delegating to `anchorAttrs(getIdentity(cell))`; used in GridBoardRenderer and HexBoardRenderer via `v-bind="cellAttrs(cell)"` on each cell root.

**HandRenderer blocker fix** — `.hand-container` cherry-picks only `:tabindex`/`:aria-disabled`/`:data-zone-id` and never spreads `selectableAttrs`. Added separate `v-bind="anchorAttrs(elementIdentity())"` so the hand zone is annotation-targetable in AutoUI matching custom-UI behavior. No collision with `:data-zone-id` (both coexist; asserted by test).

**ActionPanel** — `data-bs-panel` boolean attribute on `.action-panel` root; `:data-bs-action="action.name"` on each `.action-btn`.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written.

### Notes

- `DiceRenderer.vue` referenced in the plan context does not exist; the file is `DieRenderer.vue`. Test file uses the correct name. No plan deviation required.

## Test Coverage

- `anchorAttrs.test.ts`: 15 tests covering id-only/notation-only/name-only/all-three ref shapes; useSelectable.attrs anchor merge; useSelectableGrid.cellAttrs; negative single-source guard (filesystem assertion).
- `HandRenderer.a11y.test.ts`: 3 new anchor tests proving `.hand-container` carries `data-bs-el-id` and `data-bs-el-name` without collision vs `data-zone-id`.
- Full suite: 1343 tests (was 1325 before phase 105; +18 from 105-01 and this plan).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. Anchor attributes are inert HTML markup; values originate from engine-assigned ids / author notation, String()-coerced into attribute values; Vue binding escapes them (T-105-04 accepted).

## Self-Check

Files created/modified:
- [x] src/ui/composables/anchorAttrs.test.ts
- [x] src/ui/composables/useBoardInteraction.ts
- [x] src/ui/composables/useSelectable.ts
- [x] src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
- [x] src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
- [x] src/ui/components/auto-ui/renderers/HandRenderer.vue
- [x] src/ui/components/auto-ui/ActionPanel.vue
- [x] src/ui/components/auto-ui/renderers/HandRenderer.a11y.test.ts
