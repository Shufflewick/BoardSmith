# Building Custom Game UIs

This guide walks you through building a custom game UI from scratch. It covers the complete flow from understanding game data to executing actions and debugging issues.

## Overview

BoardSmith UIs receive game state as a serialized element tree (`gameView`) and execute actions through the `actionController`. The key concepts are:

1. **gameView** - Serialized game state (read-only, from server)
2. **actionController** - Execute actions and manage wizard mode
3. **validElements** - Which elements can be selected for the current action
4. **boardInteraction** - Highlight/select elements on the board

## Step 1: Understanding gameView Structure

The `gameView` is a tree of serialized game elements. Each element has:

```typescript
interface GameViewElement {
  id: number;              // Unique ID - use this for action args!
  className: string;       // Element class (e.g., 'Card', 'Piece')
  name?: string;           // Optional name
  attributes: {            // Your custom properties
    rank?: string;
    suit?: string;
    health?: number;
    // ...
  };
  children?: GameViewElement[];  // Child elements
  childCount?: number;           // For hidden containers
}
```

**Critical:** The `id` is at the top level, NOT in `attributes`:

```typescript
// Correct
const cardId = card.id;  // ✓

// Wrong - common mistake!
const cardId = card.attributes.id;  // ✗ undefined
```

## Step 2: Finding Elements

Use the helper functions from `@boardsmith/ui`:

```typescript
import {
  findElement,
  findElements,
  findElementById,
  findPlayerHand,
  findChildByAttribute,
  findElementByAttribute,
  getElementId,
} from '@boardsmith/ui';

// Find by type (uses $type attribute)
const deck = findElement(gameView, { type: 'deck' });

// Find by name
const board = findElement(gameView, { name: 'mainBoard' });

// Find player's hand
const myHand = findPlayerHand(gameView, playerPosition);

// Find by ID (recursive search)
const card = findElementById(gameView, cardId);

// Find by attribute value
const merc = findChildByAttribute(squad, 'mercName', 'Jake');
const sector = findElementByAttribute(gameView, 'sectorId', 'alpha-3');
```

### Common Pattern: Extracting Data for Display

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findPlayerHand, findElement } from '@boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
}>();

// Extract hand cards
const myCards = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerPosition);
  if (!hand?.children) return [];

  return hand.children.map(card => ({
    id: card.id,
    rank: card.attributes?.rank,
    suit: card.attributes?.suit,
  }));
});

// Extract board state
const boardPieces = computed(() => {
  const board = findElement(props.gameView, { type: 'board' });
  if (!board?.children) return [];

  return board.children.filter(c => c.className === 'Piece');
});
</script>
```

## Step 3: Executing Actions

The `actionController` provides two patterns for executing actions:

### Pattern A: Direct Execution

Use when you have all required values:

```typescript
// No selections needed
await actionController.execute('endTurn');

// All selections provided
await actionController.execute('move', {
  piece: clickedPiece.id,      // Use numeric IDs
  destination: clickedCell.id,
});

// The result tells you if it succeeded
const result = await actionController.execute('play', { card: cardId });
if (!result.success) {
  console.error(result.error);
}
```

### Pattern B: Wizard Mode

Use when the user needs to make selections through the ActionPanel:

```typescript
// Start wizard mode - ActionPanel shows selection UI
actionController.start('attack');

// Pre-fill the first selection
actionController.start('move', {
  args: { piece: pieceId }
});

// Pre-fill a later selection (auto-applied when that step activates)
actionController.start('dropEquipment', {
  args: { merc: mercId },
  prefill: { equipment: equipmentId },
});
```

**When to use which:**

| Scenario | Use |
|----------|-----|
| No selections (endTurn, pass) | `execute()` |
| All values known from board click | `execute()` |
| User picks from ActionPanel | `start()` |
| Pre-fill first selection, user picks rest | `start()` with `args` |
| Dependent selection needs prefill | `start()` with `prefill` |

### The `args` vs `prefill` Difference

- **args**: Applied immediately when `start()` is called
- **prefill**: Applied later when that selection step becomes active

Use `prefill` for dependent selections where the choice isn't available until a prior selection is made.

## Step 4: Handling Element Selections

When an action uses `fromElements()` or `chooseElement()`, the `actionController` provides `validElements` - a reactive computed of which elements can be selected:

```vue
<script setup lang="ts">
import type { UseActionControllerReturn } from '@boardsmith/ui';

const props = defineProps<{
  actionController: UseActionControllerReturn;
}>();

// Reactive! Updates automatically when:
// - Current selection changes
// - Choices are fetched from server
// - gameView updates
const selectableCards = computed(() => {
  const { currentSelection, validElements } = props.actionController;

  if (currentSelection.value?.type !== 'element') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    display: ve.display,
    // Full element data is included:
    image: ve.element?.attributes?.image,
    rank: ve.element?.attributes?.rank,
  }));
});
</script>
```

### Highlighting Selectable Elements

```vue
<template>
  <div
    v-for="card in myCards"
    :key="card.id"
    class="card"
    :class="{
      'selectable': isSelectable(card.id),
      'selected': isSelected(card.id),
    }"
    @click="onCardClick(card)"
  >
    {{ card.rank }}{{ card.suit }}
  </div>
</template>

<script setup lang="ts">
function isSelectable(cardId: number): boolean {
  return props.actionController.validElements.value
    .some(ve => ve.id === cardId);
}

function isSelected(cardId: number): boolean {
  const currentArgs = props.actionController.currentArgs.value;
  return currentArgs.card === cardId;
}

function onCardClick(card: { id: number }) {
  if (!isSelectable(card.id)) return;

  // Fill the selection
  props.actionController.fill('card', card.id);
}
</script>
```

## Step 5: Using boardInteraction

For bidirectional interaction between the board and ActionPanel:

```typescript
import { useBoardInteraction } from '@boardsmith/ui';

const boardInteraction = useBoardInteraction();

// Check if element is highlighted (hovering in ActionPanel)
boardInteraction.isHighlighted(element)

// Check if element is currently selected
boardInteraction.isSelected(element)

// Check if element is a valid selection target
boardInteraction.isSelectableElement(element)

// Trigger selection from board click
boardInteraction.triggerElementSelect(element)

// Check current action state
boardInteraction.currentAction        // 'move' | null
boardInteraction.currentSelectionName // 'destination' | null
```

### Complete Board Integration Example

```vue
<template>
  <div class="board">
    <div
      v-for="piece in pieces"
      :key="piece.id"
      class="piece"
      :class="{
        highlighted: boardInteraction?.isHighlighted(piece),
        selected: boardInteraction?.isSelected(piece),
        selectable: boardInteraction?.isSelectableElement(piece),
      }"
      @click="onPieceClick(piece)"
      @mouseenter="onPieceHover(piece)"
      @mouseleave="onPieceLeave"
    >
      {{ piece.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBoardInteraction, type UseActionControllerReturn } from '@boardsmith/ui';

const props = defineProps<{
  actionController: UseActionControllerReturn;
  availableActions: string[];
}>();

const boardInteraction = useBoardInteraction();

function onPieceClick(piece: any) {
  // If in wizard mode and piece is selectable, trigger selection
  if (boardInteraction?.isSelectableElement(piece)) {
    boardInteraction.triggerElementSelect(piece);
    return;
  }

  // Otherwise start a new action if available
  if (props.availableActions.includes('move')) {
    props.actionController.start('move', { args: { piece: piece.id } });
  }
}
</script>
```

## Step 6: Handling Dependent Selections

When selection B depends on selection A (e.g., "select merc, then select their equipment"):

### Engine Side (for reference)

```typescript
Action.create('dropEquipment')
  .fromElements('merc', { elements: () => [...game.all(Merc)] })
  .fromElements('equipment', {
    dependsOn: 'merc',  // Tells framework this depends on merc
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc;
      return [...merc.equipment.all(Equipment)];
    }
  })
```

### UI Side: Using prefill

```typescript
// User clicks on a piece of equipment on a merc
function onEquipmentClick(merc: any, equipment: any) {
  // Start the action with both values
  actionController.start('dropEquipment', {
    args: { merc: merc.id },
    prefill: { equipment: equipment.id },  // Auto-fills when equipment step activates
  });
}
```

### UI Side: Watching for Dependent Changes

```typescript
import { watch } from 'vue';

// When merc selection changes, equipment choices update automatically
watch(
  () => actionController.validElements.value,
  (newElements) => {
    console.log('Available equipment:', newElements.map(e => e.display));
  }
);
```

## Debugging

### Why Isn't My Action Available?

Use `debugActionAvailability()` in the game code or browser console:

```typescript
// In game rules (server-side)
const debug = game.debugActionAvailability('attack', player);
console.log(debug.reason);
// "Selection 'target' has no valid choices"

// For detailed breakdown
for (const sel of debug.details.selections) {
  console.log(`${sel.name}: ${sel.choices} choices - ${sel.note || 'OK'}`);
}
```

### Why Isn't My Action Executing?

1. **Check actionController.error:**
   ```typescript
   watch(() => actionController.lastError.value, (error) => {
     if (error) console.error('Action failed:', error);
   });
   ```

2. **Log action args before execution:**
   ```typescript
   async function executeAction(name: string, args: Record<string, unknown>) {
     console.log('[Action]', name, JSON.stringify(args, null, 2));
     await actionController.execute(name, args);
   }
   ```

3. **Check Network tab** for WebSocket messages or API calls

### Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Action not in availableActions | Condition failed or no valid selections | Use `debugActionAvailability()` |
| "Invalid selection" error | Passed wrong value type | Check you're passing element ID (number) not object |
| Element not found in gameView | ID mismatch or element moved | Use `findElementById()` to verify |
| validElements is empty | Choices not fetched yet | Check `isLoadingChoices`, wait for fetch |
| Selection not applying | Wrote to actionArgs after clear | Use `start()` with `args` option |

### ID vs Object Confusion

A common source of bugs is confusing element IDs with element objects:

```typescript
// Element from gameView
const card = findPlayerHand(gameView, 0)?.children?.[0];

// This is the element object
console.log(card);           // { id: 42, className: 'Card', attributes: {...} }

// This is what actions need
console.log(card.id);        // 42

// Correct - pass the ID
await actionController.execute('play', { card: card.id });

// Wrong - don't pass the object
await actionController.execute('play', { card: card });
```

## Complete Example: Card Game Board

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  useBoardInteraction,
  findPlayerHand,
  findElement,
  type UseActionControllerReturn,
} from '@boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const boardInteraction = useBoardInteraction();

// Extract game state
const myHand = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerPosition);
  return hand?.children || [];
});

const discardPile = computed(() => {
  const pile = findElement(props.gameView, { type: 'discard' });
  return pile?.children || [];
});

const topDiscard = computed(() => discardPile.value[discardPile.value.length - 1]);

// Card interaction
function isCardPlayable(cardId: number): boolean {
  if (!props.isMyTurn) return false;
  if (!props.availableActions.includes('play')) return false;

  // If in wizard mode, check validElements
  const { currentSelection, validElements } = props.actionController;
  if (currentSelection.value?.name === 'card') {
    return validElements.value.some(ve => ve.id === cardId);
  }

  return true;
}

async function onCardClick(card: any) {
  if (!isCardPlayable(card.id)) return;

  // If in wizard mode, fill the selection
  if (boardInteraction?.isSelectableElement(card)) {
    boardInteraction.triggerElementSelect(card);
    return;
  }

  // Otherwise execute directly
  await props.actionController.execute('play', { card: card.id });
}

async function drawCard() {
  if (!props.availableActions.includes('draw')) return;
  await props.actionController.execute('draw');
}
</script>

<template>
  <div class="card-game-board">
    <!-- Discard pile -->
    <div class="discard-pile" @click="drawCard">
      <div v-if="topDiscard" class="card">
        {{ topDiscard.attributes?.rank }}{{ topDiscard.attributes?.suit }}
      </div>
      <div v-else class="empty">Empty</div>
    </div>

    <!-- Hand -->
    <div class="hand">
      <div
        v-for="card in myHand"
        :key="card.id"
        class="card"
        :class="{
          playable: isCardPlayable(card.id),
          highlighted: boardInteraction?.isHighlighted(card),
          selected: boardInteraction?.isSelected(card),
        }"
        @click="onCardClick(card)"
      >
        {{ card.attributes?.rank }}{{ card.attributes?.suit }}
      </div>
    </div>

    <!-- Error display -->
    <div v-if="actionController.lastError.value" class="error">
      {{ actionController.lastError.value }}
    </div>
  </div>
</template>

<style scoped>
.card {
  cursor: pointer;
  transition: transform 0.2s;
}

.card.playable {
  box-shadow: 0 0 8px rgba(0, 255, 0, 0.5);
}

.card.highlighted {
  transform: translateY(-8px);
  box-shadow: 0 0 12px rgba(255, 255, 0, 0.8);
}

.card.selected {
  transform: translateY(-12px);
  box-shadow: 0 0 16px rgba(0, 128, 255, 1);
}

.error {
  position: fixed;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: #e74c3c;
  color: white;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
}
</style>
```

## Next Steps

- [UI Components Reference](./ui-components.md) - Full API documentation
- [Common Pitfalls](./common-pitfalls.md) - Avoid common mistakes
- [Actions & Flow](./actions-and-flow.md) - How actions work server-side
- [Element Enrichment](./element-enrichment.md) - Advanced validElements usage

