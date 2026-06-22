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
      <MyGameTable
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
    :flow-state="flowState"
  />
</template>
```

Renders the entire game state as a tree of elements. Useful for:
- Shipping simple games as a complete, production-ready UI
- Rapid prototyping and rules validation before investing in a custom UI

## Card Animations

### Flying Cards

```vue
<script setup>
import { useFlyingElements, FlyingCardsOverlay } from 'boardsmith/ui';

const { flyingElements, fly } = useFlyingElements();

async function dealCard() {
  await fly({
    id: 'deal-card',
    startRect: deckRef.value.getBoundingClientRect(),
    endRect: () => handRef.value.getBoundingClientRect(),
    elementData: { rank: 'A', suit: 'S' },
    flip: true,
    duration: 400,
  });
}
</script>

<template>
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

### Fly On Appear

For declarative fly-on-appear animations when elements enter the view:

```vue
<script setup>
import { useFlyingElements, FlyingCardsOverlay } from 'boardsmith/ui';

const starterCard = computed(() => findElement(gameView.value, el =>
  el.className === 'Card' && el.attributes?.isStarter));

const { flyingElements, flyOnAppear } = useFlyingElements();

const { isFlying } = flyOnAppear({
  element: starterCard,
  sourceRef: deckRef,
  targetRef: starterRef,
  getElementData: (el) => ({
    rank: el.attributes?.rank,
    suit: el.attributes?.suit
  }),
  flip: true,
});
</script>

<template>
  <FlyingCardsOverlay :flying-cards="flyingElements" />
</template>
```

Automatically flies elements when they appear in the view.

## Board Interaction

Bidirectional interaction between board and action panel.

```vue
<script setup>
import { useBoardInteraction } from 'boardsmith/ui';

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
import { toAlgebraicNotation, fromAlgebraicNotation } from 'boardsmith/ui';

toAlgebraicNotation(0, 0);    // "a1"
toAlgebraicNotation(4, 3);    // "e4"
fromAlgebraicNotation('e4');  // { col: 4, row: 3 }
```

### Hex Grid

```typescript
import { hexToPixel, getHexPolygonPoints } from 'boardsmith/ui';

const { x, y } = hexToPixel(q, r, size, 'flat');
const points = getHexPolygonPoints(cx, cy, size, 'flat');
```

## Card Display

```typescript
import { getSuitSymbol, getSuitColor, isRedSuit } from 'boardsmith/ui';

getSuitSymbol('H');  // "♥"
getSuitSymbol('S');  // "♠"
getSuitColor('H');   // "#e74c3c" (red)
isRedSuit('D');      // true
```

## Theming

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
