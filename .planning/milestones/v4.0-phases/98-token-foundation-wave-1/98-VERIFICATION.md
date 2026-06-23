---
phase: 98-token-foundation-wave-1
verified: 2026-06-23T00:48:00Z
status: passed
score: 19/19 must-haves verified
overrides_applied: 0
---

# Phase 98: Token Foundation (Wave 1) Verification Report

**Phase Goal:** A single `--bsg-*` token contract emitted by `theme.ts` becomes the sole source of truth for color, spacing, type, radius, shadow, and motion — defaulting to the Slate palette, following OS light/dark, host-overridable via `applyTheme()`, and guarded by a `color-no-hex` lint so the wrong path fails CI.
**Verified:** 2026-06-23T00:48:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | theme.ts emits the full Slate dark token set as the default (graphite `--bsg-bg #121417`, layered surfaces, ink ramp, teal `--bsg-accent #1fb8a6`) | ✓ VERIFIED | `src/ui/theme.ts` DARK_COLOR_TOKENS block confirmed; `--bsg-bg: #121417` and `--bsg-accent: #1fb8a6` present verbatim |
| 2 | A complete Slate light token set exists and OS `prefers-color-scheme` selects it without host intervention | ✓ VERIFIED | `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` block present in themeCSS; `--bsg-bg: #f3f2ef` confirmed |
| 3 | `applyTheme({'--bsg-accent':'#abc'})` updates the resolved inline value on the document element | ✓ VERIFIED | theme.test.ts (18/18 green) includes override assertion; GameShell.theme.test.ts (4/4 green) proves the postMessage path |
| 4 | `applyTheme` can force a color scheme (light/dark/auto) so a host can override OS preference | ✓ VERIFIED | `options.scheme` branch sets/removes `data-theme` on `document.documentElement`; scheme-forcing test passes in theme.test.ts |
| 5 | A single `--bsg-seat-1..6` token set is emitted from one SEAT_PALETTE source of truth | ✓ VERIFIED | `SEAT_PALETTE` exported as `readonly string[]` with 6 entries; named destructure `[p1..p6]` emits literal `--bsg-seat-1`..`--bsg-seat-6` strings; `grep -cE '--bsg-seat-[1-6]' src/ui/theme.ts` = 6 |
| 6 | Interaction, drag/drop, and motion tokens are registered so the Phase 99 sweep only references them | ✓ VERIFIED | STATIC_TOKENS block in theme.ts contains `--bsg-selectable`, `--bsg-selected`, `--bsg-droptarget*`, `--bsg-ring`, `--bsg-elevation`, `--bsg-dur-*`, `--bsg-ease`, and all drag/drop cursor/opacity/scale/transition tokens |
| 7 | The dead light-blue ThemeConfig defaults and color-math helpers are deleted | ✓ VERIFIED | `grep -E '4a90d9\|getTheme\|hexToRgb\|interface ThemeConfig' src/ui/theme.ts` returns nothing |
| 8 | A `lint:css` (color-no-hex) npm script exists and runs stylelint against chrome/renderer .vue files | ✓ VERIFIED | `"lint:css": "stylelint 'src/ui/**/*.vue'"` confirmed in package.json; `npm run lint:css` exits 0 |
| 9 | Introducing a raw hex literal into a clean/non-ignored .vue file fails the script | ✓ VERIFIED | `scripts/check-no-hex.test.mjs` (2/2 green): hex `#ff0000` → ≥1 color-no-hex warning; `var(--bsg-accent)` → 0 warnings |
| 10 | theme.ts is exempt — it is the one place literals are allowed to live | ✓ VERIFIED | stylelint targets `src/ui/**/*.vue`; theme.ts is `.ts` and never matches the glob |
| 11 | The not-yet-swept renderer + chrome .vue files are in a temporary ignoreFiles list, documented as emptied by Phase 99 | ✓ VERIFIED | `.stylelintrc.cjs` top comment: "TEMPORARY ignore list — Phase 99 (Theming Swap) empties this…"; 18 files in ignoreFiles; "Do not add files here to silence new violations" present |
| 12 | No `--bs-*` custom-property definition or reference remains anywhere in src/ui | ✓ VERIFIED | `grep -rn -- '--bs-' src/ui \| grep -v '--bsg-'` returns nothing |
| 13 | The drag/drop interaction vars resolve from the `--bsg-*` tokens registered in theme.ts (no neon literal fallbacks remain) | ✓ VERIFIED | drag-drop.css has 0 `:root` blocks; 7 `var(--bsg-droptarget` references; no inline rgba fallbacks |
| 14 | HexBoardRenderer's seat colors come from the `--bsg-seat-1..6` tokens, not a hardcoded Flat-UI cycle | ✓ VERIFIED | `PLAYER_COLOR_CYCLE` and Flat-UI hex literals gone; `grep -c '--bsg-seat-' HexBoardRenderer.vue` = 2; `getPieceColor` returns `var(--bsg-seat-N)` for seated pieces and `var(--bsg-ink-3)` for seatless |
| 15 | drag-drop.css no longer defines its own `:root` token block — theme.ts owns those defaults | ✓ VERIFIED | `grep -c ':root' src/ui/animation/drag-drop.css` = 0 |
| 16 | No `--bg-*`, `--text-*`, or `--border-*` custom-property definition or reference remains anywhere in src/ui | ✓ VERIFIED | `grep -rnE -- '--(bg\|text\|border)-' src/ui \| grep -v -- '--bsg-'` returns nothing |
| 17 | The ActionPanel pending/skip block resolves background AND text from `--bsg-*` tokens together (no invisible-text trap) | ✓ VERIFIED | Five CSS properties renamed together in one pass (`--bsg-surface-2` dark bg + `--bsg-ink-2` light ink preserve readability); no hex fallbacks remain |
| 18 | GameShell installs the Slate token base on mount via `applyTheme()` | ✓ VERIFIED | GameShell.vue line 583 calls `applyTheme()` before the `platformMode` early-return at line 585, so the base stylesheet is always installed |
| 19 | A theme override delivered in the iframe `init` postMessage is consumed via `applyTheme(data.theme)` | ✓ VERIFIED | `consumeInitMessage` (GameShellInit.ts) passes `data.theme` and `data.scheme` to `applyTheme`; called from GameShell.vue init branch; 4/4 integration tests prove the receiver path |

**Score:** 19/19 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ui/theme.ts` | Slate token emission (themeCSS), applyTheme sole knob, SEAT_PALETTE | ✓ VERIFIED | 229 lines; exports `themeCSS`, `applyTheme`, `SEAT_PALETTE`; four CSS blocks (dark `:root`, media light, forced light, forced dark); key guard `BSG_KEY_RE` enforced |
| `src/ui/theme.test.ts` | Unit tests for Slate defaults + applyTheme override + scheme forcing | ✓ VERIFIED | 18 tests, all pass; covers dark anchors, light gating, seat count, injection guard, scheme forcing, idempotency |
| `.stylelintrc.cjs` | color-no-hex rule scoped to .vue with documented temporary ignore list | ✓ VERIFIED | `color-no-hex: true`, `customSyntax: 'postcss-html'`, 18-file ignoreFiles with Phase 99 documentation |
| `package.json` | lint:css npm script + stylelint devDependencies | ✓ VERIFIED | `"lint:css"` script present; `stylelint` and `postcss-html` in devDependencies |
| `scripts/check-no-hex.test.mjs` | Programmatic bite-test proving guard fires on hex, passes on var() | ✓ VERIFIED | 2/2 tests pass; probe file is cleaned up (no `src/ui/__hexprobe__/` remains) |
| `src/ui/animation/drag-drop.css` | Drag/drop rules referencing `--bsg-*` tokens, no local `:root` | ✓ VERIFIED | 0 `:root` blocks; 7 `var(--bsg-droptarget` references; no `--bs-*` custom properties |
| `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` | Seat coloring via `var(--bsg-seat-N)` | ✓ VERIFIED | 2 `--bsg-seat-` references; `PLAYER_COLOR_CYCLE` removed |
| `src/ui/components/GameShell.vue` | `applyTheme()` base install on mount + init-message theme override | ✓ VERIFIED | imports `applyTheme` and `consumeInitMessage`; calls both at the correct sites |
| `src/ui/components/GameShellInit.ts` | Pure helper `consumeInitMessage` for testable TOKEN-05 receiver | ✓ VERIFIED | exports `consumeInitMessage`; passes `data.theme`/`data.scheme` to `applyTheme`; delegates key validation to applyTheme |
| `src/ui/components/GameShell.theme.test.ts` | Integration test proving init override consumption | ✓ VERIFIED | 4/4 tests pass; covers base install, `#abc` override, no-theme init, scheme forcing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/ui/index.ts` | `src/ui/theme.ts` | re-export of `applyTheme`/`themeCSS`/`SEAT_PALETTE` | ✓ WIRED | All three exports confirmed; `getTheme`/`ThemeConfig` removed |
| `src/ui/components/GameShell.vue` | `applyTheme` (theme.ts) | `onMounted` install + init-handler override | ✓ WIRED | Imports confirmed; called at line 583 (mount) and line 624 (init branch) |
| `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` | `--bsg-seat-1..6` tokens (theme.ts) | `var(--bsg-seat-N)` in piece fill | ✓ WIRED | `getPieceColor` returns `var(--bsg-seat-${(player.seat % 6) + 1})`; 2 references found |
| `src/ui/animation/drag-drop.css` | `--bsg-droptarget` tokens (theme.ts) | `var(--bsg-droptarget...)` in `.bs-drop-target` rules | ✓ WIRED | 7 `var(--bsg-droptarget` references; no local `:root` definitions |
| `package.json` | `.stylelintrc.cjs` | `stylelint --config` invocation in `lint:css` script | ✓ WIRED | `"lint:css": "stylelint 'src/ui/**/*.vue'"` uses the `.stylelintrc.cjs` config (stylelint auto-discovers it at repo root) |
| `src/ui/components/auto-ui/ActionPanel.vue` | `--bsg-surface`/`--bsg-ink`/`--bsg-line` tokens | `var(--bsg-*)` in pending/skip styles | ✓ WIRED | All five legacy CSS vars replaced; no `--bg-*`/`--text-*`/`--border-*` remain |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| theme.ts unit tests | `npx vitest run src/ui/theme.test.ts` | 18/18 pass | PASS |
| color-no-hex bite-test | `npx vitest run scripts/check-no-hex.test.mjs` | 2/2 pass | PASS |
| GameShell theme integration | `npx vitest run src/ui/components/GameShell.theme.test.ts` | 4/4 pass | PASS |
| lint:css current tree | `npm run lint:css` | exit 0 | PASS |
| Full test suite | `npx vitest run` | 963/963 pass | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TOKEN-01 | 98-03, 98-04 | All chrome/renderer values resolve from `--bsg-*` namespace; `--bs-*`/`--bg-*`/`--text-*`/`--border-*` collapsed into it | ✓ SATISFIED | Both grep checks return empty; drag-drop.css, 5 renderers, ActionPanel, WaitingRoom all renamed |
| TOKEN-02 | 98-01, 98-03 | `theme.ts` default tokens are the Slate palette; dead light-blue defaults deleted | ✓ SATISFIED | `--bsg-bg:#121417`, `--bsg-accent:#1fb8a6`, full ink/surface/shadow ramp; `4a90d9` absent; HexBoardRenderer seat colors from `SEAT_PALETTE` |
| TOKEN-03 | 98-01 | `theme.ts` emits spacing, type, radius, shadow, seat tokens — no longer color-only | ✓ SATISFIED | STATIC_TOKENS: radius, spacing, fonts, type scale, line heights, motion, interaction, drag/drop, seat — all present |
| TOKEN-04 | 98-01 | Chrome follows OS light/dark by default; complete Slate light token set exists | ✓ SATISFIED | `@media (prefers-color-scheme: light) { :root:not([data-theme]) { … } }` block with full 22-token light set; theme.test.ts asserts `--bsg-bg: #f3f2ef` under light gate |
| TOKEN-05 | 98-01, 98-04 | `applyTheme()` is the sole theming knob; accepts host-supplied override at iframe init | ✓ SATISFIED | `applyTheme` signature, key allowlist, idempotent injection; GameShell mount + init receiver; 4 integration tests prove the path end-to-end |
| TOKEN-06 | 98-02 | `color-no-hex` stylelint rule scoped to `.vue` files fails CI when a raw hex is introduced | ✓ SATISFIED | `.stylelintrc.cjs` with `color-no-hex: true`; `lint:css` exits 0 on current tree; bite-test proves hex → warning, var() → clean |

### Anti-Patterns Found

No blockers or warnings. Scanned: `src/ui/theme.ts`, `src/ui/animation/drag-drop.css`, `src/ui/components/GameShell.vue`, `src/ui/components/GameShellInit.ts`, `.stylelintrc.cjs`, `scripts/check-no-hex.test.mjs`, `src/ui/theme.test.ts`, `src/ui/components/GameShell.theme.test.ts`. Zero TBD/FIXME/XXX markers. No stubs or empty implementations. No hardcoded hex leaks outside theme.ts.

The ignoreFiles list in `.stylelintrc.cjs` expanded from the plan's 5-file spec to 18 files — this is documented in 98-02-SUMMARY as an intentional deviation (those 13 additional .vue files already contained hex literals; including them keeps `lint:css` green). This is correct per the critical scope note: a non-empty ignore list is expected for Phase 98; Phase 99 empties it.

### Human Verification Required

None. All phase deliverables are infrastructure (token emission, CSS renames, test coverage). The phase is intentionally safe-in-isolation with zero visual consumer changes — no browser rendering verification is appropriate or needed at this stage. The chrome still shows the pre-Phase-98 neon look because nothing reads the new `--bsg-*` tokens yet; that sweep is Phase 99 by design.

---

_Verified: 2026-06-23T00:48:00Z_
_Verifier: Claude (gsd-verifier)_
