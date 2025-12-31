# @boardsmith/ai

MCTS (Monte Carlo Tree Search) AI bot for BoardSmith games. Provides generic AI opponents that work with any game.

## Installation

```bash
npm install @boardsmith/ai
```

## Quick Start

```typescript
import { createBot } from '@boardsmith/ai';
import { CheckersGame, gameDefinition } from './my-game';

// Create a bot for player 1
const bot = createBot(
  game,
  CheckersGame,
  'checkers',
  1,  // player index
  actionHistory,
  'hard'  // difficulty
);

// Get the bot's move
const move = await bot.play();
console.log(move.action, move.args);

// Apply the move
await session.performAction(move.action, 1, move.args);
```

## Difficulty Levels

| Level | Iterations | Timeout | Description |
|-------|------------|---------|-------------|
| `easy` | 3 | 1s | Quick, makes mistakes |
| `medium` | 5 | 1.5s | Balanced play |
| `hard` | 8 | 2s | Strong play |

You can also pass a custom iteration count:

```typescript
const bot = createBot(game, GameClass, 'my-game', 1, history, 15);
```

## Custom Objectives

For smarter AI, define objectives that give partial credit during playouts:

```typescript
import { createBot, AIConfig } from '@boardsmith/ai';

const aiConfig: AIConfig = {
  objectives: (game, playerIndex) => ({
    'material advantage': {
      checker: (g, p) => {
        const myPieces = g.board.all(Piece).filter(p => p.owner === p);
        const theirPieces = g.board.all(Piece).filter(p => p.owner !== p);
        return myPieces.length > theirPieces.length;
      },
      weight: 0.5,  // 0-1, how important this objective is
    },
    'center control': {
      checker: (g, p) => g.centerSquares.some(s => s.piece?.owner === p),
      weight: 0.3,
    },
  }),
};

const bot = createBot(game, GameClass, 'my-game', 1, history, 'hard', aiConfig);
```

## API Reference

### createBot()

```typescript
function createBot<G extends Game>(
  game: G,
  GameClass: GameClass<G>,
  gameType: string,
  playerIndex: number,
  actionHistory?: SerializedAction[],
  difficulty?: DifficultyLevel | number,
  aiConfig?: AIConfig
): MCTSBot<G>
```

### MCTSBot

```typescript
class MCTSBot<G extends Game> {
  /** Get the best move found by MCTS */
  async play(): Promise<BotMove>;
}
```

### Types

```typescript
interface BotMove {
  action: string;
  args: Record<string, unknown>;
}

interface BotConfig {
  iterations: number;      // MCTS iterations (default: 100)
  playoutDepth: number;    // Max depth before evaluating (default: 5)
  seed?: string;           // Random seed for reproducibility
  async?: boolean;         // Yield to event loop (default: true)
  timeout?: number;        // Max time in ms (default: 2000)
}

interface AIConfig {
  objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
}

interface Objective {
  checker: (game: Game, playerIndex: number) => boolean;
  weight: number;  // Positive = good for player, negative = bad
}
```

## Integration with Session

The `@boardsmith/session` package has built-in AI controller support:

```typescript
import { GameSession, AIController } from '@boardsmith/session';

const ai = new AIController({
  level: 'medium',
  players: [1],  // AI controls player 1
});

// In your game loop
if (ai.isAIPlayer(currentPlayer)) {
  const move = await ai.getMove(session);
  await session.performAction(move.action, move.player, move.args);
}
```

## CLI Integration

Use AI players in local development:

```bash
# Player 1 is AI with hard difficulty
npx boardsmith dev --ai 1 --ai-level hard

# Multiple AI players
npx boardsmith dev --ai 0 2 --ai-level medium
```

## See Also

- [@boardsmith/session](../session/README.md) - Game session with AI controller
- [@boardsmith/ai-trainer](../ai-trainer/README.md) - Train custom AI through self-play
