# Requirements: BoardSmith — v4.0 UI Redesign (Slate)

**Defined:** 2026-06-22
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

**Design source of truth:** `planning/boardsmith-ui-redesign-spec.md` (6-wave audit roadmap) + canonical mockup `planning/mockups/boardsmith-chrome.html` (the chosen neutral **"Slate"** direction). The spec body is written in "warm tavern" terms; the go-forward override (2026-06-22) keeps every structural/behavioral value but uses the **neutral Slate** color values. The game chrome stays generic/game-agnostic; tavern theming belongs to the ShufflewickPub host (out of scope), applied via the token override.

**Scope:** this repo only — game-shell chrome + 8 board renderers + `theme.ts` + dev-server chrome (DevHost/DebugPanel). The ShufflewickPub host skin (separate repo) is out of scope, but the BoardSmith-side token/`applyTheme`/postMessage infrastructure must stay host-overridable.

## v1 Requirements

Requirements for the v4.0 milestone. Each maps to exactly one roadmap phase (see Traceability).

### Quick Wins (Wave 0 — no token dependency)

- [x] **QUICK-01**: Rejected moves and action failures surface a visible `toast.error(result.error)` instead of being swallowed to `console.error`/`alert()`
- [x] **QUICK-02**: Icon-only chrome controls (hamburger, ✕ close/cancel/clear) have accessible names plus `aria-expanded`/`aria-controls`, and decorative glyph spans are `aria-hidden`
- [x] **QUICK-03**: Dead menu items (no-op Settings/Help) and engine branding (`BS` chip, "BoardSmith Dev Mode") are removed from player-facing chrome
- [x] **QUICK-04**: The shell uses `100dvh` (with `100vh` fallback) so the sticky action bar never clips under mobile browser toolbars
- [x] **QUICK-05**: Every fixed/sticky chrome edge respects `env(safe-area-inset-*)` so controls never fall under the notch/home indicator

### Token Foundation (Wave 1 — the keystone)

- [x] **TOKEN-01**: All chrome and renderer color, spacing, type, radius, shadow, and motion values resolve from a single `--bsg-*` namespace — the `--bs-*` and `--bg-*`/`--text-*`/`--border-*` namespaces are collapsed into it
- [x] **TOKEN-02**: `theme.ts` default tokens are the Slate palette (graphite `--bsg-bg`, layered surfaces, ink ramp, single teal accent + accent-2, muted seat palette, interaction tokens) — the dead light-blue defaults are deleted
- [x] **TOKEN-03**: `theme.ts` emits spacing (4px scale), type (Hanken Grotesk + JetBrains Mono + size scale), radius, shadow, and seat tokens — it is no longer color-only
- [x] **TOKEN-04**: The chrome follows OS light/dark by default, with a complete Slate light token set in addition to dark
- [x] **TOKEN-05**: `applyTheme()` is the sole theming knob and accepts a host-supplied token override at iframe init (the host can re-skin the chrome without touching component code)
- [x] **TOKEN-06**: A stylelint `color-no-hex` rule scoped to chrome/renderer `.vue` files fails CI when a raw hex literal is introduced

### Visual Theming Swap (Wave 2 — make it Slate)

- [x] **THEME-01**: All 8 renderers + hex `<g>` express interaction state via `var(--bsg-selectable|selected|droptarget)` — no `#00d9ff`/`#00ff88`/`rgba(46,204,113…)` literals and no colored glow box-shadows remain
- [x] **THEME-02**: Selection highlight uses `outline` (never `border`) across every renderer, so highlighting never reflows layout
- [x] **THEME-03**: The primary action button is the Slate teal plate (token fill, dark-ink label, neutral elevation, no glow)
- [x] **THEME-04**: Titles render as solid type in the display font with a faint shadow — the gradient clip-text blocks are deleted
- [x] **THEME-05**: The default card back is one shared tokenized `--bsg-card-back` class consumed by both card renderers (no corporate-blue gradient)
- [x] **THEME-06**: The active-player cue is calm — accent dot with an opacity-only breathe and a token border, replacing the scaling neon halo/`pulse-glow`
- [x] **THEME-07**: Panels and zone surfaces use `var(--bsg-surface)` + `var(--bsg-edge)` hairlines, replacing translucent-black glass and white hairlines; backdrops go transparent in platform mode so the host shows through
- [x] **THEME-08**: `DevHost` is recolored to Slate — the indigo/neon literals are replaced with tokens

### Information Architecture & Responsive (Wave 3 — board is the hero)

- [x] **IA-01**: In platform mode no standing BoardSmith header renders; connection status collapses to a corner dot driven by a real heartbeat
- [x] **IA-02**: A persistent turn ribbon always shows whose turn it is and the active prompt (`boardPrompt ?? currentPick.prompt`) at every breakpoint
- [x] **IA-03**: When all picks are board-anchored, the prompt stays visible and only the action buttons are suppressed — the player is never left with a silent board
- [x] **IA-04**: The action dock renders only when the player has an action; it caps at `min(40vh, 320px)` with internal scroll and reserves its measured height via `ResizeObserver` (no hardcoded `80px` padding)
- [x] **IA-05**: The board fits its container with no scrollbars or manual zoom via `container-type: size` and a computed `--cell`/`--card-w` clamp; the zoom slider survives only as an accessibility magnifier
- [x] **IA-06**: Layout reflows across real compact/medium/wide tiers — phone fills the board and collapses players to a one-line seat strip with history as an on-demand sheet; desktop sidebar collapses to a rail
- [x] **IA-07**: Game Over shows a result card (winner/scores, final board behind a scrim, Rematch / New Game actions) instead of a dead-end banner

### Accessibility — WCAG 2.2 AA (Wave 4)

- [x] **A11Y-01**: The board is fully keyboard-operable — a shared `useSelectable()` composable binds `@click` + `@keydown.enter/space` to the same selection with a roving-tabindex grid (arrow/Home/End nav) across all 8 renderers (Critical)
- [x] **A11Y-02**: When picks are board-anchored, the action panel still exposes those choices in a focusable secondary list and never fully suppresses while picks are pending (Critical)
- [ ] **A11Y-03**: Turn changes, errors, disconnects, and game-over are announced via a polite live region (assertive for errors); `GameHistory` becomes `role="log" aria-live="polite"`
- [ ] **A11Y-04**: Every board element exposes a semantic `aria-label` and `aria-selected`/`-disabled`/`-current` derived from the same booleans driving CSS; grids/hands/hex carry appropriate roles
- [ ] **A11Y-05**: Every interaction state is paired with a non-color cue (shape/icon/border-style + label) and is colorblind-safe, with a legend
- [ ] **A11Y-06**: A visible `:focus-visible` ring is present on every interactive element; the two `outline:none` declarations are removed
- [x] **A11Y-07**: The hamburger drawer and the Game Over overlay are `role="dialog" aria-modal` with focus move/trap, Escape-to-close, and focus restore on close
- [x] **A11Y-08**: Every pulse/slide/toast animation is wrapped so `prefers-reduced-motion: reduce` disables it (the infinite turn-dot pulse becomes a static high-contrast border)
- [x] **A11Y-09**: Muted text routes through `--bsg-ink-muted` to meet AA contrast, and every interactive chrome element meets a ≥44px target floor
- [ ] **A11Y-10**: Toasts are `role="status"`/assertive with a real `<button aria-label="Dismiss">` and an auto-timeout

### Dev & Debug Parity + Material Polish (Wave 5)

- [x] **DEV-01**: `DebugPanel` is reskinned in Slate; its toggle is a real `<button aria-expanded>`, the bare `D` shortcut is gated behind a modifier + contenteditable guard, and it uses the ARIA tabs pattern
- [x] **DEV-02**: The dev-server chrome collapses to a slim pull-tab (default-collapsed once seated, persisted in localStorage), with icon-only controls + a `…` overflow below 640px
- [x] **DEV-03**: The dev seat badge becomes a working seat switcher, and a presence strip shows who is connected / AI / away
- [x] **DEV-04**: A tucked-away "Table setup" panel surfaces the already-injected `aiSeats`/`aiLevel`/`playerCount`/`gameOptions`/`playerOptions`
- [x] **DEV-05**: Loading/empty/error states have a clear voice — a skeleton with timeout→retry, and a friendly unsupported-topology message split from dev-only guidance
- [x] **DEV-06**: Player-facing history is read-only; Copy/Clear move into `DebugPanel` (the silent un-clear bug is gone)
- [x] **DEV-07**: The dev "New game" action (broadcasts `restart` to all seats) requires a two-click confirm with neutral styling and a broadcast toast
- [x] **DEV-08**: The Slate material layer (low-opacity SVG noise + vignette) replaces the white dot-grid grain in dev/standalone chrome

### Cross-Repo Verification

- [ ] **VERIFY-01**: All 9 games in `~/BoardSmithGames/` (hex, checkers, cribbage, go-fish, polyhedral-potions, floss-bitties, demo-action-panel, demo-animation, demo-complex-ui) build and pass their test suites after the redesign
- [ ] **VERIFY-02**: All 9 games render and are playable in the browser with the new Slate chrome — board fits, two-step + drag interaction works, no console errors
- [ ] **VERIFY-03**: MERC (`~/Dropbox/MERC/BoardSmith/MERC`, vendored BoardSmith) re-vendors the new BoardSmith, builds, passes its test suite, and plays in the browser (the cross-repo canary)
- [ ] **VERIFY-04**: BoardSmith's own unit/integration suite stays green, with at least one new integration test per cross-layer boundary the redesign touches (token→render, keyboard→select, postMessage theme handshake)

## Future Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

### ShufflewickPub Host Skin (separate repo)

- **HOST-01**: PrimeVue `definePreset(Lara, …)` tavern preset so lobby `surface-*`/`bg-primary` utilities inherit the host palette
- **HOST-02**: Host-side theme handshake — forward `theme` + token map into the iframe init postMessage; tavern lobby + overlays
- **HOST-03**: Host connection health — `connectionState` + non-blocking "Reconnecting…" banner with backoff, iframe kept mounted
- **HOST-04**: Host Game Over exit / "Back to Shufflewick" + host pull-tab affordance (chevron, peek bounce, off dead-center)

### Engine / Layout

- **LAYOUT-01**: General percentage-relative layout solver — still deferred until a real game's topology can't be templated (v3.1 decision stands)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Warm "tavern" color values for the game chrome | Overridden to neutral Slate (2026-06-22); the chrome must be generic/game-agnostic. Tavern theming is the host's job, applied via the token override |
| ShufflewickPub host skin code (lobby, `GameFrame.vue`, `[sessionId].vue`, Lara preset, connection banner) | Separate repo; out of scope this milestone. BoardSmith-side token/`applyTheme`/postMessage infra stays host-overridable so host work can land later |
| Backward compatibility / fallbacks for old token namespaces or neon literals | Clean break — No Backward Compatibility hard rule |
| Engine model additions (spatial adjacency graph, free-form positioning, z-order) | Rules-layer decision, not needed for the redesign |
| i18n of author-facing strings | Named gap for a future milestone |
| New live N-UI dev-switcher features | Shipped in v3.1; further work deferred |

## Traceability

Which phases cover which requirements. Phase numbering continues from v3.1's last phase 96; this milestone is Phases 97–103 (six waves + a cross-repo verification gate).

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUICK-01 | 97 (Wave 0 — Quick Wins) | Complete |
| QUICK-02 | 97 (Wave 0 — Quick Wins) | Complete |
| QUICK-03 | 97 (Wave 0 — Quick Wins) | Complete |
| QUICK-04 | 97 (Wave 0 — Quick Wins) | Complete |
| QUICK-05 | 97 (Wave 0 — Quick Wins) | Complete |
| TOKEN-01 | 98 (Wave 1 — Token Foundation) | Complete |
| TOKEN-02 | 98 (Wave 1 — Token Foundation) | Complete |
| TOKEN-03 | 98 (Wave 1 — Token Foundation) | Complete |
| TOKEN-04 | 98 (Wave 1 — Token Foundation) | Complete |
| TOKEN-05 | 98 (Wave 1 — Token Foundation) | Complete |
| TOKEN-06 | 98 (Wave 1 — Token Foundation) | Complete |
| THEME-01 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-02 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-03 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-04 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-05 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-06 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-07 | 99 (Wave 2 — Theming Swap) | Complete |
| THEME-08 | 99 (Wave 2 — Theming Swap) | Complete |
| IA-01 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-02 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-03 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-04 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-05 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-06 | 100 (Wave 3 — IA & Responsive) | Complete |
| IA-07 | 100 (Wave 3 — IA & Responsive) | Complete |
| A11Y-01 | 101 (Wave 4 — Accessibility) | Complete |
| A11Y-02 | 101 (Wave 4 — Accessibility) | Complete |
| A11Y-03 | 101 (Wave 4 — Accessibility) | Pending |
| A11Y-04 | 101 (Wave 4 — Accessibility) | Pending |
| A11Y-05 | 101 (Wave 4 — Accessibility) | Pending |
| A11Y-06 | 101 (Wave 4 — Accessibility) | Pending |
| A11Y-07 | 101 (Wave 4 — Accessibility) | Complete |
| A11Y-08 | 101 (Wave 4 — Accessibility) | Complete |
| A11Y-09 | 101 (Wave 4 — Accessibility) | Complete |
| A11Y-10 | 101 (Wave 4 — Accessibility) | Pending |
| DEV-01 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-02 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-03 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-04 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-05 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-06 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-07 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| DEV-08 | 102 (Wave 5 — Material Polish & Dev/Debug Parity) | Complete |
| VERIFY-01 | 103 (Cross-Repo Verification) | Pending |
| VERIFY-02 | 103 (Cross-Repo Verification) | Pending |
| VERIFY-03 | 103 (Cross-Repo Verification) | Pending |
| VERIFY-04 | 103 (Cross-Repo Verification) | Pending |

**Coverage:**
- v1 requirements: 48 total
- Mapped to phases: 48 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-23 — traceability filled during v4.0 roadmap creation (Phases 97–103, 48/48 mapped)*
