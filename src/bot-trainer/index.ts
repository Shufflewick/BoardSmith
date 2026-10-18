// Weight evolution: what `boardsmith evolve-bot-weights` uses to tune the
// weights of a game's own bot objectives.
export {
  WeightEvolver,
  type WeightEvolverConfig,
  type WeightEvolutionResult,
  type WeightConfirmation,
} from './weight-evolver.js';

// Reading and writing the objective weights in bot.ts
export {
  readObjectiveWeights,
  updateBotWeights,
  type UpdateWeightsOptions,
} from './objective-weights.js';

// Built into a game's training bundle beside its gameDefinition (see TrainingBundle)
export { benchmarkBot, weightedBot } from './benchmark.js';

export type { ObjectiveWeight, TrainingBundle, TrainingProgress } from './types.js';
