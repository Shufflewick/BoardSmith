# boardsmith/bot-trainer

> Evolve the weights of a game's own bot objectives.

## When to Use

Most games never import this package: run the `evolve-bot-weights` CLI command
instead (see below). Import from `boardsmith/bot-trainer` only to drive weight
evolution from your own script.

What is tuned is the objectives function the game's bot already plays with,
`gameDefinition.bot.objectives`. Each candidate set of weights is benchmarked
by playing the game with that function, its checkers unchanged and only the
weights replaced by id. A weight whose id the objectives function does not
return is refused with an error that names it, before any game is played.

## Usage

```typescript
import {
  WeightEvolver,
  readObjectiveWeights,
  updateBotWeights,
} from 'boardsmith/bot-trainer';
```

## Exports

- `WeightEvolver` - Evolves weights with a µ+λ strategy, benchmarking each
  candidate in worker threads
- `readObjectiveWeights(source)` - The `{ id, weight }` of every objective in a
  bot.ts source. Refuses a weight that is not written as a number, and an id
  two objectives share
- `updateBotWeights(source, weights, options?)` - The bot.ts source with those
  weights written back, every other byte unchanged. Refuses an id the source
  has no objective for

`readObjectiveWeights` and `updateBotWeights` share one parser: an objective is
a property whose value is an object literal with both a `checker` and a
`weight`, and its id is the property's name, quoted or not.

### Types

- `ObjectiveWeight` - `{ id, weight }` for one objective
- `TrainingProgress` - What `onProgress` receives
- `WeightEvolverConfig` - Weight evolver config
- `WeightEvolutionResult` - The evolved weights and the starting and best win rates
- `UpdateWeightsOptions` - Options for `updateBotWeights`

## Training from the CLI

Run `evolve-bot-weights` from the game project. It bundles the rules from source
into `.boardsmith/evolve-bot-weights-tmp/` (removed when it ends), reads the
weights of the objectives in the rules directory's `bot.ts`, evolves them by
benchmarking the game's own bot in parallel, and writes the new weights back into
that `bot.ts`:

```bash
npx boardsmith evolve-bot-weights --generations 5 --population 20
```

The game's `gameDefinition` must set `bot.objectives` to the objectives function
`bot.ts` exports; the command refuses a game without one.

## From a Script

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { WeightEvolver, readObjectiveWeights, updateBotWeights } from 'boardsmith/bot-trainer';
import { gameDefinition } from './dist/rules.js';

const botPath = './src/rules/bot.ts';
const source = readFileSync(botPath, 'utf-8');

// The workers load the game from the compiled module at this path.
const evolver = new WeightEvolver(
  gameDefinition.gameClass,
  gameDefinition.gameType,
  new URL('./dist/rules.js', import.meta.url).pathname,
  gameDefinition.bot,
  { evolutionGenerations: 5, evolutionLambda: 20 },
);

const result = await evolver.evolve(readObjectiveWeights(source));
writeFileSync(botPath, updateBotWeights(source, result.objectives));
```

## See Also

- [Bot System Guide](../bot-system.md) - Bot system overview
- [boardsmith/bot](./bot.md) - Using trained bot in games
