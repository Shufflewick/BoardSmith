# @boardsmith/engine

Core game engine for BoardSmith. Provides the element system, actions, flow control, and command execution.

## Installation

```bash
npm install @boardsmith/engine
```

## Core Concepts

### Element System

Build your game state as a tree of elements:

```typescript
import { Game, Card, Deck, Hand, Space, Piece } from '@boardsmith/engine';

class MyGame extends Game {
  deck: Deck<PlayingCard>;
  players: PlayerCollection<MyPlayer>;

  constructor(options: GameOptions) {
    super(options);

    // Register custom element classes for serialization
    this.registerElements([PlayingCard, MyPlayer]);

    // Create element tree
    this.deck = this.create(Deck, 'deck');
    this.deck.createMany(52, PlayingCard, 'card', (i) => ({
      suit: ['hearts', 'diamonds', 'clubs', 'spades'][Math.floor(i / 13)],
      rank: (i % 13) + 1,
    }));
  }
}
```

### Element Types

| Type | Description |
|------|-------------|
| `Game` | Root element, contains all game state |
| `Space` | Container for other elements (board regions, zones) |
| `Piece` | Movable game pieces |
| `Card` | Card elements with flip states |
| `Deck` | Ordered stack of cards with shuffle/draw |
| `Hand` | Player's hand of cards |
| `Die` | Rollable die with configurable sides |
| `DicePool` | Collection of dice |
| `Grid` | 2D grid of cells |
| `HexGrid` | Hexagonal grid |

### Element Comparison

**Important**: Always compare elements by ID, not reference:

```typescript
// WRONG - may fail due to serialization
if (myCards.includes(selectedCard)) { ... }

// CORRECT - compare by ID
if (myCards.some(c => c.id === selectedCard.id)) { ... }

// CORRECT - use built-in helpers
if (selectedCard.equals(otherCard)) { ... }
if (myCards.contains(selectedCard)) { ... }
```

## Actions

Define player actions with the Action builder:

```typescript
import { Action } from '@boardsmith/engine';

const playCard = Action.create<MyGame>('playCard')
  .chooseElement<PlayingCard>('card', {
    prompt: 'Choose a card to play',
    from: (ctx) => ctx.player.hand.all(PlayingCard),
    filter: (card, ctx) => card.isPlayable(),
  })
  .execute((args, ctx) => {
    const card = args.card as PlayingCard;
    card.moveTo(ctx.game.discardPile);
    ctx.player.score += card.value;
  });
```

### Selection Types

- `chooseElement<T>()` - Select a game element
- `chooseFrom()` - Select from a list of choices
- `chooseNumber()` - Select a number in a range
- `chooseText()` - Free text input

### Multi-Step Selections

When filters depend on previous selections, handle the undefined case:

```typescript
Action.create('move')
  .chooseElement<Piece>('piece', { ... })
  .chooseElement<Cell>('destination', {
    filter: (cell, ctx) => {
      const piece = ctx.args?.piece as Piece | undefined;
      if (!piece) {
        // Availability check - return true if ANY piece can reach this cell
        return getAllPieces(ctx).some(p => p.canMoveTo(cell));
      }
      // Actual selection - filter based on selected piece
      return piece.canMoveTo(cell);
    }
  })
```

Or use the `dependentFilter` helper:

```typescript
import { dependentFilter } from '@boardsmith/engine';

.chooseElement<Cell>('destination', {
  filter: dependentFilter({
    dependsOn: 'piece',
    whenUndefined: (cell, ctx) => getAllPieces(ctx).some(p => p.canMoveTo(cell)),
    whenSelected: (cell, piece, ctx) => piece.canMoveTo(cell),
  })
})
```

## Flow Control

Define game structure with flow nodes:

```typescript
import {
  defineFlow, sequence, phase, loop, eachPlayer,
  actionStep, execute, TurnOrder
} from '@boardsmith/engine';

export const flow = defineFlow(
  sequence(
    phase('setup', {
      do: execute((ctx) => {
        ctx.game.deck.shuffle();
        for (const player of ctx.game.players) {
          ctx.game.deck.deal(player.hand, 5);
        }
      }),
    }),

    phase('play', {
      do: loop({
        while: (ctx) => !ctx.game.isGameOver(),
        maxIterations: 1000,
        do: eachPlayer({
          ...TurnOrder.DEFAULT,
          do: actionStep({ actions: ['playCard', 'draw', 'pass'] }),
        }),
      }),
    }),

    execute((ctx) => ctx.game.declareWinner()),
  )
);
```

### Flow Nodes

| Node | Description |
|------|-------------|
| `sequence()` | Execute nodes in order |
| `phase()` | Named game phase |
| `loop()` | Repeat while condition is true |
| `repeat()` | Repeat a fixed number of times |
| `turnLoop()` | Simplified action loop with auto game.isFinished() check |
| `eachPlayer()` | Iterate through players |
| `forEach()` | Iterate through elements |
| `actionStep()` | Wait for player action |
| `simultaneousActionStep()` | All players act at once |
| `switchOn()` | Branch based on value |
| `ifThen()` | Conditional execution |
| `execute()` | Run code immediately |

### turnLoop

A simplified loop for turn-based action sequences. Automatically checks `game.isFinished()` and reduces boilerplate for common turn loop patterns:

```typescript
// Instead of this verbose pattern:
loop({
  while: (ctx) => {
    if (ctx.game.isFinished()) return false;
    const player = ctx.player as MyPlayer;
    return player.actionsRemaining > 0;
  },
  maxIterations: 30,
  do: actionStep({ actions: ['move', 'attack', 'endTurn'] }),
})

// Use turnLoop:
turnLoop({
  actions: ['move', 'attack', 'endTurn'],
  while: (ctx) => (ctx.player as MyPlayer).actionsRemaining > 0,
  maxIterations: 30,
})
```

### Turn Order

Use `TurnOrder` presets for common patterns:

```typescript
eachPlayer({
  ...TurnOrder.LEFT_OF_DEALER(ctx => ctx.game.dealerPosition),
  ...TurnOrder.SKIP_IF(player => player.hasFolded),
  do: actionStep({ actions: ['bet', 'fold'] }),
})
```

## Commands

The engine uses event sourcing. All state changes go through commands:

```typescript
// In action execute:
ctx.game.deck.shuffle();  // Generates ShuffleCommand
card.moveTo(player.hand); // Generates MoveCommand
card.flip();              // Generates SetAttributeCommand
```

Commands are automatically generated and can be replayed for undo/redo.

## Visibility

Control what players can see:

```typescript
// Card is visible only to its owner
card.showOnlyTo(player);

// Card is visible to everyone
card.showToAll();

// Card is hidden from everyone
card.hide();
```

## API Reference

### Game

```typescript
class Game extends GameElement {
  players: PlayerCollection;
  phase?: string;
  finished: boolean;

  registerElements(classes: ElementClass[]): void;
  getElementById(id: number): GameElement | undefined;
  atBranch(path: string): GameElement | undefined;
  finish(winners?: Player[]): void;
}
```

### GameElement

```typescript
class GameElement {
  id: number;            // Unique identifier
  name: string;          // Element name
  game: Game;            // Root game reference
  parent?: GameElement;  // Parent in tree

  create<T>(Class, name, attrs?): T;
  createMany<T>(count, Class, name, attrs?): ElementCollection<T>;
  all<T>(Class?): ElementCollection<T>;
  first<T>(Class?): T | undefined;
  count(Class?): number;

  moveTo(destination: GameElement): void;
  remove(): void;

  equals(other: GameElement): boolean;
  hasId(id: number): boolean;
}
```

### ElementCollection

```typescript
class ElementCollection<T> extends Array<T> {
  first(): T | undefined;
  last(): T | undefined;
  random(): T | undefined;
  shuffle(): this;

  contains(element: GameElement): boolean;
  findById(id: number): T | undefined;
  hasId(id: number): boolean;
  indexOfElement(element: GameElement): number;
}
```

## See Also

- [Getting Started Guide](../../docs/getting-started.md)
- [Common Pitfalls](../../docs/common-pitfalls.md)
- [Common Patterns](../../docs/common-patterns.md)
- [Actions & Flow](../../docs/actions-and-flow.md)
