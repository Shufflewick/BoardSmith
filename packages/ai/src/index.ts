import type { Game, GameOptions, SerializedAction } from '@boardsmith/engine';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, AIConfig, DifficultyLevel } from './types.js';
import { DIFFICULTY_PRESETS } from './types.js';

// Re-export types
export { MCTSBot } from './mcts-bot.js';
export type {
  BotConfig,
  BotMove,
  AIConfig,
  Objective,
  ThreatResponse,
  DifficultyLevel,
} from './types.js';
export { DIFFICULTY_PRESETS, DEFAULT_CONFIG } from './types.js';

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
 * @param aiConfig - Optional AI configuration with objectives
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
  aiConfig?: AIConfig
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
    aiConfig
  );
}

/**
 * Parse AI level from string (CLI argument)
 */
export function parseAILevel(level: string): DifficultyLevel | number {
  // Check if it's a preset name
  if (level in DIFFICULTY_PRESETS) {
    return level as DifficultyLevel;
  }

  // Try to parse as number
  const num = parseInt(level, 10);
  if (!isNaN(num) && num > 0) {
    return num;
  }

  // Default to medium
  return 'medium';
}
