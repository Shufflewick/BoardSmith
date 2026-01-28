# UI Components & Composables

BoardSmith provides Vue 3 components and composables for building game UIs. The `boardsmith/ui` package includes everything from high-level shells to low-level animation utilities.

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
      playerSeat,
      isMyTurn,
      availableActions,
      actionArgs,
      actionController,
      setBoardPrompt
    }">
      <GameTable
        :game-view="gameView"
        :player-seat="playerSeat"
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
import { GameShell } from 'boardsmith/ui';
import GameTable from './components/GameTable.vue';
</script>
```

#### Slot Props

The `#game-board` slot receives:

| Prop | Type | Description |
|------|------|-------------|
| `state` | `GameState` | Full game state |
| `gameView` | `object` | Player-filtered view of game state |
| `playerSeat` | `number` | Current player's seat |
| `isMyTurn` | `boolean` | Whether it's this player's turn |
| `availableActions` | `string[]` | Actions available to the player |
| `actionArgs` | `object` | Current action selections - **read-only for display**, use `actionController` methods to modify |
| `actionController` | `UseActionControllerReturn` | Unified action handling - execute, start, fill, cancel actions |
| `setBoardPrompt` | `function` | Set a prompt message: `(text) => void` |
| `canUndo` | `boolean` | Whether undo is available |
| `undo` | `function` | Undo to turn start: `() => Promise` |

#### Action State (actionArgs)

The `actionArgs` object contains the current action's selection values. **Use it for reading/display only** - all modifications should go through `actionController` methods.

**Reading actionArgs (safe)**
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

**Modifying selections (use actionController)**
```typescript
// Starting an action with pre-filled values
actionController.start('move', { args: { piece: pieceId } });

// Filling a selection during an action
actionController.fill('destination', squareId);

// DON'T write directly to actionArgs - use fill() instead
// actionArgs.destination = squareId;  // Wrong!
```

**Why not write directly?**

The controller tracks which values it has set. When fetching choices from the server, it only sends values it knows about. Direct writes to `actionArgs` are ignored by the controller, preventing race conditions during async operations like `followUp` chains.

If you write to `actionArgs` directly, you'll see a development warning:
```
Detected unexpected keys in actionArgs during 'collectEquipment': equipment
  These were NOT set by the action controller (start/fill/startFollowUp).
  This usually means your custom UI is writing to actionArgs in a watcher/computed.
  The controller ignores these to prevent bugs - use actionController.fill() instead.
```

**Board interactions pattern**
```vue
<script setup lang="ts">
const props = defineProps<{
  actionArgs: Record<string, unknown>;
  actionController: UseActionControllerReturn;
}>();

// When user clicks a piece, start the action with that piece pre-selected
function onPieceClick(pieceId: number) {
  props.actionController.start('move', { args: { piece: pieceId } });
}

// When user clicks a destination during an active action
function onSquareClick(squareId: number) {
  if (props.actionController.currentAction.value === 'move') {
    props.actionController.fill('destination', squareId);
  }
}
</script>
```

### AutoUI

Automatic UI generation from game state. Useful for prototyping or as a reference implementation.

```vue
<template>
  <AutoUI
    :game-view="gameView"
    :player-seat="playerSeat"
    :flow-state="flowState"
  />
</template>

<script setup lang="ts">
import { AutoUI } from 'boardsmith/ui';
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
import { GameLobby } from 'boardsmith/ui';

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

### Player Colors

Players automatically receive colors from the engine's color palette. Access them via the `color` property:

```typescript
// In rules code
const myColor = player.color;  // '#e74c3c'

// In UI via gameView
const playerColor = gameView.players[playerSeat - 1].color;
```

#### Custom Color Palette

To use a custom color palette, specify it in your game definition:

```typescript
export const gameDefinition = {
  // Custom colors (optional - defaults to engine's DEFAULT_COLOR_PALETTE)
  colors: ['#ff0000', '#0000ff', '#00ff00', '#ffff00'],

  // Disable color selection in lobby (optional, default: true)
  colorSelectionEnabled: false,
};
```

#### Lobby Color Selection

To enable players to choose colors in the lobby, use `createColorOption`:

```typescript
import { createColorOption, STANDARD_PLAYER_COLORS } from 'boardsmith/session';

export const gameDefinition = {
  playerOptions: {
    color: createColorOption(), // Uses STANDARD_PLAYER_COLORS (8 colors)
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

Overlay for card flight animations between positions. Teleports to body to render above all content.

```vue
<template>
  <FlyingCardsOverlay
    :flying-cards="flyingCards"
  />
</template>
```

### GameOverlay

Modal overlay that stays **constrained within the game content area**, keeping header and ActionPanel accessible. Unlike FlyingCardsOverlay, this does NOT teleport to body.

**How it works:** GameOverlay uses `position: fixed` but renders in-place (no Teleport). When inside GameShell's zoom-container (which has `contain: layout`), the fixed positioning is trapped within that container.

```vue
<script setup>
import { ref } from 'vue';
import { GameOverlay } from 'boardsmith/ui';

const showModal = ref(false);
</script>

<template>
  <GameOverlay :active="showModal" @click="showModal = false">
    <div class="my-modal" @click.stop>
      <h2>Round Summary</h2>
      <p>Game content here...</p>
      <button @click="showModal = false">Continue</button>
    </div>
  </GameOverlay>
</template>

<style scoped>
.my-modal {
  /* Sticky keeps modal in viewport even if game content is taller */
  position: sticky;
  top: 10px;
  margin: 0 auto;
  max-height: calc(100vh - 150px);
  overflow: auto;

  /* Your styling */
  background: #1a1a2e;
  padding: 20px;
  border-radius: 12px;
  max-width: 500px;
  width: 90%;
}
</style>
```

**Props:**
- `active` (boolean) - Whether overlay is visible
- `backdrop` (boolean, default: true) - Enable backdrop blur
- `backdropOpacity` (number, default: 0.85) - Backdrop darkness 0-1

**Events:**
- `@click` - Fires when clicking the backdrop (use `@click.stop` on content to prevent)

**Important:**
- Must be rendered inside a component within GameShell's game-board slot
- Use `@click.stop` on your modal content to prevent backdrop clicks from closing
- Use `position: sticky` on content for tall game boards

## Composables

### useBoardInteraction

Bidirectional interaction between action panel and game board.

```typescript
import { useBoardInteraction, createBoardInteraction, provideBoardInteraction } from 'boardsmith/ui';

// In GameShell (provide)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// In GameTable or ActionPanel (inject)
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
import { useBoardInteraction } from 'boardsmith/ui';
import { computed, watch } from 'vue';

const boardInteraction = useBoardInteraction();

// Current action being filled in (null if none)
boardInteraction.currentAction         // string | null

// Which selection step the player is on (0-based)
boardInteraction.currentPickIndex // number

// Name of the current pick
boardInteraction.currentPickName  // string | null
```

**Example: Detecting when "Hire First MERC" is clicked**

```vue
<script setup lang="ts">
import { computed, watch } from 'vue';
import { useBoardInteraction } from 'boardsmith/ui';

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

### useDragDrop

Composable for drag-and-drop in custom UIs. Call once at setup, get functions that work with any element. ActionPanel automatically orchestrates drag-drop by detecting when drag starts, finding matching actions, and executing on drop.

#### Quick Start (Recommended)

Use the pit-of-success API with the library's CSS for minimal boilerplate:

```vue
<script setup lang="ts">
import { useDragDrop } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

const { drag, drop } = useDragDrop();

// Condition function determines when cards can be dragged
const canDragCard = (cardId: number) =>
  currentAction.value === 'moveCard' &&
  currentPick.value?.name === 'card' &&
  isCardSelectable(cardId);
</script>

<template>
  <!-- Cards: drag with condition -->
  <div
    v-for="card in cards"
    :key="card.id"
    v-bind="drag({ id: card.id }, { when: canDragCard(card.id) }).props"
    :class="drag({ id: card.id }, { when: canDragCard(card.id) }).classes"
  >
    {{ card.name }}
  </div>

  <!-- Zones: always accept drops (when action is active) -->
  <div
    v-for="zone in zones"
    :key="zone.id"
    v-bind="drop({ name: zone.id }).props"
    :class="drop({ name: zone.id }).classes"
  >
    {{ zone.name }}
  </div>
</template>
```

The library CSS provides:
- `.bs-draggable` - cursor: grab, smooth transitions
- `.bs-dragging` - opacity: 0.5, scale(0.95), cursor: grabbing
- `.bs-drop-target` - green highlight with glow

#### Customizing Drag-Drop Styles

Override CSS variables in your game's stylesheet:

```css
:root {
  --bs-draggable-cursor: grab;
  --bs-dragging-opacity: 0.5;
  --bs-dragging-scale: 0.95;
  --bs-drop-target-bg: rgba(236, 72, 153, 0.15);  /* Pink instead of green */
  --bs-drop-target-border-color: rgba(236, 72, 153, 0.6);
  --bs-drop-target-shadow: 0 0 12px rgba(236, 72, 153, 0.4);
}
```

Or use your own class names alongside the library classes:

```css
/* Game-specific styling that extends the library's bs-* classes */
.card.bs-draggable {
  border-color: rgba(236, 72, 153, 0.6);
  animation: pulse-drag 1.5s ease-in-out infinite;
}

.zone.bs-drop-target {
  background: rgba(236, 72, 153, 0.15);
}
```

#### API Reference

| Function | Signature | Description |
|----------|-----------|-------------|
| `drag` | `(ref, options?) => { props, classes }` | **Recommended.** Combined helper for draggable elements |
| `drop` | `(ref) => { props, classes }` | **Recommended.** Combined helper for drop targets |
| `dragClasses` | `(ref, options?) => DragClasses` | Just the CSS classes for draggable elements |
| `dropClasses` | `(ref) => DropClasses` | Just the CSS classes for drop targets |
| `dragProps` | `(ref) => DragProps` | Low-level: just the drag props |
| `dropProps` | `(ref) => DropProps` | Low-level: just the drop props |
| `isDragging` | `(ref) => boolean` | Check if element is being dragged |
| `isDropTarget` | `(ref) => boolean` | Check if element is valid drop target |

**DragOptions:**
- `when?: boolean | (() => boolean)` - Condition for enabling drag. When false, props are empty and `.bs-draggable` is not applied.

**ElementRef:**
- Can include `id`, `name`, or `notation` to identify the element.

#### Migration from Verbose Pattern

**Before (verbose):**
```vue
<script setup>
const { dragProps, dropProps, isDragging, isDropTarget } = useDragDrop();

const isDragDropCardSelection = computed(() =>
  currentAction.value === 'moveCard' && currentPick.value?.name === 'card'
);

function isCardDragging(cardId) { return isDragging({ id: cardId }); }
function isZoneDropTarget(zoneName) { return isDropTarget({ name: zoneName }); }
</script>

<template>
  <div
    v-bind="isDragDropCardSelection && isSelectable(card.id) ? dragProps({ id: card.id }) : {}"
    :class="{
      'is-dragging': isCardDragging(card.id),
      'draggable': isDragDropCardSelection && isSelectable(card.id),
    }"
  />
</template>

<style>
.draggable { cursor: grab; }
.is-dragging { opacity: 0.5; }
.drop-target { background: rgba(0, 255, 136, 0.3); }
</style>
```

**After (pit of success):**
```vue
<script setup>
import 'boardsmith/ui/animation/drag-drop.css';
const { drag, drop } = useDragDrop();

const canDrag = (cardId) =>
  currentAction.value === 'moveCard' &&
  currentPick.value?.name === 'card' &&
  isSelectable(cardId);
</script>

<template>
  <div
    v-bind="drag({ id: card.id }, { when: canDrag(card.id) }).props"
    :class="drag({ id: card.id }, { when: canDrag(card.id) }).classes"
  />
</template>
```

**Lines reduced:** ~50 -> ~10 (80% reduction)

### Drag-and-Drop in Custom UIs

When building custom game boards with drag-and-drop, use `useDragDrop`. ActionPanel automatically:
1. Detects when drag starts (via `boardInteraction.isDragging`)
2. Finds matching actions for the dragged element
3. Sets up valid drop targets from filtered choices
4. Executes the action when dropped on a valid target

**Example: Assigning Combatants to Squads**

```vue
<script setup lang="ts">
import { useDragDrop } from 'boardsmith/ui';
import 'boardsmith/ui/animation/drag-drop.css';

const props = defineProps<{
  squads: Squad[];
}>();

const { drag, drop } = useDragDrop();

// Drag is always enabled for combatants in this simple example
const canDrag = () => true;
</script>

<template>
  <div class="squad-assignment">
    <div
      v-for="squad in squads"
      :key="squad.id"
      class="squad"
      v-bind="drop({ name: squad.id }).props"
      :class="drop({ name: squad.id }).classes"
    >
      <h3>{{ squad.name }}</h3>
      <div
        v-for="combatant in squad.combatants"
        :key="combatant.id"
        class="combatant"
        v-bind="drag({ name: combatant.name }, { when: canDrag() }).props"
        :class="drag({ name: combatant.name }, { when: canDrag() }).classes"
      >
        {{ combatant.name }}
      </div>
    </div>
  </div>
</template>
```

**Real Examples:**

1. **Demo: Complex UI Interactions** (`packages/games/demoComplexUiInteractions/`)

   A dedicated demo showing this feature with multiple simultaneous actions. The custom GameTable:
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
import { useElementAnimation } from 'boardsmith/ui';

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
import { useFlyingCards, FlyingCardsOverlay } from 'boardsmith/ui';

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

### useActionAnimations

Declarative animations triggered by action execution. Captures element positions before actions execute and animates to the new position after the DOM updates. Integrates with `actionController.registerBeforeAutoExecute()`.

**Key Feature: Flip-in-Place Auto-Detection**

When `elementSelector` equals `destinationSelector`, the composable auto-detects a "flip-in-place" animation and configures everything correctly:

```typescript
import { useActionAnimations, FlyingCardsOverlay } from 'boardsmith/ui';

const gameViewRef = ref(null);

const actionAnimations = useActionAnimations({
  gameView: gameViewRef,
  animations: [
    // Movement animation (element moves to a different destination)
    {
      action: 'assignToSquad',
      elementSelection: 'combatantName',
      elementSelector: '[data-combatant="{combatantName}"]',
      destinationSelector: '[data-squad="{targetSquad}"]',
      duration: 500,
    },
    // Flip-in-place (auto-detected: same selector = flip animation)
    {
      action: 'flipCard',
      elementSelection: 'card',
      elementSelector: '[data-card-id="{card}"]',
      destinationSelector: '[data-card-id="{card}"]', // Same = flip-in-place!
      duration: 400,
    },
  ],
});

// Register with actionController (in GameTable setup)
function setupAnimations(actionController, gameView) {
  gameViewRef.value = gameView;
  actionController.registerBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);
}
```

In template:
```vue
<FlyingCardsOverlay :flying-cards="actionAnimations.flyingElements" />
```

**Flip-in-Place Behavior:**

When the composable detects a flip-in-place animation (`elementSelector === destinationSelector`), it automatically:
- Hides the element during animation (prevents "double card" effect)
- Enables 3D flip animation
- Uses instant reveal (no crossfade) to prevent visual artifacts
- Configures internal timing to avoid flash/flicker issues

You don't need to set `hideDestination`, `flip`, or `crossfadeDuration` - they're configured automatically.

**Animation Config Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `action` | `string` | required | Action name that triggers this animation |
| `elementSelection` | `string` | required | Selection name whose value identifies the element |
| `elementSelector` | `string` | required | CSS selector with `{placeholder}` for action args |
| `destinationSelector` | `string \| function` | required | Where element moves to (same as source = flip-in-place) |
| `duration` | `number` | 400 | Animation duration in ms |
| `elementSize` | `{ width, height }` | 60x84 | Size of flying element |
| `flip` | `boolean` | auto | Enable 3D flip (auto-enabled for flip-in-place) |
| `hideDestination` | `boolean` | auto | Hide destination during animation (auto-enabled for flip-in-place) |
| `getElementData` | `function` | innerHTML | Extract data for rendering flying element |

### useAutoAnimations

**Recommended for all games.** The unified animation system that combines flying between containers, FLIP animations within containers, and flying to player stats. One composable to rule them all.

```typescript
import { useAutoAnimations, FlyingCardsOverlay } from 'boardsmith/ui';

// 1. Create refs for DOM elements
const boardRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const discardRef = ref<HTMLElement | null>(null);

// 2. Create computed refs for game elements
const board = computed(() => findElement(gameView, { className: 'Board' }));
const myHand = computed(() => findPlayerHand(gameView, playerSeat));
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
      player: (piece) => piece.playerSeat === 0 ? 1 : 0,
    },
  ],
  getElementData: (element) => ({
    rank: element.attributes?.rank,
    suit: element.attributes?.suit,
    playerSeat: element.attributes?.player?.seat,
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
| `player` | `number \| ((elementData) => number)` | Target player seat |
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
      player: (piece) => piece.playerSeat === 0 ? 1 : 0,
    },
  ],
  getDOMElementData: (el) => ({
    playerSeat: el.classList.contains('player-0') ? 0 : 1,
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
import { useAutoFlyingElements, FlyingCardsOverlay } from 'boardsmith/ui';

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
import { useFlyOnAppear } from 'boardsmith/ui';

const { trackElement, getInitialPosition } = useFlyOnAppear({
  from: 'deck',  // Element ID to fly from
  duration: 400,
});
```

### usePlayerStatAnimation

Animate stat changes and fly elements to player stat displays.

```typescript
import { usePlayerStatAnimation, flyToPlayerStat } from 'boardsmith/ui';

// Fly a card to a player's score display
flyToPlayerStat({
  cardElement: cardEl,
  playerSeat: 0,
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
} from 'boardsmith/ui';

// Find specific element
const deck = findElement(gameView, { type: 'deck' });

// Find player's hand
const myHand = findPlayerHand(gameView, playerSeat);

// Get all cards in an element
const cardsInHand = getCards(myHand);

// Check ownership
const owner = getElementOwner(card);
const isMine = isMyElement(card, playerSeat);
```

### useGameGrid

Utilities for square grids (chess notation, etc.).

```typescript
import { useGameGrid, toAlgebraicNotation, fromAlgebraicNotation } from 'boardsmith/ui';

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
} from 'boardsmith/ui';

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
} from 'boardsmith/ui';

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
import { useElementChangeTracker, useCountTracker } from 'boardsmith/ui';

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
import { useFLIPAnimation, createFLIPSnapshot } from 'boardsmith/ui';

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
import { applyTheme, type ThemeConfig } from 'boardsmith/ui';

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

## Animation Events

BoardSmith's animation event system enables game UIs to play back animations asynchronously while game state advances immediately. This is called the **soft continuation pattern** - the game doesn't wait for animations to complete before proceeding.

### Key Concepts

**Animation events are UI hints, NOT commands or state mutations.** The game state has already changed by the time the UI receives the animation event. The UI "catches up" visually while the game has moved on. This parallel channel approach means:

- Game logic remains clean and synchronous
- UI can skip or speed through animations without affecting game correctness
- Reconnecting players see current state immediately (with optional animation replay)

### Engine-Side: Emitting Events

Use `game.emitAnimationEvent(type, data, options?)` to emit animation hints during action execution:

```typescript
// In action execute() or game logic
execute({ attacker, target }: { attacker: Combatant; target: Combatant }) {
  const damage = attacker.attack - target.defense;
  target.health -= damage;

  // Emit animation event - game state already changed!
  this.emitAnimationEvent('combat', {
    attackerId: attacker.id,
    targetId: target.id,
    damage,
    outcome: target.health <= 0 ? 'kill' : 'hit',
  });

  if (target.health <= 0) {
    target.putInto(this.graveyard);
  }
}
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | `string` | Event type identifier (e.g., 'combat', 'score', 'cardFlip') |
| `data` | `Record<string, unknown>` | Event-specific payload (must be JSON-serializable - use element IDs, not references) |
| `options` | `{ group?: string }` | Optional group ID for batching related events |

**Grouped events** for complex sequences:

```typescript
execute({ attacker, targets }: { attacker: Combatant; targets: Combatant[] }) {
  const groupId = `attack-${this.turnCount}`;

  this.emitAnimationEvent('attack-start', { attackerId: attacker.id }, { group: groupId });

  for (const target of targets) {
    const damage = calculateDamage(attacker, target);
    target.health -= damage;
    this.emitAnimationEvent('damage', { targetId: target.id, damage }, { group: groupId });
  }

  this.emitAnimationEvent('attack-end', { attackerId: attacker.id }, { group: groupId });
}
```

### UI-Side: Consuming Events

The UI-side uses a composable pattern with provide/inject for component tree access.

**Creating the instance (in GameShell or root component):**

```typescript
import { createAnimationEvents, provideAnimationEvents } from 'boardsmith/ui';

const animationEvents = createAnimationEvents({
  // Get events from player state (reactive getter)
  events: () => state.value?.animationEvents,

  // Acknowledge events when played back
  acknowledge: (upToId) => {
    session.acknowledgeAnimations(playerSeat, upToId);
  },

  // Optional: delay for events without handlers (useful for debugging)
  defaultDuration: 0, // ms
});

// Provide to component tree
provideAnimationEvents(animationEvents);
```

**Registering handlers (in game board components):**

```typescript
import { useAnimationEvents } from 'boardsmith/ui';

const animations = useAnimationEvents();

// Register handler - returns cleanup function
const unregister = animations?.registerHandler('combat', async (event) => {
  const { attackerId, targetId, damage, outcome } = event.data;

  // Find DOM elements
  const attackerEl = document.querySelector(`[data-combatant-id="${attackerId}"]`);
  const targetEl = document.querySelector(`[data-combatant-id="${targetId}"]`);

  // Play attack animation
  await playAttackAnimation(attackerEl, targetEl);

  // Show damage number
  await showDamageNumber(targetEl, damage);

  if (outcome === 'kill') {
    await playDeathAnimation(targetEl);
  }
});

// Clean up on unmount (optional - composable handles cleanup)
onUnmounted(() => unregister?.());
```

**Composable API:**

| Function | Description |
|----------|-------------|
| `createAnimationEvents(options)` | Create an animation events instance in root component |
| `provideAnimationEvents(instance)` | Provide instance to component tree |
| `useAnimationEvents()` | Inject animation events from ancestor |

**Instance API:**

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `registerHandler(type, handler)` | `(string, (event) => Promise<void>) => () => void` | Register handler, returns cleanup function |
| `isAnimating` | `Ref<boolean>` | Whether animations are currently playing |
| `paused` | `Ref<boolean>` | Pause/resume control |
| `skipAll()` | `() => void` | Skip remaining animations, acknowledge all |
| `pendingCount` | `Ref<number>` | Number of pending events (for UI indicators) |

### Integration with useAutoAnimations

The `useAutoAnimations` composable supports declarative event handler registration via the `eventHandlers` option:

```typescript
import { useAutoAnimations } from 'boardsmith/ui';

const { flyingElements } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    { element: board, ref: boardRef, flipWithin: '[data-piece-id]' },
  ],

  // Register animation event handlers declaratively
  eventHandlers: {
    combat: async (event) => {
      await playCombatAnimation(event.data);
    },
    score: async (event) => {
      await playScoreAnimation(event.data);
    },
  },

  // Required when using eventHandlers
  animationEvents,
});
```

This is the recommended approach for most games - it combines auto-animations with custom event handling in one place.

### ActionController Integration

The `useActionController` composable integrates with animation events to gate the ActionPanel on animation completion:

```typescript
const actionController = useActionController({
  // ... other options ...
  animationEvents, // Pass animation events instance for gating
});

// Available computed properties:
// actionController.animationsPending - true when animations playing
// actionController.showActionPanel - true when safe to show action UI
```

**showActionPanel** gates on three conditions:

1. `isMyTurn` - It's this player's turn
2. `!animationsPending` - No animations are currently playing
3. `!pendingFollowUp` - No follow-up action pending

This ensures players don't make decisions before seeing the results of previous actions.

### Common Pitfalls

**1. Forgetting to acknowledge events**

Events accumulate in the buffer and replay on every state update if not acknowledged. Always pass the `acknowledge` callback to `createAnimationEvents()`.

**2. Mutating event data in handlers**

Event data is a shallow copy - nested objects share references. Don't modify `event.data` directly in handlers.

**3. Not handling handler errors gracefully**

Handler errors are logged but don't stop the processing chain. Design handlers defensively - one broken handler shouldn't break all animations.

**4. Blocking entire UI on animations**

Only gate decision-making (ActionPanel). Let players inspect the board, view history, etc. during animations.

**5. Checking isMyTurn instead of showActionPanel**

Custom UIs should use `showActionPanel` (which includes animation gating), not just `isMyTurn`. Otherwise, actions may be shown during animation playback.

See [Nomenclature](./nomenclature.md) for animation event terminology definitions.

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
| `currentPick` | `PickMetadata \| null` | Metadata for the current pick step |
| `validElements` | `ComputedRef<ValidElement[]>` | **Reactive** list of valid elements for current selection |
| `isExecuting` | `boolean` | Whether an action is currently executing |
| `error` | `string \| null` | Error message from last failed execution |

### Element Selections with validElements

When building custom UIs for element selections (`fromElements`, `chooseElement`), use the **reactive `validElements` computed** instead of `getValidElements()`. This computed automatically updates when:
- The current selection changes
- Choices are fetched from the server
- The gameView updates

```typescript
const { validElements, currentPick } = props.actionController;

// Use the reactive computed directly - it updates automatically!
const selectableCards = computed(() => {
  if (currentPick.value?.type !== 'element') return [];

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
    <GameTable ... />
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
  const { currentPick, validElements } = props.actionController;
  if (currentPick.value?.name === 'card') {
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
import { findChildByAttribute, getElementId } from 'boardsmith/ui';

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

The `boardsmith/ui` package provides several helpers for finding elements:

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
    .filter(m => m.attributes?.player?.seat === props.playerSeat)
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
  const { currentPick, validElements } = props.actionController;

  // Check if this equipment is selectable
  if (currentPick.value?.name !== 'equipment') return;
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
} from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const boardInteraction = useBoardInteraction();
const { capturePositions, animateToCurrentPositions } = useElementAnimation();
const containerRef = ref<HTMLElement>();

// Extract data from game view
const myHand = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerSeat);
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
