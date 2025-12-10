# MCTS AI Implementation Plan

**STATUS: IMPLEMENTED**

## Overview

Build a generic MCTS (Monte-Carlo Tree Search) AI system that can play any BoardSmith game, integrated into both dev mode and production.

## Implementation Summary

### What Was Built

1. **`packages/ai`** - New package with MCTS bot implementation
   - `src/types.ts` - BotConfig, BotMove, MCTSNode, Objective interfaces
   - `src/mcts-bot.ts` - Full MCTS algorithm (select, expand, playout, backpropagate)
   - `src/utils.ts` - Seeded random number generator
   - `src/index.ts` - Public API with `createBot()` factory

2. **CLI Integration** (`packages/cli`)
   - Added `--ai <players...>` option to specify AI player positions
   - Added `--ai-level <level>` option (easy/medium/hard/expert or iteration count)
   - Updated `local-server.ts` with AI auto-play in GameSession

3. **Game Objectives** - AI hints for each game:
   - `checkers/rules/src/ai.ts` - piece-advantage, king-advantage, center-control, etc.
   - `go-fish/rules/src/ai.ts` - book-lead, near-book, rank-diversity, etc.
   - `cribbage/rules/src/ai.ts` - score-lead, near-win, block-opponent-win, etc.

4. **Game Definition Schema** - Each game now exports `ai.objectives` in `gameDefinition`

### Usage

```bash
# Play against AI on player 1
boardsmith dev --ai 1

# Set difficulty
boardsmith dev --ai 1 --ai-level hard
boardsmith dev --ai 1 --ai-level 500  # custom iteration count

# Multiple AI players
boardsmith dev --ai 0 2 --ai-level medium
```

### Difficulty Presets

| Level | Iterations | Playout Depth |
|-------|------------|---------------|
| easy | 10 | 10 |
| medium | 100 | 30 |
| hard | 1000 | 50 |
| expert | 2000 | 100 |

---

## Goals

1. Create `packages/ai` with MCTS implementation
2. Add CLI options for AI players in dev mode (`boardsmith dev --ai 1 --ai-level 100`)
3. Integrate AI into the 3 demo games (Go Fish, Checkers, Cribbage)
4. Add optional objectives system for game-specific AI hints
5. Update game definition schema to support AI configuration
6. Test thoroughly across all games

---

## Phase 1: Create packages/ai

### 1.1 Package Setup

Create new package at `packages/ai/`:

```
packages/ai/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts           # Public exports
    ├── mcts-bot.ts        # MCTS implementation
    ├── types.ts           # Interfaces and types
    └── utils.ts           # Helper functions
```

**package.json:**
```json
{
  "name": "@boardsmith/ai",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@boardsmith/engine": "workspace:*"
  }
}
```

### 1.2 Types Definition (src/types.ts)

```typescript
import type { Game, Player, FlowState } from '@boardsmith/engine';

export interface BotConfig {
  /** Number of MCTS iterations (higher = stronger, slower) */
  iterations: number;
  /** Maximum playout depth before evaluating */
  playoutDepth: number;
  /** Random seed for reproducibility */
  seed?: string;
  /** Whether to run async (yield to event loop) */
  async?: boolean;
}

export interface BotMove {
  action: string;
  args: Record<string, unknown>;
}

export interface MCTSNode {
  state: GameSnapshot;
  parent: MCTSNode | null;
  parentMove: BotMove | null;
  children: MCTSNode[];
  untriedMoves: BotMove[];
  visits: number;
  value: number;
  playerIndex: number;
}

export interface GameSnapshot {
  serialized: unknown;
  flowState: FlowState;
}

export interface Objective {
  /** Function to check if objective is met */
  checker: (game: Game, playerIndex: number) => boolean;
  /** Weight for this objective (positive = good, negative = bad) */
  weight: number;
}

export interface AIConfig {
  /** Optional objectives for guiding AI decisions */
  objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
}

export const DEFAULT_CONFIG: BotConfig = {
  iterations: 1000,
  playoutDepth: 50,
  async: false,
};

export const DIFFICULTY_PRESETS: Record<string, Partial<BotConfig>> = {
  easy: { iterations: 10, playoutDepth: 10 },
  medium: { iterations: 100, playoutDepth: 30 },
  hard: { iterations: 1000, playoutDepth: 50 },
  expert: { iterations: 2000, playoutDepth: 100 },
};
```

### 1.3 MCTS Bot Implementation (src/mcts-bot.ts)

Core algorithm:

```typescript
export class MCTSBot {
  private game: Game;
  private playerIndex: number;
  private config: BotConfig;
  private objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
  private rng: () => number;

  constructor(
    game: Game,
    playerIndex: number,
    config: Partial<BotConfig> = {},
    aiConfig?: AIConfig
  ) {
    this.game = game;
    this.playerIndex = playerIndex;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.objectives = aiConfig?.objectives;
    this.rng = createSeededRandom(this.config.seed);
  }

  async play(): Promise<BotMove> {
    const root = this.createNode(this.captureState(), null, null);

    for (let i = 0; i < this.config.iterations; i++) {
      const leaf = this.select(root);
      const child = this.expand(leaf);
      const result = this.playout(child);
      this.backpropagate(child, result);

      // Yield to event loop in async mode
      if (this.config.async && i % 25 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    // Select best child (most visits)
    const best = root.children.reduce((a, b) =>
      a.visits > b.visits ? a : b
    );

    return best.parentMove!;
  }

  private select(node: MCTSNode): MCTSNode {
    while (node.untriedMoves.length === 0 && node.children.length > 0) {
      node = this.selectChild(node);
    }
    return node;
  }

  private selectChild(node: MCTSNode): MCTSNode {
    // UCT formula: value/visits + C * sqrt(ln(parent.visits) / visits)
    const C = Math.sqrt(2);
    let best = node.children[0];
    let bestUCT = -Infinity;

    for (const child of node.children) {
      const exploitation = child.value / (child.visits + 1e-6);
      const exploration = C * Math.sqrt(Math.log(node.visits + 1) / (child.visits + 1e-6));
      const uct = exploitation + exploration;

      if (uct > bestUCT) {
        bestUCT = uct;
        best = child;
      }
    }
    return best;
  }

  private expand(node: MCTSNode): MCTSNode {
    if (node.untriedMoves.length === 0) return node;

    // Pick random untried move
    const idx = Math.floor(this.rng() * node.untriedMoves.length);
    const move = node.untriedMoves.splice(idx, 1)[0];

    // Apply move to get new state
    const newState = this.applyMove(node.state, move);
    const child = this.createNode(newState, node, move);
    node.children.push(child);

    return child;
  }

  private playout(node: MCTSNode): number {
    let state = this.cloneState(node.state);
    let depth = 0;

    while (!state.flowState.complete && depth < this.config.playoutDepth) {
      // Check objectives for early scoring
      if (this.objectives) {
        const score = this.evaluateObjectives(state);
        if (score !== 0) return score;
      }

      const moves = this.getAvailableMoves(state);
      if (moves.length === 0) break;

      const move = moves[Math.floor(this.rng() * moves.length)];
      state = this.applyMove(state, move);
      depth++;
    }

    return this.evaluateTerminal(state);
  }

  private backpropagate(node: MCTSNode | null, result: number): void {
    while (node !== null) {
      node.visits++;
      // Flip result based on whose perspective
      const perspective = node.playerIndex === this.playerIndex ? 1 : -1;
      node.value += result * perspective;
      node = node.parent;
    }
  }

  // Helper methods for game state manipulation
  private captureState(): GameSnapshot { /* ... */ }
  private cloneState(state: GameSnapshot): GameSnapshot { /* ... */ }
  private applyMove(state: GameSnapshot, move: BotMove): GameSnapshot { /* ... */ }
  private getAvailableMoves(state: GameSnapshot): BotMove[] { /* ... */ }
  private evaluateObjectives(state: GameSnapshot): number { /* ... */ }
  private evaluateTerminal(state: GameSnapshot): number { /* ... */ }
  private createNode(...): MCTSNode { /* ... */ }
}
```

### 1.4 Move Enumeration (critical piece)

```typescript
private getAvailableMoves(state: GameSnapshot): BotMove[] {
  const game = this.restoreGame(state);
  const flowState = game.getFlowState();

  if (!flowState?.awaitingInput) return [];

  const moves: BotMove[] = [];
  const actions = flowState.availableActions ?? [];
  const player = game.players[flowState.currentPlayer ?? this.playerIndex];

  for (const actionName of actions) {
    const actionDef = game.getAction(actionName);
    if (!actionDef) continue;

    // Generate all combinations of selections
    const argCombinations = this.enumerateSelections(game, actionDef, player);

    for (const args of argCombinations) {
      moves.push({ action: actionName, args });
    }
  }

  return moves;
}

private enumerateSelections(
  game: Game,
  actionDef: ActionDefinition,
  player: Player
): Record<string, unknown>[] {
  const selections = actionDef.selections;
  if (selections.length === 0) return [{}];

  // Recursively build all combinations
  return this.enumerateSelectionsRecursive(game, selections, player, 0, {});
}

private enumerateSelectionsRecursive(
  game: Game,
  selections: Selection[],
  player: Player,
  index: number,
  currentArgs: Record<string, unknown>
): Record<string, unknown>[] {
  if (index >= selections.length) {
    return [{ ...currentArgs }];
  }

  const selection = selections[index];
  const choices = game.getSelectionChoices(
    /* actionName */ '',  // Need to pass action name
    selection.name,
    player,
    currentArgs
  );

  if (choices.length === 0) {
    // Optional selection or no valid choices
    if (selection.optional) {
      return this.enumerateSelectionsRecursive(game, selections, player, index + 1, currentArgs);
    }
    return [];
  }

  const results: Record<string, unknown>[] = [];
  for (const choice of choices) {
    const newArgs = { ...currentArgs, [selection.name]: choice };
    const subResults = this.enumerateSelectionsRecursive(game, selections, player, index + 1, newArgs);
    results.push(...subResults);
  }

  return results;
}
```

### 1.5 Public API (src/index.ts)

```typescript
export { MCTSBot } from './mcts-bot.js';
export {
  BotConfig,
  BotMove,
  AIConfig,
  Objective,
  DIFFICULTY_PRESETS,
  DEFAULT_CONFIG
} from './types.js';

// Convenience factory
export function createBot(
  game: Game,
  playerIndex: number,
  difficulty: 'easy' | 'medium' | 'hard' | 'expert' | number = 'medium',
  aiConfig?: AIConfig
): MCTSBot {
  const config = typeof difficulty === 'number'
    ? { iterations: difficulty }
    : DIFFICULTY_PRESETS[difficulty];

  return new MCTSBot(game, playerIndex, config, aiConfig);
}
```

---

## Phase 2: CLI Integration

### 2.1 Update DevOptions Interface

**File:** `packages/cli/src/commands/dev.ts`

```typescript
interface DevOptions {
  port: string;
  players: string;
  workerPort: string;
  ai?: string[];        // Player indices to be AI (e.g., ['1', '0,2'])
  aiLevel?: string;     // Difficulty level or iteration count
}
```

### 2.2 Update CLI Registration

**File:** `packages/cli/src/cli.ts`

```typescript
program
  .command('dev')
  .description('Start local development server')
  .option('-p, --port <port>', 'UI server port', '5173')
  .option('--players <count>', 'Number of player tabs to open', '2')
  .option('--worker-port <port>', 'Worker/API server port', '8787')
  .option('--ai <players...>', 'Player positions to be AI (e.g., --ai 1 or --ai 0 2)')
  .option('--ai-level <level>', 'AI difficulty: easy, medium, hard, expert, or iteration count', 'medium')
  .action(devCommand);
```

### 2.3 Update LocalServer to Support AI Players

**File:** `packages/cli/src/local-server.ts`

Add AI configuration to LocalServerOptions:

```typescript
interface LocalServerOptions {
  port: number;
  definitions: GameDefinition[];
  onReady?: (port: number) => void;
  aiConfig?: {
    players: number[];           // Which player indices are AI
    level: string | number;      // Difficulty
  };
}
```

### 2.4 Update GameSession for AI Auto-Play

```typescript
class GameSession {
  readonly #runner: GameRunner;
  readonly #aiPlayers: Map<number, MCTSBot> = new Map();
  readonly #aiConfig?: { players: number[]; level: string | number };

  constructor(
    gameType: string,
    GameClass: GameClass,
    playerCount: number,
    playerNames: string[],
    seed?: string,
    aiConfig?: { players: number[]; level: string | number }
  ) {
    // ... existing constructor code ...

    this.#aiConfig = aiConfig;

    // Initialize AI players after game starts
    if (aiConfig) {
      for (const playerIndex of aiConfig.players) {
        if (playerIndex < playerCount) {
          const bot = createBot(
            this.#runner.game,
            playerIndex,
            aiConfig.level as any
          );
          this.#aiPlayers.set(playerIndex, bot);
        }
      }
    }

    this.#runner.start();

    // Check if AI should move immediately
    this.#checkAITurn();
  }

  async #checkAITurn(): Promise<void> {
    const flowState = this.#runner.getFlowState();
    if (!flowState?.awaitingInput) return;

    const currentPlayer = flowState.currentPlayer;
    if (currentPlayer === undefined) return;

    const bot = this.#aiPlayers.get(currentPlayer);
    if (!bot) return;

    // Small delay so humans can see the state
    await new Promise(resolve => setTimeout(resolve, 500));

    const move = await bot.play();
    this.performAction(move.action, currentPlayer, move.args);
  }

  performAction(action: string, player: number, args: Record<string, unknown>) {
    // ... existing performAction code ...

    // After human action, check if AI should respond
    if (result.success) {
      this.#checkAITurn();
    }

    return result;
  }
}
```

### 2.5 Update devCommand to Pass AI Config

```typescript
export async function devCommand(options: DevOptions): Promise<void> {
  // Parse AI options
  const aiPlayers = options.ai
    ? options.ai.flatMap(s => s.split(',').map(n => parseInt(n.trim(), 10)))
    : [];

  const aiLevel = options.aiLevel ?? 'medium';

  // ... existing code ...

  server = createLocalServer({
    port: workerPort,
    definitions: [gameDefinition],
    onReady: (p) => { /* ... */ },
    aiConfig: aiPlayers.length > 0 ? { players: aiPlayers, level: aiLevel } : undefined,
  });

  // Only open browser tabs for human players
  const humanPlayers = Array.from({ length: playerCount }, (_, i) => i)
    .filter(i => !aiPlayers.includes(i));

  for (const i of humanPlayers) {
    const url = `http://localhost:${port}/game/${gameId}/${i}`;
    await open(url);
  }
}
```

---

## Phase 3: Game Definition Schema Update

### 3.1 Update GameDefinition Interface

**File:** `packages/worker/src/index.ts`

```typescript
export interface GameDefinition {
  gameClass: GameClass;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
  displayName?: string;

  /** Optional AI configuration */
  ai?: {
    /** Objectives function for guiding AI decisions */
    objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
    /** Default difficulty for this game */
    defaultDifficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  };
}
```

### 3.2 Update boardsmith.json Schema

Add optional AI config:

```json
{
  "name": "checkers",
  "displayName": "Checkers",
  "minPlayers": 2,
  "maxPlayers": 2,
  "rulesPackage": "@boardsmith/checkers-rules",
  "paths": {
    "rules": "./rules/src",
    "ui": "./ui"
  },
  "ai": {
    "defaultDifficulty": "medium"
  }
}
```

---

## Phase 4: Integrate with Demo Games

### 4.1 Checkers AI Objectives

**File:** `packages/games/checkers/rules/src/ai.ts`

```typescript
import type { Objective } from '@boardsmith/ai';
import type { CheckersGame } from './game.js';

export function getCheckersObjectives(
  game: CheckersGame,
  playerIndex: number
): Record<string, Objective> {
  const player = game.players[playerIndex];
  const opponent = game.players[1 - playerIndex];

  return {
    'piece-advantage': {
      checker: () => {
        const myPieces = game.getPlayerPieces(player).length;
        const theirPieces = game.getPlayerPieces(opponent).length;
        return myPieces > theirPieces;
      },
      weight: 5,
    },
    'king-advantage': {
      checker: () => {
        const myKings = game.getPlayerPieces(player).filter(p => p.isKing).length;
        const theirKings = game.getPlayerPieces(opponent).filter(p => p.isKing).length;
        return myKings > theirKings;
      },
      weight: 10,
    },
    'center-control': {
      checker: () => {
        const centerSquares = [27, 28, 35, 36]; // Center 4 squares
        const myPiecesInCenter = game.getPlayerPieces(player)
          .filter(p => centerSquares.includes(p.container?.id ?? -1)).length;
        return myPiecesInCenter >= 2;
      },
      weight: 3,
    },
  };
}
```

**Update index.ts:**
```typescript
export const gameDefinition = {
  gameClass: CheckersGame,
  gameType: 'checkers',
  displayName: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCheckersObjectives,
    defaultDifficulty: 'medium',
  },
} as const;
```

### 4.2 Go Fish AI Objectives

**File:** `packages/games/go-fish/rules/src/ai.ts`

```typescript
import type { Objective } from '@boardsmith/ai';
import type { GoFishGame } from './game.js';

export function getGoFishObjectives(
  game: GoFishGame,
  playerIndex: number
): Record<string, Objective> {
  const player = game.players[playerIndex] as GoFishPlayer;

  return {
    'book-lead': {
      checker: () => {
        const myBooks = player.bookCount;
        const maxOpponentBooks = Math.max(
          ...game.players
            .filter(p => p !== player)
            .map(p => (p as GoFishPlayer).bookCount)
        );
        return myBooks > maxOpponentBooks;
      },
      weight: 10,
    },
    'large-hand': {
      checker: () => {
        const hand = game.all(Hand).find(h => h.owner === player);
        return (hand?.all(Card).length ?? 0) >= 5;
      },
      weight: 2,
    },
  };
}
```

### 4.3 Cribbage AI Objectives

**File:** `packages/games/cribbage/rules/src/ai.ts`

```typescript
import type { Objective } from '@boardsmith/ai';
import type { CribbageGame } from './game.js';

export function getCribbageObjectives(
  game: CribbageGame,
  playerIndex: number
): Record<string, Objective> {
  const player = game.players[playerIndex] as CribbagePlayer;
  const opponent = game.players[1 - playerIndex] as CribbagePlayer;

  return {
    'score-lead': {
      checker: () => player.score > opponent.score,
      weight: 5,
    },
    'near-win': {
      checker: () => player.score >= 100,
      weight: 20,
    },
    'prevent-opponent-win': {
      checker: () => opponent.score < 100,
      weight: 15,
    },
  };
}
```

---

## Phase 5: Testing

### 5.1 Unit Tests for MCTS Bot

**File:** `packages/ai/src/__tests__/mcts-bot.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { MCTSBot, createBot, DIFFICULTY_PRESETS } from '../index.js';

describe('MCTSBot', () => {
  describe('move enumeration', () => {
    it('should enumerate all valid moves for simple game', async () => {
      // Test with mock game
    });

    it('should handle multi-step selections', async () => {
      // Test choosePlayer -> chooseFrom sequences
    });
  });

  describe('MCTS algorithm', () => {
    it('should explore more with higher iterations', async () => {
      // Compare tree sizes
    });

    it('should be deterministic with same seed', async () => {
      // Same seed = same moves
    });
  });

  describe('difficulty presets', () => {
    it('should have increasing iterations for higher difficulties', () => {
      expect(DIFFICULTY_PRESETS.easy.iterations).toBeLessThan(
        DIFFICULTY_PRESETS.hard.iterations!
      );
    });
  });
});
```

### 5.2 Integration Tests with Real Games

**File:** `packages/ai/src/__tests__/integration.test.ts`

```typescript
describe('AI Integration', () => {
  describe('Checkers', () => {
    it('should complete a full game against itself', async () => {
      const game = new CheckersGame({ playerCount: 2 });
      const bot0 = createBot(game, 0, 'easy');
      const bot1 = createBot(game, 1, 'easy');

      game.startFlow();

      let moves = 0;
      while (!game.getFlowState()?.complete && moves < 200) {
        const currentPlayer = game.getFlowState()?.currentPlayer ?? 0;
        const bot = currentPlayer === 0 ? bot0 : bot1;
        const move = await bot.play();
        game.continueFlow(move.action, move.args, currentPlayer);
        moves++;
      }

      expect(game.getFlowState()?.complete).toBe(true);
    });

    it('hard AI should beat easy AI most of the time', async () => {
      let hardWins = 0;
      const rounds = 10;

      for (let i = 0; i < rounds; i++) {
        // Play game, count wins
      }

      expect(hardWins).toBeGreaterThan(rounds * 0.6);
    });
  });

  describe('Go Fish', () => {
    it('should complete a full game', async () => {
      // Similar test for Go Fish
    });
  });

  describe('Cribbage', () => {
    it('should complete a full game', async () => {
      // Similar test for Cribbage
    });
  });
});
```

### 5.3 CLI Integration Tests

**File:** `packages/cli/src/__tests__/dev-ai.test.ts`

```typescript
describe('boardsmith dev --ai', () => {
  it('should parse AI player indices correctly', () => {
    // Test CLI argument parsing
  });

  it('should create AI bots for specified players', () => {
    // Test GameSession initialization
  });

  it('should auto-play when AI turn', () => {
    // Test auto-play behavior
  });
});
```

---

## Phase 6: Documentation

### 6.1 Update README

Add section on AI usage:

```markdown
## AI Opponents

BoardSmith includes a built-in MCTS AI that works with any game.

### Dev Mode

```bash
# Play against AI on player 1
boardsmith dev --ai 1

# Set difficulty (easy, medium, hard, expert, or iteration count)
boardsmith dev --ai 1 --ai-level hard
boardsmith dev --ai 1 --ai-level 500

# Multiple AI players
boardsmith dev --ai 1 2 --ai-level medium
```

### Programmatic Usage

```typescript
import { createBot } from '@boardsmith/ai';

const bot = createBot(game, playerIndex, 'hard');
const move = await bot.play();
game.continueFlow(move.action, move.args, playerIndex);
```

### Custom Objectives

Games can define objectives to guide AI decisions:

```typescript
export const gameDefinition = {
  // ...
  ai: {
    objectives: (game, playerIndex) => ({
      'my-objective': {
        checker: (g) => /* return true if good */,
        weight: 10,
      },
    }),
  },
};
```
```

---

## Implementation Order

1. **Phase 1.1-1.2**: Package setup and types (30 min)
2. **Phase 1.3-1.4**: MCTS core algorithm (2-3 hours)
3. **Phase 1.5**: Public API (15 min)
4. **Phase 2**: CLI integration (1 hour)
5. **Phase 3**: Schema updates (30 min)
6. **Phase 4**: Game-specific objectives (1 hour)
7. **Phase 5**: Testing (2 hours)
8. **Phase 6**: Documentation (30 min)

---

## Files to Create/Modify

### New Files
- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/src/index.ts`
- `packages/ai/src/types.ts`
- `packages/ai/src/mcts-bot.ts`
- `packages/ai/src/utils.ts`
- `packages/ai/src/__tests__/mcts-bot.test.ts`
- `packages/ai/src/__tests__/integration.test.ts`
- `packages/games/checkers/rules/src/ai.ts`
- `packages/games/go-fish/rules/src/ai.ts`
- `packages/games/cribbage/rules/src/ai.ts`

### Modified Files
- `packages/cli/src/cli.ts` - Add --ai and --ai-level options
- `packages/cli/src/commands/dev.ts` - Parse AI options, pass to server
- `packages/cli/src/local-server.ts` - AI auto-play in GameSession
- `packages/worker/src/index.ts` - Update GameDefinition interface
- `packages/games/*/rules/src/index.ts` - Export AI config
- `packages/games/*/boardsmith.json` - Add AI defaults
- `pnpm-workspace.yaml` - Add packages/ai

---

## Success Criteria

1. `boardsmith dev --ai 1` works for all 3 demo games
2. AI makes legal moves in all game states
3. AI difficulty scales with --ai-level setting
4. Hard AI beats easy AI >60% of the time in Checkers
5. Games complete without errors or infinite loops
6. All tests pass
