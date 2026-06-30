# Phase 93: Renderer Rebuild - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 19 (15 new, 4 modified, 2 deleted)
**Analogs found:** 17 / 19

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `renderer-registry.ts` | utility (pure TS module) | request-response (resolve highest-priority renderer) | `auto-ui-helpers.ts` | role-match (same pure-TS, no-Vue pattern) |
| `AutoRenderer.vue` | component (host) | event-driven + request-response | `AutoGameBoard.vue` (deleted) | exact (direct replacement) |
| `archetypes/GridBoardTemplate.vue` | component (layout template) | request-response | `AutoGameBoard.vue` layout section + `AutoUI.vue` | good |
| `archetypes/CardTemplate.vue` | component (layout template) | request-response | `AutoGameBoard.vue` layout section | good |
| `archetypes/TableauTemplate.vue` | component (layout template) | request-response | `AutoGameBoard.vue` layout section | good |
| `archetypes/UnsupportedTopologyPanel.vue` | component (error panel) | request-response | `AutoUI.vue` `.game-complete` block | partial |
| `renderers/ElementRenderer.vue` | component (registry dispatch) | request-response | `AutoElement.vue` elementType computed | good |
| `renderers/CardRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` card section | exact |
| `renderers/HandRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` hand section (lines 409–453) | exact |
| `renderers/DeckRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` deck section | exact |
| `renderers/DieRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` die section | exact |
| `renderers/GridBoardRenderer.vue` | component (per-element) | CRUD + request-response | `AutoElement.vue` board/grid section | exact |
| `renderers/HexBoardRenderer.vue` | component (per-element) | CRUD + request-response | `AutoElement.vue` hex-board section | exact |
| `renderers/PieceRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` piece section | exact |
| `renderers/SpaceRenderer.vue` | component (per-element) | request-response | `AutoElement.vue` space section | exact |
| `AutoUI.vue` (MODIFY) | component (integration point) | request-response | itself | exact (1-line swap) |
| `auto-ui/index.ts` (MODIFY) | config (barrel export) | — | itself | exact |
| `src/ui/index.ts` (MODIFY) | config (public API export) | — | itself + other export blocks | exact |
| `renderer-registry.test.ts` | test | — | `auto-ui-helpers.test.ts` | exact |
| `archetype-selector.test.ts` | test | — | `auto-ui-helpers.test.ts` | exact |
| `AutoRenderer.test.ts` | test | — | `useAnimationEvents.test.ts` | good |

---

## Pattern Assignments

### `renderer-registry.ts` (utility, pure TypeScript)

**Analog:** `src/ui/components/auto-ui/auto-ui-helpers.ts`

**File header pattern** (`auto-ui-helpers.ts` lines 1–8):
```typescript
/**
 * renderer-registry — Ranked-tester registry for auto-UI element rendering.
 *
 * Pure module: no Vue reactivity, no DOM access.
 * Built-in renderers register at module load; consumer registers higher-priority
 * entries via registerRenderer() to upgrade auto-UI in place.
 */
```

**Discriminated-union type pattern** (`auto-ui-helpers.ts` lines 24–27, 32–34):
```typescript
// The helper file uses discriminated unions for type safety; do the same here.
export interface RendererEntry {
  test: (element: GameElement) => number;  // -1 = N/A; >0 = priority
  component: Component;
}
```

**Pure function pattern** (`auto-ui-helpers.ts` lines 44–101 for structure):
```typescript
// Functions are exported standalone (no class), no Vue imports.
// Parameters typed with local interfaces only (no engine imports).
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

**Local GameElement interface pattern** (`auto-ui-helpers.ts` lines 12–19):
```typescript
// Defines its own minimal GameElement rather than importing from engine.
// renderer-registry.ts must do the same to remain dependency-free.
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}
```

**Built-in registration:** Call `registerRenderer(...)` at module top-level (after `resolveRenderer` definition) — NOT inside component `onMounted`. Priority bands: built-ins at 1–10, consumer overrides at 100+.

---

### `AutoRenderer.vue` (component, host — replaces AutoGameBoard.vue)

**Analog:** `src/ui/components/auto-ui/AutoGameBoard.vue`

**Imports pattern** (`AutoGameBoard.vue` lines 23–28):
```typescript
import { computed, provide, ref, watch, nextTick } from 'vue';
import { useFlyingElements } from '../../composables/useFlyingElements.js';
import FlyingCardsOverlay from '../helpers/FlyingCardsOverlay.vue';
import { DIE_ANIMATION_CONTEXT_KEY, createDieAnimationContext } from '../dice/die3d-state.js';
```
New AutoRenderer.vue adds:
```typescript
import { useAnimationEvents } from '../../composables/useAnimationEvents.js';
import { selectArchetype } from './archetype-selector.js';  // pure TS module (new)
import AutoRenderer from './AutoRenderer.vue';              // self-reference placeholder
// Import archetype templates:
import GridBoardTemplate from './archetypes/GridBoardTemplate.vue';
import CardTemplate from './archetypes/CardTemplate.vue';
import TableauTemplate from './archetypes/TableauTemplate.vue';
import UnsupportedTopologyPanel from './archetypes/UnsupportedTopologyPanel.vue';
```

**Die animation context provide** (`AutoGameBoard.vue` lines 32–33):
```typescript
// Keep this provide — die animation context must be provided by the host.
const dieAnimationContext = createDieAnimationContext();
provide(DIE_ANIMATION_CONTEXT_KEY, dieAnimationContext);
```

**Props interface** (`AutoGameBoard.vue` lines 44–56) — simplified for Phase 93:
```typescript
// AutoRenderer.vue props — interaction props removed (Phase 94 concern):
const props = defineProps<{
  gameView: GameElement | null | undefined;
  playerSeat: number;
  // selectableElements and selectedElements REMOVED — useBoardInteraction provides these
}>();
```

**Provide pattern** (`AutoGameBoard.vue` lines 63–65, 108):
```typescript
// Copy these provides verbatim:
provide('playerSeat', props.playerSeat);
provide('selectableElements', computed(() => props.selectableElements ?? new Set()));
provide('selectedElements', computed(() => props.selectedElements ?? new Set()));
provide('defaultBackImage', defaultBackImage);
```

**findDefaultBackImage helper** (`AutoGameBoard.vue` lines 74–105):
```typescript
// Copy this function verbatim into AutoRenderer.vue — it scans the element tree
// for the first card back image URL/sprite to use as the default back image.
function findDefaultBackImage(element: GameElement | null | undefined): ImageInfo | null { ... }
const defaultBackImage = computed(() => findDefaultBackImage(props.gameView));
```

**Animation event wiring pattern** (replaces AutoGameBoard.vue lines 148–438):
```typescript
// NEW: inject-only (never createAnimationEvents here — GameShell owns that)
const animationEvents = useAnimationEvents();
const { flyingElements, fly } = useFlyingElements();

if (animationEvents) {
  animationEvents.registerHandler('deal', async (event, { signal }) => {
    if (signal.aborted) return;
    // fly() from source to destination using event.data
    // Read gate game source before writing exact data shape
  }, { skip: 'drop' });

  animationEvents.registerHandler('flip', async (event, { signal }) => {
    // drive CSS flip animation; skip: 'run' to sync state
  }, { skip: 'run' });

  animationEvents.registerHandler('reveal', async (event, { signal }) => {
    if (signal.aborted) return;
    // fly + flip combo
  }, { skip: 'drop' });
}
```

**Top-level children computed** (`AutoGameBoard.vue` lines 110–114):
```typescript
const topLevelChildren = computed(() => {
  if (!props.gameView) return [];
  return props.gameView.children ?? [];
});
```

**Archetype selection** (new, replaces `layoutClass` computed at lines 116–134):
```typescript
// Replace the heuristic layoutClass computed with archetype selection:
import { selectArchetype } from './archetype-selector.js';

const archetype = computed(() => selectArchetype(topLevelChildren.value));
```

**Template pattern** (`AutoGameBoard.vue` template section + `AutoUI.vue`):
```html
<template>
  <div class="auto-renderer" ref="containerRef">
    <FlyingCardsOverlay :flying-cards="flyingElements" />

    <GridBoardTemplate
      v-if="archetype === 'grid-board'"
      :top-level-children="topLevelChildren"
      :game-view="gameView"
    />
    <CardTemplate
      v-else-if="archetype === 'card'"
      :top-level-children="topLevelChildren"
    />
    <UnsupportedTopologyPanel
      v-else-if="archetype === 'unsupported'"
    />
    <TableauTemplate
      v-else
      :top-level-children="topLevelChildren"
    />
  </div>
</template>
```

---

### `archetypes/GridBoardTemplate.vue` (component, layout template)

**Analog:** `AutoGameBoard.vue` layout section + UI-SPEC CSS prescription

**Props:**
```typescript
defineProps<{
  topLevelChildren: GameElement[];
  gameView: GameElement | null | undefined;
}>();
```

**CSS grid-template-areas pattern** (from UI-SPEC §Template 1):
```css
.grid-board-template {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "chrome"
    "board"
    "hand";
  height: 100%;
  overflow: hidden;
}
.grid-board-template__chrome { grid-area: chrome; }
.grid-board-template__board  { grid-area: board; overflow: auto; }
.grid-board-template__hand   { grid-area: hand; max-height: 30vh; overflow-x: auto; }
```

**Child classification computed** (pattern from `AutoGameBoard.vue` lines 122–133):
```typescript
const boardElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$layout === 'grid' || el.attributes?.$layout === 'hex-grid'
  )
);
const handElements = computed(() =>
  props.topLevelChildren.filter(el => el.attributes?.$type === 'hand')
);
const chromeElements = computed(() =>
  props.topLevelChildren.filter(el =>
    el.attributes?.$layout !== 'grid' &&
    el.attributes?.$layout !== 'hex-grid' &&
    el.attributes?.$type !== 'hand'
  )
);
```

**Template structure:** Render `ElementRenderer` (not `AutoElement`) for each child in each slot.

---

### `archetypes/CardTemplate.vue` (component, layout template)

**Analog:** `AutoGameBoard.vue` layout section

**CSS pattern** (from UI-SPEC §Template 2):
```css
.card-template {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.card-template__peripheral { /* auto height */ }
.card-template__hands { flex: 1; /* dominant area */ }
```

---

### `archetypes/TableauTemplate.vue` (component, layout template)

**CSS pattern** (from UI-SPEC §Template 3):
```css
.tableau-template {
  display: flex;
  flex-wrap: wrap;
  gap: 32px; /* xl spacing */
  height: 100%;
  overflow: auto;
}
```

---

### `archetypes/UnsupportedTopologyPanel.vue` (component, error panel)

**Analog:** `AutoUI.vue` `.game-complete` block (lines 34–40, 55–62)

**Pattern** (`AutoUI.vue` lines 34–40):
```html
<!-- AutoUI.vue uses a full-width styled div for game-complete state.
     UnsupportedTopologyPanel follows the same "prominent panel" approach. -->
<div class="game-complete">
  <h2>Game Over!</h2>
  <slot name="game-over">
    <p>The game has ended.</p>
  </slot>
</div>
```

**Locked copy** (UI-SPEC §Copywriting Contract — DO NOT paraphrase):
```html
<template>
  <div class="unsupported-topology-panel">
    <h3 class="unsupported-topology-panel__heading">
      This layout cannot be auto-generated
    </h3>
    <p class="unsupported-topology-panel__body">
      This game uses a layout that is outside the auto-UI's supported set
      (grid, hex, stack, hand). Build a custom UI component for this game
      — see the custom UI guide.
    </p>
  </div>
</template>
```

**CSS** (from UI-SPEC §Template 4 — warning amber treatment):
```css
.unsupported-topology-panel {
  border-radius: 8px;
  padding: 24px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.1);
}
.unsupported-topology-panel__heading {
  color: #f59e0b;
  font-size: 20px;
  font-weight: 700;
}
.unsupported-topology-panel__body {
  color: #fff;
  font-size: 16px;
  line-height: 1.5;
}
```

---

### `renderers/ElementRenderer.vue` (component, registry dispatch)

**Analog:** `AutoElement.vue` `elementType` computed (lines 109–138)

**Pattern — use `resolveComponent` + `<component :is="...">` for dynamic dispatch:**
```typescript
import { computed } from 'vue';
import { resolveRenderer } from '../renderer-registry.js';

const props = defineProps<{
  element: GameElement;
  depth: number;
  hexPieceSize?: number;
}>();

const rendererComponent = computed(() => resolveRenderer(props.element));
```

```html
<template>
  <component
    v-if="rendererComponent"
    :is="rendererComponent"
    :element="element"
    :depth="depth"
    :hex-piece-size="hexPieceSize"
  />
  <!-- null = registry empty or no match; should not happen if built-ins registered -->
</template>
```

---

### `renderers/CardRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` card section — `currentCardImage` computed (lines 264–292), board interaction computeds (lines 153–234)

**Imports pattern** (`AutoElement.vue` lines 18–22):
```typescript
import { computed, inject, ref, type Ref } from 'vue';
import { tryUseBoardInteraction } from '../../composables/useBoardInteraction.js';
import { setTransformAwareDragImage } from '../../composables/dragImage.js';
```

**Board interaction inject pattern** (`AutoElement.vue` lines 46–55, 70):
```typescript
// Inject context — same keys as AutoGameBoard.vue provides:
const playerSeat = inject<number>('playerSeat', 0);
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage', ref(null));

// Board interaction — always tryUse (never useBoardInteraction directly):
const boardInteraction = tryUseBoardInteraction();
```

**Element ref object pattern** (`AutoElement.vue` lines 215–220) — used in every boardInteraction call:
```typescript
const elementRef = {
  id: props.element.id,
  name: props.element.name,
  notation: elementNotation.value || undefined,
};
```

**Board state computeds pattern** (`AutoElement.vue` lines 166–243):
```typescript
// ALL of these follow the same defensive guard pattern:
const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({ id: props.element.id, name: props.element.name });
});
const isBoardSelected = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected({ id: props.element.id, name: props.element.name });
});
const isActionSelectable = computed(() => {
  if (!boardInteraction) return false;
  if (isBoardSelected.value) return false;  // early return: already selected
  return boardInteraction.isSelectableElement({ id: props.element.id, name: props.element.name });
});
const isDragged = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isDraggedElement({ id: props.element.id, name: props.element.name });
});
```

**Card image computed** (`AutoElement.vue` lines 264–292 — `currentCardImage`):
```typescript
const cardImages = computed(() => {
  const attrs = props.element.attributes;
  if (!attrs?.$images) return null;
  const images = attrs.$images as Record<string, string | { sprite: string; x: number; y: number; width?: number; height?: number }>;
  return { face: images.face, back: images.back };
});

const currentCardImage = computed((): ImageInfo | null => {
  if (!cardImages.value) return null;
  const isHidden = props.element.__hidden || props.element.attributes?.__hidden;
  const image = isHidden ? cardImages.value.back : cardImages.value.face;
  if (!image) return null;
  if (typeof image === 'string') return { type: 'url' as const, src: image };
  if (typeof image === 'object' && 'sprite' in image) {
    const s = image as { sprite: string; x: number; y: number; width: number; height: number };
    return { type: 'sprite' as const, sprite: s.sprite, x: s.x, y: s.y, width: s.width, height: s.height };
  }
  return null;
});
```

**CSS class binding pattern** (from AutoElement.vue template section):
```html
<div
  :class="[
    'card',
    { 'is-selectable': isSelectable },
    { 'is-selected': isSelected },
    { 'action-selectable': isActionSelectable },
    { 'is-board-highlighted': isBoardHighlighted },
    { 'is-board-selected': isBoardSelected },
    { 'is-hidden': element.__hidden },
  ]"
  :data-element-id="element.id"
  :data-animatable="true"
>
```

**CSS interaction state pattern** (UI-SPEC §Global Interaction State Contracts):
```css
/* Apply to ALL per-element renderers: */
.is-selectable { cursor: pointer; }
.is-selectable:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 217, 255, 0.3); }
.is-selected { outline: 3px solid #00d9ff; outline-offset: 2px; }
/* card-specific selectable: */
.action-selectable { outline: 2px solid rgba(46, 204, 113, 0.6); outline-offset: 2px; border-radius: 8px; }
```

---

### `renderers/HandRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` hand section lines 409–453

**CRITICAL:** Copy the two-row hand sorting logic verbatim from `AutoElement.vue` lines 409–453. Do NOT re-implement it. This is a named carry-forward requirement from Phase 92 review.

**Imports + inject:** Same as CardRenderer (board interaction, playerSeat, defaultBackImage).

**Fan + overlap layout:** Handled via CSS vars and class bindings:
```typescript
const isFan = computed(() => props.element.attributes?.$fan === true);
const fanAngle = computed(() => (props.element.attributes?.$fanAngle as number) ?? 30);
```

---

### `renderers/DeckRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` deck section

**Empty state pattern** (UI-SPEC §DeckRenderer):
```html
<span v-if="!childCount" class="deck-empty">Empty</span>
```
```css
.deck-empty { font-style: italic; color: #666; }
```

**Stack visual pattern** (UI-SPEC §DeckRenderer — up to 3 offset cards):
```typescript
const stackCards = computed(() =>
  (props.element.children ?? []).slice(0, 3).map((card, i) => ({ card, stackIndex: i }))
);
```
```css
/* Offset each card for depth illusion: */
.deck-card {
  position: absolute;
  top: calc(var(--stack-index, 0) * -2px);
  left: calc(var(--stack-index, 0) * 1px);
}
```

---

### `renderers/DieRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` die section

**Delegate to `Die3D`** — no new die visual logic:
```typescript
import { Die3D } from '../../dice/index.js';

// Pass all die attributes through:
const dieProps = computed(() => ({
  sides: (props.element.attributes?.sides as number) ?? 6,
  value: props.element.attributes?.value as number | undefined,
  color: props.element.attributes?.color as string | undefined,
  rolling: props.element.attributes?.rolling as boolean | undefined,
  rollCount: props.element.attributes?.rollCount as number | undefined,
  faceLabels: props.element.attributes?.faceLabels as string[] | undefined,
  faceImages: props.element.attributes?.faceImages as string[] | undefined,
}));
```

---

### `renderers/GridBoardRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` board section (`gridResult` computed line 609–611, provide pattern lines 76–82)

**Imports:**
```typescript
import { computed, provide } from 'vue';
import { resolveGridSize } from '../auto-ui-helpers.js';
```

**Core pattern:**
```typescript
const gridResult = computed(() => resolveGridSize(props.element));

// Provide coordinate names to child cells (same pattern as AutoElement.vue lines 76–82):
const rowCoord = computed(() => props.element.attributes?.$rowCoord as string | undefined);
const colCoord = computed(() => props.element.attributes?.$colCoord as string | undefined);

if (rowCoord.value && colCoord.value) {
  provide('gridCoords', { rowCoord: rowCoord.value, colCoord: colCoord.value });
}
```

**Error panel** (UI-SPEC §Copywriting Contract — exact string from `auto-ui-helpers.ts` line 169):
```html
<div v-if="!gridResult.ok" class="grid-error-panel">
  {{ gridResult.error }}
  <!-- Error string is: `Grid "<name>" can't render — declare $rowCoord/$colCoord on the Grid element` -->
  <!-- MUST match auto-ui-helpers.ts:169 exactly — do not paraphrase -->
</div>
```

**CSS grid template:**
```typescript
const gridStyle = computed(() => {
  if (!gridResult.value.ok) return {};
  return { 'grid-template-columns': `repeat(${gridResult.value.cols}, 1fr)` };
});
```
```css
.grid-board { display: grid; gap: 2px; }  /* 2px is the locked grid-cell gap exception */
.grid-cell  { width: 50px; height: 50px; background: rgba(255,255,255,0.1); border-radius: 4px;
              display: flex; align-items: center; justify-content: center; position: relative;
              transition: all 0.15s ease; }
```

---

### `renderers/HexBoardRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` hex-board section (lines 659–719)

**Imports:**
```typescript
import { computed } from 'vue';
import { hexToPixel, getHexPolygonPoints } from '../../composables/useHexGrid.js';
```

**Core pattern — standalone functions, not the composable:**
```typescript
const hexSize = computed(() => (props.element.attributes?.$hexSize as number) ?? 50);
const orientation = computed(() =>
  (props.element.attributes?.$hexOrientation as 'flat' | 'pointy') ?? 'pointy'
);

function getCellPosition(cell: GameElement) {
  const qCoord = props.element.attributes?.$qCoord as string ?? 'q';
  const rCoord = props.element.attributes?.$rCoord as string ?? 'r';
  const q = (cell.attributes?.[qCoord] as number) ?? 0;
  const r = (cell.attributes?.[rCoord] as number) ?? 0;
  return hexToPixel(q, r, hexSize.value, orientation.value);
}

const hexPoints = computed(() => getHexPolygonPoints(hexSize.value, orientation.value));
```

**SVG rendering:**
```html
<svg :viewBox="svgViewBox" class="hex-board-svg">
  <g v-for="cell in cells" :key="cell.id"
     :transform="`translate(${getCellPosition(cell).x}, ${getCellPosition(cell).y})`">
    <polygon :points="hexPoints" class="hex-polygon" />
    <!-- children via ElementRenderer -->
  </g>
</svg>
```

**CSS** (UI-SPEC §HexBoardRenderer):
```css
.hex-polygon {
  fill: rgba(255, 255, 255, 0.1);
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 1.5;
  transition: all 0.15s ease;
}
.hex-polygon:hover { fill: rgba(0, 217, 255, 0.2); stroke: rgba(0, 217, 255, 0.6); }
```

---

### `renderers/PieceRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` piece section + `auto-ui-helpers.ts` `resolvePieceVisual`

**Imports:**
```typescript
import { computed } from 'vue';
import { resolvePieceVisual } from '../auto-ui-helpers.js';
import type { PieceVisual } from '../auto-ui-helpers.js';
```

**Core pattern:**
```typescript
const pieceVisual = computed((): PieceVisual => resolvePieceVisual(props.element));
```

**Carry-forward requirements from Phase 92 review (MUST satisfy):**
1. `transform: scale(1.05)` on `:hover` — was missing in old AutoElement.vue, MUST be present here.
2. Single `box-shadow` on outermost element only — no shadow on both wrapper AND inner token element.

```css
/* Carry-forward #1: piece hover affordance */
.piece:hover { transform: scale(1.05); transition: transform 0.2s ease, box-shadow 0.2s ease; }

/* Carry-forward #2: single shadow rule */
.piece {
  width: 40px; height: 40px; border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);  /* ONLY here, never on inner element */
}
```

---

### `renderers/SpaceRenderer.vue` (component, per-element)

**Analog:** `AutoElement.vue` space section

**Container CSS** (UI-SPEC §SpaceRenderer):
```css
.space-container {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; padding: 12px;
  min-height: 60px;
}
.space-children {
  display: flex; flex-wrap: wrap;
  gap: var(--layout-gap, 8px);
  flex-direction: var(--layout-direction, row);
}
```

**Children via ElementRenderer** (never recurse directly to AutoElement):
```html
<ElementRenderer
  v-for="child in element.children ?? []"
  :key="child.id"
  :element="child"
  :depth="depth + 1"
/>
```

---

### `AutoUI.vue` (MODIFY — 1-line swap)

**Analog:** itself

**Change** (lines 14, 42–46):
```diff
- import AutoGameBoard from './AutoGameBoard.vue';
+ import AutoRenderer from './AutoRenderer.vue';

- <AutoGameBoard
+ <AutoRenderer
    :game-view="gameView"
    :player-seat="playerSeat"
  />
```

Everything else (flowState banner, game-complete slot, `.auto-ui` style) unchanged.

---

### `auto-ui/index.ts` (MODIFY)

**Analog:** itself (lines 1–19)

**Change:**
```diff
- export { default as AutoGameBoard } from './AutoGameBoard.vue';
- export { default as AutoElement } from './AutoElement.vue';
+ export { default as AutoRenderer } from './AutoRenderer.vue';
+ export { registerRenderer, resolveRenderer } from './renderer-registry.js';
```

`AutoUI` and `ActionPanel` exports unchanged. Re-exported types unchanged.

---

### `src/ui/index.ts` (MODIFY)

**Analog:** itself (lines 33–42 for the auto-ui export block)

**Change** (add to existing auto-ui export block and add registerRenderer to public API):
```diff
  export {
    AutoUI,
-   AutoGameBoard,
-   AutoElement,
+   AutoRenderer,
    ActionPanel,
    type GameElement,
    type Pick,
    type ActionMetadata,
    type Player,
  } from './components/auto-ui/index.js';

+ // Renderer registry (public extension API per D-03)
+ export { registerRenderer } from './components/auto-ui/renderer-registry.js';
  // resolveRenderer is internal — not exported here
```

**Pattern reference for new export block** (`src/ui/index.ts` lines 117–128 — animation events export as model):
```typescript
// Animation events export block (lines 117–128) is the model for a new utility export:
export {
  createAnimationEvents,
  provideAnimationEvents,
  useAnimationEvents,
  ANIMATION_EVENTS_KEY,
  type AnimationHandler,
  // ...
} from './composables/useAnimationEvents.js';
// New registerRenderer export follows the same named-export-from-module pattern.
```

---

### `renderer-registry.test.ts` (test, pure TS module)

**Analog:** `src/ui/components/auto-ui/auto-ui-helpers.test.ts`

**Test file structure** (`auto-ui-helpers.test.ts` lines 1–4):
```typescript
import { describe, it, expect } from 'vitest';
import { registerRenderer, resolveRenderer } from './renderer-registry.js';
// Note: import from .js extension (project uses ESM)
```

**Factory helper pattern** (`auto-ui-helpers.test.ts` lines 20–43):
```typescript
function buildElement(attributes: Record<string, unknown> = {}): GameElement {
  return { id: 1, className: 'Space', name: 'test', attributes, children: [] };
}
```

**Test pattern** (`auto-ui-helpers.test.ts` lines 48–55):
```typescript
describe('resolveRenderer', () => {
  it('returns null when registry is empty', () => {
    // Test requires a fresh registry — use beforeEach to reset or export resetRegistry for tests
  });

  it('returns highest-priority component', () => {
    // register two entries, assert highest-priority wins
  });

  it('skips entries returning -1', () => {
    // register entry with test returning -1; assert resolveRenderer returns null
  });

  it('consumer priority 100+ overrides built-in priority 1–10', () => {
    // register built-in at priority 5, consumer at 100; assert consumer wins
  });
});
```

---

### `archetype-selector.test.ts` (test, pure TS module)

**Analog:** `src/ui/components/auto-ui/auto-ui-helpers.test.ts`

**Same test structure.** Covers all four `selectArchetype` outcomes:
```typescript
describe('selectArchetype', () => {
  it('returns grid-board when $layout=grid element is present', () => { ... });
  it('returns grid-board when $layout=hex-grid element is present (beats card dominance)', () => { ... });
  it('returns card when ≥50% of elements are $type card/hand/deck and no grid/hex', () => { ... });
  it('returns unsupported when $layout=free-form element is present', () => { ... });
  it('returns tableau for addressable-but-unspecialized layouts', () => { ... });
});
```

---

### `AutoRenderer.test.ts` (test, Vue composable)

**Analog:** `src/ui/composables/useAnimationEvents.test.ts`

**Test file header** (`useAnimationEvents.test.ts` lines 1–5):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { createAnimationEvents, ... } from './useAnimationEvents.js';
```

**What to cover (from RESEARCH.md RENDER-05 test map):**
```typescript
describe('AutoRenderer animation wiring', () => {
  it('registers handler for deal/flip/reveal event types', () => { ... });
  it('calls handler when event fires', async () => { ... });
  it('handles undefined animationEvents gracefully (no error when not provided)', () => { ... });
});
```

---

## Shared Patterns

### Board Interaction Inject (apply to ALL per-element renderers)

**Source:** `src/ui/components/auto-ui/AutoElement.vue` lines 70, 166–234
**Source:** `src/ui/composables/useBoardInteraction.ts` line 432

```typescript
// Pattern used in EVERY per-element renderer component:
const boardInteraction = tryUseBoardInteraction();  // returns undefined if not in GameShell

// Every board state computed uses the same defensive guard:
const isBoardHighlighted = computed(() => {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted({ id: props.element.id, name: props.element.name });
});
```

**Apply to:** `CardRenderer.vue`, `HandRenderer.vue`, `DeckRenderer.vue`, `GridBoardRenderer.vue`, `HexBoardRenderer.vue`, `PieceRenderer.vue`, `SpaceRenderer.vue`

### Animation Event Inject (apply to AutoRenderer.vue only)

**Source:** `src/ui/composables/useAnimationEvents.ts` lines 117–121

```typescript
// inject() returns undefined if GameShell hasn't provided it — suppress Vue warning:
export function useAnimationEvents(): UseAnimationEventsReturn | undefined {
  return inject(ANIMATION_EVENTS_KEY, undefined);
}
// In AutoRenderer.vue:
const animationEvents = useAnimationEvents();
if (animationEvents) {
  animationEvents.registerHandler('deal', async (event, { signal }) => { ... }, { skip: 'drop' });
}
```

**Apply to:** `AutoRenderer.vue` only. Never call `createAnimationEvents` in renderer components.

### Provide Context Chain (AutoRenderer.vue → all per-element renderers)

**Source:** `AutoGameBoard.vue` lines 63–65, 108
**Source:** `AutoElement.vue` lines 46–55

```typescript
// AutoRenderer.vue provides these keys (copy from AutoGameBoard.vue verbatim):
provide('playerSeat', props.playerSeat);
provide('selectableElements', computed(() => props.selectableElements ?? new Set()));
provide('selectedElements', computed(() => props.selectedElements ?? new Set()));
provide('defaultBackImage', defaultBackImage);

// Per-element renderers inject with exact same keys:
const playerSeat = inject<number>('playerSeat', 0);
const selectableElements = inject<Ref<Set<number>>>('selectableElements');
const defaultBackImage = inject<Ref<ImageInfo | null>>('defaultBackImage', ref(null));
```

**Apply to:** `AutoRenderer.vue` (provide), all per-element renderers (inject).

### CSS Drag-Drop Variables (consume, never redefine)

**Source:** `drag-drop.css` (UI-SPEC §Global Interaction State Contracts)

```css
/* These are already set at :root in drag-drop.css — DO NOT redefine in new SFCs: */
/* --bs-drop-target-bg: rgba(0, 255, 136, 0.15) */
/* --bs-drop-hover-bg: rgba(0, 255, 136, 0.3) */
/* --bs-drag-transition: all 0.2s ease */

/* Per-element renderers reference them: */
.is-drag-target { background: var(--bs-drop-target-bg); }
.is-drag-target:hover { background: var(--bs-drop-hover-bg); }
```

**Apply to:** All per-element renderers with drag-and-drop capabilities.

### ESM Import Extension Convention

**Source:** `auto-ui-helpers.test.ts` line 2, `AutoElement.vue` lines 19–22

```typescript
// ALL imports use .js extension even for .ts source files (ESM transpilation):
import { resolvePieceVisual } from './auto-ui-helpers.js';
import { tryUseBoardInteraction } from '../../composables/useBoardInteraction.js';
import { hexToPixel, getHexPolygonPoints } from '../../composables/useHexGrid.js';
```

**Apply to:** Every new `.ts` and `.vue` file's import statements.

### Data Attribute Pattern for FLIP/Flying Animations

**Source:** `AutoGameBoard.vue` lines 212–218 (capturePositions function)

```html
<!-- Elements that need FLIP or flying animation must carry these attributes: -->
<div
  :data-element-id="element.id"
  :data-animatable="true"
>
```

**Apply to:** `CardRenderer.vue`, `PieceRenderer.vue` — cards and pieces are the animatable elements.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `archetype-selector.ts` (implied by planner) | utility | transform | No topology-selection logic exists in the codebase; the closest code is the heuristic `layoutClass` computed in `AutoGameBoard.vue` (being deleted), but that is not the same algorithm. Planner must implement `selectArchetype()` from RESEARCH.md Pattern 2 directly. |

---

## Delete Map

| File to Delete | Lines | What the New System Replaces It With |
|----------------|-------|--------------------------------------|
| `src/ui/components/auto-ui/AutoElement.vue` | 2355 | `ElementRenderer.vue` (dispatch) + `CardRenderer.vue`, `HandRenderer.vue`, `DeckRenderer.vue`, `DieRenderer.vue`, `GridBoardRenderer.vue`, `HexBoardRenderer.vue`, `PieceRenderer.vue`, `SpaceRenderer.vue` |
| `src/ui/components/auto-ui/AutoGameBoard.vue` | 503 | `AutoRenderer.vue` (host) + archetype template components |

---

## Metadata

**Analog search scope:** `src/ui/components/auto-ui/`, `src/ui/composables/`, `src/ui/index.ts`
**Files read:** 14 source files
**Pattern extraction date:** 2026-06-21
