# BoardSmith Game Design Instructions

You are helping the user design and generate a complete board game using the BoardSmith engine.

Before generating code, read these files to understand the patterns:
- `<BOARDSMITH_ROOT>/packages/engine/src/index.ts` - Engine exports
- `<BOARDSMITH_ROOT>/packages/cli/src/design/generator/reference-example.ts` - Code patterns

(Replace `<BOARDSMITH_ROOT>` with the path provided in the slash command)

## Phase 1: Interview

Conduct a conversational interview to gather game requirements. Ask these questions one at a time, waiting for the user's response before continuing.

### Basic Info
1. "What's your game called?"
2. "Describe the theme/setting of your game."
3. "Describe the core gameplay mechanics in a sentence or two."

### Players
4. "How many players? (min-max, e.g., '2-4')"
5. "Do all players have the same role, or are there different player types?"
6. "How do turns work? (sequential, simultaneous, or something else)"

### Game Elements
7. "What are the main components of your game? (cards, dice, board spaces, tokens, etc.)"

For each element type mentioned, ask follow-up questions:
- **Cards**: "Do cards have suits or categories? What are they?" / "Do cards have ranks or values? What are they?" / "Any special card types?"
- **Dice**: "What kind of dice? (d6, d20, custom faces)"
- **Board**: "Describe the board layout."
- **Tokens/Pieces**: "What tokens or pieces exist? What do they represent?"

8. "Do players have a hand of cards? If so, what's the max hand size?"
9. "Are there any other game elements I should know about?"

### Actions
10. "What actions can players take on their turn? Describe each one."

For each action, clarify:
- What does the player choose? (which card, which space, etc.)
- What happens when they take this action?
- Are there any restrictions on when they can take it?

### Game Flow
11. "What causes the game to end?"
12. "How do you determine the winner?"
13. "How do players score points? (if applicable)"

### Rules
14. "Are there any important rules that must always be followed?"
15. "Are there any automatic effects that trigger during the game?"

### Setup
16. "How is the game set up at the start?"

After gathering all requirements, summarize them back to the user and ask: "Does this look correct? Any changes?"

## Phase 2: Initialize Project

Once requirements are confirmed, use `boardsmith init` to create the project:

1. **Run boardsmith init**:
   ```bash
   npx boardsmith init <game-name>
   cd <game-name>
   npm install
   ```

2. **Read the generated files** to understand the starting template:
   - `src/rules/elements.ts` - Element classes (Card, Hand, Deck, etc.)
   - `src/rules/game.ts` - Main game class
   - `src/rules/actions.ts` - Player actions
   - `src/rules/flow.ts` - Game flow/turn structure
   - `src/rules/index.ts` - Exports

## Phase 3: Modify the Template

Edit the generated files to implement the user's game. Modify each file to match their requirements:

### 3a. Edit `src/rules/elements.ts`

Update the element classes to match the game's components:

- **Suit/Category types**: Use the EXACT values the user specified (not Hearts/Diamonds/Clubs/Spades unless they said so)
- **Rank/Value types**: Use the EXACT values the user specified
- **Custom spaces**: Add new Space subclasses for play areas, discard piles, expedition areas, etc.
- **Player class**: Add any custom properties (score, etc.)

Example for a game with Red/Green/Blue suits:
```typescript
export type Suit = 'Red' | 'Green' | 'Blue';
export const SUITS: Suit[] = ['Red', 'Green', 'Blue'];
```

### 3b. Edit `src/rules/game.ts`

Update the main game class:

- **Create spaces with human-readable names** for display in the UI:
  ```typescript
  // GOOD - descriptive names that show in UI
  this.create(DiscardPile, 'Red Discard');
  this.create(ExpeditionArea, 'Blue Expedition');

  // BAD - machine IDs that look ugly in UI
  this.create(DiscardPile, 'discard-red');
  this.create(ExpeditionArea, 'expedition-0-blue');
  ```

- **Create cards with descriptive names**:
  ```typescript
  // GOOD - shows nicely in UI
  this.deck.create(Card, '5 of Red', { suit: 'Red', rank: '5' });

  // BAD - cryptic IDs
  this.deck.create(Card, '5-red', { suit: 'Red', rank: '5' });
  ```

- **Use attribute-based queries** when multiple elements share the same display name:
  ```typescript
  // When multiple players each have "Red Expedition":
  getExpeditionArea(player: Player, suit: Suit): ExpeditionArea {
    return this.first(ExpeditionArea, { player, suit })!;
  }

  // When there's only one per suit:
  getDiscardPile(suit: Suit): DiscardPile {
    return this.first(DiscardPile, { suit })!;
  }
  ```

- **Implement game setup**: shuffle, deal cards, etc.
- **Override isFinished()**: return true when game should end
- **Override getWinners()**: return array of winning players

### 3c. Edit `src/rules/actions.ts`

Create actions for each player action:

```typescript
export function createPlayCardAction(game: MyGame): ActionDefinition {
  return Action.create('playCard')
    .prompt('Play a card')
    .chooseFrom<Card>('card', {
      prompt: 'Select a card from your hand',
      choices: (ctx) => {
        const player = ctx.player as MyPlayer;
        const hand = game.getPlayerHand(player);
        return [...hand.all(Card)];
      },
    })
    .chooseFrom<Suit>('destination', {
      prompt: 'Choose expedition',
      choices: () => SUITS,
    })
    .condition((args, ctx) => {
      // Return true if action is allowed
      return true;
    })
    .execute((args, ctx) => {
      const player = ctx.player as MyPlayer;
      const card = args.card as Card;
      const suit = args.destination as Suit;

      // Implement the action
      const expedition = game.getExpeditionArea(player, suit);
      card.putInto(expedition);

      return { success: true };
    });
}
```

### 3d. Edit `src/rules/flow.ts`

Define the turn structure using flow primitives:

```typescript
export function createGameFlow(game: MyGame): FlowDefinition {
  const playerTurn = sequence(
    actionStep({
      name: 'play-phase',
      actions: ['playCard', 'discardCard'],
      prompt: 'Play or discard a card',
    }),
    actionStep({
      name: 'draw-phase',
      actions: ['drawFromDeck', 'drawFromDiscard'],
      prompt: 'Draw a card',
    }),
  );

  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: eachPlayer({
        name: 'player-turns',
        do: playerTurn,
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.getWinners(),
  };
}
```

### 3e. Edit `src/rules/index.ts`

Export the game definition with correct player counts:

```typescript
export const gameDefinition = {
  gameClass: MyGame,
  gameType: '<game-name>',
  displayName: '<Game Display Name>',
  minPlayers: 2,
  maxPlayers: 4,
} as const;
```

### 3f. Edit `boardsmith.json`

Update the configuration:
```json
{
  "name": "<game-name>",
  "displayName": "<Game Display Name>",
  "minPlayers": 2,
  "maxPlayers": 4,
  "rulesEntry": "./src/rules/index.ts"
}
```

## Phase 4: Validate and Fix

After modifying all files:

1. Run `npx tsc --noEmit` to check for TypeScript errors
2. If there are errors:
   - Read the error messages carefully
   - Fix the issues in the appropriate files
   - Run tsc again
   - Repeat until no errors
3. Run `npm test` to run the tests
4. If tests fail, fix the issues and run again

## Critical Rules

- **Human-readable names**: Always use descriptive names that look good in the UI (e.g., "Red Expedition" not "expedition-0-red")
- **Attribute queries**: Use `{ player, suit }` object matchers to find elements when multiple share the same display name
- **NEVER use player.hand**: Always use `game.getPlayerHand(player)` helper methods
- **Class names must match**: Imports in other files must match the class names in elements.ts exactly
- **Use exact values**: Use the EXACT suit/rank names the user specified, never assume standard playing card values
- **Always verify**: Run the TypeScript compiler to verify - don't assume code is correct
