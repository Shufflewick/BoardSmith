---
phase: 99-theming-swap-wave-2
plan: "01"
subsystem: ui/theme
tags: [theming, tokens, css-custom-properties, slate]
dependency_graph:
  requires: []
  provides: [bsg-card-back-token, bsg-display-token]
  affects: [CardRenderer.vue, HandRenderer.vue, headings/chrome]
tech_stack:
  added: []
  patterns: [css-custom-property token composition, TDD]
key_files:
  created: []
  modified:
    - src/ui/theme.ts
    - src/ui/theme.test.ts
decisions:
  - "--bsg-display uses same font stack as --bsg-font (Hanken Grotesk) so headings opt into display type without a missing-var fallback; distinct name allows future differentiation"
  - "--bsg-card-back placed in STATIC_TOKENS (theme-independent block) so it auto-adapts per scheme via nested var(--bsg-surface-2)/var(--bsg-bg-2) chains — no raw hex"
metrics:
  duration: "3 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  files_changed: 2
---

# Phase 99 Plan 01: Register --bsg-card-back and --bsg-display tokens Summary

**One-liner:** Added `--bsg-card-back` (graphite gradient) and `--bsg-display` (display font family) as STATIC_TOKENS in `theme.ts`, test-locked with three new vitest assertions.

## What Was Built

Two new CSS custom property tokens registered centrally in `theme.ts`'s STATIC_TOKENS block so every Wave 2 consumer can reference a token instead of inlining a literal:

- `--bsg-display: 'Hanken Grotesk', system-ui, sans-serif;` — placed next to `--bsg-font`/`--bsg-mono`; headings can use it without a missing-var fallback
- `--bsg-card-back: linear-gradient(180deg, var(--bsg-surface-2), var(--bsg-bg-2));` — graphite Slate card-back surface; consumers apply the `1px solid var(--bsg-line-2)` border separately per the spec; composed entirely from existing `--bsg-*` vars, no raw hex

Three new test assertions in `theme.test.ts` lock both tokens:
- `--bsg-card-back` is declared
- `--bsg-display` is declared
- `--bsg-card-back` value contains `var(--bsg-` and contains no hex literal

## TDD Gate Compliance

RED commit `39aa018`: `test(99-01): add failing tests for --bsg-card-back and --bsg-display tokens` — 3 tests failed as expected (tokens absent).

GREEN commit `834c804`: `feat(99-01): register --bsg-card-back and --bsg-display tokens in theme.ts` — all 21 tests pass.

RED → GREEN gate order verified in git log.

## Tasks

| # | Task | Commit | Status |
|---|------|--------|--------|
| 2 RED | Assert both new tokens are emitted (failing) | 39aa018 | done |
| 1 GREEN | Register --bsg-card-back and --bsg-display in theme.ts | 834c804 | done |

Note: TDD order swapped tasks 1 and 2 (tests written first for RED/GREEN discipline).

## Verification

- `grep -n 'bsg-card-back\|bsg-display' src/ui/theme.ts` — both tokens present, no raw hex
- `npx vitest run src/ui/theme.test.ts` — 21/21 pass

## Deviations from Plan

None — plan executed exactly as written. TDD order (RED before GREEN) was applied naturally by writing tests first.

## Known Stubs

None.

## Threat Flags

None — pure token registration with no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- `src/ui/theme.ts` exists with `--bsg-card-back` and `--bsg-display` at lines 157 and 113
- `src/ui/theme.test.ts` exists with 3 new assertions in `themeCSS — new tokens (Phase 99 Plan 01)` describe block
- Commit `39aa018` exists (RED gate)
- Commit `834c804` exists (GREEN gate)
- All 21 tests pass
