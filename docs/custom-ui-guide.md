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

Use the helper functions from `boardsmith/ui`:

```typescript
import {
  findElement,
  findElements,
  findElementById,
  findPlayerHand,
  findChildByAttribute,
  findElementByAttribute,
  getElementId,
} from 'boardsmith/ui';

// Find by type (uses $type attribute)
const deck = findElement(gameView, { type: 'deck' });

// Find by name
const board = findElement(gameView, { name: 'mainBoard' });

// Find player's hand
const myHand = findPlayerHand(gameView, playerSeat);

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
import { findPlayerHand, findElement } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
}>();

// Extract hand cards
const myCards = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerSeat);
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
// Start wizard mode - ActionPanel shows selection UI, and check the result
const result = await actionController.start('attack');
if (!result.success) {
  console.error(result.error);
}

// Pre-fill the first selection
await actionController.start('move', {
  args: { piece: pieceId }
});

// Pre-fill a later selection (auto-applied when that step activates)
await actionController.start('dropEquipment', {
  args: { merc: mercId },
  prefill: { equipment: equipmentId },
});
```

**Important: `start()`'s result only covers its two synchronous pre-checks.** `start()` returns a `Promise<ActionResult>` (the same shape `execute()` returns), but `{ success: true }` only means "the action is in `availableActions` and its metadata resolved — wizard mode has begun." It is **not** the eventual server outcome of the action the user goes on to complete. If you ignore the return value entirely, you still get feedback: GameShell centrally watches for failures and surfaces a toast (see below), so callers that fire-and-forget `start()` are not silently swallowing pre-check failures. But `{ success: true }` from `start()` never tells you the wizard-mode action ultimately succeeded — only `execute()`'s (or the wizard's terminal `fill()`/auto-execute) result reflects that. If you need to react to the final server-confirmed outcome, use `execute()` directly instead of `start()`.

**Every action failure surfaces automatically — you don't have to wire your own toast.** GameShell watches `actionController.errorTick` centrally (a monotonic counter bumped on every failure — so even retrying the exact same failed selection re-toasts) and shows a `--bsg-danger` toast with the `lastError` message (plus an assertive live-region announcement) for any failed action, whether it was initiated from the shipped ActionPanel or from a custom UI through `useBoardInteraction` — both paths share the same `useActionController` instance, so this is automatic parity, not something you opt into. Do not add a second toast call in your custom UI for the same failure; it would duplicate the one GameShell already shows.

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

### Common Pattern: Button → Board Selection

A common pattern in custom UIs is a button that triggers an action requiring the user to select an element on the game board. For example, a "Retreat" button that requires selecting a destination sector.

**The Wrong Way (easy mistake):**
```typescript
// CombatPanel.vue
function handleRetreat() {
  // WRONG: execute() without the required 'retreatSector' parameter
  // The action needs wizard mode to let the user select a sector!
  await actionController.execute('retreat', {});  // ❌ Fails silently
}
```

**The Right Way:**
```typescript
// CombatPanel.vue
function handleRetreat() {
  // Start wizard mode - BoardSmith will enable sector selection
  actionController.start('retreat');  // ✓
}
```

After calling `start()`, BoardSmith:
1. Enters "wizard mode" for the action
2. Fetches valid choices from the server
3. Populates `validElements` with selectable elements
4. Enables `isSelectableElement()` for those elements on the board
5. Waits for user to click a valid element
6. Auto-completes the action when selection is made

**In your board component**, highlight selectable elements:
```vue
<template>
  <div
    v-for="sector in sectors"
    :key="sector.id"
    :class="{ selectable: boardInteraction?.isSelectableElement(sector) }"
    @click="onSectorClick(sector)"
  >
    {{ sector.name }}
  </div>
</template>

<script setup lang="ts">
import { useBoardInteraction } from 'boardsmith/ui';

const boardInteraction = useBoardInteraction();

function onSectorClick(sector: { id: number }) {
  if (boardInteraction?.isSelectableElement(sector)) {
    boardInteraction.triggerElementSelect(sector);
  }
}
</script>
```

### Detecting When to Use Wizard Mode

Use the `actionNeedsWizardMode()` helper to check programmatically:

```typescript
import { actionNeedsWizardMode } from 'boardsmith/ui';

const meta = actionController.getActionMetadata('retreat');
const check = actionNeedsWizardMode(meta, {});

if (check.needed) {
  console.log(check.reason);
  // "Selection 'retreatSector' requires element selection from the game board"
  actionController.start('retreat');
} else {
  actionController.execute('retreat', {});
}
```

> **Dev Mode Warning**: In development mode, BoardSmith automatically warns when you call `execute()` on an action that likely needs wizard mode. Check your browser console for helpful messages.

## Step 4: Handling Element Selections

When an action uses `chooseElement()` or `chooseElements()`, the `actionController` provides `validElements` - a reactive computed of which elements can be selected:

```vue
<script setup lang="ts">
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  actionController: UseActionControllerReturn;
}>();

// Reactive! Updates automatically when:
// - Current selection changes
// - Choices are fetched from server
// - gameView updates
const selectableCards = computed(() => {
  const { currentPick, validElements } = props.actionController;

  if (currentPick.value?.type !== 'element') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    display: ve.display,
    disabled: ve.disabled, // reason string or undefined
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

async function onCardClick(card: { id: number }) {
  if (!isSelectable(card.id)) return;

  // Fill the selection (always await - it returns a Promise)
  await props.actionController.fill('card', card.id);
}
</script>
```

### Understanding getChoices() Return Values

When building custom UIs, you'll often need to get the available choices for a selection. The `getChoices()` method returns choices in a consistent format:

```typescript
Array<{ value: unknown; display: string; disabled?: string }>
```

**Important:** The `value` property contains what you should pass to `fill()`:
- For element selections: `value` is the numeric element ID
- For choice selections: `value` is the choice value (string, object, etc.)

```typescript
// Getting choices for the current selection
const choices = actionController.getChoices(currentPick);

// CORRECT - pass choice.value to fill()
const selectedChoice = choices.find(c => c.value === userSelectedId);
await actionController.fill(currentPick.name, selectedChoice.value);

// WRONG - don't pass the whole choice object
await actionController.fill(currentPick.name, selectedChoice); // ❌
```

The `display` property is the human-readable label for rendering in your UI (buttons, lists, etc.).

The `disabled` property is present only on items that are disabled (absent on selectable items). When present, it contains a reason string explaining why the item cannot be selected. Custom UIs can use this to render disabled state however they want -- grey out the item, show a tooltip with the reason, add a lock icon, etc.

```typescript
const choices = actionController.getChoices(currentPick);

// Render with disabled state
for (const choice of choices) {
  if (choice.disabled) {
    // Show greyed out with reason tooltip
    renderDisabled(choice.display, choice.disabled);
  } else {
    renderSelectable(choice.display, choice.value);
  }
}
```

**Note:** If you do accidentally pass a choice object to `fill()`, BoardSmith will auto-unwrap it in development mode and show a warning. However, passing `choice.value` directly is clearer and recommended.

### multiSelect Selections: `fill()` Requires an Array

A `multiSelect` pick (one with `min`/`max` letting the player choose several elements at once) rejects a scalar value passed to `fill()` — it always expects an array, even for a single item:

```typescript
// WRONG - a multiSelect pick given a bare id
await actionController.fill('cards', card.id); // ❌ rejected

// The rejection error (dev-mode, actionable):
// "fill('cards', ...) rejected: 'cards' is a multiSelect selection
//  (min 1, max 3) and requires an array. Use toggleMultiSelect()/
//  confirmMultiSelect(), or pass an array directly to fill()."
```

There are two correct ways to satisfy a `multiSelect` pick:

```typescript
// CORRECT - pass an array directly to fill()
await actionController.fill('cards', [card.id]);
await actionController.fill('cards', [card1.id, card2.id]);

// CORRECT - or use the toggle/confirm pattern for incremental selection
// (toggle each card as the user clicks it, confirm when they're done)
actionController.toggleMultiSelect('cards', card.id);
actionController.toggleMultiSelect('cards', anotherCard.id);
await actionController.confirmMultiSelect();
```

Prefer `toggleMultiSelect()`/`confirmMultiSelect()` when the user builds up a selection by clicking multiple board elements one at a time (the common custom-UI case); use `fill()` with an array when you already have the full set of chosen values (e.g. from a checkbox list).

## Step 5: Using boardInteraction

For bidirectional interaction between the board and ActionPanel:

```typescript
import { useBoardInteraction } from 'boardsmith/ui';

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
boardInteraction.currentPickName // 'destination' | null
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
import { useBoardInteraction, type UseActionControllerReturn } from 'boardsmith/ui';

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

### Anchor Requirements & Fail-Loud Animation

Any custom board element that participates in FLIP/flying-element animation
or drag-drop **must** carry an anchor attribute so BoardSmith can find it in
the DOM. Use `anchorAttrs(ref, type)` (from `boardsmith/ui`) rather than
hand-writing `data-bs-el-id` yourself — it's the single source for every
`data-bs-el-*` attribute name:

```vue
<template>
  <div v-for="piece in pieces" :key="piece.id" v-bind="anchorAttrs({ id: piece.id }, 'piece')">
    {{ piece.name }}
  </div>
</template>

<script setup lang="ts">
import { anchorAttrs } from 'boardsmith/ui';
</script>
```

`useSelectable()`/`useSelectableGrid()` already spread these attributes for
you when you bind their returned `attrs` — pass a `type` label (e.g.
`'card'`, `'piece'`, `'grid-cell'`) so a missing anchor on your custom
renderer names *your* component, not a generic `'unknown'` bucket.

**Once-per-type dev warning:** if `anchorAttrs(ref, type)` is called with a
`ref` that has no `id`/`notation`/`name` at all, it emits a dev-only warning
(deduplicated per `type` — you'll see it once per distinct bug, not once per
render). This means an animation/drag-drop gap on a custom board surfaces
immediately in the console during development instead of silently no-oping.

**Fail-loud in dev, safe in production:** if an animation composable
(`useElementAnimation`, `useFLIP`, `useFlyingElements`) is asked to animate
an element it can't find an anchor attribute for at all, it throws an
actionable error **in development** (naming the composable, the attribute it
searched for, and the fix — spread `anchorAttrs(ref)` or bind
`useSelectable()`'s `attrs`). In a production build, the same situation logs
via `console.error` and skips the animation instead of crashing a live game
— an anchor gap should be caught during development, never take down a
player's session. This dev/production split is controlled internally by
each composable's `isDevThrowEnabled()` check — a positive signal (dev mode
and not explicitly suppressed), never a default-throw.

`data-bs-el-id` is the canonical anchor attribute for both selection and
animation targeting; AutoUI additionally emits `data-element-id` as a FLIP
alias for backward compatibility — treat `data-bs-el-id` as the one you
target from custom code (see
[Browser Testing](./browser-testing.md#1-stable-selectors-data-bs-el-id) for
the full selector-parity story across custom UI and AutoUI).

## Step 6: Handling Dependent Selections

When selection B depends on selection A (e.g., "select merc, then select their equipment"):

### Engine Side (for reference)

```typescript
Action.create('dropEquipment')
  .chooseElement('merc', { elements: () => [...game.all(Merc)] })
  .chooseElement('equipment', {
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

### Loading State for Dependent Choices

When a selection depends on a previous one, choices are fetched from the server. Show a loading indicator while fetching:

```vue
<template>
  <div class="selection-panel">
    <!-- Loading spinner while fetching choices -->
    <div v-if="actionController.isLoadingChoices.value" class="loading">
      Loading options...
    </div>

    <!-- Show choices when loaded -->
    <div v-else-if="actionController.validElements.value.length">
      <div
        v-for="el in actionController.validElements.value"
        :key="el.id"
        @click="selectElement(el)"
      >
        {{ el.display }}
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="empty">
      No options available
    </div>
  </div>
</template>
```

## Step 7: Reacting to Action Context

Sometimes UI panels need to react to action state. For example, showing a detail panel when an action targets a specific element.

### Accessing Current Action Args

The `actionController.currentArgs` ref contains all args for the in-progress action, including followUp context:

```typescript
import { computed } from 'vue';

// Get sector ID from current action (if any)
const actionContextSectorId = computed(() => {
  const args = actionController.currentArgs.value;
  if (!args?.sectorId) return null;

  // Handle both plain ID and {id, name} object formats
  const sectorId = args.sectorId;
  if (typeof sectorId === 'object' && sectorId !== null) {
    return (sectorId as { id: number }).id;
  }
  return sectorId as number;
});
```

### Example: Auto-Opening a Detail Panel

When a sector-related action starts (either from ActionPanel or via followUp), automatically show the sector's detail panel:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  actionController: UseActionControllerReturn;
  sectors: Array<{ id: number; name: string }>;
}>();

// Sector selected by clicking on map
const selectedSectorId = ref<number | null>(null);

// Sector from action context (e.g., followUp.args.sectorId)
const actionContextSectorId = computed(() => {
  const args = props.actionController.currentArgs.value;
  if (!args?.sectorId) return null;

  // Handle both plain ID and {id, name} object formats
  const sectorId = args.sectorId;
  if (typeof sectorId === 'object' && sectorId !== null) {
    return (sectorId as { id: number }).id;
  }
  return sectorId as number;
});

// Show panel if either source has a sector
const activeSectorId = computed(() =>
  selectedSectorId.value ?? actionContextSectorId.value
);

const activeSector = computed(() =>
  props.sectors.find(s => s.id === activeSectorId.value)
);
</script>

<template>
  <div class="game-layout">
    <GameMap
      :sectors="sectors"
      @sector-click="selectedSectorId = $event"
    />

    <!-- Panel shows for clicked sector OR action context sector -->
    <SectorPanel
      v-if="activeSector"
      :sector="activeSector"
      @close="selectedSectorId = null"
    />
  </div>
</template>
```

### Watching for Action Changes

To run side effects when actions start or complete:

```typescript
import { watch } from 'vue';

// React when action starts
watch(
  () => actionController.currentAction.value,
  (newAction, oldAction) => {
    if (newAction && !oldAction) {
      console.log('Action started:', newAction);
      console.log('Initial args:', actionController.currentArgs.value);
    }
    if (!newAction && oldAction) {
      console.log('Action completed/cancelled:', oldAction);
    }
  }
);

// React to specific arg changes
watch(
  () => actionController.currentArgs.value?.targetId,
  (targetId) => {
    if (targetId) {
      highlightElement(targetId);
    }
  }
);
```

## Full-Board Modals: the `#bs-game-modal` Host

GameShell renders a sanctioned overlay layer, `#bs-game-modal`, that exactly
fills the board region. Teleport a blocking modal there (an end-of-round
summary, a scoring recap) and it covers the board but never GameShell's
header or action dock:

```vue
<template>
  <Teleport to="#bs-game-modal">
    <Transition name="overlay">
      <div v-if="showSummary" class="round-summary-overlay">
        <!-- ... -->
      </div>
    </Transition>
  </Teleport>
</template>
```

Notes:

- **A plain `<Teleport>` just works** — GameShell guarantees the host element
  is in the document before your game UI mounts (the game board is mounted one
  tick after the shell itself), so the target always resolves. No `defer`
  needed.
- The host is `pointer-events: none` when empty and `auto` for its children,
  so an open modal blocks the board and a closed one is click-through — no
  extra wiring.
- Even a `position: fixed` overlay stays confined to the board region
  (`contain: layout` on the host), so your modal can never cover the shell
  chrome.
- Do **not** teleport to `body`/outside GameShell for board modals — you lose
  the board-region confinement and the chrome guarantees.

## Board Sizing

GameShell fits the board to the available screen space at startup by
measuring the board's **intrinsic** (natural) size and then zooming it to
fit. To measure an intrinsic size at all, the element that wraps your
`#game-board` slot — `.game-shell__zoom-container` — is styled
`width: max-content`. This is deliberate and load-bearing: it's what lets
`useAutoZoom` ask "how big does this board *want* to be?" for boards of any
shape (square grids, wide card rows, tall hex boards) without you declaring a
fixed size anywhere. **Do not override this CSS from a custom board** — a
definite-width ancestor breaks the fit formula for every board, not just
yours.

### The failure mode: a 0×0 board

`width: max-content` means the zoom container's size is *derived from its
children's natural size* — it does not hand children a size to fill. If your
board's root element sizes itself as a **percentage of its parent**
(`width: 100%`) or uses CSS `container-type` (which also depends on the
parent for its containment context), there is nothing for it to resolve
against inside a `max-content` ancestor, and it collapses to `0×0`. Because
this can happen silently (no visible error, no crash — the board region is
simply empty), a dev-mode `console.error` fires once a real game state has
arrived and the `#game-board` slot still measures `0×0` after mounting.
That's the error that points here.

### The fix

Give your board's root element a **definite width**, not a percentage:

```vue
<template>
  <!-- WRONG - collapses to 0×0 inside width:max-content -->
  <div class="board" style="width: 100%;">...</div>

  <!-- CORRECT - a definite size the zoom container can measure -->
  <div class="board" style="width: 640px;">...</div>
</template>
```

If your board's size genuinely depends on content (e.g. a variable number of
columns), compute a definite pixel width from that content instead of
reaching for a percentage — or measure `.boardregion` (the ancestor GameShell
sizes to the visible viewport) directly and set your board's width from that
measurement rather than relying on percentage/`container-type` CSS to do it
implicitly.

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
| Selection not applying | Wrote to actionArgs directly | Use `actionController.fill()` instead |
| Spurious values in followUp args | Custom UI writing to actionArgs | See warning in console, use `fill()` |

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
} from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

const boardInteraction = useBoardInteraction();

// Extract game state
const myHand = computed(() => {
  const hand = findPlayerHand(props.gameView, props.playerSeat);
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
  const { currentPick, validElements } = props.actionController;
  if (currentPick.value?.name === 'card') {
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

