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

## Lobby Components

BoardSmith provides a complete lobby system for configuring games before they start. The lobby dynamically renders controls based on game definition metadata.

### GameLobby

The main lobby component that fetches game definition metadata and renders configuration UI.

```vue
<template>
  <GameLobby
    :game-type="gameType"
    :player-count="playerCount"
    @create="handleCreate"
  />
</template>

<script setup lang="ts">
import { GameLobby } from '@boardsmith/ui';

const gameType = 'hex';
const playerCount = 2;

function handleCreate(config: { gameOptions: Record<string, unknown>; playerConfigs: PlayerConfig[] }) {
  // Create game with the configured options
}
</script>
```

The lobby automatically:
- Fetches game definition from `/games/definitions` endpoint
- Renders game options (number inputs, selects, toggles)
- Renders per-player configuration (name, AI toggle, color picker)
- Shows preset cards for quick setup
- Validates player count against game limits

### GameOptionsForm

Dynamic form that renders game-level options from metadata.

```vue
<template>
  <GameOptionsForm
    :options="gameDefinition.gameOptions"
    v-model="gameOptions"
  />
</template>
```

Supports three option types:

| Type | Control | Properties |
|------|---------|------------|
| `number` | Number input | `min`, `max`, `step`, `default` |
| `select` | Dropdown | `choices` (array of `{ value, label }`) |
| `boolean` | Toggle switch | `default` |

### PlayerConfigList

Per-player configuration with AI toggle and custom options.

```vue
<template>
  <PlayerConfigList
    :player-count="2"
    :has-ai="true"
    :player-options="gameDefinition.playerOptions"
    v-model="playerConfigs"
  />
</template>
```

Features:
- Player name input
- AI toggle with level selector (when game has AI)
- Dynamic rendering of per-player options (color picker, role select, etc.)
- Shows taken options as disabled with visual indicator
- Exclusive options render as radio buttons (exactly one player can be selected)

### PresetsPanel

Quick-start preset cards for common game configurations.

```vue
<template>
  <PresetsPanel
    :presets="gameDefinition.presets"
    @select="applyPreset"
  />
</template>

<script setup lang="ts">
function applyPreset(preset: GamePreset) {
  // Apply preset.options to gameOptions
  // Apply preset.players to playerConfigs
}
</script>
```

### Standard Color Picker

BoardSmith provides a standard color palette and utilities for player color selection.

```typescript
import {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,
  createColorOption
} from '@boardsmith/session';

// Standard 8-color palette
STANDARD_PLAYER_COLORS
// [{ value: '#e74c3c', label: 'Red' }, { value: '#3498db', label: 'Blue' }, ...]

// Default 2-player colors (Red, Blue)
DEFAULT_PLAYER_COLORS
// ['#e74c3c', '#3498db']

// Create a color option for game definition
export const gameDefinition = {
  // ...
  playerOptions: {
    color: createColorOption(), // Uses standard colors
  },
};

// Or with custom colors
playerOptions: {
  color: createColorOption([
    { value: '#ff0000', label: 'Fire' },
    { value: '#0000ff', label: 'Ice' },
  ], 'Team Color'),
}
```

The color picker in PlayerConfigList:
- Shows color swatches with labels
- Disables already-selected colors with X overlay
- Automatically applies first available color as default

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

#### Action State Detection

Custom game boards can detect which action is currently being filled in. This is useful when:
- Showing visual feedback based on the active action
- Displaying deferred choices (cards drawn when action clicked)
- Customizing the board based on current selection step

```typescript
import { useBoardInteraction } from '@boardsmith/ui';
import { computed, watch } from 'vue';

const boardInteraction = useBoardInteraction();

// Current action being filled in (null if none)
boardInteraction.currentAction         // string | null

// Which selection step the player is on (0-based)
boardInteraction.currentSelectionIndex // number

// Name of the current selection
boardInteraction.currentSelectionName  // string | null
```

**Example: Detecting when "Hire First MERC" is clicked**

```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useBoardInteraction } from '@boardsmith/ui';

const props = defineProps<{
  gameView: any;
}>();

const boardInteraction = useBoardInteraction();

// Detect when hiring action is active
const isHiringMerc = computed(() =>
  boardInteraction?.currentAction === 'hireFirstMerc'
);

// Get drawn mercs from game settings (stored by deferred choices callback)
const drawnMercs = computed(() => {
  if (!isHiringMerc.value) return [];

  const ids = props.gameView.settings?._drawnMercsForHiring as number[] | undefined;
  if (!ids?.length) return [];

  // Find the elements by ID in the game view
  return ids.map(id => findElementById(props.gameView, id)).filter(Boolean);
});

// React to action changes
watch(() => boardInteraction?.currentAction, (action, prevAction) => {
  if (action === 'hireFirstMerc') {
    console.log('Player started hiring a MERC');
  }
  if (prevAction === 'hireFirstMerc' && !action) {
    console.log('Hiring action completed or cancelled');
  }
});
</script>

<template>
  <div class="game-board">
    <!-- Show drawn MERC cards when hiring -->
    <div v-if="isHiringMerc && drawnMercs.length" class="hiring-overlay">
      <h3>Choose a MERC to hire:</h3>
      <div class="drawn-mercs">
        <MercCard v-for="merc in drawnMercs" :key="merc.id" :merc="merc" />
      </div>
    </div>
  </div>
</template>
```

> **Note:** Action state is automatically cleared when the action completes, is cancelled, or the turn ends.

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

### useAutoFlyAnimation

Automatic flying animations when elements leave a zone. This composable provides a unified, foolproof way to animate elements flying from a game zone to a player stat display.

```typescript
import { useAutoFlyAnimation } from '@boardsmith/ui';

const { flyingCards, watchZone } = useAutoFlyAnimation();

// Watch a zone for removals and fly to a stat
watchZone({
  containerRef: myHandRef,
  gameView: () => props.gameView,
  getElementIds: (gv) => getHandCardIds(gv),
  targetStat: 'books',
  getTargetPlayer: (elementData) => props.playerPosition,
});
```

**Setup Requirements:**

1. Add data attributes to game elements:
```html
<div
  data-element-id="123"
  data-face-image="/cards/ah.png"
  data-back-image="/cards/back.png"
  data-rank="A"
  data-suit="H"
  data-player-position="0"
  data-face-up="true"
>...</div>
```

2. Add data attributes to player stat targets:
```html
<span data-player-stat="books" data-player-position="0">{{ count }}</span>
```

3. Include the FlyingCardsOverlay in your template:
```vue
<template>
  <div class="game-board">
    <!-- Your game content -->
  </div>
  <FlyingCardsOverlay :flying-cards="flyingCards" />
</template>
```

**Data Attributes:**

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-element-id` | Unique ID for tracking | "123" |
| `data-face-image` | URL of card/piece face | "/cards/ah.png" |
| `data-back-image` | URL of card/piece back | "/cards/back.png" |
| `data-rank` | Card rank | "A", "K", "10" |
| `data-suit` | Card suit | "H", "D", "C", "S" |
| `data-player-position` | Owner position | "0" |
| `data-face-up` | Whether element shows face | "true" |

**Why This Works:**

Previous implementations had problems where imagery was extracted from game state, which changes before animation. This solution:
- Uses DOM data attributes as the source of truth for imagery
- Captures data BEFORE state changes (using `flush: 'sync'` watcher)
- Provides standard attribute names all games can use
- Requires zero game-specific animation code

**Helper Function:**

```typescript
import { getElementDataAttrs } from '@boardsmith/ui';

// In template - automatically generate data attributes
<div v-bind="getElementDataAttrs({
  id: card.id,
  faceImage: card.image,
  backImage: '/cards/back.png',
  rank: card.rank,
  suit: card.suit,
  playerPosition: card.owner,
  faceUp: card.faceUp,
})">
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
