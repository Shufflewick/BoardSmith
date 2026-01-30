# boardsmith/ui

> Vue components and composables for game UI.

## When to Use

Import from `boardsmith/ui` when building the visual interface for your game. This includes shell components, automatic UI generation, drag-and-drop, animations, and board interaction composables.

## Usage

```typescript
import {
  GameShell,
  AutoUI,
  ActionPanel,
  useBoardInteraction,
  useFLIP,
  useFlyingElements,
  useDragDrop,
} from 'boardsmith/ui';
```

## Exports

### Core Components

- `GameShell` - Main game container with header, panels, and layout
- `DebugPanel` - Developer debug tools
- `GameHeader` - Game title and player info
- `GameHistory` - Action history display
- `GameLobby` - Pre-game lobby for multiplayer
- `HamburgerMenu` - Mobile menu
- `PlayersPanel` - Player list and scores
- `WaitingRoom` - Waiting for players screen
- `Toast` - Toast notification component

### Helper Components

- `FlyingCardsOverlay` - Overlay for card animations
- `ZoomPreviewOverlay` - Card/die zoom preview

### 3D Dice

- `Die3D` - Three.js 3D die component
- `DIE_ANIMATION_CONTEXT_KEY` - Context key for die animations
- `createDieAnimationContext()` - Create die animation context

### Auto-UI Components

- `AutoUI` - Automatic game UI from state
- `AutoGameBoard` - Automatic board rendering
- `AutoElement` - Automatic element rendering
- `ActionPanel` - Action selection panel

### Composables

#### Board Interaction

- `useBoardInteraction()` - Core board interaction state and actions
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
- `prefersReducedMotion` - Reactive ref for reduced motion preference

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

##### Other Animation Utilities

- `useElementAnimation()` - Low-level element animation utilities
- `useActionAnimations()` - Action-triggered animations
- `useZoomPreview()` - Card/die zoom preview
- `usePlayerStatAnimation()` - Player stat animations
- `getPlayerStatElement()` - Get player stat element
- `flyToPlayerStat()` - Fly to player stat

#### Game View Helpers

- `useGameViewHelpers()` - Common view helpers
- `findElementById()` - Find element by ID
- `findElement()` - Find single element
- `findElements()` - Find multiple elements
- `findChildByAttribute()` - Find child by attribute
- `findElementByAttribute()` - Find by attribute
- `findAllByAttribute()` - Find all by attribute
- `getElementId()` - Get element ID
- `findPlayerHand()` - Find player's hand
- `findAllHands()` - Find all hands
- `getElementCount()` - Get element count
- `getCards()` - Get cards from container
- `getFirstCard()` - Get first card
- `getCardData()` - Get card display data
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

#### Change Tracking

- `useElementChangeTracker()` - Track element changes
- `useCountTracker()` - Track count changes

#### Action Controller

- `useActionController()` - Action handling for custom UIs
- `injectActionController()` - Inject action controller
- `ACTION_CONTROLLER_KEY` - Injection key
- `injectPickStepFn()` - Inject pick step function
- `injectBoardInteraction()` - Inject board interaction
- `actionNeedsWizardMode()` - Check if action needs wizard

### Theming

- `applyTheme()` - Apply theme to game
- `getTheme()` - Get current theme
- `themeCSS()` - Generate theme CSS

### Player Colors

- `STANDARD_PLAYER_COLORS` - Standard color palette (8 colors)

### Types

- `BoardInteraction` - Board interaction interface
- `BoardInteractionState` - Interaction state
- `BoardInteractionActions` - Interaction actions
- `ElementRef` - Element reference
- `HighlightableChoice` - Highlightable choice
- `DragProps` - Drag properties
- `DropProps` - Drop properties
- `UseDragDropReturn` - Drag-drop return type
- `AnimationOptions` - Animation options
- `FlyingCard` - Flying card data
- `FlyConfig` - Flying element configuration
- `FLIPContainer` - FLIP container configuration
- `FlyOnAppearOptions` - Fly-on-appear options
- `HexOrientation` - Hex orientation type
- `HexGridOptions` - Hex grid options
- `ThemeConfig` - Theme configuration
- `ColorChoice` - Color choice option

## Examples

### Basic Game Shell

```vue
<script setup lang="ts">
import { GameShell, ActionPanel, useBoardInteraction } from 'boardsmith/ui';

const { state, flowState, performAction } = useBoardInteraction();
</script>

<template>
  <GameShell>
    <template #board>
      <!-- Your custom board rendering -->
      <div class="board">
        <div v-for="piece in state.board.children" :key="piece.id">
          {{ piece.type }}
        </div>
      </div>
    </template>

    <template #actions>
      <ActionPanel />
    </template>
  </GameShell>
</template>
```

### Drag and Drop

```vue
<script setup lang="ts">
import { useDragDrop } from 'boardsmith/ui';

const { drag, drop } = useDragDrop({
  canDrag: (el) => el.type === 'card' && el.owner === currentPlayer,
  canDrop: (dragEl, dropEl) => dropEl.type === 'space',
  onDrop: (dragEl, dropEl) => {
    performAction('play', { card: dragEl.id, target: dropEl.id });
  },
});
</script>

<template>
  <div v-for="card in hand.children" :key="card.id" v-bind="drag(card)">
    {{ card.rank }} of {{ card.suit }}
  </div>

  <div v-for="space in board.children" :key="space.id" v-bind="drop(space)">
    <!-- Drop zone -->
  </div>
</template>
```

### FLIP Animations

```vue
<script setup lang="ts">
import { useFLIP } from 'boardsmith/ui';

const boardRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);

// Auto-animate when game state changes
useFLIP({
  containers: [
    { ref: boardRef, selector: '[data-piece-id]' },
    { ref: handRef, selector: '[data-card-id]' },
  ],
  auto: true,
  gameView: () => gameState.value.view,
});
</script>

<template>
  <div ref="boardRef" class="board">
    <div v-for="piece in pieces" :key="piece.id" :data-piece-id="piece.id">
      {{ piece.type }}
    </div>
  </div>
  <div ref="handRef" class="hand">
    <div v-for="card in cards" :key="card.id" :data-card-id="card.id">
      {{ card.rank }}
    </div>
  </div>
</template>
```

### Flying Elements

```vue
<script setup lang="ts">
import { useFlyingElements, FlyingCardsOverlay } from 'boardsmith/ui';

const { fly, flyingElements } = useFlyingElements({ duration: 400 });

async function dealCard(card: Card) {
  await fly({
    id: `deal-${card.id}`,
    startRect: deckRef.value!.getBoundingClientRect(),
    endRect: () => handRef.value!.getBoundingClientRect(),
    elementData: { rank: card.rank, suit: card.suit, faceUp: false },
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

```typescript
// Drag-drop styles
import 'boardsmith/ui/animation/drag-drop.css';

// Card flip animation styles
import 'boardsmith/ui/animation/card-flip.css';
```

## See Also

- [UI Components Guide](../ui-components.md)
- [Custom UI Guide](../custom-ui-guide.md)
- [Component Showcase](../component-showcase.md)
