# Component Showcase

This document provides visual examples and code snippets for key BoardSmith UI components.

## GameShell

The main wrapper component that provides complete game UI structure.

```vue
<template>
  <GameShell
    game-type="my-game"
    display-name="My Game"
    :player-count="2"
  >
    <template #game-board="{ gameView, actionController, isMyTurn }">
      <MyGameBoard
        :game-view="gameView"
        :action-controller="actionController"
        :is-my-turn="isMyTurn"
      />
    </template>
  </GameShell>
</template>
```

**What it provides:**
- Header with game title and player indicator
- Player panels showing names, scores, turn state
- Central game board area (your custom content)
- Action panel for selections
- Undo button (when available)
- WebSocket connection management

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
    :value="dieValue"
    :rolling="isRolling"
    :sides="6"
    :size="60"
    @click="onDieClick"
  />
</template>

<script setup>
const dieValue = ref(1);
const isRolling = ref(false);

function rollDie() {
  isRolling.value = true;
  // After animation completes (timing based on your preference)
  setTimeout(() => {
    dieValue.value = Math.floor(Math.random() * 6) + 1;
    isRolling.value = false;
  }, 1000);
}
</script>
```

**Props:**
- `value` - Current face value (1-indexed by default)
- `rolling` - Whether the die is currently rolling
- `sides` - Die type: 4, 6, 8, 10, 12, or 20
- `size` - Size in pixels (default: 60)
- `color` - Custom die color (optional)

**Supported die types:** d4, d6, d8, d10, d12, d20

## AutoUI

Automatic UI generation for prototyping.

```vue
<template>
  <AutoUI
    :game-view="gameView"
    :player-position="playerPosition"
    :flow-state="flowState"
  />
</template>
```

Renders the entire game state as a tree of elements. Useful for:
- Rapid prototyping
- Debugging game state
- Reference implementation

## Card Animations

### Flying Cards

```vue
<script setup>
import { useFlyingCards, FlyingCardsOverlay } from '@boardsmith/ui';

const { flyingCards, flyCard } = useFlyingCards();

async function dealCard() {
  await flyCard({
    startRect: deckRef.value.getBoundingClientRect(),
    endRect: () => handRef.value.getBoundingClientRect(),
    cardData: { rank: 'A', suit: 'S' },
    flip: true,
    duration: 400,
  });
}
</script>

<template>
  <FlyingCardsOverlay :flying-cards="flyingCards" />
</template>
```

### Auto Animations

```vue
<script setup>
import { useAutoAnimations, FlyingCardsOverlay } from '@boardsmith/ui';

const { flyingElements } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    { element: deck, ref: deckRef },
    { element: hand, ref: handRef },
    { element: discard, ref: discardRef },
  ],
  getElementData: (el) => ({
    rank: el.attributes?.rank,
    suit: el.attributes?.suit,
  }),
});
</script>
```

Automatically animates elements when they move between containers.

## Board Interaction

Bidirectional interaction between board and action panel.

```vue
<script setup>
import { useBoardInteraction } from '@boardsmith/ui';

const boardInteraction = useBoardInteraction();

// In template:
// :class="{
//   'highlighted': boardInteraction?.isHighlighted(element),
//   'selected': boardInteraction?.isSelected(element),
//   'selectable': boardInteraction?.isSelectableElement(element),
// }"
</script>
```

## Grid Utilities

### Square Grid (Chess-style)

```typescript
import { toAlgebraicNotation, fromAlgebraicNotation } from '@boardsmith/ui';

toAlgebraicNotation(0, 0);    // "a1"
toAlgebraicNotation(4, 3);    // "e4"
fromAlgebraicNotation('e4');  // { col: 4, row: 3 }
```

### Hex Grid

```typescript
import { hexToPixel, getHexPolygonPoints } from '@boardsmith/ui';

const { x, y } = hexToPixel(q, r, size, 'flat');
const points = getHexPolygonPoints(cx, cy, size, 'flat');
```

## Card Display

```typescript
import { getSuitSymbol, getSuitColor, isRedSuit } from '@boardsmith/ui';

getSuitSymbol('H');  // "♥"
getSuitSymbol('S');  // "♠"
getSuitColor('H');   // "#e74c3c" (red)
isRedSuit('D');      // true
```

## Theming

```typescript
import { applyTheme } from '@boardsmith/ui';

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
