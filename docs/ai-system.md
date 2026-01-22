# AI System

BoardSmith includes a game-agnostic AI system using Monte-Carlo Tree Search (MCTS). The AI works with any game without game-specific tuning.

## Overview

The `boardsmith/ai` package provides:
- **MCTSBot**: MCTS-based AI player
- **Difficulty presets**: easy, medium, hard
- **Custom objectives**: Guide AI behavior for specific games

## How MCTS Works

Monte-Carlo Tree Search builds a game tree by repeatedly:

1. **SELECT**: Walk down the tree using UCT (Upper Confidence Bound for Trees) to balance exploration vs exploitation
2. **EXPAND**: Try one unexplored action from a leaf node
3. **PLAYOUT**: Random moves until game ends (or depth limit)
4. **BACKPROPAGATE**: Update win counts back up the tree

After many iterations, the bot chooses the most-visited child of the root (robust choice).

## Basic Usage

### Using the CLI

The easiest way to add AI players is via the CLI:

```bash
# Player 1 is AI (medium difficulty)
boardsmith dev --ai 1

# Players 0 and 2 are AI
boardsmith dev --ai 0 2

# Set difficulty level
boardsmith dev --ai 1 --ai-level hard

# Custom iteration count
boardsmith dev --ai 1 --ai-level 50
```

### Difficulty Levels

| Level | Iterations | Playout Depth | Timeout |
|-------|-----------|---------------|---------|
| easy | 3 | 3 | 1000ms |
| medium | 5 | 4 | 1500ms |
| hard | 8 | 5 | 2000ms |

Note: Iterations are kept low because game operations can be slow (~18ms per move). The timeout ensures responsive behavior.

### Programmatic Usage

```typescript
import { createBot, parseAILevel } from 'boardsmith/ai';
import { MyGame } from './game.js';

// Create a bot for player 1
const bot = createBot(
  game,                    // Game instance
  MyGame,                  // Game class constructor
  'my-game',               // Game type identifier
  1,                       // Player index (0-based)
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

For games where win/loss isn't sufficient guidance, you can define objectives that give the AI partial credit during playouts.

### Defining Objectives

```typescript
import type { AIConfig, Game } from 'boardsmith/ai';

const aiConfig: AIConfig = {
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
const bot = createBot(game, MyGame, 'my-game', 1, [], 'medium', aiConfig);
```

### Objective Evaluation

During playouts that don't reach a terminal state:
- If total objective score > 0: returns 0.6 (slightly favorable)
- If total objective score < 0: returns 0.4 (slightly unfavorable)
- If total objective score = 0: returns 0.5 (neutral)

Terminal states always use actual win/loss (1.0/0.0).

## Example: Checkers AI

From `packages/games/checkers/rules/src/ai.ts`:

```typescript
import type { AIConfig, Game } from 'boardsmith/ai';

export const checkersAIConfig: AIConfig = {
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

The `boardsmith/session` package integrates AI automatically:

```typescript
import { GameSession } from 'boardsmith/session';
import { MyGame } from './game.js';
import { myGameAIConfig } from './ai.js';

const session = new GameSession({
  gameClass: MyGame,
  gameType: 'my-game',
  playerCount: 2,
  aiPlayers: [1],           // Player 1 is AI
  aiLevel: 'hard',
  aiConfig: myGameAIConfig,  // Optional custom objectives
});

// AI will automatically play when it's player 1's turn
session.start();
```

## BotConfig Options

```typescript
interface BotConfig {
  /** Number of MCTS iterations (higher = stronger but slower). Default: 100 */
  iterations: number;

  /** Maximum playout depth before evaluating position. Default: 5 */
  playoutDepth: number;

  /** Random seed for reproducible behavior */
  seed?: string;

  /** Run async to yield to event loop (prevents UI freezing). Default: true */
  async?: boolean;

  /** Maximum time in milliseconds before returning best move found. Default: 2000 */
  timeout?: number;
}
```

## Performance Considerations

1. **Iteration count**: More iterations = better play, but slower. The default presets are tuned for responsiveness.

2. **Playout depth**: Deeper playouts give more accurate evaluations but take longer. 3-5 is usually sufficient.

3. **Timeout**: The timeout ensures the bot always returns within a reasonable time, even if iterations haven't completed.

4. **Branching factor**: Games with many possible moves per turn will have fewer iterations explored per move. The bot samples up to 20 choices per selection to limit combinatorial explosion.

5. **Game complexity**: Simple games (Hex, Checkers) work well. Complex games (Cribbage with many scoring possibilities) may need custom objectives.

## Limitations

- **No learning**: The AI doesn't learn from past games. Each game starts fresh.
- **Text/number inputs**: The AI can't handle actions that require text or number input (it can only choose from discrete options).
- **Determinism**: With a seed, the bot is deterministic. Without a seed, it uses `Math.random()`.

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
  aiConfig?: AIConfig
): MCTSBot<G>
```

### MCTSBot.play()

```typescript
async play(): Promise<BotMove>
```

Returns the best move found after running MCTS iterations.

### parseAILevel()

```typescript
function parseAILevel(level: string): DifficultyLevel | number
```

Parse an AI level string (e.g., from CLI arguments).

## Related Documentation

- [Core Concepts](./core-concepts.md) - Understanding game state
- [Actions & Flow](./actions-and-flow.md) - How actions work
- [Game Examples](./game-examples.md) - Games with AI implementations
