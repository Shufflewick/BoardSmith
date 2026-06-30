---
phase: 92-piece-grid-rendering-fixes
plan: "02"
subsystem: ui/auto-ui
tags: [piece-rendering, grid-sizing, error-panel, css, vue-sfc]
dependency_graph:
  requires: [auto-ui-helpers.ts (Plan 01)]
  provides: [AutoElement.vue — gridResult computed, pieceVisual computed, grid-error-panel, piece-token CSS]
  affects: [AutoElement.vue, Phase 93 renderer]
tech_stack:
  added: []
  patterns: [discriminated-union-template-dispatch, watchEffect-for-side-effects, helper-delegation]
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/AutoElement.vue
decisions:
  - "pieceVisual and gridResult computeds guard on elementType so other element types never invoke the helpers"
  - "console.error fires from watchEffect with _lastGridError dedup ref — never from inside computed getter"
  - "getImageInfo remains in AutoElement.vue because it is still used for card back image processing (lines 388, 395); it is not superseded for that path"
  - "piece-sprite branch uses direct background-* inline style (not getSpriteStyle) to avoid card-native NATIVE_CARD_WIDTH/HEIGHT scaling"
metrics:
  duration_minutes: 12
  completed_date: "2026-06-21"
  tasks_completed: 2
  files_created: 0
  files_modified: 1
---

# Phase 92 Plan 02: Wire Helpers into AutoElement.vue Summary

**One-liner:** AutoElement.vue now dispatches piece rendering through resolvePieceVisual (image/sprite/token) and drives board layout through resolveGridSize with an in-board error panel replacing the 8×8 hardcoded fallbacks.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace boardSize with gridResult, add error panel + console.error | 950a3cf | src/ui/components/auto-ui/AutoElement.vue |
| 2 | Replace piece template with image/sprite/token dispatch and update piece CSS | da8da87 | src/ui/components/auto-ui/AutoElement.vue |

## What Was Built

**Task 1 — gridResult + grid error panel:**

- Removed the `boardSize` computed (53 lines) with its two hardcoded `return { rows: 8, columns: 8 }` fallbacks (lines 609, 619).
- Added `import { resolveGridSize } from './auto-ui-helpers.js'` to the import block.
- Added `gridResult` computed: `elementType.value === 'board' ? resolveGridSize(props.element) : null`.
- Added `_lastGridError` ref + `watchEffect` for one-shot `console.error('[BoardSmith] ...')` when the grid cannot resolve — following the existing `watchEffect` at line 706 as precedent; side-effect never lives inside a computed getter.
- Board template (formerly unconditional `div.board-container`) now has two branches:
  - `v-if="gridResult && !gridResult.ok"` → renders `.grid-error-panel` with heading `Grid "..." can't render` and hint `Declare $rowCoord and $colCoord on this Grid element`.
  - `v-else` → existing board markup with all three `boardSize` references replaced by `gridResult?.cols ?? 0` / `gridResult?.rows ?? 0`.
- Added `.grid-error-panel`, `.grid-error-panel__heading`, `.grid-error-panel__hint` CSS at the bottom of `<style scoped>` per UI-SPEC values.

**Task 2 — piece visual dispatch:**

- Added `resolvePieceVisual` to the import and added `pieceVisual` computed guarded on `elementType.value === 'piece'`.
- Replaced `{{ displayLabel }}` inside the `.piece` wrapper with a three-branch `v-if`/`v-else-if`/`v-else-if` dispatch:
  - `kind === 'image'` → `<img class="piece-image" :src="pieceVisual.src" alt="" aria-hidden="true" />`
  - `kind === 'sprite'` → `<div class="piece-sprite" :style="{ backgroundImage, backgroundPosition, backgroundSize, backgroundRepeat }">` (direct inline style, NOT getSpriteStyle which uses card-native dimensions)
  - else (`kind === 'token'`) → `<div class="piece-token" :style="{ background: pieceVisual.color }"><span class="piece-token-label">{{ pieceVisual.label }}</span></div>`
- Changed `.piece { background: #e74c3c }` to `background: transparent` so the red fill does not bleed through image/sprite/token children.
- Added `.piece-image`, `.piece-sprite`, `.piece-token`, `.piece-token-label` CSS per UI-SPEC.

## Verification Results

| Check | Result |
|-------|--------|
| `grep -c "rows: 8, columns: 8" AutoElement.vue` | 0 |
| `grep -c "boardSize" AutoElement.vue` | 0 |
| `grep -c "background: #e74c3c" AutoElement.vue` | 0 |
| `grep -ci "v-html" AutoElement.vue` | 0 |
| `grep -c "resolvePieceVisual" AutoElement.vue` | 2 |
| `grep -c "resolveGridSize" AutoElement.vue` | 3 |
| `grep -c "grid-error-panel" AutoElement.vue` | 6 |
| `grep -c "piece-token" AutoElement.vue` | 4 |
| `npm test` | 831/832 pass (1 pre-existing failure) |

## Deviations from Plan

### Auto-fixed Issues

None.

### Justified Findings

**1. getImageInfo not removed**

The plan's verification step notes `getImageInfo` should be removed "if the helper fully replaces it." `getImageInfo` at line 322 is still called at lines 388 and 395 for card back image processing — a path entirely separate from piece rendering that `resolvePieceVisual` does not cover. The function remains used and should not be removed. No dead export is introduced.

## Pre-existing Test Failure (Out of Scope)

`src/ui/composables/useActionController.test.ts:1643` was failing before this plan (documented in Phase 92 Plan 01 summary). Verified by reviewing Phase 01 summary — same 1 failure existed prior to any Phase 92 work.

## Known Stubs

None. Both computeds return production-ready data driven by the Plan 01 helpers. No placeholder values, no hardcoded fallbacks remaining.

## Threat Flags

None beyond the mitigations already in the plan's threat model:
- T-92-01 (XSS): Confirmed — piece-image `:src` and piece-token-label use Vue attribute binding and `{{ }}` interpolation. No `v-html` in file (count 0).
- T-92-03 (Information Disclosure): Confirmed — grid error panel text is the fixed literal (element name/id + prop name only). No file paths, line numbers, or stack traces.

## Self-Check: PASSED

- [x] `src/ui/components/auto-ui/AutoElement.vue` — EXISTS and modified
- [x] Commit 950a3cf — Task 1 (gridResult + error panel)
- [x] Commit da8da87 — Task 2 (piece dispatch + CSS)
- [x] 0 occurrences of `rows: 8, columns: 8` in AutoElement.vue
- [x] 0 occurrences of `boardSize` in AutoElement.vue
- [x] 0 occurrences of `background: #e74c3c` in AutoElement.vue
- [x] 0 occurrences of `v-html` in AutoElement.vue
- [x] `resolvePieceVisual`, `resolveGridSize`, `grid-error-panel`, `piece-token` all present
- [x] 831/832 tests pass (1 pre-existing failure out of scope)
