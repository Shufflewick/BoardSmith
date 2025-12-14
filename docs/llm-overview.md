# BoardSmith LLM Overview

This document provides a comprehensive overview of the BoardSmith framework optimized for LLM consumption. Use this to quickly understand the project architecture and key patterns.

## What is BoardSmith?

BoardSmith is a TypeScript framework for building turn-based multiplayer board and card games. It provides:

- **Element-based state management** - Games are trees of typed elements (Board, Deck, Hand, Piece, Card)
- **Declarative flow system** - Define game structure with composable flow nodes
- **Action builder API** - Fluent API for defining player actions with selections and validation
- **Event-sourced commands** - All state mutations are tracked and replayable
- **Automatic UI generation** - AutoUI can render any game without custom components
- **MCTS AI** - Game-agnostic AI opponents using Monte-Carlo Tree Search
- **Multiplayer networking** - WebSocket-based real-time game sessions

## Project Structure

```
BoardSmith/
├── packages/
│   ├── engine/       # Core framework (~15k lines)
│   ├── runtime/      # Game execution
│   ├── session/      # Session management
│   ├── ai/           # MCTS bot (~700 lines)
│   ├── ui/           # Vue 3 components (~15k lines)
│   ├── client/       # Browser networking
│   ├── server/       # Platform-agnostic server
│   ├── worker/       # Cloudflare Workers runtime
│   ├── cli/          # Dev tools
│   ├── testing/      # Test utilities
│   └── games/        # Example games
│       ├── hex/      # Simplest example
│       ├── go-fish/  # Card game patterns
│       ├── checkers/ # Grid + multi-step
│       └── cribbage/ # Complex multi-phase
└── docs/             # Documentation
```

## Key Concepts

### 1. Element Tree

Games are represented as a tree of `GameElement` objects:

```
Game (root)
├── Board (Space)
│   └── Cell (Space) → Piece
├── Deck (Space) → Card, Card, ...
├── Hand (Space) → Card (owner sees)
└── Pile (removed elements)
```

**Element types**: `Space` (container), `Deck`, `Hand`, `Grid`, `HexGrid`, `Piece`, `Card`

### 2. Actions vs Commands

**Actions** = What players do (high-level, game-specific)
```typescript
Action.create('move')
  .chooseElement('piece', { filter: p => p.player === ctx.player })
  .chooseElement('dest', { filter: c => c.isEmpty() })
  .execute((args) => args.piece.putInto(args.dest));
```

**Commands** = How state changes (low-level, generic, event-sourced)
```typescript
// Generated automatically by element methods
{ type: 'move', elementId: 42, targetId: 17 }
```

### 3. Flow System

Declarative game flow with composable nodes:

```typescript
const flow: FlowDefinition = {
  root: loop({
    while: () => !game.isFinished(),
    do: eachPlayer({
      do: actionStep({ actions: ['move'] }),
    }),
  }),
  isComplete: () => game.isFinished(),
  getWinners: () => game.getWinners(),
};
```

**Flow nodes**: `sequence`, `loop`, `repeat`, `eachPlayer`, `forEach`, `actionStep`, `simultaneousActionStep`, `phase`, `switchOn`, `ifThen`, `execute`, `setVar`

### 4. Visibility System

Control what players can see:

```typescript
deck.contentsHidden();           // Hidden from all
hand.contentsVisibleToOwner();   // Only owner sees
board.contentsVisible();         // Everyone sees
```

## Creating a Game

### 1. Initialize Project

```bash
npx boardsmith init my-game
cd my-game
npm install
boardsmith dev
```

### 2. Define Elements

```typescript
// elements.ts
export class Card extends BaseCard {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string;
}
export class Hand extends BaseHand {}
export class Deck extends BaseDeck {}
```

### 3. Define Actions

```typescript
// actions.ts
export function createPlayAction(game: MyGame): ActionDefinition {
  return Action.create('play')
    .chooseFrom<Card>('card', {
      choices: (ctx) => [...ctx.player.hand.all(Card)],
    })
    .execute((args) => {
      const card = args.card as Card;
      card.remove();
      ctx.player.score += 1;
    });
}
```

### 4. Define Flow

```typescript
// flow.ts
export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      while: () => !game.isFinished(),
      do: eachPlayer({
        do: actionStep({ actions: ['play'] }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### 5. Game Class

```typescript
// game.ts
export class MyGame extends Game<MyGame, MyPlayer> {
  deck!: Deck;

  constructor(options: MyGameOptions) {
    super(options);
    this.registerElements([Card, Hand, Deck]);
    this.deck = this.create(Deck, 'deck');
    // ... setup ...
    this.registerAction(createPlayAction(this));
    this.setFlow(createGameFlow(this));
  }

  override isFinished(): boolean {
    return this.deck.count(Card) === 0;
  }
}
```

## Common Patterns

### Conditional Turns (Go Again)

```typescript
.execute((args, ctx) => {
  if (gotMatch) {
    return { success: true, data: { extraTurn: true } };
  }
  return { success: true, data: { extraTurn: false } };
});

// In flow
execute((ctx) => {
  if (!ctx.lastActionResult?.data?.extraTurn) {
    ctx.set('turnEnded', true);
  }
})
```

### Multi-Step Actions (Jump Chains)

```typescript
.execute((args, ctx) => {
  if (canContinueJumping) {
    game.pendingJumpPiece = piece;
    game.setPlayerGoesAgain(true);
  }
});
```

### Simultaneous Actions

```typescript
simultaneousActionStep({
  actions: ['discard'],
  playerDone: (ctx, player) => player.hand.count(Card) <= 4,
  allDone: (ctx) => game.allPlayersDiscarded(),
})
```

### Phase-Based Games

```typescript
sequence(
  phase('deal', { do: execute(() => game.deal()) }),
  phase('discard', { do: simultaneousActionStep({ actions: ['discard'] }) }),
  phase('play', { do: playLoop }),
  phase('score', { do: execute(() => game.score()) }),
)
```

## UI Components

**Core**: `GameShell`, `DebugPanel`, `PlayersPanel`, `GameHistory`

**Helpers**: `Draggable`, `DiceRoller`, `CardFan`, `DeckPile`, `FlyingCardsOverlay`

**Auto-UI**: `AutoUI`, `AutoGameBoard`, `AutoElement`, `ActionPanel`

**Composables**:
- `useBoardInteraction` - Board ↔ ActionPanel communication
- `useElementAnimation` - FLIP animations
- `useCardFlip`, `useFlyingCards` - Card animations
- `useGameViewHelpers` - Query game state
- `useGameGrid`, `useHexGrid` - Grid utilities
- `useCardDisplay` - Card formatting

## Dice & Scoring Systems

### Dice Elements

```typescript
// Die extends Piece with sides/value
class MyDie extends Die<MyGame, MyPlayer> {
  color?: 'red' | 'blue';
}

// DicePool is a Space for holding dice
this.shelf = this.create(DicePool, 'shelf');
this.shelf.create(MyDie, 'd6-1', { sides: 6 });
```

### Ability System

```typescript
import { AbilityManager } from '@boardsmith/engine';

type PowerUp = 'reroll' | 'flip' | 'bonus';

class MyPlayer extends Player<MyGame, MyPlayer> {
  abilities = new AbilityManager<PowerUp>();

  constructor() {
    this.abilities.add('reroll', 'starting');
  }
}

// Usage
if (player.abilities.hasUnused('reroll')) {
  player.abilities.use('reroll');
}
```

### Scoring Tracks

```typescript
import { MonotonicTrack, UniqueTrack, CounterTrack } from '@boardsmith/engine';

// Increasing/decreasing sequence tracks
const track = new MonotonicTrack({
  id: 'score',
  direction: 'increasing',  // or 'decreasing'
  maxEntries: 10,
  pointsPerEntry: [0, 1, 3, 6, 11, 16, 23, 30, 40, 50],
});

track.canAdd(15);   // Check if value fits sequence
track.add(15);      // Add value, returns points earned

// Simple counter tracks
const counter = new CounterTrack({
  id: 'bonus',
  maxEntries: 6,
  pointsPerCount: 10,
});

counter.increment();
counter.calculatePoints();  // Returns total points
```

## AI System

```typescript
import { createBot } from '@boardsmith/ai';

const bot = createBot(game, MyGame, 'my-game', 1, [], 'hard');
const move = await bot.play();
```

**Difficulty levels**: `easy` (3 iter), `medium` (5 iter), `hard` (8 iter)

**Custom objectives** for better play:
```typescript
const aiConfig = {
  objectives: (game, playerIndex) => ({
    materialAdvantage: {
      checker: (g, p) => myPieces > oppPieces,
      weight: 0.5,
    },
  }),
};
```

## CLI Commands

```bash
boardsmith init <name>    # Create new game
boardsmith dev            # Start dev server
boardsmith dev --ai 1     # Player 1 is AI
boardsmith test           # Run tests
boardsmith validate       # Validate before publish
boardsmith build          # Production build
boardsmith publish        # Publish to boardsmith.io
```

## Example Games Reference

| Game | File | Key Patterns |
|------|------|--------------|
| Hex | `packages/games/hex/rules/src/` | Simple flow, hex grid, single action |
| Go Fish | `packages/games/go-fish/rules/src/` | Cards, hidden info, conditional turns |
| Checkers | `packages/games/checkers/rules/src/` | Grid, multi-step jumps, promotion |
| Cribbage | `packages/games/cribbage/rules/src/` | Multi-phase, simultaneous, scoring |
| Polyhedral Potions | `packages/games/polyhedral-potions/rules/src/` | Dice, 3D rendering, abilities, scoring tracks |

## Key Files to Understand

1. **Engine core**: `packages/engine/src/`
   - `game.ts` - Game base class
   - `element/` - Element system
   - `action/` - Action builder
   - `flow/` - Flow system
   - `command/` - Command types

2. **Example game**: `packages/games/hex/rules/src/`
   - `game.ts` - Minimal game class
   - `elements.ts` - Custom elements
   - `actions.ts` - Action definitions
   - `flow.ts` - Simple flow

3. **UI**: `packages/ui/src/`
   - `components/GameShell.vue` - Main wrapper
   - `composables/` - Reusable logic

## Architecture Summary

```
User Action → Action System → Commands → State Change
                ↑                           ↓
            Flow System ←──────── Game State ←── Serialization
                                     ↓
                              Player Views → UI Render
```

- **Actions** validate and execute player intent
- **Commands** are event-sourced state mutations
- **Flow** controls game structure and turn order
- **State** is an element tree, serializable to JSON
- **Player Views** filter state by visibility rules
- **UI** renders views and submits actions

## Common Pitfalls

### Custom Player Properties Not Showing in UI

If your custom Player class has properties (score, abilities, etc.) that aren't appearing in the UI, you need to override `toJSON()`:

```typescript
export class MyPlayer extends Player<MyGame, MyPlayer> {
  score: number = 0;
  abilities: Record<string, number> = { reroll: 1 };

  // REQUIRED: Include custom properties in serialization
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      score: this.score,
      abilities: this.abilities,
    };
  }
}
```

The base `Player.toJSON()` only serializes `position`, `name`, `color`, `avatar`.

### PlayerCollection Array Subclass Gotcha

`game.players` is a `PlayerCollection` (Array subclass). When mapping player data, **always spread to a plain Array**:

```typescript
// ❌ WRONG: map() returns PlayerCollection, which has its own toJSON()
const data = game.players.map(p => p.toJSON());

// ✅ CORRECT: Spread converts to plain Array
const data = [...game.players.map(p => p.toJSON())];
```

This is because JavaScript's `.map()` on an Array subclass returns an instance of the same subclass, and `PlayerCollection.toJSON()` will re-serialize the data, losing custom properties.

### chooseElement Args Are Objects, Not IDs

When using `chooseElement` in actions, the args passed to `execute()` contain the **full serialized element object**, not just the element ID:

```typescript
// ❌ WRONG: args.die is an object, not a number
.chooseElement<Die>('die', { ... })
.execute((args, ctx) => {
  const dieId = args.die as number;  // This is actually an object!
  const die = game.all(Die).find(d => d.id === dieId);  // Never finds it
});

// ✅ CORRECT: Extract the ID from the object
.execute((args, ctx) => {
  const dieId = typeof args.die === 'object' ? (args.die as any).id : args.die as number;
  const die = game.all(Die).find(d => d.id === dieId);
});
```

The args object looks like: `{ die: { className: "Die", id: 3, attributes: {...} } }`

### Action Closures and ctx.game

In action execute functions, always use `ctx.game` instead of a closure reference to the game:

```typescript
// ❌ WRONG: Closure reference can become stale
export function createMyAction(game: MyGame): ActionDefinition {
  return Action.create('myAction')
    .execute((args, ctx) => {
      game.doSomething();  // Uses closure - may be stale after hot-reload
    });
}

// ✅ CORRECT: Use ctx.game for the current game instance
export function createMyAction(game: MyGame): ActionDefinition {
  return Action.create('myAction')
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      currentGame.doSomething();  // Always uses current game
    });
}
```
