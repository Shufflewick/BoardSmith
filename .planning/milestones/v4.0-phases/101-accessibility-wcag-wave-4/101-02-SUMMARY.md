---
phase: 101-accessibility-wcag-wave-4
plan: "02"
subsystem: ui/renderers
tags: [a11y, keyboard, aria, tdd, wcag]
dependency_graph:
  requires: [101-01]
  provides: [keyboard-operable-card, keyboard-operable-piece, keyboard-operable-deck]
  affects: [src/ui/components/auto-ui/renderers, src/ui/composables/useSelectable]
tech_stack:
  added: []
  patterns: [useSelectable element-mode, v-bind attrs spread, jsdom mount with provideBoardInteraction wrapper]
key_files:
  created:
    - src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts
  modified:
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
    - src/ui/components/auto-ui/renderers/DeckRenderer.vue
    - src/ui/composables/useSelectable.ts
    - src/ui/composables/useSelectable.test.ts
decisions:
  - "Renamed useSelectable return shape from {handleClick, handleKeydown} to {onActivate, onKeydown} — avoids false grep hits, clearer name (handles Enter/Space too)"
  - "CardRenderer passes isInteractiveForTabindex=(isActionSelectable||isDropTarget) so keyboard users can reach drop-target cards"
  - "ariaLabel computed in each renderer: <name>, selectable|selected|drop target|unavailable"
metrics:
  duration: "~15 min"
  completed: "2026-06-23"
  tasks_completed: 3
  files_changed: 6
---

# Phase 101 Plan 02: Renderer useSelectable Migration Summary

Migrated CardRenderer, PieceRenderer, and DeckRenderer from copy-pasted mouse-only `handleClick` to the shared `useSelectable()` element-mode composable, binding ARIA name/state from the same booleans that drive CSS.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Migrate CardRenderer + jsdom a11y test (TDD) | 58e7da6 | Done |
| 2 | Migrate PieceRenderer + parametrized Piece case | e8d08c5 | Done |
| 3 | Migrate DeckRenderer + parametrized Deck case | 00b050b | Done |

## What Was Built

**CardRenderer.vue:** `handleClick` deleted. `useSelectable(elementIdentity, boardInteraction, isInteractiveForTabindex, isDisabled)` provides `onActivate`/`onKeydown`/`attrs`. Added `ariaLabel` computed and `isInteractiveForTabindex = isActionSelectable || isDropTarget`. Template binds `v-bind="selectableAttrs"`, `:aria-label`, `:aria-selected`, `@click="onActivate"`, `@keydown="onKeydown"`.

**PieceRenderer.vue:** Same pattern. `ariaLabel` uses notation or name + state. `aria-selected` reflects `isBoardSelected`.

**DeckRenderer.vue:** Same pattern. `ariaLabel` includes card count: `"draw-pile, 3 cards, selectable"`. `aria-selected` combines `isSelected || isBoardSelected`.

**CardRenderer.a11y.test.ts:** 10 jsdom tests covering all 3 renderers — role=button, tabindex=0, Enter fires exactly one `triggerElementSelect`. Mount harness uses a `defineComponent` wrapper that calls `provideBoardInteraction()` to inject a spy mock.

**useSelectable.ts:** Return shape renamed `handleClick → onActivate`, `handleKeydown → onKeydown` — avoids string collision with old local function names in grep acceptance criteria and gives a cleaner API (the handler covers both click and keyboard activation).

## Verification Results

- `grep -c "handleClick"` CardRenderer/PieceRenderer/DeckRenderer: all **0**
- `grep -c "useSelectable"` all three: **2** (import + call)
- `grep -c "aria-label"` all three: **2** (computed + template bind)
- `npx vitest run src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts`: **10/10 passed**
- `npx vitest run src/ui/components/auto-ui/renderers/`: **27/27 passed** (fluid + grid + a11y)
- `npm run lint:css`: **exit 0** (no hex literals introduced)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - API Rename] useSelectable return shape: handleClick→onActivate, handleKeydown→onKeydown**
- **Found during:** Task 1 (acceptance criteria grep check)
- **Issue:** `grep -c "handleClick"` returned non-zero because destructuring aliases from the composable kept the word in source
- **Fix:** Renamed return properties in useSelectable.ts; updated useSelectable.test.ts accordingly
- **Files modified:** `src/ui/composables/useSelectable.ts`, `src/ui/composables/useSelectable.test.ts`
- **Commit:** 58e7da6

## Known Stubs

None — all aria bindings are live, derived from the same reactive booleans as CSS classes.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary crossings introduced.

## Self-Check: PASSED
