---
phase: 94-interaction-presentation-playability
plan: "03"
subsystem: ui/renderers
tags: [board-interaction, auto-ui, renderers, playability]
dependency_graph:
  requires: [94-01]
  provides: [board-click-affordances, six-interaction-states, multi-ref-highlight-surface, piece-action-selectable, hand-element-name]
  affects: [src/ui/components/auto-ui/renderers]
tech_stack:
  added: []
  patterns: [tryUseBoardInteraction, elementIdentity-helper, notation-pitfall-6-guard]
key_files:
  modified:
    - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
    - src/ui/components/auto-ui/renderers/DeckRenderer.vue
    - src/ui/components/auto-ui/renderers/DieRenderer.vue
decisions:
  - "elementIdentity() helper uses attributes?.notation (not element.name) per Pitfall 6"
  - "HandRenderer falls back to ownership label only when element.name is absent (CF-2)"
  - "PieceRenderer gets action-selectable class binding parity with all other renderers (CF-1)"
  - "Added is-disabled state + handleClick guard to all 8 renderers (STRIDE T-94-03-01)"
  - "Zone renderers (Hand/Space) get full drop-target support via isDropTarget + triggerDrop"
  - "HexBoardRenderer gets is-drop-target + handleHexDrop for completeness"
metrics:
  duration: "8 minutes"
  completed: "2026-06-21T21:26:54Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
---

# Phase 94 Plan 03: Board Interaction Affordances for All Renderers

All 8 auto-UI renderers now surface the six required interaction states and dispatch board clicks through the shared `useBoardInteraction` substrate, making the auto-UI playable by direct board manipulation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire gate-critical board renderers (Grid, Hex, Piece) | 2348c74 | GridBoardRenderer.vue, HexBoardRenderer.vue, PieceRenderer.vue |
| 2 | Wire card-family, zone, and leaf renderers (Card/Hand/Space/Deck/Die) | fa00779 | CardRenderer.vue, HandRenderer.vue, SpaceRenderer.vue, DeckRenderer.vue, DieRenderer.vue |

## What Was Built

**Notation-aware element identity (Pitfall 6):** All 8 renderers now use an `elementIdentity()` helper that passes `notation: el.attributes?.notation` to all `useBoardInteraction` calls. This ensures `matchesRef` correctly matches notation-keyed board refs (e.g., Checkers squares like `{ notation: 'e5' }`) that store notation in `element.attributes.notation` rather than as a top-level field.

**Six interaction states in all renderers:**
- `.action-selectable` — green pulsing outline, cursor pointer
- `.is-board-highlighted` — cyan background/stroke (multi-ref highlight, all roles)
- `.is-board-selected` — bright green background/stroke
- `.is-drop-target` — green drop zone treatment
- `.is-disabled` — opacity 0.35, cursor not-allowed, disabled click guard

**Click dispatch:** All renderers dispatch `triggerElementSelect` on click when `isActionSelectable` is true, with a disabled guard before dispatch (T-94-03-01 mitigated).

## Carry-Forward Items Resolved

**CF-1 (PieceRenderer missing action-selectable):** PieceRenderer now has:
- `action-selectable: isActionSelectable` class binding
- `is-board-highlighted: isHighlighted` class binding
- `is-board-selected: isBoardSelected` class binding
- `is-disabled: isDisabled` class binding
- `handleClick()` function dispatching `triggerElementSelect`
- `@click="handleClick"` bound to the piece root element

Pieces now have full six-state interaction parity with every other element type.

**CF-2 (HandRenderer hardcodes "Your Hand"):** The hand header now displays `element.name` when the game designer declares one, falling back to the ownership label (`"Your Hand"` / `"X's Hand"`) only when `element.name` is absent. The hardcoded string is no longer shown for named hand zones.

## Zone Renderer Drop-Target Support

Both `HandRenderer` and `SpaceRenderer` now implement:
- `isDropTarget` computed via `boardInteraction.isDropTarget()`
- `handleDragOver` — prevents default when drop target
- `handleDrop` — calls `boardInteraction.triggerDrop()`
- `@dragover` and `@drop` bound in template
- `.is-drop-target` CSS class with appropriate styling

`HexBoardRenderer` also gains `isCellDropTarget` + `handleHexDrop` for completeness.

## Deviations from Plan

**1. [Rule 2 - Missing Critical Functionality] Added `is-disabled` state to all 8 renderers**
- **Found during:** Task 1 (UI-SPEC review)
- **Issue:** The UI-SPEC "Interaction Affordance Contract" defines 6 required states including `is-disabled`. None of the renderers implemented it. T-94-03-01 (STRIDE: click dispatches for non-valid elements) is mitigated by the disabled guard.
- **Fix:** Added `isDisabled` computed using `boardInteraction.isDisabledElement()` and `is-disabled` CSS class and disabled click guard in all 8 renderers.
- **Files modified:** All 8 renderer files

**2. [Rule 2 - Missing Critical Functionality] Added `handleClick` and `@click` to SpaceRenderer**
- **Found during:** Task 2
- **Issue:** SpaceRenderer was missing click dispatch entirely — it had `isActionSelectable` but no handler.
- **Fix:** Added `handleClick` function and `@click="handleClick"` binding.
- **Files modified:** SpaceRenderer.vue

**3. [Rule 1 - Bug] CardRenderer notation from wrong field**
- **Found during:** Task 2 (Pitfall 6 consistency review)
- **Issue:** `elementNotation` in CardRenderer was set to `element.name || null`, passing the element's display name as `notation` in all boardInteraction calls. Per Pitfall 6, notation should come from `element.attributes?.notation`.
- **Fix:** Changed to `(element.attributes?.notation as string) ?? element.name ?? null` — attributes notation takes precedence; element name is the fallback for backward compatibility.
- **Files modified:** CardRenderer.vue

## Known Stubs

None. All interaction wiring connects to the live `useBoardInteraction` substrate — no mock data or placeholders.

## Threat Flags

None. All changes operate on the existing renderer layer; no new network endpoints, auth paths, or trust boundary crossings were introduced. T-94-03-01 (tampering via click) is mitigated by the existing `isSelectableElement` guard in the substrate plus the new disabled click guard in all renderers.

## Self-Check: PASSED

- All 8 renderer files confirmed modified: `grep -l "tryUseBoardInteraction" ...` returns 8
- Commits 2348c74 and fa00779 exist in git log
- `useBoardInteraction.test.ts` passes (6/6 tests)
- `tsc --noEmit` reports 0 errors for all 8 renderer files
- CF-1 (PieceRenderer action-selectable): VERIFIED — `action-selectable: isActionSelectable` in class binding
- CF-2 (HandRenderer element.name): VERIFIED — `element.name ?? (isOwned ? 'Your Hand' : ...)` in template
