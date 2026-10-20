# Component Showcase

This document provides visual examples and code snippets for key BoardSmith UI components.

## GameShell

The main wrapper component that provides complete game UI structure.

```vue
<template>
  <!-- The board comes from the registry in src/ui/uis.ts; GameShell mounts
       it and passes it gameView, actionController, isMyTurn and the rest. -->
  <GameShell :uis="uis" />
</template>
```

**What it provides:**
- Player panels showing names, scores, turn state
- Central game board area (your board from `src/ui/uis.ts`)
- Action panel for selections
- Undo button (when available)
- The postMessage connection to the host it runs inside

## ActionPanel

Auto-generated action UI from game metadata.

```
┌─────────────────────────────────────────┐
│  Your Turn                              │
├─────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Draw   │ │  Play   │ │  Pass   │   │
│  └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────┤
│  Select a card to play:                 │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐          │
│  │ A♠ │ │ K♥ │ │ Q♦ │ │ J♣ │          │
│  └────┘ └────┘ └────┘ └────┘          │
├─────────────────────────────────────────┤
│  [ Cancel ]              [ Confirm ]    │
└─────────────────────────────────────────┘
```

**Features:**
- Action buttons for available actions
- Selection UI (cards, choices, numbers, text)
- Wizard mode for multi-step actions
- Optional selection skip button
- Board highlighting integration

## Die3D

3D dice with physics-based rolling animation.

```vue
<template>
  <Die3D
    v-for="die in dice"
    :key="die.id"
    :die-id="die.id"
    :value="die.attributes.value"
    :roll-count="die.attributes.rollCount"
    :sides="die.attributes.sides"
    :size="60"
  />
</template>

<script setup>
// Dice come from gameView in a real game
const dice = computed(() => {
  const pool = props.gameView?.children?.find(c => c.className === 'DicePool');
  return pool?.children?.filter(c => c.className === 'Die') || [];
});
</script>
```

**Props:**
- `dieId` - Unique identifier for animation tracking
- `value` - Current face value (1-indexed by default)
- `rollCount` - Increment to trigger roll animation
- `sides` - Die type: 4, 6, 8, 10, 12, or 20
- `size` - Size in pixels (default: 60)
- `color` - Custom die color (optional)

**Note:** Use `die.roll()` in game logic to roll dice. This increments `rollCount` automatically, triggering the animation.

**Supported die types:** d4, d6, d8, d10, d12, d20

## AutoUI

Production-ready automatic game UI.

```vue
<template>
  <AutoUI
    :game-view="gameView"
    :player-seat="playerSeat"
  />
</template>
```

Renders the entire game state as a tree of elements. Useful for:
- Shipping simple games as a complete, production-ready UI
- Rapid prototyping and rules validation before investing in a custom UI

## Card Animations

### Flying Cards

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useFlyingElements, FlyingCardsOverlay } from 'boardsmith/ui';

const deckRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const { flyingElements, fly } = useFlyingElements();

async function dealCard() {
  if (!deckRef.value) return;
  await fly({
    id: 'deal-card',
    startRect: deckRef.value,
    endRect: () => handRef.value,
    elementData: { rank: 'A', suit: 'S' },
    flip: true,
    duration: 400,
  });
}
</script>

<template>
  <div ref="deckRef" class="deck" @click="dealCard" />
  <div ref="handRef" class="hand" />
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

### Fly On Appear

For declarative fly-on-appear animations when elements enter the view:

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { findElement, useFlyingElements, FlyingCardsOverlay, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const deckRef = ref<HTMLElement | null>(null);
const starterRef = ref<HTMLElement | null>(null);

const starterCard = computed(() => findElement(props.gameView, { name: 'starter' }));

const { flyingElements, flyOnAppear } = useFlyingElements();

const { isFlying } = flyOnAppear({
  element: starterCard,
  sourceRef: deckRef,
  targetRef: starterRef,
  getElementData: (el) => ({
    rank: String(el.attributes?.rank),
    suit: String(el.attributes?.suit),
  }),
  flip: true,
});
</script>

<template>
  <div ref="deckRef" class="deck" />
  <div ref="starterRef" class="starter" :class="{ arriving: isFlying }" />
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

Automatically flies elements when they appear in the view.

## Board Interaction

Bidirectional interaction between board and action panel.

<!-- typecheck: board -->
```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, useBoardInteraction, type TableBoardProps } from 'boardsmith/ui';

const props = defineProps<TableBoardProps>();
const boardInteraction = useBoardInteraction();
const cards = computed(() => findElements(props.gameView, { className: 'Card' }));
</script>

<template>
  <div
    v-for="element in cards"
    :key="element.id"
    :class="{
      highlighted: boardInteraction.isHighlighted(element),
      selected: boardInteraction.isSelected(element),
      selectable: boardInteraction.isSelectableElement(element),
    }"
  />
</template>
```

## Grid Utilities

### Square Grid (Chess-style)

<!-- typecheck: game src/ui/notation.ts -->
```typescript
import { toAlgebraicNotation, fromAlgebraicNotation } from 'boardsmith/ui';

// (row, col), with row 0 at the top of an 8-row board by default
toAlgebraicNotation(0, 0);                            // "a8"
toAlgebraicNotation(4, 3);                            // "d4"
toAlgebraicNotation(0, 0, { rowZeroAtTop: false });   // "a1"
fromAlgebraicNotation('e4');                          // { row: 4, col: 4 }
```

### Hex Grid

<!-- typecheck: game src/ui/hex.ts -->
```typescript
import { hexToPixel, getHexPolygonPoints } from 'boardsmith/ui';

// Center of the hex at axial (q, r) = (2, 1), 30px hexes, flat-top
const { x, y } = hexToPixel(2, 1, 30, 'flat');
// SVG polygon points around (0, 0): place it with transform="translate(x, y)"
const points = getHexPolygonPoints(30, 'flat');
```

## Card Display

<!-- typecheck: game src/ui/suits.ts -->
```typescript
import { getSuitSymbol, getSuitColor, isRedSuit } from 'boardsmith/ui';

getSuitSymbol('H');  // "♥"
getSuitSymbol('S');  // "♠"
getSuitColor('H');   // "#e74c3c" (red)
isRedSuit('D');      // true
```

## Theming

<!-- typecheck: game src/ui/theme.ts -->
```typescript
import { applyTheme } from 'boardsmith/ui';

applyTheme({
  primary: '#00d9ff',
  secondary: '#00ff88',
  background: '#1a1a2e',
  surface: '#16213e',
  text: '#ffffff',
  error: '#e74c3c',
});
```

## Future: Interactive Storybook

For fully interactive component exploration, we recommend setting up Storybook:

```bash
npx storybook@latest init --type vue3-vite
```

This would provide:
- Live component playground
- Props documentation
- Visual regression testing
- Accessibility checks

See [Storybook for Vue](https://storybook.js.org/docs/vue/get-started/introduction) for setup instructions.

## See Also

- [UI Components](./ui-components.md) - Full API reference
- [Architecture](./architecture.md) - Package relationships
- [Common Patterns](./common-patterns.md) - Game implementation patterns
