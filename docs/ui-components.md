# UI Components & Composables

BoardSmith provides Vue 3 components and composables for building game UIs. The `@boardsmith/ui` package includes everything from high-level shells to low-level animation utilities.

## Core Components

### GameShell

The main wrapper component that provides the complete game UI structure: header, player panels, game board area, action panel, and game history.

```vue
<template>
  <GameShell
    game-type="my-game"
    display-name="My Game"
    :player-count="2"
  >
    <!-- Custom game board -->
    <template #game-board="{
      state,
      gameView,
      playerPosition,
      isMyTurn,
      availableActions,
      action,
      actionArgs,
      executeAction,
      setBoardPrompt
    }">
      <GameBoard
        :game-view="gameView"
        :player-position="playerPosition"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action="action"
        :action-args="actionArgs"
        :execute-action="executeAction"
        :set-board-prompt="setBoardPrompt"
      />
    </template>

    <!-- Custom player stats display -->
    <template #player-stats="{ player, gameView }">
      <div class="player-stat">
        <span class="label">Score:</span>
        <span class="value">{{ player.score }}</span>
      </div>
    </template>
  </GameShell>
</template>

<script setup lang="ts">
import { GameShell } from '@boardsmith/ui';
import GameBoard from './components/GameBoard.vue';
</script>
```

#### Slot Props

The `#game-board` slot receives:

| Prop | Type | Description |
|------|------|-------------|
| `state` | `GameState` | Full game state |
| `gameView` | `object` | Player-filtered view of game state |
| `playerPosition` | `number` | Current player's position |
| `isMyTurn` | `boolean` | Whether it's this player's turn |
| `availableActions` | `string[]` | Actions available to the player |
| `action` | `function` | Execute an action: `(name, args) => Promise` |
| `actionArgs` | `object` | Shared reactive object for action selections (bidirectional sync with ActionPanel) |
| `executeAction` | `function` | Execute current action: `(name) => Promise` |
| `setBoardPrompt` | `function` | Set a prompt message: `(text) => void` |
| `startAction` | `function` | Trigger ActionPanel to start an action: `(name) => void` |

#### Shared Action State (actionArgs)

The `actionArgs` object provides **bidirectional synchronization** between custom game boards and ActionPanel:

- **ActionPanel writes** to `actionArgs` when users make selections in the auto-generated UI
- **Custom boards can write** to `actionArgs` to pre-fill selections or respond to board interactions
- **Both see updates** immediately due to Vue's reactivity

This enables powerful hybrid UIs where users can interact with either the game board or the action panel.

**Example: Board pre-filling selections with startAction**
```vue
<script setup lang="ts">
const props = defineProps<{
  actionArgs: Record<string, unknown>;
  startAction: (name: string, initialArgs?: Record<string, unknown>) => void;
}>();

// When user clicks a piece on the board, start the action with that piece pre-selected
function onPieceClick(pieceId: number) {
  // Pass initial args to startAction - they're applied after clearing
  props.startAction('move', { piece: pieceId });
}
</script>
```

**Example: Board reading from actionArgs**
```vue
<template>
  <div
    v-for="card in cards"
    :key="card.id"
    class="card"
    :class="{ selected: actionArgs.card === card.id }"
  >
    <!-- Card shows selected state from ActionPanel selections -->
  </div>
</template>
```

**Example: Writable computed for card selection**
```typescript
const selectedCards = computed({
  get: () => (props.actionArgs.cards as string[]) || [],
  set: (value: string[]) => {
    props.actionArgs.cards = value;
  }
});
```

**ActionPanel owns the clear lifecycle**

ActionPanel clears `actionArgs` when starting, canceling, or completing actions. To pre-fill selections when starting an action, use the `initialArgs` parameter:

```typescript
// Correct: Pass initial values to startAction
startAction('move', { piece: pieceId });

// Incorrect: Writing then starting loses the value (cleared on start)
actionArgs.piece = pieceId;
startAction('move');  // piece gets cleared!
```

For ongoing updates during an action (after it's started), write directly to `actionArgs`.

### AutoUI

Automatic UI generation from game state. Useful for prototyping or as a reference implementation.

```vue
<template>
  <AutoUI
    :game-view="gameView"
    :player-position="playerPosition"
    :flow-state="flowState"
  />
</template>

<script setup lang="ts">
import { AutoUI } from '@boardsmith/ui';
</script>
```

The auto-generated UI includes:
- **AutoGameBoard**: Renders the game element tree
- **AutoElement**: Renders individual elements based on type
- **ActionPanel**: Displays available actions with selection UI

### DebugPanel

Development tool for inspecting game state, history, and debugging.

```vue
<template>
  <DebugPanel
    :state="state"
    :game-view="gameView"
    :action-history="actionHistory"
  />
</template>
```

## Helper Components

### DeckPile

Visual representation of a deck/pile of cards.

```vue
<template>
  <DeckPile
    :count="deckCount"
    :clickable="canDraw"
    @click="onDrawCard"
  />
</template>
```

### CardFan

Display cards in a fanned layout (like a hand of cards).

```vue
<template>
  <CardFan
    :cards="playerHand"
    :selectable="isMyTurn"
    @select="onCardSelect"
  />
</template>
```

### DiceRoller

Animated dice rolling component.

```vue
<template>
  <DiceRoller
    :value="diceResult"
    :rolling="isRolling"
    @roll-complete="onRollComplete"
  />
</template>
```

### Draggable

Wrapper for drag-and-drop interactions.

```vue
<template>
  <Draggable
    :disabled="!canDrag"
    @drag-start="onDragStart"
    @drag-end="onDragEnd"
  >
    <Card :card="card" />
  </Draggable>
</template>
```

### FlyingCardsOverlay

Overlay for card flight animations between positions.

```vue
<template>
  <FlyingCardsOverlay
    :flying-cards="flyingCards"
  />
</template>
```

## Composables

### useBoardInteraction

Bidirectional interaction between action panel and game board.

```typescript
import { useBoardInteraction, createBoardInteraction, provideBoardInteraction } from '@boardsmith/ui';

// In GameShell (provide)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// In GameBoard or ActionPanel (inject)
const boardInteraction = useBoardInteraction();

// Check element states
boardInteraction.isHighlighted(element)  // Hovered in action panel
boardInteraction.isSelected(element)     // Currently selected
boardInteraction.isValidTarget(element)  // Valid drop/selection target
boardInteraction.isSelectableElement(element)  // Can be clicked to select

// Trigger selections
boardInteraction.triggerElementSelect(element)

// Drag and drop
boardInteraction.startDrag(element)
boardInteraction.endDrag()
boardInteraction.isDropTarget(element)
boardInteraction.isDraggedElement(element)
```

### useElementAnimation

FLIP animations for smooth element movement.

```typescript
import { useElementAnimation } from '@boardsmith/ui';

const { capturePositions, animateToCurrentPositions, cancelAll } = useElementAnimation();

// Before state changes
capturePositions(containerRef.value);

// After state changes (in nextTick or watch)
animateToCurrentPositions(containerRef.value, {
  duration: 300,
  selector: '[data-animatable="true"]',
});
```

Elements must have `data-animatable="true"` and `data-element-id="..."` attributes.

### useCardFlip / useCardReveal

Card flip and reveal animations.

```typescript
import { useCardFlip, useCardReveal } from '@boardsmith/ui';

const { isFlipped, flip, flipBack } = useCardFlip({
  duration: 300,
});

const { isRevealed, reveal } = useCardReveal({
  delay: 100,
});
```

### useFlyingCards

Manage cards flying between positions.

```typescript
import { useFlyingCards, type FlyingCard } from '@boardsmith/ui';

const { flyingCards, flyCard, clearFlying } = useFlyingCards();

// Fly a card from one position to another
flyCard({
  id: card.id,
  from: { x: 100, y: 200 },
  to: { x: 500, y: 300 },
  duration: 500,
  onComplete: () => console.log('Card arrived'),
});
```

### useFlyOnAppear

Animate elements flying in when they appear.

```typescript
import { useFlyOnAppear } from '@boardsmith/ui';

const { trackElement, getInitialPosition } = useFlyOnAppear({
  from: 'deck',  // Element ID to fly from
  duration: 400,
});
```

### usePlayerStatAnimation

Animate stat changes and fly elements to player stat displays.

```typescript
import { usePlayerStatAnimation, flyToPlayerStat } from '@boardsmith/ui';

// Fly a card to a player's score display
flyToPlayerStat({
  cardElement: cardEl,
  playerPosition: 0,
  statName: 'score',
  onComplete: () => updateScore(),
});
```

### useGameViewHelpers

Utilities for querying game state.

```typescript
import {
  useGameViewHelpers,
  findElement,
  findElements,
  findPlayerHand,
  getCards,
  getElementOwner,
  isMyElement,
} from '@boardsmith/ui';

// Find specific element
const deck = findElement(gameView, { type: 'deck' });

// Find player's hand
const myHand = findPlayerHand(gameView, playerPosition);

// Get all cards in an element
const cardsInHand = getCards(myHand);

// Check ownership
const owner = getElementOwner(card);
const isMine = isMyElement(card, playerPosition);
```

### useGameGrid

Utilities for square grids (chess notation, etc.).

```typescript
import { useGameGrid, toAlgebraicNotation, fromAlgebraicNotation } from '@boardsmith/ui';

const { getCellAt, getAlgebraic, pixelToCell } = useGameGrid({
  rows: 8,
  cols: 8,
  cellSize: 60,
});

// Convert coordinates
const notation = toAlgebraicNotation(0, 0);  // "a1"
const { col, row } = fromAlgebraicNotation('e4');  // { col: 4, row: 3 }
```

### useHexGrid

Utilities for hexagonal grids.

```typescript
import {
  useHexGrid,
  hexToPixel,
  getHexPolygonPoints,
  calculateHexDistance
} from '@boardsmith/ui';

const {
  hexToPixel,
  pixelToHex,
  getHexCorners,
  getNeighbors
} = useHexGrid({
  size: 30,
  orientation: 'flat',  // or 'pointy'
});

// Convert hex coords to pixel position
const { x, y } = hexToPixel(3, 2, 30, 'flat');

// Get SVG polygon points for a hex cell
const points = getHexPolygonPoints(cx, cy, size, 'flat');

// Calculate distance between hexes
const dist = calculateHexDistance(q1, r1, q2, r2);
```

### useCardDisplay

Card display formatting utilities.

```typescript
import {
  useCardDisplay,
  getSuitSymbol,
  getSuitColor,
  getRankName,
  isRedSuit
} from '@boardsmith/ui';

getSuitSymbol('H');  // "♥"
getSuitSymbol('D');  // "♦"
getSuitSymbol('C');  // "♣"
getSuitSymbol('S');  // "♠"

getSuitColor('H');   // "#e74c3c" (red)
getSuitColor('S');   // "#2c3e50" (black)

getRankName('K');    // "King"
isRedSuit('D');      // true
```

### useElementChangeTracker

Track element position and count changes for animations.

```typescript
import { useElementChangeTracker, useCountTracker } from '@boardsmith/ui';

const { trackElements, getChanges } = useElementChangeTracker();

// Track element movements
trackElements(gameView);
// ... state changes ...
const changes = getChanges(gameView);  // { added, removed, moved }

// Track count changes
const { track, getChange } = useCountTracker();
track('deckCount', deck.children.length);
const delta = getChange('deckCount');  // e.g., -3 (deck lost 3 cards)
```

### useFLIPAnimation

Low-level FLIP (First, Last, Invert, Play) animation utility.

```typescript
import { useFLIPAnimation, createFLIPSnapshot } from '@boardsmith/ui';

const { recordFirst, recordLast, play } = useFLIPAnimation({
  duration: 300,
  easing: 'ease-out',
});

// Before change
recordFirst(elements);

// After change
recordLast(elements);

// Animate
play();
```

## Theming

Customize the UI appearance with themes.

```typescript
import { applyTheme, type ThemeConfig } from '@boardsmith/ui';

const customTheme: ThemeConfig = {
  primary: '#00d9ff',
  secondary: '#00ff88',
  background: '#1a1a2e',
  surface: '#16213e',
  text: '#ffffff',
  textMuted: '#888888',
  error: '#e74c3c',
  success: '#00ff88',
};

applyTheme(customTheme);
```

## Building Custom UIs

### Example: Custom Game Board

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBoardInteraction, useElementAnimation, findPlayerHand, getCards } from '@boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<any>;
}>();

const boardInteraction = useBoardInteraction();
const { capturePositions, animateToCurrentPositions } = useElementAnimation();
const containerRef = ref<HTMLElement>();

// Extract data from game view
const myHand = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerPosition);
  return hand ? getCards(hand) : [];
});

// Handle card click
async function onCardClick(card: any) {
  if (!props.isMyTurn) return;
  if (!props.availableActions.includes('play')) return;

  // Check if card is selectable via board interaction
  if (boardInteraction?.isSelectableElement(card)) {
    boardInteraction.triggerElementSelect(card);
  } else {
    // Direct action
    await props.action('play', { card: card.id });
  }
}

// Animate state changes
watch(() => props.gameView, (newView, oldView) => {
  if (containerRef.value && oldView) {
    capturePositions(containerRef.value);
    nextTick(() => {
      animateToCurrentPositions(containerRef.value!);
    });
  }
});
</script>

<template>
  <div ref="containerRef" class="game-board">
    <div class="hand">
      <div
        v-for="card in myHand"
        :key="card.id"
        class="card"
        :class="{
          'highlighted': boardInteraction?.isHighlighted(card),
          'selected': boardInteraction?.isSelected(card),
          'selectable': boardInteraction?.isSelectableElement(card),
        }"
        data-animatable="true"
        :data-element-id="card.id"
        @click="onCardClick(card)"
      >
        {{ card.attributes?.rank }}{{ card.attributes?.suit }}
      </div>
    </div>
  </div>
</template>
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Understanding game state
- [Actions & Flow](./actions-and-flow.md) - How actions work
- [Game Examples](./game-examples.md) - Real UI implementations
