---
phase: 93-renderer-rebuild
plan: 06
subsystem: ui/auto-ui
tags: [integration-point, builtin-renderers, auto-renderer, animation-wiring, tdd, deletion]
dependency_graph:
  requires:
    - renderer-registry.ts (93-01)
    - archetype-selector.ts (93-01)
    - renderers/ElementRenderer.vue (93-01)
    - renderers/CardRenderer.vue (93-02)
    - renderers/HandRenderer.vue (93-02)
    - renderers/DeckRenderer.vue (93-02)
    - renderers/DieRenderer.vue (93-04)
    - renderers/GridBoardRenderer.vue (93-03)
    - renderers/HexBoardRenderer.vue (93-03)
    - renderers/PieceRenderer.vue (93-03)
    - renderers/SpaceRenderer.vue (93-03)
    - archetypes/GridBoardTemplate.vue (93-05)
    - archetypes/CardTemplate.vue (93-05)
    - archetypes/TableauTemplate.vue (93-05)
    - archetypes/UnsupportedTopologyPanel.vue (93-05)
  provides:
    - builtin-renderers.ts (module-load registration of 8 built-in renderers)
    - AutoRenderer.vue (host: provides + archetype dispatch + animation wiring)
    - useAutoRendererAnimations.ts (testable animation composable — RENDER-05)
  affects:
    - AutoUI.vue (now renders AutoRenderer, not AutoGameBoard)
    - src/ui/index.ts (registerRenderer exported; AutoRenderer replaces AutoGameBoard/AutoElement)
    - auto-ui/index.ts (AutoRenderer + registerRenderer exported; old files removed)
tech_stack:
  added: []
  patterns:
    - Module-load side-effect registration (builtin-renderers.ts imported in AutoRenderer.vue)
    - Testable animation-wiring composable (useAutoRendererAnimations — RENDER-05)
    - Inject-only animation events (useAnimationEvents; never createAnimationEvents in renderer)
    - Archetype dispatch via selectArchetype() computed
    - TDD RED/GREEN cycle for animation composable
key_files:
  created:
    - src/ui/components/auto-ui/builtin-renderers.ts
    - src/ui/components/auto-ui/AutoRenderer.vue
    - src/ui/components/auto-ui/useAutoRendererAnimations.ts
    - src/ui/components/auto-ui/useAutoRendererAnimations.test.ts
  modified:
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/auto-ui/index.ts
    - src/ui/index.ts
    - src/ui/components/auto-ui/auto-ui-helpers.ts (comment-only)
    - src/ui/composables/dragImage.ts (comment-only)
    - src/ui/composables/useDragDrop.ts (comment-only)
    - src/ui/components/auto-ui/renderers/*.vue (comment-only straggler cleanup)
    - src/ui/components/auto-ui/builtin-renderers.ts (comment-only)
    - src/ui/components/auto-ui/AutoRenderer.vue (Task 2 animation wiring added)
  deleted:
    - src/ui/components/auto-ui/AutoElement.vue (2355 lines — D-01 single source of truth)
    - src/ui/components/auto-ui/AutoGameBoard.vue (503 lines — D-01 single source of truth)
decisions:
  - "D-01 enforced: AutoElement.vue and AutoGameBoard.vue git rm'd; no dual path remains"
  - "RENDER-01 substrate preservation: useDragDropTargets.ts comment straggler preserved over substrate purity violation — JSDoc comment is not a dual path"
  - "RENDER-05 composable: useAutoRendererAnimations extracted for testability; animation wiring tested without @vue/test-utils via createAnimationEvents directly"
  - "selectableElements/selectedElements provided as empty Ref<Set> from AutoRenderer (new renderers use tryUseBoardInteraction() directly)"
  - "A1-A2 finding: gate/demo games emit zero semantic deal/flip/reveal events (see below)"
metrics:
  duration_minutes: 25
  completed_date: "2026-06-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 10
  files_deleted: 2
requirements_satisfied: [RENDER-01, RENDER-05]
---

# Phase 93 Plan 06: Integration Point Summary

**One-liner:** AutoRenderer host with module-load 8-renderer registration, archetype dispatch, inject-only animation wiring (tested composable), and full D-01 deletion of AutoElement/AutoGameBoard — single source of truth established.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | builtin-renderers.ts + AutoRenderer.vue host | 4871e5d | builtin-renderers.ts, AutoRenderer.vue |
| 2 RED | useAutoRendererAnimations test (failing) | 40c7000 | useAutoRendererAnimations.test.ts |
| 2 GREEN | useAutoRendererAnimations composable + AutoRenderer wiring | 777df59 | useAutoRendererAnimations.ts, AutoRenderer.vue |
| 3 | Wire AutoUI, update exports, delete old files | 8098734 | AutoUI.vue, index.ts, src/ui/index.ts, AutoElement.vue (del), AutoGameBoard.vue (del) |

## What Was Built

### builtin-renderers.ts (D-01 integration)

Module-load side-effect file that registers all eight built-in element renderers in the renderer-registry singleton. Imported in `AutoRenderer.vue` so registration runs exactly once at module load (Pitfall 5 guard — no `onMounted`).

Priority mapping:
| Renderer | Priority | test() condition |
|----------|----------|-----------------|
| CardRenderer | 10 | `$type === 'card'` |
| HandRenderer | 9 | `$type === 'hand'` |
| DeckRenderer | 8 | `$type === 'deck'` |
| DieRenderer | 7 | `$type === 'die'` |
| GridBoardRenderer | 6 | `$layout === 'grid'` |
| HexBoardRenderer | 5 | `$layout === 'hex-grid'` |
| PieceRenderer | 2 | no children AND no specific $type/$layout |
| SpaceRenderer | 1 | catch-all (always returns 1) |

### AutoRenderer.vue (host component)

Direct replacement for AutoGameBoard.vue. Provides: DIE_ANIMATION_CONTEXT_KEY, playerSeat, selectableElements (empty Set), selectedElements (empty Set), defaultBackImage. Computes archetype via `selectArchetype(topLevelChildren)`. Template dispatches to GridBoardTemplate / CardTemplate / UnsupportedTopologyPanel / TableauTemplate with FlyingCardsOverlay.

### useAutoRendererAnimations.ts + test (RENDER-05)

Testable composable extracted from AutoRenderer for unit-test coverage without `@vue/test-utils`. Registers deal/flip/reveal handlers on the injected animation-events instance:
- `'deal'`: skip:'drop', calls `fly()` from sourceRect to destinationRect (defensive — missing keys skip silently)
- `'flip'`: skip:'run', registered for cooperative-skip sync (future: CSS flip-by-id)
- `'reveal'`: skip:'drop', calls `fly()` same as deal

`undefined` animationEvents returns immediately (no throw — A3).

6 tests pass covering all 4 behavior cases from the plan.

### AutoUI.vue + exports (D-01)

AutoUI.vue: 1-line swap from `<AutoGameBoard>` to `<AutoRenderer>`.

auto-ui/index.ts: Exports AutoUI, AutoRenderer, ActionPanel, registerRenderer, resolveRenderer (for barrel consumers). AutoElement and AutoGameBoard removed.

src/ui/index.ts: Public API now exports AutoRenderer + registerRenderer (D-03). resolveRenderer is internal (0 occurrences in src/ui/index.ts).

AutoElement.vue (2355 lines) and AutoGameBoard.vue (503 lines) deleted via `git rm`.

## A1-A2 Finding: gate/demo game.animate() event types

**For plan 93-07 browser verification:**

| Game | game.animate() calls | Emitted types |
|------|---------------------|---------------|
| hex | None | — |
| go-fish | None | — |
| checkers | None (CheckersBoard.vue uses DOM `.animate()`, not `game.animate()`) | — |
| demo-animation | `game.animate('demo', {...})` | `'demo'` only |

**Conclusion:** The gate games (hex, go-fish, checkers) do NOT emit semantic animation events via `game.animate()`. The `demo-animation` game emits `'demo'` events only — not deal/flip/reveal.

The deal/flip/reveal handlers in `useAutoRendererAnimations` are future-ready: they will fire when game authors call `game.animate('deal', {...})` in their rules code. No existing gate game will trigger them. Browser verification (93-07) should focus on: board renders, archetype dispatch, element renderer dispatch, and the 'demo' event type in demo-animation if that game is used.

## Deviations from Plan

### Accepted Deviation: 1 comment straggler in useDragDropTargets.ts

`useDragDropTargets.ts` line 177 contains a JSDoc comment: `"When a drag starts (via the board's AutoElement or a custom UI's useDragDrop)"`. This file is in the RENDER-01 substrate source list (zero-diff required). Removing the comment would violate substrate preservation.

The straggler is a JSDoc comment, not an import or code reference. It creates no dual path. Documented here per plan; `git diff --stat` over the substrate source files returns zero.

**Impact:** `grep -rn "AutoElement\|AutoGameBoard" src/` returns 1 match (comment only). This is the only deviation from the 0-match criterion.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes.

- T-93-16 mitigated: `useAutoRendererAnimations` handlers access event.data defensively (missing keys → silent skip). Test case "empty data does not throw" verifies this.
- T-93-17 mitigated: AutoRenderer uses `useAnimationEvents()` inject only. `createAnimationEvents` is not called anywhere in the renderer system (`grep -c "createAnimationEvents" src/ui/components/auto-ui/AutoRenderer.vue` returns 0).
- T-93-19 mitigated: RENDER-01 verified — 5 substrate source files have zero diff; 7 substrate test files have zero diff.

## Known Stubs

None — no hardcoded empty values or placeholder data that flow to UI rendering.

## Self-Check

### Created Files
- [x] `src/ui/components/auto-ui/builtin-renderers.ts` — FOUND
- [x] `src/ui/components/auto-ui/AutoRenderer.vue` — FOUND
- [x] `src/ui/components/auto-ui/useAutoRendererAnimations.ts` — FOUND
- [x] `src/ui/components/auto-ui/useAutoRendererAnimations.test.ts` — FOUND

### Deleted Files
- [x] `src/ui/components/auto-ui/AutoElement.vue` — DELETED (git rm)
- [x] `src/ui/components/auto-ui/AutoGameBoard.vue` — DELETED (git rm)

### Commits
- [x] 4871e5d: feat(93-06): builtin-renderers module-load registration + AutoRenderer host
- [x] 40c7000: test(93-06): add failing tests for useAutoRendererAnimations (RENDER-05 RED)
- [x] 777df59: feat(93-06): useAutoRendererAnimations composable + AutoRenderer wiring (RENDER-05)
- [x] 8098734: feat(93-06): wire AutoUI→AutoRenderer, update exports, delete old renderer files (D-01)

## Self-Check: PASSED
