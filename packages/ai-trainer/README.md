# @boardsmith/ai-trainer

Automatic AI training for BoardSmith games through self-play simulation. Generates optimized `ai.ts` files with learned objectives.

## AI Generation Tiers

BoardSmith provides three tiers of AI generation, each suited for different needs:

### Tier 1: Zero-Config Heuristics (Automatic)

When no `ai.ts` file exists, the MCTS bot uses built-in heuristics based on game structure. This provides reasonable AI behavior out of the box with zero configuration.

**Best for:** Rapid prototyping, simple games, getting started quickly.

### Tier 2: Self-Play Training (`boardsmith train-ai`)

Automated training through self-play simulation. The trainer introspects your game, generates candidate features, runs simulations, and learns which features correlate with winning.

```bash
npx boardsmith train-ai
```

**Best for:** Production-quality AI, games where patterns can be learned from outcomes.

### Tier 3: LLM-Assisted Generation (`/generate-ai`)

Interactive AI generation using Claude Code. The LLM analyzes your game rules, asks strategic questions, and generates custom evaluation functions based on game-specific understanding.

```
/generate-ai
```

**Best for:** Complex strategy games, games requiring domain knowledge, fine-tuned behavior.

Install Claude Code slash commands with:
```bash
npx boardsmith claude install
```

## Installation

```bash
npm install @boardsmith/ai-trainer
```

## Quick Start

The easiest way to train AI is via the CLI:

```bash
npx boardsmith train-ai
```

This will:
1. Introspect your game structure
2. Generate candidate features
3. Run self-play simulations
4. Analyze which features correlate with winning
5. Generate an `ai.ts` file with learned objectives

## Programmatic Usage

```typescript
import { ParallelTrainer } from '@boardsmith/ai-trainer';
import { gameDefinition } from './my-game';

const trainer = new ParallelTrainer(
  gameDefinition.gameClass,
  'my-game',
  '/path/to/compiled/game.js', // Required for worker threads
  {
    gamesPerIteration: 200,
    iterations: 5,
  }
);

const result = await trainer.train();

console.log('Learned objectives:', result.objectives);
console.log('Action preferences:', result.actionPreferences);
```

## Training Pipeline

### 1. Introspection

Analyze game structure to understand elements, actions, and complexity:

```typescript
import { introspectGame, printGameStructure } from '@boardsmith/ai-trainer';

const structure = introspectGame(gameDefinition);
printGameStructure(structure);

// Output:
// Game: Checkers
// Players: 2
// Element Types: Piece (24), Board (1), Cell (64)
// Actions: move, jump, endTurn
// Estimated complexity: medium
```

### 2. Feature Generation

Generate candidate features that might predict winning:

```typescript
import { generateCandidateFeatures, printFeatures } from '@boardsmith/ai-trainer';

const features = generateCandidateFeatures(structure);
printFeatures(features);

// Output:
// Position Features:
//   - pieces_in_center: Count of pieces in center squares
//   - pieces_advanced: Count of pieces past midline
// Material Features:
//   - piece_count: Total pieces owned
//   - piece_advantage: My pieces - opponent pieces
```

### 3. Simulation

Run self-play games and collect data:

```typescript
import { runSimulations } from '@boardsmith/ai-trainer';

const results = await runSimulations(gameDefinition, {
  games: 200,
  features,
  mctsIterations: 3,
  onProgress: (current, total) => console.log(`${current}/${total}`),
});

console.log(`Completed ${results.gamesPlayed} games`);
console.log(`Average game length: ${results.averageTurns} turns`);
```

### 4. Analysis

Determine which features correlate with winning:

```typescript
import { analyzeFeatures, selectTopFeatures } from '@boardsmith/ai-trainer';

const analysis = analyzeFeatures(results.gameData, features);
const topFeatures = selectTopFeatures(analysis, { maxFeatures: 5 });

for (const feature of topFeatures) {
  console.log(`${feature.name}: correlation ${feature.correlation.toFixed(3)}`);
}
```

### 5. Code Generation

Generate the `ai.ts` file:

```typescript
import { generateAICode } from '@boardsmith/ai-trainer';

const code = generateAICode({
  objectives: topFeatures.map(f => ({
    name: f.name,
    weight: correlationToWeight(f.correlation),
    checker: f.checker,
  })),
  actionPreferences: analysis.actionPreferences,
});

fs.writeFileSync('rules/ai.ts', code);
```

## Incremental Training

Start from an existing `ai.ts` file and improve it:

```typescript
import { ParallelTrainer } from '@boardsmith/ai-trainer';

// Train with existing AI file as starting point
const trainer = new ParallelTrainer(
  gameDefinition.gameClass,
  'my-game',
  '/path/to/compiled/game.js',
  {
    existingAIPath: 'rules/ai.ts', // Will parse and build upon existing objectives
    iterations: 3,
  }
);

const result = await trainer.train();
```

## Feature Templates

Built-in feature templates for common patterns:

```typescript
import { FEATURE_TEMPLATES } from '@boardsmith/ai-trainer';

// Available templates:
// - position_control: Center, corners, edges
// - material_count: Piece counts and advantages
// - mobility: Available moves
// - threats: Attack and defense positions
// - progress: Advancement toward goals
```

## API Reference

### ParallelTrainer

```typescript
class ParallelTrainer {
  constructor(
    GameClass: GameClass,
    gameType: string,
    gameModulePath: string,  // Path to compiled .js file (required for workers)
    config?: ParallelTrainingConfig
  )

  train(): Promise<TrainingResult>
}

interface ParallelTrainingConfig {
  gamesPerIteration?: number;  // Default: 200
  iterations?: number;         // Default: 5
  mctsIterations?: number;     // Default: 15
  workerCount?: number;        // Default: CPU cores - 1
  existingAIPath?: string;     // Path to existing ai.ts to build upon
  evolve?: boolean;            // Enable evolutionary weight optimization
  evolutionGenerations?: number; // Default: 5
  evolutionLambda?: number;    // Population size, default: 20
  onProgress?: (progress: TrainingProgress) => void;
}

interface TrainingResult {
  objectives: LearnedObjective[];
  actionPreferences: LearnedActionPreference[];
  metadata: {
    gamesPlayed: number;
    totalStates: number;
    finalWinRate: number;
  };
}
```

### introspectGame()

```typescript
function introspectGame(gameDefinition: GameDefinition): GameStructure

interface GameStructure {
  gameName: string;
  playerCount: { min: number; max: number };
  elementTypes: ElementTypeInfo[];
  actions: string[];
  spatialInfo: SpatialInfo;
  complexity: GameComplexity;
}
```

## Parallel Training

Training always uses parallel mode with worker threads for maximum performance:

```bash
npx boardsmith train-ai --workers 8  # Use 8 workers (default: CPU cores - 1)
```

This distributes game simulations and evolution benchmarks across multiple CPU cores.

### Performance

Parallel training achieves significant speedup on multi-core systems:

| Workers  | Time (50 games) | CPU Usage | Speedup |
|----------|-----------------|-----------|---------|
| 1        | 171s            | ~100%     | 1x      |
| 11       | 21s             | ~970%     | 8.3x    |

*Benchmark: Go Fish game on Apple M3 Pro (12 cores)*

### How It Works

1. The main process generates game seeds and distributes work to workers
2. Each worker runs simulations independently with its own game instance
3. Results are aggregated for feature analysis
4. Evolution benchmarks also run in parallel across workers
5. Same seed produces identical aggregate results regardless of worker count (deterministic)

## CLI Options

```bash
npx boardsmith train-ai [options]

Options:
  -g, --games <count>       Games per iteration (default: 200)
  -i, --iterations <count>  Training iterations (default: 5)
  -o, --output <path>       Output path for ai.ts
  -m, --mcts <iterations>   MCTS iterations per move (default: 15)
  --fresh                   Ignore existing ai.ts and start fresh
  --workers <count>         Number of worker threads (default: CPU cores - 1)
  --evolve                  Enable evolutionary weight optimization
  --generations <count>     Evolution generations (default: 5)
  --population <count>      Evolution population size (default: 20)
  -v, --verbose             Show detailed progress
```

## See Also

- [@boardsmith/ai](../ai/README.md) - MCTS bot that uses trained objectives
- [Common Patterns](../../docs/common-patterns.md) - AI integration patterns
