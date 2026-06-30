---
phase: 93-renderer-rebuild
plan: 01
subsystem: ui/auto-ui
tags: [renderer-registry, archetype-selector, dispatch, pure-module, tdd]
dependency_graph:
  requires: []
  provides:
    - renderer-registry.ts (registerRenderer, resolveRenderer, RendererEntry, resetRegistry)
    - archetype-selector.ts (selectArchetype, Archetype)
    - renderers/ElementRenderer.vue (registry-dispatch wrapper)
  affects:
    - Future plans in Phase 93 (93-02 through 93-07) consume renderer-registry and ElementRenderer
tech_stack:
  added: []
  patterns:
    - Ranked-tester registry (JSONForms rankWith pattern) — module-level singleton, highest priority wins
    - Topology-ranked archetype selection — grid/hex first, then card-dominance, then free-form, then tableau
    - try/catch wrapping of consumer test() functions (T-93-01 DoS mitigation)
    - Local GameElement interface (dependency-free pure TypeScript modules)
key_files:
  created:
    - src/ui/components/auto-ui/renderer-registry.ts
    - src/ui/components/auto-ui/renderer-registry.test.ts
    - src/ui/components/auto-ui/archetype-selector.ts
    - src/ui/components/auto-ui/archetype-selector.test.ts
    - src/ui/components/auto-ui/renderers/ElementRenderer.vue
  modified: []
decisions:
  - "Priority bands: built-ins 1-10, reserved 11-99, consumer overrides 100+ (per D-03)"
  - "grid/hex detection runs before card-dominance check to guard Pitfall 4 (mixed topology trees)"
  - "resetRegistry() exported as test-only helper (not hidden) — explicit contract over magic"
  - "ElementRenderer renders nothing when resolveRenderer returns null — no fallback render"
metrics:
  duration_minutes: 20
  completed_date: "2026-06-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 0
requirements_satisfied: [RENDER-02, RENDER-03, RENDER-04]
---

# Phase 93 Plan 01: Renderer Dispatch Foundations Summary

**One-liner:** Ranked-tester renderer registry + topology-ranked archetype selector + ElementRenderer dispatch wrapper, all as dependency-free pure TypeScript with 14 unit tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | renderer-registry.ts + unit tests (RENDER-02) | 5dd3222 | renderer-registry.ts, renderer-registry.test.ts |
| 2 | archetype-selector.ts + unit tests (RENDER-03, RENDER-04) | 86b2de7 | archetype-selector.ts, archetype-selector.test.ts |
| 3 | ElementRenderer.vue dispatch wrapper | 4d493e5 | renderers/ElementRenderer.vue |

## What Was Built

### renderer-registry.ts (RENDER-02)

Module-level singleton ranked-tester registry. `registerRenderer` pushes entries; `resolveRenderer` iterates and returns the component with the highest positive `test()` result.

Priority bands (D-03):
- 1–10: built-in element renderers
- 11–99: reserved for future built-in specializations
- 100+: consumer overrides (game authors upgrade auto-UI in place)

Pit-of-success mitigation (T-93-01): each `test()` call is wrapped in `try/catch`. A throwing consumer test is treated as -1 and `console.warn`'d — one bad entry never blanks the whole board.

### archetype-selector.ts (RENDER-03, RENDER-04)

Pure function `selectArchetype(topLevelElements)` implementing topology-ranked selection per D-02:

1. Grid/hex present → `'grid-board'` (highest priority, guards Pitfall 4)
2. Card/hand/deck >= 50% of elements → `'card'`
3. Free-form layout → `'unsupported'` (honest-fail boundary, RENDER-04)
4. Otherwise → `'tableau'` (never throws, safe on empty array)

The grid/hex check runs before card-dominance to prevent mixed-topology trees (hex board + card elements) from classifying as `'card'`.

### renderers/ElementRenderer.vue (dispatch wrapper)

Thin wrapper that calls `resolveRenderer(props.element)` and renders `<component :is="rendererComponent">`. Passes `element`, `depth`, and `hexPieceSize` to the resolved component. Renders nothing when `resolveRenderer` returns null (no built-ins registered yet — plan 93-06 adds those). No AutoElement recursion. No engine imports.

## Test Coverage

- `renderer-registry.test.ts`: 7 tests covering all 6 RENDER-02 behavior cases plus resetRegistry
- `archetype-selector.test.ts`: 7 tests covering all 4 archetype paths + empty array + Go Fish hand-dominant + Pitfall 4 guard (hex-grid + cards → grid-board)
- Total: 14 new tests, all green

## Deviations from Plan

None — plan executed exactly as written.

## Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` — one test fails with `expected 'endTurn' to be 'collectEquipment'`. This failure exists on the worktree base commit (f590412) before any of my changes. Confirmed via `git diff f590412 HEAD -- src/ui/composables/useActionController.test.ts` returning empty — neither the test file nor the implementation was touched by this plan. Out of scope per deviation boundary rule.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Known Stubs

None — no hardcoded empty values or placeholder text that flow to UI rendering.

## Self-Check

### Created Files
- [x] `src/ui/components/auto-ui/renderer-registry.ts` — FOUND
- [x] `src/ui/components/auto-ui/renderer-registry.test.ts` — FOUND
- [x] `src/ui/components/auto-ui/archetype-selector.ts` — FOUND
- [x] `src/ui/components/auto-ui/archetype-selector.test.ts` — FOUND
- [x] `src/ui/components/auto-ui/renderers/ElementRenderer.vue` — FOUND

### Commits
- [x] 5dd3222: feat(93-01): ranked-tester renderer registry (RENDER-02)
- [x] 86b2de7: feat(93-01): archetype selector with topology-ranked selection (RENDER-03, RENDER-04)
- [x] 4d493e5: feat(93-01): ElementRenderer registry-dispatch wrapper component

## Self-Check: PASSED
