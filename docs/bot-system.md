# Bot System

BoardSmith includes a game-agnostic bot system using Monte-Carlo Tree Search (MCTS). The bot works with any game without game-specific tuning.

## Overview

The `boardsmith/bot` package provides:
- **MCTSBot**: MCTS-based bot player
- **Difficulty presets**: easy, medium, hard
- **Custom objectives**: Guide bot behavior for specific games

## How MCTS Works

Monte-Carlo Tree Search builds a game tree by repeatedly:

1. **SELECT**: Walk down the tree using UCT (Upper Confidence Bound for Trees) to balance exploration vs exploitation
2. **EXPAND**: Try one unexplored action from a leaf node
3. **PLAYOUT**: Random moves until game ends (or depth limit)
4. **BACKPROPAGATE**: Update win counts back up the tree

After many iterations, the bot chooses the most-visited child of the root (robust choice).

## Basic Usage

### Using the CLI

The easiest way to add bot players is via the CLI:

```bash
# Player 1 is a bot (medium difficulty)
boardsmith dev --bot 1

# Players 1 and 3 are bots
boardsmith dev --bot 1 3

# Set difficulty level
boardsmith dev --bot 1 --bot-level hard

# Custom iteration count
boardsmith dev --bot 1 --bot-level 50
```

### Difficulty Levels

| Level | Iterations | Playout Depth | Timeout | Parallel |
|-------|-----------|---------------|---------|----------|
| easy | 100 | 2 | 1000ms | - |
| medium | 300 | 3 | 1500ms | - |
| hard | 500 | 4 | 2000ms | 2 |

Seat numbers are 1-indexed everywhere: `--bot 1` makes the first seat a bot, and `--bot 0` is rejected.

### Programmatic Usage

```typescript
import { createBot, parseBotLevel } from 'boardsmith/bot';
import { MyGame } from './game.js';

// Create a bot for player 1
const bot = createBot(
  game,                    // Game instance
  MyGame,                  // Game class constructor
  'my-game',               // Game type identifier
  1,                       // Player position (1-indexed)
  actionHistory,           // History of actions taken so far
  'hard'                   // Difficulty level or iteration count
);

// Get the bot's move
const move = await bot.play();
console.log(`Bot plays: ${move.action}`, move.args);

// Execute the move
game.continueFlow(move.action, move.args, 1);
```

## Custom Objectives

For games where win/loss isn't sufficient guidance, you can define objectives that give the bot partial credit during playouts.

### Defining Objectives

```typescript
import type { BotStrategy } from 'boardsmith/bot';
import type { Game } from 'boardsmith';

const myGameBotStrategy: BotStrategy = {
  objectives: (game: Game, playerIndex: number) => ({
    // Positive weight = good for the player
    controlCenter: {
      checker: (g, p) => {
        const center = g.board.cells.filter(c => c.isCentral);
        const playerPieces = center.filter(c => c.piece?.player?.seat === p);
        return playerPieces.length >= 2;
      },
      weight: 0.3,
    },

    // Negative weight = bad for the player
    exposedKing: {
      checker: (g, p) => {
        const king = g.players.get(p)!.king;
        return king.isExposed();
      },
      weight: -0.5,
    },

    // Material advantage
    materialAdvantage: {
      checker: (g, p) => {
        const myPieces = g.pieces.filter(pc => pc.player?.seat === p);
        const oppPieces = g.pieces.filter(pc => pc.player?.seat !== p);
        return myPieces.length > oppPieces.length;
      },
      weight: 0.4,
    },
  }),
};

// Use with createBot
const bot = createBot(game, MyGame, 'my-game', 1, [], 'medium', myGameBotStrategy);
```

### Objective Evaluation

During playouts that don't reach a terminal state:
- If total objective score > 0: returns 0.6 (slightly favorable)
- If total objective score < 0: returns 0.4 (slightly unfavorable)
- If total objective score = 0: returns 0.5 (neutral)

Terminal states always use actual win/loss (1.0/0.0).

## Example: Checkers Bot

From Checkers bot.ts:

```typescript
import type { BotStrategy } from 'boardsmith/bot';
import type { Game } from 'boardsmith';

export const checkersBotStrategy: BotStrategy = {
  objectives: (game: Game, playerIndex: number) => ({
    // Having more pieces is good
    morePieces: {
      checker: (g, p) => {
        const myPieces = countPieces(g, p);
        const oppPieces = countPieces(g, 1 - p);
        return myPieces > oppPieces;
      },
      weight: 0.5,
    },

    // Having kings is good
    hasKings: {
      checker: (g, p) => {
        const myKings = countKings(g, p);
        return myKings > 0;
      },
      weight: 0.3,
    },

    // Controlling the center is good
    centerControl: {
      checker: (g, p) => {
        const centerCells = getCenterCells(g);
        const myPiecesInCenter = centerCells.filter(
          c => c.piece?.player?.seat === p
        );
        return myPiecesInCenter.length >= 2;
      },
      weight: 0.2,
    },
  }),
};
```

## Integration with GameSession

The `boardsmith/session` package integrates bot automatically:

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game.js';
import { myGameBotStrategy } from './bot.js';

const session = GameSession.create({
  GameClass: MyGame,
  gameType: 'my-game',
  playerCount: 2,
  playerNames: ['You', 'Computer'],
  botSeats: { players: [1], level: 'hard' },  // Player 1 is a bot at 'hard' level
  botStrategy: myGameBotStrategy,             // Optional custom objectives
});

// bot will automatically play when it's player 1's turn
```

> `botSeats` declares which seats are bots (`players`) and the difficulty (`level`).
> The game's custom objectives/threat hooks go in `botStrategy`.

## BotConfig Options

```typescript
interface BotConfig {
  /** Number of MCTS iterations (higher = stronger but slower). Default: 300 */
  iterations: number;

  /** Maximum playout depth before evaluating position. Default: 3 */
  playoutDepth: number;

  /** Random seed for reproducible behavior */
  seed?: string;

  /** Run async to yield to event loop (prevents UI freezing). Default: true */
  async?: boolean;

  /** Maximum time in milliseconds before returning best move found. Default: 2000 */
  timeout?: number;

  /** Number of parallel ensemble searches. Default: 1 */
  parallel?: number;
}
```

## Performance Considerations

1. **Iteration count**: More iterations = better play, but slower. The default presets are tuned for responsiveness.

2. **Playout depth**: Deeper playouts give more accurate evaluations but take longer. 3-5 is usually sufficient.

3. **Timeout**: The timeout ensures the bot always returns within a reasonable time, even if iterations haven't completed.

4. **Branching factor**: Games with many possible moves per turn will have fewer iterations explored per move. The bot samples up to 20 choices per selection to limit combinatorial explosion.

5. **Game complexity**: Simple games (Hex, Checkers) work well. Complex games (Cribbage with many scoring possibilities) may need custom objectives.

## Limitations

- **No learning**: The bot doesn't learn from past games. Each game starts fresh.
- **Text/number inputs**: The bot can't handle actions that require text or number input (it can only choose from discrete options).
- **Determinism**: With a seed, the bot is deterministic. Without a seed, it uses `Math.random()`.

## Hidden information: enumeration and simulation are not the same thing

A bot searches its OWN seat's information state. `MCTSBot` rebuilds its sandbox
from that seat's redacted view, which is what stops the search from reading
hidden state — and it means the sandbox does not hold what the redaction removed.

Those two halves compose differently:

- **Enumeration** usually works. The seat's own view carries its own options, so
  the bot offers exactly its legal moves.
- **Simulation** often does not. A move's `execute()` frequently resolves against
  state the seat cannot see — a shared map, an opponent's hand — and inside the
  sandbox that state is simply not there.

When a move is legal to offer but cannot be resolved, say so:

```typescript
import { NotSimulableError } from 'boardsmith';

Action.create('travel')
  .chooseFrom('direction', { choices: (ctx) => ctx.player.here.exits })
  .execute((args, ctx) => {
    if (ctx.game.mapSeed === undefined) {
      throw new NotSimulableError('travel resolves against the map, which this seat cannot see');
    }
    // ... resolve for real
  });
```

The bot drops that move from its search and moves on. Nothing is logged, and no
hidden value is invented.

The two things to reach for instead are both worse, and the engine will not stop
you doing either:

- **Letting `execute()` throw an ordinary error** logs a stack on every rollout —
  measured at 198 MB in 15 seconds on one game — while the search quietly
  collapses to whatever moves happen not to touch hidden state.
- **Fabricating the missing state** so `execute()` succeeds makes the bot search
  a world that does not exist. It is the same mistake as deriving `choices` from
  state the caller cannot see, one layer later: the answer is no move, not a guess.

A bot that skips its unresolvable moves plays worse than one that could resolve
them. Making it play WELL in a hidden-information game needs determinization —
sampling a hypothesis consistent with what the seat can see — which BoardSmith
does not offer yet.

## API Reference

### createBot()

```typescript
function createBot<G extends Game>(
  game: G,
  GameClass: new (options: GameOptions) => G,
  gameType: string,
  playerIndex: number,
  actionHistory?: SerializedAction[],
  difficulty?: DifficultyLevel | number,
  botStrategy?: BotStrategy
): MCTSBot<G>
```

### MCTSBot.play()

```typescript
async play(): Promise<BotMove>
```

Returns the best move found after running MCTS iterations.

### parseBotLevel()

```typescript
function parseBotLevel(level: string): DifficultyLevel | number
```

Parse a bot level string (e.g., from CLI arguments).

## Related Documentation

- [Core Concepts](./core-concepts.md) - Understanding game state
- [Actions & Flow](./actions-and-flow.md) - How actions work
- [Game Examples](./game-examples.md) - Games with bot implementations
