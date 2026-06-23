# Phase 100: IA & Responsive (Wave 3) — Research

**Researched:** 2026-06-23
**Domain:** Vue 3 SFC layout restructure, CSS container queries, responsive tiers, postMessage bridge
**Confidence:** HIGH — all findings verified against actual source files

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Structure = The Canonical Mockup.**
Read `planning/mockups/boardsmith-chrome.html` and match its structure exactly. The go-forward Slate design has NO top bar. The realized structure is:
- `.stage` = sidebar + board side-by-side; full-width `.actionbar` sits below, spanning both
- `.side-head` (top of sidebar) holds the Shufflewick host button (`.sw-btn`) + `⋯` controls menu, ABOVE the `.players` panel
- `.players` panel = dynamic per-player status bar (icon = color + letter-holding shape, per-player connection icon, active player highlighted)
- Sidebar collapses to slim rail (`--bsg-rail:64px`) via `.side-edge`; expanded width = `--bsg-side:286px`
- Board is the hero: `.board` with ~zero chrome padding, `container-type:size`, cell sized by a `--c`/`--cell` clamp
- `.actionbar` = full-width, grows vertically (one line, caps ~5 rows, vertical scroll, never horizontal)

**IA-01:** Gate `<GameHeader>` behind `v-if="!platformMode"`. Connection status → corner dot via postMessage heartbeat (receiver in scope; host sender is HOST-03/out of scope). Leave/New Game relocate into `.side-head` `⋯` controls menu. Header-center controls (zoom slider, Auto toggle, Undo-visibility) move into `⋯` menu. Delete `showUndo` toggle. Demote zoom slider to a11y magnifier.

**IA-02/IA-03:** No separate top ribbon. "Whose turn" lives in `.players` panel (desktop/tablet) and one-line seat strip (phone). The prompt lives in the full-width `.actionbar` sourced from `boardPrompt ?? actionController.currentPick.prompt`. Actionbar `v-if` gate = `isMyTurn || awaitingPlayerNames.length` — prompt line always visible when active, buttons suppressed when `allChoicesAnchored`.

**IA-04:** Dock `v-if` requires `isMyTurn || awaitingPlayerNames.length`. `max-height: min(40dvh, 320px)` + `overflow-y:auto`. Board reserves dock's measured height via `ResizeObserver`-set CSS var `--bsg-dock-h`. Remove hardcoded `padding-bottom:80px`. `padding-bottom: max(var(--bsg-s3), env(safe-area-inset-bottom))`.

**IA-05:** Add `container-type: size` to board archetypes. Compute `--cell` from cols/rows: `clamp(28px, min(calc(100cqw/var(--cols)), calc(100cqh/var(--rows))), 96px)`. Replace fixed `50px`/`20px` in GridBoardRenderer and `max-height:80vh;overflow:hidden` in HexBoardRenderer. Hands: `--card-w: clamp(44px, 14cqw, 84px)`. Zoom survives only as a11y magnifier.

**IA-06:** Replace the lone `768px` snap with compact/medium/wide tiers (640/768/1024/1440). Sidebar `clamp(220px, 22vw, 320px)`, collapsible to `--bsg-rail`. Phone: board fills viewport; `.players` collapses to one-line seat strip; History becomes on-demand bottom sheet. Add `@media (orientation: landscape) and (max-height: 600px)` branch.

**IA-07:** Replace AutoUI.vue Game Over banner with a result component fed by flowState `complete` + winner seats: final board behind Slate scrim (`rgba(18,20,23,.66)` dark / light-mode equivalent), with Rematch / New Game as primary Slate buttons.

### Claude's Discretion
None specified — structure is pinned to mockup.

### Deferred Ideas (OUT OF SCOPE)
- Keyboard operability, aria-*, focus-trap, global prefers-reduced-motion → Phase 101
- DebugPanel reskin, dev chrome collapse-to-tab, seat switcher, confirm dialog → Phase 102
- Host nav-shade wiring of Leave/New-Game, host "Reconnecting" banner, "Back to Tavern" exit, host pull-tab → HOST-03/04
- Cross-repo validation that fluid sizing didn't regress games → Phase 103
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IA-01 | No standing header in platform mode; connection collapses to corner dot | `platformMode` ref at line 138; `<GameHeader>` rendered unconditionally at line 1328; hardcoded `'connected'` string at line 1331; `showUndo` ref at line 215; the full `GameHeader.vue` is to be gated/deleted in platform mode |
| IA-02 | Persistent turn ribbon always shows whose turn + active prompt at every breakpoint | `currentPlayerName` (line 444), `isMyTurn` (line 242/79 in client/vue.ts), `currentPlayerColor` (line 471), `boardPrompt` ref (line 485), `actionController.currentPick.prompt` (useActionController line 62/103) all computed and available — none currently rendered in a persistent location |
| IA-03 | When all picks board-anchored, prompt stays visible; only buttons suppressed | `allCurrentChoicesAnchored` (useActionController line 674) = `validElements.value.length > 0`; current `footer v-if` at line 1424 suppresses the entire footer when anchored; need to preserve prompt line while gating buttons |
| IA-04 | Action dock only when actionable; capped height; ResizeObserver-measured; no hardcoded 80px | `padding-bottom: 80px` at GameShell.vue line 1542 (`.game-shell__content`); `.game-shell--platform .game-shell__content` at line 1503 adds `padding-bottom: 60px`; `ResizeObserver` not currently used anywhere in `src/ui/` |
| IA-05 | Board fits container via container-query sizing; retire zoom-as-fit | No `container-type` / `@container` / `cqw` / `cqh` anywhere in `src/ui/`; GridBoardRenderer cells fixed 50px×50px (lines 249, 289–290); column/corner labels fixed 20px (lines 249–250, 261, 277); HexBoardRenderer has `max-height: 80vh; overflow: hidden` (lines 256–257); HandRenderer/CardRenderer/DeckRenderer use fixed 60px×84px card dimensions |
| IA-06 | Real responsive tiers (640/768/1024/1440); phone collapses sidebar to seat strip + history to bottom sheet | Current sole breakpoint: `@media (min-width: 768px)` at GameShell.vue line 1575; sidebar `max-height: 40vh` on mobile at line 1571 (the "standing aside" to drop); sidebar `width: 280px` at line 1586 (desktop, to be replaced with `clamp(220px, 22vw, 320px)`) |
| IA-07 | Game Over result card with winner/scores, scrim, Rematch/New Game | AutoUI.vue lines 37–42: bare `<div class="game-complete"><h2>Game Over!</h2>` banner; `flowState?.complete` is the gate; winner seats NOT currently in `state.value` — only in top-level `game_state` postMessage (`data.winners: number[]`) which is currently discarded by GameShell handler at line 670 |
</phase_requirements>

---

## Summary

Phase 100 is a structural rebuild of `GameShell.vue` from a column-stack (header → content → footer) to the Slate side-by-side layout (sidebar + board inside `.stage`, with a full-width `.actionbar` below). All design decisions are fully pinned to the canonical mockup at `planning/mockups/boardsmith-chrome.html`.

The current layout uses a single `@media (min-width: 768px)` breakpoint and a hardcoded `padding-bottom: 80px` spacer for the sticky footer. The standing `<GameHeader>` always renders and the connection badge is hardcoded to `'connected'` in platform mode. No `container-type`/`@container` CSS exists anywhere in `src/ui/`. The zoom slider is the primary fit strategy. The Game Over surface is a minimal `<div>` in AutoUI.vue with no winner data.

Every computed value the new layout needs (`currentPlayerName`, `isMyTurn`, `currentPlayerColor`, `boardPrompt`, `currentPick.prompt`, `allCurrentChoicesAnchored`, `awaitingPlayerNames`, `platformMode`, `flowState.complete`) is already computed in GameShell.vue — the work is wiring them to the new template structure. The one missing piece is `winnerSeats`: currently the `winners: number[]` from the `game_state` postMessage is discarded at GameShell.vue line 670; a new `winnerSeats` ref is required.

**Primary recommendation:** Follow the mockup's DOM structure exactly. Start by restructuring the GameShell template (the new `.app > .stage > (sidebar | boardregion) + .actionbar` shape), then update CSS, then address each renderer/archetype for fluid sizing, then build the Game Over card.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Layout chrome (header gate, sidebar, actionbar) | Frontend (GameShell.vue) | — | Shell owns all chrome; board content is slotted in |
| Turn status display ("whose turn") | Frontend (PlayersPanel.vue → GameShell slot) | — | Sourced from `currentPlayerName`/`isMyTurn` already in GameShell |
| Persistent prompt | Frontend (new actionbar `.turn` strip) | ActionPanel composable | Prompt from `boardPrompt ?? currentPick.prompt`; gate on `isMyTurn \|\| awaitingPlayerNames.length` |
| Action buttons (dock) | Frontend (ActionPanel.vue) | — | Existing component; v-if gate changes |
| Board fluid sizing | Frontend (GridBoardRenderer, HexBoardRenderer, archetypes) | CSS container queries | No server change; pure CSS/template edit |
| Responsive tiers | Frontend (GameShell.vue CSS) | — | CSS-only; tokens from theme.ts already present |
| Game Over result card | Frontend (new GameOverCard.vue) | — | `flowState.complete` is the gate; winner seats need new capture |
| Connection heartbeat dot (IA-01) | Frontend (GameShell.vue receiver) | Host (HOST-03, out of scope) | Receiver dot in scope; host sender deferred |
| postMessage bridge (leave/new-game) | Frontend (GameShell.vue `handleMenuItemClick`) | — | Bridge contract preserved; UI relocation only |

---

## Standard Stack

### No New Dependencies

This phase is entirely CSS/Vue template restructuring. No new npm packages are needed or permitted (CLAUDE.md: "Don't add dependencies without discussing"). All required tools exist:

| Tool | Purpose | Status |
|------|---------|--------|
| Vue 3 `v-if`, `ref`, `computed` | Conditional rendering and reactivity | Already used throughout |
| CSS `container-type: size` | Container queries for fluid board sizing | Browser-native, no polyfill needed for modern targets |
| `ResizeObserver` | Measure dock height to set `--bsg-dock-h` | Browser-native, no polyfill needed |
| `env(safe-area-inset-bottom)` | Safe-area padding | Already used in GameShell.vue lines 1607, 1617 |
| `100dvh` | Full viewport height | Already used in GameShell.vue lines 1484, 1494, 1528 |

**Installation:** None required.

---

## Package Legitimacy Audit

Not applicable — this phase installs no external packages.

---

## Architecture Patterns

### Target DOM Structure (from mockup)

The canonical mockup defines this exact HTML structure. The Vue template must mirror it:

```
.app  (flex-direction: column; height: 100dvh)
  .stage  (flex: 1; display: flex; position: relative)
    aside.sidebar  (flex: none; width: var(--bsg-side); ← collapses to --bsg-rail)
      .side-head   (Shufflewick btn + ⋯ menubtn)
      .side-scroll (players, log/history)
    main.boardregion  (flex: 1; container-type: size; padding: var(--bsg-s1))
      [board renderer content]
      .legend  (absolute overlay, hide on mobile)
    .scrim  (absolute; z-index:45; phone-only, when sidebar expanded over board)
  .actionbar  (flex: none; full-width; grows vertically)
    .turn  (active player icon + prompt sentence)
    [action buttons / DoneButton / Undo]
```

The `.actionbar` is OUTSIDE `.stage`, spanning the full width. On mobile the sidebar overlays the board area (inside `.stage`) when expanded — it never covers the actionbar because `.actionbar` is a sibling of `.stage`, not a child.

### Recommended Project Structure

No new directories needed. New file is one Game Over component:

```
src/ui/components/
├── GameShell.vue           (major restructure)
├── GameHeader.vue          (gated by !platformMode; controls migrated to ⋯ menu)
├── PlayersPanel.vue        (extend: add shape+letter token, one-line seat strip)
├── GameHistory.vue         (extend: add bottom-sheet mode for phone)
├── HamburgerMenu.vue       (repurpose as ⋯ controls menu / rename to ControlsMenu.vue)
├── GameOverCard.vue        (NEW — replaces AutoUI.vue Game Over banner)
└── auto-ui/
    ├── AutoUI.vue          (remove game-complete banner; show board while overlay renders)
    ├── renderers/
    │   ├── GridBoardRenderer.vue  (replace fixed 50px cells with --cell clamp)
    │   └── HexBoardRenderer.vue   (replace max-height:80vh with container-query sizing)
    └── archetypes/
        └── GridBoardTemplate.vue  (add container-type:size; pass --cols/--rows for --cell)
```

### Pattern 1: Sidebar + Board (`.stage`) + Full-Width Actionbar

The key layout inversion: the actionbar is a sibling of `.stage`, not a child of the content column.

```css
/* Source: planning/mockups/boardsmith-chrome.html */
.app { display: flex; flex-direction: column; height: 100dvh; }
.stage { flex: 1; min-height: 0; display: flex; position: relative; }
.actionbar {
  flex: none;
  background: var(--bsg-surface);
  border-top: 1px solid var(--bsg-line);
  padding: 9px var(--bsg-s4);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  max-height: calc(5 * 46px + 40px); overflow-y: auto;
}
```

### Pattern 2: Fluid Board Sizing via Container Queries

```css
/* Source: planning/mockups/boardsmith-chrome.html */
.boardregion {
  flex: 1; min-width: 0;
  padding: var(--bsg-s1);
  container-type: size;  /* NEW: enables cqw/cqh units inside */
}

/* In GridBoardRenderer: replace width/height:50px with: */
.grid-cell {
  --cols: 8;  /* set via :style binding from gridResult.cols */
  --rows: 8;  /* set via :style binding from gridResult.rows */
  --cell: clamp(28px, min(calc(100cqw / var(--cols)), calc(100cqh / var(--rows))), 96px);
  width: var(--cell);
  height: var(--cell);
}
```

**Important:** `container-type: size` must be on an ANCESTOR of the cells. The container is `.boardregion` (already the board's containing block). The `cqw`/`cqh` units resolve against `.boardregion`'s size, not the viewport.

### Pattern 3: ResizeObserver for Dock Height Reservation

```typescript
// Source: [ASSUMED] — standard browser API pattern
// In GameShell.vue setup():
const actionbarRef = ref<HTMLElement | null>(null);
let dockObserver: ResizeObserver | null = null;

onMounted(() => {
  dockObserver = new ResizeObserver((entries) => {
    const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? 0;
    document.documentElement.style.setProperty('--bsg-dock-h', `${h}px`);
  });
  if (actionbarRef.value) dockObserver.observe(actionbarRef.value);
});
onUnmounted(() => dockObserver?.disconnect());
```

The `.boardregion` then uses `padding-bottom: var(--bsg-dock-h, 0px)` instead of the hardcoded `80px`.

### Pattern 4: Sidebar Rail Collapse

```css
/* Source: planning/mockups/boardsmith-chrome.html */
.sidebar {
  flex: none; width: var(--bsg-side);
  transition: width var(--bsg-dur-base) cubic-bezier(.4,0,.2,1);
}
/* Rail mode (class on .app or .sidebar itself): */
.sidebar--rail { width: var(--bsg-rail); }
/* In rail mode, hide text labels; show only player icon tokens */
.sidebar--rail .prow,
.sidebar--rail .side-scroll-label { display: none; }
```

### Pattern 5: Phone — Sidebar as Overlay Inside `.stage`

```css
/* Source: planning/mockups/boardsmith-chrome.html */
@media (max-width: 639px) {
  /* Default: rail mode on phone (board fills viewport) */
  /* When expanded: sidebar overlays BOARD ONLY (absolute within .stage) */
  .sidebar:not(.sidebar--rail) {
    position: absolute; top: 0; left: 0; bottom: 0;
    z-index: 50;
    width: min(86vw, var(--bsg-side));
    box-shadow: var(--bsg-shadow);
  }
}
```

### Pattern 6: Game Over Card with Scrim

```vue
<!-- Source: planning/mockups/boardsmith-chrome.html design intent -->
<!-- GameOverCard.vue — overlays the boardregion, not the full app -->
<div v-if="flowState?.complete" class="game-over-scrim">
  <div class="game-over-card" role="dialog" aria-labelledby="game-over-title">
    <h2 id="game-over-title">Game Over</h2>
    <div class="winners">...</div>
    <div class="game-over-actions">
      <button class="btn-primary" @click="emit('new-game')">New Game</button>
      <button class="btn-ghost" @click="emit('rematch')">Rematch</button>
    </div>
  </div>
</div>
```

```css
/* Scrim: positioned inside boardregion (not fixed to viewport) */
.game-over-scrim {
  position: absolute; inset: 0; z-index: 30;
  background: rgba(18, 20, 23, .66); /* dark; light-mode: rgba(243,242,239,.75) */
  display: grid; place-items: center;
}
```

Note: `role="dialog"` and focus-trap are Phase 101; include role but skip aria-modal/focus-trap here.

### Anti-Patterns to Avoid

- **Standing header in platform mode:** The current `<GameHeader>` at line 1328 renders unconditionally. After this phase it must be `v-if="!platformMode"`.
- **Hardcoded `padding-bottom: 80px`:** At line 1542. Remove entirely; use `--bsg-dock-h` from ResizeObserver.
- **`max-height: 40vh` sidebar on mobile:** At line 1571. Replace with phone-collapses-to-rail pattern.
- **Fixed `width: 280px` sidebar:** At line 1586 (desktop media). Replace with `clamp(220px, 22vw, 320px)`.
- **`height: 100vh`** in DevHost.vue line 356: Replace with `100dvh` (Phase 97 pattern).
- **Horizontal scroll in actionbar:** The mockup uses `flex-wrap: wrap` + `overflow-y: auto`, never horizontal scroll.
- **Using `viewport` units for board cells:** Board is in an iframe; use `cqw`/`cqh` (container queries) not `vw`/`vh`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dock height measurement | Poll-based interval | `ResizeObserver` | Browser-native; zero overhead; fires synchronously after layout |
| Fluid cell sizing math | JavaScript `getBoundingClientRect` loop | CSS `container-type:size` + `clamp()` | Computed at paint time; no JS overhead; no flicker |
| Sidebar width transition | JS-driven width animation | CSS `transition: width var(--bsg-dur-base)` | Declarative; respects `prefers-reduced-motion` (Phase 101) |
| "Is rail mode?" state | Derive from layout | Boolean `ref<boolean>(sidebarRail)` + CSS class | Simpler than watching DOM; Vue-reactive |
| Phone scrim click-to-close | Custom touch handler | `@click="sidebarRail = true"` on `.scrim` | DOM click event is sufficient |

**Key insight:** Container queries (no JS needed for board sizing) are the central primitive that replaces the zoom-slider fit strategy. All sizing becomes declarative CSS.

---

## Runtime State Inventory

Not applicable — this is a layout/visual phase with no rename, migration, or data-layer change. Skipped per protocol.

---

## Common Pitfalls

### Pitfall 1: `container-type: size` Requires Explicit Height on Ancestor

**What goes wrong:** `100cqh` resolves to 0 if the container has no explicit height (height:auto).
**Why it happens:** `container-type: size` requires the container to have a definite block size. Without it, `cqh` units are undefined/0.
**How to avoid:** The boardregion must have `flex: 1; min-height: 0` (or `height: 100%`) from a flex parent that itself has a definite height (`100dvh`). The chain `.app (100dvh) → .stage (flex:1;min-height:0) → .boardregion (flex:1;min-height:0)` satisfies this.
**Warning signs:** Board cells render at 0px height; `cqh` computes as 0.

### Pitfall 2: `min-height: 0` Required on Flex Children

**What goes wrong:** Overflow content pushes through the board, making it scroll instead of fit.
**Why it happens:** Flex children have `min-height: auto` by default, which prevents them from shrinking below content size.
**How to avoid:** Add `min-height: 0` to `.stage`, `.sidebar`, `.boardregion`, and the game content wrapper.
**Warning signs:** Board overflows its container; viewport scrolls.

### Pitfall 3: Fixed-Pixel Assumptions in GridBoardRenderer Column Labels

**What goes wrong:** After cells become fluid, the column-label `width: 50px` (lines 249, 289) no longer aligns with cells.
**Why it happens:** Labels were sized to match the hard-coded 50px cell width.
**How to avoid:** Change `.board-label { width: var(--cell); }` and `.board-label.corner { width: var(--cell); }` — same token as cells.
**Warning signs:** Column letter labels are misaligned from board cells.

### Pitfall 4: `lint:css` — No Hex Literals in `.vue` Files

**What goes wrong:** Adding the scrim color `rgba(18,20,23,.66)` directly into a `.vue` `<style>` block fails CI.
**Why it happens:** `.stylelintrc.cjs` has `color-no-hex: true` with `ignoreFiles: []` (zero exclusions). However `rgba()` notation is not a hex literal — it is fine. The DANGER is if anyone copy-pastes the mockup's hex values like `#121417` directly.
**How to avoid:** Use only token names (`var(--bsg-bg)`) or `rgba()`/`color-mix()` in `.vue` files. The mockup's hex values are reference only; map them to existing tokens or `rgba()`.
**Warning signs:** `npm run lint:css` exits non-zero.

### Pitfall 5: Actionbar `v-if` Must Preserve Prompt, Not Just Gate Buttons

**What goes wrong:** Removing the outer `footer v-if` and forgetting to gate buttons separately leaves buttons visible when `allChoicesAnchored`.
**Why it happens:** The current v-if gates the ENTIRE footer (line 1424). The new structure must gate the WHOLE dock on `isMyTurn || awaitingPlayerNames.length`, and within the dock, gate the action buttons separately on `!allCurrentChoicesAnchored`.
**How to avoid:** The `.turn` strip (prompt + player icon) is always shown when the dock is visible. The action buttons have their own inner `v-if="!actionController.allCurrentChoicesAnchored.value"`.

### Pitfall 6: `winners` Not Captured in `state.value`

**What goes wrong:** Building a Game Over card that tries to read winners from `state.value.flowState.winners` — that field does not exist.
**Why it happens:** The `game_state` postMessage handler at GameShell.vue line 670 only extracts `view.flowState` and `view.state`, discarding the top-level `data.winners: number[]` from the message.
**How to avoid:** Add `const winnerSeats = ref<number[]>([])` and capture it when `data.type === 'game_state'`. Also handle the dev-WS path: in the `useGame` composable path, winners are NOT in the per-player state; the WS `state` message only carries `flowState.complete` (no winners list). In dev mode, the Game Over card must gracefully degrade to "Game Over" without winner names, or the dev WS protocol must be extended to include winners — which is a session-layer change to investigate during planning.
**Warning signs:** Winners list is always empty in dev mode.

### Pitfall 7: HexBoardRenderer SVG `max-height: 80vh` is Viewport-relative

**What goes wrong:** SVG is still clamped to 80% of the *viewport* even after board is in a container.
**Why it happens:** `80vh` refers to the viewport, not the container. The container query approach replaces this.
**How to avoid:** Remove `max-height: 80vh; overflow: hidden` from `.hex-board-container`. Instead, let the SVG's `viewBox` be driven by the hex layout math and constrain it with `max-width: 100%; height: auto` so it scales to its container.

### Pitfall 8: DevHost.vue uses `height: 100vh` (not `100dvh`)

**What goes wrong:** Mobile browser toolbars clip the dev host's bottom on mobile.
**Why it happens:** DevHost.vue line 356 uses `100vh` only. Phase 97 updated GameShell but DevHost was not addressed.
**How to avoid:** Change to `height: 100dvh` (with `100vh` fallback) when updating the DevHost layout for this phase.

---

## Code Examples

### Current GameShell Template Structure (to be replaced)

```vue
<!-- Source: GameShell.vue lines 1326–1471 (ACTUAL CURRENT CODE) -->
<div v-if="currentScreen === 'game'" class="game-shell__game">
  <!-- Top Header Bar — rendered unconditionally (IA-01 target) -->
  <GameHeader
    :connection-status="platformMode ? 'connected' : connectionStatus"
    v-model:show-undo="showUndo"
    @menu-item-click="handleMenuItemClick"
  />

  <!-- Main Content Area -->
  <div class="game-shell__main">
    <!-- Left Sidebar — mobile: below content (order:2), max-height:40vh -->
    <aside class="game-shell__sidebar">
      <PlayersPanel ... />
      <GameHistory ... class="sidebar-history" />
    </aside>
    <!-- Center: Game Board -->
    <main class="game-shell__content">
      <div class="game-shell__zoom-container" :style="{ '--zoom-level': zoomLevel }">
        <!-- slot or selectedUiComponent -->
      </div>
    </main>
  </div>

  <!-- Bottom Action Bar — absent when allChoicesAnchored (line 1424-1450) -->
  <footer
    v-if="!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value"
    class="game-shell__action-bar"
  >
    <ActionPanel ... />
  </footer>
</div>
```

### Key CSS Values Being Replaced

```css
/* Source: GameShell.vue lines 1539–1595 (ACTUAL CURRENT CODE) */

/* REMOVE: hardcoded 80px action-bar spacer */
.game-shell__content {
  padding-bottom: 80px; /* line 1542 — REMOVE; replace with var(--bsg-dock-h) */
}

/* REMOVE: platform-mode 60px spacer */
.game-shell--platform .game-shell__content {
  padding-bottom: 60px; /* line 1503 — REMOVE */
}

/* REMOVE: single 768px breakpoint sidebar toggle */
@media (min-width: 768px) {
  .game-shell__main { flex-direction: row; }
  .game-shell__sidebar {
    width: 280px; min-width: 280px; max-height: none;
    /* ^ Replace with clamp(220px, 22vw, 320px) */
  }
}

/* REMOVE: standing mobile sidebar */
.game-shell__sidebar {
  max-height: 40vh; /* line 1571 — REMOVE; replaced by rail+overlay pattern */
}
```

### Current GameHeader.vue — What Moves to `⋯` Menu

```vue
<!-- Source: GameHeader.vue lines 56–93 (ACTUAL CURRENT CODE) -->
<!-- These controls MOVE to the ⋯ controls menu popover: -->
<div class="header-center">
  <div class="zoom-control">        <!-- Zoom slider: demoted to a11y magnifier in ⋯ menu -->
    <input type="range" ... />
  </div>
  <label class="auto-end-turn-toggle">  <!-- Auto toggle: moves to ⋯ menu -->
    <input type="checkbox" :checked="autoEndTurn ?? true" ... />
  </label>
  <label class="auto-end-turn-toggle">  <!-- showUndo toggle: DELETED (IA-01) -->
    <input type="checkbox" :checked="showUndo ?? true" ... />
  </label>
</div>
<!-- Connection badge: becomes a dot (IA-01) -->
<span class="connection-badge" :class="connectionStatus">{{ connectionStatus }}</span>
```

### boardPrompt / currentPick.prompt — Available but Unused

```typescript
// Source: GameShell.vue lines 485-489 (ACTUAL CURRENT CODE)
// boardPrompt is wired but rendered nowhere in the template
const boardPrompt = ref<string | null>(null);
function setBoardPrompt(prompt: string | null): void {
  boardPrompt.value = prompt;
}
// setBoardPrompt is passed as slot prop (line 1393) but the result is never rendered

// The prompt for the actionbar:
// boardPrompt.value ?? actionController.currentPick.value?.prompt
// currentPick.prompt exists: useActionControllerTypes.ts line 62 and 103
```

### postMessage Bridge Contract (current — do not break)

```typescript
// Source: GameShell.vue lines 618–694 (ACTUAL CURRENT CODE)

// INBOUND messages (host → iframe):
// { source: 'shufflewick', type: 'init', seat: number }
//   → sets playerSeat, applies theme via consumeInitMessage
// { source: 'shufflewick', type: 'game_state', view: { flowState, state }, isComplete, winners }
//   → updates state.value; winners/isComplete currently DROPPED (IA-07 gap)
// { source: 'shufflewick', type: 'server_response', requestId, result }
//   → resolves a pending platformRequest promise
// { source: 'shufflewick', type: 'dev-ui-select', name } (dev only)
// { source: 'shufflewick', type: 'dev-ui-list-request' } (dev only)

// OUTBOUND messages (iframe → host):
// { source: 'shufflewick-game', type: 'dev-ui-list', uis, gameType } (dev only)
// { source: 'shufflewick-game', type: 'server_request', requestId, op, payload }
//   → platform requests for actions, choices, undo, etc.

// handleMenuItemClick (line 1240): emits 'leave' or 'new-game' IDs
// These must continue to work after the header is removed in platform mode.
// In the new ⋯ menu, the button click calls handleMenuItemClick('leave') directly.
// No postMessage is sent for these — they call leaveGame() locally.
```

---

## Fixed-Pixel Inventory (IA-05 targets)

Every file with hard-coded pixel dimensions that must be changed for fluid sizing:

| File | Current Value | Line(s) | Target |
|------|--------------|---------|--------|
| `GridBoardRenderer.vue` | `width: 50px; height: 50px` (grid-cell) | 289–290 | `var(--cell)` × `var(--cell)` |
| `GridBoardRenderer.vue` | `width: 50px; height: 20px` (column label) | 249–250 | `width: var(--cell); height: auto` |
| `GridBoardRenderer.vue` | `width: 20px` (corner/row label) | 261, 276–277 | `width: calc(var(--cell) * 0.4)` or similar |
| `HexBoardRenderer.vue` | `max-height: 80vh; overflow: hidden` | 256–257 | Remove; SVG scales via `max-width: 100%; height: auto` |
| `HandRenderer.vue` | `width: 60px; min-width: 45px; height: 84px` (card-back-small, card-image, card-sprite) | 554–576 | `--card-w: clamp(44px, 14cqw, 84px)` with matching height |
| `CardRenderer.vue` | `width: 60px; min-width: 45px; height: 84px` | 506–528 | Same `--card-w` clamp |
| `DeckRenderer.vue` | `width: 60px; height: 84px` | 256–257 | `--card-w` clamp |
| `GridBoardTemplate.vue` | `max-height: 30vh` (hand strip) | 130 | `max-height: clamp(96px, 22vh, 180px)` |
| `DevHost.vue` | `height: 100vh` | 356 | `height: 100dvh` (fallback: `100vh`) |
| `GameShell.vue` | `padding-bottom: 80px` | 1542 | `padding-bottom: var(--bsg-dock-h, 0px)` |
| `GameShell.vue` | `padding-bottom: 60px` (platform) | 1503 | Remove entirely |
| `GameShell.vue` | `max-height: 40vh` (sidebar mobile) | 1571 | Remove; rail pattern replaces |
| `GameShell.vue` | `width: 280px; min-width: 280px` (sidebar desktop) | 1586–1587 | `clamp(220px, 22vw, 320px)` |

**Renderers NOT requiring fluid changes** (sizes are cosmetic/not layout-critical):
- `PieceRenderer.vue`: 40×40px piece icon (inside a grid-cell; cell size controls the space)
- `DieRenderer.vue`: not layout-critical
- `SpaceRenderer.vue`: min-height: 60px (acceptable floor)
- `ElementRenderer.vue`: no fixed sizes

---

## Winner Data Gap (IA-07 Detail)

The `flowState.complete` flag IS available at `state.value.flowState.complete` (engine's FlowState type, confirmed at `src/engine/flow/types.ts` line 244). This is sufficient to gate the Game Over card.

Winner seat numbers (`winners: number[]`) are sent in `game_state` postMessages but currently dropped:

- **Platform mode:** `data.winners` arrives in the `game_state` message body (line 670) but only `view.flowState` and `view.state` are captured. Fix: add `winnerSeats.value = data.winners ?? []`.
- **Dev WS mode:** The WS `state` message (handled by `game-connection.ts` line 264–274) does NOT include a winners field — only `flowState` and `state`. The `flowState.complete` flag arrives but winners do not. The dev path requires a session/WS extension OR the card degrades gracefully (shows "Game Over!" + final board but not winner names).

**Planner decision needed:** Either (a) extend the dev WS `state` message to include `winners`, or (b) accept dev-mode degradation (card shows game over without naming winners). The postMessage platform path can be fixed cleanly without protocol changes.

Player scores are NOT a first-class field in the engine or session — games implement their own scoring via `track.ts` or player attributes. Scores would be in `state.value.state.players[n].score` (if the game sets it) — no standardized API. The result card should show player attributes from the `players` array, not a hardcoded `.score` field.

---

## Existing Test Coverage

Current test suite: **1002 tests passing** across 74 test files.

| File | What It Covers | Relevance to Phase 100 |
|------|---------------|------------------------|
| `src/ui/components/GameShell.theme.test.ts` | `consumeInitMessage` + `isOriginAllowed` — postMessage init + theme handshake | Tests that origin check + applyTheme call work; these paths are unchanged in Phase 100 |
| `src/ui/composables/useActionController.test.ts` | `allCurrentChoicesAnchored`, `currentPick`, action lifecycle | Tests the logic driving the new dock `v-if`; no changes needed |
| `src/ui/composables/useBoardActionBridge.test.ts` | Board-centric action bridge | Not affected by layout changes |
| `src/ui/composables/useBoardInteraction.test.ts` | Board interaction substrate | Not affected |
| `src/ui/theme.contrast.test.ts` | Token contrast ratios | Not affected unless new tokens added |

**Missing tests (Wave 0 gaps the planner must add):**

- [ ] `src/ui/components/GameShell.ia.test.ts` — integration tests for:
  - `<GameHeader>` absent when `platformMode = true`
  - Dock absent when `!isMyTurn && !awaitingPlayerNames.length`
  - Prompt visible and buttons suppressed when `allCurrentChoicesAnchored = true`
  - `winnerSeats` captured from `game_state` postMessage
- [ ] `src/ui/components/GameOverCard.test.ts` — Game Over card renders with winner names from `winnerSeats × players`
- [ ] `src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts` — `--cell` computed as expected from `--cols`/`--rows` (CSS custom property check)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `zoom slider` as board-fit strategy | Retained from initial implementation | Phase 97–99: other work; not changed | Phase 100: retired as default fit; demoted to a11y magnifier |
| Single `@media (min-width: 768px)` breakpoint | Still current (line 1575) | Never updated | Phase 100: replace with 4-tier responsive |
| No container queries | Current | All prior phases | Phase 100: first use in BoardSmith |
| Standing `<GameHeader>` always rendered | Still current | Never gated | Phase 100: gate on `!platformMode` |

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/CSS/Vue template changes with no external runtime dependencies beyond the existing browser APIs (`ResizeObserver`, CSS container queries). Both are supported in all modern browsers (Chrome 105+, Firefox 110+, Safari 16+) and the project does not target older browsers.

---

## Validation Architecture

`workflow.nyquist_validation` key absent from `.planning/config.json` → treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vite.config.ts` (Vitest inline config) |
| Quick run command | `npm run test` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IA-01 | `<GameHeader>` absent in platformMode | unit | `vitest run src/ui/components/GameShell.ia.test.ts` | ❌ Wave 0 |
| IA-01 | connection dot renders (not badge text) in platformMode | unit | same | ❌ Wave 0 |
| IA-02 | prompt line renders when `isMyTurn` | unit | same | ❌ Wave 0 |
| IA-03 | buttons suppressed when `allCurrentChoicesAnchored`; prompt visible | unit | same | ❌ Wave 0 |
| IA-04 | dock absent when `!isMyTurn && !awaitingPlayerNames.length` | unit | same | ❌ Wave 0 |
| IA-04 | `--bsg-dock-h` CSS var set by ResizeObserver | unit | same | ❌ Wave 0 |
| IA-05 | `.grid-cell` width = `var(--cell)` not `50px` | unit/snapshot | `vitest run src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts` | ❌ Wave 0 |
| IA-07 | Game Over card renders when `flowState.complete` | unit | `vitest run src/ui/components/GameOverCard.test.ts` | ❌ Wave 0 |
| IA-07 | `winnerSeats` captured from `game_state` postMessage | unit | `vitest run src/ui/components/GameShell.ia.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test`
- **Per wave merge:** `npm run test && npm run lint:css`
- **Phase gate:** Full suite (1002+) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/ui/components/GameShell.ia.test.ts` — covers IA-01, IA-02, IA-03, IA-04, IA-07 (postMessage)
- [ ] `src/ui/components/GameOverCard.test.ts` — covers IA-07 (render)
- [ ] `src/ui/components/auto-ui/renderers/GridBoardRenderer.fluid.test.ts` — covers IA-05 (cell sizing)

---

## Security Domain

`security_enforcement` key absent from `.planning/config.json` → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — no auth in this phase |
| V3 Session Management | No | N/A — session unchanged |
| V4 Access Control | No | N/A — no access control changes |
| V5 Input Validation | Partial | The `game_state.winners` field from postMessage: validate it is `number[]` before assigning to `winnerSeats`; the existing `isOriginAllowed` origin check is the primary control |
| V6 Cryptography | No | N/A |

### Known Threat Patterns for postMessage Bridge

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed `winners` payload from untrusted message | Tampering | `isOriginAllowed` is already the gate (line 630); additionally validate `Array.isArray(data.winners) && data.winners.every(n => typeof n === 'number')` before assigning |
| CSS injection via host token override | Tampering | `consumeInitMessage` enforces `--bsg-*` allowlist (existing, not changed) |
| Scrim overlay blocking user interaction | Spoofing | Scrim is positioned INSIDE `.boardregion` (absolute, not fixed); it cannot overlay browser UI or cover the `.actionbar` |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ResizeObserver` callback fires correctly for the `.actionbar` element when its content grows (flex-wrap) | Pattern 3 | If not, `--bsg-dock-h` would be stale; mitigate by also observing on `transitionend` |
| A2 | Dev WS path does not send `winners` in the `state` message | Winner Data Gap | If it does, the degradation fallback is unnecessary; low risk |
| A3 | `container-type: size` on `.boardregion` correctly resolves `cqw`/`cqh` for cells nested inside archetype templates | IA-05 pattern | If nesting breaks CQ resolution, an intermediate `container-type` on the archetype wrapper may be needed |
| A4 | The `.actionbar` `flex-wrap` + `overflow-y: auto` combination works correctly on iOS Safari without requiring `-webkit-overflow-scrolling: touch` | Pattern 1 | iOS 15.4+ supports `overflow-y: auto` on flex containers without prefix; if older targets exist this needs checking |

**If the Assumptions table is empty:** All claims in this research were verified or cited — no user confirmation needed. (It is NOT empty — 4 assumptions logged above.)

---

## Open Questions (RESOLVED)

1. **Winners in dev WS mode** — (RESOLVED: degrade gracefully)
   - What we know: `winners: number[]` is in `game_state` postMessage (captured); NOT in dev WS `state` message
   - What's unclear: Should Phase 100 extend the dev WS protocol to carry winners, or should the Game Over card gracefully degrade in dev mode?
   - Recommendation: Degrade gracefully in dev mode (show "Game Over!" without winner names); Phase 103 cross-repo verification will exercise it in platform mode where winners are available. (Implemented in 100-06.)

2. **HamburgerMenu vs ControlsMenu naming** — (RESOLVED: new ControlsMenu.vue)
   - What we know: `HamburgerMenu.vue` currently renders as a left-side drawer; the mockup's `⋯` menu is a small popover from the sidebar header
   - What's unclear: Should the existing `HamburgerMenu.vue` be refactored in-place or should a new `ControlsMenu.vue` be created?
   - Recommendation: Create a new `ControlsMenu.vue` matching the mockup's popover pattern exactly; keep `HamburgerMenu.vue` tombstoned until Phase 101 audit confirms it can be deleted (it may still be used for non-platform standalone mode). (Implemented in 100-04.)

3. **`showUndo` toggle deletion** — (RESOLVED: delete toggle, undo follows canUndo)
   - What we know: CONTEXT.md says "delete the `showUndo` toggle" (IA-01)
   - What's unclear: `showUndo` ref (line 215) is v-modeled into `<GameHeader>` (line 1334) and passed to `<ActionPanel>` (line 1437). ActionPanel has `showUndo` prop logic. If the header is removed in platform mode, what governs undo visibility in the action dock?
   - Recommendation: Undo is always visible when `canUndo` is true. Remove `showUndo` prop from ActionPanel and always show undo when `canUndo && !isViewingHistory`. The toggle was an UX escape hatch that is no longer needed. (Implemented in 100-04 Task 3.)

---

## Sources

### Primary (HIGH confidence)
- `GameShell.vue` — directly inspected; all line numbers verified in this session
- `GameHeader.vue`, `HamburgerMenu.vue`, `PlayersPanel.vue`, `GameHistory.vue` — directly inspected
- `AutoUI.vue` — directly inspected (lines 37–42 banner confirmed)
- `GridBoardRenderer.vue`, `HexBoardRenderer.vue`, `HandRenderer.vue` — directly inspected; fixed-pixel values confirmed
- `GridBoardTemplate.vue` — directly inspected
- `theme.ts` — `--bsg-rail`, `--bsg-side`, spacing scale confirmed at lines 96–158
- `.stylelintrc.cjs` — `color-no-hex: true`, `ignoreFiles: []` confirmed
- `DevHost.vue` — directly inspected; layout structure confirmed
- `planning/mockups/boardsmith-chrome.html` — canonical design target; read in full
- `src/ui/composables/useActionController.ts` — `allCurrentChoicesAnchored` (line 674), `currentPick.prompt` confirmed
- `src/engine/flow/types.ts` — `FlowState.complete: boolean` at line 244 confirmed
- `src/session/stateless-ops.ts` — `winners: number[]` in postMessage payload confirmed

### Secondary (MEDIUM confidence)
- Browser support for `container-type: size`, `ResizeObserver`, `100dvh` — well-established in modern targets; no explicit version matrix checked in this session

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing APIs
- Architecture: HIGH — pinned to canonical mockup; current code inspected
- Pitfalls: HIGH — sourced from actual current code, not inference
- Fixed-pixel inventory: HIGH — line numbers confirmed by grep

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable domain — CSS layout; no fast-moving external dependencies)
