---
phase: 98-token-foundation-wave-1
plan: "01"
subsystem: ui/theme
tags: [tokens, css-custom-properties, slate-palette, theme-engine]
dependency_graph:
  requires: []
  provides: [bsg-token-engine, seat-palette, apply-theme-knob]
  affects: [src/ui/theme.ts, src/ui/index.ts, src/ui/theme.test.ts]
tech_stack:
  added: []
  patterns: [css-custom-properties, idempotent-style-injection, data-theme-scheme-forcing]
key_files:
  created:
    - src/ui/theme.test.ts
  modified:
    - src/ui/theme.ts
    - src/ui/index.ts
decisions:
  - "SEAT_PALETTE defined as readonly string[] with named destructure so --bsg-seat-1..6 are literal in source (grep-verifiable) while values remain single-sourced"
  - "applyTheme key guard uses /^--bsg-[a-z0-9-]+$/ regex to prevent arbitrary CSS injection via host postMessage (T-98-01 mitigated)"
  - "Seat colors: #b5544e (red), #5a7fa8 (slate-blue), #6f9e74 (sage), #c79a4b (amber), #9a6f9b (plum), #4fa39a (teal) — muted ~30%-desaturated, colorblind-aware set on graphite ground"
  - "PieceRenderer/DebugPanel hardcoded colors are JSON value-type highlighting, not seat colors — only real seat cycle is HexBoardRenderer PLAYER_COLOR_CYCLE (Phase 98-03 scope)"
metrics:
  duration: "15 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 98 Plan 01: Token Foundation — Slate --bsg-* Engine Summary

**One-liner:** Rewrote `theme.ts` from a dead light-blue stub into the full Slate `--bsg-*` token engine emitting dark/light color sets, OS scheme following, seat palette, interaction/drag/motion tokens, and `applyTheme()` as the sole host-overridable knob.

## What Was Built

### src/ui/theme.ts (complete rewrite)

The file is now the single source of color literals in BoardSmith UI. It exports:

- **`themeCSS`** — Full CSS string with four blocks: `:root` (dark defaults + all static tokens), `@media (prefers-color-scheme: light) :root:not([data-theme])` (OS light), `html[data-theme="light"]` (forced light), `html[data-theme="dark"]` (forced dark re-assertion). Values copied verbatim from 98-CONTEXT.md pinned table.
- **`SEAT_PALETTE`** — `readonly string[]` of 6 muted, colorblind-aware hex colors. `--bsg-seat-1..6` built from named destructure of this array, making token names literal in source (grep-verifiable) and values single-sourced.
- **`applyTheme(overrides?, options?)`** — Sole theming knob. Idempotently injects `<style id="bsg-tokens">`, sets/removes `data-theme` for scheme forcing, and writes override values only for keys matching `/^--bsg-[a-z0-9-]+$/` (injection guard for T-98-01).

Deleted: `ThemeConfig` interface, `getTheme()`, `defaultTheme`, `lighten()`, `darken()`, `hexToRgb()`, `rgbToHex()`. No shims (No Backward Compatibility rule).

### src/ui/index.ts (exports updated)

Removed: `getTheme`, `type ThemeConfig`. Added: `SEAT_PALETTE`. Kept: `applyTheme`, `themeCSS`.

### src/ui/theme.test.ts (18 tests, all green)

Tests prove (per TOKEN requirements):
- Dark anchor `--bsg-bg: #121417` and `--bsg-accent: #1fb8a6` present in themeCSS
- Light `--bsg-bg: #f3f2ef` gated behind media/data-theme selector
- All 6 `--bsg-seat-N` tokens present; SEAT_PALETTE length === 6
- Motion, interaction, drag/drop tokens all present
- Dead light-blue values absent
- `applyTheme({'--bsg-accent':'#abc'})` → inline `#abc` resolved (TOKEN-05 proof)
- Non-bsg keys (`color`, `--evil`) silently ignored (T-98-01 injection guard proof)
- Scheme forcing: `scheme:'light'` sets `data-theme="light"`; `scheme:'auto'` removes attribute
- Idempotent: two `applyTheme()` calls → exactly one `#bsg-tokens` style element

## Token Set Emitted

Dark (`:root` default): graphite `--bsg-bg:#121417`, teal `--bsg-accent:#1fb8a6`, full ink ramp, surface stack, rgba line/field/cell tokens, shadow values.

Light (media + `data-theme="light"`): stone `--bsg-bg:#f3f2ef`, dark teal `--bsg-accent:#0d9488`, dark ink `--bsg-ink:#191e24`.

Static (theme-independent, once in `:root`): radius (`--bsg-r-sm..pill`), spacing (`--bsg-s1..s6`), font families, layout (`--bsg-rail/side`), type scale, line heights, motion (`--bsg-dur-*`, `--bsg-ease`), interaction (`--bsg-selectable`, `--bsg-selected`, `--bsg-droptarget*`, `--bsg-ring`, `--bsg-elevation`), drag/drop defaults, seat colors.

## Threat Mitigations Applied

| ID | Mitigation |
|----|-----------|
| T-98-01 | `applyTheme` key guard `/^--bsg-[a-z0-9-]+$/` — only bsg-namespaced keys with string values are written via `setProperty`; arbitrary CSS property injection from host is blocked |
| T-98-02 | Idempotent injection via `document.getElementById('bsg-tokens')` guard — repeated calls cannot grow unbounded style tags |

## Deviations from Plan

**1. [Rule 1 - Design] SEAT_PALETTE destructuring for grep-verifiability**
- **Found during:** Task 1 acceptance criteria check
- **Issue:** Dynamic `.map()` generation of seat token CSS strings produced `--bsg-seat-${i+1}` in source, not literal `--bsg-seat-1..6`, causing `grep -cE` to return 1 instead of 6.
- **Fix:** Used named destructure `const [p1..p6] = SEAT_PALETTE` and explicit template lines so both values come from SEAT_PALETTE (single source) and token names are grep-verifiable literal strings.
- **Files modified:** `src/ui/theme.ts`

Otherwise: plan executed exactly as written.

## Known Stubs

None. This plan is purely token infrastructure — no UI rendering, no data flows to wire.

## Verification Results

- `npx vitest run src/ui/theme.test.ts` — 18/18 pass
- `npx vitest run` (full suite) — 957/957 pass
- `npx tsc -p tsconfig.json --noEmit` — zero errors in `theme.ts` / `index.ts` (pre-existing errors in `image-leak.test.ts` and `notation-serialization.test.ts` are unrelated and pre-date this plan)
- `grep -cE -- '--bsg-seat-[1-6]' src/ui/theme.ts` → 6
- `grep -E '4a90d9|getTheme|hexToRgb|interface ThemeConfig' src/ui/theme.ts` → no matches
- `grep -rn 'getTheme' src/ui` → no references

## Self-Check: PASSED

- src/ui/theme.ts — exists, 141 lines, contains `--bsg-bg: #121417`
- src/ui/theme.test.ts — exists, 143 lines, 18 tests
- src/ui/index.ts — updated, no getTheme/ThemeConfig exports
- Commits: `69b2afe` (feat), `549611d` (test)
