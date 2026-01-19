# boardsmith/ai

> MCTS-based AI opponents for board games.

## When to Use

Import from `boardsmith/ai` when adding AI opponents to your game. This package provides a Monte Carlo Tree Search (MCTS) bot that can play any BoardSmith game with configurable difficulty levels.

## Usage

```typescript
import { createBot, MCTSBot, parseAILevel, DIFFICULTY_PRESETS } from 'boardsmith/ai';
```

## Exports

### Factory Functions

- `createBot()` - Create an MCTS bot for a game
- `parseAILevel()` - Parse difficulty from string (for CLI)

### Classes

- `MCTSBot` - MCTS-based game AI

### Configuration

- `DIFFICULTY_PRESETS` - Preset difficulty configurations
- `DEFAULT_CONFIG` - Default bot configuration

### Types

- `BotConfig` - Bot configuration options
- `BotMove` - Bot move result
- `AIConfig` - AI configuration for session
- `Objective` - AI objective definition
- `ThreatResponse` - Threat response configuration
- `DifficultyLevel` - Difficulty preset names

## Examples

### Basic AI Opponent

```typescript
import { createBot } from 'boardsmith/ai';
import { CheckersGame } from './game';

// Create a game
const game = new CheckersGame({
  playerCount: 2,
  playerNames: ['Human', 'AI'],
});

// Create an AI bot for player 1 (medium difficulty)
const bot = createBot(
  game,
  CheckersGame,
  'checkers',
  1, // player index
  [], // action history
  'medium',
);

// Get the AI's move
const move = await bot.play();

if (move) {
  console.log(`AI plays: ${move.action}`, move.args);
  // Execute the move in your game
}
```

### Difficulty Levels

```typescript
import { createBot, DIFFICULTY_PRESETS } from 'boardsmith/ai';

// Easy - quick moves, less thinking
const easyBot = createBot(game, GameClass, 'game', 1, [], 'easy');

// Medium - balanced
const mediumBot = createBot(game, GameClass, 'game', 1, [], 'medium');

// Hard - more iterations, smarter play
const hardBot = createBot(game, GameClass, 'game', 1, [], 'hard');

// Custom - specify exact iteration count
const customBot = createBot(game, GameClass, 'game', 1, [], 5000);

// Available presets
console.log(DIFFICULTY_PRESETS);
// {
//   easy: { iterations: 100, explorationConstant: 1.414 },
//   medium: { iterations: 500, explorationConstant: 1.414 },
//   hard: { iterations: 2000, explorationConstant: 1.414 },
// }
```

### With AI Configuration

```typescript
import { createBot } from 'boardsmith/ai';
import type { AIConfig } from 'boardsmith/ai';

// Define custom AI objectives
const aiConfig: AIConfig = {
  objectives: [
    {
      name: 'control-center',
      description: 'Control the center of the board',
      feature: (game, player) => {
        const centerPieces = game.board.center.all(Piece, { player });
        return centerPieces.length * 0.1;
      },
      weight: 0.3,
    },
    {
      name: 'piece-advantage',
      description: 'Have more pieces than opponent',
      feature: (game, player) => {
        const myPieces = game.all(Piece, { player }).length;
        const theirPieces = game.all(Piece, { player: 1 - player }).length;
        return (myPieces - theirPieces) * 0.05;
      },
      weight: 0.5,
    },
  ],
};

const bot = createBot(
  game,
  CheckersGame,
  'checkers',
  1,
  actionHistory,
  'hard',
  aiConfig,
);
```

### Parsing CLI Arguments

```typescript
import { parseAILevel } from 'boardsmith/ai';

// From command line arguments
const levelArg = process.argv[2] || 'medium';
const difficulty = parseAILevel(levelArg);

// Accepts preset names or numbers
parseAILevel('easy'); // 'easy'
parseAILevel('medium'); // 'medium'
parseAILevel('hard'); // 'hard'
parseAILevel('1000'); // 1000 (custom iteration count)
parseAILevel('invalid'); // 'medium' (default fallback)
```

### Using MCTSBot Directly

```typescript
import { MCTSBot } from 'boardsmith/ai';

const bot = new MCTSBot(
  game,
  CheckersGame,
  'checkers',
  1,
  actionHistory,
  {
    iterations: 1000,
    explorationConstant: 1.5,
    timeLimit: 5000, // 5 second time limit
  },
);

// Get move with statistics
const move = await bot.play();
console.log(`Selected: ${move.action}`);
console.log(`Win rate: ${move.winRate}`);
console.log(`Simulations: ${move.simulations}`);
```

## How MCTS Works

The bot uses Monte Carlo Tree Search to evaluate moves:

1. **Selection** - Traverse the game tree using UCB1 to balance exploration/exploitation
2. **Expansion** - Add new game states to the tree
3. **Simulation** - Play random games to completion
4. **Backpropagation** - Update win statistics back up the tree

The bot automatically handles:

- All valid moves for the current player
- Multi-step actions with selections
- Game state cloning for simulations
- Undo/redo for efficient tree traversal

## See Also

- [AI System Guide](../ai-system.md) - Detailed AI system documentation
- [boardsmith/ai-trainer](./ai-trainer.md) - Train and improve AI weights
- [boardsmith/session](./session.md) - Using AI with GameSession
