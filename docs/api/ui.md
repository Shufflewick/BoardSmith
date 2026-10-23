# boardsmith/ui

> Vue components and composables for game UI.

## When to Use

Import from `boardsmith/ui` when building the visual interface for your game. This includes shell components, automatic UI generation, drag-and-drop, animations, and board interaction composables.

## Usage

<!-- typecheck: game src/ui/imports.ts -->
```typescript
import { AutoUI } from 'boardsmith/ui/auto-ui';
import {
  GameShell,
  ActionPanel,
  useBoardInteraction,
  useFLIP,
  useFlyingElements,
  useDragDrop,
} from 'boardsmith/ui';
```

## Exports

### Core Components

- `GameShell` - Main game container with panels and layout; runs inside a host's iframe
- `DebugPanel` - Developer debug tools
- `GameHistory` - Action history display
- `PlayersPanel` - Player list and scores
- `Toast` - Toast notification component
- `definePlayerPreferences(game, declarations)` - A game's own player preferences, listed in GameShell's controls menu via its `preferences` prop and read with `preferences.use('key')`; saved per game in the browser (see ui-components.md, Player preferences)

### Helper Components

- `FlyingCardsOverlay` - Overlay for card animations
- `ZoomPreviewOverlay` - Card/die zoom preview

### 3D Dice

- `Die3D` - Three.js 3D die component
- `DIE_ANIMATION_CONTEXT_KEY` - Context key for die animations
- `createDieAnimationContext()` - Create die animation context

### Auto-UI Components

From `boardsmith/ui/auto-ui`, so a game that draws its own board does not bundle them:

- `AutoUI` - Automatic game UI from state (also the entry's default export)
- `AutoRenderer` - Automatic element rendering
- `ActionPanel` - Action selection panel (also exported from `boardsmith/ui`)

### Composables

#### Board Interaction

- `useBoardInteraction()` - Core board interaction state and actions (throws if used outside a `<GameShell>`)
- `tryUseBoardInteraction()` - Same as above but returns `undefined` instead of throwing, for components that must degrade gracefully
- `createBoardInteraction()` - Create board interaction instance
- `provideBoardInteraction()` - Provide to component tree

#### Toast Notifications

- `useToast()` - Toast notification composable

#### Drag and Drop

- `useDragDrop()` - Drag and drop for game elements

#### Animations

##### FLIP Animations (useFLIP)

Unified FLIP animation API for smooth element transitions:

- `useFLIP()` - FLIP animations with single or multiple container support
- `createFLIPSnapshot()` - Create FLIP snapshot for one-off animations
- `prefersReducedMotion` - Reactive ref, `true` while the device or the player's Reduce motion item asks for less motion (CSS: `.bs-reduce-motion` on `<html>`)

```typescript
// Single container
const { capture, animate, isAnimating } = useFLIP({
  containerRef,
  selector: '[data-element-id]',
  duration: 300,
});

// Multi-container
const { capture, animate } = useFLIP({
  containers: [
    { ref: boardRef, selector: '[data-piece-id]' },
    { ref: handRef, selector: '[data-card-id]' },
  ],
});

// Auto mode (watches game state)
useFLIP({
  containerRef,
  auto: true,
  gameView: () => gameState.value.view,
});
```

##### Flying Elements (useFlyingElements)

Unified flying element animations for cards, pieces, and tokens:

- `useFlyingElements()` - Flying animations with optional flipping

```typescript
const { fly, flyMultiple, flyOnAppear, flyingElements } = useFlyingElements();

// Fly single element
await fly({
  id: 'card-1',
  startRect: deck.getBoundingClientRect(),
  endRect: () => hand.getBoundingClientRect(),
  elementData: { rank: 'A', suit: 'S' },
  flip: true,
});

// Declarative fly-on-appear
const { isFlying } = flyOnAppear({
  element: starterCard,
  sourceRef: deckRef,
  targetRef: starterRef,
  getElementData: (el) => ({ rank: el.rank, suit: el.suit }),
});

// Auto-watch mode (replaces useAutoAnimations, useAutoFlyingElements)
const { flyingElements } = useFlyingElements({
  autoWatch: {
    gameView: () => props.gameView,
    containers: [
      { ref: handRef, name: 'hand', element: () => findHand(gameView) },
      { ref: playAreaRef, name: 'play-area' },
      { ref: cribRef, name: 'crib' },
    ],
    getElementData: (el) => ({
      rank: el.attributes?.rank,
      suit: el.attributes?.suit,
    }),
    countBasedRoutes: [
      { from: 'hand', to: 'crib' },
    ],
  },
});
```

A face-down pile's cards reach a seat as placeholders whose ids say nothing about which card is which, so auto-watch does not follow them by id. A flight out of a face-down pile, to an open container or to another face-down pile, needs a `countBasedRoutes` entry; it flies when the source's count drops and the destination's rises. A route cannot tell which source fed a destination, so when two declared sources each lose a card in the same update, the route listed first gets the flight.

##### Other Animation Utilities

- `useActionAnimations()` - Action-triggered animations
- `useZoomPreview()` - Card/die zoom preview
- `usePlayerStatAnimation()` - Player stat animations
- `getPlayerStatElement()` - Get player stat element
- `flyToPlayerStat()` - Fly to player stat

#### Game View Helpers

- `findElement()` - Find the first element matching every criterion (`id`, `type`, `name`, `className`)
- `findElements()` - Find every element matching every criterion
- `getElementId()` - Get element ID
- `findPlayerHand()` - Find player's hand
- `findAllHands()` - Find all hands
- `getElementCount()` - Get element count
- `isSizeHidden()` - Whether the seat is not told an element's size (a 'hidden' zone sends only what it grants)
- `directChildren()` - An element's own children, without the granted cards a concealed zone's view carries after them
- `getCards()` - Get cards from container
- `getFirstCard()` - Get first card
- `getElementOwner()` - Get element owner
- `isOwnedByPlayer()` - Check ownership
- `isMyElement()` - Check if current player's
- `isOpponentElement()` - Check if opponent's

#### Grid Utilities

- `useGameGrid()` - Grid game utilities
- `toAlgebraicNotation()` - Convert to chess notation
- `fromAlgebraicNotation()` - Parse chess notation

#### Hex Grid Utilities

- `useHexGrid()` - Hex grid utilities
- `hexToPixel()` - Convert hex to pixel coords
- `getHexPolygonPoints()` - Get hex polygon SVG points
- `calculateHexDistance()` - Calculate hex distance

#### Card Display

- `useCardDisplay()` - Card display utilities
- `getSuitSymbol()` - Get suit symbol
- `getSuitColor()` - Get suit color
- `getRankName()` - Get rank name
- `getCardPointValue()` - Get card point value
- `isRedSuit()` - Check if red suit
- `isBlackSuit()` - Check if black suit

#### Action Controller

- `useActionController()` - Action handling for custom UIs
- `usePlayContext()` - Reach the action controller (`usePlayContext().actionController`) from a table's `GameShell` or a world's shell
- `useBoardInteraction()` - Board interaction (throws if outside a `<GameShell>`; use `tryUseBoardInteraction()` for the optional case)
- `actionNeedsWizardMode()` - Check if action needs wizard

### Theming

- `applyTheme(overrides?, options?)` - Inject the Slate token stylesheet and write `--bsg-*` overrides. Keys that are not `--bsg-*` custom properties are rejected.
- `themeCSS` - The Slate token stylesheet as a string constant (not a function)
- `SEAT_PALETTE` - Seat color values backing `--bsg-seat-1` … `--bsg-seat-6`

### Types

- `TableBoardProps` - What `GameShell` gives a table's board; declare `defineProps<TableBoardProps>()`
- `WorldBoardProps` - What `WorldShell` gives a world's board
- `BoardBaseProps` - What both shells give, for a board that renders in either
- `DisplayedGameState` - A table board's `state` prop: the seat's frame for the position shown
- `BoardInteraction` - Board interaction interface
- `BoardInteractionState` - Interaction state
- `BoardInteractionActions` - Interaction actions
- `ElementRef` - Element reference
- `HighlightableChoice` - Highlightable choice
- `DragProps` - Drag properties
- `DropProps` - Drop properties
- `UseDragDropReturn` - Drag-drop return type
- `FlyingCard` - Flying card data
- `FlyConfig` - Flying element configuration
- `FLIPContainer` - FLIP container configuration
- `FlyOnAppearOptions` - Fly-on-appear options
- `HexOrientation` - Hex orientation type
- `HexGridOptions` - Hex grid options
- `ColorChoice` - Color choice option

## Examples

### Basic Game Shell

```ts
// src/ui/uis.ts: every board the game has; exactly one is defaultUI().
// defineGameUIs and defaultUI come from 'boardsmith/ui', MyBoard from './components/MyBoard.vue'

export default defineGameUIs({ MyBoard: defaultUI(MyBoard) });
```

```vue
<!-- src/ui/App.vue, whose <script setup> imports GameShell from 'boardsmith/ui' and uis from './uis.js' -->
<template>
  <GameShell :uis="uis" />
</template>
```

`GameShell` mounts `MyBoard` and passes it `TableBoardProps`, which `MyBoard`
declares with `defineProps<TableBoardProps>()`; see
[UI Components](../ui-components.md#board-props).

### Drag and Drop

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useDragDrop, type TableBoardProps } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

const props = defineProps<TableBoardProps>();
const { drag, drop } = useDragDrop();
const controller = props.actionController;

const cards = computed(() => findElements(props.gameView, { className: 'Card' }));
const zones = computed(() => findElements(props.gameView, { className: 'Zone' }));

const canDragCard = (cardId: number) =>
  controller.currentAction.value === 'moveCard' &&
  controller.currentPick.value?.name === 'card' &&
  controller.validElements.value.some((valid) => valid.id === cardId);
</script>

<template>
  <div
    v-for="card in cards"
    :key="card.id"
    v-bind="drag({ id: card.id }, { when: canDragCard(card.id) }).props"
    :class="drag({ id: card.id }, { when: canDragCard(card.id) }).classes"
  >
    {{ card.name }}
  </div>
  <div
    v-for="zone in zones"
    :key="zone.id"
    v-bind="drop({ id: zone.id }).props"
    :class="drop({ id: zone.id }).classes"
  >
    {{ zone.name }}
  </div>
</template>
```

### FLIP Animations

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { findElements, useFLIP, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const boardRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const pieces = computed(() => findElements(props.gameView, { className: 'Piece' }));
const cards = computed(() => findElements(props.gameView, { className: 'Card' }));

// Auto-animate when game state changes
useFLIP({
  containers: [
    { ref: boardRef, selector: '[data-piece-id]' },
    { ref: handRef, selector: '[data-card-id]' },
  ],
  auto: true,
  gameView: () => props.gameView,
});
</script>

<template>
  <div ref="boardRef" class="board">
    <div v-for="piece in pieces" :key="piece.id" :data-piece-id="piece.id">
      {{ piece.name }}
    </div>
  </div>
  <div ref="handRef" class="hand">
    <div v-for="card in cards" :key="card.id" :data-card-id="card.id">
      {{ card.attributes?.rank }}
    </div>
  </div>
</template>
```

### Flying Elements

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { findElement, useFlyingElements, FlyingCardsOverlay, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const deckRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const topCard = computed(() => findElement(props.gameView, { name: 'deck' })?.children?.[0]);

const { fly, flyingElements } = useFlyingElements({ duration: 400 });

async function dealCard(card: GameViewElement | undefined) {
  if (!card || !deckRef.value) return;
  await fly({
    id: `deal-${card.id}`,
    startRect: deckRef.value,
    endRect: () => handRef.value,
    elementData: { rank: String(card.attributes?.rank), suit: String(card.attributes?.suit), faceUp: false },
    flip: true,
  });
}
</script>

<template>
  <div ref="deckRef" class="deck" @click="dealCard(topCard)" />
  <div ref="handRef" class="hand" />
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

## CSS Assets

<!-- typecheck: game src/ui/styles.ts -->
```typescript
// Drag-drop styles
import 'boardsmith/ui/animation/drag-drop.css';
```

## See Also

- [UI Components Guide](../ui-components.md)
- [Custom UI Guide](../custom-ui-guide.md)
- [Component Showcase](../component-showcase.md)
