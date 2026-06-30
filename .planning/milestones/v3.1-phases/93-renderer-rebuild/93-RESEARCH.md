# Phase 93: Renderer Rebuild - Research

**Researched:** 2026-06-21
**Domain:** Vue 3 UI renderer architecture — ranked-tester registry, archetype templates, closed-form grid/hex layout, animation event wiring
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Delete `AutoElement.vue` + `AutoGameBoard.vue` in Phase 93. New renderer wired into `AutoUI.vue` immediately — no dual path, no dormant legacy files.

**D-02:** Topology-ranked archetype selection:
- Grid/Hex board present → **grid-board** template
- Dominant card/hand zones → **card** template
- Otherwise → **tableau** template
- Topologies outside grid/hex/stack/hand → **loud unsupported-topology panel** (never a degraded guess or equal-space subdivision)

**D-03:** Module-level singleton registry. Public API: `registerRenderer({ test: (element) => priority, component })` exported from `boardsmith/ui`. Built-ins at low priority; consumer registers higher priority to upgrade in place. `test` returns `-1` for not-applicable; highest priority wins (JSONForms `rankWith` pattern). NOT the custom-UI path — custom UIs are peer components.

**D-04:** Phase 93 = pure render + animation. Existing footer ActionPanel and current board interaction keep driving play unchanged. Substrate tests staying green is proof the substrate is untouched. Board-centric interaction, multi-ref highlight, suppressible panel, `protocol.ts` edits → Phase 94.

### Claude's Discretion

- Component decomposition (board host + archetype templates + per-element renderers + registry module + layout composables)
- File/dir layout under `src/ui/.../auto-ui/`
- Built-in priority band values
- Exact template hierarchy CSS

Reuse Phase 92's `resolvePieceVisual` / `resolveGridSize` helpers — do not re-implement. Closed-form layout MUST go through `useGameGrid`/`useHexGrid` math (RENDER-04).

### Deferred Ideas (OUT OF SCOPE)

- Board-centric interaction, multi-ref highlight, suppressible ActionPanel, `protocol.ts` multi-ref → Phase 94
- Per-UI presentation overlay (C7) → Phase 94
- General percentage-relative layout solver (S2), responsive primitives (S2b), phase/scoring renderers (S7), N-UI registry + live switcher (S12c), auto-eject (S10) → later milestone
- Split-screen scaffold removal + cross-repo migration + old-file straggler check → Phase 95/96
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RENDER-01 | New renderer replaces `AutoElement.vue` + `AutoGameBoard.vue` while reusing the interaction substrate (`useActionController`, `useBoardInteraction`, drag orchestration, FLIP/flying primitives) unchanged except where INTERACT requires. | §Substrate Preservation: substrate composables untouched; substrate tests identified; integration point in AutoUI.vue confirmed. |
| RENDER-02 | Element renderers dispatched via ranked-tester registry; higher-priority renderer can be registered to upgrade auto-UI in place. | §Registry Pattern: module-level singleton design documented with priority semantics and public API signature. |
| RENDER-03 | Board laid out by introspection-selected archetype template encoding visual hierarchy — not equal-space subdivision. | §Archetype Selection: introspection algorithm documented; three templates + honest-fail panel confirmed. |
| RENDER-04 | Grid and hex layouts use closed-form math (`useGameGrid`/`useHexGrid`); auto-UI scope bounded to coordinate-addressable topologies; fails honestly outside it. | §Closed-Form Layout: both composable APIs documented; standalone functions identified; `resolveGridSize` confirmed reusable. |
| RENDER-05 | New renderer consumes `useAnimationEvents` so deal/flip/reveal choreography plays. | §Animation Wiring: `createAnimationEvents`/`useAnimationEvents` API documented; event type semantics and registration pattern confirmed. |
</phase_requirements>

---

## Summary

Phase 93 deletes two large files (`AutoElement.vue` ~2355 lines, `AutoGameBoard.vue` ~503 lines) and replaces them with a structured renderer consisting of: a module-level singleton registry (RENDER-02), three archetype templates selected by introspection (RENDER-03), per-element renderer components dispatched through the registry, and explicit animation event wiring (RENDER-05). The interaction substrate — `useActionController`, `useBoardInteraction`, drag-drop, FLIP, flying elements — is reused completely unchanged; only `AutoUI.vue` gets a one-line import change.

All Phase 92 helpers (`resolvePieceVisual`, `resolveGridSize` from `auto-ui-helpers.ts`) are in production-ready shape and confirmed available at the expected path. The `useHexGrid` and `useGameGrid` composables provide all closed-form layout math needed (RENDER-04). The `useAnimationEvents` composable is already provided by GameShell via Vue injection — the new renderer simply calls `useAnimationEvents()` and registers handlers for 'deal', 'flip', and 'reveal' event types (RENDER-05).

The phase has no external package dependencies — it is a pure internal refactor of Vue SFCs and TypeScript modules within the existing tech stack (TypeScript 5.7, Vue 3.5, Vitest).

**Primary recommendation:** Build the registry and archetype selection as pure TypeScript modules (no Vue reactivity), then compose them in Vue SFCs. This makes every critical path unit-testable without a component harness.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Registry dispatch (RENDER-02) | Frontend (renderer module) | — | Pure runtime logic; no server involvement |
| Archetype selection by introspection | Frontend (renderer) | — | Reads `gameView` tree, selects Vue template |
| Grid CSS layout | Frontend (renderer) | — | CSS `grid-template-columns` + cell `grid-row`/`grid-column` |
| Hex SVG layout | Frontend (renderer) | — | Closed-form axial→pixel math, SVG viewport |
| Animation event consumption (RENDER-05) | Frontend (renderer) | GameShell (provider) | GameShell provides; renderer injects and registers handlers |
| Action state machine | Frontend (substrate) | — | `useActionController` — UNCHANGED; stays in GameShell context |
| Board click/highlight/drag interaction | Frontend (substrate) | — | `useBoardInteraction` — UNCHANGED; new renderer calls same APIs |
| Honest-fail boundary panel | Frontend (renderer) | — | Inline panel inside archetype template; no new composable needed |

---

## Standard Stack

### Core (no new packages — all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | 3.5.x | SFC composition, `provide`/`inject`, `computed` | Project standard |
| TypeScript | 5.7 | Type safety, discriminated unions for registry | Project standard |
| Vitest | latest | Unit tests for registry, archetype selector | Project standard — `npm test` |

### Existing Composables / Helpers (REUSE, DO NOT RE-IMPLEMENT)

| Module | Path | Purpose |
|--------|------|---------|
| `resolvePieceVisual` | `src/ui/components/auto-ui/auto-ui-helpers.ts` | Piece visual discriminated union |
| `resolveGridSize` | `src/ui/components/auto-ui/auto-ui-helpers.ts` | Grid rows/cols or error |
| `hexToPixel` | `src/ui/composables/useHexGrid.ts` | Standalone axial→pixel (no Vue) |
| `getHexPolygonPoints` | `src/ui/composables/useHexGrid.ts` | SVG polygon string (no Vue) |
| `useHexGrid` | `src/ui/composables/useHexGrid.ts` | Full reactive hex composable (bounds, cell map) |
| `useGameGrid` | `src/ui/composables/useGameGrid.ts` | Reactive grid composable (cell navigation) |
| `useAnimationEvents` | `src/ui/composables/useAnimationEvents.ts` | Inject animation event controller |
| `useFlyingElements` | `src/ui/composables/useFlyingElements.ts` | Flying card/element animations |
| `useFLIP` / FLIP primitives | `src/ui/composables/useFLIP.ts` | Element-movement FLIP animations |
| `tryUseBoardInteraction` | `src/ui/composables/useBoardInteraction.ts` | Board highlight/select/drag state |
| `setTransformAwareDragImage` | `src/ui/composables/dragImage.ts` | Drag ghost image |
| `Die3D` | `src/ui/components/dice/index.ts` | 3D die rendering |
| `FlyingCardsOverlay` | `src/ui/components/helpers/index.js` | Overlay for flying animations |

### No New Packages
This phase installs zero new npm packages.

---

## Package Legitimacy Audit

No packages to audit — Phase 93 installs no external dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
GameShell (root host)
  │  provides: BoardInteraction, ActionController, AnimationEvents
  │
  ▼
AutoUI.vue  ──imports──►  AutoRenderer.vue (NEW — replaces AutoGameBoard.vue)
                               │
                    ┌──────────┴──────────────┐
                    │  1. introspect gameView  │
                    │  2. select archetype     │
                    │  3. wire animation events│
                    └──────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    GridBoardTemplate    CardTemplate     TableauTemplate
    (focal board +       (card/hand       (general
     docked hand +        dominant)        containers)
     peripheral)
              │
              ▼ (for each element in tree)
    ElementRenderer.vue  ──► renderer-registry.ts
         │                      (resolveRenderer(element))
         │                           │
         │        ┌──────────────────┴───────────┐
         ▼        ▼                              ▼
    [resolved    GridBoardRenderer  HexBoardRenderer
     component]  (resolveGridSize   (hexToPixel /
                  → CSS grid)        getHexPolygonPoints)
                                     
    CardRenderer  HandRenderer  DeckRenderer  PieceRenderer
    DieRenderer   SpaceRenderer              (resolvePieceVisual)

──── data flow (gameView tree)  ───►
◄─── events (animation, click, drag)
```

### Recommended Project Structure

```
src/ui/components/auto-ui/
  AutoUI.vue                    (unchanged — update AutoGameBoard → AutoRenderer import)
  ActionPanel.vue               (unchanged)
  auto-ui-helpers.ts            (unchanged — Phase 92 output)
  auto-ui-helpers.test.ts       (unchanged)
  index.ts                      (update: remove AutoElement/AutoGameBoard, add AutoRenderer)
  renderer-registry.ts          (NEW — singleton registry, registerRenderer)
  AutoRenderer.vue              (NEW — replaces AutoGameBoard.vue)
  archetypes/
    GridBoardTemplate.vue       (NEW — focal board + docked hand + peripheral chrome)
    CardTemplate.vue            (NEW — card/hand dominant layout)
    TableauTemplate.vue         (NEW — general container fallback)
    UnsupportedTopologyPanel.vue (NEW — honest-fail for free-form/unaddressable)
  renderers/
    ElementRenderer.vue         (NEW — registry dispatch wrapper)
    CardRenderer.vue            (NEW)
    HandRenderer.vue            (NEW)
    DeckRenderer.vue            (NEW)
    DieRenderer.vue             (NEW — reuse Die3D)
    GridBoardRenderer.vue       (NEW — resolveGridSize + CSS grid)
    HexBoardRenderer.vue        (NEW — useHexGrid math + SVG)
    PieceRenderer.vue           (NEW — resolvePieceVisual)
    SpaceRenderer.vue           (NEW — generic fallback)
```

### Pattern 1: Ranked-Tester Registry

**What:** Module-level singleton array of `{test, component}` entries. `registerRenderer` pushes entries; `resolveRenderer` finds the entry with the highest positive `test(element)` result.

**When to use:** Every auto-UI element render passes through this. Built-ins register at boot; consumers call `registerRenderer` from their game setup to upgrade specific element types.

**Implementation:**
```typescript
// renderer-registry.ts — [ASSUMED: exact naming at planner's discretion]
import type { Component } from 'vue';
import type { GameElement } from '../types.js';

export interface RendererEntry {
  test: (element: GameElement) => number;  // -1 = N/A; >0 = priority
  component: Component;
}

const registry: RendererEntry[] = [];

export function registerRenderer(entry: RendererEntry): void {
  registry.push(entry);
}

export function resolveRenderer(element: GameElement): Component | null {
  let bestPriority = -1;
  let bestComponent: Component | null = null;
  for (const entry of registry) {
    const priority = entry.test(element);
    if (priority > bestPriority) {
      bestPriority = priority;
      bestComponent = entry.component;
    }
  }
  return bestComponent;
}
```

**Built-in priority bands (planner's discretion for exact values):**
- `1..10` — low-priority built-ins (card, hand, deck, die, grid, hex, piece, space)
- `11..99` — reserved for future built-in specializations
- `100+` — consumer overrides (registered by game authors)

**Source:** CONTEXT.md D-03, docs/auto-ui-redesign-research.md §3

### Pattern 2: Archetype Selection by Introspection

**What:** Pure function that inspects the top-level children of the game view root and returns an archetype identifier.

**When to use:** Once per `gameView` update in `AutoRenderer.vue`.

**Logic:**
```typescript
// [ASSUMED: exact function name/location at planner's discretion]
type Archetype = 'grid-board' | 'card' | 'tableau' | 'unsupported';

function selectArchetype(topLevelElements: GameElement[]): Archetype {
  // 1. Grid or hex board present → grid-board (highest priority)
  const hasGridOrHex = topLevelElements.some(
    el => el.attributes?.$layout === 'grid' || el.attributes?.$layout === 'hex-grid'
  );
  if (hasGridOrHex) return 'grid-board';

  // 2. Dominant card/hand zones → card
  const cardTypes = new Set(['card', 'hand', 'deck']);
  const cardCount = topLevelElements.filter(
    el => cardTypes.has(el.attributes?.$type as string)
  ).length;
  if (cardCount > 0 && cardCount >= topLevelElements.length / 2) return 'card';

  // 3. Free-form layout (unaddressable) → unsupported
  const hasFreeForm = topLevelElements.some(
    el => el.attributes?.$layout === 'free-form'
  );
  if (hasFreeForm) return 'unsupported';

  // 4. General containers → tableau
  return 'tableau';
}
```

**Source:** CONTEXT.md D-02; docs/auto-ui-redesign-research.md §0

### Pattern 3: Animation Event Wiring

**What:** The new renderer injects the `UseAnimationEventsReturn` instance provided by GameShell and registers handlers for semantic animation event types.

**When to use:** In `onMounted` of `AutoRenderer.vue` (or via `watchEffect` after injection).

**Key constraint:** `useAnimationEvents()` returns `undefined` if GameShell hasn't provided it. Handler must be defensive:

```typescript
// Inside AutoRenderer.vue setup — [ASSUMED: exact event types]
import { useAnimationEvents } from '../../composables/useAnimationEvents.js';
import { useFlyingElements } from '../../composables/useFlyingElements.js';

const animationEvents = useAnimationEvents();
const { fly } = useFlyingElements();

if (animationEvents) {
  // 'deal' — card flies from deck to destination zone
  animationEvents.registerHandler('deal', async (event, { signal }) => {
    // drive fly() from source to destination using event.data
    if (signal.aborted) return;
    await fly({ ... });
  }, { skip: 'drop' });

  // 'flip' — card flips (back→face)
  animationEvents.registerHandler('flip', async (event, { signal }) => {
    // drive CSS flip animation on element by id
  }, { skip: 'run' }); // run on skip to sync state

  // 'reveal' — card becomes visible to this player
  animationEvents.registerHandler('reveal', async (event, { signal }) => {
    // drive fly + flip combo
  }, { skip: 'drop' });
}
```

**Event data shape:** `AnimationEvent` from `src/engine/index.ts` has `{ id: number, type: string, data: Record<string, unknown>, timestamp: number }`. The `data` payload structure for 'deal'/'flip'/'reveal' is game-defined — the handler must read it tolerantly. [ASSUMED: planner may need to check what game.animate('deal', data) sends in the gate games]

**Source:** `src/ui/composables/useAnimationEvents.ts` (verified); CONTEXT.md D-04 C1 correction

### Pattern 4: Closed-Form Grid Layout

**What:** CSS grid layout driven by `resolveGridSize(element)` for column count, then per-cell `grid-row`/`grid-column` CSS properties derived from cell coordinate attributes.

**Source:** `src/ui/components/auto-ui/auto-ui-helpers.ts` (verified)

```typescript
// GridBoardRenderer.vue — [ASSUMED: template detail]
const gridResult = computed(() => resolveGridSize(props.element));

// Template:
// v-if="gridResult.ok"
// :style="{ 'grid-template-columns': `repeat(${gridResult.cols}, 1fr)` }"
//
// Per-cell styling reads attrs[rowCoord] + 1, attrs[colCoord] + 1
// (same logic already in AutoElement.vue grid-cell rendering, lines 1147-1153)
```

**Provide pattern for coordinate names:** GridBoardRenderer provides `{rowCoord, colCoord}` via Vue `provide`; child cell components inject and use for positioning. This is identical to the existing `parentGridCoords` provide/inject in AutoElement.vue.

### Pattern 5: Closed-Form Hex Layout

**What:** SVG rendering using the standalone functions from `useHexGrid.ts` — no reactive composable needed inside the renderer since the element is already in hand.

**Source:** `src/ui/composables/useHexGrid.ts` (verified)

```typescript
import { hexToPixel, getHexPolygonPoints } from '../../composables/useHexGrid.js';

// In HexBoardRenderer.vue:
const hexSize = computed(() => (props.element.attributes?.$hexSize as number) ?? 50);
const orientation = computed(() => 
  (props.element.attributes?.$hexOrientation as 'flat' | 'pointy') ?? 'pointy'
);

function getCellPosition(cell: GameElement) {
  const q = cell.attributes?.[qCoord] as number ?? 0;
  const r = cell.attributes?.[rCoord] as number ?? 0;
  return hexToPixel(q, r, hexSize.value, orientation.value);
}

const hexPoints = computed(() => getHexPolygonPoints(hexSize.value, orientation.value));
```

**Bounds computation:** Use `useHexGrid` composable's `hexGridBounds` computed if a reactive bounds reference is needed, or compute inline as AutoElement.vue does (same algorithm, lines 684-719).

### Anti-Patterns to Avoid

- **Equal-space subdivision (C6):** Never let the archetype template divide all elements into equal grid cells by count. GridBoardTemplate must encode a **focal-board area** (grid/hex takes the main area) and a **docked hand strip** (hands dock at bottom). CardTemplate must not treat the board as "one box per element."
- **Elementtype if/else cascade:** Never add `if (elementType === 'x') ... else if (elementType === 'y')` chains. All dispatch goes through the registry.
- **Hand-rolling hex math:** Import `hexToPixel`/`getHexPolygonPoints` from `useHexGrid.ts`. Do not copy-paste the axial formulas.
- **Modifying substrate files:** Do not touch `useActionController.ts`, `useBoardInteraction.ts`, `useDragDrop.ts`, `useFLIP.ts`, `useFlyingElements.ts`, or their tests. If anything in those files needs to change for rendering, that signals a Phase 94 concern.
- **Calling `createAnimationEvents` in the renderer:** Only GameShell calls `createAnimationEvents` + `provideAnimationEvents`. The renderer calls `useAnimationEvents()` (inject only).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Piece image resolution | Custom image/sprite extraction | `resolvePieceVisual(element)` from `auto-ui-helpers.ts` | Phase 92 already handles string URL, sprite-sheet, token fallback with correct defaults |
| Grid size computation | Re-implement row/col inference | `resolveGridSize(element)` from `auto-ui-helpers.ts` | Handles explicit coords, inference from first child, and loud error path |
| Hex axial→pixel math | New trigonometric formulas | `hexToPixel(q, r, hexSize, orientation)` from `useHexGrid.ts` | Verified against Red Blob Games; orientation-aware |
| Hex SVG polygon points | Generate 6 points manually | `getHexPolygonPoints(hexSize, orientation, scale?)` from `useHexGrid.ts` | Handles pointy/flat, optional scale for inner hex |
| Animation event sequencing | Custom queue/handler system | `useAnimationEvents()` (inject) + `registerHandler` | Handles wait-for-handler, skip-all, AbortSignal, timeout warnings |
| Flying card animations | Custom flying overlay | `useFlyingElements()` from existing composable | v2.6 consolidated API; handles cross-container, routes, visibility |
| Board click/drag state | New click handler tree | `tryUseBoardInteraction()` inject + call its methods | Parity guarantee with ActionPanel enforced here |

**Key insight:** The Phase 92 helpers and existing composables cover every hard problem. New code in Phase 93 is glue (registry, archetype selection, template CSS) — not algorithms.

---

## Code Discovery: Files Being Deleted

### `src/ui/components/auto-ui/AutoElement.vue` (2355 lines) [VERIFIED: read]

Currently handles ALL of: card, hand, deck, die, dice-pool, board (grid), grid-cell, hex-board, hex-cell, piece, space — in a single massive `v-if/v-else-if` cascade in the template. It also handles all board interaction state (10+ computeds for selectable/selected/highlighted/draggable), drag event handlers, zoom preview data attributes, and hex position math.

**What Phase 93 takes from it (reuses/extracts):**
- `elementType` computed logic → becomes the registry `test` functions for built-in renderers
- Board interaction computed props (`isSelectable`, `isBoardHighlighted`, `isDragged`, etc.) → moved into per-element renderer components verbatim (same inject calls, same `tryUseBoardInteraction()` API)
- Hex position calculation (lines 659-670) → replaced by `hexToPixel` from useHexGrid.ts
- Grid cell positioning (lines 1147-1153) → kept in GridCellRenderer, same logic
- Provide/inject of `gridCoords` (lines 76-82) → kept in GridBoardRenderer
- Provide/inject of `hexGridProps` (lines 674-681) → replaced by HexBoardRenderer providing via useHexGrid
- `pieceVisual` computed (line 615) → calls `resolvePieceVisual`, kept
- `gridResult` computed (line 609-611) → calls `resolveGridSize`, kept

**What is replaced:**
- The `v-if` cascade → registry dispatch
- The hand sorting / two-row logic → HandRenderer.vue
- The deck stack / childCount display → DeckRenderer.vue
- The card image / sprite rendering → CardRenderer.vue
- The hex SVG construction → HexBoardRenderer.vue

### `src/ui/components/auto-ui/AutoGameBoard.vue` (503 lines) [VERIFIED: read]

Handles: top-level layout detection (`layoutClass`), FLIP + fly animation watching (lines 148-438), provides `playerSeat`/`selectableElements`/`selectedElements`/`defaultBackImage` to the tree, renders `<AutoElement>` for each top-level child.

**What Phase 93 takes from it:**
- `provide('playerSeat', ...)`, `provide('selectableElements', ...)`, `provide('selectedElements', ...)`, `provide('defaultBackImage', ...)` → moved to `AutoRenderer.vue` verbatim
- `findDefaultBackImage(element)` helper function → moved to `AutoRenderer.vue`
- `FlyingCardsOverlay` usage → kept in `AutoRenderer.vue`
- FLIP + fly watching pattern (watch gameView, capturePositions, animateMovements) → replaced by explicit `useAnimationEvents` handlers in `AutoRenderer.vue`

**What is replaced:**
- Heuristic visibility tracking (`collectElementState`, `zoneChildCount`) → animation events provide semantic 'deal'/'flip'/'reveal' instead
- Brittle `findContainerByName` + DOM querying for animation targets → event data provides element IDs
- `layoutClass` heuristic → archetype selection (introspection-driven)

---

## Integration Point: AutoUI.vue

`AutoUI.vue` is 71 lines [VERIFIED: read]. It imports `AutoGameBoard` and renders it inside `<div class="auto-ui">`. The only change needed:

```diff
- import AutoGameBoard from './AutoGameBoard.vue';
+ import AutoRenderer from './AutoRenderer.vue';
```

And in template:
```diff
- <AutoGameBoard
+ <AutoRenderer
    :game-view="gameView"
    :player-seat="playerSeat"
  />
```

The `flowState?.complete` banner and `game-complete` slot remain unchanged.

---

## Engine Element Topology Reference

The renderer reads these `$`-prefixed attributes from the serialized `GameElement.attributes` object: [VERIFIED: read engine element source files + SAFE_LAYOUT_KEYS whitelist in game.ts]

| Element Class | Detection | Key Attributes |
|---------------|-----------|----------------|
| `Card` | `$type === 'card'` | `$images: {face, back}` (URL or sprite obj) |
| `Hand` | `$type === 'hand'` | `$direction = 'horizontal'`, `$fan = true`, `$fanAngle = 30` |
| `Deck` | `$type === 'deck'` | `$direction = 'vertical'` |
| `Die` | `$type === 'die'` | `sides`, `value`, `color`, `rolling`, `rollCount`, `faceLabels`, `faceImages` |
| `DicePool` | `$type === 'dice-pool'` | children are Die elements |
| `Grid` | `$layout === 'grid'` | `$rowCoord?`, `$colCoord?`, `$rowLabels?`, `$columnLabels?` |
| `HexGrid` | `$layout === 'hex-grid'` | `$hexOrientation`, `$qCoord?`, `$rCoord?`, `$hexSize?` |
| `HexCell` | `$type === 'hex-cell'` | coordinates from parent's `$qCoord`/`$rCoord` attrs |
| `GridCell` | implicit: has numeric coords at depth>0 | row/col values from parent's `$rowCoord`/`$colCoord` |
| `Space` | fallback | `$direction?`, `$fan?`, `$fanAngle?`, `$overlap?`, `$gap?`, `$align?` |
| `Piece` | implicit: leaf node at depth>0, no `$type` | `$images?` (same format as Card), `attributes.player?: {color, seat, name}` |

**$-whitelist (SAFE_LAYOUT_KEYS in game.ts, line 239-245):** `$type`, `$layout`, `$direction`, `$gap`, `$overlap`, `$fan`, `$fanAngle`, `$align`, `$rowLabels`, `$columnLabels`, `$rowCoord`, `$colCoord`, `$hexOrientation`, `$coordSystem`, `$qCoord`, `$rCoord`, `$sCoord`, `$hexSize` — these survive `toJSONForPlayer` on hidden elements. `$images` is handled separately (face URL redacted for non-visible elements per SEC-01 work in Phase 91).

---

## Substrate Preservation: Exact Files, Methods, Tests

### Files the New Renderer CALLS (inject/use — do not modify)

| File | What's Used | How |
|------|-------------|-----|
| `src/ui/composables/useBoardInteraction.ts` | `tryUseBoardInteraction()`, `.isSelectableElement()`, `.isHighlighted()`, `.isSelected()`, `.isValidTarget()`, `.isDisabledElement()`, `.isDraggableSelectedElement()`, `.triggerElementSelect()`, `.selectElement()`, `.startDrag()`, `.endDrag()`, `.isDragging` | Inject in each per-element renderer (same calls as AutoElement.vue) |
| `src/ui/composables/useFlyingElements.ts` | `useFlyingElements()`, `.fly()` | In AutoRenderer.vue for animation handler bodies |
| `src/ui/composables/useFLIP.ts` | FLIP utilities | For element-movement animations |
| `src/ui/composables/useAnimationEvents.ts` | `useAnimationEvents()` (inject only) | In AutoRenderer.vue |
| `src/ui/composables/dragImage.ts` | `setTransformAwareDragImage` | In drag-capable element renderers |

### Substrate Test Files (MUST stay GREEN — these are the proof)

| Test File | What It Proves |
|-----------|----------------|
| `src/ui/composables/useActionController.test.ts` | Action state machine untouched |
| `src/ui/composables/useActionController.picks.test.ts` | Pick/selection flows untouched |
| `src/ui/composables/useBoardInteraction.test.ts` | Board↔panel bridge untouched |
| `src/ui/composables/useDragDropTargets.test.ts` | Drag orchestration untouched |
| `src/ui/composables/useAnimationEvents.test.ts` | Animation event queue untouched |
| `src/ui/composables/useGameViewEnrichment.test.ts` | Game view helpers untouched |
| `src/ui/components/auto-ui/auto-ui-helpers.test.ts` | Phase 92 helpers untouched (REUSE proof) |

---

## Export Changes Required

### `src/ui/components/auto-ui/index.ts` (currently 19 lines)

```diff
- export { default as AutoElement } from './AutoElement.vue';
- export { default as AutoGameBoard } from './AutoGameBoard.vue';
+ export { default as AutoRenderer } from './AutoRenderer.vue';
+ export { registerRenderer, resolveRenderer } from './renderer-registry.js';
```

`AutoUI` and `ActionPanel` exports remain unchanged.

### `src/ui/index.ts`

Add to the existing exports (the `boardsmith/ui` subpath):
```typescript
export { registerRenderer } from './components/auto-ui/renderer-registry.js';
```

`resolveRenderer` is internal; only `registerRenderer` is public API per D-03.

---

## Common Pitfalls

### Pitfall 1: Modifying Substrate Composables
**What goes wrong:** The plan adds a parameter to `useBoardInteraction.ts` or `useDragDrop.ts` "just for this renderer." The substrate test suite catches it; more importantly, the No Backward Compatibility rule requires the change to be complete cross-repo before Phase 93 is done — but cross-repo changes are deferred to Phase 96.
**Why it happens:** The new renderer feels like it needs a new capability (e.g., multi-ref highlighting). That's Phase 94.
**How to avoid:** If a renderer component needs something from the substrate that doesn't exist, mark it as a Phase 94 stub and move on.
**Warning signs:** Any import of a substrate composable paired with a modification to that composable's signature.

### Pitfall 2: Creating `createAnimationEvents` in AutoRenderer
**What goes wrong:** `createAnimationEvents` is called inside AutoRenderer.vue, creating a second independent animation queue alongside GameShell's. Events get consumed by neither or both.
**Why it happens:** The composable's name reads as "use this to set up animation events," but `create*` is the setup call (root only); `use*` is the consumer call (any child).
**How to avoid:** AutoRenderer.vue only calls `useAnimationEvents()` (inject). It never calls `createAnimationEvents`.
**Warning signs:** `import { createAnimationEvents }` in any renderer component.

### Pitfall 3: Animation Event Data Shape Assumptions
**What goes wrong:** The 'deal' handler assumes `event.data.sourceElementId` exists, but the gate games use `event.data.cardId`. The handler silently does nothing.
**Why it happens:** The `AnimationEvent.data` is `Record<string, unknown>` — no schema enforcement.
**How to avoid:** Before writing handlers, check what the gate games (Go Fish, Checkers, Hex) actually pass in `game.animate('deal', data)`. Use defensive access (`event.data?.sourceId ?? event.data?.elementId`). If handlers can't be verified, implement them with a fallback (e.g., skip animation if data is incomplete).
**Warning signs:** Handlers that never fire during testing because `event.data` shape didn't match.

### Pitfall 4: Archetype Selection Breaking When Game Has Mixed Elements
**What goes wrong:** A game with both a Grid and some Card elements above the grid in the tree gets classified as 'card' instead of 'grid-board' because the card-count heuristic runs before checking for grid.
**Why it happens:** Wrong evaluation order in `selectArchetype`.
**How to avoid:** Grid/hex detection ALWAYS has highest priority in the selection order (D-02 specifies this explicitly). Card dominance is only checked after confirming no grid/hex exists.

### Pitfall 5: Registry Built-ins Not Registered at Module Load
**What goes wrong:** `resolveRenderer(element)` returns `null` because `registry` is empty — built-in renderers aren't registered yet.
**Why it happens:** Built-in registrations happen inside component `setup()` blocks (each component calls `registerRenderer` on mount) instead of at module load time.
**How to avoid:** Built-in `registerRenderer` calls go at module top-level in `renderer-registry.ts` (or in an init function that `AutoRenderer.vue` calls once at its own module load). Not inside `onMounted`.

### Pitfall 6: Two-Row Hand Logic Duplication
**What goes wrong:** HandRenderer.vue re-implements the `sortedHandCards` / `backRowCards` / `frontRowCards` logic, drifting from the AutoElement.vue original.
**Why it happens:** The plan says "delete AutoElement.vue" without noting that this specific hand-layout logic needs to move, not be reinvented.
**How to avoid:** Copy the hand sorting + two-row logic from AutoElement.vue lines 409-453 into HandRenderer.vue during the delete-and-replace step.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (inferred from vitest.config.ts, verified) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/ui/` |
| Substrate-only command | `npx vitest run src/ui/composables/useActionController.test.ts src/ui/composables/useBoardInteraction.test.ts src/ui/composables/useDragDropTargets.test.ts src/ui/composables/useAnimationEvents.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RENDER-01 | Substrate tests unchanged (proof of no regression) | unit | `npx vitest run src/ui/composables/useActionController.test.ts src/ui/composables/useBoardInteraction.test.ts src/ui/composables/useDragDropTargets.test.ts` | ✅ existing |
| RENDER-02 | Registry: highest priority wins; -1 is skipped; empty registry returns null | unit | `npx vitest run src/ui/components/auto-ui/renderer-registry.test.ts` | ❌ Wave 0 |
| RENDER-03 | Archetype selector: grid/hex → grid-board; card-dominant → card; mixed → tableau; free-form → unsupported | unit | `npx vitest run src/ui/components/auto-ui/archetype-selector.test.ts` | ❌ Wave 0 |
| RENDER-04 | `resolveGridSize` returns correct rows/cols (covered); hex position math matches expected pixels | unit | `npx vitest run src/ui/components/auto-ui/auto-ui-helpers.test.ts` | ✅ existing (grid); ❌ hex test Wave 0 |
| RENDER-05 | Animation handler registered for 'deal'/'flip'/'reveal'; called when event fires; handles undefined instance gracefully | unit | `npx vitest run src/ui/components/auto-ui/AutoRenderer.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/ui/`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + browser-verify Hex game is playable before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/ui/components/auto-ui/renderer-registry.test.ts` — covers RENDER-02 (priority dispatch, `-1` skip, empty fallback, consumer override at 100+)
- [ ] `src/ui/components/auto-ui/archetype-selector.test.ts` — covers RENDER-03 (all four archetype paths)
- [ ] `src/ui/components/auto-ui/AutoRenderer.test.ts` — covers RENDER-05 (animation handler wiring, `undefined` graceful handling)

---

## Security Domain

`security_enforcement` not explicitly set in `.planning/config.json` — treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Renderer is client-only, auth is session-layer |
| V3 Session Management | No | Session managed upstream |
| V4 Access Control | No | Visibility filtering is engine-layer (`toJSONForPlayer`) |
| V5 Input Validation | Partial | Element data comes from `toJSONForPlayer` (already filtered). Renderer reads `attributes` defensively — use `as unknown` type assertions with explicit null checks, never direct property access without guard. |
| V6 Cryptography | No | No cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via element name/label in template | Tampering | Vue template auto-escapes text interpolation (`{{ displayLabel }}`). Never use `v-html` with element attributes. |
| `$images` URL injection | Tampering | Images are rendered via `<img :src="...">` — browser handles URL safely. Do not construct `<style>` tags from image URLs. |
| Registry pollution (consumer registers infinite-priority renderer) | Tampering | The registry is code-only (not data-driven from the server). Consumer entries are authored TypeScript, same trust level as any game code. |

### Phase 93 Security Notes

- The `$images.face` leak (SEC-01) is being fixed in Phase 91 independently. Phase 93 consumes `$images.face` only when `!element.__hidden` — same guard as AutoElement.vue today. If Phase 91 lands first, the fix is transparent; if it hasn't, Phase 93 has the same exposure as the current code.
- The `registerRenderer` function is exported from `boardsmith/ui` — document in any public API docs that test functions receive element data (game state), not user input from untrusted sources. Not a runtime risk for the framework itself.

---

## Environment Availability

Phase 93 is pure code/config changes within the existing repo. No external tools, services, CLIs, or runtimes beyond the existing development stack are required.

**Step 2.6: SKIPPED (no external dependencies beyond existing project stack)**

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Game.animate('deal'/'flip'/'reveal') is what the gate games (Go Fish, Hex, Checkers) actually emit | §Animation Wiring | Handlers never fire; animations silently missing. Mitigate: check gate game source before writing handlers. |
| A2 | AnimationEvent.data payload shape for 'deal'/'flip'/'reveal' contains element IDs usable to find DOM nodes | §Animation Wiring | Handlers receive insufficient data to locate target elements. |
| A3 | GameShell already calls `createAnimationEvents` + `provideAnimationEvents` (established in v2.4/v3.0) | §Pattern 3 | `useAnimationEvents()` returns `undefined` in all renderer components; animation events never fire. |
| A4 | Component names (AutoRenderer.vue, renderer-registry.ts, archetypes/, renderers/) are at planner's discretion — these are suggestions | §Recommended Structure | None — planner may choose different names |
| A5 | The `selectArchetype` card-dominance threshold (≥50% of top-level elements are card-type) is appropriate | §Pattern 2 | Go Fish (heavy cards) classified as 'tableau' instead of 'card'. Adjust threshold in unit tests. |

**Assumptions A1–A3 should be verified by reading the gate game source files before implementing animation handlers.**

---

## Open Questions (RESOLVED)

All three questions are resolved for planning. Q1/Q2 resolve to executor-read steps already encoded in the plans (93-06 T2 `read_first`) plus a browser gate (93-07 T2); Q3 resolves to the UI-SPEC CSS prescription. None require additional research before execution.

1. **What does `game.animate('deal', data)` send for Go Fish?**
   - What we know: `AnimationEvent` has `{id, type, data: Record<string, unknown>, timestamp}`. The `type` can be anything the game passes to `game.animate()`.
   - What's unclear: Whether Go Fish uses 'deal', 'flip', 'reveal' as types, and what `data` keys it passes (source element ID? destination zone name? card value?).
   - **RESOLVED (A1):** Executor reads `~/BoardSmithGames/go-fish|checkers|hex|demo-animation` source in 93-06 T2 `read_first` before writing handlers; handlers use defensive `data` access and unit tests cover the wiring mechanism regardless of the event-type strings. If no gate game emits semantic 'deal'/'flip'/'reveal' types, 93-07 T2 uses `demo-animation` (which emits `game.animate('demo')`) as the browser animation vehicle. RENDER-05 is satisfied by wiring the composable + registering handlers for whatever types the games emit.

2. **Does GameShell already provide `animationEvents` to the auto-UI slot?**
   - What we know: `useAnimationEvents()` returns `undefined` if not provided; the composable exists since v2.4.
   - What's unclear: Whether GameShell's `#game-board` slot is inside the `provideAnimationEvents` call's provide scope.
   - **RESOLVED (A3):** `AutoRenderer.vue` guards `useAnimationEvents() === undefined` (inject-only, no-ops gracefully); unit tests cover the undefined path. Executor reads `src/ui/components/GameShell.vue` in 93-06 T2 `read_first` to confirm provide scope. If GameShell does NOT provide animationEvents in the auto-UI slot, 93-07 T2 browser verification surfaces the gap before `/gsd:verify-work` — no silent failure.

3. **Archetype template CSS: how does focal-board vs docked-hand hierarchy express visually?**
   - What we know: D-02 requires "focal board, docked hand, peripheral chrome" — NOT equal-space subdivision.
   - What's unclear: Exact CSS approach (CSS grid areas? flexbox with `flex-grow`? `clamp()` sizing?). This is Claude's Discretion.
   - **RESOLVED:** Locked by the UI-SPEC CSS prescription — `GridBoardTemplate.vue` uses CSS `grid-template-areas` with named areas (`chrome` / `board` / `hand`) and `grid-template-rows: auto 1fr auto` giving the board the dominant `1fr` area; hand is `auto` (max 30vh), absent entirely if no hand exists. This is the explicit anti-equal-space-subdivision prescription.

---

## Sources

### Primary (HIGH confidence — code read directly)

- `src/ui/components/auto-ui/AutoElement.vue` — renderer being replaced; all element types, board interaction, drag handlers documented
- `src/ui/components/auto-ui/AutoGameBoard.vue` — animation logic being replaced; provide/inject, FLIP/fly pattern
- `src/ui/components/auto-ui/AutoUI.vue` — integration point confirmed (single import swap needed)
- `src/ui/components/auto-ui/auto-ui-helpers.ts` — Phase 92 helpers; exact function signatures documented
- `src/ui/components/auto-ui/index.ts` — current exports; what needs updating
- `src/ui/composables/useAnimationEvents.ts` — full API; `registerHandler`, `createAnimationEvents`, `useAnimationEvents`, event types
- `src/ui/composables/useGameGrid.ts` — full API; `GameGridOptions`, `GameGridReturn`, standalone functions
- `src/ui/composables/useHexGrid.ts` — full API; `HexGridOptions`, `HexGridReturn`, standalone `hexToPixel`/`getHexPolygonPoints`
- `src/ui/index.ts` — `boardsmith/ui` export surface; where `registerRenderer` will be added
- `src/engine/element/game.ts` — `SAFE_LAYOUT_KEYS` whitelist (lines 239-245)
- `src/engine/element/grid.ts`, `hex-grid.ts`, `hand.ts`, `card.ts`, `deck.ts`, `space.ts` — `$type`/`$layout` attribute declarations
- `package.json` — subpath exports confirmed (`boardsmith/ui` → `src/ui/index.ts`)
- `vitest.config.ts` — test command, include/exclude patterns
- `.planning/phases/93-renderer-rebuild/93-CONTEXT.md` — locked decisions D-01..D-04
- `.planning/REQUIREMENTS.md` — RENDER-01..05
- `docs/auto-ui-redesign-research.md` — §0 authoritative design (templates/solver/registry/archetype decisions)
- `.planning/phases/92-piece-grid-rendering-fixes/92-CONTEXT.md` — helper extraction decision D-01

### Secondary (MEDIUM confidence)

- `.planning/STATE.md`, `.planning/PROJECT.md` — milestone context, key decisions table

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all composables read directly
- Architecture: HIGH — all integration points and API surfaces verified from source
- Registry pattern: HIGH — derived directly from D-03 + JSONForms pattern documented in §3
- Animation event wiring: MEDIUM — API verified; event data payloads for gate games not confirmed (A1–A2)
- Archetype template CSS: MEDIUM — structure is locked, exact CSS is Claude's Discretion

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (30 days — stable stack)
