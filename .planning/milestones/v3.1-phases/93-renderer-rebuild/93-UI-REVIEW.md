# UI Review — Phase 93: renderer-rebuild

**Overall Score:** 19/24
**Mode:** Advisory, non-blocking 6-pillar visual audit
**Screenshots:** not captured (no dev server on ports 3000, 5173, or 8080)

---

## Pillar Summary

| Pillar | Score |
|--------|-------|
| Copywriting | 3/4 |
| Visuals | 3/4 |
| Color | 4/4 |
| Typography | 4/4 |
| Spacing | 3/4 |
| Experience Design | 2/4 |

---

## Carry-Forward Verification (Phase 92)

All three Phase 92 carry-forward requirements are confirmed satisfied in the new renderer:

**CF-1 Piece hover affordance** — PASS. `PieceRenderer.vue:150-152` explicitly declares `.piece:hover { transform: scale(1.05); }`, with the comment citing the carry-forward requirement. The transition (`transition: transform 0.2s ease`) is also present.

**CF-2 Single shadow on token pieces** — PASS. `box-shadow: 0 2px 8px rgba(0,0,0,0.3)` lives on `.piece` only (`PieceRenderer.vue:144`). The `.piece-token` element (`lines 182-188`) has zero shadow declarations. The inner `.piece-token-label` also has none. Double-stacking is not reproduced.

**CF-3 Grid error panel copy parity** — PASS. The error string flows from `resolveGridSize()` into the template via `{{ gridResult.error }}` (`GridBoardRenderer.vue:131`), meaning the exact string from `auto-ui-helpers.ts:167` — `Grid "<id>" can't render — declare $rowCoord/$colCoord on the Grid element` — is rendered verbatim. The `console.error` prefix `[BoardSmith] ` prepended by the renderer is additive and does not affect the panel text. No divergence as in the old `AutoElement.vue:1105`.

---

## Top 3 Priority Fixes

1. **PieceRenderer is missing the `action-selectable` CSS class in its template binding** — `isActionSelectable` is computed and drives drag enablement via `is-draggable` (setting `cursor: grab`), but no `action-selectable` class is ever applied to the `.piece` div. The green-pulse affordance that all other element types (card, deck, hand, space, grid cell) display when the player can act is completely absent for board pieces. A player looking at a grid board sees nothing indicating which pieces they can move, while cells show the pulse correctly. Fix: add `'action-selectable': isActionSelectable` to the class binding in `PieceRenderer.vue:84-86`, and add a `.piece.action-selectable` CSS rule with the green outline pulse (matching the pattern in `CardRenderer.vue:383-404`).

2. **No loading/null state when `gameView` is null** — When `gameView` is `null` or `undefined`, `topLevelChildren` is an empty array, `archetype` resolves to `'tableau'`, and `TableauTemplate` renders an empty `<div class="tableau-template">` with no visual content. Users see a blank board area with no indication the game is loading. Fix: add an explicit null/empty branch in `AutoRenderer.vue`'s template — before the archetype dispatch — that renders a centered loading indicator (or at minimum a `.auto-renderer--empty` styled state) when `!gameView`.

3. **HandRenderer header copy overrides game designer's element name** — The spec (§HandRenderer) states the header should show the element's `name` property left-aligned bold white. The implementation renders `"Your Hand"` (for the local player) or `"${playerName}'s Hand"` (for others), derived from `$player.name` or seat number. This hard-codes English strings and discards the game designer's declared hand name. A game with hands named "Dealt Cards" or "Reserve" will show "Your Hand" regardless. Fix: use `element.name ?? 'Your Hand'` as the primary label in `HandRenderer.vue:242-244`, falling back to the seat-derived label only when no element name is declared.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**WARNING — Hand header ignores element.name (HandRenderer.vue:242-244)**
The spec contract for HandRenderer header is: "element `name` left-aligned bold white; card count `(N)` right-aligned `#888`, `13px`." The implementation always renders either `"Your Hand"` or `"${playerName}'s Hand"`, never the element's declared `name` attribute. Game designers who name their hand elements (e.g., `'Crib'`, `'Reserve'`) will see their name replaced. This is the copywriting contract violation with the highest game-impact.

**PASS — UnsupportedTopologyPanel copy** (`archetypes/UnsupportedTopologyPanel.vue:22-29`)
Exact spec strings rendered: heading `"This layout cannot be auto-generated"` and body paragraph match verbatim. No paraphrasing.

**PASS — Grid error panel copy parity** (`renderers/GridBoardRenderer.vue:131`)
Error panel text sourced directly from `gridResult.error` which is the return value of `resolveGridSize()` → the locked string at `auto-ui-helpers.ts:167`. Copy parity guaranteed structurally.

**PASS — Deck empty state** (`renderers/DeckRenderer.vue:130-132`)
`"Empty"` text with `font-style: italic; color: #666` matches spec exactly.

**MINOR — Deck count always says "cards"** (`renderers/DeckRenderer.vue:114`)
Spec allows `{N} cards` or `{N} items`. The implementation unconditionally says `{{ childCount }} cards`. For a deck of tiles or tokens, this would read "3 cards". Low priority but a copy contract gap.

**MINOR — Empty hand shows "No cards"** (`renderers/HandRenderer.vue:316`)
The spec does not define empty-hand copy. "No cards" is generic but not objectionable; not spec'd either way.

---

### Pillar 2: Visuals (3/4)

**WARNING — PieceRenderer action-selectable visual state missing** (`renderers/PieceRenderer.vue:83-91`)
`isActionSelectable` is computed (`lines 44-48`) and used to enable dragging (`is-draggable` class + `draggable` attribute). However, the class binding is `{ 'is-draggable': isActionSelectable, 'is-dragging': isDragged }` only — `action-selectable` is never applied. There is no `.piece.action-selectable` CSS rule. Result: pieces that can be played show only `cursor: grab` with no green pulse, breaking the system-wide affordance pattern where playable elements glow green. This is the most significant visual gap in the system.

**WARNING — PieceRenderer transition missing `box-shadow` dimension** (`renderers/PieceRenderer.vue:145`)
Spec prescribes `transition: transform 0.2s ease, box-shadow 0.2s ease`. Implementation has only `transition: transform 0.2s ease`. The `box-shadow` transition missing means shadow changes (e.g., on hover) will jump rather than animate smoothly.

**PASS — Archetype template visual hierarchy**
`GridBoardTemplate.vue`: `grid-template-rows: auto 1fr auto` with named areas `chrome/board/hand` exactly matches the spec CSS prescription. Board area takes `1fr`. Chrome and hand use `auto` and conditionally render with `v-if`. The C6 failure mode (equal-space subdivision) is not reproduced.

**PASS — UnsupportedTopologyPanel visually loud**
Amber heading (`#f59e0b`), `rgba(245,158,11,0.1)` background, `rgba(245,158,11,0.4)` border, `padding: 24px`, `border-radius: 8px` — all match spec Template 4 requirements exactly.

**PASS — CardTemplate and TableauTemplate layouts**
CardTemplate uses flex-column with hands dominant (`flex: 1`). TableauTemplate uses flex-wrap with no false hierarchy.

---

### Pillar 3: Color (4/4)

All container background surface values match the spec precisely:
- Hand container: `rgba(255,255,255,0.05)` bg, `border-radius: 12px` — PASS
- Deck container: `rgba(255,255,255,0.05)` bg, `border: 1px solid rgba(255,255,255,0.1)`, `border-radius: 12px` — PASS
- Board container: `rgba(255,255,255,0.05)` bg, `border-radius: 12px` — PASS
- Space container: `rgba(255,255,255,0.03)` bg, `border: 1px solid rgba(255,255,255,0.1)`, `border-radius: 8px` — PASS
- Grid cell: `rgba(255,255,255,0.1)` bg, `border-radius: 4px` — PASS
- Hex polygon: `fill: rgba(255,255,255,0.1)`, `stroke: rgba(255,255,255,0.3)`, `stroke-width: 1.5` — PASS

Cyan/green accent separation is clean throughout:
- Cyan (`#00d9ff`) reserved to `is-selected` outlines and `is-selectable:hover` glows — no violations found.
- Green (`#00ff88` / `rgba(0,255,136,*)`) reserved to `action-selectable` and `is-board-selected` states — no violations found.
- The two accent colors are never used interchangeably across any renderer.

Player color cycle (`HexBoardRenderer.vue:106-113`) matches the spec's exact array `[#e74c3c, #3498db, #2ecc71, #f39c12, #9b59b6, #1abc9c]` in the same order.

Hardcoded colors (`#fff`, `#888`, `#aaa`, `#666`, `#000`) are all neutral text/meta colors from the spec's typography and container system. No novel palette introductions. Registry audit: not applicable (shadcn not initialized, no third-party registries in UI-SPEC).

---

### Pillar 4: Typography (4/4)

Canonical sizes in use mapped to spec roles:

| Renderer | Value | Spec role |
|---|---|---|
| DeckRenderer `.deck-label` | 20px | Deck/zone heading — PASS |
| SpaceRenderer `.space-label` | 16px | Body — PASS |
| CardRenderer `.card-face` | 14px | Label — PASS |
| GridBoardRenderer `.grid-error-panel__text` | 14px | Label — PASS |
| HandRenderer `.hand-count` | 13px | Small/meta — PASS |
| DeckRenderer `.deck-count` | 13px | Small/meta — PASS |
| SpaceRenderer `.space-count` | 13px | Small/meta — PASS |
| GridBoardRenderer `.board-label` | 12px | Exception (coord notation) — PASS |
| HexBoardRenderer `.hex-label` | 12px | Exception (coord annotation) — PASS |
| PieceRenderer `.piece-token-label` | 12px | Exception (piece token) — PASS |
| GridBoardRenderer `.cell-notation` | 10px | Exception (cell coord) — PASS |

Minor: `PieceRenderer.vue:141` sets `font-size: 0.8rem` (~12.8px) on the `.piece` container. This doesn't render visible text directly (the `.piece-token-label` overrides with `12px`), but the declaration is architecturally redundant. Not a user-visible issue.

`DieRenderer.vue:121` uses `font-size: 0.75rem` (~12px) for die caption text — falls within the approved exception zone. PASS.

No font sizes outside the declared 4-tier scale (plus approved exceptions) appear anywhere in the renderer tree.

Font weights: `bold`/`700` for headings and labels; `400` (inherited) for body text. Matches spec. No `font-weight: 500` or `600` stray values detected.

---

### Pillar 5: Spacing (3/4)

Core spacing values are consistent with the declared scale (multiples of 4):

| Location | Value | Scale token | Status |
|---|---|---|---|
| Container padding (hand/deck/board) | 16px | md | PASS |
| Card-in-hand gap | 8px | sm | PASS |
| GridBoardTemplate chrome/hand padding | 8px | sm | PASS |
| GridBoardTemplate gaps | 8px | sm | PASS |
| TableauTemplate gap | 32px | xl | PASS |
| CardTemplate peripheral/hand padding | 16px | md | PASS |
| Grid cell gap | 2px | Approved exception | PASS |
| Deck stack offset | -2px / 1px | Approved exception | PASS |

**WARNING — Off-scale 12px values** (`DeckRenderer.vue:141`, `GridBoardRenderer.vue:209`, `HexBoardRenderer.vue:228`, `HandRenderer.vue:386`)
`gap: 12px` (deck container) and `margin-bottom: 12px` (board/hand headers) appear in multiple renderers. 12px is not in the declared spacing scale (4, 8, 16, 24, 32). However, these values are explicitly prescribed in the spec's per-component CSS blocks (e.g., "display: flex; flex-direction: column; gap: 12px" for DeckRenderer). This is an internal contradiction in the UI-SPEC itself: the spacing scale doesn't include 12px but the per-component prescriptions use it. Implementation follows the explicit per-component prescription, which is the correct behavior. The spec needs a correction; the implementation does not.

No arbitrary inline `[N]px` values (Tailwind-style) or non-scale values were introduced beyond what the spec explicitly prescribes.

---

### Pillar 6: Experience Design (2/4)

**BLOCKER — PieceRenderer: no visual affordance when piece is action-selectable**
As detailed under Visuals: `isActionSelectable` is computed but only wires `cursor: grab`. The green pulse that communicates "you can play this" to the player is missing for all piece types on grid boards. This is a task-completion issue for games where pieces on grid cells are the primary interaction target — players will not see which pieces they can pick up.

**WARNING — Null/empty `gameView` renders blank layout, no loading state**
`AutoRenderer.vue:121-129`: when `gameView` is `null`, `topLevelChildren` is `[]`, archetype resolves to `'tableau'` (no elements match grid-board or card archetypes), and `TableauTemplate` renders an empty `<div class="tableau-template">`. Users see nothing during game state load. An explicit `v-if="!gameView"` branch with a loading indicator should precede the archetype dispatch.

**WARNING — ElementRenderer silently renders nothing on unknown element type** (`renderers/ElementRenderer.vue:40-44`)
When `resolveRenderer(element)` returns `null` (no registered renderer matches), the component renders nothing — no fallback visual, no error indicator. The comment acknowledges this is "intentional during the renderer rebuild phase" but the built-in registration guarantees mean a null return in production would silently swallow an element. Game authors adding a novel element type they forgot to register would see nothing, with no console warning here.

**PASS — Error boundary states**
Grid error panel covers the `resolveGridSize` failure path cleanly. UnsupportedTopologyPanel covers the free-form topology path. Animation event absence handled gracefully (`useAutoRendererAnimations.ts:44`).

**PASS — Empty states**
Deck empty state ("Empty" italic), hand empty state ("No cards"), and empty grid cells all render as intended.

**PASS — Dragging/drop states**
`CardRenderer`, `PieceRenderer`, and `GridBoardRenderer` all wire the `drag-drop.css` CSS vars correctly (`--bs-drop-target-bg`, `--bs-drop-hover-bg`) via class binding without redefining them.

**PASS — Animation wiring**
`useAutoRendererAnimations` registers `deal`, `flip`, and `reveal` handlers. Each handler guards `signal.aborted` before awaiting. Defensive access on `event.data` properties. `FlyingCardsOverlay` is mounted inside `AutoRenderer.vue`'s template.

---

## Files Audited

- `src/ui/components/auto-ui/AutoRenderer.vue`
- `src/ui/components/auto-ui/renderers/CardRenderer.vue`
- `src/ui/components/auto-ui/renderers/HandRenderer.vue`
- `src/ui/components/auto-ui/renderers/DeckRenderer.vue`
- `src/ui/components/auto-ui/renderers/GridBoardRenderer.vue`
- `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue`
- `src/ui/components/auto-ui/renderers/PieceRenderer.vue`
- `src/ui/components/auto-ui/renderers/SpaceRenderer.vue`
- `src/ui/components/auto-ui/renderers/DieRenderer.vue`
- `src/ui/components/auto-ui/renderers/ElementRenderer.vue`
- `src/ui/components/auto-ui/archetypes/GridBoardTemplate.vue`
- `src/ui/components/auto-ui/archetypes/CardTemplate.vue`
- `src/ui/components/auto-ui/archetypes/TableauTemplate.vue`
- `src/ui/components/auto-ui/archetypes/UnsupportedTopologyPanel.vue`
- `src/ui/components/auto-ui/useAutoRendererAnimations.ts`
- `src/ui/components/auto-ui/auto-ui-helpers.ts` (lines 160-169)
- `.planning/phases/93-renderer-rebuild/93-UI-SPEC.md`
- `.planning/phases/93-renderer-rebuild/93-UI-CARRYFORWARD.md`
- `.planning/phases/93-renderer-rebuild/93-CONTEXT.md`

---

## Priority Fixes (with concrete steps)

1. **`renderers/PieceRenderer.vue` — Add `action-selectable` class and CSS rule.** In the template div class binding (`line 85`), add `'action-selectable': isActionSelectable` alongside the existing `is-draggable` entry. Add a `.piece.action-selectable` scoped CSS rule with `outline: 2px solid rgba(46, 204, 113, 0.6); outline-offset: 2px; animation: pulse-piece 2s ease-in-out infinite;` plus the corresponding `@keyframes pulse-piece`. Also update `.piece` transition to `transition: transform 0.2s ease, box-shadow 0.2s ease;`.

2. **`AutoRenderer.vue` — Handle null `gameView` with a visible empty/loading state.** Before the archetype template dispatch in the template, add `<div v-if="!gameView" class="auto-renderer__empty">` rendering a centered "Waiting for game…" or skeleton indicator. Add `.auto-renderer__empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #aaa; }` to the scoped style.

3. **`renderers/HandRenderer.vue` line 242-244 — Respect element.name in the header.** Replace the static label with `{{ element.name ?? (isOwned ? 'Your Hand' : `${playerName}'s Hand`) }}`. This makes the element's declared name the primary label and falls back to the seat-derived label only when the game designer didn't name the hand, honoring the spec contract and avoiding silently discarding game-defined names.
