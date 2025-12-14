# Core Concepts

This document explains the fundamental concepts and architecture of BoardSmith.

## Overview

BoardSmith uses a hierarchical element tree to represent game state, with a clear separation between:
- **Actions** (what players do) - high-level, game-specific
- **Commands** (how state changes) - low-level, generic, event-sourced

## Element Tree

Games are represented as a tree of `GameElement` objects:

```
Game (root)
├── Board/Grid/Deck (Spaces - containers)
│   ├── Piece/Card (game pieces)
│   └── More spaces...
├── Player Hands (Spaces)
└── Pile (removed elements)
```

### Element Types

| Class | Purpose | Example |
|-------|---------|---------|
| `GameElement` | Base class (never instantiate directly) | - |
| `Space` | Container for other elements | Board, pile, zone |
| `Deck` | Stack of cards (shuffleable) | Draw pile, discard |
| `Hand` | Player's private cards | Player's hand |
| `Grid` | Square grid | Chess/checkers board |
| `HexGrid` | Hexagonal grid | Hex game board |
| `Piece` | Physical game piece | Checker, stone |
| `Card` | Playing card | Standard deck card |

### Creating Elements

Elements are created as children of other elements:

```typescript
// In your Game constructor
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options) {
    super(options);

    // Register element classes (required for serialization)
    this.registerElements([Card, Hand, Deck, Board]);

    // Create elements as children of the game
    this.deck = this.create(Deck, 'deck');
    this.board = this.create(Board, 'board');

    // Create cards inside the deck
    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }
  }
}
```

### Element Operations

```typescript
// Query elements
const card = deck.first(Card);              // First card
const cards = deck.all(Card);               // All cards
const count = deck.count(Card);             // Count cards
const aceOfSpades = deck.first(Card, c => c.rank === 'A' && c.suit === 'S');

// Move elements
card.putInto(hand);                         // Move card to hand
card.putInto(hand, { position: 'first' }); // Put at beginning

// Remove elements
card.remove();                              // Remove from game

// Create elements
const stone = cell.create(Stone, 'stone-1', { player });

// Shuffle (Deck only)
deck.shuffle();

// Element ordering
deck.setOrder('stacking');                  // Last in, first out
```

### Custom Element Classes

Extend base classes to add game-specific properties:

```typescript
// elements.ts
import { Card as BaseCard, Piece as BasePiece } from '@boardsmith/engine';

export class Card extends BaseCard {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string;

  get value(): number {
    const values: Record<string, number> = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
    return values[this.rank] ?? parseInt(this.rank);
  }
}

export class CheckerPiece extends BasePiece {
  player!: CheckersPlayer;
  isKing: boolean = false;

  promote(): void {
    this.isKing = true;
  }
}
```

## Visibility System

Control what each player can see.

### Element Visibility

```typescript
// Make contents visible to everyone
deck.contentsVisible();

// Hide contents from everyone
deck.contentsHidden();

// Only owner can see contents
hand.contentsVisibleToOwner();
```

### Attribute Visibility

Use static `visibleAttributes` to control which attributes are visible:

```typescript
class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
  secretValue!: number;  // Hidden from players

  // Only suit and rank are visible in hidden contexts
  static visibleAttributes = ['suit', 'rank'];
}
```

## Actions vs Commands

BoardSmith separates player intent from state mutations.

### Actions (High-Level)

Actions are what players do - game-specific operations with prompts, selections, and validation:

```typescript
const moveAction = Action.create('move')
  .prompt('Move a piece')
  .chooseElement('piece', { filter: p => p.player === ctx.player })
  .chooseElement('destination', { filter: c => c.isEmpty() })
  .execute((args, ctx) => {
    args.piece.putInto(args.destination);  // Generates MoveCommand
  });
```

### Commands (Low-Level)

Commands are generic state mutations that happen automatically when you call element methods:

| Element Method | Generated Command |
|---------------|-------------------|
| `parent.create(Class, name, attrs)` | `CreateElementCommand` |
| `element.putInto(target)` | `MoveCommand` |
| `element.remove()` | `RemoveCommand` |
| `deck.shuffle()` | `ShuffleCommand` |
| `element.setAttribute(key, value)` | `SetAttributeCommand` |
| `element.contentsVisible()` | `SetVisibilityCommand` |

### Why This Matters

1. **Event Sourcing**: Commands form a replayable event log
2. **Undo/Redo**: Actions can be undone by reversing commands
3. **Networking**: Only commands are sent over the network
4. **Security**: Players can't directly manipulate state
5. **Debugging**: Full history of what happened

### Best Practices

```typescript
// DO: Use element methods in action execute functions
.execute((args, ctx) => {
  card.putInto(hand);
  player.score += 10;
});

// DON'T: Try to create commands manually
// DON'T: Bypass actions for player operations
```

## Player System

### Custom Player Classes

```typescript
export class MyPlayer extends Player<MyGame, MyPlayer> {
  hand!: Hand;
  score: number = 0;
  abilities: Record<string, number> = { reroll: 1 };

  constructor(position: number, name: string, game: MyGame) {
    super(position, name);
    this.game = game;

    // Create player's hand
    this.hand = game.create(Hand, `hand-${position}`);
    this.hand.player = this;
    this.hand.contentsVisibleToOwner();
  }

  // IMPORTANT: Override toJSON() to include custom properties in network state
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      score: this.score,
      abilities: this.abilities,
    };
  }
}
```

> **Important**: If your custom Player class has properties that need to be visible to the UI (like `score`, `abilities`, custom stats), you **must** override `toJSON()` to include them. The base `Player.toJSON()` only serializes `position`, `name`, `color`, and `avatar`.

### Player Properties

- `position`: 0-indexed player position
- `name`: Display name
- `game`: Reference to the game instance

### Accessing Players

```typescript
// In game class
this.players                    // All players array
this.players[0]                 // First player
this.currentPlayer              // Player whose turn it is

// In action context
ctx.player                      // Current action's player
```

## Game State Serialization

BoardSmith automatically handles serialization for:
- Network transmission
- State persistence
- Replays

### PlayerCollection Serialization Warning

`game.players` is a `PlayerCollection` (an Array subclass), not a plain Array. This has important implications when working with player data:

```typescript
// ❌ WRONG: Returns a PlayerCollection, not a plain Array
// When JSON.stringify() is called, PlayerCollection.toJSON() re-serializes
// the elements, losing any custom properties
const playerData = game.players.map(p => p.toJSON());

// ✅ CORRECT: Spread to convert to plain Array
const playerData = [...game.players.map(p => p.toJSON())];

// ✅ ALSO CORRECT: Use Array.from()
const playerData = Array.from(game.players.map(p => p.toJSON()));
```

This is a JavaScript quirk: when you call `.map()` on an Array subclass, the result is an instance of the same subclass, not a plain Array. The `PlayerCollection.toJSON()` method then gets called during serialization, which re-processes the already-serialized data.

### Registering Elements

All custom element classes must be registered:

```typescript
this.registerElements([Card, Hand, Deck, Board, Piece]);
```

### State Snapshots

```typescript
// Get complete state snapshot
const snapshot = game.getSnapshot();

// Get player-specific view (with visibility applied)
const playerView = game.getPlayerView(playerPosition);
```

### Player Views

Each player receives a filtered view of the game state:
- Hidden elements show only `visibleAttributes`
- Private zones of other players are hidden
- Server-side information is stripped

## Game Lifecycle

```
1. Constructor
   - Register elements
   - Create initial state
   - Register actions
   - Set flow

2. setup() - Called after constructor
   - Additional initialization

3. start() - Game begins
   - Flow starts executing
   - Players take actions

4. isFinished() returns true
   - Game ends
   - getWinners() called
```

## Example: Hex Game

A minimal but complete example from `packages/games/hex/`:

```typescript
// game.ts
export class HexGame extends Game<HexGame, HexPlayer> {
  board!: Board;
  winner?: HexPlayer;

  constructor(options: HexOptions) {
    super(options);

    this.registerElements([Board, Cell, Stone]);

    // Create hex board
    this.board = this.create(Board, 'board', { boardSize: 7 });
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 7; q++) {
        this.board.create(Cell, `cell-${q}-${r}`, { q, r });
      }
    }

    this.registerAction(createPlaceStoneAction(this));
    this.setFlow(createHexFlow(this));
  }

  override isFinished(): boolean {
    return !!this.winner;
  }

  override getWinners(): HexPlayer[] {
    return this.winner ? [this.winner] : [];
  }
}
```

## Related Documentation

- [Actions & Flow](./actions-and-flow.md) - Deep dive on actions and game flow
- [UI Components](./ui-components.md) - Building game UIs
- [Game Examples](./game-examples.md) - Real game implementations
