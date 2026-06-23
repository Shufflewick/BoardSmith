---
phase: 99-theming-swap-wave-2
plan: 12
subsystem: ui
tags: [theming, tokenization, css, debug-panel, slate]
dependency_graph:
  requires: [99-01]
  provides: [THEME-07-partial]
  affects: [src/ui/components/DebugPanel.vue]
tech_stack:
  added: []
  patterns:
    - color-mix(in srgb, var(--bsg-*) N%, transparent) for tinted backgrounds
    - var(--bsg-seat-N) for player history badges
    - var(--bsg-accent-2) for the cyan accent previously at #00d9ff
key_files:
  modified:
    - src/ui/components/DebugPanel.vue
decisions:
  - "Used var(--bsg-accent-2) for #00d9ff (bright teal replaces neon cyan)"
  - "Used var(--bsg-seat-1..5) for player history badges (semantically correct over generic blue/red/green/purple)"
  - "Used color-mix(in srgb, var(--bsg-*) N%, transparent) for tinted glass effects (no opacity-alpha token exists)"
  - "rgba(0,0,0,0.2) glass -> var(--bsg-surface-2); rgba(0,0,0,0.3) -> var(--bsg-surface-3) consistently"
  - "rgba(255,255,255,0.1) borders -> var(--bsg-line); 0.2 -> var(--bsg-line-2)"
  - "Transfer dialog overlay rgba(0,0,0,0.6) -> color-mix(in srgb, black 60%, transparent) (no overlay token)"
  - "JS getTypeColor() functions return var(--bsg-*) strings (inline styles support CSS variables)"
metrics:
  duration: "~45 minutes"
  completed: "2026-06-23"
  tasks_completed: 1
  files_changed: 1
---

# Phase 99 Plan 12: DebugPanel Color-Only Tokenization Summary

Mechanical color-sweep of `DebugPanel.vue` — the densest file in the codebase (155 hex + 113 rgba) — replacing all raw color literals with Slate `var(--bsg-*)` tokens, no structural/behavior change.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Mechanical color-only tokenization of DebugPanel.vue | e08e4eb | src/ui/components/DebugPanel.vue |

## What Was Done

Replaced every hex color and rgba literal in `src/ui/components/DebugPanel.vue` with the appropriate Slate design token:

**Panel chrome and surfaces:**
- `#1a1a2e` (dark navy bg) → `var(--bsg-surface)`
- `rgba(0,0,0,0.2)` glass → `var(--bsg-surface-2)`
- `rgba(0,0,0,0.3)` glass → `var(--bsg-surface-3)`
- `rgba(0,0,0,0.8)` heavy dark → `var(--bsg-bg)`

**Borders and hairlines:**
- `rgba(255,255,255,0.1)` → `var(--bsg-line)`
- `rgba(255,255,255,0.2)` → `var(--bsg-line-2)`
- `rgba(255,255,255,0.05)` faint hairlines → `var(--bsg-line)`

**Accent colors:**
- `#00d9ff` (neon cyan) → `var(--bsg-accent-2)` (bright teal)
- `rgba(0,217,255,N%)` tints → `color-mix(in srgb, var(--bsg-accent-2) N%, transparent)`

**Status colors:**
- `#00ff88`, `#2ecc71`, `#4ade80`, `#22c55e` → `var(--bsg-ok)`
- `#e74c3c`, `#f87171`, `#ef4444`, `#239, 68, 68,...` → `var(--bsg-danger)`
- `#f59e0b`, `#fbbf24`, `#e67e22`, `#f1c40f` → `var(--bsg-warn)`
- `#60a5fa`, `#3498db` → `var(--bsg-accent)` (blue-ish accent)

**Text colors:**
- `#fff` → `var(--bsg-ink)`
- `#e0e0e0`, `#ddd` → `var(--bsg-ink)`
- `#aaa`, `#ccc` → `var(--bsg-ink-2)`
- `#888` → `var(--bsg-ink-2)`
- `#666` → `var(--bsg-ink-3)`
- `#555` → `var(--bsg-ink-3)`
- `#9ca3af` → `var(--bsg-away)`

**Player history badges:**
- `rgba(59,130,246,0.3)` / `#60a5fa` (player-0) → seat-2 (slate-blue)
- `rgba(239,68,68,0.3)` / `#f87171` (player-1) → seat-1 (desaturated red)
- `rgba(34,197,94,0.3)` / `#4ade80` (player-2) → seat-3 (sage)
- `rgba(168,85,247,0.3)` / `#c084fc` (player-3) → seat-5 (plum)

**JavaScript inline styles (TreeNode render function + getTypeColor):**
- Both `getTypeColor` function instances updated to return `var(--bsg-*)` strings
- `styles` object in TreeNode updated to use CSS variable strings

## Verification

- `stylelint color-no-hex`: PASS (0 violations)
- `grep #00d9ff|#00ff88|rgba(46,204,113|color: #fff`: PASS (no matches)
- `vitest run src/ui/components`: 85/85 tests pass

## Deviations from Plan

None — plan executed exactly as written. Pure mechanical color sweep with no structural changes.

## Known Stubs

None. This is a pure tokenization plan with no data flows or UI state.

## Threat Flags

None. CSS tokenization introduces no new security surface.

## Self-Check: PASSED

- [x] `src/ui/components/DebugPanel.vue` exists and is modified
- [x] Commit e08e4eb exists
- [x] No hex colors remain in `<style>` (stylelint passes)
- [x] No forbidden neon patterns remain
- [x] 85 UI tests green
