# Getting Started with BoardSmith

BoardSmith is a TypeScript framework for building turn-based board and card games with built-in multiplayer support, AI opponents, and automatic UI generation.

## Prerequisites

- Node.js 20+
- npm, pnpm, or yarn

## Quick Start

### 1. Create a New Game Project

```bash
npx boardsmith init my-game
cd my-game
npm install
```

This creates a new game project with the following structure:

```
my-game/
├── boardsmith.json          # Game configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── vite.config.ts           # Vite bundler config
├── index.html               # Entry HTML
├── public/                  # Static assets
├── src/
│   ├── main.ts              # App entry point
│   ├── rules/               # Game logic
│   │   ├── game.ts          # Main Game class
│   │   ├── elements.ts      # Custom element classes
│   │   ├── actions.ts       # Player action definitions
│   │   ├── flow.ts          # Game flow definition
│   │   └── index.ts         # Exports
│   └── ui/                  # Vue UI components
│       ├── App.vue          # Main app component
│       ├── components/      # Custom components
│       │   └── GameTable.vue
│       └── index.ts         # UI exports
└── tests/
    └── game.test.ts         # Game tests
```

### 2. Start Development Server

```bash
boardsmith dev
```

This starts:
- A Vite dev server on port 5173 (UI)
- A game server on port 8787 (API/WebSocket)
- Automatically opens browser tabs for each player

#### Dev Server Options

```bash
# Specify number of players
boardsmith dev --players 3

# Add AI opponents
boardsmith dev --ai 1              # Player 1 is AI
boardsmith dev --ai 0 2            # Players 0 and 2 are AI

# Set AI difficulty
boardsmith dev --ai 1 --ai-level hard    # easy, medium, hard, expert

# Custom ports
boardsmith dev --port 3000 --worker-port 9000
```

### 3. Run Tests

```bash
boardsmith test           # Run once
boardsmith test --watch   # Watch mode
```

### 4. Validate Before Publishing

```bash
boardsmith validate
```

This runs:
- TypeScript compilation checks
- Configuration validation
- Random game simulation to detect infinite loops or game-ending bugs

### 5. Build for Production

```bash
boardsmith build
```

### 6. Publish to boardsmith.io

```bash
boardsmith publish
```

## Understanding the Generated Code

### Game Configuration (boardsmith.json)

```json
{
  "$schema": "https://boardsmith.io/schemas/game.json",
  "name": "my-game",
  "displayName": "My Game",
  "description": "A fun game for 2-4 players",
  "playerCount": { "min": 2, "max": 4 },
  "estimatedDuration": "15-30 minutes",
  "complexity": 2,
  "categories": ["card-game"],
  "thumbnail": "./public/thumbnail.png",
  "scoreboard": { "stats": ["score"] }
}
```

### Game Class (src/rules/game.ts)

The Game class is the heart of your game. It:
- Extends `Game<YourGame, YourPlayer>`
- Registers element classes
- Creates the initial game state (deck, board, etc.)
- Registers actions players can take
- Defines the game flow

```typescript
export class MyGame extends Game<MyGame, MyPlayer> {
  deck!: Deck;

  constructor(options: MyGameOptions) {
    super(options);

    // Register element classes (required for serialization)
    this.registerElements([Card, Hand, Deck]);

    // Create game elements
    this.deck = this.create(Deck, 'deck');

    // Set up initial state
    this.deck.shuffle();
    for (const player of this.players) {
      // Deal cards...
    }

    // Register player actions
    this.registerAction(createDrawAction(this));
    this.registerAction(createPlayAction(this));

    // Set up game flow
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }

  override getWinners(): MyPlayer[] {
    // Return winning player(s)
  }
}
```

### Element Classes (src/rules/elements.ts)

Elements are the building blocks of your game state. BoardSmith provides base classes:

- **Space** - Containers that hold other elements
  - **Deck** - Stackable card pile (can shuffle)
  - **Hand** - Player's private cards
  - **Grid** - Square grid (e.g., chess board)
  - **HexGrid** - Hexagonal grid
- **Piece** - Physical game pieces
- **Card** - Playing cards

```typescript
import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck } from 'boardsmith';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | ... | 'K';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
}

export class Hand extends BaseHand {}
export class Deck extends BaseDeck {}
```

### Actions (src/rules/actions.ts)

Actions define what players can do. Use the fluent builder API:

```typescript
import { Action, type ActionDefinition } from 'boardsmith';

export function createPlayAction(game: MyGame): ActionDefinition {
  return Action.create('play')
    .prompt('Play a card from your hand')
    .chooseFrom<Card>('card', {
      prompt: 'Select a card to play',
      choices: (ctx) => [...ctx.player.hand.all(Card)],
    })
    .execute((args, ctx) => {
      const card = args.card as Card;
      card.remove();
      ctx.player.score += 1;
      return { success: true };
    });
}
```

### Flow (src/rules/flow.ts)

The flow defines turn structure and game phases:

```typescript
import { loop, eachPlayer, actionStep, sequence, type FlowDefinition } from 'boardsmith';

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: eachPlayer({
        name: 'player-turns',
        do: sequence(
          actionStep({ actions: ['draw'] }),
          actionStep({ actions: ['play'] }),
        ),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### UI (src/ui/App.vue)

The UI uses Vue 3 and the `boardsmith/ui` package:

```vue
<template>
  <GameShell
    game-type="my-game"
    display-name="My Game"
    :player-count="2"
  >
    <template #game-board="{
      gameView,
      playerPosition,
      isMyTurn,
      availableActions,
      actionArgs,
      actionController,
      setBoardPrompt
    }">
      <GameTable
        :game-view="gameView"
        :player-position="playerPosition"
        :is-my-turn="isMyTurn"
        :available-actions="availableActions"
        :action-args="actionArgs"
        :action-controller="actionController"
        :set-board-prompt="setBoardPrompt"
      />
    </template>
  </GameShell>
</template>
```

The `actionController` is the recommended way to handle actions from custom UIs. See [UI Components](./ui-components.md#action-controller-api) for the full API.

## Important: Read Before You Start

Before diving into implementation, read [Common Pitfalls](./common-pitfalls.md) to avoid these critical issues:

1. **Object Reference Comparison** - Never use `.includes(element)` or `===` to compare elements. Always use `.some(e => e.id === element.id)` or `element.equals(other)`.

2. **Multi-Step Selection Filters** - When action B depends on selection A, handle `undefined` in your filter for availability checks.

3. **Dead Elements in Collections** - Element queries return all elements including "dead" ones. Filter explicitly with `.filter(e => !e.isDead)`.

These issues cause silent failures that are hard to debug. Five minutes reading the pitfalls guide will save hours of debugging.

## Next Steps

- **Start here**: [Common Pitfalls](./common-pitfalls.md) - Critical issues to avoid
- Read [Core Concepts](./core-concepts.md) to understand elements, actions, and commands
- Learn about [Actions & Flow](./actions-and-flow.md) for complex game logic
- Explore [UI Components](./ui-components.md) for building custom UIs
- See [Game Examples](./game-examples.md) for real implementations

## Example Games

BoardSmith includes several example games in `packages/games/`:

| Game | Complexity | Key Features |
|------|-----------|--------------|
| **Hex** | Simple | Hex grid, path-finding win condition |
| **Go Fish** | Medium | Cards, hidden information, player interaction |
| **Checkers** | Medium | Square grid, multi-step moves, piece promotion |
| **Cribbage** | Complex | Multi-phase flow, simultaneous actions, scoring |

Study these to learn common patterns and best practices.
