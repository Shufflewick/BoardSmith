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

#### Deferred Choices (`defer: true`)

By default, choices are evaluated when building action metadata (before the player acts). Use `defer: true` to delay evaluation until the player clicks the action button.

**Use this when:**
- Choice computation has side effects (e.g., drawing cards from a deck)
- Choices depend on game state at the moment of clicking
- You want to manipulate state (like decks) before the draw occurs

```typescript
Action.create('hireFirstMerc')
  .prompt('Choose a MERC to hire')
  .condition((ctx) => ctx.player.team.length === 0)
  .chooseFrom('merc', {
    defer: true,  // Choices evaluated when player clicks, not at game load
    choices: (ctx) => {
      // This runs AFTER player clicks "Hire First MERC"
      const drawn = ctx.game.mercDeck.drawCards(3);

      // Store drawn cards for custom GameBoard to display
      ctx.game.settings._drawnMercsForHiring = drawn.map(m => m.id);

      return drawn;
    },
    display: (merc) => merc.displayName,
  })
  .execute((args, ctx) => {
    const merc = args.merc;
    ctx.player.team.push(merc);

    // Return unused mercs to deck
    const drawnIds = ctx.game.settings._drawnMercsForHiring as number[];
    for (const id of drawnIds) {
      if (id !== merc.id) {
        const card = ctx.game.getElementById(id);
        if (card) ctx.game.mercDeck.addToBottom(card);
      }
    }

    // Clean up temporary storage
    delete ctx.game.settings._drawnMercsForHiring;

    return { success: true };
  });
```

**How it works:**
1. Player sees "Hire First MERC" button
2. Player clicks button
3. Server evaluates choices callback NOW (draws 3 cards)
4. UI receives choices and shows selection dropdown
5. Player picks one, `execute()` runs

> **Note:** Use `game.settings` for temporary state storage since it survives hot-reload. Always clean up in `execute()`.

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

#### `playerChoices` - Choose a player with chooseFrom

Use the `playerChoices()` helper on your Game class to generate player choices for use with `chooseFrom`:

```typescript
Action.create('askPlayer')
  .chooseFrom('target', {
    prompt: 'Who do you want to ask?',
    choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
  })
  .execute((args, ctx) => {
    // playerChoices returns { value: number; display: string } objects
    const choice = args.target as { value: number; display: string };
    const targetPlayer = game.players[choice.value];
    // ...
  });
```

The `playerChoices()` helper supports:
- `excludeSelf: true` - Filter out the current player
- `currentPlayer` - Required when using excludeSelf
- `filter: (player) => boolean` - Custom filter function

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

> **IMPORTANT: Handling Undefined in Multi-Step Selections**
>
> BoardSmith evaluates ALL filters during availability checks, even for selections the player hasn't made yet. This means `ctx.args.piece` will be `undefined` when checking if the action should be available.
>
> **This will crash:**
> ```typescript
> filter: (cell, ctx) => {
>   const piece = ctx.args.piece as Piece;
>   return piece.canMoveTo(cell);  // ERROR: Cannot read 'canMoveTo' of undefined
> }
> ```
>
> **Correct pattern:**
> ```typescript
> filter: (cell, ctx) => {
>   const piece = ctx.args?.piece as Piece | undefined;
>
>   if (!piece) {
>     // Availability check - no piece selected yet
>     // Return true if this cell would be valid for ANY movable piece
>     return getMovablePieces(ctx.player).some(p => p.canMoveTo(cell));
>   }
>
>   // Actual selection - piece is selected
>   return piece.canMoveTo(cell);
> }
> ```
>
> See [Common Pitfalls](./common-pitfalls.md#2-multi-step-selection-filters) for more details.

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
    .chooseFrom('target', {
      prompt: 'Who do you want to ask?',
      choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
      boardRefs: (choice: { value: number; display: string }, ctx) => {
        const targetPlayer = game.players[choice.value] as GoFishPlayer;
        return { targetRef: { id: game.getPlayerHand(targetPlayer).id } };
      },
    })
    .chooseFrom<string>('rank', {
      prompt: 'What rank do you want?',
      choices: (ctx) => game.getPlayerRanks(ctx.player as GoFishPlayer),
      display: (rank) => {
        const names: Record<string, string> = {
          'A': 'Aces', '2': 'Twos', '3': 'Threes', '4': 'Fours',
          '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights',
          '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings'
        };
        return names[rank] ?? rank;
      },
    })
    .execute((args, ctx) => {
      const player = ctx.player as GoFishPlayer;
      const targetChoice = args.target as { value: number; display: string };
      const target = game.players[targetChoice.value] as GoFishPlayer;
      const rank = args.rank as string;

      const matchingCards = game.getCardsOfRank(target, rank);

      if (matchingCards.length > 0) {
        for (const card of matchingCards) {
          card.putInto(game.getPlayerHand(player));
        }
        game.message(`${player.name} got ${matchingCards.length} ${rank}(s) from ${target.name}!`);
        // Player gets another turn when they receive cards
      } else {
        game.message(`${target.name} says "Go Fish!"`);
        // Player draws from pond
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
