---
phase: 99-theming-swap-wave-2
plan: "06"
subsystem: ui
tags: [theming, slate, tokenization, animation, accessibility]
dependency_graph:
  requires: ["99-01"]
  provides: [THEME-04, THEME-06]
  affects: [GameHeader.vue, PlayersPanel.vue]
tech_stack:
  added: []
  patterns: [css-custom-properties, color-mix, prefers-reduced-motion]
key_files:
  created: []
  modified:
    - src/ui/components/GameHeader.vue
    - src/ui/components/PlayersPanel.vue
decisions:
  - "Title uses var(--bsg-ink) with var(--bsg-display) font; accent reserved for interactive brand marks (game-code strong, zoom reset)"
  - "Breathe animation is opacity-only (0.5→1.0), 2s period — calm, no layout shift"
  - "Active card background uses color-mix(accent 12%, surface) rather than a raw rgba hack"
  - "Connection badge text gets var(--bsg-ink) paired with semantic bg tokens (ok/warn/danger)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-23T06:37:46Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 99 Plan 06: Slate Sweep — GameHeader + PlayersPanel Summary

Solid display title in GameHeader; calm opacity-only breathe active-player cue in PlayersPanel replacing the scaling neon halo.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Delete clip-text + tokenize GameHeader.vue | a7c6170 | src/ui/components/GameHeader.vue |
| 2 | Calm active-player cue in PlayersPanel.vue | e781f36 | src/ui/components/PlayersPanel.vue |

## What Was Built

**GameHeader.vue** — Removed the `linear-gradient` / `-webkit-background-clip: text` / `-webkit-text-fill-color: transparent` block from `h1`. Title is now solid `var(--bsg-ink)` in `var(--bsg-display)` font with a subtle `text-shadow`. All 14+ hex color literals replaced with `--bsg-*` tokens: surfaces → `var(--bsg-surface)` + `var(--bsg-line)`, accent elements → `var(--bsg-accent)`, info text → `var(--bsg-ink-2)`, connection badges → `var(--bsg-ok)` / `var(--bsg-warn)` / `var(--bsg-danger)` each paired with `var(--bsg-ink)` text. Interactive controls (zoom slider thumb, toggle switch) tokenized to `var(--bsg-accent)`.

**PlayersPanel.vue** — Deleted `@keyframes pulse-glow` and its `transform: scale(1)→scale(1.15)` scaling halo. Active-player dot is now a solid `var(--bsg-accent)` disc with a faint accent border. New `@keyframes breathe` animates opacity only (1.0→0.5→1.0, 2 s). Active card uses `color-mix(in srgb, var(--bsg-accent) 12%, var(--bsg-surface))` background with a solid `var(--bsg-accent)` border. `prefers-reduced-motion: reduce` guard disables the breathe animation. All 3 neon hex literals removed.

## Verification

- `npx stylelint` (postcss-html) passes on both files
- No `background-clip`, `text-fill-color: transparent`, `pulse-glow`, `transform: scale` remains
- `prefers-reduced-motion: reduce` guard present in PlayersPanel.vue
- `npx vitest run src/ui/components` — 85/85 tests pass

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — purely presentational CSS changes, no network surface, no new data paths.

## Self-Check: PASSED

- [x] src/ui/components/GameHeader.vue — modified, commit a7c6170
- [x] src/ui/components/PlayersPanel.vue — modified, commit e781f36
- [x] All hex literals removed from both files
- [x] clip-text removed from GameHeader
- [x] pulse-glow removed from PlayersPanel
- [x] prefers-reduced-motion guard present in PlayersPanel
- [x] 85/85 vitest tests pass
