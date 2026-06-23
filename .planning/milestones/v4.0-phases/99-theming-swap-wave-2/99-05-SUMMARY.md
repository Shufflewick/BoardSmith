---
phase: 99-theming-swap-wave-2
plan: "05"
subsystem: ui
tags: [theming, slate, gameshell, hamburgermenu, platform-mode, tokenization]
dependency_graph:
  requires: ["99-01"]
  provides: [platform-aware-backdrops, tokenized-chrome-surfaces, solid-display-title]
  affects: [GameShell.vue, HamburgerMenu.vue]
tech_stack:
  added: []
  patterns: [css-custom-properties, vue-deep-combinator, platform-mode-class, css-cascade-transparency]
key_files:
  created: []
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/HamburgerMenu.vue
    - .stylelintrc.cjs
decisions:
  - "Platform transparency for drawer achieved via :deep(.menu-drawer) in GameShell scoped CSS — avoids prop drilling through GameHeader and reuses the already-present .game-shell--platform class"
  - "HamburgerMenu platform backdrop uses CSS cascade: GameShell sets background:transparent on .menu-drawer in platform mode; HamburgerMenu sets var(--bsg-bg) as the dev/standalone fallback"
  - "error-banner gained explicit color:var(--bsg-ink) (atomic bg+ink rule)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-23"
  tasks: 2
  files_modified: 3
---

# Phase 99 Plan 05: Slate Sweep — GameShell + HamburgerMenu Summary

Platform-aware backdrops on both shell-chrome files (transparent in platform mode, `var(--bsg-bg)` in dev), sidebar/action-bar/drawer surfaces tokenized with `--bsg-surface` + `--bsg-line` hairlines, and HamburgerMenu gradient clip-text title replaced by solid `var(--bsg-display)` + `var(--bsg-ink)`.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Platform-aware backdrop + tokenized surfaces in GameShell.vue | 4333db4 | GameShell.vue, .stylelintrc.cjs |
| 2 | Delete clip-text + platform-aware drawer backdrop in HamburgerMenu.vue | 54c778d | HamburgerMenu.vue, .stylelintrc.cjs |

## What Was Built

### Task 1 — GameShell.vue

- `.game-shell` backdrop: `linear-gradient(135deg, #1a1a2e …)` → `var(--bsg-bg)`
- `.game-shell--platform` override: `background: transparent` (host shows through)
- `color: #fff` → `color: var(--bsg-ink)`
- `font-family: system-ui` → `var(--bsg-font)`
- Sidebar (`rgba(0,0,0,0.3)` glass + `rgba(255,255,255,.1)` hairlines) → `var(--bsg-surface)` + `var(--bsg-line)`
- Action-bar (`rgba(0,0,0,0.85)` glass) → `var(--bsg-surface)` + `var(--bsg-line)`
- Time-travel banner: `#f59e0b` → `var(--bsg-warn)`
- Error banner: `#e74c3c` → `var(--bsg-danger)` + `var(--bsg-ink)` text (atomic rule)
- Empty game area: `#666` → `var(--bsg-ink-2)`; `rgba(255,255,255,.02)` → `var(--bsg-field)`
- Sidebar-history hairline: `rgba` → `var(--bsg-line)`
- Added `.game-shell--platform :deep(.menu-drawer) { background: transparent }` — drawer transparency partner rule for Task 2

### Task 2 — HamburgerMenu.vue

- Deleted gradient clip-text block entirely: `background: linear-gradient(90deg, #00d9ff, #00ff88)`, `-webkit-background-clip: text`, `-webkit-text-fill-color: transparent` all removed
- `.logo-text` replaced with: `font-family: var(--bsg-display); color: var(--bsg-ink); text-shadow: 0 1px 3px rgba(0,0,0,.4)`
- Drawer backdrop: `linear-gradient(180deg, #1a1a2e, #16213e)` → `var(--bsg-bg)` (transparent in platform mode via GameShell's `:deep` rule)
- Drawer `box-shadow`: `rgba` literal → `var(--bsg-shadow)`
- `.bar` fill: `#fff` → `var(--bsg-ink)`
- `.close-btn`: `rgba` glass → `var(--bsg-field)`; `#888` → `var(--bsg-ink-2)`; hover → `var(--bsg-line-2)` / `var(--bsg-ink)`
- `.drawer-game-info`: `rgba` glass → `var(--bsg-surface-2)`; hairline → `var(--bsg-line)`
- `.info-label/value`: hex → `var(--bsg-ink-2)` / `var(--bsg-ink)`; mono font → `var(--bsg-mono)`
- `.connection-dot` states: hex → `var(--bsg-away/ok/warn/danger)`
- `.menu-item`: neon hover replaced with `var(--bsg-selectable)` + `var(--bsg-accent)`
- `.menu-item.danger` hover: `rgba` → `color-mix(in srgb, var(--bsg-danger) 12%, transparent)`
- `.item-icon`: `rgba` glass → `var(--bsg-field)`
- `.menu-divider`: `rgba` → `var(--bsg-line)`

## Deviations from Plan

None — plan executed exactly as written.

The platform-mode drawer transparency approach (CSS cascade via `.game-shell--platform :deep(.menu-drawer)` in GameShell, `background: var(--bsg-bg)` in HamburgerMenu) was selected per the plan's "gate transparency via a platform-mode class toggled from the parent" guidance, with an existing `:deep()` pattern already established in GameShell for `.game-header`, `.header-center`, `.header-right`.

## Verification

- `npx stylelint src/ui/components/GameShell.vue`: PASSED (0 violations)
- `npx stylelint src/ui/components/HamburgerMenu.vue`: PASSED (0 violations)
- No `background-clip` / `-webkit-text-fill-color: transparent` in HamburgerMenu.vue: CONFIRMED
- `platformMode` / `platform-mode` referenced in GameShell.vue: CONFIRMED
- `npx vitest run src/ui/components/HamburgerMenu.test.ts src/ui/components/GameShell.theme.test.ts`: 15/15 PASSED
- Both files removed from `.stylelintrc.cjs` ignoreFiles

## Known Stubs

None.

## Threat Flags

None — changes are CSS-only; no new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- `src/ui/components/GameShell.vue` — exists and passes stylelint
- `src/ui/components/HamburgerMenu.vue` — exists, no clip-text, passes stylelint
- Commit 4333db4 — verified in git log
- Commit 54c778d — verified in git log
