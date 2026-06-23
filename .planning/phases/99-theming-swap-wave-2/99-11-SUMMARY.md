---
phase: 99-theming-swap-wave-2
plan: 11
subsystem: ui
tags: [theming, slate, tokenization, waiting-room, css]
dependency_graph:
  requires: ["99-01"]
  provides: ["WaitingRoom fully tokenized — THEME-07 partial"]
  affects: ["src/ui/components/WaitingRoom.vue", ".stylelintrc.cjs"]
tech_stack:
  added: []
  patterns: ["CSS custom properties (var(--bsg-*))", "color-mix() for alpha-derived tints"]
key_files:
  created: []
  modified:
    - src/ui/components/WaitingRoom.vue
    - .stylelintrc.cjs
decisions:
  - "AI badge/name color mapped to var(--bsg-seat-5) (plum) — closest semantic match; AI purple is a seat-type cue, not a separate semantic token"
  - "Toggle switch knob: #fff → var(--bsg-ink) so it adapts in light mode (white knob on white bg would be invisible)"
  - "join-section border: 2px solid rgba(0,217,255,0.2) → 1px solid var(--bsg-line) — calmer hairline, avoids neon accent border on a panel that already has selectable bg"
  - "color-mix() used inline for hover/alpha tints where no named token exists at the required opacity (26%, 35%, 10%, 40%)"
  - "box-shadow: 0 0 2px rgba(0,0,0,0.8) retained on taken-color X mark — neutral black, not a neon glow, outside stylelint color-no-hex scope"
metrics:
  duration: "~15 min"
  completed: "2026-06-23"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 99 Plan 11: Slate Sweep — WaitingRoom.vue Summary

WaitingRoom fully tokenized from neon-noir to Slate: all 75 hex literals and 53 rgba glass/glow values replaced with `var(--bsg-*)` tokens atomically (bg + ink together in every rule). No neon remains, no colored glows, all seat-type colors via tokens, and the file removed from `.stylelintrc.cjs` ignoreFiles so `lint:css` now enforces color-no-hex against it.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Tokenize WaitingRoom.vue panels + headings (atomic) | f0d4b30 | WaitingRoom.vue, .stylelintrc.cjs |

## Verification Results

- `npx stylelint src/ui/components/WaitingRoom.vue` — PASS (zero violations)
- `grep -nE '#00d9ff|#00ff88|rgba\(46, ?204, ?113|color: ?#fff'` — PASS (no matches in `<style>`)
- `npx vitest run src/ui/components` — PASS (85/85 tests green)
- `.stylelintrc.cjs` — WaitingRoom.vue removed from ignoreFiles

## Token Mapping Applied

| Old literal | Token |
|-------------|-------|
| `#00d9ff` | `var(--bsg-accent)` |
| `#00ff88` (in gradients) | `var(--bsg-accent)` (solid, no gradient) |
| `linear-gradient(…#00d9ff, #00ff88)` | `var(--bsg-accent)` |
| `#2ecc71` | `var(--bsg-ok)` |
| `#f39c12` | `var(--bsg-warn)` |
| `#e74c3c` | `var(--bsg-danger)` |
| `#ffd700` | `var(--bsg-warn)` |
| `#9b59b6` (AI purple) | `var(--bsg-seat-5)` |
| `#1a1a2e` (ink on accent btns) | `var(--bsg-accent-ink)` |
| `#fff`, `color:#fff` | `var(--bsg-ink)` |
| `#ccc`, `#888`, `#aaa` | `var(--bsg-ink-2)` |
| `#666` | `var(--bsg-ink-3)` |
| `rgba(255,255,255,0.05)` (glass panels) | `var(--bsg-surface-2)` / `var(--bsg-field)` |
| `rgba(255,255,255,0.1–0.2)` (white borders) | `var(--bsg-line)` / `var(--bsg-line-2)` |
| `rgba(0,217,255,0.1–0.2)` (accent fills) | `var(--bsg-selectable)` |
| `rgba(46,204,113,0.6)` (green glow) | `var(--bsg-shadow-sm)` |
| `rgba(N,N,N,alpha)` (semantic tints) | `color-mix(in srgb, var(--bsg-X) N%, transparent)` |
| `0 0 0 2px rgba(255,255,255,0.5)` (ring) | `var(--bsg-ring)` |
| `0 4px 12px rgba(0,0,0,0.3)` (dropdown shadow) | `var(--bsg-shadow)` |

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met in a single atomic edit.

## Known Stubs

None — WaitingRoom.vue has no stubs or placeholder data flows.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- `src/ui/components/WaitingRoom.vue` exists and modified: FOUND
- `.stylelintrc.cjs` WaitingRoom entry removed: CONFIRMED
- Commit f0d4b30 exists: CONFIRMED
- 85 tests green: CONFIRMED
