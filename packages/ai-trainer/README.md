# @boardsmith/ai-trainer

Automatic AI training for BoardSmith games through self-play simulation. Generates optimized `ai.ts` files with learned objectives.

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
import { trainAI } from '@boardsmith/ai-trainer';
import { gameDefinition } from './my-game';

const result = await trainAI(gameDefinition, {
  gamesPerIteration: 200,
  iterations: 5,
  verbose: true,
});

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
import { parseExistingAI, trainAI } from '@boardsmith/ai-trainer';

// Parse existing AI
const existing = parseExistingAI('rules/ai.ts');

// Train with existing as starting point
const result = await trainAI(gameDefinition, {
  existingObjectives: existing.objectives,
  iterations: 3,
});
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

### trainAI()

```typescript
function trainAI(
  gameDefinition: GameDefinition,
  config?: TrainingConfig
): Promise<TrainingResult>

interface TrainingConfig {
  gamesPerIteration?: number;  // Default: 200
  iterations?: number;         // Default: 5
  mctsIterations?: number;     // Default: 3
  verbose?: boolean;
  existingObjectives?: LearnedObjective[];
  onProgress?: (progress: TrainingProgress) => void;
}

interface TrainingResult {
  objectives: LearnedObjective[];
  actionPreferences: LearnedActionPreference[];
  stats: {
    gamesPlayed: number;
    averageTurns: number;
    winRates: Record<number, number>;
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

## CLI Options

```bash
npx boardsmith train-ai [options]

Options:
  -g, --games <count>     Games per iteration (default: 200)
  -i, --iterations <count> Training iterations (default: 5)
  -o, --output <path>     Output path for ai.ts
  -m, --mcts <iterations> MCTS iterations per move (default: 3)
  --fresh                 Ignore existing ai.ts and start fresh
  -v, --verbose           Show detailed progress
```

## See Also

- [@boardsmith/ai](../ai/README.md) - MCTS bot that uses trained objectives
- [Common Patterns](../../docs/common-patterns.md) - AI integration patterns
