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
      actionArgs,
      actionController,
      setBoardPrompt
    }">
      <GameBoard
        :game-view="gameView"
        :player-position="playerPosition"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action-args="actionArgs"
        :action-controller="actionController"
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
| `actionArgs` | `object` | Shared reactive object for action selections (bidirectional sync with ActionPanel) |
| `actionController` | `UseActionControllerReturn` | Unified action handling - execute, start, fill, cancel actions |
| `setBoardPrompt` | `function` | Set a prompt message: `(text) => void` |
| `canUndo` | `boolean` | Whether undo is available |
| `undo` | `function` | Undo to turn start: `() => Promise` |

#### Shared Action State (actionArgs)

The `actionArgs` object provides **bidirectional synchronization** between custom game boards and ActionPanel:

- **ActionPanel writes** to `actionArgs` when users make selections in the auto-generated UI
- **Custom boards can write** to `actionArgs` to pre-fill selections or respond to board interactions
- **Both see updates** immediately due to Vue's reactivity

This enables powerful hybrid UIs where users can interact with either the game board or the action panel.

**Example: Board pre-filling selections with actionController.start()**
```vue
<script setup lang="ts">
import type { UseActionControllerReturn } from '@boardsmith/ui';

const props = defineProps<{
  actionArgs: Record<string, unknown>;
  actionController: UseActionControllerReturn;
}>();

// When user clicks a piece on the board, start the action with that piece pre-selected
function onPieceClick(pieceId: number) {
  // Pass initial args to start() - they're applied after clearing
  props.actionController.start('move', { args: { piece: pieceId } });
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

ActionPanel clears `actionArgs` when starting, canceling, or completing actions. To pre-fill selections when starting an action, use the `args` option:

```typescript
// Correct: Pass initial values to start()
actionController.start('move', { args: { piece: pieceId } });

// Incorrect: Writing then starting loses the value (cleared on start)
actionArgs.piece = pieceId;
actionController.start('move');  // piece gets cleared!
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
- Displaying on-demand choices (e.g., cards drawn when action clicked)
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

// Get drawn mercs from game settings (stored by on-demand choices callback)
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

**Real Examples:**

1. **Demo: Complex UI Interactions** (`packages/games/demoComplexUiInteractions/`)

   A dedicated demo showing this feature with multiple simultaneous actions. The custom GameBoard:
   - Shows an action status panel displaying the current action and selection step
   - Changes board color based on active action (blue for Collect, red for Discard, etc.)
   - Highlights cards with action-specific colors
   - Includes a debug panel showing raw `boardInteraction` state

2. **Go Fish** (`packages/games/go-fish/ui/src/components/GoFishBoard.vue`)

   Uses `boardInteraction.currentAction` to:
   - Show an "Asking:" indicator banner when the player clicks the Ask button
   - Display which selection step they're on (choosing player vs choosing rank)
   - Only highlight selectable elements after the action button is clicked (not just when available)

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

### useFlyingCards

Manually trigger card/element flight animations between positions.

```typescript
import { useFlyingCards, FlyingCardsOverlay } from '@boardsmith/ui';

const { flyingCards, flyCard, flyCards, cancelAll } = useFlyingCards();

// Fly a card from one element to another
await flyCard({
  id: 'draw-animation',
  startRect: deckElement.getBoundingClientRect(),
  endRect: () => handElement.getBoundingClientRect(),  // Function to track moving targets
  cardData: { rank: 'A', suit: 'S', faceUp: false },
  flip: true,           // Flip card during flight
  duration: 400,        // Animation duration in ms
  cardSize: { width: 60, height: 84 },
});

// Fly multiple cards with stagger
await flyCards([
  { id: 'card-1', startRect: deck, endRect: () => hand, cardData: { rank: 'K', suit: 'H' } },
  { id: 'card-2', startRect: deck, endRect: () => hand, cardData: { rank: 'Q', suit: 'H' } },
], 100);  // 100ms stagger between cards

// In template:
// <FlyingCardsOverlay :flying-cards="flyingCards" />
```

### useAutoAnimations

**Recommended for all games.** The unified animation system that combines flying between containers, FLIP animations within containers, and flying to player stats. One composable to rule them all.

```typescript
import { useAutoAnimations, FlyingCardsOverlay } from '@boardsmith/ui';

// 1. Create refs for DOM elements
const boardRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const discardRef = ref<HTMLElement | null>(null);

// 2. Create computed refs for game elements
const board = computed(() => findElement(gameView, { className: 'Board' }));
const myHand = computed(() => findPlayerHand(gameView, playerPosition));
const discardPile = computed(() => findElement(gameView, { className: 'DiscardPile' }));

// 3. Set up auto-animations
const { flyingElements, isAnimating } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    // Elements reorder within board with FLIP animation
    { element: board, ref: boardRef, flipWithin: '[data-piece-id]' },
    // Cards fly between hand and discard
    { element: myHand, ref: handRef, flipWithin: '[data-card-id]' },
    { element: discardPile, ref: discardRef },
  ],
  // Optional: fly elements to player stats when removed
  flyToStats: [
    {
      stat: 'captured',
      containerRef: boardRef,
      selector: '[data-piece-id]',
      player: (piece) => piece.playerPosition === 0 ? 1 : 0,
    },
  ],
  getElementData: (element) => ({
    rank: element.attributes?.rank,
    suit: element.attributes?.suit,
    playerPosition: element.attributes?.player?.position,
  }),
  duration: 400,
});

// 4. Use in template
// <FlyingCardsOverlay :flying-cards="flyingElements" />
```

**What useAutoAnimations provides:**

1. **Flying between containers** - Elements moving between registered containers animate automatically
2. **FLIP within containers** - Elements reordering within a container animate smoothly (use `flipWithin` option)
3. **Flying to stats** - Elements removed from a container fly to player stat displays

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `gameView` | `() => any` | Function returning current game view |
| `containers` | `ContainerConfig[] \| () => ContainerConfig[]` | Containers to track |
| `flyToStats` | `FlyToStatConfig[]` | Stats to fly elements to when removed |
| `getElementData` | `(element) => FlyingCardData` | Extract display data from game elements |
| `getDOMElementData` | `(el: Element) => Partial<FlyingCardData>` | Extract data from DOM elements (for flyToStats) |
| `duration` | `number` | Animation duration for flying (default: 400ms) |
| `flipDuration` | `number` | Animation duration for FLIP (default: 300ms) |
| `elementSize` | `{ width, height }` | Element dimensions (default: 60x84) |

**Container Config:**

| Property | Type | Description |
|----------|------|-------------|
| `element` | `ComputedRef<any> \| Ref<any>` | Game element for this container |
| `ref` | `Ref<HTMLElement \| null>` | DOM element ref |
| `flipWithin` | `string` | CSS selector for FLIP animations within this container |
| `elementSize` | `{ width, height }` | Optional custom element size |

**FlyToStat Config:**

| Property | Type | Description |
|----------|------|-------------|
| `stat` | `string` | Name of the stat (e.g., 'books', 'captured') |
| `containerRef` | `Ref<HTMLElement \| null>` | Container to track removals from |
| `selector` | `string` | CSS selector to find elements |
| `player` | `number \| ((elementData) => number)` | Target player position |
| `trackCount` | `() => number` | Only fly when this count increases |
| `filter` | `(elementData) => boolean` | Filter which elements fly |

**Example: Checkers with piece captures**

```typescript
const { flyingElements } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    { element: board, ref: boardRef, flipWithin: '[data-piece-id]' },
  ],
  flyToStats: [
    {
      stat: 'captured',
      containerRef: boardRef,
      selector: '[data-piece-id]',
      // Captured pieces fly to the opponent's captured stat
      player: (piece) => piece.playerPosition === 0 ? 1 : 0,
    },
  ],
  getDOMElementData: (el) => ({
    playerPosition: el.classList.contains('player-0') ? 0 : 1,
  }),
  elementSize: { width: 40, height: 40 },
});
```

**Example: Cribbage with card animations**

```typescript
const { flyingElements } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    { element: myHand, ref: handRef, flipWithin: '[data-card-id]' },
    { element: playArea, ref: playAreaRef, flipWithin: '[data-card-id]' },
    { element: crib, ref: cribRef },
    { element: deck, ref: deckRef },
  ],
  getElementData: (el) => ({
    rank: el.attributes?.rank,
    suit: el.attributes?.suit,
    faceImage: el.attributes?.$images?.face,
    backImage: el.attributes?.$images?.back,
  }),
});
```

### useAutoFlyingElements

Automatically animates elements (cards, pieces, tokens) when they move between registered containers. For new code, prefer `useAutoAnimations` which includes FLIP and fly-to-stat features.

```typescript
import { useAutoFlyingElements, FlyingCardsOverlay } from '@boardsmith/ui';

const { flyingElements } = useAutoFlyingElements({
  gameView: () => props.gameView,
  containers: [
    { element: deck, ref: deckRef },
    { element: myHand, ref: handRef },
    { element: discardPile, ref: discardRef },
  ],
  getElementData: (element) => ({
    rank: element.attributes?.rank,
    suit: element.attributes?.suit,
  }),
  duration: 400,
});

// In template:
// <FlyingCardsOverlay :flying-cards="flyingElements" />
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

## Action Controller API

The `actionController` (type: `UseActionControllerReturn`) is the unified interface for executing and managing game actions. It's provided via the `#game-board` slot and handles all action execution, wizard mode navigation, and auto-fill logic.

### Controller Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `execute` | `(name: string, args?: Record<string, unknown>) => Promise<void>` | Execute an action immediately with provided args |
| `start` | `(name: string, options?: StartOptions) => void` | Start wizard mode for a multi-selection action |
| `fill` | `(name: string, value: unknown) => void` | Fill a specific selection in wizard mode |
| `skip` | `() => void` | Skip an optional selection |
| `cancel` | `() => void` | Cancel wizard mode and clear selections |

**StartOptions:**

| Option | Type | Description |
|--------|------|-------------|
| `args` | `Record<string, unknown>` | Values applied immediately to matching selections |
| `prefill` | `Record<string, unknown>` | Values auto-filled when their selection becomes active |

Use `args` for selections that are already available. Use `prefill` for deferred auto-fill of future selections (e.g., when the first selection determines which options appear in the second).

### Controller State

| Property | Type | Description |
|----------|------|-------------|
| `pendingAction` | `string \| null` | Name of action currently in wizard mode |
| `currentSelection` | `SelectionMetadata \| null` | Metadata for the current selection step |
| `validElements` | `ComputedRef<ValidElement[]>` | **Reactive** list of valid elements for current selection |
| `isExecuting` | `boolean` | Whether an action is currently executing |
| `error` | `string \| null` | Error message from last failed execution |

### Element Selections with validElements

When building custom UIs for element selections (`fromElements`, `chooseElement`), use the **reactive `validElements` computed** instead of `getValidElements()`. This computed automatically updates when:
- The current selection changes
- Choices are fetched from the server
- The gameView updates

```typescript
const { validElements, currentSelection } = props.actionController;

// Use the reactive computed directly - it updates automatically!
const selectableCards = computed(() => {
  if (currentSelection.value?.type !== 'element') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    name: ve.display,
    // Full element data is included:
    image: ve.element?.attributes?.image,
    description: ve.element?.attributes?.description,
  }));
});
```

Each `ValidElement` includes:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` | Element ID (for submitting selection) |
| `display` | `string?` | Display text for UI |
| `ref` | `{ id: number }?` | Reference for board highlighting |
| `element` | `GameElement?` | Full element with all attributes |

**Why not `getValidElements()`?** Maps aren't reactive in Vue, so `getValidElements()` won't trigger re-renders when choices load. The `validElements` computed has built-in reactivity tracking.

See [Element Enrichment](./element-enrichment.md) for full documentation.

### Usage Patterns

**Direct execution (single-step actions):**
```typescript
// Execute an action with all args provided
await actionController.execute('draw', { count: 3 });

// Execute an action that requires no selections
await actionController.execute('endTurn');
```

**Wizard mode (multi-step actions):**
```typescript
// Start wizard mode - ActionPanel shows selection UI
actionController.start('move');

// Pre-fill the first selection immediately
actionController.start('move', { args: { piece: pieceId } });

// Prefill a future selection (auto-filled when that step becomes active)
actionController.start('move', {
  args: { piece: pieceId },
  prefill: { destination: targetCellId }  // Applied when 'destination' selection activates
});

// Custom boards can fill selections programmatically
actionController.fill('destination', cellId);

// Skip optional selections
actionController.skip();

// Cancel and clear
actionController.cancel();
```

**Reading controller state:**
```typescript
// Check if an action is in progress
if (actionController.pendingAction === 'move') {
  // Show move-specific UI
}

// Show loading state during execution
<button :disabled="actionController.isExecuting">
  {{ actionController.isExecuting ? 'Working...' : 'Execute' }}
</button>

// Display errors
<div v-if="actionController.error" class="error">
  {{ actionController.error }}
</div>
```

## Error Handling in UI

The `actionController` provides error state that your UI should handle gracefully.

### Displaying Action Errors

```vue
<template>
  <div class="game-board">
    <!-- Error toast/banner -->
    <Transition name="fade">
      <div v-if="actionController.error" class="error-banner">
        {{ actionController.error }}
        <button @click="dismissError">×</button>
      </div>
    </Transition>

    <!-- Game content -->
    <GameBoard ... />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  actionController: UseActionControllerReturn;
}>();

// Error auto-dismisses after 5 seconds
watch(() => props.actionController.error, (error) => {
  if (error) {
    setTimeout(() => {
      // Error clears automatically on next successful action
      // Or clear manually if your UI needs it
    }, 5000);
  }
});
</script>

<style>
.error-banner {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: #e74c3c;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  z-index: 1000;
}
</style>
```

### Loading States During Execution

Show feedback while actions are processing:

```vue
<template>
  <!-- Disable board interactions while executing -->
  <div
    class="game-board"
    :class="{ 'is-loading': actionController.isExecuting }"
  >
    <!-- Loading overlay -->
    <div v-if="actionController.isExecuting" class="loading-overlay">
      <span class="spinner" />
    </div>

    <!-- Action buttons -->
    <button
      v-for="action in availableActions"
      :key="action"
      :disabled="actionController.isExecuting"
      @click="executeAction(action)"
    >
      {{ actionController.isExecuting ? 'Working...' : action }}
    </button>
  </div>
</template>

<style>
.game-board.is-loading {
  pointer-events: none;
  opacity: 0.7;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
}
</style>
```

### Handling Specific Error Types

Common error messages and how to handle them:

```typescript
async function handleAction(name: string, args: Record<string, unknown>) {
  try {
    await actionController.execute(name, args);
  } catch (e) {
    // actionController.error is already set, but you may want custom handling
  }

  // Check error after execution
  const error = actionController.error;
  if (error) {
    switch (true) {
      case error.includes('Not your turn'):
        // UI should already prevent this, but handle gracefully
        showToast('Please wait for your turn');
        break;

      case error.includes('not available'):
        // Action became unavailable (opponent moved, etc.)
        showToast('This action is no longer available');
        refreshAvailableActions();
        break;

      case error.includes('Invalid selection'):
        // Selection was rejected by the server
        showToast('Invalid selection - please try again');
        actionController.cancel();
        break;

      default:
        // Generic error display
        showToast(error);
    }
  }
}
```

### Preventing Errors with Validation

Check availability before showing interactive elements:

```vue
<template>
  <!-- Only show clickable cards that are valid selections -->
  <div
    v-for="card in myHand"
    :key="card.id"
    class="card"
    :class="{
      'clickable': isCardPlayable(card),
      'disabled': !isCardPlayable(card),
    }"
    @click="isCardPlayable(card) && playCard(card)"
  >
    {{ card.rank }}{{ card.suit }}
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  actionController: UseActionControllerReturn;
  availableActions: string[];
}>();

// Check if card can be played
function isCardPlayable(card: GameViewElement): boolean {
  // Must be our turn and action available
  if (!props.availableActions.includes('play')) return false;

  // If in wizard mode, check validElements
  const { currentSelection, validElements } = props.actionController;
  if (currentSelection.value?.name === 'card') {
    return validElements.value.some(ve => ve.id === card.id);
  }

  return true;
}
</script>
```

### Error Recovery Patterns

```typescript
// Retry failed actions
async function executeWithRetry(
  name: string,
  args: Record<string, unknown>,
  maxRetries = 2
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await actionController.execute(name, args);

    if (!actionController.error) return; // Success

    if (attempt < maxRetries) {
      // Wait before retry (connection issues)
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // All retries failed
  showToast('Action failed - please try again');
}

// Reset UI state on persistent errors
function handlePersistentError() {
  actionController.cancel();
  // Refresh game state from server
  refreshGameState();
}
```

## Building Custom UIs

## Game View Data Structure

The `gameView` prop contains serialized game state. Each element has this structure:

```typescript
interface GameViewElement {
  id: number;              // Unique element ID - use this for action args!
  className: string;       // Element class name (e.g., 'Merc', 'Card')
  name?: string;           // Optional element name
  attributes: {            // Game-specific properties
    rank?: string;
    suit?: string;
    health?: number;
    // ... your custom properties
  };
  children?: GameViewElement[];  // Child elements
}
```

**Key point:** The `id` is at the top level, NOT inside `attributes`.

```typescript
// Correct - ID is at top level
const mercId = merc.id;  // ✓

// Wrong - ID is not in attributes
const mercId = merc.attributes.id;  // ✗ undefined
```

### Finding Elements by ID vs by Attributes

A common pattern is having UI data (like a selected equipment name) and needing to find the element's numeric ID for API calls. The element data you display comes from `attributes`, but the ID you need for actions is at the top level.

**The Problem:**
```typescript
// You have equipment stats displayed in the UI
const selectedEquipment = { name: 'Laser Rifle', damage: 10 };

// But you need the element ID to drop it
// How do you find the ID?
```

**The Solution:** Use `findChildByAttribute` to search children:

```typescript
import { findChildByAttribute, getElementId } from '@boardsmith/ui';

// Find equipment element by its name attribute
const equipment = findChildByAttribute(merc, 'equipmentName', selectedEquipment.name);
const equipmentId = getElementId(equipment);

if (equipmentId) {
  await actionController.execute('dropEquipment', {
    actingMerc: merc.id,
    equipment: equipmentId
  });
}
```

### Helper Functions for Finding Elements

The `@boardsmith/ui` package provides several helpers for finding elements:

| Function | Description | Use When |
|----------|-------------|----------|
| `findElement(view, { type, name, className })` | Find direct child by type/name/class | Finding top-level containers |
| `findChildByAttribute(parent, attrName, value)` | Find direct child by attribute | Finding element when you have attribute data |
| `findElementByAttribute(root, attrName, value)` | Recursive search by attribute | Finding element anywhere in tree |
| `findElementById(root, id)` | Recursive search by numeric ID | Finding element when you have its ID |
| `getElementId(element)` | Get numeric ID from element | Extracting ID for action calls |

**Example: Equipment Modal**

```typescript
// User selects equipment from a modal showing equipment data
const selectedEquipmentName = 'Plasma Cannon';

// Find the merc that has this equipment
const merc = findElement(gameView, { className: 'Merc' });

// Find the equipment element by searching merc's children
const equipment = findChildByAttribute(merc, 'equipmentName', selectedEquipmentName);

if (equipment) {
  console.log('Found equipment ID:', equipment.id);  // e.g., 42
  await actionController.execute('dropEquipment', {
    actingMerc: merc.id,
    equipment: equipment.id  // Use the numeric ID
  });
}
```

**Example: Finding Any Element by Unique Attribute**

```typescript
// Find a sector anywhere in the game by its unique sector ID
const sector = findElementByAttribute(gameView, 'sectorId', 'alpha-3');
if (sector) {
  await actionController.execute('moveTo', { destination: sector.id });
}
```

## Calling Actions from Custom UIs

### When to Use `execute()` vs `start()`

The `actionController` has two main ways to trigger actions. Choosing the right one depends on whether you have all the information needed upfront.

| Method | Use When | What Happens |
|--------|----------|--------------|
| `execute(name, args)` | You have all selection values ready | Action executes immediately |
| `start(name, options?)` | User needs to make selections via ActionPanel | Enters wizard mode, ActionPanel shows selection UI |

**Decision Guide:**

```
Do you have ALL required selection values?
├── YES → Use execute()
│   Example: await execute('draw', { count: 3 })
│
└── NO → Use start()
    │
    ├── Do you have SOME values to pre-fill?
    │   └── YES → start('action', { args: { known: value } })
    │
    └── Should later selections auto-fill when they become active?
        └── YES → start('action', { prefill: { later: value } })
```

**Common Patterns:**

```typescript
// Pattern 1: No selections required (e.g., endTurn, pass)
await actionController.execute('endTurn');

// Pattern 2: All selections known (direct board click)
await actionController.execute('move', {
  piece: clickedPiece.id,
  destination: clickedCell.id
});

// Pattern 3: Start wizard mode (let ActionPanel handle selections)
actionController.start('play');

// Pattern 4: Pre-fill first selection, let user choose rest
actionController.start('move', { args: { piece: clickedPiece.id } });

// Pattern 5: Pre-fill dependent selection (auto-fills when reached)
actionController.start('dropEquipment', {
  args: { actingMerc: merc.id },
  prefill: { equipment: equipmentId }  // Applied when 'equipment' step activates
});
```

**args vs prefill:**

- `args`: Applied immediately when `start()` is called. Use for selections that are available now.
- `prefill`: Applied later when that selection step becomes active. Use for dependent selections where the choice isn't visible until a prior selection is made.

When calling `actionController.execute()` or `actionController.fill()`, pass **numeric element IDs**:

```typescript
// For fromElements / chooseElement selections, pass the element ID
await actionController.execute('dropEquipment', {
  actingMerc: merc.id,       // number (e.g., 42)
  equipment: equipment.id,   // number (e.g., 17)
});

// For chooseFrom selections, pass the choice value
await actionController.execute('selectColor', {
  color: 'red',  // The actual choice value
});
```

The framework automatically converts element IDs to actual element objects before passing to the `execute()` handler.

### Complete Custom UI Flow Example

```typescript
// 1. Find elements in gameView
const myMercs = computed(() =>
  findElements(props.gameView, { className: 'Merc' })
    .filter(m => m.attributes?.player?.position === props.playerPosition)
);

// 2. User clicks a merc
async function onMercClick(merc: GameViewElement) {
  if (!props.availableActions.includes('dropEquipment')) return;

  // 3. Start wizard mode with merc pre-selected
  await props.actionController.start('dropEquipment', {
    args: { actingMerc: merc.id }  // Pass numeric ID
  });
}

// 4. User clicks equipment (using validElements from actionController)
async function onEquipmentClick(equipment: GameViewElement) {
  const { currentSelection, validElements } = props.actionController;

  // Check if this equipment is selectable
  if (currentSelection.value?.name !== 'equipment') return;
  if (!validElements.value.some(ve => ve.id === equipment.id)) return;

  // Fill the selection with the equipment ID
  await props.actionController.fill('equipment', equipment.id);
}
```

### Debugging Action Calls

To debug what's being sent to the server, add logging:

```typescript
async function executeAction(name: string, args: Record<string, unknown>) {
  console.log('[Action]', name, 'args:', JSON.stringify(args, null, 2));
  await props.actionController.execute(name, args);
}
```

Or check the Network tab in browser dev tools - look for WebSocket messages or `/action` API calls.

### Example: Custom Game Board

```vue
<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import {
  useBoardInteraction,
  useElementAnimation,
  findPlayerHand,
  getCards,
  type UseActionControllerReturn
} from '@boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
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

  // Check if card is selectable via board interaction (wizard mode active)
  if (boardInteraction?.isSelectableElement(card)) {
    boardInteraction.triggerElementSelect(card);
  } else {
    // Direct action execution
    await props.actionController.execute('play', { card: card.id });
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
- [Element Enrichment](./element-enrichment.md) - Using validElements for custom selection UIs
- [Game Examples](./game-examples.md) - Real UI implementations
