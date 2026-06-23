---
phase: 99-theming-swap-wave-2
plan: 13
subsystem: cli/dev-host
tags: [theming, slate, devhost, token-sweep, THEME-08]
requirements: [THEME-08]
dependency_graph:
  requires: [99-01]
  provides: [DevHost Slate chrome, quiet New-game outline]
  affects: [src/cli/dev-host/DevHost.vue]
tech_stack:
  added: []
  patterns: [var(--bsg-*) token references, color-mix() for tinted backgrounds]
key_files:
  created: []
  modified:
    - src/cli/dev-host/DevHost.vue
decisions:
  - "demote-new-game-button: btn--start changed from filled emerald CTA to transparent + var(--bsg-line-2) border + var(--bsg-ink-2) text; no two-click confirm (deferred to Phase 102)"
  - "swatch-dot-online: #2ecc71 mapped to var(--bsg-ok); #888 mapped to var(--bsg-away) for status dot semantic alignment"
  - "rgba(255,255,255,0.12): mapped to var(--bsg-line-2) (.17 is closest; .12 is between line and line-2 but visually a divider)"
  - "input-bg: #0f1020 inside inputs → var(--bsg-field) (designated input-field token) rather than --bsg-bg for semantic correctness"
metrics:
  duration_seconds: 142
  completed_date: "2026-06-23"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 99 Plan 13: DevHost Slate Recolor Summary

Swept `DevHost.vue` from indigo/neon to Slate tokens — replacing all 27 hex and 11 rgba literals with `var(--bsg-*)` references and demoting the emerald "New game" button to a quiet neutral outline.

## What Was Built

DevHost.vue Slate recolor (THEME-08): every raw hex and rgba literal in `<style scoped>` replaced with Slate design tokens. The emerald-filled "New game" button (`btn--start`) is now a transparent outline using `var(--bsg-line-2)` border and `var(--bsg-ink-2)` text with a subtle `var(--bsg-field)` hover — no two-click confirm added (deferred to Phase 102 / DEV-07). All 27 hex literals and 11 rgba values eliminated.

## Tasks

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Slate-recolor DevHost.vue + demote New-game button | 91a8b53 | src/cli/dev-host/DevHost.vue |

## Token Mapping Applied

| Old literal | New token | Rule |
|-------------|-----------|------|
| `#0f1020` (deep bg) | `var(--bsg-bg)` | bg |
| `#1a1b33` (panel/chrome) | `var(--bsg-surface)` | surface |
| `#e8e8f0` | `var(--bsg-ink)` | ink |
| `#9aa`, `#778` | `var(--bsg-ink-3)` | muted ink |
| `#00d9ff` (border/active) | `var(--bsg-accent)` / `var(--bsg-accent-2)` | accent |
| `rgba(0,217,255,0.15)` (badge/btn bg) | `color-mix(in srgb, var(--bsg-accent) 15%, transparent)` | accent tint |
| `rgba(0,217,255,0.5)` (hover border) | `var(--bsg-accent)` | accent |
| `rgba(255,255,255,0.08)` | `var(--bsg-line)` | hairline |
| `rgba(255,255,255,0.12/.15/.18/.3)` | `var(--bsg-line-2)` | line |
| `#2ecc71` (online dot) | `var(--bsg-ok)` | status ok |
| `#2ecc71` (btn--start bg) | `transparent` | demoted |
| `#021` (btn--start text) | `var(--bsg-ink-2)` | demoted |
| `#888` (offline dot) | `var(--bsg-away)` | status away |
| `#fff` (swatch border) | `var(--bsg-ink)` | ink |
| `#ff6b6b` | `var(--bsg-danger)` | danger |
| `#0f1020` (inputs) | `var(--bsg-field)` | field bg |

## Verification

- `stylelint src/cli/dev-host/DevHost.vue` (worktree): PASS — no hex/rgba lint violations
- `grep -nE '#00d9ff|#00ff88|rgba\(46,204,113'`: no matches (no neon survives)
- No DevHost TypeScript errors introduced
- Pre-existing TS errors in `image-leak.test.ts` / `notation-serialization.test.ts` are unrelated to this change (out of scope, not touched)

## Deviations from Plan

None — plan executed exactly as written. Two-click confirm deliberately NOT added (Phase 102 / DEV-07 per plan spec).

## Known Stubs

None.

## Threat Flags

None — DevHost.vue is a dev-only chrome page, not a production network endpoint. No new trust-boundary surfaces introduced.

## Self-Check: PASSED

- [x] `src/cli/dev-host/DevHost.vue` exists and has no hex/rgba literals in `<style>`
- [x] Commit 91a8b53 exists: `git log --oneline | grep 91a8b53`
- [x] No neon literals: `grep -nE '#00d9ff|#00ff88'` returns nothing
