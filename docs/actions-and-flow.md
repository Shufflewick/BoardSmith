# Actions & Flow System

This document covers the Action builder API and the declarative Flow system for controlling game structure.

## Actions

Actions define what players can do during the game. They use a fluent builder pattern.

### Basic Action Structure

```typescript
import { Action, type ActionDefinition } from '@boardsmith/engine';

export function createMyAction(game: MyGame): ActionDefinition {
  return Action.create('actionName')
    .prompt('Description shown to player')
    .condition((ctx) => /* when this action is available */)
    .chooseFrom('selection', { /* selection options */ })
    .execute((args, ctx) => {
      // Game logic here
      return { success: true };
    });
}
```

### Selection Methods

#### `chooseFrom<T>` - Choose from a list

```typescript
Action.create('selectRank')
  .chooseFrom<string>('rank', {
    prompt: 'Choose a rank to ask for',
    choices: (ctx) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
  })
```

#### `chooseElement<T>` - Choose a game element

```typescript
Action.create('placeStone')
  .chooseElement<Cell>('cell', {
    prompt: 'Select an empty cell',
    elementClass: Cell,
    filter: (cell, ctx) => cell.isEmpty(),
    display: (cell) => cell.notation,        // Display text
    boardRef: (cell) => ({ id: cell.id }),   // For UI highlighting
  })
```

#### `choosePlayer` - Choose another player

```typescript
Action.create('askPlayer')
  .choosePlayer('target', {
    prompt: 'Who do you want to ask?',
    filter: (player, ctx) => player !== ctx.player,  // Not self
  })
```

#### `chooseNumber` - Enter a number

```typescript
Action.create('bid')
  .chooseNumber('amount', {
    prompt: 'Enter your bid',
    min: 1,
    max: (ctx) => ctx.player.coins,
  })
```

#### `chooseText` - Enter text

```typescript
Action.create('name')
  .chooseText('name', {
    prompt: 'Enter a name',
    maxLength: 20,
  })
```

### Chaining Selections

Actions can have multiple selections that depend on each other:

```typescript
Action.create('move')
  .chooseElement<Piece>('piece', {
    prompt: 'Select a piece to move',
    elementClass: Piece,
    filter: (p, ctx) => p.player === ctx.player,
  })
  .chooseElement<Cell>('destination', {
    prompt: 'Select destination',
    elementClass: Cell,
    // Filter depends on previously selected piece
    filter: (cell, ctx) => {
      const piece = ctx.args.piece as Piece;
      return piece.canMoveTo(cell);
    },
  })
```

### Conditions

Control when actions are available:

```typescript
Action.create('draw')
  .condition((ctx) => {
    // Only available when deck has cards
    return game.deck.count(Card) > 0;
  })
  .execute(...)
```

### Validation

Validate the complete action before execution:

```typescript
Action.create('play')
  .chooseFrom('cards', { choices: getPlayableCards, multi: true })
  .validate((args, ctx) => {
    const cards = args.cards as Card[];
    if (cards.length < 2) {
      return { valid: false, message: 'Must play at least 2 cards' };
    }
    return { valid: true };
  })
  .execute(...)
```

### Execute Function

The execute function performs the actual game logic:

```typescript
.execute((args, ctx) => {
  const player = ctx.player as MyPlayer;
  const card = args.card as Card;

  // Perform game actions (generates commands automatically)
  card.putInto(game.discardPile);
  player.score += card.value;

  // Add game message
  game.message(`${player.name} played ${card.name}`);

  // Return result
  return {
    success: true,
    message: 'Card played successfully',
    data: { cardId: card.id },
  };
});
```

> **Important:** When using `chooseElement`, the `args` contain the **full serialized element object**, not just the ID. To find the element by ID:
> ```typescript
> const elementId = typeof args.piece === 'object' ? (args.piece as any).id : args.piece;
> const piece = game.all(Piece).find(p => p.id === elementId);
> ```
> Also, always use `ctx.game` instead of a closure reference to the game variable in execute functions to avoid stale references during hot-reload.

### Action Options

```typescript
Action.create('move')
  .prompt('Move your piece')
  .notUndoable()                    // Cannot undo this action
  .skipIf((ctx) => /* condition */) // Skip if condition is true
```

### Example: Go Fish Ask Action

From `packages/games/go-fish/rules/src/actions.ts`:

```typescript
export function createAskAction(game: GoFishGame): ActionDefinition {
  return Action.create('ask')
    .prompt('Ask another player for a card')
    .choosePlayer('target', {
      prompt: 'Who do you want to ask?',
      filter: (p, ctx) => p !== ctx.player && p.hand.count(Card) > 0,
    })
    .chooseFrom<string>('rank', {
      prompt: 'What rank do you want?',
      choices: (ctx) => {
        const player = ctx.player as GoFishPlayer;
        const ranks = new Set<string>();
        for (const card of player.hand.all(Card)) {
          ranks.add(card.rank);
        }
        return [...ranks];
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as GoFishPlayer;
      const target = args.target as GoFishPlayer;
      const rank = args.rank as string;

      const matchingCards = target.hand.all(Card).filter(c => c.rank === rank);

      if (matchingCards.length > 0) {
        for (const card of matchingCards) {
          card.putInto(player.hand);
        }
        game.message(`${player.name} got ${matchingCards.length} ${rank}(s) from ${target.name}!`);
        game.setPlayerGoesAgain(true);
      } else {
        game.message(`${target.name} says "Go Fish!"`);
        game.setPlayerGoesAgain(false);
      }

      return { success: true };
    });
}
```

## Flow System

The Flow system defines game structure using composable nodes.

### Flow Definition

```typescript
import { loop, eachPlayer, actionStep, sequence, type FlowDefinition } from '@boardsmith/engine';

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: /* flow node */,
    isComplete: (ctx) => game.isFinished(),
    getWinners: (ctx) => game.getWinners(),
  };
}
```

### Flow Nodes

#### `sequence` - Run steps in order

```typescript
sequence(
  actionStep({ actions: ['draw'] }),
  actionStep({ actions: ['play'] }),
)
```

#### `loop` - Repeat while condition is true

```typescript
loop({
  name: 'game-loop',
  while: (ctx) => !game.isFinished(),
  maxIterations: 1000,  // Safety limit
  do: /* flow node */,
})
```

#### `repeat` - Fixed number of iterations

```typescript
repeat({
  name: 'deal-cards',
  times: 5,
  do: actionStep({ actions: ['deal'] }),
})
```

#### `eachPlayer` - Iterate over players

```typescript
eachPlayer({
  name: 'player-turns',
  order: TurnOrder.clockwise(),
  filter: (player, ctx) => !player.hasPassed,
  do: /* flow node */,
})
```

#### `forEach` - Iterate over array

```typescript
forEach({
  name: 'score-hands',
  collection: (ctx) => game.players,
  do: (player) => execute({
    do: () => game.scoreHand(player),
  }),
})
```

#### `actionStep` - Wait for player action

```typescript
actionStep({
  name: 'move-step',
  actions: ['move', 'jump'],      // Available actions
  prompt: 'Move or jump a piece',
  skipIf: (ctx) => game.isFinished(),
})
```

#### `simultaneousActionStep` - All players act at once

```typescript
simultaneousActionStep({
  name: 'discard-step',
  actions: ['discard'],
  prompt: 'Choose cards to discard',
})
```

#### `phase` - Named game phase

```typescript
phase('setup', {
  do: sequence(
    execute({ do: () => game.deal() }),
    simultaneousActionStep({ actions: ['discard'] }),
  ),
})
```

#### `switchOn` - Conditional branching

```typescript
switchOn({
  value: (ctx) => game.currentPhase,
  cases: {
    'deal': /* flow node */,
    'play': /* flow node */,
    'score': /* flow node */,
  },
  default: /* flow node */,
})
```

#### `ifThen` - If-else logic

```typescript
ifThen({
  if: (ctx) => game.deck.count(Card) > 0,
  then: actionStep({ actions: ['draw'] }),
  else: execute({ do: () => game.endRound() }),
})
```

#### `execute` - Run code

```typescript
execute({
  name: 'shuffle-deck',
  do: (ctx) => {
    game.deck.shuffle();
    game.message('Deck shuffled!');
  },
})
```

#### `setVar` - Set flow variable

```typescript
setVar({
  name: 'roundNumber',
  value: (ctx) => (ctx.vars.roundNumber ?? 0) + 1,
})
```

### Turn Order

Control player order with `TurnOrder`:

```typescript
eachPlayer({
  order: TurnOrder.roundRobin(),       // Default: 0, 1, 2, ...
  order: TurnOrder.clockwise(),        // Same as roundRobin
  order: TurnOrder.counterClockwise(), // Reverse
  order: TurnOrder.custom((players, ctx) => {
    // Return players in custom order
    return players.sort((a, b) => a.score - b.score);
  }),
})
```

### Flow Variables

Access and set variables during flow:

```typescript
// Set variable
setVar({ name: 'dealer', value: (ctx) => ctx.players[0] })

// Access in conditions
loop({
  while: (ctx) => ctx.vars.roundNumber < 10,
  do: ...
})
```

### Example: Cribbage Flow

Complex multi-phase flow from `packages/games/cribbage/`:

```typescript
export function createCribbageFlow(game: CribbageGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: sequence(
        // Deal phase
        phase('deal', {
          do: execute({ do: () => game.dealHands() }),
        }),

        // Discard phase - all players discard simultaneously
        phase('discard', {
          do: simultaneousActionStep({
            actions: ['discard'],
            prompt: 'Discard 2 cards to the crib',
          }),
        }),

        // Play phase - alternating card play
        phase('play', {
          do: loop({
            while: () => !game.playPhaseComplete(),
            do: eachPlayer({
              do: actionStep({
                actions: ['playCard', 'sayGo'],
                skipIf: (ctx) => !game.canPlay(ctx.player),
              }),
            }),
          }),
        }),

        // Show phase - score hands
        phase('show', {
          do: forEach({
            collection: () => game.getShowOrder(),
            do: (player) => execute({
              do: () => game.scoreHand(player),
            }),
          }),
        }),

        // Rotate dealer
        execute({ do: () => game.rotateDealer() }),
      ),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### Example: Simple Turn-Based Flow (Hex)

Minimal flow from `packages/games/hex/`:

```typescript
export function createHexFlow(game: HexGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      maxIterations: 100,
      do: eachPlayer({
        name: 'player-turns',
        filter: (player) => !game.isFinished(),
        do: actionStep({
          name: 'place-stone',
          actions: ['placeStone'],
          skipIf: () => game.isFinished(),
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.winner ? [game.winner] : [],
  };
}
```

## Registering Actions

Actions must be registered in your Game constructor:

```typescript
constructor(options) {
  super(options);
  // ... element setup ...

  this.registerAction(createMoveAction(this));
  this.registerAction(createDrawAction(this));
  this.registerAction(createPlayAction(this));

  this.setFlow(createGameFlow(this));
}
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Elements and state management
- [UI Components](./ui-components.md) - Displaying actions in the UI
- [Game Examples](./game-examples.md) - Real implementations
