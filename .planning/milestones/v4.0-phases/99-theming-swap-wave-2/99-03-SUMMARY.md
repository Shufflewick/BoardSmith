---
phase: 99-theming-swap-wave-2
plan: "03"
subsystem: ui/renderers
tags: [theming, tokens, css-custom-properties, slate, interaction-states]
dependency_graph:
  requires: [bsg-card-back-token, bsg-display-token]
  provides: [deck-renderer-tokenized, die-renderer-tokenized, piece-renderer-tokenized]
  affects: [DeckRenderer.vue, DieRenderer.vue, PieceRenderer.vue]
tech_stack:
  added: []
  patterns: [css-custom-property token consumption, outline-never-border selection]
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/renderers/DeckRenderer.vue
    - src/ui/components/auto-ui/renderers/DieRenderer.vue
    - src/ui/components/auto-ui/renderers/PieceRenderer.vue
decisions:
  - "Dashed outline for selectable/action-selectable/board-highlighted; solid outline for selected/board-selected — non-color shape cue doubles as A11Y-05 bonus"
  - "Deleted all three pulse-* keyframe animations (neon color cycling); selectable state is persistent not animated to reduce motion"
  - "PieceRenderer.is-board-selected uses var(--bsg-ring) as box-shadow alongside solid outline for extra emphasis on small circular piece"
  - "piece-token-label color changed from #ffffff to var(--bsg-ink) so it adapts to light mode; mid-tone seat colors remain readable in both schemes"
  - "DeckRenderer is-dragging hardcoded opacity/scale replaced with var(--bsg-dragging-opacity) + var(--bsg-dragging-scale) tokens"
metrics:
  duration: "12 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 3
---

# Phase 99 Plan 03: Slate Sweep — DeckRenderer + DieRenderer + PieceRenderer Summary

**One-liner:** Replaced all neon hex/rgba literals across DeckRenderer, DieRenderer, and PieceRenderer with Slate `--bsg-*` interaction tokens; selection uses outline exclusively; colored glow box-shadows deleted.

## What Was Built

Three auto-UI renderers fully converted from neon-noir to Slate interaction language:

**DeckRenderer.vue**
- Container: `background: var(--bsg-surface)`, `border: 1px solid var(--bsg-line)`, motion tokens
- is-selectable: `outline: 2px dashed var(--bsg-accent)` + `background: var(--bsg-selectable)`
- is-selected: `outline: 2px solid var(--bsg-accent)` + `background: var(--bsg-selected)` + `scale(1.02)`
- action-selectable: dashed accent outline → solid on hover; elevation via `var(--bsg-shadow-sm)`
- is-board-highlighted / is-board-selected: same dashed/solid language
- Deleted colored glow `box-shadow: 0 4px 12px rgba(0,217,255,0.3)` and `@keyframes pulse-deck`
- deck-label: `color: var(--bsg-ink)`, `font-family: var(--bsg-display)`; deck-count: `var(--bsg-ink-2)`; empty-text: `var(--bsg-ink-3)`

**DieRenderer.vue**
- `border-radius: var(--bsg-r-sm)`, `transition: all var(--bsg-dur-base) var(--bsg-ease)`
- action-selectable: `background: var(--bsg-selectable)`, `outline: 2px dashed var(--bsg-accent)`
- is-board-highlighted: dashed accent; is-board-selected: solid accent + `box-shadow: var(--bsg-ring)`
- Deleted `@keyframes pulse-die` and all neon rgba literals
- die-label: `color: var(--bsg-ink-2)`

**PieceRenderer.vue**
- Base piece: `color: var(--bsg-ink)`, `box-shadow: var(--bsg-shadow-sm)`, motion tokens
- action-selectable: `outline: 2px dashed var(--bsg-accent)` + `background: var(--bsg-selectable)`
- is-board-highlighted: dashed accent + selectable fill
- is-board-selected: solid accent + `background: var(--bsg-selected)` + `box-shadow: var(--bsg-ring)` + `scale(1.02)`
- is-dragging: `opacity: var(--bsg-dragging-opacity)`, `transform: scale(var(--bsg-dragging-scale))`
- piece-token-label: `color: var(--bsg-ink)` (adapts light/dark)
- Deleted `@keyframes pulse-piece` and all neon rgba literals

## Tasks

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | Sweep DeckRenderer.vue + DieRenderer.vue | d093b6e | done |
| 2 | Sweep PieceRenderer.vue | 7ea9ab5 | done |
| cleanup | Update stale hex refs in template comments | b75019a | done |

## Verification

- All three files pass `stylelint --config color-no-hex` (postcss-html)
- No `#00d9ff`, `#00ff88`, or `rgba(46,204,113` literals remain
- No hex literals remain anywhere in the three files (template comments cleaned too)
- `npx vitest run src/ui/components/auto-ui` — 65/65 tests pass (9 test files)

## Deviations from Plan

**1. [Rule 2 - Missing Critical] Cleaned stale hex color references in template HTML comments**
- Found during: Task 2 verification
- Issue: Template comments still contained `#aaa` and `#888` as documentation of old values
- Fix: Updated comments to use semantic descriptions instead of raw hex values
- Files modified: DeckRenderer.vue, PieceRenderer.vue
- Commit: b75019a

**2. [Rule 2 - Enhancement] Applied var(--bsg-dragging-opacity/scale) tokens in PieceRenderer**
- Found during: Task 2
- Issue: `is-dragging` still used hardcoded `opacity: 0.5` and `scale(0.95)` despite drag tokens existing in theme.ts
- Fix: Replaced with `var(--bsg-dragging-opacity)` and `var(--bsg-dragging-scale)` for token consistency
- Files modified: PieceRenderer.vue

## Known Stubs

None.

## Threat Flags

None — pure CSS token substitution in component `<style scoped>` blocks; no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- `src/ui/components/auto-ui/renderers/DeckRenderer.vue` — all hex/rgba neon literals removed; d093b6e, b75019a exist
- `src/ui/components/auto-ui/renderers/DieRenderer.vue` — all hex/rgba neon literals removed; d093b6e exists
- `src/ui/components/auto-ui/renderers/PieceRenderer.vue` — all hex/rgba neon literals removed; 7ea9ab5, b75019a exist
- stylelint color-no-hex: PASS on all three files
- vitest: 65/65 tests pass
