---
phase: 164-library-misc-action-panel-loop-visual-debug-view
plan: 02
subsystem: ui
tags: [player-token, contrast, wcag, accessibility, tdd]

requires:
  - phase: 164-CONTEXT
    provides: locked LIBX-03 decision (luminance-based auto-contrast ink, halo derived opposite ink, WCAG relative-luminance threshold)
provides:
  - "src/ui/utils/color-contrast.ts — pure, DOM-free contrastInk(seatColor) helper (WCAG 2.1 relative luminance; hex/#rgb/rgb()/rgba() parser; throws on unparseable input)"
  - "PlayerToken.vue glyph ink + text-shadow now derived from the seat color, not hardcoded white"
affects: [164-03, 164-04]

tech-stack:
  added: []
  patterns:
    - "Pure luminance-contrast helper colocated in src/ui/utils/ rather than the DOM/Canvas normalization trick — jsdom does not implement Canvas 2D and CLAUDE.md forbids adding a native canvas dependency without discussion; a small hand-rolled hex/rgb()/rgba() parser is sufficient for STANDARD_PLAYER_COLORS (all hex) and typical custom palettes, and fails loud on anything else."

key-files:
  created:
    - src/ui/utils/color-contrast.ts
    - src/ui/utils/color-contrast.test.ts
    - src/ui/components/PlayerToken.contrast.test.ts
  modified:
    - src/ui/components/PlayerToken.vue

key-decisions:
  - "Implemented a pure hex/#rgb/rgb()/rgba() parser instead of the Canvas 2D fillStyle-normalization trick recommended in RESEARCH.md Pattern 3 as the default — CLAUDE.md forbids Canvas/DOM dependency per the plan's own key_constraint (LIBX-03 explicitly locks this: 'NO Canvas / getContext / createElement(\"canvas\")'), and the RESEARCH doc itself flagged this as an open question requiring a jsdom spike before committing. The hex/rgb parser covers the entire STANDARD_PLAYER_COLORS palette (all hex) and throws a clear, actionable error for any unsupported CSS color syntax (named colors, hsl(), oklch()) rather than silently guessing wrong contrast."
  - "PlayerToken's no-color path (color prop absent, falls back to the --bsg-accent CSS token) keeps a hardcoded default ink+halo matching the prior appearance, rather than calling contrastInk with an unknown/undefined value — this preserves 'fail loud only on a color we were actually given,' since PlayerToken has no way to read the resolved CSS custom property's value to compute real contrast against it."
  - "Removed both hardcoded rgba(255,255,255,.95) color and text-shadow from the scoped .tok .ini CSS rule entirely (not just overridden) — per CLAUDE.md's no-backward-compatibility rule, the inline computed styles are now the single source of truth, with zero dead/shadowed CSS left behind."

requirements-completed: [LIBX-03, PROC-01]

duration: 20min
completed: 2026-07-21
---

# Phase 164 Plan 02: PlayerToken luminance-adaptive glyph ink (LIBX-03) Summary

**Added a pure, DOM-free WCAG relative-luminance `contrastInk` helper and wired it into `PlayerToken` so the identity-letter ink is black on light seat colors and white on dark, with the halo `text-shadow` derived opposite the chosen ink — replacing the previously hardcoded white ink that was invisible on light seats like the standard "White" (`#ecf0f1`) palette entry.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 4 (2 created source + 2 created test, 1 modified component)

## Accomplishments
- `contrastInk('#ecf0f1')` (the standard palette's near-white "White" seat color) now correctly returns black ink — previously this seat's glyph letter was rendered in near-invisible white-on-near-white.
- The helper is fully DOM-free: verified by an explicit grep gate (`getContext`/`createElement`/`canvas` count == 0 in the helper file) and runs in plain vitest with no jsdom canvas dependency.
- `PlayerToken`'s scoped CSS no longer carries any hardcoded ink/text-shadow — the computed values are the single source of truth, satisfying the no-backward-compatibility rule.

## Task Commits

Each task was committed atomically, RED before GREEN:

1. **Task 1 RED: failing unit test for `contrastInk`** - `30a7c9cf` (test)
2. **Task 1 GREEN: pure WCAG `contrastInk` helper** - `194a70de` (feat)
3. **Task 2 RED: failing component test for `PlayerToken` ink adaptation** - `30f52dbe` (test)
4. **Task 2 GREEN: wire `contrastInk` into `PlayerToken`** - `6af8dbf9` (feat)

_TDD gate sequence confirmed twice: each `test(...)` commit precedes its `feat(...)` commit; no refactor commit was needed for either task._

## Files Created/Modified
- `src/ui/utils/color-contrast.ts` - `contrastInk(seatColor: string): { ink: '#000000'|'#ffffff'; textShadow: string }`. Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)`, `rgba(r,g,b,a)`; computes WCAG 2.1 relative luminance via sRGB gamma correction (0.2126/0.7152/0.0722 coefficients); picks whichever of black/white has the higher WCAG contrast ratio; derives `textShadow` opposite the chosen ink (dark halo for white ink, `'none'` for black ink); throws an `Error` naming the offending value and the supported formats on anything else.
- `src/ui/utils/color-contrast.test.ts` - 7 tests: black ink for near-white seat, white ink for dark seat, halo derivation both directions, hex/#rgb/rgb()/rgba() parsing equivalence, throw-on-unparseable naming the bad value + formats, and a full-palette no-throw sweep over `STANDARD_PLAYER_COLORS`.
- `src/ui/components/PlayerToken.contrast.test.ts` - 3 tests (new file — no `PlayerToken*test*` existed before): light-seat renders black ink + no dark-rgba text-shadow, dark-seat renders white ink + a text-shadow, absent-`color` path renders without throwing.
- `src/ui/components/PlayerToken.vue` - imports `contrastInk`; a computed `ink` derives `{ ink, textShadow }` from the `color` prop (falling back to a hardcoded default matching the prior appearance when `color` is absent, never calling the throwing parser with `undefined`); binds `color`/`text-shadow` as inline styles on the `.ini` span; removes the hardcoded `color: rgba(255,255,255,.95)` and `text-shadow: 0 1px 2px rgba(0,0,0,.5)` from the scoped `.tok .ini` CSS rule.

## Decisions Made
See `key-decisions` in frontmatter above. The most significant is diverging from RESEARCH.md's "recommended" Canvas 2D `fillStyle` normalization approach: the plan's own locked `key_constraint` (LIBX-03, orchestrator resolution 2) explicitly forbids Canvas/DOM usage, superseding RESEARCH.md's open-question framing of that choice. The hex/rgb parser is the correct implementation per the plan, not a compromise — it satisfies "unit-testable in plain node/vitest, no DOM" directly rather than requiring a jsdom-canvas spike.

## Deviations from Plan

None — plan executed exactly as written, including the exact PROC-01 test behaviors enumerated in the plan's `<behavior>` blocks for both tasks.

## Verification

```
npx vitest run src/ui/utils/color-contrast.test.ts src/ui/components/PlayerToken.contrast.test.ts
```
Result: 2 files, 10 tests, all passed.

Acceptance-criteria checks:
- `grep -c "getContext\|createElement\|canvas" src/ui/utils/color-contrast.ts` → 0.
- `grep -c "255, 255, 255\|255,255,255" src/ui/components/PlayerToken.vue` → 0.
- `contrastInk` exported and imported by `PlayerToken.vue`; ink/text-shadow inline-bound on `.ini`.
- Unsupported-format test asserts a thrown `Error` whose message contains the offending value (`not-a-color`) and the supported formats.

Broader regression check (not required by this plan's `<verification>` but run for confidence since `PlayerToken` is consumed by `GameShell.vue`/`PlayersPanel.vue`): `npx vitest run src/ui/components/GameShell` — 12 files, 150 tests, all passed (no regression from the CSS removal).

Full-suite run deferred to the phase/wave gate per this plan's `<verification>` section.

## Known Stubs

None.

## Threat Flags

None — the plan's own threat model (T-164-03-01 DoS via unbounded parser work, T-164-03-02 information disclosure via error message) is fully satisfied by the implementation: the parser is a bounded, non-backtracking regex match over three fixed patterns with immediate throw on no match, and the thrown error names only the offending value + supported format list (no stack traces, no internal paths).

## Self-Check: PASSED

- FOUND: src/ui/utils/color-contrast.ts
- FOUND: src/ui/utils/color-contrast.test.ts
- FOUND: src/ui/components/PlayerToken.contrast.test.ts
- FOUND: src/ui/components/PlayerToken.vue (contrastInk import + ink computed + inline bindings present)
- FOUND commit 30a7c9cf (test)
- FOUND commit 194a70de (feat)
- FOUND commit 30f52dbe (test)
- FOUND commit 6af8dbf9 (feat)
