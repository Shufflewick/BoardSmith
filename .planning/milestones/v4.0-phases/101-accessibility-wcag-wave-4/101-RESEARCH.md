# Phase 101: Accessibility — WCAG 2.2 AA (Wave 4) - Research

**Researched:** 2026-06-23
**Domain:** Vue 3 UI accessibility — keyboard operability, ARIA semantics, live regions, focus management, contrast/motion
**Confidence:** HIGH (all findings verified directly against codebase file contents)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Create a shared `useSelectable()` composable that centralizes `handleClick` across all 8 renderers + hex `<g>`, binding `@click` AND `@keydown.enter/space` to the SAME `triggerElementSelect`. Implements roving-tabindex grid (`role="grid"` / `role="gridcell"`, arrow-key + Home/End) for board renderers. Only ONE place where click/keydown is wired.
- Apply to ALL 8 renderers + the hex `<g>`. Divergence is impossible by construction.
- Drag is progressive enhancement. Wire `isDropTarget` set to click/Enter. Regression-test drag.
- Mirror the canonical mockup `planning/mockups/boardsmith-chrome.html` for markup.
- `filterAnchoredChoices` (ActionPanel.vue:255, implemented in action-panel-helpers.ts:37) must return anchored choices in a secondary focusable list, never drop them.
- Footer must never fully suppress while picks are pending.
- Two `outline:none` declarations deleted: ActionPanel.vue:1369 and GameHeader.vue:185.
- Global `:focus-visible` ring: `outline:none; box-shadow:0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent); border-radius:var(--bsg-r-sm)`.
- Three dialogs (HamburgerMenu drawer, ControlsMenu popover, GameOverCard overlay) get `role="dialog" aria-modal="true"`, focus-move on open, focus-trap, Escape-to-close, restore-focus, `inert` on rest. Single shared composable/util for trap+restore.
- Global `@media (prefers-reduced-motion: reduce)` block in GameShell.vue (or global CSS). All renderer infinite animations degrade.
- Route `opacity:.35` disabled states through hatch pattern. Route muted text through `--bsg-ink-2`/`--bsg-ink-3`. Toast `.warning` in light mode fixed to ≥4.5:1.
- `--bsg-ink-muted` token added to theme.ts if needed (or use existing `--bsg-ink-2`/`--bsg-ink-3`).
- Slate only — no new neon. `npm run lint:css` must stay green. Keep tests green (1066 baseline after Phase 100).
- Preserve Custom UI ↔ Action Panel parity via `useBoardInteraction`. `useSelectable()` works for custom UIs too.
- `DebugPanel` gets names/focus/target-size only — NO reskin/tabs/D-shortcut gating (those are Phase 102).
- Host-side skip-link/h1/live-region relay is out of scope (deferred).

### Claude's Discretion
- Implementation structure of `useSelectable()` internals (element-mode vs grid-mode API surface).
- Whether focus-trap is a standalone composable `useFocusTrap()` or an inline util in each dialog component.
- Exact `aria-label` string format for board cells ("e5, white knight, selectable" per spec — treat as locked).
- Where to place the legend component (inside AutoUI or GameShell template).
- Whether `announce()` is a composable or a simple reactive ref passed down from GameShell.

### Deferred Ideas (OUT OF SCOPE)
- DebugPanel full reskin, ARIA tabs, `D`-shortcut gating → Phase 102.
- Dev chrome collapse-to-tab, seat switcher, "Table setup" panel, New-Game two-click confirm → Phase 102.
- Host-side `default.vue`/`[sessionId].vue`/`GameLobby.vue` skip-link, `h1`, live-region relay → future host milestone.
- Material/vignette layer, dev chrome material polish → Phase 102.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| A11Y-01 | Keyboard-operable board via shared `useSelectable()` composable across all 8 renderers | useSelectable does not exist; each renderer has isolated `handleClick`; composable must be created in `src/ui/composables/` |
| A11Y-02 | Action panel exposes anchored choices in a focusable secondary list; never fully suppresses while picks pending | `filterAnchoredChoices` in `action-panel-helpers.ts:37` drops all notation-anchored choices; footer suppression in `GameShell.vue:1596` via `allCurrentChoicesAnchored.value`; both need modification |
| A11Y-03 | Turn changes, errors, disconnects, game-over announced via live regions; GameHistory becomes `role="log"` | Zero `role="status"` or `role="alert"` exist except one `aria-live="polite"` span in GameShell; GameHistory has no live role |
| A11Y-04 | Every board element exposes `aria-label` and `aria-selected`/`-disabled`/`-current` from same booleans as CSS | Zero ARIA state attributes in any renderer; all booleans exist and are usable |
| A11Y-05 | Every interaction state paired with non-color cue; legend shown | Non-color visual cues shipped in Phase 99; legend needs adding; shape-based player identity needs formalizing |
| A11Y-06 | Visible `:focus-visible` ring on every interactive element; two `outline:none` declarations removed | `ActionPanel.vue:1369` and `GameHeader.vue:185` have `outline:none`; no global `:focus-visible` rule exists |
| A11Y-07 | Hamburger drawer and Game Over overlay are `role="dialog" aria-modal` with full focus lifecycle | HamburgerMenu has no dialog role/trap; GameOverCard has `role="dialog"` but `aria-modal="false"` and no trap |
| A11Y-08 | All animations disabled under `prefers-reduced-motion: reduce` | Only PlayersPanel.vue, animation/drag-drop.css, animation/card-flip.css, FlyingCardsOverlay, ZoomPreviewOverlay have this guard; 3 renderer pulse animations are unguarded |
| A11Y-09 | Muted text through `--bsg-ink-2`/`--bsg-ink-3`; ≥44px touch targets; Toast warning fixed | `opacity:.35` in all 8 renderers for disabled state; `--bsg-ink-muted` token does not exist; cancel-btn/clear-selection-btn undersized |
| A11Y-10 | Toasts are `role="status"`/assertive with dismiss button and auto-timeout; skip link + h1 | Toast.vue has no role/button/aria; `useToast` already has auto-timeout; no skip link or h1 in GameShell |
</phase_requirements>

---

## Summary

Phase 101 is the WCAG 2.2 AA accessibility wave for the BoardSmith UI module. The two critical blockers are: (1) all 8 board renderers are 100% mouse-only — no `tabindex`, `role`, or `@keydown` anywhere in `src/ui/components/auto-ui/renderers/`; and (2) `filterAnchoredChoices` silently drops anchored choices from the action panel, making board-anchored games unplayable without a mouse. Everything else — live regions, ARIA labels, focus ring, dialog semantics, reduced motion, contrast, toasts — is real work but mechanical once the two critical blockers are done.

The single highest architectural risk is ensuring `useSelectable()` becomes the ONLY place where click/keydown is wired. If even one renderer keeps its own `handleClick`, the pattern will diverge. The composable must be created first and each renderer migrated atomically. The hex SVG (`HexBoardRenderer.vue`) is the hardest because SVG `<g>` elements need special focus handling.

All Slate tokens are in place from Phases 98-99. The `--bsg-ink-muted` token does not exist in `theme.ts` — the CONTEXT says to use `--bsg-ink-2`/`--bsg-ink-3` directly. The `lint:css` `color-no-hex` rule will catch any accidental hex introduction. No new npm packages are needed for this phase.

**Primary recommendation:** Build `useSelectable()` (A11Y-01) and fix `filterAnchoredChoices` (A11Y-02) first and in isolation — the remaining 8 requirements are independent and can be planned in parallel waves after the composable is stable.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Keyboard board operability (A11Y-01) | Renderer layer — `src/ui/components/auto-ui/renderers/*.vue` | New composable `src/ui/composables/useSelectable.ts` | Interaction wiring lives at the renderer boundary; composable centralizes the logic |
| Action panel parity (A11Y-02) | ActionPanel layer — `action-panel-helpers.ts` + `ActionPanel.vue` | GameShell.vue footer guard | Choice filtering is ActionPanel's responsibility; footer v-if is GameShell's |
| Live region announcements (A11Y-03) | GameShell.vue (shell owns game state transitions) | AutoUI.vue (board context); GameHistory.vue (log role) | GameShell has the `isMyTurn`, `connectionStatus`, `flowState` signals; is the natural announcer |
| Semantic names + state attributes (A11Y-04) | Renderer layer (each renderer owns its element identity) | `useSelectable()` composable (ARIA state driven from same booleans as CSS) | Renderers already compute `displayLabel`, `isSelected`, `isDisabled` — bind ARIA there |
| Non-color cues + legend (A11Y-05) | CSS in renderers + new Legend component | GameShell/AutoUI (mount point for legend) | Phase 99 shipped the visual cues; this phase adds legend markup and ARIA pairing |
| Global focus ring (A11Y-06) | GameShell.vue `<style>` global block | — | A global `:focus-visible` rule must not be scoped |
| Dialog semantics + focus trap (A11Y-07) | Each dialog component (HamburgerMenu, ControlsMenu, GameOverCard) | New `useFocusTrap()` composable | Each dialog is its own component; shared composable prevents divergence |
| Reduced motion (A11Y-08) | Global CSS block (GameShell.vue or new `a11y.css`) + per-renderer pulse removal | Renderer CSS files | Global block is the floor; per-renderer `@media` wraps are the cleanup |
| Contrast + touch targets (A11Y-09) | theme.ts (tokens) + renderer/component CSS (disabled state) | ActionPanel.vue, HamburgerMenu.vue (target sizes) | Token layer is the right home for semantic color; CSS is the right home for min-size |
| Toasts + skip link + h1 (A11Y-10) | Toast.vue (role/button) + GameShell.vue (skip link, h1) | useToast.ts (dismiss integration) | Toast component owns its markup; GameShell owns the page skeleton |

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | (project-native) | Component framework, reactive state | Already in use |
| vitest | ^2.1.0 | Test runner | Already configured [VERIFIED: package.json] |
| @vue/test-utils | ^2.4.11 | Mount Vue components in tests | Already in use; `// @vitest-environment jsdom` per DOM test [VERIFIED: package.json] |

### No New Packages Required

This phase is entirely code changes — no new npm dependencies. All needed patterns (focus trap, ARIA, roving tabindex) are implemented in plain TypeScript/Vue.

**`npm run lint:css` constraint:** `stylelint` with `color-no-hex: true` is enforced on all `src/ui/**/*.vue` files. `theme.ts` is exempt. No hex literals may appear in `.vue` files. [VERIFIED: `.stylelintrc.cjs`]

---

## Package Legitimacy Audit

No external packages are being installed in this phase. All changes are code-only.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | — |

---

## Architecture Patterns

### System Architecture Diagram

```
User input (keyboard / pointer)
         │
         ▼
  useSelectable() composable  ←──────────────────── (NEW)
  (single source of click + keydown wiring)
         │
         ├─► triggerElementSelect({ id, name, notation })
         │         │
         │         ▼
         │   useBoardInteraction (provide/inject)
         │         │
         │         ▼
         │   ActionController → game action submitted
         │
         └─► Roving tabindex grid nav (arrow/Home/End)
                   │
                   ▼
             focus managed within role="grid" board


Game state transitions (isMyTurn, flowState, connectionStatus)
         │
         ▼
  GameShell.vue (live region owner)
         │
         ├─► role="status" aria-live="polite"  ← "Your turn", "Alice is playing…"
         └─► role="alert" aria-live="assertive" ← "Game over — Bram wins", error


Dialog open
         │
         ▼
  useFocusTrap() composable  ←──────────────── (NEW)
         │
         ├─► move focus to first focusable element inside dialog
         ├─► trap Tab within dialog
         ├─► bind Escape → close
         └─► restore focus to invoking element on close
```

### Recommended Project Structure (new files)

```
src/ui/composables/
├── useSelectable.ts          ← NEW: single click+keydown+tabindex wiring
├── useFocusTrap.ts           ← NEW: shared focus-trap + Escape handler
├── useBoardInteraction.ts    (existing)
└── useToast.ts               (existing — add dismiss callback)

src/ui/components/
├── GameShell.vue             (add skip link, h1, live regions, global focus ring, reduced-motion)
├── auto-ui/
│   ├── ActionPanel.vue       (fix outline:none, fix filterAnchoredChoices secondary list)
│   ├── action-panel-helpers.ts (modify filterAnchoredChoices to return secondary list)
│   └── renderers/
│       ├── CardRenderer.vue  (remove handleClick, use useSelectable, add aria-label/state)
│       ├── GridBoardRenderer.vue (remove handleCellClick, use useSelectable grid mode)
│       ├── HexBoardRenderer.vue  (remove handleHexClick, use useSelectable on <g>)
│       ├── PieceRenderer.vue     (remove handleClick, use useSelectable)
│       ├── DeckRenderer.vue      (remove handleClick, use useSelectable)
│       ├── HandRenderer.vue      (remove handleClick, use useSelectable)
│       ├── SpaceRenderer.vue     (remove handleClick, use useSelectable)
│       └── DieRenderer.vue       (remove handleClick, use useSelectable)
├── GameHistory.vue           (add role="log" aria-live="polite")
├── PlayersPanel.vue          (aria-current on active player; shape identity already present)
├── Toast.vue                 (add role="status", dismiss button, assertive variant)
├── HamburgerMenu.vue         (add role="dialog" aria-modal, focus-trap, Escape)
├── ControlsMenu.vue          (add focus-trap, Escape, defer aria-modal per menu semantics)
└── GameOverCard.vue          (flip aria-modal to true, add focus-trap, Escape)

src/ui/theme.ts               (add --bsg-ink-muted if needed, verify contrast values)
```

### Pattern 1: useSelectable() — Element Mode (cards, dice, pieces)

The composable returns event handler functions and computed attributes to bind directly to the template element.

```typescript
// Source: pattern derived from existing handleClick in CardRenderer.vue:301
// and useBoardInteraction.ts:128 (triggerElementSelect signature)

// useSelectable.ts (element mode)
export function useSelectable(
  identity: () => { id?: number; name?: string; notation?: string },
  boardInteraction: BoardInteraction | null,
  isActionSelectable: ComputedRef<boolean>,
  isDisabled: ComputedRef<boolean>
) {
  function handleActivate() {
    if (!boardInteraction || !isActionSelectable.value) return;
    if (isDisabled.value) return;
    boardInteraction.triggerElementSelect(identity());
  }

  const attrs = computed(() => ({
    role: 'button' as const,
    tabindex: isActionSelectable.value ? '0' : '-1',
    'aria-disabled': isDisabled.value || undefined,
    'aria-selected': /* isSelected */ undefined,  // caller passes in
  }));

  return {
    handleClick: (e: MouseEvent) => handleActivate(),
    handleKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate(); }
    },
    attrs,
  };
}
```

### Pattern 2: useSelectable() — Grid Mode (GridBoardRenderer, HexBoardRenderer)

Grid mode manages a 2D array of cells with roving tabindex. The board container gets `role="grid"`, each cell `role="gridcell"`.

```typescript
// Source: mockup boardsmith-chrome.html lines 569-618 (canonical JS roving-tabindex implementation)
// Adapted to Vue reactive refs

export function useSelectableGrid(
  cells: ComputedRef<GameElement[]>,
  cols: ComputedRef<number>,
  getIdentity: (cell: GameElement) => ElementRef,
  boardInteraction: BoardInteraction | null
) {
  const currentIdx = ref(0);  // roving tabindex cursor

  function focusCell(i: number) {
    const clamped = Math.max(0, Math.min(cells.value.length - 1, i));
    currentIdx.value = clamped;
    // DOM: set tabindex=0 on target, -1 on all others, call .focus()
  }

  function handleGridKeydown(e: KeyboardEvent, COLS: number) {
    const k = e.key;
    if (k === 'ArrowRight') focusCell(currentIdx.value + 1);
    else if (k === 'ArrowLeft') focusCell(currentIdx.value - 1);
    else if (k === 'ArrowDown') focusCell(currentIdx.value + COLS);
    else if (k === 'ArrowUp') focusCell(currentIdx.value - COLS);
    else if (k === 'Home') focusCell(currentIdx.value - (currentIdx.value % COLS));
    else if (k === 'End') focusCell(currentIdx.value - (currentIdx.value % COLS) + COLS - 1);
    else if (k === 'Enter' || k === ' ') {
      const cell = cells.value[currentIdx.value];
      boardInteraction?.triggerElementSelect(getIdentity(cell));
    }
    else return;
    e.preventDefault();
  }

  return { currentIdx, focusCell, handleGridKeydown };
}
```

### Pattern 3: useFocusTrap()

```typescript
// Source: WCAG dialog pattern (standard); GameOverCard.vue:77 already has role="dialog"
// HamburgerMenu needs role added; ControlsMenu needs focus trap

export function useFocusTrap(dialogRef: Ref<HTMLElement | null>) {
  let previouslyFocused: HTMLElement | null = null;

  function open() {
    previouslyFocused = document.activeElement as HTMLElement;
    nextTick(() => {
      const first = getFocusable(dialogRef.value)[0];
      first?.focus();
    });
  }

  function close() {
    previouslyFocused?.focus();
  }

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !dialogRef.value) return;
    const focusable = getFocusable(dialogRef.value);
    // cycle focus within dialog
  }

  return { open, close, trapTab };
}
```

### Pattern 4: Live Regions in GameShell

```html
<!-- Source: mockup boardsmith-chrome.html lines 285-286 -->
<!-- Place in GameShell.vue template, immediately after <body> equivalent -->
<p class="vh" id="live" role="status" aria-live="polite"></p>
<p class="vh" id="alive" role="alert" aria-live="assertive"></p>
```

The `.vh` class (visually hidden) must be defined globally — it does not currently exist in GameShell.vue's `<style>`. Add to the global (non-scoped) style block.

### Anti-Patterns to Avoid

- **Separate click and keydown handlers in renderers:** If `@click` and `@keydown` are not wired to the same function via `useSelectable()`, the two diverge as soon as one renderer is updated independently. The composable is the only permitted wiring point.
- **SVG `<g>` with `tabindex` but without focusable children:** SVG focus in Safari is unreliable with `tabindex` on `<g>` in some versions. Test with VoiceOver/Safari. Alternative: wrap the hex SVG `<g>` content in a `<foreignObject><button>` — but this breaks layout. Preferred: use `tabindex="0"` on `<g>` with explicit `role="gridcell"` and accept the VoiceOver limitation as a known gap to test.
- **`role="dialog"` without `aria-modal="true"`:** Screen readers will not confine virtual cursor to the dialog if `aria-modal` is omitted or false. GameOverCard.vue currently has `aria-modal="false"` (line 74) — this must flip to `true`.
- **`inert` without fallback:** `inert` has full browser support as of 2023 but needs to be applied correctly — it must cover the rest of the `<body>` while the dialog is open, excluding the dialog itself.
- **Setting `aria-live` content before the region is mounted:** Browsers silently ignore live region updates that happen immediately after insertion. The polite/assertive regions must be in the DOM before any announcements.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WCAG contrast ratio computation | Custom contrast formula | The existing `theme.contrast.test.ts` helper (`contrastRatio` at line 84) | Already implemented; extend it, don't duplicate |
| Toast auto-dismiss timer | Custom setTimeout tracking | `useToast.ts` already has `setTimeout(() => remove(id), duration)` at line 26 | The mechanism exists; just expose a dismiss button that calls `remove(id)` |
| Focus trap mechanics | Custom Tab key interception | Pattern from `useFocusTrap()` composable (NEW — implement once, use in 3 dialogs) | 3 dialogs needing trap; hand-rolling each separately will diverge |
| Roving tabindex grid | Per-renderer arrow key state | `useSelectableGrid()` (part of `useSelectable.ts`) | Identical logic needed for GridBoardRenderer + HexBoardRenderer |

**Key insight:** The existing `triggerElementSelect` already handles all selection business logic (disabled check, drop-target activation, callback dispatch). `useSelectable()` is just a thin wrapper that adds keyboard events and ARIA attributes — it must not duplicate any selection logic.

---

## Concrete File Map — All 8 Renderers

### Renderer Inventory (VERIFIED: direct file inspection)

| Renderer | File | `handleClick` line | `@click` line | isSelectable | isSelected | isDropTarget | isDisabled | Root element |
|----------|------|-------------------|---------------|--------------|------------|--------------|------------|--------------|
| CardRenderer | `src/ui/components/auto-ui/renderers/CardRenderer.vue` | 301 | 349 | 77 | 78 | 134 | 143 | `<div class="card-container">` |
| GridBoardRenderer | `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue` | 145 (`handleCellClick`) | 213 (`@click.stop`) | n/a (per-cell) | n/a | per-cell 155 | per-cell 140 | `<div class="board-grid">` contains `<div class="grid-cell">` |
| HexBoardRenderer | `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue` | 159 (`handleHexClick`) | 216 (`<g @click>`) | n/a | n/a | per-cell | per-cell | `<svg>` containing `<g class="hex-cell-group">` |
| PieceRenderer | `src/ui/components/auto-ui/renderers/PieceRenderer.vue` | 92 | 140 | n/a | 67 | n/a | 81 | `<div>` (inferred) |
| DeckRenderer | `src/ui/components/auto-ui/renderers/DeckRenderer.vue` | 102 | 125 | 46 | 47 | n/a | 77 | `<div>` (inferred) |
| HandRenderer | `src/ui/components/auto-ui/renderers/HandRenderer.vue` | 240 | 284 | 64 | 65 | 95 | 100 | `<div>` containing card slots |
| SpaceRenderer | `src/ui/components/auto-ui/renderers/SpaceRenderer.vue` | 90 | 162 | n/a | n/a | 65 | 70 | `<div>` |
| DieRenderer | `src/ui/components/auto-ui/renderers/DieRenderer.vue` | 67 | 102 | n/a | n/a | n/a | 61 | `<div>` |

**Pattern shared by all element renderers (CardRenderer, PieceRenderer, DeckRenderer, HandRenderer, SpaceRenderer, DieRenderer):**

```typescript
// CURRENT pattern — 6 copy-paste instances of this:
function handleClick(event: MouseEvent) {
  if (!boardInteraction || !isActionSelectable.value) return;
  if (isDisabled.value) return;
  boardInteraction.triggerElementSelect(elementIdentity());
}
// → @click="handleClick"
// ZERO @keydown, ZERO tabindex, ZERO aria-*
```

**GridBoardRenderer-specific current pattern:**

```typescript
// CURRENT — GridBoardRenderer.vue:145 (note: also has selectElement for non-selectable cells)
function handleCellClick(cell: GameElement) {
  if (!boardInteraction) return;
  if (isCellDisabled(cell)) return;
  if (boardInteraction.isSelectableElement(cellIdentity(cell))) {
    boardInteraction.triggerElementSelect(cellIdentity(cell));
  } else if (cell.name) {
    boardInteraction.selectElement(cellIdentity(cell));  // passive select, not a game action
  }
}
// → @click.stop="handleCellClick(cell)" on each <div class="grid-cell">
```

**`useBoardInteraction` → `triggerElementSelect` signature** [VERIFIED: `src/ui/composables/useBoardInteraction.ts:128`]:

```typescript
triggerElementSelect: (element: { id?: number; name?: string; notation?: string }) => void;
```

The composable is injected via `tryUseBoardInteraction()` (gracefully returns null outside GameShell). All renderers already call this pattern.

---

## A11Y-01 to A11Y-10 — Concrete Change Map

### A11Y-01: Keyboard-operable board

**Files to create:**
- `src/ui/composables/useSelectable.ts` — NEW composable with element mode + grid mode

**Files to modify (remove handleClick, add useSelectable):**
- `CardRenderer.vue:301-325, 349` — remove `handleClick`, bind `useSelectable` attrs/handlers
- `PieceRenderer.vue:92-95, 140` — same
- `DeckRenderer.vue:102-106, 125` — same
- `HandRenderer.vue:240-244, 284` — same
- `SpaceRenderer.vue:90-94, 162` — same
- `DieRenderer.vue:67-70, 102` — same
- `GridBoardRenderer.vue:145-166, 198-215` — replace `handleCellClick`, add `role="grid"` to `.board-grid`, `role="gridcell"` to each `.grid-cell`, `@keydown` on the board container, roving tabindex management
- `HexBoardRenderer.vue:159-163, 211-218` — replace `handleHexClick`, add `role="group"` to SVG, `tabindex="0"` + `role="gridcell"` + `@keydown` on each `<g class="hex-cell-group">`, roving tabindex

**Critical constraint:** `useSelectable()` is the ONLY place `triggerElementSelect` is called from a UI event. The old `handleClick` function bodies are deleted, not refactored.

**Divergence risk (highest risk in phase):** After migration, grep for `handleClick\|@click.*triggerElementSelect` in renderers should return zero results. The planner must add a Wave 0 task that adds this grep as a CI lint rule or verification step.

**Aria labels — format (from mockup, treat as spec):**
- Cell: `"c8, selectable"` / `"b7, selected"` / `"d6, drop target"` / `"h1, unavailable"`
- Cell with piece: derive from `cell.name` + occupant + state
- Hand: `role="group" aria-label="Your hand, 5 cards"` (count is dynamic)
- Grid board: `role="grid" aria-label="Game board, 8 by 6"` (cols × rows from gridResult)
- Hex board: `role="group" aria-label="${displayLabel}"` + per-cell `<g aria-label="...">` 

**ARIA state binding — from same booleans as CSS:**
```
isActionSelectable → aria-selected=false (default) / will be selected on pick
isCellSelected / isSelected → aria-selected="true"
isDisabled → aria-disabled="true"
```

### A11Y-02: Action panel parity

**Files to modify:**
- `src/ui/components/auto-ui/action-panel-helpers.ts:37-52` — `filterAnchoredChoices` currently returns `choices.filter(c => !isNotationAnchored(c))`. Must instead return `{ primary: ChoiceWithRefs[], anchored: ChoiceWithRefs[] }` (or two separate computed properties in ActionPanel). The anchored list renders as a secondary focusable `<ul role="list">` with each item as `<button>` that calls `triggerElementSelect` on the notation.
- `src/ui/components/auto-ui/ActionPanel.vue:255` — consume the new shape from `filterAnchoredChoices`.
- `GameShell.vue:1596` — the `allCurrentChoicesAnchored` gate currently suppresses the entire footer. This must be changed: footer stays visible whenever `currentPick` has choices (anchored or not). Only the action buttons are suppressed, not the prompt and not the secondary anchored-choices list.

**Note on `filterAnchoredChoices` call chain:** The function is in `action-panel-helpers.ts`, imported at ActionPanel line 29, called at line 255. The GameShell `allCurrentChoicesAnchored` property lives at GameShell.vue line 1596 and is the `template v-if` on the `<footer>`. These are two separate changes.

### A11Y-03: Live regions

**Files to modify:**
- `GameShell.vue` — add two hidden live regions to template (polite status + assertive alert). Wire `isMyTurn`, `connectionStatus`, `state?.flowState?.complete`, `winnerSeats` to announce text. Add `.vh` CSS class (visually hidden, not display:none).
- `AutoUI.vue` — if it has its own game state access, add a board-context live region for selection feedback ("Selected b7").
- `GameHistory.vue` — add `role="log" aria-live="polite" aria-relevant="additions"` to the message list container (the `v-for` of `processedMessages`).

**Live region placement:** Must be in DOM before any content is written. Mount at GameShell template root, not inside the board region or sidebar.

**Announce events to wire:**
- `isMyTurn` toggle → "Your turn"
- Opponent's turn → "Alice is playing…" (from `awaitingPlayers` in flowState)
- `connectionStatus` change → "Reconnecting…" / "Reconnected"
- `state.flowState.complete` → "Game over — [winner] wins" (assertive)
- `toast.error()` calls → already in Toast.vue; the assertive region should also capture these

### A11Y-04: Semantic names and state

Covered jointly with A11Y-01 (aria-label format) and A11Y-03 (aria-current for active player).

**Additional bindings per component:**
- `PlayersPanel.vue` — already has `role="list"`/`role="listitem"`. Add `aria-current="true"` to the active player's listitem (line 127, conditional on `isPlayerActive`).
- `HandRenderer.vue` — add `role="group"` and dynamic `aria-label="Your hand, N cards"` to the hand container. (Currently no semantic grouping — line 269 area has no role.)
- `HexBoardRenderer.vue` — hex piece circles at line 235-243 use `<title>` for names; `<title>` is SVG-standard for accessible names on SVG elements and is acceptable.

### A11Y-05: Non-color state cues + legend

**Phase 99 shipped:** dashed/solid/dotted border styles for selectable/selected/drop-target states. CSS content pseudo-elements for the "+" (selectable) and "✓" (selected) icons are in the mockup but may or may not be in current CSS — verify per renderer.

**What this phase adds:**
- A `<Legend>` component (new) listing the 5 states with a swatch and text label — mirrors mockup `.legend` section (lines 416-425).
- `PlayersPanel.vue` — confirm shape-based player tokens (`sh-circle`, `sh-square`, etc.) from the mockup are implemented. The Phase 99 PlayersPanel uses CSS `border-radius` and color for player tokens; the mockup uses `clip-path` shapes. Verify shape-distinctiveness is present or add it.

**File:** New `src/ui/components/auto-ui/BoardLegend.vue` mounted inside AutoUI or GameShell boardregion (absolute-positioned, bottom-left, same as mockup).

### A11Y-06: Visible focus ring

**Two deletions:**
- `ActionPanel.vue:1367-1371` — `.number-input input:focus, .text-input input:focus { outline: none; border-color: var(--bsg-accent); }` → remove `outline: none`.
- `GameHeader.vue:185` — `.zoom-slider { outline: none }` → delete the rule.

**One addition — global `:focus-visible` block in GameShell.vue (non-scoped `<style>`):**

```css
/* Source: mockup boardsmith-chrome.html line 59 */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent);
  border-radius: var(--bsg-r-sm);
}
```

This must be in a non-scoped (global) style block since it covers all descendant interactive elements including those in child components.

### A11Y-07: Dialog semantics + focus management

**Three dialogs, one composable:**

| Component | File | Current state | Changes needed |
|-----------|------|---------------|----------------|
| HamburgerMenu drawer | `src/ui/components/HamburgerMenu.vue:84` | `<div v-if="isOpen" id="hamburger-menu-drawer" class="menu-drawer">` — div, no role, no trap | Add `role="dialog" aria-modal="true" aria-label="Game menu"`, use `useFocusTrap()` |
| ControlsMenu popover | `src/ui/components/ControlsMenu.vue:105` | `<div v-if="isOpen" role="menu">` — menu role, no trap; comment at line 12 explicitly defers Phase 101 | Add focus-trap via `useFocusTrap()`, Escape-to-close; retain `role="menu"` per mockup `#menu` markup |
| GameOverCard overlay | `src/ui/components/GameOverCard.vue:74` | `<div class="game-over-scrim" aria-modal="false">` — comment line 12 says Phase 101 adds this | Flip `aria-modal` to `true`, add `useFocusTrap()`, Escape-to-close (or disable Escape for game-over?) |

**New composable:** `src/ui/composables/useFocusTrap.ts`
- `open(dialogEl)` — saves `document.activeElement`, focuses first focusable in dialog
- `handleKeydown(e)` — traps Tab; closes on Escape
- `close()` — restores focus to saved element
- Apply `inert` attribute to all other top-level children of `<body>` while dialog is open

**GameOverCard note:** The game-over card should trap focus but Escape probably should NOT close it (game is over, dismissing would be meaningless). The planner must decide — research recommends: Escape should do nothing on GameOverCard (no "close" action available), trap stays active until user clicks Rematch/New Game.

### A11Y-08: Reduced motion

**Global block — add to GameShell.vue non-scoped `<style>`:**

```css
/* Source: CONTEXT.md decision; matches mockup line 269 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

**Renderer infinite animations that need guarding (or removal when global block applies):**

| File | Line | Animation | Action |
|------|------|-----------|--------|
| `CardRenderer.vue` | 447 | `animation: pulse-card 2s ease-in-out infinite` | Covered by global block; optionally wrap `@keyframes pulse-card` in `@media (prefers-reduced-motion: no-preference)` for clarity |
| `GridBoardRenderer.vue` | 352 | `animation: pulse-drop-target 1s ease-in-out infinite` | Same |
| `HandRenderer.vue` | 405 | `animation: pulse-hand 2s ease-in-out infinite` | Same |
| `PlayersPanel.vue` | 273 | `animation: breathe 2.1s ease-in-out infinite` (already has `@media (prefers-reduced-motion: reduce) { animation: none }` at line 282) | Already handled — global block is belt-and-suspenders |
| `Toast.vue` | 69-88 | Slide transitions (`translateY`) | Covered by global block |
| `ControlsMenu.vue` | 222 | `@keyframes pop` (opacity + translateY) | Covered by global block |

**Active-player breathe (CONTEXT):** When reduced-motion is active, the breathe animation on the active player's border must become a static high-contrast border. `PlayersPanel.vue:282` already has `animation: none` but does not add the static border replacement. This task adds: `@media (prefers-reduced-motion: reduce) { .player.active { border: 2px solid var(--bsg-accent); } }`.

### A11Y-09: Contrast + touch targets

**`opacity:.35` disabled state — in ALL 8 renderers:**

| File | Line | Context | Fix |
|------|------|---------|-----|
| `CardRenderer.vue` | 481 | `.card-container.is-disabled` | Replace `opacity:.35` with hatch pattern (`repeating-linear-gradient`) + `aria-disabled` |
| `GridBoardRenderer.vue` | 382 | `.grid-cell.is-disabled` | Same |
| `HexBoardRenderer.vue` | 341 | `.hex-polygon.is-disabled` (SVG) | SVG: use `opacity:.4` + fill pattern overlay; `aria-disabled` on the `<g>` |
| `DeckRenderer.vue` | 224 | `.deck-container.is-disabled` | Hatch + aria-disabled |
| `HandRenderer.vue` | 446 | `.hand-renderer.is-disabled` | Hatch + aria-disabled |
| `PieceRenderer.vue` | 253 | `.piece-renderer.is-disabled` | Hatch + aria-disabled |
| `SpaceRenderer.vue` | 240 | `.space-renderer.is-disabled` | Hatch + aria-disabled |
| `DieRenderer.vue` | 164 | `.die-renderer.is-disabled` | Hatch + aria-disabled |

**`--bsg-ink-muted` token:** Does NOT exist in `theme.ts`. The CONTEXT decision uses `--bsg-ink-2` (`#99a3af` dark / `#566069` light) and `--bsg-ink-3` (`#69727d` dark / `#8a939b` light) as the muted ramp. No new token is required — use existing. [VERIFIED: `src/ui/theme.ts:50-51, 78-79`]

**Touch target violations (from spec):**

| Control | File | Current size | Fix |
|---------|------|-------------|-----|
| `.cancel-btn` | `ActionPanel.vue:1179` | `padding: 2px 6px` → ~24px height | `min-height: 44px` |
| `.clear-selection-btn` | `ActionPanel.vue:1260` | `padding: 0 4px` → <24px | `min-height: 44px; min-width: 44px` |
| `.hamburger-btn` | `HamburgerMenu.vue:147-148` | `width: 28px; height: 20px` | `min-width: 44px; min-height: 44px` |
| ControlsMenu ⋯ trigger | `ControlsMenu.vue:93` | 38×38px (needs verification) | Bump to `min-height: 44px` |
| Dev color swatches | `DevHost.vue` | 22×22px per spec | `min-width: 24px; min-height: 24px` (minimum per 2.5.8; 44px preferred) |

**Toast warning contrast fix:**
- Dark mode: `--bsg-warn: #e6b450` with text `--bsg-accent-ink: #04211d` → [ASSUMED: passes 4.5:1 — warm yellow on near-black]
- Light mode: `--bsg-warn: #b5832a` with text `--bsg-accent-ink: #ffffff` → **3.37:1, fails AA** [CITED: spec line 61 confirming this ratio]
- Fix: darken `--bsg-warn` light-mode value in `theme.ts:86` to ≥4.5:1 against white. Target: approximately `#8c6318` (darker amber) or set text to dark ink. Update `theme.contrast.test.ts` to assert Toast warning contrast in both themes.

### A11Y-10: Toasts + skip link + h1

**Toast.vue current state:** A bare `<div>` per toast with `@click="remove(toast.id)"`, no `role`, no `<button>`, no `aria-live`. `useToast.ts` already handles auto-timeout (`setTimeout` at line 26) and `remove(id)`.

**Changes to Toast.vue:**
```
<div role="status"> (for success/info/warning)
     OR role="alert" (for error type)
  {{ toast.message }}
  <button aria-label="Dismiss" @click.stop="remove(toast.id)">
    <span aria-hidden="true">✕</span>
  </button>
</div>
```
Remove the `@click` on the outer div (clicking the background accidentally dismisses). Keep keyboard-accessible dismiss button.

**Skip link — add to GameShell.vue template root:**
```html
<!-- Source: mockup line 282-283 -->
<a class="sr-skip" href="#main">Skip to game board</a>
```
`#main` already exists (`GameShell.vue:1487 id="main"`). The `.sr-skip` CSS (visually hidden until focused) must go in the non-scoped global style block.

**h1 — add visually-hidden `<h1>` to GameShell.vue:**
```html
<!-- Source: mockup line 284 -->
<h1 class="vh">BoardSmith — game board</h1>
```
This covers the in-repo shell. Host-side h1 is out of scope.

---

## Common Pitfalls

### Pitfall 1: SVG Focus Reliability (HexBoardRenderer)
**What goes wrong:** `tabindex="0"` on SVG `<g>` elements is spec-valid but Safari/VoiceOver has historically had issues with SVG focus and roving tabindex. The `<g>` may not receive keyboard focus reliably.
**Why it happens:** SVG is not an interactive content model in older browser implementations.
**How to avoid:** Test with VoiceOver/Safari before marking A11Y-01 done for HexBoardRenderer. If SVG tabindex is unreliable, the fallback is a transparent overlay `<button>` positioned over each hex cell using `position:absolute` within a `position:relative` container — but this requires wrapping the SVG in a relative div.
**Warning signs:** VoiceOver cursor can't land on hex cells; Tab does not move between them.

### Pitfall 2: Live Region Content Timing
**What goes wrong:** Writing to a `role="status"` region immediately after mounting it causes the announcement to be dropped — the AT has not yet registered the region.
**Why it happens:** Screen readers observe live regions after they're in the DOM for a moment; updates at mount time are silently ignored.
**How to avoid:** Mount live regions unconditionally in GameShell (not `v-if`). Write content only in response to reactive state changes (`watch` with `{ immediate: false }`), never on mount.
**Warning signs:** Turn announcements are heard for second turn but not first; VoiceOver/NVDA inconsistency.

### Pitfall 3: `aria-modal` Without `inert` on Background
**What goes wrong:** `aria-modal="true"` tells AT that only the dialog is relevant, but keyboard users (Tab key) can still reach elements outside the dialog.
**Why it happens:** `aria-modal` is an AT hint, not a DOM enforcement mechanism. Only `inert` (or `aria-hidden`) on background content actually prevents Tab from escaping.
**How to avoid:** `useFocusTrap()` must apply `inert` to all siblings of the dialog's ancestor within `<body>`. Verify with keyboard-only testing (no AT): Tab must never leave the dialog.
**Warning signs:** After Tab through all dialog items, focus wraps back to page content.

### Pitfall 4: `color-no-hex` Stylelint Failure
**What goes wrong:** Adding hatch patterns for disabled state (e.g., `repeating-linear-gradient`) requires referencing colors — if written as hex, CI fails.
**Why it happens:** `.stylelintrc.cjs` has `color-no-hex: true` with zero exceptions on all `.vue` files.
**How to avoid:** All colors in disabled hatch patterns must use `var(--bsg-*)` tokens. Example: `repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px)` — use existing `--bsg-cell` token or create a named token. Check `theme.ts` — `--bsg-cell` exists for this purpose. [VERIFIED: `theme.ts:44, 72` (light: `rgba(22,27,32,.025)`, dark: `rgba(255,255,255,.035)`)]
**Warning signs:** `npm run lint:css` fails after a disabled-state CSS edit.

### Pitfall 5: `filterAnchoredChoices` Caller Contract Change
**What goes wrong:** If `filterAnchoredChoices` changes its return type, every call site must be updated. Currently called in ActionPanel.vue:255 only — but if it's also used in tests, those break.
**Why it happens:** Changing `ChoiceWithRefs[]` to `{ primary, anchored }` changes the API surface.
**How to avoid:** Either (a) keep the original function for its current callers and add a new `splitAnchoredChoices()` function, or (b) update the single call site and the test file `src/ui/components/auto-ui/action-panel-helpers.test.ts` (if it exists). Check for tests of this function before modifying.
**Warning signs:** TypeScript compile error on `choices = filterAnchoredChoices(...)` assignment.

### Pitfall 6: Grid `role="grid"` on Non-Grid Renderers
**What goes wrong:** `role="grid"` must only go on the container that has `role="gridcell"` children. If placed on the wrong element, ARIA validation fails.
**Why it happens:** GridBoardRenderer has `<div class="board-container">` wrapping `<div class="board-grid">` wrapping each `<div class="grid-cell">`. Only `.board-grid` should get `role="grid"`; `.grid-cell` gets `role="gridcell"`.
**How to avoid:** Match the mockup exactly: `role="grid"` → `role="gridcell"`. HandRenderer uses `role="group"`, not `role="grid"` (cards in a hand are not a 2D grid).

---

## Runtime State Inventory

This is not a rename/refactor/migration phase. Skip this section.

---

## Code Examples

### Existing `handleClick` pattern (all 6 element renderers — IDENTICAL):

```typescript
// Source: CardRenderer.vue:301, PieceRenderer.vue:92, DeckRenderer.vue:102,
//         HandRenderer.vue:240, SpaceRenderer.vue:90, DieRenderer.vue:67

function handleClick(event: MouseEvent) {  // (or: function handleClick())
  if (!boardInteraction || !isActionSelectable.value) return;
  if (isDisabled.value) return;
  boardInteraction.triggerElementSelect(elementIdentity());
}
```

The `useSelectable()` composable replaces this pattern everywhere. After migration, `handleClick` should not exist in any renderer.

### Existing `filterAnchoredChoices` (action-panel-helpers.ts:37):

```typescript
// Source: action-panel-helpers.ts:37-52
export function filterAnchoredChoices(
  choices: ChoiceWithRefs[],
  pickType: string | undefined
): ChoiceWithRefs[] {
  if (pickType !== 'choice') return choices;
  const isNotationAnchored = (c: ChoiceWithRefs): boolean =>
    (c.refs ?? []).some(r => r.ref.notation !== undefined);
  const hasAnyAnchored = choices.some(isNotationAnchored);
  if (!hasAnyAnchored) return choices;
  return choices.filter(c => !isNotationAnchored(c));
  // ↑ Currently DROPS anchored choices. Must expose them as secondary list.
}
```

### Existing contrast test extend point (theme.contrast.test.ts:125):

```typescript
// Source: src/ui/theme.contrast.test.ts:125
// Extend this describe block to add Toast warning + muted text assertions:
describe('Both-theme WCAG contrast — key surfaces', () => {
  // existing assertions at lines 150-190...
  // ADD:
  it('toast warning bg (--bsg-warn / --bsg-accent-ink) ≥ 4.5:1 both themes', () => {
    // Use extractHex() helper at line 54 to get token values
    // Assert contrastRatio(warn, accentInk) >= 4.5
  });
  it('muted text (--bsg-ink-2 / --bsg-surface) ≥ 4.5:1 both themes', () => { });
  it('muted text (--bsg-ink-3 / --bsg-surface) ≥ 3:1 both themes (non-text)', () => { });
});
```

### Mockup: roving-tabindex grid (canonical — boardsmith-chrome.html:569-618):

The mockup's JavaScript implements the exact pattern needed:
- `cells[cur].setAttribute('tabindex','-1')` on defocus
- `cells[i].setAttribute('tabindex','0')` + `.focus()` on move
- Arrow keys: `cur+1` / `cur-1` / `cur+COLS` / `cur-COLS`
- Home: `cur - (cur % COLS)`, End: `cur - (cur % COLS) + COLS - 1`
- Enter/Space: check `stateOf(el)` and call `triggerElementSelect`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `WCAG 2.1` keyboard SC 2.1.1 | `WCAG 2.2` adds SC 2.5.7 (Dragging Movements — must have pointer alternative), 2.5.8 (Target Size minimum 24×24px) | 2023 | SC 2.5.7 means drag must have a click/Enter alternative (already the plan); SC 2.5.8 means 24px minimum (harder floor than 44px target) |
| `aria-modal` without `inert` | `inert` attribute (now universally supported) | 2023 baseline | `inert` is the correct DOM enforcement; `aria-modal` alone is insufficient |
| SVG focus with `tabindex` on `<g>` | SVG `tabindex` is now well-supported in major browsers | 2022+ | HexBoardRenderer `<g tabindex="0" role="gridcell">` should work; VoiceOver still needs testing |
| `role="dialog"` requires `aria-modal` to confine virtual cursor | Confirmed in ARIA 1.2 | 2023 | GameOverCard has the role but `aria-modal="false"` — this is wrong |

**Deprecated/outdated:**
- `outline: none` on interactive elements: was common pre-2016; WCAG 2.1 SC 2.4.11 (Focus Appearance, AA in 2.2) makes it unambiguously non-compliant.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/ui/` |
| Full suite command | `npm test` |

**DOM test environment:** Default is `node`. Tests that mount Vue components must use `// @vitest-environment jsdom` as the first line (see `HamburgerMenu.test.ts:1`, `GoFishAsk.interaction.test.ts:1`).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A11Y-01 | `useSelectable()` calls `triggerElementSelect` on Enter/Space | unit | `npx vitest run src/ui/composables/useSelectable.test.ts` | ❌ Wave 0 |
| A11Y-01 | Roving tabindex: ArrowRight/Left/Up/Down/Home/End move focus | unit | `npx vitest run src/ui/composables/useSelectable.test.ts` | ❌ Wave 0 |
| A11Y-01 | CardRenderer has `role="button"` and `tabindex="0"` when selectable | component (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` | ❌ Wave 0 |
| A11Y-01 | GridBoardRenderer has `role="grid"` on board, `role="gridcell"` on cells | component (jsdom) | `npx vitest run src/ui/components/auto-ui/renderers/GridBoardRenderer.a11y.test.ts` | ❌ Wave 0 |
| A11Y-02 | `filterAnchoredChoices` returns secondary list, not empty, for notation-anchored choices | unit | `npx vitest run src/ui/components/auto-ui/action-panel-helpers.test.ts` | ❌ Wave 0 (helpers test may exist — check) |
| A11Y-06 | `ActionPanel.vue` does not contain `outline: none` | lint/grep | `grep -n "outline: none" src/ui/components/auto-ui/ActionPanel.vue` (should return 0) | manual/CI |
| A11Y-07 | `useFocusTrap` moves focus to first focusable on open, restores on close | unit | `npx vitest run src/ui/composables/useFocusTrap.test.ts` | ❌ Wave 0 |
| A11Y-07 | HamburgerMenu has `role="dialog"` and `aria-modal="true"` | component (jsdom) | existing `HamburgerMenu.test.ts` extended | ✅ extend |
| A11Y-07 | GameOverCard has `aria-modal="true"` | component (jsdom) | existing `GameOverCard.test.ts` extended | ✅ extend |
| A11Y-09 | Toast warning contrast ≥ 4.5:1 both themes | unit | `npx vitest run src/ui/theme.contrast.test.ts` | ✅ extend |
| A11Y-09 | Muted text (`--bsg-ink-2`) contrast ≥ 4.5:1 | unit | `npx vitest run src/ui/theme.contrast.test.ts` | ✅ extend |
| A11Y-10 | Toast has `role="status"` or `role="alert"` | component (jsdom) | `npx vitest run src/ui/components/Toast.a11y.test.ts` | ❌ Wave 0 |
| A11Y-10 | Toast has a dismiss `<button>` | component (jsdom) | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/ui/` (UI module only, ~fast)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/ui/composables/useSelectable.test.ts` — covers A11Y-01 keyboard activation + roving tabindex
- [ ] `src/ui/composables/useFocusTrap.test.ts` — covers A11Y-07 focus lifecycle
- [ ] `src/ui/components/auto-ui/renderers/CardRenderer.a11y.test.ts` — covers A11Y-01 aria-label/state on card
- [ ] `src/ui/components/auto-ui/renderers/GridBoardRenderer.a11y.test.ts` — covers A11Y-01 grid roles + navigation
- [ ] `src/ui/components/Toast.a11y.test.ts` — covers A11Y-10 role/button
- [ ] Extend `src/ui/theme.contrast.test.ts` — Toast warning + muted text assertions
- [ ] Extend `src/ui/components/HamburgerMenu.test.ts` — add `role="dialog"` and `aria-modal` assertions
- [ ] Extend `src/ui/components/GameOverCard.test.ts` — add `aria-modal="true"` assertion

---

## Security Domain

Accessibility changes in this phase have no security surface (no new network calls, no auth, no data exposure). Security enforcement is not applicable to this phase's changes.

---

## Environment Availability

Step 2.6: This phase is code/markup changes only. No external CLI tools, databases, or services are required beyond the existing `npm test`, `npm run lint:css`, and `npm run dev` commands. All required runtimes (Node.js, vitest, vue-test-utils) are already confirmed present from prior phases.

---

## Open Questions (RESOLVED)

1. **GameOverCard Escape behavior** — **RESOLVED:** GameOverCard calls `useFocusTrap()` with `escapeToClose: false`; Tab stays trapped, Escape does nothing, user dismisses via Rematch/New Game. Implemented in Plan 101-08 Task 3.
   - What we know: `useFocusTrap()` binds Escape to close by default
   - What's unclear: Should Escape close the game-over screen? There is no "cancel" — game is over. Closing it would hide the winner display with no way to reopen.
   - Recommendation: For GameOverCard, `useFocusTrap()` should be called with `escapeToClose: false`. Focus trap still applies (Tab stays inside dialog); Escape does nothing. The user must click Rematch/New Game to dismiss.

2. **`useSelectable()` API surface — two modes vs one** — **RESOLVED:** Single `useSelectable.ts` file exports both `useSelectable` (element mode) and `useSelectableGrid` (grid mode), sharing the `triggerElementSelect` wrapping. Implemented in Plan 101-01 Task 1.
   - What we know: Element renderers need single-element keyboard activation; grid renderers need 2D roving tabindex
   - What's unclear: Should this be one composable with a `mode` parameter, or two (`useSelectable` + `useSelectableGrid`)?
   - Recommendation: Single `useSelectable.ts` file that exports both `useSelectable` (element mode) and `useSelectableGrid` (grid mode). They share core `triggerElementSelect` wrapping logic.

3. **HexBoardRenderer `<g>` focus in Safari** — **RESOLVED:** Ship `tabindex="0"` on `<g role="gridcell">` first; a jsdom test asserts roving-tabindex advances on ArrowRight (partial — Safari/VoiceOver SVG focus needs manual verification). Escalate to overlay buttons only if manual VO fails. Implemented in Plan 101-04 Task 2 (+ HexBoardRenderer.a11y.test.ts).
   - What we know: `tabindex` on SVG `<g>` is spec-valid; support has improved
   - What's unclear: Whether Safari 17+ handles this reliably enough for AA compliance
   - Recommendation: Implement with `tabindex="0"` on `<g>` first; flag for manual VoiceOver/Safari test during verification. If it fails, escalate to a transparent HTML overlay button approach.

4. **`action-panel-helpers.test.ts` existence** — **RESOLVED:** Plan 101-06 Task 1 creates/extends `action-panel-helpers.test.ts` for the new `splitAnchoredChoices` return shape.
   - What we know: The file is not in the test file listing found above
   - What's unclear: Whether it exists (the test file scan may have been incomplete)
   - Recommendation: The planner should include a task to check for `action-panel-helpers.test.ts` and create it in Wave 0 if absent.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Dark-mode Toast warning (`#e6b450` / `#04211d`) passes 4.5:1 | A11Y-09 | If it fails, both dark and light warn tokens need darkening — broader change |
| A2 | Safari 17+ handles `tabindex="0"` on SVG `<g>` reliably | A11Y-01 (Pitfall 1) | Hex board may require fallback transparent button overlay |
| A3 | `action-panel-helpers.test.ts` does not exist | A11Y-02 / Wave 0 Gaps | If it exists, Wave 0 gap is not a gap — saves one task |

---

## Sources

### Primary (HIGH confidence)
- All file contents verified by direct `Read` and `Bash` tool inspection in this session
- `src/ui/composables/useBoardInteraction.ts` — `triggerElementSelect` signature (line 128), full interface
- `src/ui/components/auto-ui/action-panel-helpers.ts` — `filterAnchoredChoices` implementation (lines 37-52)
- `src/ui/components/auto-ui/ActionPanel.vue` — `outline:none` at line 1369; `filterAnchoredChoices` call at line 255
- `src/ui/components/GameHeader.vue` — `outline:none` at line 185
- `src/ui/components/GameShell.vue` — footer suppression via `allCurrentChoicesAnchored` at line 1596; `<main id="main">` at line 1487; one `aria-live="polite"` span at line 1592
- `planning/mockups/boardsmith-chrome.html` — canonical ARIA markup, roving-tabindex grid JS implementation (lines 569-618), focus ring CSS (line 59), live regions (lines 285-286), skip link (line 282)
- `planning/boardsmith-ui-redesign-spec.md` — Accessibility Plan §1-11 (lines 995-1215), Wave 4 deliverables (lines 1319-1338)
- `.planning/phases/101-accessibility-wcag-wave-4/101-CONTEXT.md` — locked decisions
- `.stylelintrc.cjs` — `color-no-hex: true` enforcement
- `src/ui/theme.ts` — all `--bsg-*` token values
- `src/ui/theme.contrast.test.ts` — existing contrast test infrastructure

### Secondary (MEDIUM confidence)
- WCAG 2.2 SC 2.1.1, 2.4.7, 2.4.11, 2.5.7, 2.5.8, 4.1.2, 4.1.3 — requirements interpreted per training knowledge [ASSUMED]
- ARIA 1.2 dialog pattern (`role="dialog" aria-modal="true"` + focus trap) — standard pattern [ASSUMED but widely established]

---

## Metadata

**Confidence breakdown:**
- Renderer inventory (file paths, line numbers, interaction pattern): HIGH — verified by direct file inspection
- `useBoardInteraction` API: HIGH — verified from source
- `filterAnchoredChoices` behavior: HIGH — read the implementation
- Token values: HIGH — read from theme.ts
- Contrast ratios: MEDIUM — dark-mode warn token assumed passing; light-mode confirmed failing per spec
- SVG focus reliability: LOW — browser behavior; cannot be verified statically

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable; tokens and file structure are frozen from prior phases)
