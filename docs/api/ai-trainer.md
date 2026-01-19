# boardsmith/ai-trainer

> Tools for training and improving AI weights.

## When to Use

Import from `boardsmith/ai-trainer` when you want to train AI weights for your game, analyze game features, or generate AI code. This package provides parallel training infrastructure for evolving optimal AI strategies.

## Usage

```typescript
import {
  ParallelTrainer,
  WeightEvolver,
  introspectGame,
  generateCandidateFeatures,
  generateAICode,
} from 'boardsmith/ai-trainer';
```

## Exports

### Training

- `ParallelTrainer` - Multi-threaded AI training
- `WeightEvolver` - Evolve optimal weights
- `DEFAULT_TRAINING_CONFIG` - Default training configuration

### Introspection

- `introspectGame()` - Analyze game structure
- `createIntrospectionGame()` - Create game for analysis
- `printGameStructure()` - Print game structure
- `estimateComplexity()` - Estimate game complexity

### Feature Generation

- `generateCandidateFeatures()` - Generate potential AI features
- `filterFeaturesByCategory()` - Filter features by category
- `getFeatureSummary()` - Get feature summary
- `printFeatures()` - Print features

### Feature Templates

- `FEATURE_TEMPLATES` - Built-in feature templates

### Simulation

- `runSimulations()` - Run game simulations
- `simulateSingleGame()` - Simulate one game
- `serializeGameStructure()` - Serialize for workers
- `deserializeGameStructure()` - Deserialize from workers

### Parallel Simulation

- `runParallelSimulations()` - Run simulations in parallel

### Benchmarking

- `runParallelBenchmarks()` - Benchmark AI performance
- `benchmarkAI()` - Run AI benchmark

### Analysis

- `analyzeFeatures()` - Analyze feature effectiveness
- `analyzeActions()` - Analyze action patterns
- `selectTopFeatures()` - Select best features
- `correlationToWeight()` - Convert correlation to weight
- `printAnalysisSummary()` - Print analysis results

### Code Generation

- `generateAICode()` - Generate AI TypeScript code
- `updateAIWeights()` - Update weights in existing AI file

### AI File Parsing

- `parseExistingAI()` - Parse existing AI file
- `parsedToLearned()` - Convert parsed to learned format
- `mergeObjectives()` - Merge objective sets
- `getCumulativeStats()` - Get cumulative statistics

### Evolution Utilities

- `createSeededRandom()` - Create seeded random
- `mutateWeights()` - Mutate weight values
- `crossoverWeights()` - Crossover two weight sets
- `selectBest()` - Select best individuals
- `generateOffspring()` - Generate offspring

### Types

- `GameClass` - Game class constructor
- `GameStructure` - Analyzed game structure
- `ElementTypeInfo` - Element type information
- `PlayerTypeInfo` - Player type information
- `SpatialInfo` - Spatial relationship info
- `CandidateFeature` - Candidate feature
- `StateSnapshot` - State snapshot
- `GameData` - Game data for analysis
- `FeatureStats` - Feature statistics
- `ActionStats` - Action statistics
- `LearnedObjective` - Learned AI objective
- `LearnedActionPreference` - Action preference
- `TrainingResult` - Training result
- `TrainingConfig` - Training configuration
- `TrainingProgress` - Training progress
- `ParallelTrainingConfig` - Parallel training config
- `WeightEvolverConfig` - Weight evolver config
- `WeightEvolutionResult` - Evolution result
- `BenchmarkConfig` - Benchmark configuration
- `BenchmarkResult` - Benchmark result
- `PlayerConfig` - Player configuration
- `SimulationOptions` - Simulation options
- `SimulationResults` - Simulation results
- `ParallelSimulatorOptions` - Parallel simulation options
- `ParallelBenchmarkOptions` - Parallel benchmark options
- `IndividualFitness` - Individual fitness score
- `CodeGeneratorOptions` - Code generator options
- `UpdateWeightsOptions` - Update weights options
- `ParsedAIFile` - Parsed AI file
- `ParsedObjective` - Parsed objective
- `FeatureTemplate` - Feature template

## Examples

### Quick Weight Evolution

```typescript
import { WeightEvolver } from 'boardsmith/ai-trainer';
import { MyGame } from './game';

const evolver = new WeightEvolver({
  GameClass: MyGame,
  gameType: 'my-game',
  populationSize: 20,
  generations: 50,
  gamesPerEvaluation: 10,
});

const result = await evolver.evolve((progress) => {
  console.log(`Gen ${progress.generation}: best fitness ${progress.bestFitness}`);
});

console.log('Best weights:', result.bestWeights);
console.log('Final fitness:', result.fitness);
```

### Full Training Pipeline

```typescript
import {
  introspectGame,
  generateCandidateFeatures,
  runParallelSimulations,
  analyzeFeatures,
  selectTopFeatures,
  generateAICode,
} from 'boardsmith/ai-trainer';
import { MyGame } from './game';

// 1. Analyze game structure
const structure = introspectGame(MyGame);
console.log(`Found ${structure.elementTypes.length} element types`);

// 2. Generate candidate features
const features = generateCandidateFeatures(structure);
console.log(`Generated ${features.length} candidate features`);

// 3. Run simulations to gather data
const simResults = await runParallelSimulations({
  GameClass: MyGame,
  gameType: 'my-game',
  gameCount: 1000,
  workers: 4,
});

// 4. Analyze feature correlations
const analysis = analyzeFeatures(simResults.gameData, features);

// 5. Select top performing features
const topFeatures = selectTopFeatures(analysis, 10);

// 6. Generate AI code
const aiCode = generateAICode({
  features: topFeatures,
  gameType: 'my-game',
});

// Write to file
writeFileSync('./src/ai.ts', aiCode);
```

### Updating Existing AI

```typescript
import { parseExistingAI, updateAIWeights } from 'boardsmith/ai-trainer';
import { readFileSync, writeFileSync } from 'fs';

// Parse existing AI file
const content = readFileSync('./src/ai.ts', 'utf-8');
const parsed = parseExistingAI(content);

console.log(`Found ${parsed.objectives.length} objectives`);

// Update weights based on new training
const newWeights = { 'piece-count': 0.15, 'board-control': 0.25 };

const updated = updateAIWeights({
  content,
  weights: newWeights,
});

writeFileSync('./src/ai.ts', updated);
```

### Parallel Training

```typescript
import { ParallelTrainer } from 'boardsmith/ai-trainer';
import { MyGame } from './game';

const trainer = new ParallelTrainer({
  GameClass: MyGame,
  gameType: 'my-game',
  workers: 8,
  gamesPerGeneration: 100,
  generations: 100,
  populationSize: 50,
});

trainer.on('generation', (gen, stats) => {
  console.log(`Generation ${gen}:`);
  console.log(`  Best: ${stats.bestFitness}`);
  console.log(`  Average: ${stats.averageFitness}`);
});

const result = await trainer.train();
```

### Benchmarking AI Versions

```typescript
import { benchmarkAI } from 'boardsmith/ai-trainer';
import { MyGame } from './game';

const results = await benchmarkAI({
  GameClass: MyGame,
  gameType: 'my-game',
  players: [
    { type: 'ai', config: oldAI, name: 'Old AI' },
    { type: 'ai', config: newAI, name: 'New AI' },
  ],
  games: 100,
});

console.log('Results:');
console.log(`  Old AI wins: ${results.winRates[0] * 100}%`);
console.log(`  New AI wins: ${results.winRates[1] * 100}%`);
console.log(`  Average game length: ${results.averageLength} moves`);
```

### Game Introspection

```typescript
import { introspectGame, printGameStructure, estimateComplexity } from 'boardsmith/ai-trainer';
import { ChessGame } from './game';

const structure = introspectGame(ChessGame);

printGameStructure(structure);
// Game: ChessGame
// Elements:
//   - Board (Grid 8x8)
//   - Piece (King, Queen, Rook, Bishop, Knight, Pawn)
// Actions:
//   - move: Select piece, select destination
//   - castle: Select side
// ...

const complexity = estimateComplexity(structure);
console.log(`Branching factor: ~${complexity.branchingFactor}`);
console.log(`State space: ~10^${complexity.stateSpaceExponent}`);
```

## See Also

- [AI System Guide](../ai-system.md) - AI system overview
- [boardsmith/ai](./ai.md) - Using trained AI in games
