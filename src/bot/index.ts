import type { Game, GameClass } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotStrategy, DifficultyLevel } from './types.js';
import { DIFFICULTY_PRESETS } from './types.js';

// Re-export types
export { MCTSBot } from './mcts-bot.js';
export type {
  BotConfig,
  BotMove,
  BotMoveStats,
  BotStrategy,
  DeterminizeSampler,
  Objective,
  ThreatResponse,
  DifficultyLevel,
} from './types.js';
export { DIFFICULTY_PRESETS, DEFAULT_CONFIG } from './types.js';
// `searchCopyForSeat` is exported so a GAME can test its own sampler and
// `afterRestore` hooks on the copy the search builds, without standing up an
// MCTSBot: it is how an author sees "you rewrote something the seat can see" as a
// test failure instead of as a mid-session throw (#1362).
export { DeterminizationError } from './determinization.js';
export { searchCopyForSeat } from './search-copy.js';
export type { WorldSample } from './search-copy.js';

/**
 * Create an MCTS bot for a game
 *
 * @param game - The game instance
 * @param GameClass - The game class constructor (needed for cloning during simulation)
 * @param gameType - The game type identifier
 * @param playerIndex - Which player this bot controls
 * @param difficulty - Difficulty level or iteration count
 * @param botStrategy - Optional bot configuration with objectives
 * @param reproducible - Pass `{ seed }` for a search that picks the same move
 *   every time it is given the same position (tests, tactical fixtures,
 *   benchmarks). Without it the bot draws from a fresh random seed. The seed
 *   also turns off the difficulty's wall-clock `timeout`, because a search the
 *   clock can cut short is not reproducible whatever its seed: it runs exactly
 *   the difficulty's `iterations`, however long that takes.
 *
 * @example
 * ```typescript
 * const bot = createBot(
 *   game,
 *   CheckersGame,
 *   'checkers',
 *   1,
 *   'hard'
 * );
 * const move = await bot.play();
 * ```
 */
export function createBot<G extends Game>(
  game: G,
  GameClass: GameClass<G>,
  gameType: string,
  playerIndex: number,
  difficulty: DifficultyLevel | number = 'medium',
  botStrategy?: BotStrategy,
  reproducible?: { seed: string }
): MCTSBot<G> {
  const config: Partial<BotConfig> = {
    ...(typeof difficulty === 'number' ? { iterations: difficulty } : DIFFICULTY_PRESETS[difficulty]),
    ...(reproducible && { seed: reproducible.seed, timeout: Infinity }),
  };

  return new MCTSBot(
    game,
    GameClass,
    gameType,
    playerIndex,
    config,
    botStrategy
  );
}

/**
 * The most search iterations a numeric bot level may ask for. Each iteration
 * adds up to one node to the search tree held in memory, and a seeded search
 * (`boardsmith simulate`, `reproducible`) has no time limit, so the count is
 * the only bound on its memory and time. 100,000 is 200 times the hard preset.
 */
export const MAX_BOT_ITERATIONS = 100_000;

/**
 * Parse bot level from string (CLI argument).
 *
 * Accepts a preset name or a whole iteration count from 1 to
 * {@link MAX_BOT_ITERATIONS}. Anything else throws: a level nobody recognises
 * is a typo, and quietly playing at medium hides it for the whole session.
 */
export function parseBotLevel(level: string): DifficultyLevel | number {
  if (Object.hasOwn(DIFFICULTY_PRESETS, level)) {
    return level as DifficultyLevel;
  }

  if (/^\d+$/.test(level) && Number(level) > 0) {
    if (Number(level) > MAX_BOT_ITERATIONS) {
      throw new Error(
        `Bot level ${level} asks for more search iterations than the most a bot runs, ${MAX_BOT_ITERATIONS}. ` +
          `Use a count from 1 to ${MAX_BOT_ITERATIONS}, or a preset such as hard.`,
      );
    }
    return Number(level);
  }

  const presets = Object.keys(DIFFICULTY_PRESETS).join(', ');
  throw new Error(
    `Unknown bot level "${level}". Use one of: ${presets}, or a positive iteration count such as 750.`
  );
}
