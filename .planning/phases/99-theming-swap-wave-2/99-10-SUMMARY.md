---
phase: 99-theming-swap-wave-2
plan: 10
subsystem: ui/theming
tags: [theming, slate, tokenization, css-vars]
dependency_graph:
  requires: [99-01]
  provides: [THEME-07-partial]
  affects: [src/ui/components/Toast.vue, src/ui/components/auto-ui/DoneButton.vue, src/ui/components/auto-ui/AutoRenderer.vue, src/ui/components/auto-ui/AutoUI.vue, src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue]
tech_stack:
  added: []
  patterns: [css-custom-properties, color-mix()]
key_files:
  created: []
  modified:
    - src/ui/components/Toast.vue
    - src/ui/components/auto-ui/DoneButton.vue
    - src/ui/components/auto-ui/AutoRenderer.vue
    - src/ui/components/auto-ui/AutoUI.vue
    - src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue
decisions:
  - "Used --bsg-accent-ink for all colored toast backgrounds (success/error/info/warning) — it is the only semantic 'ink on colored surface' token available, and the light-mode semantic colors (danger/ok/warn) are all dark enough to provide adequate contrast with white."
  - "AutoUI game-complete h2 gradient text removed in favor of solid --bsg-accent; the clip-text gradient approach required neon hex literals and was incompatible with the token-only policy."
  - "UnsupportedTopologyPanel rgba amber tints replaced with color-mix(in srgb, var(--bsg-warn) N%, transparent) to preserve the warning visual identity while eliminating hardcoded values."
metrics:
  duration: 5m
  completed: "2026-06-23T06:39:44Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 99 Plan 10: Slate Sweep — Toast, DoneButton, AutoRenderer, AutoUI, UnsupportedTopologyPanel Summary

**One-liner:** Swept all hex and neon color literals from five small auto-UI components, replacing each surface+ink pair with --bsg-* tokens.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sweep Toast.vue + DoneButton.vue | c6f5de5 | Toast.vue, DoneButton.vue |
| 2 | Sweep AutoRenderer + AutoUI + UnsupportedTopologyPanel | eb6ecbc | AutoRenderer.vue, AutoUI.vue, UnsupportedTopologyPanel.vue |

## Changes Made

### Toast.vue
- `.toast` shadow: `rgba(0,0,0,.3)` → `var(--bsg-shadow-sm)`
- `.toast.success`: `rgba(46,204,113,.95)` bg + `#fff` ink → `var(--bsg-ok)` + `var(--bsg-accent-ink)`
- `.toast.error`: `rgba(231,76,60,.95)` bg + `#fff` ink → `var(--bsg-danger)` + `var(--bsg-accent-ink)`
- `.toast.info`: `rgba(0,217,255,.95)` bg + `#1a1a2e` ink → `var(--bsg-accent)` + `var(--bsg-accent-ink)`
- `.toast.warning`: `rgba(243,156,18,.95)` bg + `#1a1a2e` ink → `var(--bsg-warn)` + `var(--bsg-accent-ink)`

### DoneButton.vue
- Background: neon `linear-gradient(90deg, #00d9ff, #00ff88)` → `var(--bsg-accent)`
- Color: `#1a1a2e` → `var(--bsg-accent-ink)`
- Hover shadow: neon glow `rgba(0,217,255,.4)` → `var(--bsg-shadow-sm)` (no glow)
- Disabled bg: `rgba(128,128,128,.3)` → `var(--bsg-surface-3)`

### AutoRenderer.vue
- Empty-state text: `#888888` → `var(--bsg-ink-3)`

### AutoUI.vue
- Game-complete bg: `rgba(0,255,136,.1)` neon tint → `color-mix(in srgb, var(--bsg-accent) 10%, transparent)`
- Game-complete h2: neon gradient text (with `-webkit-background-clip`) → `color: var(--bsg-accent)` solid

### UnsupportedTopologyPanel.vue
- Panel border: `rgba(245,158,11,.4)` → `color-mix(in srgb, var(--bsg-warn) 40%, transparent)`
- Panel bg: `rgba(245,158,11,.1)` → `color-mix(in srgb, var(--bsg-warn) 10%, transparent)`
- Heading: `#f59e0b` → `var(--bsg-warn)`
- Body: `#fff` → `var(--bsg-ink)`

## Verification

- `npx stylelint` with `color-no-hex` rule: PASSED on all 5 files
- Neon grep (`#00d9ff|#00ff88|rgba(46,204,113...)`): PASSED — none found
- `npx vitest run src/ui/components`: 85/85 tests pass

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — pure CSS tokenization, no new network endpoints or trust boundaries.

## Self-Check: PASSED

- Toast.vue: exists, no hex literals
- DoneButton.vue: exists, no hex literals
- AutoRenderer.vue: exists, no hex literals
- AutoUI.vue: exists, no hex literals
- UnsupportedTopologyPanel.vue: exists, no hex literals
- Commit c6f5de5: confirmed in git log
- Commit eb6ecbc: confirmed in git log
