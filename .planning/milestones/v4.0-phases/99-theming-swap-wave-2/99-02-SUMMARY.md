---
phase: 99-theming-swap-wave-2
plan: 02
subsystem: ui
tags: [theming, slate, tokens, card-renderer, hand-renderer, interaction-states]
dependency_graph:
  requires: [99-01]
  provides: [tokenized-card-surfaces, tokenized-hand-surfaces, shared-card-back]
  affects: [CardRenderer.vue, HandRenderer.vue]
tech_stack:
  added: []
  patterns: [CSS custom properties, color-mix(), outline-not-border]
key_files:
  created: []
  modified:
    - src/ui/components/auto-ui/renderers/CardRenderer.vue
    - src/ui/components/auto-ui/renderers/HandRenderer.vue
decisions:
  - "Use outline (not border) for all selection/interaction rings to prevent layout reflow"
  - "card-back and card-back-small share --bsg-card-back token for single source of truth"
  - "action-selectable uses dashed outline to distinguish from solid selected ring"
  - "is-drop-target uses dotted accent-2 outline (no border) consistent with THEME-02"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_modified: 2
---

# Phase 99 Plan 02: Slate Token Sweep — CardRenderer + HandRenderer Summary

Atomically swept both card renderers from neon literals to Slate `--bsg-*` tokens: tokenized all interaction states, replaced the corporate-blue card back gradient with the shared `--bsg-card-back` token, removed colored glow shadows, and fixed HandRenderer's `border` outlier on `.action-selectable` to `outline`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sweep CardRenderer.vue to Slate (atomic bg + ink) | 9dfcdf5 | src/ui/components/auto-ui/renderers/CardRenderer.vue |
| 2 | Sweep HandRenderer.vue to Slate + fix border→outline outlier | edfa8c9 | src/ui/components/auto-ui/renderers/HandRenderer.vue |

## What Was Built

**CardRenderer.vue** — full `<style scoped>` sweep:
- `.is-selectable:hover`: `rgba(0,217,255,0.3)` box-shadow → `var(--bsg-shadow-sm)`
- `.is-selected`: `#00d9ff` solid outline → `var(--bsg-accent)` + `var(--bsg-ring)` box-shadow
- `.action-selectable`: `rgba(46,204,113,0.6)` outline → `2px dashed var(--bsg-accent)` + `var(--bsg-selectable)` fill
- `@keyframes pulse-card`: neon rgba → `var(--bsg-accent)` / `var(--bsg-accent-2)` 
- `.is-board-highlighted`: `rgba(0,217,255,0.2)` → `var(--bsg-selectable)`
- `.is-board-selected`: `rgba(0,255,136,0.2)` → `color-mix(in srgb, var(--bsg-selected) 20%, transparent)`
- `.is-drop-target`: added `outline: 1px dotted var(--bsg-accent-2)` (no border)
- `.card-face`: `#fff` bg / `#000` color / `#333` border → `var(--bsg-surface)` / `var(--bsg-ink)` / `var(--bsg-line)` + `var(--bsg-shadow-sm)`
- `.card-image` / `.card-sprite`: `rgba(0,0,0,0.3)` shadow → `var(--bsg-shadow-sm)`
- `.card-back`: corporate-blue gradient → `var(--bsg-card-back)` + `var(--bsg-line-2)` border + `var(--bsg-shadow-sm)`
- `.card-stats`: `#ccc` / `#888` / `#fff` → `var(--bsg-ink-2)` / `var(--bsg-ink-3)` / `var(--bsg-ink)`
- Misc: px literals → `--bsg-r-sm`, `--bsg-s*`, `--bsg-text-*` tokens; transition → `var(--bsg-dur-base) var(--bsg-ease)`

**HandRenderer.vue** — full `<style scoped>` sweep + outlier fix:
- `.hand-container` base: `rgba(255,255,255,0.05)` → `var(--bsg-surface)` (has own ink context)
- `.is-selectable:hover`: neon glow shadow → `var(--bsg-shadow-sm)`
- `.is-selected`: `#00d9ff` → `var(--bsg-accent)` + `var(--bsg-ring)`
- **THEME-02 outlier fix**: `.action-selectable` `border: 2px solid rgba(0,255,136,.6)` → `outline: 2px dashed var(--bsg-accent); outline-offset: 4px` + `background: var(--bsg-selectable)` (no layout reflow)
- `.action-selectable:hover`: `border-color` / neon shadow → `outline-color: var(--bsg-accent-2)` + `var(--bsg-shadow-sm)`
- `@keyframes pulse-hand`: neon `border-color` rgba → `outline-color: var(--bsg-accent)` / `var(--bsg-accent-2)`
- `.is-board-highlighted/selected`: neon rgba → selectable / color-mix tokens
- `.is-drop-target`: `border: 2px solid rgba(0,255,136,.5)` → `outline: 1px dotted var(--bsg-accent-2)` (no reflow)
- `.hand-label` / `.hand-count`: `#fff` / `#888` → `var(--bsg-ink)` / `var(--bsg-ink-3)`
- `.card-back-small`: corporate-blue gradient → `var(--bsg-card-back)` + `var(--bsg-line-2)` + `var(--bsg-shadow-sm)` (parity with CardRenderer)
- `.card-image` / `.card-sprite`: shadow → `var(--bsg-shadow-sm)`, radius → `var(--bsg-r-sm)`
- `.empty-hand`: `#666` → `var(--bsg-ink-3)`

## Verification

- `stylelint --rules color-no-hex`: PASS on both files
- `grep -nE '#00d9ff|#00ff88|rgba(46,204,113'`: 0 matches in both files
- Both files contain `--bsg-card-back`
- `hand-container.action-selectable` uses `outline` (not `border`)
- `npx vitest run src/ui/components/auto-ui`: 65/65 tests pass, 9 test files

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — pure CSS token replacement, no new network surface, auth paths, or schema changes.

## Self-Check: PASSED

- `9dfcdf5` exists in git log: confirmed
- `edfa8c9` exists in git log: confirmed
- CardRenderer.vue modified: confirmed
- HandRenderer.vue modified: confirmed
- No hex literals in either file's `<style>`: confirmed
- Both contain `var(--bsg-card-back)`: confirmed
