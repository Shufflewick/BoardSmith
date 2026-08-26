# boardsmith/bot-trainer

> Tools for training and improving bot weights.

## When to Use

Import from `boardsmith/bot-trainer` when you want to train bot weights for your game, analyze game features, or generate bot code. The primary training entry point is `WeightEvolver`, which evolves optimal weights using parallel benchmarking under the hood. The `evolve-bot-weights` CLI command wraps it.

## Usage

```typescript
import {
  WeightEvolver,
  introspectGame,
  generateCandidateFeatures,
  generateBotCode,
} from 'boardsmith/bot-trainer';
```

## Exports

### Training

- `WeightEvolver` - Evolve optimal bot weights (primary training API)
- `DEFAULT_TRAINING_CONFIG` - Default training configuration

### Introspection

- `introspectGame()` - Analyze game structure
- `createIntrospectionGame()` - Create game for analysis
- `printGameStructure()` - Print game structure
- `estimateComplexity()` - Estimate game complexity

### Feature Generation

- `generateCandidateFeatures()` - Generate potential bot features
- `filterFeaturesByCategory()` - Filter features by category
- `getFeatureSummary()` - Get feature summary
- `printFeatures()` - Print features

### Feature Templates

- `FEATURE_TEMPLATES` - Built-in feature templates

### Game-Structure Serialization

- `serializeGameStructure()` - Serialize a game structure for worker threads
- `deserializeGameStructure()` - Deserialize a game structure from worker threads

### Benchmarking

- `runParallelBenchmarks()` - Benchmark bot performance
- `benchmarkBot()` - Run bot benchmark

### Analysis

- `analyzeFeatures()` - Analyze feature effectiveness
- `analyzeActions()` - Analyze action patterns
- `selectTopFeatures()` - Select best features
- `correlationToWeight()` - Convert correlation to weight
- `printAnalysisSummary()` - Print analysis results

### Code Generation

- `generateBotCode()` - Generate bot TypeScript code
- `updateBotWeights()` - Update weights in existing bot file

### Bot File Parsing

- `parseExistingBot()` - Parse existing bot file
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
- `LearnedObjective` - Learned bot objective
- `LearnedActionPreference` - Action preference
- `TrainingResult` - Training result
- `TrainingConfig` - Training configuration
- `TrainingProgress` - Training progress
- `WeightEvolverConfig` - Weight evolver config
- `WeightEvolutionResult` - Evolution result
- `BenchmarkConfig` - Benchmark configuration
- `BenchmarkResult` - Benchmark result
- `PlayerConfig` - Player configuration
- `ParallelBenchmarkOptions` - Parallel benchmark options
- `IndividualFitness` - Individual fitness score
- `CodeGeneratorOptions` - Code generator options
- `UpdateWeightsOptions` - Update weights options
- `ParsedAIFile` - Parsed bot file
- `ParsedObjective` - Parsed objective
- `FeatureTemplate` - Feature template

## Examples

### Quick Weight Evolution

```typescript
import { WeightEvolver } from 'boardsmith/bot-trainer';
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

### Training from the CLI

`WeightEvolver` is the live training engine, but the supported end-to-end entry
point is the `evolve-bot-weights` CLI command. It introspects the game, loads the
existing objectives produced by `/bs-build-bot`, evolves their weights via parallel
benchmarking, and regenerates the bot file:

```bash
npx boardsmith evolve-bot-weights --game ./src/game.ts --out ./src/bot.ts
```

Under the hood the command drives `WeightEvolver.evolve(objectives)`, which returns
the optimized objectives plus the initial and best win rates. See `boardsmith/bot`
for consuming the generated bot in a game.

### Updating Existing Bot

```typescript
import { parseExistingBot, updateBotWeights } from 'boardsmith/bot-trainer';
import { readFileSync, writeFileSync } from 'fs';

// Parse existing bot file
const content = readFileSync('./src/bot.ts', 'utf-8');
const parsed = parseExistingBot(content);

console.log(`Found ${parsed.objectives.length} objectives`);

// Update weights based on new training
const newWeights = { 'piece-count': 0.15, 'board-control': 0.25 };

const updated = updateBotWeights({
  content,
  weights: newWeights,
});

writeFileSync('./src/bot.ts', updated);
```

### Benchmarking Bot Versions

```typescript
import { benchmarkBot } from 'boardsmith/bot-trainer';
import { MyGame } from './game';

const results = await benchmarkBot({
  GameClass: MyGame,
  gameType: 'my-game',
  players: [
    { type: 'bot', config: oldBot, name: 'Old bot' },
    { type: 'bot', config: newBot, name: 'New bot' },
  ],
  games: 100,
});

console.log('Results:');
console.log(`  Old bot wins: ${results.winRates[0] * 100}%`);
console.log(`  New bot wins: ${results.winRates[1] * 100}%`);
console.log(`  Average game length: ${results.averageLength} moves`);
```

### Game Introspection

```typescript
import { introspectGame, printGameStructure, estimateComplexity } from 'boardsmith/bot-trainer';
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

- [Bot System Guide](../bot-system.md) - Bot system overview
- [boardsmith/bot](./bot.md) - Using trained bot in games
