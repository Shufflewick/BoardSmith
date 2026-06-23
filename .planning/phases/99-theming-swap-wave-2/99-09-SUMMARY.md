---
phase: 99-theming-swap-wave-2
plan: "09"
subsystem: ui
tags: [theming, slate, tokens, helpers, button, overlays]
dependency_graph:
  requires: ["99-01"]
  provides: ["THEME-07 helpers sweep"]
  affects: [src/ui/components/helpers/Button.vue, src/ui/components/helpers/FlyingCardsOverlay.vue, src/ui/components/helpers/ZoomPreviewOverlay.vue]
tech_stack:
  added: []
  patterns: [var(--bsg-accent), var(--bsg-accent-ink), var(--bsg-card-back), var(--bsg-selectable), color-mix]
key_files:
  created: []
  modified:
    - src/ui/components/helpers/Button.vue
    - src/ui/components/helpers/FlyingCardsOverlay.vue
    - src/ui/components/helpers/ZoomPreviewOverlay.vue
    - .stylelintrc.cjs
decisions:
  - "danger button uses var(--bsg-bg) for ink — no danger-ink token exists; bg is darkest neutral and readable on coral danger in both themes"
  - "card-back pattern overlay changed from sandy rgba(212,165,116,.3) to var(--bsg-line) for theme-neutral subtlety on the new graphite card-back"
  - "icon:hover border uses color-mix(in srgb, var(--bsg-accent) 30%, transparent) matching the droptarget-shadow pattern"
metrics:
  duration: "10m"
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 4
---

# Phase 99 Plan 09: Slate Sweep — helpers/Button + FlyingCardsOverlay + ZoomPreviewOverlay Summary

**One-liner:** Swept all three helper components from neon-noir hex to Slate tokens (accent+accent-ink primary, card-back overlays, selectable hover) and removed them from .stylelintrc.cjs ignoreFiles.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sweep helpers/Button.vue (all variants) | 544c548 | Button.vue, .stylelintrc.cjs |
| 2 | Sweep FlyingCardsOverlay + ZoomPreviewOverlay | 510e77f | FlyingCardsOverlay.vue, ZoomPreviewOverlay.vue, .stylelintrc.cjs |

## What Was Built

**Button.vue** — all five variants tokenized atomically (bg+ink in same edit per atomic constraint):
- **primary**: `linear-gradient(#00d9ff,#00ff88)` → `var(--bsg-accent)` fill + `var(--bsg-accent-ink)` label; hover lift uses `var(--bsg-shadow-sm)` (no neon glow)
- **secondary**: `rgba(255,255,255,.1)` bg → `var(--bsg-field)`; border → `var(--bsg-line-2)`; `#fff` → `var(--bsg-ink)`; hover uses `var(--bsg-selectable)` fill + `var(--bsg-accent)` border
- **danger**: amber gradient → `var(--bsg-danger)` fill; `color-mix` border; `#1a1a2e` → `var(--bsg-bg)` (darkest neutral, readable on coral in both schemes); hover darkens with `color-mix` + `shadow-sm`
- **ghost**: `#888` → `var(--bsg-ink-3)` muted; `#fff` hover → `var(--bsg-ink)`
- **icon**: same field+line-2 base as secondary; hover `var(--bsg-selectable)` + `var(--bsg-accent-2)` label

**FlyingCardsOverlay.vue**:
- Card face: `#fff` → `var(--bsg-surface)` (adapts light/dark)
- Card back: brown `linear-gradient(135deg, #8b5a2b, #6b4423)` → `var(--bsg-card-back)` (shared graphite gradient from theme.ts)
- Card-back inlay pattern: sandy `rgba(212,165,116,.3)` → `var(--bsg-line)` (neutral line token, theme-aware)

**ZoomPreviewOverlay.vue**:
- Card preview surface: `#fff` → `var(--bsg-surface)` (zoom-preview-card + preview-fallback)
- Card-back preview: navy `linear-gradient(135deg,#1a365d,#2c5282)` → `var(--bsg-card-back)`; `#4a6fa5` border → `var(--bsg-line-2)`

**.stylelintrc.cjs**: Removed all three files from `ignoreFiles` — they now pass `color-no-hex` enforcement unconditionally.

## Verification

- `npx stylelint src/ui/components/helpers/Button.vue` — PASS
- `npx stylelint src/ui/components/helpers/FlyingCardsOverlay.vue src/ui/components/helpers/ZoomPreviewOverlay.vue` — PASS
- `npx vitest run src/ui/components` — 85/85 tests pass
- No neon grep matches (`#00d9ff`, `#00ff88`) in any of the three files

## Deviations from Plan

### Auto-enhanced (not plan-specified)

**1. [Rule 2 - Enhancement] Tokenized card-back pattern overlay in FlyingCardsOverlay.vue**
- **Found during:** Task 2
- **Issue:** The `::before` pseudo-element on `.card-back` used `rgba(212,165,116,.3)` (a sandy amber matching the old brown card-back). With the card-back now using `var(--bsg-card-back)` (dark graphite), the sandy overlay looked warm and incongruent.
- **Fix:** Changed repeating-linear-gradient stops to `var(--bsg-line)` — the subtlest neutral line token, adapts to both dark/light schemes.
- **Files modified:** FlyingCardsOverlay.vue
- **Commit:** 510e77f

## Known Stubs

None — all surfaces fully tokenized with real theme values.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- [x] src/ui/components/helpers/Button.vue — exists and contains var(--bsg-accent)
- [x] src/ui/components/helpers/FlyingCardsOverlay.vue — exists and contains var(--bsg-card-back)
- [x] src/ui/components/helpers/ZoomPreviewOverlay.vue — exists and contains var(--bsg-card-back)
- [x] Commit 544c548 exists
- [x] Commit 510e77f exists
