# Building Custom Game UIs

This guide walks you through building a custom game UI from scratch. It covers the complete flow from understanding game data to executing actions and debugging issues.

## Overview

BoardSmith UIs receive game state as a serialized element tree (`gameView`) and execute actions through the `actionController`. The key concepts are:

1. **gameView** - Serialized game state (read-only, from server)
2. **actionController** - Execute actions and manage wizard mode
3. **validElements** - Which elements can be selected for the current action
4. **boardInteraction** - Highlight/select elements on the board

## Before you start: your board does not replace the Action Panel

Read this first, because it decides the shape of everything you build.

> **The Action Panel is on at all times, and it offers exactly what your board
> offers. Your board control is *in addition to* the panel, never instead of
> it.**

The most common instinct when a custom board starts looking good is to get rid
of the panel underneath it — it appears to be a duplicate of the controls you
just drew. It isn't, and it must stay:

- The panel is the **keyboard and screen-reader path**. A `<div>` on your board
  with a click handler is not; it is a mouse affordance with no guaranteed
  focus order, name, or role.
- It is the path that still works when a board control is scrolled off-screen,
  mid-animation, too small to hit on a phone, or simply not built yet — which
  is every control, early in a chunked build.
- Your board control makes the *same* action nicer to take. It carries none of
  the panel's guarantees, so it cannot stand in for it.

So expect — and keep — this arrangement: your compass, card fan, or drag-drop
grid on the board, **and** the panel listing those same choices beneath it. It
is not clutter, it is the floor.

The parity runs one way. Every action a player can take is in the Action Panel.
The board may show only state, or offer some of those actions, because a game
starts on the automatic UI and gains its own board in stages. Whatever the board
offers must also be in the panel, and the board and the panel never show
different states. If the two ever show different states, that is a wiring bug
in your UI, not an argument for hiding one of them. Drive both from the same
state — the `actionController` and `boardInteraction` described in this guide —
and they cannot drift. If you find yourself keeping a
second, board-local copy of "what is selectable right now", that copy is the
bug.

Every action has a start button in the panel; no action can be hidden from it.
`boardsmith smoke` holds a board to the shared selection (#1642). It fails a
board whose marked selection is not the panel's: mark the thing your board shows selected with
`selectedAttrs()` (see [The shared selection](./ui-components.md#the-shared-selection)).
It cannot see a board that collects picks in state of its own and sends them in
one call, as a two-card plan or a dice draft can. That is allowed, since the
panel still offers the action, but the panel shows none of those picks until then.

`platformActionPanelEscapeHatch` belongs to the host platform, not to a game.
See
[Actions & Flow](./actions-and-flow.md#the-action-panel-is-complete-and-the-board-never-disagrees-with-it).

Hiding the panel in CSS is worse still: the controls stay operable
and in the tab order, but nobody can see them.

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

The board's `gameView` prop is the root of that tree, the game element itself,
typed `GameRootView`. It is a `GameViewElement` with three more fields:
`phase` (`'setup'`, `'started'` or `'finished'`), `isFinished`, and `settings`,
the game's settings bag as this seat may see it. Read values the game keeps in
`settings` from `props.gameView?.settings`.

**Critical:** The `id` is at the top level, NOT in `attributes`:

```typescript
// Correct
const cardId = card.id;  // ✓

// Wrong - common mistake!
const cardId = card.attributes.id;  // ✗ undefined
```

## Step 2: Finding Elements

Use the helper functions from `boardsmith/ui`:

<!-- typecheck: game src/ui/find.ts -->
```typescript
import { findElement, findElements, findPlayerHand, type GameViewElement } from 'boardsmith/ui';

export function lookups(gameView: GameViewElement, playerSeat: number, cardId: number) {
  // Find by type (uses $type attribute)
  const deck = findElement(gameView, { type: 'deck' });

  // Find by name
  const board = findElement(gameView, { name: 'mainBoard' });

  // Find player's hand
  const myHand = findPlayerHand(gameView, playerSeat);

  // Find by ID (recursive search)
  const card = findElement(gameView, { id: cardId });

  // Several criteria must all match
  const aceInHand = findElements(gameView, { className: 'Card', name: 'ace' });

  return { deck, board, myHand, card, aceInHand };
}
```

### Common Pattern: Extracting Data for Display

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findPlayerHand, findElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

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

A board takes every action with `actionController.start()`, so the Action Panel shows what the board started and follows it. A board's controller has no `execute()`: an action that ran without passing through the panel would leave the panel and the board telling different stories.

```typescript
// No selections needed: it runs as soon as it opens
await actionController.start('endTurn');

// All selections known from the board: it runs as soon as it opens
await actionController.start('move', {
  args: { piece: clickedPiece.id, destination: clickedCell.id },  // Use numeric IDs
});

// The first selection known, the player answers the rest in the panel or on the board
await actionController.start('move', { args: { piece: pieceId } });

// A later selection known (auto-applied when that step activates)
await actionController.start('dropEquipment', {
  args: { hero: heroId },
  prefill: { equipment: equipmentId },
});

// Nothing known: the panel and the board ask for every selection
const result = await actionController.start('attack');
if (!result.success) {
  console.error(result.error);
}
```

A game that declares subject types also passes the thing a verb acts on with `subject`, and selects things with `actionController.select()`; see [The shared selection](./ui-components.md#the-shared-selection).

**Important: unless every pick is in `args`, `start()`'s result only covers its synchronous pre-checks.** With every pick given, the action runs at once and the result is the server's answer. Otherwise `{ success: true }` only means "the seat is not viewing past game state, the action is not disabled, it is in `availableActions`, its metadata resolved, and no arg is a list for a pick that takes one element: the action has opened." It is **not** the server's answer. If you ignore the return value entirely, you still get feedback: GameShell centrally watches for failures and surfaces a toast (see below), so callers that fire-and-forget `start()` are not silently swallowing pre-check failures. To react to the server's answer to an action the player finishes, watch `actionController.lastActionResult` ([Reading an action's return value](./ui-components.md#reading-an-actions-return-value-lastactionresult)).

**Every action failure surfaces automatically — you don't have to wire your own toast.** GameShell watches `actionController.errorTick` centrally (a monotonic counter bumped on every failure — so even retrying the exact same failed selection re-toasts) and shows a `--bsg-danger` toast with the `lastError` message (plus an assertive live-region announcement) for any failed action, whether it was initiated from the shipped ActionPanel or from a custom UI through `useBoardInteraction` — both paths share the same `useActionController` instance, so this is automatic parity, not something you opt into. Do not add a second toast call in your custom UI for the same failure; it would duplicate the one GameShell already shows. WorldShell does the same for a world: a refused order, from the panel or `useWorld().act()`, is a toast plus an assertive live-region announcement. One refusal is not a failure: a second send while the first is still out (a double-click) is refused with `'Action already executing'` without a toast and leaves `lastError` alone, since the player did nothing wrong.

**When to use which:**

| Scenario | Use |
|----------|-----|
| No selections (endTurn, pass) | `start()` |
| All values known from board click | `start()` with every pick in `args` |
| User picks from ActionPanel | `start()` |
| Pre-fill first selection, user picks rest | `start()` with `args` |
| Dependent selection needs prefill | `start()` with `prefill` |

### The `args` vs `prefill` Difference

- **args**: Applied immediately when `start()` is called
- **prefill**: Applied later when that selection step becomes active

Use `prefill` for dependent selections where the choice isn't available until a prior selection is made.

### Common Pattern: Button → Board Selection

A common pattern in custom UIs is a button that triggers an action requiring the user to select an element on the game board. For example, a "Retreat" button that requires selecting a destination room.

```typescript
// DuelPanel.vue
function handleRetreat() {
  // The panel and the board ask for the room
  actionController.start('retreat');
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
<!-- typecheck: board -->
```vue
<template>
  <div
    v-for="room in rooms"
    :key="room.id"
    :class="{ selectable: boardInteraction.isSelectableElement(room) }"
    @click="onRoomClick(room)"
  >
    {{ room.name }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useBoardInteraction, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const boardInteraction = useBoardInteraction();

const rooms = computed(() => (props.gameView ? findElements(props.gameView, { className: 'Room' }) : []));

function onRoomClick(room: GameViewElement) {
  if (boardInteraction.isSelectableElement(room)) {
    boardInteraction.triggerElementSelect(room);
  }
}
</script>
```

## Step 4: Handling Element Selections

When an action uses `chooseElement()` or `chooseElements()`, the `actionController` provides `validElements` - a reactive computed of which elements can be selected:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

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

With no action open, `startCandidates` says what a click can start: each available action whose first pick is an element pick, with that pick's candidates. The board already uses it (a click or drag on a candidate starts the action), so read it only to draw your own start affordance:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import type { TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

// Element ids that start movePiece, while no action is open.
const movablePieceIds = computed(() =>
  props.actionController.startCandidates.value.get('movePiece')?.elements.map(ve => ve.id) ?? []);
</script>
```

### Highlighting Selectable Elements

<!-- typecheck: board -->
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
    {{ card.attributes?.rank }}{{ card.attributes?.suit }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { findElements, type BaseElementAttributes, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

interface CardAttributes extends BaseElementAttributes {
  rank?: string;
  suit?: string;
}

const myCards = computed(() =>
  props.gameView ? (findElements(props.gameView, { className: 'Card' }) as GameViewElement<CardAttributes>[]) : [],
);

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

The `disabled` property is present only on items that are disabled (absent on selectable items). When present, it contains a reason string explaining why the item cannot be selected. **Show it.** A dimmed control that will not say why is the fastest way to make a player think the game is broken, and the reason is already in your hand.

Bind `v-disabled-reason` and you get the Action Panel's exact behaviour:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { vDisabledReason, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const controller = props.actionController;
</script>

<template>
  <template v-if="controller.currentPick.value">
    <button
      v-for="choice in controller.getChoices(controller.currentPick.value)"
      :key="String(choice.value)"
      v-disabled-reason="choice.disabled"
      @click="controller.fill(controller.currentPick.value.name, choice.value)"
    >
      {{ choice.display }}
    </button>
  </template>
</template>
```

That one binding does three things, which is the point — there is no way to get
one without the others:

- **Dims** the control with `aria-disabled="true"`. Never the native `disabled`
  attribute: that drops the control out of the tab order, so a keyboard or
  screen-reader user could never reach the reason. Style the dimmed state on
  `[aria-disabled='true']`.
- **Explains** it, in the shared tooltip, on hover, on focus, *and on tap*. Tap
  matters — the native `title` attribute does nothing at all on touch, so on a
  phone the reason simply would not exist.
- **Makes activation inert.** The click and the Enter/Space keydown are
  swallowed in the capture phase, ahead of your own `@click` — you do not have
  to remember a guard, and forgetting one is not a bug you can write.

In `<script setup>`, importing it as `vDisabledReason` is all the registration
it needs. Elsewhere: `app.directive('disabled-reason', vDisabledReason)`.

The same binding works for a whole action's button: `disabledActions[name]` is a
prop your board receives, carrying the reason from the action's `.disabled()`
rule or the tutorial gate.

You are not required to use it — a board can render its dimmed state however it
likes — but if you roll your own, carry the reason across yourself. The engine
hands you a sentence written for the player; dropping it on the floor is the
one thing to avoid.

**Note:** `fill()` takes `choice.value`, never the `{ value, display }` choice object. A choice object is refused like any other value that is not on offer.

Every controller call that takes a pick value (`fill()`, `start()`'s `args` and `prefill`, `toggleMultiSelect()`, `isMultiSelectSelected()`, `appendListEntry()`) names a choice by the same rule as the server: the offered value, a copy of it, or a shorthand (its `id`, its display text, or an object with only its identifying fields). The controller then holds the offered value, so `toggleMultiSelect('crew', 'Agent Vex')` followed by `isMultiSelectSelected('crew', vex.id)` is `true`, and toggling it again by either name removes it. Adding a disabled choice is refused with its reason; removing a draft entry never is.

`start()`'s `args` are the exception: the controller has not fetched that pick's choices yet, so they are sent as given and judged by the server, and the breadcrumb shows the value itself. The controller refuses only a list for a pick that takes one element. Pass the value under `prefill` instead when the breadcrumb should read as the choice's label.

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
await actionController.confirmMultiSelect('cards'); // with nothing toggled, a min-0 pick gets []
```

Prefer `toggleMultiSelect()`/`confirmMultiSelect()` when the user builds up a selection by clicking multiple board elements one at a time (the common custom-UI case); use `fill()` with an array when you already have the full set of chosen values (e.g. from a checkbox list).

When the choices list offers one value more than once (`['basic', 'basic', 'm1']`), each entry is its own slot and the player may take the value once per entry. Name the slot with the third argument, the copy counting from 0: `toggleMultiSelect('allocations', 'basic', 1)` takes the second `'basic'` entry, whether or not the first is held, and `isMultiSelectSelected('allocations', 'basic', 1)` says whether that entry is held. With no copy, `isMultiSelectSelected` says whether any copy is held, and `toggleMultiSelect` removes a held copy or else adds copy 0, which is what a board click on the value does. Copies count the enabled entries first, so a copy the game disabled is never one a player holds: toggling it is refused with its reason, and the engine likewise lets a value be taken only as many times as it has enabled entries. The Action Panel draws one checkbox per entry the same way. If the list changes while the player is choosing (the fetched list replacing the action's first one), a held copy it no longer offers, or offers disabled, is taken out of the draft and `lastError` says which, so the count, the checkboxes and the board always agree.

## Step 5: Using boardInteraction

For bidirectional interaction between the board and ActionPanel:

```typescript
// useBoardInteraction comes from 'boardsmith/ui'; call it in a board's setup
const boardInteraction = useBoardInteraction();

// Check if element is highlighted (hovering in ActionPanel)
boardInteraction.isHighlighted(element)

// Check if element is currently selected: the last board click, or the board element of the
// choice just answered, however it was answered (panel, board, actionController.fill(), auto-fill, prefill)
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

<!-- typecheck: board -->
```vue
<template>
  <div class="board">
    <div
      v-for="piece in pieces"
      :key="piece.id"
      class="piece"
      :class="{
        highlighted: boardInteraction.isHighlighted(piece),
        selected: boardInteraction.isSelected(piece),
        selectable: boardInteraction.isSelectableElement(piece),
      }"
      @click="onPieceClick(piece)"
    >
      {{ piece.name }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useBoardInteraction, type GameViewElement, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

const boardInteraction = useBoardInteraction();

const pieces = computed(() => (props.gameView ? findElements(props.gameView, { className: 'Piece' }) : []));

function onPieceClick(piece: GameViewElement) {
  // If in wizard mode and piece is selectable, trigger selection
  if (boardInteraction.isSelectableElement(piece)) {
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

<!-- typecheck: board -->
```vue
<template>
  <div v-for="piece in pieces" :key="piece.id" v-bind="anchorAttrs({ id: piece.id }, 'piece')">
    {{ piece.name }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { anchorAttrs, findElements, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

const pieces = computed(() => (props.gameView ? findElements(props.gameView, { className: 'Piece' }) : []));
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
(`useFLIP`, `useFlyingElements`) is asked to animate
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
animation targeting; `anchorAttrs()` emits `data-element-id` from the same id
as the FLIP alias, so an element never carries one without the other — target
`data-bs-el-id` from custom code (see
[Browser Testing](./browser-testing.md#1-stable-selectors-data-bs-el-id) for
the full selector-parity story across custom UI and AutoUI).

### Naming a Candidate a Player Can See

A board-anchored element pick has no panel button to press — that is the point
of anchoring it. So every element the open pick will accept also carries
`data-bs-candidate="<the text the panel would have shown>"`, from
`candidateAttrs()` (`boardsmith/ui`). Binding `useSelectable()`'s `attrs`, or
`useSelectableGrid()`'s `cellAttrs(cell)`, gives your board this for free
alongside the anchors. Hand-rolling the attributes instead:

```vue
<div
  v-for="holding in holdings"
  :key="holding.id"
  v-bind="{
    ...anchorAttrs({ id: holding.id }, 'holding'),
    ...candidateAttrs(board.candidateLabel({ id: holding.id })),
  }"
>{{ holding.name }}</div>
```

`board.candidateLabel(ref)` returns the pick's display text for that element,
or `null` when it is not a candidate right now — so the hook appears with the
pick and leaves with it. Without it your board renders the element's internal
name and nothing outside the app can tell which of your nodes answers the open
selection.

### Keyboard Navigation for a Grid: `useSelectableGrid()`

`useSelectableGrid(cells, position, getIdentity, boardInteraction, onActivate, elementType?, isCandidate?)`
gives a board of cells one tab stop and arrow-key movement. `position(cell)`
returns the cell's `{ row, col }`. An arrow key moves to the nearest cell in the
same row or column, and Home/End go to the ends of the row. So the order of
`cells` and any gaps in the board do not matter (#891).

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useBoardInteraction, useSelectableGrid } from 'boardsmith/ui';

const props = defineProps<{ squares: { id: number; rank: number; file: number }[] }>();
const board = useBoardInteraction();
const squares = computed(() => props.squares);

const { currentIdx, handleGridKeydown, handleGridFocusIn, registerCell, cellAttrs } = useSelectableGrid(
  squares,
  (square) => ({ row: 8 - square.rank, col: square.file - 1 }),
  (square) => ({ id: square.id }),
  board,
  (square) => board.triggerElementSelect({ id: square.id }),
  'square',
);
</script>

<template>
  <div role="grid" @keydown="handleGridKeydown" @focusin="handleGridFocusIn">
    <div
      v-for="(square, idx) in squares"
      :key="square.id"
      :ref="(el) => registerCell(el as Element | null, idx)"
      v-bind="cellAttrs(square)"
      role="gridcell"
      :tabindex="idx === currentIdx ? 0 : -1"
      :style="{ gridRow: 9 - square.rank, gridColumn: square.file }"
    />
  </div>
</template>
```

### Listening for Escape Page-Wide

BoardSmith's dialogs, popovers and menus call `event.preventDefault()` on an
Escape they act on (closing a popover, the game-over card or the controls
menu, or going back a level in the Action Panel), so `event.defaultPrevented`
is `true` by the time it reaches the page. An Escape that closes nothing is
left unmarked, and so is one inside your own modal `<dialog>`, which closes it. So a board can listen on the whole page, and work no matter
where focus is, as long as it skips handled Escapes:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const picked = ref<number | null>(null);

function cancelPickOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  picked.value = null;
}

onMounted(() => window.addEventListener('keydown', cancelPickOnEscape));
onUnmounted(() => window.removeEventListener('keydown', cancelPickOnEscape));
</script>
```

Listen on `window`, without `{ capture: true }`. Some of BoardSmith's
handlers listen on `document`, so a `document` listener added before them, or
any capturing listener, runs before they have marked the event.

## Step 6: Handling Dependent Selections

When selection B depends on selection A (e.g., "select hero, then select their equipment"):

### Engine Side (for reference)

```typescript
Action.create('dropEquipment')
  .chooseElement('hero', { elements: () => [...game.all(Hero)] })
  .chooseElement('equipment', {
    dependsOn: 'hero',  // Tells framework this depends on hero
    elements: (ctx) => {
      const hero = ctx.args.hero as Hero;
      return [...hero.equipment.all(Equipment)];
    }
  })
```

### UI Side: Using prefill

```typescript
// User clicks on a piece of equipment on a hero
function onEquipmentClick(hero: any, equipment: any) {
  // Start the action with both values
  actionController.start('dropEquipment', {
    args: { hero: hero.id },
    prefill: { equipment: equipment.id },  // Auto-fills when equipment step activates
  });
}
```

### UI Side: Watching for Dependent Changes

<!-- typecheck: game src/ui/equipment-watch.ts -->
```typescript
import { watch } from 'vue';
import type { UseActionControllerReturn } from 'boardsmith/ui';

// When hero selection changes, equipment choices update automatically
export function logEquipmentChoices(actionController: UseActionControllerReturn): void {
  watch(
    () => actionController.validElements.value,
    (newElements) => {
      console.log('Available equipment:', newElements.map((e) => e.display));
    },
  );
}
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
// computed comes from 'vue'

// Get room ID from current action (if any)
const actionContextRoomId = computed(() => {
  const args = actionController.currentArgs.value;
  if (!args?.roomId) return null;

  // Handle both plain ID and {id, name} object formats
  const roomId = args.roomId;
  if (typeof roomId === 'object' && roomId !== null) {
    return (roomId as { id: number }).id;
  }
  return roomId as number;
});
```

### Showing the price of a draft (world actions)

A world action can declare [`.quote()`](./persistent-worlds.md#quote-what-the-draft-will-cost-before-the-player-pays-it),
which prices the draft in front of the player before they commit it. The lines are
on the controller, so your board reads the same price the Action Panel is showing
rather than computing a second one:

```typescript
// The game's own lines for the draft on screen, or null when there is no price
// that is true right now (nothing drafted yet, still being worked out, refused).
const price = computed(() => props.actionController.actionQuote.value);
const working = computed(() => props.actionController.quotePending.value);
const refusal = computed(() => props.actionController.quoteError.value);

// A quoted action does not auto-commit: the player confirms what they were shown.
const deciding = computed(() => props.actionController.awaitingConfirmation.value);
const cannotConfirm = computed(() => props.actionController.confirmDisabledReason.value);
async function buy() { await props.actionController.confirm(); }
```

Never cache `actionQuote` into your own ref. A quote is stamped with the draft it
was computed for and withdrawn the instant the draft moves, which is what makes a
stale price unreachable — a copy of your own is exactly how one comes back.

### Reading the context from a component under the board: `usePlayContext()`

A component the board renders (a hand, a panel, a button row) does not receive the
board's props. It reads the same values from the game context instead.

<!-- typecheck: game src/reading-the-context-from-a-component-under-the-board-useplaycontext.ts -->
```typescript
import { usePlayContext } from 'boardsmith/ui';

const { playerSeat, isMyTurn, isViewingHistory, availableActions, actionController } = usePlayContext();
```

`usePlayContext()` returns the fields both shells publish, so it works the same at
a table and in a persistent world. Use it in any component a game shares between
the two. `useGameContext()` returns the whole table context, adding `gameState`,
`dueSeats`, `timeTravelDiff`, `turnDeadline` and `platformRequest`. It throws in a world, which has
none of those. `tryUseGameContext()` returns the table context or `undefined`, and
never throws.

While the debug panel shows a historical position, `isViewingHistory` is true,
`isMyTurn` is false and `availableActions` is empty, exactly as the board's own
props are. So a component under the board withdraws its controls during a browse,
just as the board does, and can say why. In a world `isViewingHistory` is always
false.

### Showing who has to act: `dueSeats`

The game context carries `dueSeats`: every seat that has to act right now, the
viewer's own included. In a turn-based step that is the one current player. In a
simultaneous step it is every seat the step is still waiting on, and a seat
leaves the list when it commits. Since #321 a simultaneous step reports no
`currentPlayer`, so `flowState.currentPlayer` cannot tell your board who is
acting there; `dueSeats` can, in both kinds of step.

<!-- typecheck: game src/showing-who-has-to-act-dueseats.ts -->
```typescript
import { computed } from 'vue';
import { useGameContext } from 'boardsmith/ui';

const { dueSeats, playerSeat } = useGameContext();

// True exactly when isMyTurn is, except while the debug panel shows history:
// dueSeats stays live then, and isMyTurn is false.
const myMove = computed(() => dueSeats.value.includes(playerSeat.value));
// Everyone else still deciding, for a "waiting on Bob and Carol" line.
const others = computed(() => dueSeats.value.filter((seat) => seat !== playerSeat.value));
```

The shell's players panel, its Action Panel and its screen-reader announcements
read this same list, so a board that shows who is acting from it agrees with
them: the viewer's card says "Your move" and every other acting seat says
"{name} is playing". A persistent world has no turn and does not publish
`dueSeats`.

### Counting down to the host's deadline: `turnDeadline`

When the host will close the current step at a set time, the game context
carries `turnDeadline`. Draw your countdown from it, never from `Date.now()`
against a time of your own: a phone's clock can be off by seconds or minutes,
and `turnDeadline` is already measured on the host's clock.

<!-- typecheck: game src/counting-down-to-the-host-s-deadline-turndeadline.ts -->
```typescript
import { computed } from 'vue';
import { useGameContext } from 'boardsmith/ui';

const { turnDeadline } = useGameContext();

// null when the host has set no deadline for this step.
const secondsLeft = computed(() =>
  turnDeadline.value === null ? null : Math.ceil(turnDeadline.value.remainingMs / 1000),
);
```

`turnDeadline.value` is `{ deadlineAt, remainingMs }` or `null`:

- `deadlineAt` is when the step closes, in epoch milliseconds on the host's clock.
- `remainingMs` is the time left, floored at zero. It updates about four times a
  second while there is time left, from one interval the whole page shares, and
  stops at zero.

Rules that keep your board and the Action Panel telling the same story:

- **Zero is not the end of the step.** The host closes it, and the next frame
  says what happened. At zero, say you are waiting for the server. Do not
  disable actions yourself: a move the player makes in the last moment is the
  host's to accept or refuse.
- **Do not announce every second.** A live region that changes each second
  talks over everything else a screen reader says. The Action Panel shows the
  same countdown as a `role="timer"` element, which is not announced as it
  changes, so a keyboard or screen-reader player can find it without being
  interrupted by it.
- **The Action Panel shows it too.** While the panel is up it shows "Time left:
  0:30", and "Time is up. Waiting for the server…" at zero. Your countdown is in
  addition to that one, never instead of it.
- **Choose how the Action Panel writes it.** Pass GameShell a
  `format-turn-deadline` function. It gets the time left in milliseconds and
  returns the whole line, so a game that counts in seconds writes
  `` :format-turn-deadline="(ms) => `${Math.ceil(ms / 1000)}s left`" ``, and one
  that holds its own number can show that instead. Without it the panel writes
  "Time left: M:SS". At zero the panel still says it is waiting for the server,
  whatever the function returns.
- **Only a table has it.** A persistent world has no step deadline, and a world
  does not publish `turnDeadline`.

**For hosts.** The platform `game_state` message carries three numbers at its
top level, beside `winners` and `isDraw`:

| Field | Clock | Meaning |
|---|---|---|
| `deadlineAt` | host | When the host closes the step, or `null` for no deadline. |
| `serverNow` | host | When the host sent the frame. |
| `receivedAt` | page | When the parent page took the frame off its socket. |

The parent page stamps `receivedAt` the moment the frame arrives and forwards
all three unchanged, including when it re-posts a cached frame on iframe load or
on `request-state`. A stamp taken at re-post time would pair an old `serverNow`
with a new page time and hand the player back the time the frame spent in the
cache. A frame with no `deadlineAt` (or `deadlineAt: null`) means no deadline. A
frame with a `deadlineAt` but without both stamps shows no countdown and logs an
error in the game frame's console naming the missing field.

### Example: Auto-Opening a Detail Panel

When a room-related action starts (either from ActionPanel or via followUp), automatically show the room's detail panel:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  actionController: UseActionControllerReturn;
  rooms: Array<{ id: number; name: string }>;
}>();

// Room selected by clicking on map
const selectedRoomId = ref<number | null>(null);

// Room from action context (e.g., followUp.args.roomId)
const actionContextRoomId = computed(() => {
  const args = props.actionController.currentArgs.value;
  if (!args?.roomId) return null;

  // Handle both plain ID and {id, name} object formats
  const roomId = args.roomId;
  if (typeof roomId === 'object' && roomId !== null) {
    return (roomId as { id: number }).id;
  }
  return roomId as number;
});

// Show panel if either source has a room
const activeRoomId = computed(() =>
  selectedRoomId.value ?? actionContextRoomId.value
);

const activeRoom = computed(() =>
  props.rooms.find(s => s.id === activeRoomId.value)
);
</script>

<template>
  <div class="game-layout">
    <GameMap
      :rooms="rooms"
      @room-click="selectedRoomId = $event"
    />

    <!-- Panel shows for clicked room OR action context room -->
    <RoomPanel
      v-if="activeRoom"
      :room="activeRoom"
      @close="selectedRoomId = null"
    />
  </div>
</template>
```

### Watching for Action Changes

To run side effects when actions start or complete:

<!-- typecheck: game src/ui/action-watch.ts -->
```typescript
import { watch } from 'vue';
import type { UseActionControllerReturn } from 'boardsmith/ui';

export function watchActions(
  actionController: UseActionControllerReturn,
  highlightElement: (targetId: unknown) => void,
): void {
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
    },
  );

  // React to specific arg changes
  watch(
    () => actionController.currentArgs.value?.targetId,
    (targetId) => {
      if (targetId) {
        highlightElement(targetId);
      }
    },
  );
}
```

## Full-Board Modals: the `#bs-game-modal` Host

GameShell renders a sanctioned overlay layer, `#bs-game-modal`, that exactly
fills the board region. Teleport a blocking modal there (an end-of-round
summary, a scoring recap) and it covers the board but never GameShell's
header or Action Panel:

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

## The End of the Game

When the flow completes, GameShell presents the ending twice: a game-over card
over the board, and an assertive screen-reader announcement ("Game over — Alice
wins"). The two follow **one** answer: the ending is shown when the flow is
complete and no board is holding it back. A board cannot get the card without
the announcement, or the other way round.

Two separate questions decide what a game's ending looks like.

**Who draws it.** By default the shell draws its `GameOverCard`. Fill the
`#game-over` slot to draw your own card in its place (the shell puts it in a
layer positioned over the visible board, so it stays in view however the board
is scrolled; a `position: absolute; inset: 0` wrapper fills that layer), or set
`providesOwnGameOverUi` on GameShell when your board draws the ending itself.
Then no card is drawn, but the shell still announces the result. Either form
works in a template: `provides-own-game-over-ui` or `providesOwnGameOverUi`.
(Every public component prop is named so its kebab-case form camelizes back to
it, which `src/ui/public-prop-names.test.ts` in the BoardSmith repository holds, #433.)

**When it is shown.** By default, the moment the flow completes. A board that
holds its result back on purpose (until the player has watched a replay of
the deciding battle, say) calls `holdGameOverUntil` in its `setup`, with a
function that says when its ending is on screen:

```ts
// holdGameOverUntil comes from 'boardsmith/ui'; call it in a board's setup

// The result is on screen once this viewer's replay of the final battle has
// ended or been skipped.
holdGameOverUntil(() => matchResultShown.value);
```

Until that function returns true, the shell shows no card and says nothing.
When it does, the card appears (unless your board draws the ending) and the
result is announced, once per game. The hold is released when the board
unmounts.

The shell reads the function after your board has rendered the frame that
completed the flow, so a hold that starts in reaction to that frame (a watcher
that starts the replay) is in place in time. It has to be false by then,
without waiting on anything: a hold that turns on only after an `await` has
already let the ending through.

`holdGameOverUntil` works in any board GameShell renders and in one
`renderAsSeat` mounts. Called anywhere else it throws, because only a table has
a game over to hold back.

**Telling the host page.** A host page that frames the game (ShufflewickPub)
draws its own Game Over overlay. So that the overlay never covers your ending,
GameShell's `game_ready` message carries `revealsGameOver: true`, and the shell
posts `{ source: 'shufflewick-game', type: 'game_over_shown' }` to the parent
once, the moment the ending is revealed (when the card appears and the result
is announced). A board that holds nothing sends it as soon as the flow
completes, and so does a table whose first drawn state is already finished (a
reload). A replay that hides and re-shows the result does not send it again.
A board that throws is replaced by an error message, and a board that unmounts
releases its hold, so an interrupted finale still sends it.

A hold cannot hide the result for good. While a hold keeps a finished game's
ending back, GameShell shows a "Show result" button over the board. Pressing
it releases every hold for that game: the ending is revealed and announced,
and `game_over_shown` is sent, still only once, so a hold whose function never
turns true (a stuck replay) does not keep the result or the host's overlay
away. The button is not shown during play or once the ending is revealed, and
the next game's holds hold again.

## Commands in the Controls Menu

A board can add its own one-shot commands, such as "Watch the last battle", to
the shell's controls menu with `useMenuCommands`. See "Game commands" in
`docs/ui-components.md`.

## Hiding the Shell's Chrome

A board whose player asks to see the whole field can hide the shell's players
panel and action bar with `useHideChrome`. See "Hiding the chrome to show the
field" in `docs/ui-components.md`.

## Holding Actions While the Screen Is Busy

A board in a state only its own screen has, such as a battle replay, can grey
out actions for now with `useActionHolds`, with a reason shown like a rule's
`.disabled()` reason. See "Holding actions on this screen" in
`docs/ui-components.md`.

## Board Sizing

GameShell never shrinks the board to fit the screen. The board renders at
its **intrinsic** (natural) size, top-left in the board region (`.boardregion`),
and the region scrolls when the board is bigger. The auto-UI's cells, pieces
and cards size themselves from the region's width with `cqw` units, never
below the `--bsg-tap-min` tap floor (44px; a dense board may lower it, never
below 24px), and a board that cannot fit at that floor scrolls. Size a
custom board the same way: `.boardregion` is an inline-size container, so
`100cqw` in your board is the region's width. The player's zoom is only a
magnifier, from 100% to 200%, set from the controls menu or, on a touch
screen, by pinching the board region. The region is `touch-action: none`, so
the shell pans it under one finger or a pen too, and a press that does not
move is a tap. A press on an element that sets its own `touch-action` (every
draggable does) or on a form control is that element's: neither it nor any
finger put down while it is held pans or pinches the board. Give a custom
gesture of your own `touch-action: none` to keep it.

The element that wraps your board — `.game-shell__zoom-container` — is
styled `width: max-content`, so the board keeps its natural size and the
region, not the board, scrolls. **Do not override this CSS from a custom
board.**

### The failure mode: a 0×0 board

`width: max-content` means the zoom container's size is *derived from its
children's natural size* — it does not hand children a size to fill. If your
board's root element sizes itself as a **percentage of its parent**
(`width: 100%`) or uses CSS `container-type` (which also depends on the
parent for its containment context), there is nothing for it to resolve
against inside a `max-content` ancestor, and it collapses to `0×0`. Because
this can happen silently (no visible error, no crash — the board region is
simply empty), a dev-mode `console.error` fires once a real game state has
arrived and the board still measures `0×0` after mounting.
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

### Content-flow boards: `useBoardSize()`

Some boards have no natural fixed size at all — their width comes from their
content: card hands, wrapping rows, responsive panels. Inside a `max-content`
ancestor these never wrap (`flex-wrap` and `@container` queries have no region
width to trigger against), so the board just grows horizontally as cards are
added and players end up scrolling sideways.

For these boards, use `useBoardSize()`: it measures `.boardregion` (the
ancestor GameShell sizes to the visible viewport) and pins your board root to
the region's available width, so wrapping works and growth is
vertical-scroll only. It re-measures on region resize and window resize.
The width is the one the region has with its vertical scrollbar showing,
whether or not it shows, so in a browser without `scrollbar-gutter` (Safari
before 18.2) a scrollbar coming or going does not move the pin.
The pin is capped at `100cqw` (`.boardregion` is an inline-size container),
so while the region narrows, as it does while the sidebar opens, the board
never runs past it in the frames before the pin is re-measured. Where the
region reserves no scrollbar gutter, browsers resolve `100cqw` as if its
vertical scrollbar were not there, so the cap takes that scrollbar's width off
(`calc(100cqw - 15px)`, say). The same
container is what a `cqw` unit or an unnamed `@container` query in your board
resolves against when nothing closer is a container.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useBoardSize } from 'boardsmith/ui';

const boardRef = ref<HTMLElement | null>(null);
const { boardStyle } = useBoardSize(boardRef);
</script>

<template>
  <div ref="boardRef" class="my-board" :style="boardStyle">...</div>
</template>
```

`useBoardSize()` also returns `zoom`, a read-only ref holding the player's
magnifier, the controls-menu slider or a pinch (1 outside GameShell). The region is not
zoomed and your board is, so a board that fits
more of itself to the region, such as its height, divides region pixels by
`zoom` to get its own. Watch `zoom` to re-fit: a zoom change does not resize
anything a `ResizeObserver` can see.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useBoardSize } from 'boardsmith/ui';

const boardRef = ref<HTMLElement | null>(null);
const { boardStyle, zoom } = useBoardSize(boardRef);
const regionHeight = ref(600); // measured from .boardregion, which is not zoomed
const boardHeight = computed(() => regionHeight.value / zoom.value);
</script>

<template>
  <div ref="boardRef" :style="[boardStyle, { height: `${boardHeight}px` }]">...</div>
</template>
```

Pick the model that matches your board:

| Board type | Example | Sizing |
|---|---|---|
| Sized from the region | grid, hex map | Cells in `cqw`, clamped between `--bsg-tap-min` and their natural size; the region scrolls past that |
| Content-driven width | card hands, wrapping rows | `useBoardSize()` on the board root (grows by scrolling) |

Do not use `useBoardSize()` on a board whose size does not follow its
content: pinning it to the region accomplishes nothing.

### The Action Panel floats over the board

The board region reserves one row for the Action Panel under the board
(`--bsg-panel-reserved`), so a one-row panel sits under your board, not over
it. Rows beyond the first float over the bottom of the board. While the player
has the panel put down to its thin line, the reserve is only that line, so the
board reaches it; a game that passes `action-bar-starts-collapsed` starts that
way. The reserve changes only on the player's own toggle, never on a pick, so
your board never depends on the panel's live height: the panel showing,
growing or shrinking never moves the board. A question that brings the panel
up by itself while it is put down floats over the board.

What follows for a custom board:

- **A panel taller than one row covers the bottom of your board.** The region
  ends in scroll room as tall as what the panel's cap adds to the reserved row,
  so the player can scroll what the panel covers into view, and a control that
  takes keyboard focus is scrolled to land above the panel. The scroll room is
  a constant, so the panel re-wrapping never moves a scrolled board. A game that
  passes `:action-bar-opens-for-actions="false"` gets none while the panel is put
  down, since nothing but the line can cover the board then (#1525). The player
  can also put the panel down to a thin line. On a short landscape screen the
  cap is the one reserved row, so only a second row of actions, a typed editor
  (below), or a question that brings a put-down panel up by itself, covers the
  board.
- **The panel is capped at two control rows** (one on a short landscape
  screen, where height is the scarce axis), declared as `--bsg-panel-max`. It
  lays itself out to fit them (at phone width it stacks the action's name over
  the chosen items and wraps the prompt beside its control), and on a step with
  more than fits, it scrolls inside the cap. A menu level (the list of actions
  to take, or a group's) has its own cap, `--bsg-panel-menu-max`, so a whole
  level is in view: on an upright phone its buttons and Undo are three columns
  under the row of menu, seat and Back, each label wrapped whole, and it may
  grow the panel to what it needs, bounded at half the screen's height; on a
  short landscape screen its labels wrap to two lines and it may take two rows.
  The other exceptions are a typed
  editor (a text or number pick) and a choice list (a `chooseFrom` pick's
  buttons, an `orderedList`'s Adds, a multiSelect's checkboxes, or an element
  pick's list): while one is open the panel may grow past the cap. A choice
  list may grow it to show every choice and its skip, under any earlier
  choices, bounded at 60% of the screen's height, and scrolls beyond that; one
  whose candidates your board draws keeps the cap, so it never covers them.
  "Draws" means the board, or a modal it Teleports to `#bs-game-modal`, has a
  node with the candidate's `anchorAttrs` on it: the shell reads those anchors
  whenever the board changes and reports them through
  `boardInteraction.isDrawn(ref)`. So an element pick over cards
  your board leaves out, such as an opponent's hand, grows, and one over pieces
  it draws keeps the cap. Spread `anchorAttrs` (or `useSelectable`'s `attrs`)
  on every element you draw and this follows by itself. An element pick with no
  candidate, which shows only its instruction and skip, grows.
  A one-line or number field may grow it to what the field needs, bounded at
  60% of the screen's height: on a phone its label and hint stack above the
  field and submit, under any earlier choices, and a long prompt or a refusal
  message adds lines. A multi-line text box (`multiline: true`) may grow it to
  what the box needs, bounded at 60% of the screen's height: six lines of text
  plus the action, the field's label, the count and the submit. On a short
  screen the box gives way (down to a few lines) rather than the submit button
  leaving the panel. The part of the board under a panel grown past the
  cap cannot be scrolled into view until the pick closes.

Do **not** try to measure the Action Panel from a custom board, and do not size
your board against a panel height. Keep anything the player must always see
away from the board's bottom edge, or let it scroll, or lift it above the panel
with `--bsg-panel-overlap` ([below](#keep-an-overlay-above-the-action-panel)).

### Keep an overlay above the Action Panel

`--bsg-panel-overlap` is how far the Action Panel reaches above the row the
board region reserves for it, in pixels, at the panel's current height,
counting the part of its edge toggle that rises above its top. It is that part
of the toggle (13px, or 31px on a touch screen, where the toggle is 44px) while
the panel fits its reserved row (a one-row panel, or the thin line while the
player has it put down), and grows as the panel wraps to a
second row, opens over a put-down preference, or an editor grows it. Every
element inside the board region inherits it; one you teleport out of the board
(to `body`, say) does not.

An overlay pinned to the bottom of a board that fills the region (a buy panel,
a hand tray) stays just above the panel and its toggle in every state with:

```css
.buy-panel {
  position: absolute;
  bottom: calc(var(--bsg-panel-overlap) + var(--bsg-s2));
}
```

The value is in the region's pixels, and your board is zoomed. At a zoom other
than 1, divide by the `zoom` that `useBoardSize()` returns (see above), for
example by setting it on your board as `--board-zoom` and writing
`calc((var(--bsg-panel-overlap) + var(--bsg-s2)) / var(--board-zoom))`.

## Playing on a Phone

The shell is built for a phone first: its chrome, the Action Panel and the
auto-UI already play by touch at 390px wide. A custom board has to hold up its
own end, and these are the rules for it.

### Touch input: tap first, pointer drag second

Every move a board offers by drag must also work by tap. `useDragDrop()` gives
you both from one binding: spread `drag(ref).props` on the piece and
`drop(ref).props` on each target, and a press that moves drags (by mouse, pen
or finger) while a press that does not move is a tap that chooses the element.
Tap the piece, then the target. Never bind a drag-only handler of your own,
never use native HTML5 drag (it never starts from a touch), and do not add your
own click handler beside the props, or one tap chooses twice.

The shell pans and pinches the board region itself, and leaves a press alone
when it lands on an element that sets anything but `touch-action: auto`: that press is
the element's. `drag().props` sets `touch-action: none` on the draggable
element, so a press there drags and a press anywhere else pans. A custom
gesture of your own (a dial, a swipe) sets `touch-action: none` on its element
for the same reason. Set `touch-action` on nothing else: on a large container
it turns pan and pinch off over all of it. The details are in
[`useDragDrop`](./ui-components.md#usedragdrop).

Shown working by [the drag-drop unit tests](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/composables/useDragDrop.test.ts)
and [the touch regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/touch-phone-browser.mjs), which taps and
drags a pawn by touch in Chromium and WebKit.

### Hover is a bonus, never the only way

A tapped element keeps `:hover` until the next tap somewhere else, so on a
phone a hover style sticks. Put every hover style behind
`@media (hover: hover)`:

```css
@media (hover: hover) {
  .my-tile:hover { outline: 2px solid var(--bsg-accent); }
}
```

Never show information only on hover. A coordinate, a card's rules text or the
reason a control is disabled must also show on tap or on keyboard focus, or be
visible all the time on a touch screen. A native `title="…"` tooltip does
nothing on touch; for a disabled control use `vDisabledReason`, which explains
on hover, focus and tap ([above](#understanding-getchoices-return-values)). The
engine's own UI follows the same rule: the Action Panel previews a choice's
pieces on focus, and on touch a first tap previews and a second commits.

Shown working by [the hover gate](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/hover-gated.test.ts), which holds
every `:hover` in the engine's UI inside `@media (hover: hover)`, and
[the tap-preview tests](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/components/auto-ui/ActionPanel.tap-preview.test.ts).

### Responsive boards and the tap floor

The shell never shrinks a board to fit the screen ([Board Sizing](#board-sizing)).
A board sizes itself from the board region: `.boardregion` is an inline-size
container, so `100cqw` is its width and a container query in your board reads
it. Size cells, pieces and cards between the tap floor and their natural size,
the way the auto-UI does, and let the region scroll past that:

```css
.my-board {
  --cell: clamp(max(24px, var(--bsg-tap-min)), 100cqw / 8, 64px);
}
@container (max-width: 480px) {
  .my-board__legend { display: none; }
}
```

`--bsg-tap-min` is 44px. A dense board may lower it, never below 24px, which
the `max(24px, …)` holds. Anything a finger must hit gets at least that size,
including the gaps you leave between targets. A content-driven board (a hand, a
wrapping row) pins itself to the region with `useBoardSize()` instead.

Shown working by [the phone tap-floor regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/tap-floor-phone-browser.mjs)
and [the fluid card test](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/components/auto-ui/renderers/CardRenderer.fluid.test.ts).

### The layout size and a phone UI

Every board gets two props from the shell: `formFactor` (`'compact'` below
640px, `'medium'` below 1024px, `'wide'` from there, the tiers in
`BREAKPOINTS`) and `orientation` (`'portrait'` or `'landscape'`). Both follow a
resize or a rotation. Read them, through `TableBoardProps` or
`WorldBoardProps`, rather than a media query of your own, so your board and the
shell's chrome always agree on the size. The types are `FormFactor` and
`Orientation`.

The default is one responsive board at every size. A game that wants a
different board on a phone opts in with at most one `phoneUI()` entry beside
its `defaultUI()` in `defineGameUIs()`; the shell renders it below 640px and
the default everywhere else, swapping as the viewport crosses the line. See
[the UI registry](./ui-components.md#dev-time-ui-switcher) for the dev
switcher's handling of it.

Shown working by [the layout-size tests](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/composables/useLayoutSize.test.ts),
[the phone UI shell tests](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/phone-ui.shells.test.ts) and
[the phone UI regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/phone-ui-browser.mjs).

### Safe areas come from the host

A notch, a rounded corner or a home indicator can cover the screen's edges.
Inside the game's iframe `env(safe-area-inset-*)` cannot be trusted, so the
host page measures the insets and sends them, and the shell writes them to
`--bsg-safe-top`, `--bsg-safe-right`, `--bsg-safe-bottom` and
`--bsg-safe-left` (0px until they arrive). The shell already keeps its chrome
and the board region inside them, so a board inside the region needs nothing.
An element of yours positioned against the frame's edge (a `position: fixed`
tray, say) pads itself by these tokens, never by `env(safe-area-inset-*)`. The host's
side is in [the host's safe areas](./ui-components.md#the-hosts-safe-areas).

Shown working by [the safe-area shell tests](https://github.com/Shufflewick/BoardSmith/blob/main/src/ui/components/GameShell.safe-area.test.ts)
and [the safe-area regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/safe-area-browser.mjs), on a phone
held both ways.

### Check it on a real phone

The oldest browsers a game supports are Safari 16.4, iOS 16.4, Chrome 111, Edge 111 and Firefox 128.
`boardsmith build` targets them, and fails, naming the file and the code, when
your bundle holds JavaScript or CSS they cannot parse, shown in
[the floor test](https://github.com/Shufflewick/BoardSmith/blob/main/src/cli/commands/build-browser-floor.test.ts).
Test on the oldest phone you can find, not only on a new one.

Emulation proves layout and the tap path, not the device. Before you ship a
custom board, play a whole game on a real iPhone and a real Android phone,
held both ways, and check what no emulator can show:

- The notch and home indicator cover nothing you drew, and nothing you drew
  sits under them.
- A long press does what you expect: no iOS callout, text selection or
  magnifier on your pieces.
- No hover style sticks after a tap, and nothing you show on hover is missing.
- Dragging by finger feels right, and a drag never pans or pinches the board.
- Every target is easy to hit with a thumb, and the board stays smooth on a
  mid-range phone.

[Browser testing](./browser-testing.md#phones-webkit-touch-pointer-drag-and-a-slow-cpu-1604)
lists what the emulated runs cover, shown in [the touch regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/touch-phone-browser.mjs)
and [the CPU-throttled regression](https://github.com/Shufflewick/BoardSmith/blob/main/scripts/cpu-throttle-browser.mjs), and why
each item above stays a manual check.

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
     await actionController.start(name, { args });
   }
   ```

3. **Check Network tab** for WebSocket messages or API calls

### Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Action not in availableActions | Condition failed or no valid selections | Use `debugActionAvailability()` |
| "That choice is no longer available" from the server | The value is not among the current choices: it went stale, or the UI passed the wrong value type | Read the dev log line starting `[BoardSmith] Invalid selection` for the value sent and the valid choices; pass an element ID (number), not an object |
| Element not found in gameView | ID mismatch or element moved | Use `findElement(gameView, { id })` to verify |
| validElements is empty | Choices not fetched yet | Check `isLoadingChoices`, wait for fetch |
| Selection not applying | Wrote to `actionController.currentArgs` directly | Use `actionController.fill()` instead |

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
await actionController.start('play', { args: { card: card.id } });

// Wrong - don't pass the object
await actionController.start('play', { args: { card: card } });
```

## Complete Example: Card Game Board

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  useBoardInteraction,
  findPlayerHand,
  findElement,
  type GameViewElement,
  type TableBoardProps,
} from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();

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

async function onCardClick(card: GameViewElement) {
  if (!isCardPlayable(card.id)) return;

  // If in wizard mode, fill the selection
  if (boardInteraction.isSelectableElement(card)) {
    boardInteraction.triggerElementSelect(card);
    return;
  }

  // Otherwise play it: every pick is known, so it runs as soon as it opens
  await props.actionController.start('play', { args: { card: card.id } });
}

async function drawCard() {
  if (!props.availableActions.includes('draw')) return;
  await props.actionController.start('draw');
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
          highlighted: boardInteraction.isHighlighted(card),
          selected: boardInteraction.isSelected(card),
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

