# Phase 99: Theming Swap (Wave 2) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; Slate look pinned from `planning/mockups/boardsmith-chrome.html`)

<domain>
## Phase Boundary

Spend the tokens. Every neon literal across the **8 renderers**, the **chrome**, and **DevHost** becomes `var(--bsg-*)`, and the product visibly shifts from neon-noir to **Slate**: teal primary button, `outline`-not-`border` selection, solid display type, a shared tokenized card back, a calm active-player cue, and surfaces that let the host show through in platform mode. This is where v4.0 visibly changes. Requirements: THEME-01..08.

**In scope (this repo):** the 8 board renderers + hex `<g>`, the chrome (`GameShell`, `GameHeader`, `HamburgerMenu`, `ActionPanel`, `PlayersPanel`, `GameHistory`, the renderer zone cards), and **`DevHost.vue`** (in-repo dev chrome).
**Out of scope (host repo):** the ShufflewickPub lobby PrimeVue `definePreset`, `GameFrame.vue`, `[sessionId].vue` — deferred to HOST-01/02. Touch none of them.

</domain>

<decisions>
## Implementation Decisions

### ⚠️ THE ATOMIC CONSTRAINT (carried forward from Phase 98 — highest risk)
The Slate token defaults are already live (Phase 98) but unconsumed. As this phase makes components consume them, the **invisible-text trap** becomes possible: a component with `background: var(--bsg-bg)` but text still `#fff` (or vice-versa) — fatal in **light mode** (white text on `#f3f2ef`).

**Rules the plan and executor MUST follow:**
1. **Sweep each component atomically** — when you change a component's background to a token, change its text/ink to a token in the **same edit**. Never commit a component half-swept (background tokenized, text still raw, or the reverse).
2. **Test BOTH themes.** Every swept surface must be verified in dark (default) **and** light (`prefers-color-scheme: light` / `html[data-theme="light"]`). Add at least one automated check that resolves text vs background and asserts they are not near-equal (a computed-contrast assertion) in both schemes for the key surfaces (board, action dock, sidebar, dev chrome).
3. **End state = zero stylelint exclusions.** As each file is swept, **remove it from the `.stylelintrc.cjs` `ignoreFiles` list** that Phase 98 created. The phase is not done until `ignoreFiles` is empty and `npm run lint:css` passes with `color-no-hex` fully blocking across all chrome/renderer `.vue` files. This is the completion gate for the whole sweep — no neon literal can survive it.

### Interaction state visuals (THEME-01, THEME-02) — match the mockup
Replace `#00d9ff`/`#00ff88`/`rgba(46,204,113…)` and the glow box-shadows with the Slate interaction language from `planning/mockups/boardsmith-chrome.html` (`.cell.selectable/.selected/.drop`):
- **selectable:** `outline`/border in `var(--bsg-accent)` rendered **dashed**, low-alpha accent fill (`--bsg-selectable`), optional low-amplitude breathe. (Dashed vs solid is a non-color cue — bonus for A11Y-05.)
- **selected:** solid `var(--bsg-accent)` ring + a subtle fill (`color-mix accent ~26%`) + a small scale; consumes `--bsg-selected`/`--bsg-ring`.
- **drop target:** dotted `var(--bsg-accent-2)` + diagonal-stripe fill (`--bsg-droptarget`).
- **Always `outline`, never `border`** for the selection ring so it never reflows layout — fixes the `HandRenderer.vue` outlier (it uses `border`; the other five use `outline`). Apply uniformly to all 8 renderers + hex `<g>`.
- Remove every colored glow `box-shadow` (`PieceRenderer.vue:242`, `CardRenderer.vue:429`, `DeckRenderer.vue:192`, `HandRenderer.vue:408`, etc.) → neutral `var(--bsg-shadow-sm)`/`--bsg-elevation` + optional `--bsg-ring`.
- (Full keyboard operability + `aria-*` is Phase 101 — here just the visual tokens + the non-color shape cues. Don't build the `useSelectable` composable yet.)

### Primary action button + type (THEME-03, THEME-04)
- Primary action button → Slate teal plate: `background: var(--bsg-accent)`, `color: var(--bsg-accent-ink)`, `box-shadow: var(--bsg-shadow-sm)`, **no glow**; hover lifts subtly. (`ActionPanel.vue` ~1103-1118.)
- Body text → `var(--bsg-font)`; titles/headings (`h1`/`.logo-text`/`.config-title`/deck+zone headings) → display font with a faint `text-shadow`. **Delete the two gradient clip-text blocks** (`GameHeader.vue:115-120`, `HamburgerMenu.vue:230-233`) — solid color, no `background-clip:text`.

### Card back + active-player cue (THEME-05, THEME-06)
- One shared `--bsg-card-back` class (register the token in `theme.ts`) consumed by both `CardRenderer.vue` (~547) and `HandRenderer.vue` (~554). Slate value: a neutral graphite gradient (e.g. `linear-gradient(180deg, var(--bsg-surface-2), var(--bsg-bg-2))`) with a thin `1px solid var(--bsg-line-2)` rule — NOT the corporate-blue gradient, NOT the tavern oxblood (this is Slate). Exact gradient is executor discretion within Slate tokens.
- Active-player cue (`PlayersPanel.vue` ~101-119, 72-75): a calm `var(--bsg-accent)` dot with an **opacity-only** breathe (low amplitude) and a `var(--bsg-accent)` token border on the active card. Delete the scaling neon halo / `pulse-glow` keyframes. Guard the breathe with `@media (prefers-reduced-motion: reduce)` (the global reduced-motion block is Phase 101, but this specific animation should be motion-safe now).

### Surfaces + platform transparency (THEME-07, THEME-08)
- Panels/zone surfaces → `var(--bsg-surface)` + `var(--bsg-line)`/`--bsg-line-2` hairlines, replacing `rgba(0,0,0,x)` glass and `rgba(255,255,255,.1)` white borders across `GameHeader`, `GameShell` sidebar/action-bar, `GameHistory`, `PlayersPanel`, renderer zone cards. Every `color:#fff` → `var(--bsg-ink)`.
- **Backdrops:** in **platform mode**, the two hardcoded background gradients (`GameShell.vue:1443`, `HamburgerMenu.vue:193`) become `background: transparent` so the host shows through; in **dev/standalone** mode they fall back to `var(--bsg-bg)`. Use the existing `platformMode` flag to branch.
- **DevHost** (`DevHost.vue`): replace the indigo/neon literals (~353-359, 517, 413, 505-508, 542-550, 493-497) with Slate tokens; demote the emerald "New game" to a quiet outline (the two-click confirm itself is Phase 102).

### Scope guardrails
- This is a **mechanical-but-broad** sweep, not a layout change. Do NOT change IA/layout (no header removal, no turn ribbon, no fluid sizing — Phase 100), do NOT build the keyboard composable (Phase 101), do NOT touch host files.
- Keep tests green (969 after Phase 98). Where a test asserts an old neon literal, update it to the token/Slate expectation.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- All `--bsg-*` tokens (color/space/type/shadow/radius/seat/interaction/motion, dark+light) already exist from Phase 98 — this phase only *references* them. If a needed token is missing (e.g. `--bsg-card-back`), add it to `theme.ts`, not inline.
- `platformMode` flag already exists in `GameShell` to branch platform vs dev/standalone.
- The `.stylelintrc.cjs` `ignoreFiles` list (18 files) from Phase 98 is the worklist — empty it as you sweep.

### Established Patterns
- 8 renderers: `HandRenderer`, `CardRenderer`, `DeckRenderer`, `PieceRenderer`, `GridBoardRenderer`, `HexBoardRenderer`, plus the others under `src/ui/auto-ui/renderers` (confirm the full set). Five use `outline` for selection, `HandRenderer` uses `border` — unify on `outline`.
- CLAUDE.md: No Backward Compatibility (delete neon, don't shim), no fallbacks, Pit of Success, "All UI interactions must work in a Custom UI and Action Panel in parity."

### Integration Points
- Chrome files: `GameShell.vue`, `GameHeader.vue`, `HamburgerMenu.vue`, `ActionPanel.vue`, `PlayersPanel.vue`, `GameHistory.vue`. Dev: `DevHost.vue`. Renderers: the 8 + hex `<g>`.

</code_context>

<specifics>
## Specific Ideas

Design source of truth: `planning/boardsmith-ui-redesign-spec.md` Wave 2 (lines ~1278-1295) for the deliverable list + file anchors, and `planning/mockups/boardsmith-chrome.html` for the exact Slate interaction-state look (dashed selectable / solid selected / dotted drop, teal accent, graphite surfaces). Ignore the spec body's "tavern/oxblood/candle" color words — this is Slate.

</specifics>

<deferred>
## Deferred Ideas

- Keyboard operability, `aria-*`, the `useSelectable` composable, the global `prefers-reduced-motion` block, focus-visible ring → Phase 101 (Wave 4).
- IA/layout (header removal, turn ribbon, fluid board sizing, Game Over card, sidebar collapse) → Phase 100 (Wave 3).
- DevHost two-click "New game" confirm, DebugPanel reskin, dev chrome collapse → Phase 102 (Wave 5).
- Host lobby PrimeVue preset + GameFrame theme handshake → HOST-01/02 (future host milestone).

</deferred>
