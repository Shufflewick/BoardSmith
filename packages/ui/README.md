# @boardsmith/ui

Vue 3 UI components for BoardSmith games. Includes the game shell, action panel, and helper components for common game elements.

## Installation

```bash
npm install @boardsmith/ui
```

## Quick Start

```vue
<template>
  <GameShell
    :game-state="gameState"
    :available-actions="actions"
    @action="handleAction"
  >
    <template #board>
      <MyGameBoard :game="gameState.game" />
    </template>
  </GameShell>
</template>

<script setup>
import { GameShell } from '@boardsmith/ui';
import { useGameConnection } from '@boardsmith/ui';

const { gameState, actions, submitAction } = useGameConnection(gameId, playerId);

function handleAction(action) {
  submitAction(action);
}
</script>
```

## Core Components

### GameShell

Main wrapper component that provides the game layout:

```vue
<GameShell
  :game-state="gameState"
  :available-actions="actions"
  :player-position="playerPosition"
  :show-debug="isDev"
  @action="handleAction"
>
  <template #board>
    <!-- Your game board here -->
  </template>

  <template #sidebar>
    <!-- Optional sidebar content -->
  </template>
</GameShell>
```

**Props:**
- `gameState` - Current game state from server
- `availableActions` - Actions the player can take
- `playerPosition` - Current player's position (0-indexed)
- `showDebug` - Show debug panel toggle (default: false)

**Events:**
- `@action` - Emitted when player submits an action

**Slots:**
- `#board` - Main game board area
- `#sidebar` - Optional sidebar content
- `#header` - Custom header content

### ActionPanel

Displays available actions and handles selection:

```vue
<ActionPanel
  :actions="availableActions"
  :current-selection="selection"
  @select="handleSelection"
  @submit="handleSubmit"
  @cancel="handleCancel"
/>
```

**Props:**
- `actions` - Array of available actions
- `currentSelection` - Current selection state

**Events:**
- `@select` - Selection made
- `@submit` - Action submitted
- `@cancel` - Selection cancelled

### GameHeader

Header bar with game info and controls:

```vue
<GameHeader
  :game-name="game.displayName"
  :phase="game.phase"
  :current-player="currentPlayer"
  :is-my-turn="isMyTurn"
/>
```

### PlayersPanel

Show player information:

```vue
<PlayersPanel
  :players="game.players"
  :current-player-index="game.currentPlayerIndex"
  :my-position="playerPosition"
/>
```

### DebugPanel

Development debugging panel:

```vue
<DebugPanel
  :game-state="gameState"
  :action-history="history"
  :show-flow="true"
  @time-travel="handleTimeTravel"
  @rewind="handleRewind"
/>
```

Features:
- View game state as JSON
- Browse action history
- Time-travel to any action (read-only view)
- Rewind to any action (modifies game)
- View flow stack

## Helper Components

### Die3D

Single 3D die component:

```vue
<Die3D
  :sides="6"
  :value="dieValue"
  :color="'red'"
  :rolling="isRolling"
/>
```

**Props:**
- `sides` - Number of sides (4, 6, 8, 10, 12, 20)
- `value` - Current face value
- `color` - Die color
- `size` - Die size in pixels

### FlyingCardsOverlay

Animate cards flying between positions:

```vue
<FlyingCardsOverlay
  :animations="cardAnimations"
  @animation-complete="handleComplete"
/>
```

Use with the animation controller:

```typescript
import { useCardAnimations } from '@boardsmith/ui';

const { flyCard, animations } = useCardAnimations();

// Animate card from deck to hand
flyCard(card, deckRef, handRef);
```

### ZoomPreviewOverlay

Show zoomed preview on hover:

```vue
<ZoomPreviewOverlay>
  <template #trigger>
    <SmallCard :card="card" />
  </template>
  <template #preview>
    <LargeCard :card="card" />
  </template>
</ZoomPreviewOverlay>
```

## Auto UI

For rapid prototyping, use the automatic UI generator:

```vue
<template>
  <AutoUI
    :game-state="gameState"
    :available-actions="actions"
    @action="handleAction"
  />
</template>

<script setup>
import { AutoUI } from '@boardsmith/ui';
</script>
```

Auto UI automatically renders:
- Element tree as nested containers
- Cards with basic styling
- Pieces with position
- Action buttons
- Selection highlighting

### AutoElement

Render any element automatically:

```vue
<AutoElement :element="someElement" :depth="0" />
```

### AutoGameBoard

Auto-generated game board:

```vue
<AutoGameBoard :game="gameState.game" />
```

## Lobby Components

### GameLobby

Game creation and joining:

```vue
<GameLobby
  :game-types="availableGames"
  :player-id="playerId"
  @create-game="handleCreate"
  @join-game="handleJoin"
/>
```

### WaitingRoom

Pre-game waiting area:

```vue
<WaitingRoom
  :game-id="gameId"
  :players="lobby.players"
  :min-players="game.minPlayers"
  :max-players="game.maxPlayers"
  :is-host="isHost"
  @start="handleStart"
  @leave="handleLeave"
/>
```

## Composables

### useGameConnection

Connect to game server via WebSocket:

```typescript
import { useGameConnection } from '@boardsmith/ui';

const {
  gameState,      // Current game state
  actions,        // Available actions
  isConnected,    // Connection status
  isMyTurn,       // Is it my turn
  submitAction,   // Submit an action
  undo,           // Request undo
  reconnect,      // Reconnect to server
} = useGameConnection(gameId, playerId, options);
```

### useSelection

Handle element selection for actions:

```typescript
import { useSelection } from '@boardsmith/ui';

const {
  selectedElements,
  isSelecting,
  canSelect,
  select,
  deselect,
  clear,
  confirm,
} = useSelection(currentAction);
```

### useCardAnimations

Manage flying card animations:

```typescript
import { useCardAnimations } from '@boardsmith/ui';

const {
  animations,
  flyCard,
  flyCards,
  clear,
} = useCardAnimations();
```

## Styling

Components use CSS custom properties for theming:

```css
:root {
  --bs-primary: #3b82f6;
  --bs-secondary: #64748b;
  --bs-success: #22c55e;
  --bs-warning: #f59e0b;
  --bs-error: #ef4444;

  --bs-card-width: 100px;
  --bs-card-height: 140px;
  --bs-card-radius: 8px;

  --bs-piece-size: 40px;

  --bs-font-family: system-ui, sans-serif;
  --bs-font-size: 14px;
}
```

## CSS Classes

Common utility classes:

- `.bs-selectable` - Element can be selected
- `.bs-selected` - Element is selected
- `.bs-highlighted` - Element is highlighted
- `.bs-disabled` - Element is disabled
- `.bs-current-player` - Current player indicator
- `.bs-my-turn` - It's my turn indicator

## Best Practices

1. **Use slots** for custom element rendering
2. **Provide visual feedback** for selectable elements
3. **Use animations** for state changes
4. **Test on mobile** - components are touch-friendly
5. **Use Auto UI** for prototyping, then customize

## See Also

- [UI Components Guide](../../docs/ui-components.md)
- [Getting Started](../../docs/getting-started.md)
- [Common Patterns](../../docs/common-patterns.md)
