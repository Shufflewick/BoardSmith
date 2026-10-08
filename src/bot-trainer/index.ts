// Weight evolution: what `boardsmith evolve-bot-weights` uses to tune the
// weights of a game's own bot objectives.
export {
  WeightEvolver,
  type WeightEvolverConfig,
  type WeightEvolutionResult,
} from './weight-evolver.js';

// Reading and writing the objective weights in bot.ts
export {
  readObjectiveWeights,
  updateBotWeights,
  type UpdateWeightsOptions,
} from './objective-weights.js';

export type { ObjectiveWeight, TrainingProgress } from './types.js';
