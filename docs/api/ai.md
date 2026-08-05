# boardsmith/ai

> MCTS-based AI opponents for board games.

## When to Use

Import from `boardsmith/ai` when adding AI opponents to your game. This package provides a Monte Carlo Tree Search (MCTS) bot that can play any BoardSmith game with configurable difficulty levels.

For the conceptual guide — how to write objectives, tune difficulty, and debug a bot that plays badly — see [AI System](../ai-system.md). This page is the API surface only.

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
- `BotMove` - Bot move result (`{ action, args }`)
- `BotMoveStats` - Per-candidate search stats from `playWithStats()`
- `AIConfig` - AI hooks attached to a game definition
- `Objective` - A single weighted evaluation term
- `ThreatResponse` - Threat response result
- `DifficultyLevel` - Difficulty preset names (`'easy' | 'medium' | 'hard'`)

## Examples

### Basic AI Opponent

```typescript
import { createBot } from 'boardsmith/ai';
import { CheckersGame } from './game';

const game = new CheckersGame({
  playerCount: 2,
  playerNames: ['Human', 'AI'],
});

// Create an AI bot for seat 2 (seats are 1-indexed), medium difficulty
const bot = createBot(
  game,
  CheckersGame,
  'checkers',
  2,          // seat this bot plays
  [],         // action history
  'medium',
);

const move = await bot.play();   // BotMove — always resolves to a move
console.log(`AI plays: ${move.action}`, move.args);
```

`play()` returns a `BotMove` — `{ action: string; args: Record<string, unknown> }`. Feed it back through your normal action path (`session.performAction(move.action, seat, move.args)`); the bot does not mutate the live game.

### Difficulty Levels

```typescript
import { createBot, DIFFICULTY_PRESETS, DEFAULT_CONFIG } from 'boardsmith/ai';

const easyBot = createBot(game, GameClass, 'game', 2, [], 'easy');
const hardBot = createBot(game, GameClass, 'game', 2, [], 'hard');

// A number is taken as an explicit iteration ceiling; every other knob
// falls back to DEFAULT_CONFIG (note: NOT to the medium preset).
const customBot = createBot(game, GameClass, 'game', 2, [], 5000);

console.log(DIFFICULTY_PRESETS);
// {
//   easy:   { iterations: 100, playoutDepth: 2, timeout: 1000 },
//   medium: { iterations: 300, playoutDepth: 3, timeout: 1500 },
//   hard:   { iterations: 500, playoutDepth: 4, timeout: 2000, parallel: 2 },
// }

console.log(DEFAULT_CONFIG);
// { iterations: 300, playoutDepth: 3, async: true, timeout: 2000 }
```

**`timeout` overrides `iterations`.** It is a wall-clock responsiveness failsafe: when it fires the search returns the best move found so far, so a slow game silently runs far fewer iterations than requested. Pass `timeout: Infinity` when you want the run bounded only by `iterations` — and note that `seed` alone does **not** make a search reproducible for exactly this reason. Deterministic search needs `{ seed, timeout: Infinity }`.

### AI Configuration

`AIConfig` is a set of optional hooks, all of them functions. Attach it to your game definition (or pass it as `createBot`'s last argument).

```typescript
import type { AIConfig, Objective } from 'boardsmith/ai';

const aiConfig: AIConfig = {
  // A FUNCTION returning a keyed record — not an array. It is called during
  // playouts, so it can depend on the current position.
  objectives: (game, playerIndex): Record<string, Objective> => ({
    controlCenter: {
      // Return 0..1: how well the objective is achieved right now.
      checker: (g, seat) => g.board.center.all(Piece, { player: seat }).length / 4,
      // Positive = good for the player, negative = bad.
      weight: 0.3,
    },
    pieceAdvantage: {
      checker: (g, seat) => {
        const mine = g.all(Piece, { player: seat }).length;
        const theirs = g.all(Piece).length - mine;
        return Math.max(0, (mine - theirs) / 12);
      },
      weight: 0.5,
    },
  }),
};

const bot = createBot(game, CheckersGame, 'checkers', 2, actionHistory, 'hard', aiConfig);
```

Each `Objective` is `{ checker, weight }`. The key is the objective's name; there is no `name`/`description`/`feature` field.

The remaining hooks, all optional:

| Hook | Signature | Purpose |
|---|---|---|
| `objectives` | `(game, playerIndex) => Record<string, Objective>` | Partial-credit position evaluation during playouts |
| `threatResponseMoves` | `(game, playerIndex, availableMoves) => ThreatResponse` | Force or prioritize defensive moves. `{ moves, urgent }` — `urgent: true` restricts the search to `moves` |
| `playoutPolicy` | `(game, playerIndex, availableMoves, rng) => BotMove` | Replace random playout move selection with game-specific heuristics. Use `rng` — weighted-random, not deterministic |
| `moveOrdering` | `(game, playerIndex, moves) => BotMove[]` | Soft ordering: explore promising moves first. All moves are still explored |
| `hintTargetFromMove` | `(move) => ElementRef \| undefined` | Anchor hint/heatmap overlays when the game's destination arg is non-standard |
| `uctConstant` | `(game, playerIndex) => number` | Dynamic exploration constant, evaluated once per move selection |

### Parsing CLI Arguments

```typescript
import { parseAILevel } from 'boardsmith/ai';

parseAILevel('easy');    // 'easy'
parseAILevel('medium');  // 'medium'
parseAILevel('hard');    // 'hard'
parseAILevel('1000');    // 1000 (custom iteration ceiling)
parseAILevel('invalid'); // 'medium' (default fallback)
```

### Using MCTSBot Directly

`createBot` is a thin wrapper that resolves a difficulty into a `Partial<BotConfig>`. Construct `MCTSBot` yourself when you want to set knobs a preset does not cover.

```typescript
import { MCTSBot } from 'boardsmith/ai';

const bot = new MCTSBot(
  game,
  CheckersGame,
  'checkers',
  2,              // seat
  actionHistory,
  {
    iterations: 1000,
    uctC: 1.5,           // static exploration constant (default sqrt(2))
    timeout: Infinity,   // bound by iterations only
    seed: 'fixture-7',   // reproducible together with timeout: Infinity
    useRAVE: true,
    usePNS: true,
  },
);

const move = await bot.play();
```

`BotConfig` in full: `iterations`, `playoutDepth`, `seed`, `async`, `timeout`, `useTranspositionTable`, `parallel`, `useRAVE`, `raveK`, `uctC`, `usePNS`, `pnWeight`, `debug`. See `src/ai/types.ts` for per-field defaults and semantics.

### Search Statistics (hints and heatmaps)

`playWithStats()` returns the chosen move plus per-candidate stats — the data behind hint arrows and move heatmaps.

```typescript
const { move, stats } = await bot.playWithStats();

for (const { move: candidate, visits, value } of stats) {
  // visits: how often the search explored this child — proportional to confidence
  // value:  normalized win-rate in [0, 1]
  console.log(candidate.action, visits, value.toFixed(2));
}
```

`playWithStats()` always runs a single-mode search, even when `parallel > 1` — parallel ensembles aggregate by vote and lose per-child stats.

## How MCTS Works

The bot uses Monte Carlo Tree Search to evaluate moves:

1. **Selection** - Traverse the game tree using UCB1 to balance exploration/exploitation
2. **Expansion** - Add new game states to the tree
3. **Simulation** - Play out `playoutDepth` moves, then score the position with your `objectives`
4. **Backpropagation** - Update statistics back up the tree

The bot automatically handles:

- All valid moves for the current player
- Multi-step actions with selections
- Simultaneous steps (each co-decider enumerates against a frozen baseline)
- Undo-based state rollback instead of full snapshot restoration

## See Also

- [AI System Guide](../ai-system.md) - Detailed AI system documentation
- [boardsmith/ai-trainer](./ai-trainer.md) - Train and improve AI weights
- [boardsmith/session](./session.md) - Using AI with GameSession
