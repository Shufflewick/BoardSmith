# Core Concepts

This document explains the fundamental concepts and architecture of BoardSmith.

## Overview

BoardSmith uses a hierarchical element tree to represent game state, with a clear separation between:
- **Actions** (what players do) - high-level, game-specific, defined with `Action.create(...)`
- **Element mutation** (how state changes) - direct property/tree mutation inside an action's `execute` callback; there is no generic replayable command layer

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
import { Card as BaseCard, Piece as BasePiece } from 'boardsmith';

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

`static visibleAttributes` whitelists which attributes of an element are sent
to non-owners (players other than the element's effective owner, and
spectators). When declared, every attribute NOT in the list is redacted from
the game view for everyone except the owner. When left `undefined` (the
default), every attribute stays visible to everyone — this is public-by-default,
so existing custom attributes keep working with zero configuration.

```typescript
class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
  secretValue!: number;  // Redacted from non-owners' game view

  // Non-owners only ever see suit and rank; secretValue is stripped server-side
  static visibleAttributes = ['suit', 'rank'];
}
```

This is attribute-level redaction, not element-level hiding — the element
itself (and its whitelisted attributes) is still present in the view. To hide
an entire element or an entire zone's contents, use the element/zone
visibility controls below instead.

## Actions and State Mutation

BoardSmith separates player intent (actions) from state mutation (direct
element-tree writes). There is no generic replayable command layer between them.

### Actions (High-Level)

Actions are what players do - game-specific operations with prompts, selections, and validation:

```typescript
const moveAction = Action.create('move')
  .prompt('Move a piece')
  .chooseElement('piece', { filter: p => p.player === ctx.player })
  .chooseElement('destination', { filter: c => c.isEmpty() })
  .execute((args, ctx) => {
    args.piece.putInto(args.destination);  // Mutates the tree directly
  });
```

### State Mutation (Direct, Not Command-Based)

Element methods like `putInto()`, `remove()`, `shuffle()`, and property
assignment (`player.score += 10`) mutate the live element tree directly and
record nothing. There is no per-operation generated-object layer behind them,
and elements have no generic attribute-setter method — assign properties
directly instead (e.g. `card.faceUp = true`).

`Game#commandHistory` exists, but it is populated ONLY through
`Game#execute()`, an internal mechanism the engine uses for its own ANIMATE
event stream (see `game.ts`'s `execute()`/`replayCommands()`). Game rule code
never calls it and should not rely on it — it is not a general-purpose audit
log or replay mechanism for game state.

### How State Actually Travels: Snapshots, Not Replay

BoardSmith is **state-authoritative**: the source of truth is the current
element tree, not a log of operations that produced it.

- **Networking**: Each player receives a filtered JSON view (`createPlayerView`)
  derived from the live tree, not a stream of commands.
- **Persistence / restore**: `runner.fromSnapshot()` restores a game directly
  from a captured snapshot (tree state + flow state + RNG state) — it does
  NOT replay commands or actions to rebuild state. This is deliberate: replaying
  an incomplete or ambiguous history was a real source of bugs in earlier
  designs (mis-positioned flow state on restore).
- **Undo**: Undo/redo, where supported, works from captured snapshots of prior
  states, not by reversing a command log.
- **Security**: Direct manipulation is prevented because players only ever
  call actions (validated, server-side) — never touch element methods
  themselves — not because of a command-layer indirection.

### Best Practices

```typescript
// DO: Mutate elements directly inside action execute functions
.execute((args, ctx) => {
  card.putInto(hand);
  player.score += 10;
});

// DON'T: Bypass actions for player-driven operations
// DON'T: Rely on commandHistory as a game-logic audit trail
```

## Player System

### Custom Player Classes

```typescript
// Declare extra fields with initializers — do NOT define a constructor.
// The engine instantiates players from `playerCount`, so a custom Player
// just adds the per-player state it needs.
export class MyPlayer extends Player<MyGame, MyPlayer> {
  hand!: Hand;                                          // Assigned in the Game constructor
  score: number = 0;                                    // Auto-serialized to gameView
  abilities: Record<string, number> = { reroll: 1 };   // Auto-serialized
}
```

Player-owned elements (like each player's `hand`) are created in the **Game** constructor, which loops over the already-instantiated `this.players`:

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options: GameOptions) {
    super(options);

    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`);
      player.hand.player = player;
      player.hand.contentsVisibleToOwner();
    }
  }
}
```

> **Auto-serialization**: Public properties (like `score`, `abilities`) are automatically included in the game view sent to the UI. You do NOT need to override `toJSON()` for simple properties. Properties starting with `_` are private and not serialized.

### Player Properties

- `seat`: 1-indexed seat number (Player 1 has seat 1)
- `name`: Display name
- `game`: Reference to the game instance

### Accessing Players

```typescript
// In game class
this.players                    // Array of all players
this.getPlayer(1)               // First player (by seat, 1-indexed)
this.getPlayer(2)               // Second player
this.currentPlayer              // Player whose turn it is

// In action context
ctx.player                      // Current action's player
ctx.game.currentPlayer          // Current player from game
```

### Player Colors

Players automatically receive a `color` property from the engine's color palette:

```typescript
// In rules code
const myColor = player.color;  // '#e74c3c'

// In UI via gameView
const playerColor = gameView.players[playerSeat - 1].color;
```

The engine assigns colors from `DEFAULT_COLOR_PALETTE` based on seat order. It holds 16
entries — the maximum seat count any BoardSmith host supports — so a game never has to
supply its own palette just to reach a higher player count. To customize:

```typescript
export const gameDefinition = {
  // Custom color palette (optional)
  colors: ['#ff0000', '#0000ff', '#00ff00'],

  // Disable color selection in lobby (optional, default: true)
  colorSelectionEnabled: false,
};
```

When `colorSelectionEnabled` is true (the default), players can choose their color in the lobby and the UI automatically shows a color picker.

## Game State Serialization

BoardSmith automatically handles serialization for:
- Network transmission
- State persistence
- Replays

### Registering Elements

All **custom** element classes must be registered:

```typescript
this.registerElements([Card, Hand, Deck, Board, Piece]);
```

Built-in framework classes (`Die`, `Card`, `Piece`, `Hand`, `Deck`, `DicePool`,
`Grid`, `HexGrid`, ...) are auto-registered — you never need to list them
yourself, and polymorphic queries against a built-in base class (e.g.
`dicePool.all(Die)`) work without registration. You only register classes
*you* define, including subclasses of a built-in (e.g. `class IngredientDie
extends Die`). `startFlow()` validates this for you: if your flow queries an
element class that was never registered, it throws with the exact
`registerElements([...])` call to add. See
[Common Pitfalls #7](./common-pitfalls.md#7-element-class-registration).

### State Snapshots

Use utility functions from `boardsmith` for state snapshots:

```typescript
import { createSnapshot, createPlayerView } from 'boardsmith';

// Get complete state snapshot
const snapshot = createSnapshot(game, 'my-game');

// Get player-specific view (with visibility applied)
const playerView = createPlayerView(game, playerSeat);
```

### Player Views

Each player receives a filtered view of the game state:
- Elements inside hidden zones are redacted to a minimal shape (id/className +
  safe layout attributes only); non-owners never see their real attributes
- A declared `static visibleAttributes` whitelist further redacts individual
  attributes on visible elements for non-owners (see Attribute Visibility above)
- Private zones of other players are hidden via `contentsHidden()` /
  `contentsVisibleToOwner()`
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

## Game Definition Metadata

Games export a `gameDefinition` object that describes the game to the framework. This metadata enables:
- Game registration and identification
- bot configuration
- Quick-start presets

Lobby configuration (game options, player options, color palettes) is defined in `boardsmith.json`, not in the game definition. This ensures a single source of truth that both the dev server and the platform read from.

### Basic Structure

```typescript
// index.ts
export const gameDefinition = {
  gameClass: MyGame,
  gameType: 'my-game',
  displayName: 'My Game',
  minPlayers: 2,
  maxPlayers: 4,
  bot: {
    objectives: getMyGameObjectives,  // Optional bot support
  },
  presets: [ /* ... */ ],             // Optional quick-start presets
};
```

### Lobby Options (boardsmith.json)

Game options, player options, and color palettes are defined in `boardsmith.json`. The dev server reads these and injects them into the game definition automatically.

#### Game Options

Game-level configuration options that appear in the lobby. Defined as an array with `id` as the key field.

```json
{
  "gameOptions": [
    {
      "id": "boardSize",
      "type": "number",
      "label": "Board Size",
      "description": "Number of hexes per side",
      "min": 5,
      "max": 19,
      "step": 1,
      "default": 11
    },
    {
      "id": "variant",
      "type": "select",
      "label": "Game Variant",
      "choices": [
        { "value": "standard", "label": "Standard" },
        { "value": "speed", "label": "Speed Mode" }
      ],
      "default": "standard"
    },
    {
      "id": "allowUndo",
      "type": "boolean",
      "label": "Allow Undo",
      "default": true
    }
  ]
}
```

Option types: `number` (with min/max/step), `select` (with choices), `boolean`.

#### Player Options

Per-player settings that appear for each player slot in the lobby.

```json
{
  "playerOptions": [
    {
      "id": "role",
      "type": "select",
      "label": "Role",
      "choices": [
        { "value": "attacker", "label": "Attacker" },
        { "value": "defender", "label": "Defender" }
      ],
      "default": "attacker"
    }
  ]
}
```

#### Color Palette

Custom player colors for the color picker. If omitted, the standard 8-color palette is used.

```json
{
  "colorPalette": [
    { "hex": "#e74c3c", "label": "Red" },
    { "hex": "#3498db", "label": "Blue" },
    { "hex": "#27ae60", "label": "Green" }
  ]
}
```

Each entry needs a `hex` color value and a `label` for display. Plain hex strings are also accepted (e.g., `["#e74c3c", "#3498db"]`).

### Exclusive Player Options

For asymmetric games where exactly one player must have a specific role (e.g., 1 Dictator vs many Rebels), use the `exclusive` type in `playerOptions`:

```json
{
  "playerOptions": [
    {
      "id": "isDictator",
      "type": "exclusive",
      "label": "Dictator",
      "description": "Select which player is the dictator",
      "default": "last"
    }
  ]
}
```

The `default` field accepts `"first"`, `"last"`, or a player index number.

### Presets

Quick-start configurations for common game setups.

```typescript
presets: [
  {
    name: 'Quick Game',
    description: '7x7 board',
    options: { boardSize: 7 },
    players: [
      { color: '#e74c3c' },
      { color: '#3498db' },
    ],
  },
  {
    name: 'vs bot',
    description: 'Play against bot',
    options: { boardSize: 9 },
    players: [
      { isBot: false, color: '#e74c3c' },
      { isBot: true, botLevel: 'medium', color: '#3498db' },
    ],
  },
]
```

### Receiving Options in Game Constructor

Options are passed to your game constructor via `CreateGameRequest`:

```typescript
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  gameOptions?: Record<string, unknown>;    // From gameOptions
  playerConfigs?: PlayerConfig[];           // From playerOptions
  botPlayers?: number[];
  botLevel?: string;
}

// In your game
class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options: MyGameOptions) {
    super(options);

    // Access game options
    const boardSize = options.boardSize ?? 11;

    // Access player configs (players are 1-indexed)
    for (const player of this.players) {
      const config = options.playerConfigs?.[player.seat - 1];  // configs array is 0-indexed
      if (config?.color) {
        player.color = config.color;
      }
    }
  }
}
```

## Example: Hex Game

A minimal but complete example from Hex:

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
- [Nomenclature](./nomenclature.md) - Standard terminology reference
