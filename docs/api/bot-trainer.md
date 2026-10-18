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
- `benchmarkBot` and `weightedBot` - The benchmark each candidate is scored
  with, and the check of its weights. They are built into the game's training
  bundle (see below), not called directly

`readObjectiveWeights` and `updateBotWeights` share one parser: an objective is
a property whose value is an object literal with both a `checker` and a
`weight`, and its id is the property's name, quoted or not.

### Types

- `ObjectiveWeight` - `{ id, weight }` for one objective
- `TrainingProgress` - What `onProgress` receives
- `TrainingBundle` - A rules module built together with `benchmarkBot` and
  `weightedBot`
- `WeightEvolverConfig` - Weight evolver config
- `WeightEvolutionResult` - The weights to keep, the search's starting and best
  win rates, and the `confirmation`
- `WeightConfirmation` - The confirmation rematch: games each, both win rates,
  and whether the new weights were accepted
- `UpdateWeightsOptions` - Options for `updateBotWeights`

## Training from the CLI

Run `evolve-bot-weights` from the game project. It bundles the rules from source,
together with the benchmark, into a fresh `.boardsmith/evolve-bot-weights-tmp-<run>/`
(removed when it ends), reads the
weights of the objectives in the rules directory's `bot.ts`, evolves them by
benchmarking the game's own bot in parallel, and writes the new weights back into
that `bot.ts` only if they are confirmed stronger (see below):

```bash
npx boardsmith evolve-bot-weights --generations 5 --population 20
```

The game's `gameDefinition` must set `bot.objectives` to the objectives function
`bot.ts` exports; the command refuses a game without one.

### How weights are nudged

Each mutation nudges every weight by a random amount in proportion to its own
size, so a weight of 50 and a weight of 2 each move by about the same fraction
(#1029). Only the ratios between weights matter to the bot, so a fixed nudge
would barely move the large weights and swamp the small ones. A weight below 1,
including one an earlier run wrote back with a decimal such as 0.3, is
deliberately nudged by a fixed amount (sigma) instead of in proportion, so that
a zero weight can still move.

`WeightEvolverConfig.evolutionSigma` is the size of that nudge as a fraction of
the weight, 0.2 by default (about 20%, which is what the old fixed nudge of 1
gave a typical authored weight of 5). The first parents are nudged by half of
it, and it shrinks by 10% each generation for a finer search.

### Confirming an improvement

The search scores about 125 candidates on 50 games each and picks the highest.
Scores that noisy make the highest one lucky: when no candidate is stronger
than the original, the best still scores around 68% against the original's
50% (#870). So before keeping the pick, the evolver plays it and the original
again, on 400 new games each that the search never played, the same games for
both. The pick is kept only if it wins a one-sided two-proportion test at 5%:
a pick no stronger than the original is kept at most about 1 run in 20, and a
pick 10 points stronger is kept about 88% of the time (15 points: about 99%).
Otherwise `bot.ts` is left as it was. The reported improvement is the
confirmation's, not the search score.

### Reproducible runs

By default each run draws a fresh seed for mutation and for the benchmark
games, so every run and every generation plays new games, and every bot search
is unseeded and cut off by the clock. Two runs with the same settings therefore
give different weights. Pass `--seed` for a run you can repeat (#699):

```bash
npx boardsmith evolve-bot-weights --generations 5 --population 20 --seed tuning-1
```

The seed drives mutation and selection, every benchmark game and every move's
search. Each search runs exactly its `--mcts` iterations with no time limit, so
the same seed and settings give the same weights move for move, on any number
of workers. From a script, `WeightEvolverConfig.seed` does the same. For one
benchmark, `BenchmarkConfig.seed` chooses the games and `reproducible: true`
also seeds every search from them. A reproducible run has no clock bound at
all: `gameTimeout` with an evolver seed, or `timeout` with `reproducible`, is
refused, and `maxActionsPerGame` (or `maxActions`) still bounds each game.

## From a Script

The bot must play on the same copy of the engine as the game's elements, or it
does not recognise the game's own errors and every benchmark game fails (#697).
So the evolver takes the path of a training bundle: one module, built from an
entry that exports the rules beside the benchmark. It imports the bundle itself
and refuses one that does not export `gameDefinition`, `benchmarkBot` and
`weightedBot`, before any benchmark runs; each worker imports the same path.

```typescript
// src/training.ts, built to dist/training.js
export { gameDefinition } from './rules/index.js';
export { benchmarkBot, weightedBot } from 'boardsmith/bot-trainer';
```

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { WeightEvolver, readObjectiveWeights, updateBotWeights } from 'boardsmith/bot-trainer';

const botPath = './src/rules/bot.ts';
const source = readFileSync(botPath, 'utf-8');

const bundlePath = new URL('./dist/training.js', import.meta.url).pathname;
const evolver = new WeightEvolver(bundlePath, 'my-game', {
  evolutionGenerations: 5,
  evolutionLambda: 20,
});

const result = await evolver.evolve(readObjectiveWeights(source));
writeFileSync(botPath, updateBotWeights(source, result.objectives));
```

## See Also

- [Bot System Guide](../bot-system.md) - Bot system overview
- [boardsmith/bot](./bot.md) - Using trained bot in games
