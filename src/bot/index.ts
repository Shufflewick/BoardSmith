import type { Game, GameOptions, SerializedAction } from '../engine/index.js';
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
// `applyDeterminization` is exported so a GAME can test its own sampler against
// the same consistency check the search runs, without standing up an MCTSBot: it
// is the only way for an author to see "you rewrote something the seat can see"
// as a test failure instead of as a mid-session throw.
export { DeterminizationError, applyDeterminization } from './determinization.js';

/** Game class constructor type */
type GameClass<G extends Game = Game> = new (options: GameOptions) => G;

/**
 * Create an MCTS bot for a game
 *
 * @param game - The game instance
 * @param GameClass - The game class constructor (needed for cloning during simulation)
 * @param gameType - The game type identifier
 * @param playerIndex - Which player this bot controls
 * @param actionHistory - History of actions taken so far
 * @param difficulty - Difficulty level or iteration count
 * @param botStrategy - Optional bot configuration with objectives
 *
 * @example
 * ```typescript
 * const bot = createBot(
 *   game,
 *   CheckersGame,
 *   'checkers',
 *   1,
 *   actionHistory,
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
  actionHistory: SerializedAction[] = [],
  difficulty: DifficultyLevel | number = 'medium',
  botStrategy?: BotStrategy
): MCTSBot<G> {
  const config: Partial<BotConfig> = typeof difficulty === 'number'
    ? { iterations: difficulty }
    : DIFFICULTY_PRESETS[difficulty];

  return new MCTSBot(
    game,
    GameClass,
    gameType,
    playerIndex,
    actionHistory,
    config,
    botStrategy
  );
}

/**
 * Parse bot level from string (CLI argument).
 *
 * Accepts a preset name or a positive whole iteration count. Anything else
 * throws: a level nobody recognises is a typo, and quietly playing at medium
 * hides it for the whole session.
 */
export function parseBotLevel(level: string): DifficultyLevel | number {
  // Check if it's a preset name
  if (level in DIFFICULTY_PRESETS) {
    return level as DifficultyLevel;
  }

  // Try to parse as an explicit iteration count
  if (/^\d+$/.test(level) && Number(level) > 0) {
    return Number(level);
  }

  const presets = Object.keys(DIFFICULTY_PRESETS).join(', ');
  throw new Error(
    `Unknown bot level "${level}". Use one of: ${presets}, or a positive iteration count such as 750.`
  );
}
