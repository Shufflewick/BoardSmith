# Phase 100: IA & Responsive (Wave 3) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-accept from spec (v4.0 autonomous run; structure pinned to the canonical mockup)

<domain>
## Phase Boundary

Get the chrome out of the board's way. No standing header in platform mode; persistent turn status + prompt that never disappear; an action dock that appears only when actionable; a board that **fits its container by construction** (container-query sizing, not a zoom slider) across real responsive tiers; a proper Game Over result card. Requirements: IA-01..07.

**In scope (this repo):** `GameShell.vue`, `GameHeader.vue`, `ActionPanel.vue`, `AutoUI.vue`/`AutoRenderer.vue`, all 8 renderers + archetype templates, `PlayersPanel.vue`, `GameHistory.vue`, `HamburgerMenu.vue`, `DevHost.vue` (dev layout only).
**Out of scope (host repo):** `[sessionId].vue`, `GameFrame.vue`, host `main.css`, the host nav-shade, the host "Reconnecting" banner, the "Back to Tavern" host exit. Touch none.

</domain>

<decisions>
## Implementation Decisions

### ⚠️ STRUCTURE = THE CANONICAL MOCKUP, not the spec body's "turn ribbon"
**READ `planning/mockups/boardsmith-chrome.html` and match its structure.** The go-forward Slate design (authoritative over the spec body) has **NO top bar**. The realized structure is:
- `.stage` = **sidebar + board** side by side; the **full-width `.actionbar` sits below**, spanning both.
- `.side-head` (top of sidebar) holds the **Shufflewick host button (`.sw-btn`) + a `⋯` controls menu**, ABOVE the `.players` panel.
- `.players` panel is a **dynamic per-player status bar** (each player's icon = color + letter-holding shape, per-player connection icon, the active player highlighted) — this is where "whose turn it is" lives.
- Sidebar collapses to a slim **rail** (`--bsg-rail:64px`) via `.side-edge`; expanded width is `--bsg-side:286px`.
- Board is the hero: `.board` with **~zero chrome padding**, `container-type:size`, cell sized by a `--c`/`--cell` clamp.
- `.actionbar` is **full-width**, grows vertically (one line → caps ~5 rows → vertical scroll, never horizontal).

### Reconciling IA-02 "persistent turn ribbon" → Slate (IMPORTANT)
There is no separate top ribbon. Satisfy IA-02/IA-03 with **two always-correct surfaces**:
1. **Turn status** ("whose turn") lives in the `.players` panel (desktop/tablet) and in the **one-line seat strip** (phone). The active player's icon + a natural status sentence (e.g. "Alice is playing…", and for the local player an affirmative like "Your move"). Sourced from the already-computed `currentPlayerName`/`isMyTurn`/`currentPlayerColor`. This is visible at **every** breakpoint.
2. **The prompt** ("what to do") lives in the full-width `.actionbar`, sourced from **`boardPrompt ?? actionController.currentPick.prompt`** (a single prompt source of truth — this finally renders the wired-but-unused `setBoardPrompt`, `GameShell.vue:472`). The actionbar renders whenever `isMyTurn` (see IA-04), and **when every remaining pick is board-anchored it shows just the prompt line with the buttons suppressed** — never a blank/silent board (IA-03; change the `v-if` at `GameShell.vue:1382` so the prompt survives, only buttons are gated by `allChoicesAnchored`).

### IA-01 — no standing header in platform mode
- Gate `<GameHeader>` behind `v-if="!platformMode"` (`GameShell.vue:1286`). In dev/standalone the header (or its successor controls) still renders.
- Connection status → a small **corner dot** driven by a real heartbeat (replace the hardcoded `'connected'` badge, `GameShell.vue:1289`, with a postMessage heartbeat the BoardSmith side maintains; the host send-side is HOST-03/out of scope, but the receiver + dot are in scope).
- **Leave / New Game must stay reachable in platform mode** — relocate them into the `.side-head` `⋯` controls menu (per mockup), and KEEP emitting the existing `handleMenuItemClick` postMessage bridge so a future host can also wire them. Do not strand these controls.
- The header-center engineering controls (zoom slider, Auto toggle, Undo-visibility) move into the `⋯` menu / settings overflow; **delete the `showUndo` toggle**; **demote the zoom slider to an accessibility magnifier** (it is no longer the fit strategy — IA-05). (Full settings a11y is Phase 101.)

### IA-04 — action dock only when actionable
- Dock `v-if` requires `isMyTurn || awaitingPlayerNames.length` (it no longer renders just to say "it is X's turn" — that's the players panel now).
- `max-height: min(40dvh, 320px)` + `overflow-y:auto`. Board reserves the dock's **measured** height via a `ResizeObserver`-set CSS var (e.g. `--bsg-dock-h`), replacing the hardcoded `padding-bottom:80px` (`GameShell.vue:1496`) and removing the double-count from the sticky footer.
- `padding-bottom: max(var(--bsg-s3), env(safe-area-inset-bottom))`.

### IA-05 — fluid board sizing (retire the zoom-as-fit crutch)  ⚠️ regression risk
- Add `container-type: size` to the board archetypes. Compute `--cell` from `gridResult.cols/rows`: `clamp(28px, min(calc(100cqw/var(--cols)), calc(100cqh/var(--rows))), 96px)` (match the mockup's `--c`). Replace the fixed `50px`/`20px` (`GridBoardRenderer.vue:288,249`) and give `HexBoardRenderer` fit-to-container (replace `max-height:80vh; overflow:hidden`). Hands: `--card-w: clamp(44px, 14cqw, 84px)`, controlled shrink, ≥44px exposed tap zone, `max-height: clamp(96px, 22vh, 180px)` (`HandRenderer.vue:551`, `GridBoardTemplate.vue:128`).
- **Regression note:** fixed-cell assumptions can regress published game bundles. This phase only changes the **auto-UI renderers/archetypes** (a game's own custom UI is its code). Phase 103 validates all 9 games + MERC against this — the plan should call out which renderers changed so 103 knows what to re-check.
- Zoom survives ONLY as an a11y magnifier (pinch / Ctrl-scroll), never the default fit.

### IA-06 — real responsive tiers
- Replace the lone 768px snap with **compact / medium / wide** tiers using the shared scale (`640 / 768 / 1024 / 1440`). Sidebar `clamp(220px, 22vw, 320px)`, collapsible to the `--bsg-rail` rail; centered `max-width` board stage at ≥1440.
- **Phone (compact):** board fills the viewport; `.players` collapses to a **one-line seat strip**; History becomes an **on-demand bottom sheet** (drop the standing `max-height:40vh` aside, `GameShell.vue:1517`). The seat strip carries the turn status (see IA-02 reconciliation).
- Add an `@media (orientation: landscape) and (max-height: 600px)` branch that switches to the row layout instead of crushing the board.
- Use `100dvh` (already from Phase 97) + safe-area insets; prefer `@container` over `@media` for renderer/template reflow where practical (the board lives inside the host iframe, so shell width — not viewport — is what matters).

### IA-07 — Game Over result card
- Replace the `AutoUI.vue:37-42` "Game Over!" banner with a result component fed by `flowState` winners/scores: final board visible behind a **Slate scrim** (`rgba(18,20,23,.66)` dark / a light-mode equivalent), with **Rematch / New Game** as primary Slate buttons. ("Back to Tavern"/host exit is host-side — omit; provide an in-repo New Game/Rematch only.)
- Dialog semantics / focus-trap for this overlay are Phase 101 — here, build the visual result card + actions.

### Scope guardrails
- Do NOT do Phase 101 (keyboard/aria/useSelectable/focus-trap/global reduced-motion) or Phase 102 (DebugPanel, dev collapse, seat switcher, confirm dialog). Keep visuals on the Phase 99 Slate tokens — no new neon, `lint:css` stays green (empty ignore list).
- Keep tests green (1002 after Phase 99). Layout changes will need test updates; add tests for the new behaviors (prompt-always-visible, dock-only-when-actionable, fluid `--cell` computed, Game Over result card).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Already computed and available: `currentPlayerName`, `isMyTurn`, `currentPlayerColor`, `boardPrompt` (via `setBoardPrompt`, currently rendered nowhere), `actionController.currentPick.prompt`, `flowState` winners/scores, `awaitingPlayerNames`, `platformMode`, `allChoicesAnchored`/`suppressActionPanel`.
- Layout tokens `--bsg-rail:64px`, `--bsg-side:286px`, the spacing scale, and breakpoint-friendly tokens exist from Phase 98.
- The mockup `planning/mockups/boardsmith-chrome.html` is a complete, working static reference for the exact DOM structure + CSS (stage/sidebar/side-head/board/actionbar/rail/legend). Mirror it.

### Established Patterns
- `GameHistory` already has a collapse pattern to reuse for the sidebar rail + the phone history sheet.
- CLAUDE.md: "All UI interactions must work in a Custom UI and Action Panel in parity with shared state through `useBoardInteraction`" — the prompt/dock/turn-status changes must preserve that parity. Pit of Success; no fixed-pixel escape hatches left behind.

### Integration Points
- Host↔iframe postMessage bridge (`handleMenuItemClick`, the init theme handshake from Phase 98, the new connection heartbeat). Changing the standing header changes this contract — keep the bridge emitting; only the host's *consumption* is deferred.

</code_context>

<specifics>
## Specific Ideas

Design sources: `planning/mockups/boardsmith-chrome.html` (STRUCTURE — authoritative), `planning/boardsmith-ui-redesign-spec.md` "Information Architecture & Responsive Layout" (§1-7, lines ~309-489) and Wave 3 (lines ~1299-1316) for the deliverable list, file anchors, and the per-device ASCII wireframes. Where the spec body says a top "turn ribbon," realize it per the mockup (player-panel status + full-width actionbar prompt) — see the IA-02 reconciliation above.

</specifics>

<deferred>
## Deferred Ideas

- Keyboard operability, `aria-*`, focus-trap on the Game Over + ⋯ menu, global `prefers-reduced-motion`, focus-visible, the settings-panel a11y for the demoted zoom → Phase 101 (Wave 4).
- DebugPanel reskin, dev chrome collapse-to-tab, seat switcher, "Table setup" panel, New-Game two-click confirm → Phase 102 (Wave 5).
- Host nav-shade wiring of Leave/New-Game, host "Reconnecting" banner, "Back to Tavern" exit, host pull-tab → HOST-03/04 (future host milestone).
- Cross-repo validation that fluid sizing didn't regress games → Phase 103.

</deferred>
