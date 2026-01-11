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
    .condition({
      'player has enough resources': (ctx) => ctx.player.gold >= 5,
    })
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

#### On-Demand Choices

Choices are always evaluated on-demand when the player needs to make a selection. This means the `choices` callback runs at the moment the player is presented with the selection, not when the action metadata is built.

**This enables:**
- Choice computation with side effects (e.g., drawing cards from a deck)
- Choices that depend on the current game state
- Manipulating state (like decks) right before showing choices

> ⚠️ **CRITICAL: Module-Level Variables Don't Work**
>
> The `choices()` and `execute()` callbacks run in **different contexts**. Module-level variables (Maps, arrays, objects outside the action) will NOT persist between them:
>
> ```typescript
> // ❌ WRONG - This will NOT work!
> const drawnCache = new Map<string, Equipment>();
>
> Action.create('armsDealer')
>   .chooseFrom('equipment', {
>     choices: (ctx) => {
>       const equipment = deck.draw();
>       drawnCache.set('drawn', equipment);  // Set in choices...
>       return [equipment];
>     },
>   })
>   .execute((args, ctx) => {
>     const equipment = drawnCache.get('drawn');  // ...empty in execute!
>   });
> ```
>
> **Use `actionTempState()` instead** (see below).

#### Using `actionTempState()` for Temp State

The `actionTempState()` helper provides a clean API for storing state between `choices()` and `execute()`:

```typescript
import { Action, actionTempState } from '@boardsmith/engine';

Action.create('armsDealer')
  .chooseFrom('equipment', {
    choices: (ctx) => {
      const temp = actionTempState(ctx, 'armsDealer');
      const equipment = ctx.game.equipmentDeck.draw();
      temp.set('drawnEquipment', equipment.id);
      return [equipment, { value: 'skip', label: 'Skip (add to stash)' }];
    },
  })
  .execute((args, ctx) => {
    const temp = actionTempState(ctx, 'armsDealer');
    const equipmentId = temp.get<number>('drawnEquipment');
    const equipment = ctx.game.getElementById(equipmentId) as Equipment;
    temp.clear();  // Always clean up!

    if (args.equipment === 'skip') {
      sector.addToStash(equipment);
    } else {
      // Equip to merc...
    }
  });
```

**API:**
- `temp.set(key, value)` - Store a value
- `temp.get<T>(key)` - Retrieve a value (typed)
- `temp.clear()` - Remove all temp state for this action/player

The helper automatically namespaces by action name and player, so multiple players or actions won't conflict.

#### Full On-Demand Choices Example

```typescript
Action.create('hireFirstMerc')
  .prompt('Choose a MERC to hire')
  .condition({
    'player has no team yet': (ctx) => ctx.player.team.length === 0,
  })
  .chooseFrom('merc', {
    choices: (ctx) => {
      const temp = actionTempState(ctx, 'hireFirstMerc');
      const drawn = ctx.game.mercDeck.drawCards(3);
      temp.set('drawnIds', drawn.map(m => m.id));
      return drawn;
    },
    display: (merc) => merc.displayName,
  })
  .execute((args, ctx) => {
    const temp = actionTempState(ctx, 'hireFirstMerc');
    const merc = args.merc;
    ctx.player.team.push(merc);

    // Return unused mercs to deck
    const drawnIds = temp.get<number[]>('drawnIds') ?? [];
    for (const id of drawnIds) {
      if (id !== merc.id) {
        const card = ctx.game.getElementById(id);
        if (card) ctx.game.mercDeck.addToBottom(card);
      }
    }

    temp.clear();
    return { success: true };
  });
```

**How it works:**
1. Player sees "Hire First MERC" button
2. Player clicks button
3. Server evaluates choices callback NOW (draws 3 cards, stores IDs)
4. UI receives choices and shows selection dropdown
5. Player picks one, `execute()` runs with temp state available

> **Important: UI Sync Limitation**
>
> State changes made in `choices()` or `elements()` callbacks happen **server-side only**. The client's `gameView` is NOT updated until the entire action completes (after `execute()` runs).
>
> This means:
> - The UI won't show the drawn cards, updated counts, or state changes immediately
> - Custom game boards must read from `game.settings` to see mid-action state
> - If your UI needs to reflect state changes before selection, consider splitting into two actions in your flow
>
> **Example: Two-Action Pattern for UI Updates**
> ```typescript
> // flow.ts - Split exploration into two actions
> phase('explore', {
>   do: sequence(
>     actionStep({ actions: ['explore'] }),       // Draws equipment, updates state
>     actionStep({ actions: ['collectLoot'] }),   // UI now shows updated state
>   ),
> })
> ```
> This pattern ensures the UI sees the exploration results before the player picks equipment.

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

#### `fromElements<T>` - Select from a list of elements (Recommended for Custom UIs)

**This is the preferred method when building custom game UIs.** It uses element IDs as values, making it seamless for custom components to send selections.

```typescript
Action.create('attack')
  .fromElements<Unit>('target', {
    prompt: 'Choose a target',
    elements: (ctx) => ctx.game.combat.validTargets,
    display: (unit, ctx, allUnits) => unit.name,  // Optional: custom display
    boardRef: (unit) => ({ id: unit.id }),
  })
  .execute((args, ctx) => {
    // args.target is the resolved Element object (not an ID!)
    const target = args.target as Unit;
    target.takeDamage(10);
    return { success: true };
  });
```

**Why use `fromElements` instead of `chooseFrom`?**

| Feature | `chooseFrom` | `fromElements` |
|---------|-------------|----------------|
| Value type | String (manual) | Element ID (automatic) |
| Custom UI sends | `"Militia #1"` (must match exactly) | `42` (element ID) |
| Display names | Manual | Auto-disambiguated |
| Execute receives | Raw value | Resolved Element |

**Custom UI integration:**

```typescript
// In your custom Vue component:
function attackTarget(targetId: number) {
  // Just send the element ID - it works!
  props.action('attack', { target: targetId });
}
```

**Auto-disambiguation:**
When multiple elements share the same name, display names are automatically suffixed:
- "Militia" (if unique)
- "Militia #1", "Militia #2" (if duplicates exist)

**Multi-select:**

```typescript
.fromElements<Unit>('targets', {
  elements: (ctx) => ctx.game.combat.validTargets,
  multiSelect: { min: 1, max: 3 },  // Select 1-3 targets
})
.execute((args) => {
  // args.targets is an array of Element objects
  const targets = args.targets as Unit[];
  targets.forEach(t => t.takeDamage(5));
});
```

**Optional selections:**

Allow players to skip a selection. Use `optional: true` for a "Skip" button, or provide a string for custom button text:

```typescript
.fromElements<Equipment>('item', {
  elements: (ctx) => ctx.loot.all(Equipment),
  optional: true,           // Shows "Skip" button
})

.fromElements<Equipment>('item', {
  elements: (ctx) => ctx.loot.all(Equipment),
  optional: 'Done',         // Shows "Done" button instead of "Skip"
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
    // playerChoices returns { value: position; display: string } objects
    // Position values are 1-indexed
    const choice = args.target as { value: number; display: string };
    const targetPlayer = game.players.get(choice.value)!;
    // ...
  });
```

The `playerChoices()` helper supports:
- `excludeSelf: true` - Filter out the current player
- `currentPlayer` - Required when using excludeSelf
- `filter: (player) => boolean` - Custom filter function

#### `enterNumber` - Enter a number

```typescript
Action.create('bid')
  .enterNumber('amount', {
    prompt: 'Enter your bid',
    min: 1,
    max: (ctx) => ctx.player.coins,
  })
```

#### `enterText` - Enter text

```typescript
Action.create('name')
  .enterText('name', {
    prompt: 'Enter a name',
    maxLength: 20,
  })
```

### Chaining Selections with `dependsOn`

When selection B depends on selection A's value, use the `dependsOn` option:

```typescript
Action.create('dropEquipment')
  .fromElements('merc', {
    elements: () => [...game.all(Merc)],
  })
  .fromElements('equipment', {
    dependsOn: 'merc',  // Tells framework B depends on A
    elements: (ctx) => {
      const merc = ctx.args.merc as Merc;
      return [...merc.equipment.all(Equipment)];
    },
  })
```

**What `dependsOn` does:**
- During availability check, the framework automatically iterates through all choices for A
- For each A choice, it checks if B would have valid choices
- Action is available if at least one A choice leads to valid B choices
- No crashes, no manual undefined handling needed!

Works with all selection types:

```typescript
// With chooseElement
Action.create('move')
  .chooseElement<Piece>('piece', {
    elementClass: Piece,
    filter: (p, ctx) => p.player === ctx.player,
  })
  .chooseElement<Cell>('destination', {
    dependsOn: 'piece',
    from: (ctx) => ctx.args.piece as Piece,
    elementClass: Cell,
  })

// With chooseFrom
Action.create('selectItem')
  .chooseFrom('category', { choices: ['weapons', 'armor'] })
  .chooseFrom('item', {
    dependsOn: 'category',
    choices: (ctx) => getItemsForCategory(ctx.args.category as string),
  })
```

> **Alternative: Manual Undefined Handling**
>
> For complex cases where you need custom availability logic, you can handle `undefined` manually instead of using `dependsOn`:
>
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
> See [Common Pitfalls](./common-pitfalls.md#2-dependent-selections-selection-b-depends-on-selection-a) for more details.

### Conditions

Control when actions are available using labeled conditions:

```typescript
Action.create('draw')
  .condition({
    'deck has cards': (ctx) => game.deck.count(Card) > 0,
  })
  .execute(...)

// Multiple conditions are AND'd together
Action.create('purchase')
  .condition({
    'player can afford cost': (ctx) => ctx.player.gold >= 10,
    'item is available': (ctx) => game.shop.count(Item) > 0,
  })
  .execute(...)
```

Each key is a human-readable label that appears in debug output when the condition fails. This makes it easy to understand why an action isn't available.

**Labels should describe WHY** the condition exists, not just what it checks:
- Good: `'player can afford cost'`, `'in play phase'`, `'has cards to discard'`
- Bad: `'gold >= 10'`, `'phase === play'`, `'hand.count > 0'`

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

---

## Action Chaining with `followUp`

Action chaining allows one action to automatically trigger another action with pre-filled context. This is essential for multi-phase game interactions where:
- The UI needs to show updated state between phases
- Context (which piece, which location) should flow between phases
- The user experience should feel seamless

### Basic Usage

Return a `followUp` object from your execute function:

```typescript
Action.create('explore')
  .chooseElement('merc', {
    prompt: 'Select MERC to explore',
    elementClass: Merc,
  })
  .execute((args, ctx) => {
    const merc = args.merc as Merc;
    const sector = merc.getCurrentSector();

    // Draw equipment to the sector's stash
    for (let i = 0; i < sector.lootCount; i++) {
      const equipment = ctx.game.drawEquipment();
      if (equipment) equipment.putInto(sector.stashZone);
    }
    sector.explored = true;
    merc.useAction(1);

    ctx.game.message(`${merc.name} explored ${sector.name}`);

    // Chain to collect action - UI will see the drawn equipment
    return {
      success: true,
      followUp: {
        action: 'collectEquipment',
        args: {
          mercId: merc.id,
          sectorId: sector.id,
        },
      },
    };
  });

// The follow-up action receives pre-filled args
Action.create('collectEquipment')
  .fromElements<Equipment>('equipment', {
    prompt: 'Select equipment to take',
    elements: (ctx) => {
      // UI shows updated state - stash has the drawn equipment
      const sector = ctx.game.getElementById(ctx.args.sectorId) as Sector;
      return [...sector.stashZone.all(Equipment)];
    },
    optional: 'Done taking equipment',
  })
  .execute((args, ctx) => {
    if (args.equipment) {
      const merc = ctx.game.getElementById(ctx.args.mercId) as Merc;
      (args.equipment as Equipment).putInto(merc.inventoryZone);
      ctx.game.message(`Took ${(args.equipment as Equipment).name}`);
    }
    return { success: true };
  });
```

### Conditional Chaining

Only chain to follow-up when a condition is met:

```typescript
.execute((args, ctx) => {
  const sector = performExploration(args, ctx);

  return {
    success: true,
    // Only chain if there's equipment to collect
    followUp: sector.stashZone.count() > 0
      ? { action: 'collectEquipment', args: { sectorId: sector.id } }
      : undefined,
  };
})
```

### How It Works

1. **First action executes** - state changes (drawing equipment, marking explored)
2. **State syncs to client** - UI receives updated gameView with new state
3. **Follow-up auto-starts** - client automatically begins the follow-up action
4. **Args pre-filled** - follow-up action starts with provided args already set
5. **User continues** - from user's perspective, it's one seamless interaction

### When to Use Action Chaining

Use `followUp` when:
- An action modifies state that the next action's choices depend on
- You need the UI to reflect changes before the player makes their next selection
- Context (which piece, which location, etc.) should flow to the next action
- The follow-up is optional or conditional

Don't use `followUp` when:
- Selections don't depend on state changes from previous selections
- A single action with multiple selections is sufficient
- The follow-up is mandatory and unconditional (consider putting both in the same action)

### Displaying followUp Args

When followUp args are displayed in the action panel (as chips showing context), plain IDs like `mercId: 51` display as "51" which isn't user-friendly.

**Option 1: Pass objects with name/display properties**

```typescript
return {
  success: true,
  followUp: {
    action: 'collectEquipment',
    args: {
      // Plain ID - displays as "51" ❌
      // mercId: merc.id,

      // Object with name - displays as "Bronson" ✓
      mercId: { id: merc.id, name: merc.mercName },
      sectorId: { id: sector.id, name: sector.sectorName },
    },
  },
};
```

The UI extracts the `name` (or `display`) property automatically. Your follow-up action's helpers should handle both formats:

```typescript
function getMerc(ctx: ActionContext): Merc {
  const arg = ctx.args.mercId;
  // Handle both plain ID and object format
  const id = typeof arg === 'object' && arg !== null ? (arg as { id: number }).id : arg;
  return ctx.game.first(Merc, m => m.id === id)!;
}
```

**Option 2: Use the display option (recommended)**

For cleaner separation of value and display:

```typescript
return {
  success: true,
  followUp: {
    action: 'collectEquipment',
    args: {
      mercId: merc.id,
      sectorId: sector.id,
    },
    display: {
      mercId: merc.mercName,      // "Bronson"
      sectorId: sector.sectorName, // "Diamond Industry"
    },
  },
};
```

This keeps the args as plain IDs (no helper changes needed) while providing display strings for the UI.

### Example: Attack with Damage Resolution

```typescript
Action.create('attack')
  .chooseElement('attacker', { elementClass: Unit })
  .chooseElement('target', { elementClass: Unit })
  .execute((args, ctx) => {
    const attacker = args.attacker as Unit;
    const target = args.target as Unit;

    const damage = calculateDamage(attacker, target);
    target.takeDamage(damage);

    // If target has a defensive ability, chain to resolution
    return {
      success: true,
      followUp: target.hasDefensiveAbility()
        ? { action: 'resolveDefense', args: { targetId: target.id, damage } }
        : undefined,
    };
  });
```

---

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
        const targetPlayer = game.players.get(choice.value) as GoFishPlayer;
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
      const target = game.players.get(targetChoice.value) as GoFishPlayer;
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
  collection: (ctx) => ctx.game.players,
  as: 'player',  // Variable name to access current item
  do: execute((ctx) => {
    const player = ctx.get('player');
    game.scoreHand(player);
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
  if: (ctx) => ctx.game.deck.count(Card) > 0,
  then: actionStep({ actions: ['draw'] }),
  else: execute((ctx) => ctx.game.endRound()),
})
```

#### `execute` - Run code

```typescript
execute((ctx) => {
  ctx.game.deck.shuffle();
  ctx.game.message('Deck shuffled!');
})
```

#### `setVar` - Set flow variable

```typescript
setVar('roundNumber', (ctx) => (ctx.get('roundNumber') ?? 0) + 1)
```

### Turn Order

Control player order with `TurnOrder` presets. Use the spread operator to apply them:

```typescript
import { TurnOrder } from '@boardsmith/engine';

// Default round-robin from player 1
eachPlayer({
  ...TurnOrder.DEFAULT,
  do: actionStep({ actions: ['play'] }),
})

// Available presets (player positions are 1-indexed):
TurnOrder.DEFAULT           // Standard round-robin from player 1
TurnOrder.REVERSE           // Round-robin backward
TurnOrder.CONTINUE          // Continue from current player
TurnOrder.ACTIVE_ONLY       // Only non-eliminated players
TurnOrder.START_FROM(n)     // Start from position n (1-indexed)
TurnOrder.ONLY([1, 3])      // Specific players only (positions 1 and 3)
TurnOrder.LEFT_OF_DEALER()  // Common for card games (reads ctx.get('dealer'))
TurnOrder.SKIP_IF(fn)       // Skip players based on condition
TurnOrder.combine(...)      // Combine multiple configs

// Example with dealer rotation
eachPlayer({
  ...TurnOrder.LEFT_OF_DEALER(),
  do: actionStep({ actions: ['playCard'] }),
})
```

### Flow Variables

Access and set variables during flow:

```typescript
// Set variable (player positions are 1-indexed)
setVar('dealer', (ctx) => ctx.game.players.get(1))

// Access in conditions
loop({
  while: (ctx) => ctx.get('roundNumber') < 10,
  do: /* flow node */,
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
          do: execute(() => game.dealHands()),
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
            as: 'player',
            do: execute((ctx) => game.scoreHand(ctx.get('player'))),
          }),
        }),

        // Rotate dealer
        execute(() => game.rotateDealer()),
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

## Custom UI Integration

### Sending Actions from Custom Components

When building a custom game board in Vue, you can send actions using the `action` prop:

```vue
<script setup lang="ts">
const props = defineProps<{
  gameView: GameView;
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean }>;
}>();

function attackTarget(targetId: number) {
  props.action('attack', { target: targetId });
}
</script>
```

### Smart Value Resolution

BoardSmith automatically resolves values in `chooseFrom` selections. When you send an action, these formats are accepted:

1. **Exact choice value** (original behavior)
2. **Element ID** (if choice references an element with that ID)
3. **Display string** (case-insensitive match to choice display)

This means custom UIs can send element IDs even for `chooseFrom` selections:

```typescript
// Action definition using chooseFrom
.chooseFrom('target', {
  choices: (ctx) => game.validTargets,  // Returns element objects
  display: (target) => target.name,
})

// Custom UI can send the element ID directly
props.action('attack', { target: target.id });  // Works!
```

### Detailed Validation Errors

When validation fails, you get helpful error messages:

```typescript
// Error response includes valid choices:
{
  success: false,
  error: 'Invalid selection for "target": "invalid-value". Valid choices: [Militia #1, Militia #2, genesis]'
}
```

### Best Practices

1. **Prefer `fromElements` for new code** - It's designed for custom UIs
2. **Use element IDs, not string values** - IDs are stable; display strings can change
3. **Check `actionMetadata` for valid choices** - It includes element IDs for reference

```typescript
// actionMetadata structure for fromElements (single-select):
{
  selections: [{
    name: 'target',
    type: 'element',  // Single-select uses 'element' type
    validElements: [
      { id: 42, display: 'Militia #1', ref: { id: 42 } },
      { id: 43, display: 'Militia #2', ref: { id: 43 } },
    ]
  }]
}

// actionMetadata structure for fromElements (multi-select):
{
  selections: [{
    name: 'targets',
    type: 'elements',  // Multi-select uses 'elements' type
    multiSelect: { min: 1, max: 3 },
    validElements: [
      { id: 42, display: 'Militia #1', ref: { id: 42 } },
      { id: 43, display: 'Militia #2', ref: { id: 43 } },
    ]
  }]
}
```

## Related Documentation

- [Core Concepts](./core-concepts.md) - Elements and state management
- [UI Components](./ui-components.md) - Displaying actions in the UI
- [Game Examples](./game-examples.md) - Real implementations
