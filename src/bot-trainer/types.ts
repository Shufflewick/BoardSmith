import type { Game, GameClass } from '../engine/index.js';
import type { BotStrategy } from '../bot/index.js';
import type { benchmarkBot, weightedBot } from './benchmark.js';

/**
 * The weight of one of the game's bot objectives, by id
 */
export interface ObjectiveWeight {
  /** The objective's id: its key in the record the game's objectives function returns */
  id: string;
  /** The weight evolution gives it */
  weight: number;
}

/**
 * Weight evolution progress update
 */
export interface TrainingProgress {
  /** Current generation (1-indexed; 0 while the starting weights are benchmarked) */
  iteration: number;
  /** Total generations */
  totalIterations: number;
  /** How much of the current step is done, in the units `message` names (games or candidates) */
  gamesCompleted: number;
  /** How much the current step has to do, in the same units */
  totalGames: number;
  /** Current best win rate */
  bestWinRate: number;
  /** Number of objectives whose weights are being evolved */
  objectiveCount: number;
  /** Status message */
  message: string;
}

/**
 * A game's rules module built together with this trainer's benchmark (#697):
 * its entry exports the game's `gameDefinition` beside
 * `export { benchmarkBot, weightedBot } from 'boardsmith/bot-trainer';`. Built
 * as one module, the bot and the game's elements share one copy of the
 * engine; driven from a separate copy, the bot does not recognise the game's
 * own errors (such as a read of an attribute its seat cannot see) and every
 * benchmark game fails.
 */
export interface TrainingBundle {
  gameDefinition: { gameClass: GameClass<Game>; bot?: BotStrategy };
  benchmarkBot: typeof benchmarkBot;
  weightedBot: typeof weightedBot;
}
