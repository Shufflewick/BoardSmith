---
phase: 93-renderer-rebuild
plan: 02
subsystem: ui/auto-ui
tags: [renderer, card, hand, deck, board-interaction, drag-drop, two-row-hand]
dependency_graph:
  requires:
    - renderer-registry.ts (registerRenderer, resolveRenderer — plan 93-01)
    - renderers/ElementRenderer.vue (dispatch wrapper — plan 93-01)
    - useBoardInteraction.ts (tryUseBoardInteraction — substrate, read-only)
    - dragImage.ts (setTransformAwareDragImage — substrate, read-only)
  provides:
    - renderers/CardRenderer.vue (card visual + board-interaction state + face/back image resolution)
    - renderers/HandRenderer.vue (hand container with two-row/fan/overlap layout, children via ElementRenderer)
    - renderers/DeckRenderer.vue (deck stack visual + empty state + count)
  affects:
    - Plan 93-06 (registers these components as built-ins in the renderer registry)
tech_stack:
  added: []
  patterns:
    - tryUseBoardInteraction defensive guard on every board-state computed (if (!boardInteraction) return false)
    - Face/back resolution guarded by element.__hidden — face URL never exposed when hidden (T-93-04)
    - Two-row hand sorting copied verbatim from source (Phase 92 carry-forward, Pitfall 6)
    - Sprite-sheet scaling based on NATIVE_CARD_WIDTH/HEIGHT constants (consistent face and back scaling)
    - Children always dispatch via ElementRenderer — no legacy component recursion
    - CSS vars from drag-drop.css consumed (--bs-drop-target-bg, --bs-dragging-opacity) — never redefined
    - data-animatable=true on card container for FLIP/flying animation hooks
key_files:
  created:
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
    - src/ui/components/auto-ui/renderers/DeckRenderer.vue
  modified: []
decisions:
  - "CardRenderer uses tryUseBoardInteraction (never useBoardInteraction directly) — degrades gracefully outside GameShell"
  - "Two-row hand sorting logic copied verbatim from source lines 409-453 — Phase 92 named carry-forward, not re-implemented"
  - "CardRenderer injects selectableElements/selectedElements for is-selectable/is-selected state; isActionSelectable uses boardInteraction.isSelectableElement (two separate state paths)"
  - "DeckRenderer stack shows up to 3 children (plan spec); source showed up to 5 but plan spec caps at 3"
  - "v-html forbidden throughout; all author-provided strings via Vue text interpolation {{ }} only (T-93-03)"
metrics:
  duration_minutes: 25
  completed_date: "2026-06-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
requirements_satisfied: [RENDER-01]
---

# Phase 93 Plan 02: Card / Hand / Deck Renderers Summary

**One-liner:** Three focused per-element renderer components (CardRenderer, HandRenderer, DeckRenderer) extracted from the monolithic source, preserving all four visual baselines, board-interaction states, two-row hand layout, and drag-drop wiring.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | CardRenderer.vue (card visual + board state + face/back resolution) | c0c7c51 | renderers/CardRenderer.vue |
| 2 | HandRenderer.vue (two-row/fan/overlap, children via ElementRenderer) | 9d8ab46 | renderers/HandRenderer.vue |
| 3 | DeckRenderer.vue (stack visual + empty state + count) | 9e764e9 | renderers/DeckRenderer.vue |

## What Was Built

### CardRenderer.vue (RENDER-01 card-family slice)

499-line component rendering card elements (`$type='card'`). Implements four visual baselines from UI-SPEC §CardRenderer:

1. **URL image** — `<img :src>` for face/back string paths
2. **Sprite sheet** — `getSpriteStyle()` with NATIVE_CARD_WIDTH/HEIGHT-based scaling for consistent face+back positioning
3. **No-image visible card** — white face (`#fff` background, 60×84px, bold name label, `border: 2px solid #333`)
4. **No-image hidden card** — default back gradient (`linear-gradient(135deg, #1a365d 0%, #2c5282 100%)`) with `border: 2px solid #4a6fa5`

**Face/back resolution (T-93-04):** `currentCardImage` selects `$images.back` (not face) when `element.__hidden` is true. The face URL is never reachable when the card is hidden.

**Board state computeds:** `isBoardHighlighted`, `isBoardSelected`, `isActionSelectable`, `isDragged`, `isDropTarget` — all with `if (!boardInteraction) return false` defensive guard.

**Drag wiring:** `handleDragStart` calls `setTransformAwareDragImage` + `boardInteraction.startDrag`; `handleDragEnd` calls `boardInteraction.endDrag`. Identical call sites to source.

**CSS classes:** `is-selectable`, `is-selected`, `action-selectable` (green pulse), `is-board-highlighted`, `is-board-selected`, `is-hidden`, `is-dragging`, `is-drop-target`. CSS vars consumed from `drag-drop.css` — never redefined.

**FLIP hook:** `:data-element-id="element.id"` + `:data-animatable="true"` present.

### HandRenderer.vue

524-line component rendering hand elements (`$type='hand'`).

**Two-row sorting logic** copied verbatim from source lines 409–453: `sortedHandCards` (natural sort by rank then suit), `handNeedsTwoRows` (threshold MAX_CARDS_PER_ROW=10), `backRowCards` (first half), `frontRowCards` (second half or all). This is a named Phase 92 carry-forward requirement (Pitfall 6) — the sort must match exactly.

**Children via ElementRenderer:** Both back row and front row cards dispatch through `ElementRenderer` (`:element="child" :depth="depth+1"`). Hidden hands with `childCount`-only visibility render placeholder `.card-back-small` divs with the back image from `defaultBackImage`.

**Fan layout:** `transform-origin: center bottom` rotation via CSS vars (`--card-index`, `--card-count`, `--layout-fan-angle`). Hover un-rotates with `transform: rotate(0deg) translateY(-15px) scale(1.05)`.

**Overlap layout:** `margin-right: -10px` on each `.hand-card` except last.

**Two-row layout:** Back row gets `margin-bottom: -50px; z-index: 1` to peek above front row.

**Whole-hand action-selectable:** Green border/background + `pulse-hand` animation on `.hand-container.action-selectable`.

**Header:** element name (left, bold white) + `(N)` count (right, 13px #888).

### DeckRenderer.vue

244-line component rendering deck elements (`$type='deck'`).

**Stack visual:** `stackCards = children.slice(0, 3).map((card, i) => ({ card, stackIndex: i }))`. Each card rendered via `ElementRenderer` inside a `60×84px` relative container with CSS `position: absolute; top: calc(var(--stack-index, 0) * -2px); left: calc(var(--stack-index, 0) * 1px)` for the depth-illusion offset.

**Header:** `20px bold #fff` name, `13px #aaa` count (hidden when 0).

**Empty state:** `<span class="empty-text">Empty</span>` (italic, color `#666`) inside a 20px-padded container — rendered when `childCount === 0`.

**Action-selectable:** Green pulse outline applied to the `.deck-container`.

## Deviations from Plan

### Note: Stack depth

The plan spec says "up to 3 offset cards". The source showed up to 5 children rendered. This plan follows the spec (3 cards) per the explicit plan instruction `stackCards = (element.children ?? []).slice(0,3)`.

### Injected void suppressions

The `void playerSeat` pattern in CardRenderer is used to suppress TypeScript unused-variable warnings. The playerSeat inject is part of the interface spec even though card-level rendering doesn't use it directly (the parent hand/container uses it). This is consistent with the pattern contract — all per-element renderers inject the same set.

Otherwise: plan executed exactly as written.

## Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` — one test fails with `expected 'endTurn' to be 'collectEquipment'`. This failure pre-exists on the worktree base commit, documented in 93-01 SUMMARY. Neither the test file nor any implementation file touched by this plan is in that composable. Out of scope per deviation boundary rule.

## Threat Model Coverage

| Threat | Status |
|--------|--------|
| T-93-03 (XSS) | Mitigated — all author strings via `{{ }}` interpolation only; v-html is 0 occurrences |
| T-93-04 (face image disclosure) | Mitigated — `currentCardImage` selects back when `element.__hidden`; face path unreachable |
| T-93-05 (URL injection) | Mitigated — images via `<img :src>` / `background-image` only; no style tag injection |
| T-93-06 (substrate tampering) | Accept — substrate files have 0 changes (`git diff --stat src/ui/composables/` is empty) |

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Known Stubs

None — no hardcoded empty values or placeholder text that flow to UI rendering. The "Empty" italic text is the intended empty-state copy per UI-SPEC §Copywriting Contract.

## Self-Check

### Created Files
- [x] `src/ui/components/auto-ui/renderers/CardRenderer.vue` — FOUND (499 lines)
- [x] `src/ui/components/auto-ui/renderers/HandRenderer.vue` — FOUND (524 lines)
- [x] `src/ui/components/auto-ui/renderers/DeckRenderer.vue` — FOUND (244 lines)

### Commits
- [x] c0c7c51: feat(93-02): CardRenderer — card visual + board-state + face/back resolution
- [x] 9d8ab46: feat(93-02): HandRenderer — two-row/fan/overlap layout with children via ElementRenderer
- [x] 9e764e9: feat(93-02): DeckRenderer — 3-card offset stack visual + empty state + count

### Acceptance Criteria
- [x] CardRenderer: ESLint 0 errors (Vue files not in config — 0 errors confirmed)
- [x] CardRenderer: tryUseBoardInteraction count >= 1 (count: 3)
- [x] CardRenderer: v-html count = 0 (confirmed)
- [x] CardRenderer: data-animatable count >= 1 (count: 1)
- [x] CardRenderer: __hidden guards face/back branch (line 172: `const isHidden = ...`)
- [x] HandRenderer: ElementRenderer count >= 1 (count: 4)
- [x] HandRenderer: AutoElement count = 0 (confirmed)
- [x] HandRenderer: two-row logic count >= 1 (backRow/frontRow/sortedHand matches: 10)
- [x] DeckRenderer: Empty count >= 1 (count: 6)
- [x] DeckRenderer: ElementRenderer count >= 1 (count: 3)
- [x] vitest run src/ui/ — 196/197 pass (1 pre-existing failure, out of scope)
- [x] git diff --stat src/ui/composables/ — empty (substrate untouched)

## Self-Check: PASSED
