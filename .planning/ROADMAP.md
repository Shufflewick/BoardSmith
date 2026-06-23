# Roadmap — v4.0 UI Redesign (Slate)

**Milestone:** v4.0 UI Redesign (Slate)
**Goal:** Rebuild the BoardSmith game chrome from the adversarial UI/UX audit — replace the hardcoded neon-noir chrome with a single load-bearing `--bsg-*` token system in the neutral **"Slate"** design language (graphite palette, single teal accent, Hanken Grotesk + JetBrains Mono, OS light/dark), get the chrome out of the board's way, and close the critical accessibility gaps — without breaking a single existing game.
**Requirements source:** `.planning/REQUIREMENTS.md`
**Design source of truth:** `planning/boardsmith-ui-redesign-spec.md` Part II — Prioritized Roadmap (six dependency-ordered waves) + canonical mockup `planning/mockups/boardsmith-chrome.html` (the chosen "Slate" direction). The spec body is written in "warm tavern" terms; the go-forward override (2026-06-22) keeps every structural/behavioral value but swaps the warm color values for the **neutral Slate** ones. The game chrome stays generic/game-agnostic; tavern theming belongs to the ShufflewickPub host (out of scope), applied via the token override.
**Phase numbering:** Continues from v3.1 (Phases 91–96). This milestone: **Phases 97–103.**
**Scope:** this repo only — game-shell chrome + 8 board renderers + `theme.ts` + dev-server chrome (DevHost/DebugPanel). The ShufflewickPub host skin is out of scope (see Future Requirements HOST-01..04); BoardSmith-side token/`applyTheme`/postMessage infra stays host-overridable.

---

## Phases

The seven phases map 1:1 to the spec's six waves plus a final cross-repo verification gate.

- [x] **Phase 97: Quick Wins (Wave 0)** — Independent accessibility/mobile/branding fixes that need no token system; ships first to bank credibility and de-risk later waves. (completed 2026-06-23)
- [x] **Phase 98: Token Foundation (Wave 1)** — The keystone: collapse three namespaces into one `--bsg-*` contract emitted by `theme.ts` with full Slate defaults + a `color-no-hex` lint guard. Blocks Waves 2/3/5. (completed 2026-06-23)
- [x] **Phase 99: Theming Swap (Wave 2)** — Spend the tokens: sweep 8 renderers + chrome + DevHost from neon literals to `var(--bsg-*)`, teal primary button, `outline` selection, solid type, tokenized card back, calm active-player cue. (completed 2026-06-23)
- [x] **Phase 100: IA & Responsive (Wave 3)** — Board is the hero: kill the standing header, persistent turn ribbon + always-on prompt, conditional action dock, fluid container-query board sizing, real breakpoints, Game Over result card. (completed 2026-06-23)
- [ ] **Phase 101: Accessibility — WCAG 2.2 AA (Wave 4)** — The two CRITICAL findings: keyboard-operable board via shared `useSelectable()`, live regions, semantic names/state, non-color cues, focus-visible, dialog semantics, reduced-motion, contrast + target sweep.
- [ ] **Phase 102: Material Polish & Dev/Debug Parity (Wave 5)** — Slate DebugPanel, dev chrome collapse + seat switcher + presence strip + "Table setup" panel, voiced states, read-only history, destructive-action confirm, Slate material layer.
- [ ] **Phase 103: Cross-Repo Verification** — Gate: all 9 `~/BoardSmithGames/` games + MERC (the canary) build, pass tests, and play in the browser with the new Slate chrome; BoardSmith's own suite stays green with new cross-boundary integration tests.

---

## Phase Details

### Phase 97: Quick Wins (Wave 0)
**Goal**: The isolated, no-token-dependency wins land first — rejected moves become visible, icon-only controls are named, dead branding is gone, and the mobile shell stops clipping under toolbars and notches.
**Depends on**: Nothing (independent; ships anytime, in parallel with later waves)
**Requirements**: QUICK-01, QUICK-02, QUICK-03, QUICK-04, QUICK-05
**Success Criteria** (what must be TRUE):
  1. A rejected move or failed action surfaces a visible `toast.error(result.error)` — the `alert()` calls and silent `console.error` swallows are gone (QUICK-01).
  2. An accessibility inspector announces the hamburger and every ✕ close/cancel/clear control by name, with `aria-expanded`/`aria-controls` on the hamburger, and decorative glyph spans are `aria-hidden` (QUICK-02).
  3. The player-facing chrome shows no dead Settings/Help menu items and no engine branding (`BS` chip, "BoardSmith Dev Mode") (QUICK-03).
  4. On a mobile viewport the sticky action bar stays fully visible (shell uses `100dvh` with a `100vh` fallback) and no fixed/sticky chrome edge falls under the notch/home indicator (`env(safe-area-inset-*)` respected) (QUICK-04, QUICK-05).
**Plans**: 1 plan
  - [x] 97-01-PLAN.md — All five quick wins (toast error feedback, accessible names, dead-weight removal, 100dvh, safe-area insets) + component tests
**UI hint**: yes

---

### Phase 98: Token Foundation (Wave 1)
**Goal**: A single `--bsg-*` token contract emitted by `theme.ts` becomes the sole source of truth for color, spacing, type, radius, shadow, and motion — defaulting to the Slate palette, following OS light/dark, host-overridable via `applyTheme()`, and guarded by a `color-no-hex` lint so the wrong path fails CI. This is the keystone every later visual wave consumes.
**Depends on**: Nothing (but blocks Phases 99, 100, 102)
**Requirements**: TOKEN-01, TOKEN-02, TOKEN-03, TOKEN-04, TOKEN-05, TOKEN-06
**Success Criteria** (what must be TRUE):
  1. Grepping chrome/renderer sources finds exactly one token namespace — `--bsg-*`; the `--bs-*`, `--bg-*`, `--text-*`, and `--border-*` namespaces no longer exist (TOKEN-01).
  2. `theme.ts` emits the full Slate token set — graphite `--bsg-bg`, layered surfaces, ink ramp, single teal accent + accent-2, a muted seat palette, a 4px spacing scale, the Hanken Grotesk + JetBrains Mono type scale, radius, and shadow tokens — and is no longer color-only; the dead light-blue defaults are deleted (TOKEN-02, TOKEN-03).
  3. The chrome follows OS light/dark by default, with a complete Slate light token set in addition to the dark set (TOKEN-04).
  4. `applyTheme()` is the sole theming knob: a host-supplied token override passed at iframe init re-skins the chrome without touching component code (TOKEN-05).
  5. A stylelint `color-no-hex` rule scoped to chrome/renderer `.vue` files fails CI when a raw hex literal is introduced (TOKEN-06).
**Plans**: 4 plans (2 waves)
  - [x] 98-01-PLAN.md — Rewrite theme.ts as the Slate `--bsg-*` token engine (dark default + OS-following light + applyTheme sole knob + seat/interaction/motion tokens)
  - [x] 98-02-PLAN.md — Add `color-no-hex` stylelint guard + `lint:css` script with a documented temporary ignore list (Phase 99 empties it)
  - [x] 98-03-PLAN.md — Collapse the `--bs-*` namespace into `--bsg-*` across drag-drop.css + 5 renderers; HexBoardRenderer seats via `--bsg-seat-*` tokens
  - [x] 98-04-PLAN.md — Collapse `--bg-*/--text-*/--border-*` in ActionPanel/WaitingRoom; wire GameShell `applyTheme` base-install + init theme-override receiver
**UI hint**: yes
**Risk note**: This is highest-risk item #1. Flipping `theme.ts` defaults (TOKEN-02) exposes a latent collision — the renderers assume a *dark* ground while the old default was light. The token-default flip must merge **atomically with the Phase 99 renderer sweep** so `main` is never in the half-swapped state where white ink sits on a near-white page (the invisible-text trap). Treat Phases 98 + 99 as one atomic landing.

---

### Phase 99: Theming Swap (Wave 2)
**Goal**: The tokens get spent — every neon literal across the 8 renderers, the chrome, and DevHost becomes `var(--bsg-*)`, and the product visibly shifts to Slate: teal primary button, `outline`-not-`border` selection, solid type, a shared tokenized card back, a calm active-player cue, and surfaces that let the host show through in platform mode.
**Depends on**: Phase 98 (consumes the token contract; lands atomically with Phase 98's default flip)
**Requirements**: THEME-01, THEME-02, THEME-03, THEME-04, THEME-05, THEME-06, THEME-07, THEME-08
**Success Criteria** (what must be TRUE):
  1. No `#00d9ff`/`#00ff88`/`rgba(46,204,113…)` literals and no colored glow box-shadows remain in any of the 8 renderers or the hex `<g>`; interaction state resolves from `var(--bsg-selectable|selected|droptarget)` (THEME-01).
  2. Selection highlight uses `outline` (never `border`) in every renderer, so highlighting never reflows layout (THEME-02).
  3. The primary action button is the Slate teal plate (token fill, dark-ink label, neutral elevation, no glow), and titles render as solid display-font type with a faint shadow — the gradient clip-text blocks are deleted (THEME-03, THEME-04).
  4. Both card renderers consume one shared `--bsg-card-back` class (no corporate-blue gradient), and the active-player cue is a calm accent dot with an opacity-only breathe and a token border (no scaling neon halo / `pulse-glow`) (THEME-05, THEME-06).
  5. Panels and zone surfaces use `var(--bsg-surface)` + `var(--bsg-line)`/`--bsg-line-2` hairlines (no translucent-black glass / white hairlines), backdrops go transparent in platform mode so the host shows through, and `DevHost` is recolored from indigo/neon literals to Slate tokens (THEME-07, THEME-08).
**Plans**: 15 plans (4 waves)
  - [x] 99-01-PLAN.md — [W1] Add the two new tokens (`--bsg-card-back`, `--bsg-display`) to theme.ts + test-lock them
  - [x] 99-02-PLAN.md — [W2] Sweep CardRenderer + HandRenderer (shared card back, glow→neutral, HandRenderer border→outline fix)
  - [x] 99-03-PLAN.md — [W2] Sweep DeckRenderer + DieRenderer + PieceRenderer (interaction tokens, no glow)
  - [x] 99-04-PLAN.md — [W2] Sweep GridBoard + HexBoard (hex `<g>`) + Space renderers; confirm ElementRenderer clean
  - [x] 99-05-PLAN.md — [W2] GameShell + HamburgerMenu (platform-transparent backdrops, surfaces, Hamburger clip-text delete)
  - [x] 99-06-PLAN.md — [W2] GameHeader clip-text delete + solid title; PlayersPanel calm active-player cue (no pulse-glow)
  - [x] 99-07-PLAN.md — [W2] ActionPanel: Slate teal primary button + tokenize the action dock
  - [x] 99-08-PLAN.md — [W2] GameHistory + GameLobby surface sweep
  - [x] 99-09-PLAN.md — [W2] helpers/Button + FlyingCardsOverlay + ZoomPreviewOverlay
  - [x] 99-10-PLAN.md — [W2] Toast + DoneButton + AutoRenderer + AutoUI + UnsupportedTopologyPanel (small literals)
  - [x] 99-11-PLAN.md — [W2] WaitingRoom full color sweep (75 hex)
  - [x] 99-12-PLAN.md — [W2] DebugPanel color-only tokenization (155 hex; no reskin — Phase 102)
  - [x] 99-13-PLAN.md — [W2] DevHost Slate recolor + demote emerald "New game" to quiet outline
  - [x] 99-14-PLAN.md — [W3] Both-theme WCAG contrast test + atomic-pairing source guard (correctness rule #2)
  - [x] 99-15-PLAN.md — [W4] Completion gate: empty `ignoreFiles`, `lint:css` green, residual-neon grep, suite green (rule #3)
**UI hint**: yes
**Risk note**: Highest-risk item #1 (atomic token flip) is shared with Phase 98 — the `theme.ts` default flip (TOKEN-02) and this renderer sweep (THEME-01/07) must land in the **same merge** to avoid the invisible-text trap. Three baked-in correctness rules: (1) every per-component sweep tokenizes background AND ink in the same edit; (2) a dedicated both-theme contrast test (99-14); (3) the phase is done only when `ignoreFiles` is empty + `lint:css` green + residual-neon grep clean (99-15).

---

### Phase 100: IA & Responsive (Wave 3)
**Goal**: The chrome gets out of the board's way — no standing header in platform mode, a turn ribbon and prompt that never disappear, an action dock that appears only when actionable, and a board that fits its container by construction (fluid container-query sizing, not a zoom slider) across real responsive tiers, ending on a proper Game Over result card.
**Depends on**: Phase 98 (tokens for spacing/sizing); soft-couples with Phase 99
**Requirements**: IA-01, IA-02, IA-03, IA-04, IA-05, IA-06, IA-07
**Success Criteria** (what must be TRUE):
  1. In platform mode no standing BoardSmith header renders; connection status collapses to a corner dot driven by a real heartbeat (IA-01).
  2. A persistent turn ribbon always shows whose turn it is and the active prompt (`boardPrompt ?? currentPick.prompt`) at every breakpoint; when all picks are board-anchored the prompt stays visible and only the action buttons are suppressed — the player is never left with a silent board (IA-02, IA-03).
  3. The action dock renders only when the player has an action, caps at `min(40vh, 320px)` with internal scroll, and reserves its measured height via `ResizeObserver` instead of a hardcoded `80px` padding (IA-04).
  4. The board fits its container with no scrollbars or manual zoom via `container-type: size` and a computed `--cell`/`--card-w` clamp (the zoom slider survives only as an accessibility magnifier), and the layout reflows across real compact/medium/wide tiers — phone fills the board with a one-line seat strip and history as an on-demand sheet, desktop sidebar collapses to a rail (IA-05, IA-06).
  5. Game Over shows a result card (winner/scores, final board behind a scrim, Rematch / New Game actions) instead of a dead-end banner (IA-07).
**Plans**: 6 plans (4 waves)
  - [x] 100-01-PLAN.md — [W1] Structural shell rebuild (.stage/sidebar/boardregion + full-width actionbar) + persistent prompt + conditional dock + ResizeObserver dock-height (IA-02/03/04)
  - [x] 100-02-PLAN.md — [W1] Fluid board sizing: Grid + Hex renderers + grid archetype container-query --cell clamp (IA-05)
  - [x] 100-03-PLAN.md — [W1] Fluid card sizing: Card/Hand/Deck shared --card-w clamp + DevHost 100dvh (IA-05)
  - [x] 100-04-PLAN.md — [W2] Platform header removal + ⋯ ControlsMenu + heartbeat corner dot + bridge preservation + showUndo deletion (IA-01)
  - [x] 100-05-PLAN.md — [W3] Responsive tiers (640/768/1024/1440) + sidebar rail + phone overlay/scrim + PlayersPanel token/seat-strip + history bottom sheet (IA-06)
  - [x] 100-06-PLAN.md — [W4] Game Over result card (validated winnerSeats, scrim over live board, Rematch/New Game) + AutoUI banner removal (IA-07)
**UI hint**: yes
**Risk note**: Carries highest-risk items #3 and #4. Fluid board sizing replaces fixed cells (e.g. `50px`) and can regress published game bundles — validated against MERC + real games in Phase 103. The standing-header removal + Leave/New-Game relocation changes the host↔iframe postMessage contract — test the bridge end-to-end (the host side itself stays out of scope, but the BoardSmith-emitted contract must remain host-overridable).

---

### Phase 101: Accessibility — WCAG 2.2 AA (Wave 4)
**Goal**: Close the accessibility gaps, including the milestone's only **Critical** findings — make the board fully keyboard-operable through one shared composable, announce state changes via live regions, expose semantic names/state, pair every color with a non-color cue, restore focus rings, give dialogs real semantics, honor reduced-motion, and meet contrast + touch-target floors.
**Depends on**: Phase 98 (focus-ring token); benefits from Phase 100's IA but is independently shippable
**Requirements**: A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06, A11Y-07, A11Y-08, A11Y-09, A11Y-10
**Success Criteria** (what must be TRUE):
  1. The board is fully keyboard-operable: a shared `useSelectable()` composable binds `@click` + `@keydown.enter/space` to the same selection with a roving-tabindex grid (arrow/Home/End nav) across all 8 renderers — Tab focuses a cell, Enter/Space selects it (A11Y-01, Critical).
  2. When picks are board-anchored the action panel still exposes those choices in a focusable secondary list and never fully suppresses while picks are pending (A11Y-02, Critical).
  3. Turn changes, errors, disconnects, and game-over are announced via a polite live region (assertive for errors), `GameHistory` is `role="log" aria-live="polite"`, and every board element exposes a semantic `aria-label` + `aria-selected`/`-disabled`/`-current` (derived from the same booleans driving CSS) with grids/hands/hex carrying appropriate roles (A11Y-03, A11Y-04).
  4. Every interaction state is paired with a non-color cue (shape/icon/border-style + label) and is colorblind-safe with a legend, and a visible `:focus-visible` ring is present on every interactive element (the two `outline:none` declarations removed) (A11Y-05, A11Y-06).
  5. The hamburger drawer and the Game Over overlay are `role="dialog" aria-modal` with focus move/trap, Escape-to-close, and focus restore; `prefers-reduced-motion: reduce` disables every pulse/slide/toast; muted text routes through `--bsg-ink-muted` to meet AA contrast and every interactive chrome element meets a ≥44px target floor; toasts are `role="status"`/assertive with a real `<button aria-label="Dismiss">` and an auto-timeout (A11Y-07, A11Y-08, A11Y-09, A11Y-10).
**Plans**: 11 plans
  - [x] 101-01-PLAN.md — Foundations: useSelectable + useFocusTrap composables (+ tests) and the --bsg-warn contrast fix (Wave 1)
  - [x] 101-02-PLAN.md — Migrate CardRenderer/PieceRenderer/DeckRenderer to useSelectable + ARIA (Wave 2)
  - [x] 101-03-PLAN.md — Migrate HandRenderer/SpaceRenderer/DieRenderer to useSelectable + ARIA (Wave 2)
  - [x] 101-04-PLAN.md — Migrate GridBoardRenderer + HexBoardRenderer to useSelectableGrid roving tabindex (Wave 2)
  - [x] 101-05-PLAN.md — Shell-global a11y: live regions, focus ring, reduced-motion, skip link/h1, footer parity, accessible Toast (Wave 2)
  - [x] 101-06-PLAN.md — Action-panel keyboard parity: splitAnchoredChoices + secondary focusable list (Wave 2)
  - [x] 101-07-PLAN.md — BoardLegend + shape-based seat identity + aria-current + reduced-motion border (Wave 2)
  - [x] 101-08-PLAN.md — Dialog semantics + focus trap for HamburgerMenu/ControlsMenu/GameOverCard (Wave 2)
  - [x] 101-09-PLAN.md — Dev-chrome a11y floor: names/focus/target-size for DebugPanel + DevHost (Wave 2)
  - [x] 101-10-PLAN.md — Renderer disabled-hatch + reduced-motion pulse guards across 8 renderers (Wave 3)
  - [ ] 101-11-PLAN.md — Divergence grep-guard + drag-still-works regression test (Wave 3)
**UI hint**: yes
**Risk note**: Highest-risk item #2 — the board keyboard/semantics rework is architectural across all 8 renderers. Centralize it in the one shared `useSelectable()` composable so divergence is impossible, and regression-test that drag still works as progressive enhancement.

---

### Phase 102: Material Polish & Dev/Debug Parity (Wave 5)
**Goal**: Bring the dev/debug surfaces up to the same Slate standard and restore the dev's god-mode capability — a reskinned DebugPanel, a collapsible dev bar with a working seat switcher, presence strip, and "Table setup" panel, voiced loading/empty/error states, read-only player history, a destructive-action confirm, and the Slate material layer.
**Depends on**: Phases 98–99 (tokens + theming)
**Requirements**: DEV-01, DEV-02, DEV-03, DEV-04, DEV-05, DEV-06, DEV-07, DEV-08
**Success Criteria** (what must be TRUE):
  1. `DebugPanel` is reskinned in Slate; its toggle is a real `<button aria-expanded>`, the bare `D` shortcut is gated behind a modifier + contenteditable guard, and it uses the ARIA tabs pattern (DEV-01).
  2. The dev-server chrome collapses to a slim pull-tab (default-collapsed once seated, persisted in localStorage) with icon-only controls + a `…` overflow below 640px (DEV-02).
  3. The dev seat badge is a working seat switcher, a presence strip shows who is connected / AI / away, and a tucked-away "Table setup" panel surfaces the already-injected `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions` (DEV-03, DEV-04).
  4. Loading/empty/error states have a clear voice — a skeleton with timeout→retry and a friendly unsupported-topology message split from dev-only guidance — and player-facing history is read-only with Copy/Clear moved into `DebugPanel` (the silent un-clear bug is gone) (DEV-05, DEV-06).
  5. The dev "New game" action (broadcasts `restart` to all seats) requires a two-click confirm with neutral styling and a broadcast toast, and the Slate material layer (low-opacity SVG noise + vignette) replaces the white dot-grid grain in dev/standalone chrome (DEV-07, DEV-08).
**Plans**: TBD
**UI hint**: yes

---

### Phase 103: Cross-Repo Verification
**Goal**: Prove the redesign broke nothing — every game in `~/BoardSmithGames/` and the MERC canary build, pass tests, and play in the browser with the new Slate chrome, and BoardSmith's own suite stays green with new integration tests guarding the cross-layer boundaries the redesign touched. This phase gates milestone completion.
**Depends on**: Phases 97–102 (the full redesign must be landed before cross-repo verification is meaningful)
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Success Criteria** (what must be TRUE):
  1. All 9 games in `~/BoardSmithGames/` (hex, checkers, cribbage, go-fish, polyhedral-potions, floss-bitties, demo-action-panel, demo-animation, demo-complex-ui) re-vendor the redesigned BoardSmith, build, and pass their test suites (VERIFY-01).
  2. All 9 games render and are playable in the browser with the new Slate chrome — board fits, two-step + drag interaction works, no console errors (VERIFY-02).
  3. MERC (`~/Dropbox/MERC/BoardSmith/MERC`, vendored BoardSmith) re-vendors the new BoardSmith, builds, passes its test suite, and plays in the browser — the cross-repo canary (VERIFY-03).
  4. BoardSmith's own unit/integration suite stays green, with at least one new integration test per cross-layer boundary the redesign touches: token→render, keyboard→select, and the postMessage theme handshake (VERIFY-04).
**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 97. Quick Wins (Wave 0) | 1/1 | Complete   | 2026-06-23 |
| 98. Token Foundation (Wave 1) | 4/4 | Complete   | 2026-06-23 |
| 99. Theming Swap (Wave 2) | 15/15 | Complete   | 2026-06-23 |
| 100. IA & Responsive (Wave 3) | 6/6 | Complete   | 2026-06-23 |
| 101. Accessibility — WCAG 2.2 AA (Wave 4) | 10/11 | In Progress|  |
| 102. Material Polish & Dev/Debug Parity (Wave 5) | 0/? | Not started | - |
| 103. Cross-Repo Verification | 0/? | Not started | - |

---

## Dependency Graph

```
Phase 97 (quick wins) ───────────────────► ship anytime, independent
Phase 98 (tokens) ──┬─► Phase 99 (theming swap) ──┐
                    ├─► Phase 102 (material/dev) ◄─┤
                    └─► Phase 100 (IA/responsive) ─┴─► Phase 101 (a11y)
                                                       (focus token from 98;
                                                        benefits from 100 IA)
Phases 97–102 ──────────────────────────────────────► Phase 103 (verify, gates milestone)
```

**Critical path:** Phase 98 → Phases 99/100 → Phase 101. Phase 97 runs in parallel from day one. Phase 103 is last and gates milestone completion (MERC is the canary).

**Phases 98 + 99 land atomically** — the token-default flip and the renderer sweep must merge together (invisible-text trap).

---

## Highest-Risk Items (stage carefully, explicit sign-off)

1. **`theme.ts` default flip (Phases 98+99)** — must merge atomically with the renderer sweep, or `main` lands white ink on a near-white page (invisible-text trap).
2. **Board keyboard/semantics composable (Phase 101)** — architectural across all 8 renderers; centralize in one `useSelectable()` so divergence is impossible; drag becomes progressive enhancement.
3. **Fluid board sizing (Phase 100)** — replacing fixed cells + the zoom-as-fit strategy can regress published game bundles; validate against MERC + real games in Phase 103.
4. **Standing-header removal + action relocation (Phase 100)** — changes the host↔iframe postMessage contract; the BoardSmith-emitted side must stay host-overridable and be tested end-to-end.

---

## Coverage

**Total v4.0 requirements:** 48
**Mapped:** 48/48 ✓ — every v1 requirement maps to exactly one phase; no orphans, no duplicates.

| Requirement | Phase |
|-------------|-------|
| QUICK-01 | 97 |
| QUICK-02 | 97 |
| QUICK-03 | 97 |
| QUICK-04 | 97 |
| QUICK-05 | 97 |
| TOKEN-01 | 98 |
| TOKEN-02 | 98 |
| TOKEN-03 | 98 |
| TOKEN-04 | 98 |
| TOKEN-05 | 98 |
| TOKEN-06 | 98 |
| THEME-01 | 99 |
| THEME-02 | 99 |
| THEME-03 | 99 |
| THEME-04 | 99 |
| THEME-05 | 99 |
| THEME-06 | 99 |
| THEME-07 | 99 |
| THEME-08 | 99 |
| IA-01 | 100 |
| IA-02 | 100 |
| IA-03 | 100 |
| IA-04 | 100 |
| IA-05 | 100 |
| IA-06 | 100 |
| IA-07 | 100 |
| A11Y-01 | 101 |
| A11Y-02 | 101 |
| A11Y-03 | 101 |
| A11Y-04 | 101 |
| A11Y-05 | 101 |
| A11Y-06 | 101 |
| A11Y-07 | 101 |
| A11Y-08 | 101 |
| A11Y-09 | 101 |
| A11Y-10 | 101 |
| DEV-01 | 102 |
| DEV-02 | 102 |
| DEV-03 | 102 |
| DEV-04 | 102 |
| DEV-05 | 102 |
| DEV-06 | 102 |
| DEV-07 | 102 |
| DEV-08 | 102 |
| VERIFY-01 | 103 |
| VERIFY-02 | 103 |
| VERIFY-03 | 103 |
| VERIFY-04 | 103 |

---

## Cross-cutting Constraints

- **Scope is this repo only** — the BoardSmith game-shell chrome + 8 renderers + `theme.ts` + dev-server chrome. The ShufflewickPub host skin (lobby, `GameFrame.vue`, `[sessionId].vue`, PrimeVue preset, connection banner) is out of scope (HOST-01..04, future milestone). The BoardSmith-side token/`applyTheme`/postMessage infra must remain host-overridable so host work can land later.
- **Neutral Slate, not warm tavern** — the game chrome stays generic/game-agnostic; tavern theming is the host's job, applied via the token override.
- **No backward compatibility** — clean break; no fallbacks for old token namespaces or neon literals.
- **No engine changes** — the redesign lives entirely in the UI/theme/dev-chrome layer; the headless engine/AI/test/replay paths are never touched.
