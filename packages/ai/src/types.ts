import type { Game, Player, FlowState, GameStateSnapshot } from '@boardsmith/engine';

/**
 * Configuration options for the MCTS bot
 */
export interface BotConfig {
  /** Number of MCTS iterations (higher = stronger but slower). Default: 1000 */
  iterations: number;
  /** Maximum playout depth before evaluating position. Default: 50 */
  playoutDepth: number;
  /** Random seed for reproducible behavior */
  seed?: string;
  /** Run async to yield to event loop (prevents UI freezing). Default: true */
  async?: boolean;
  /** Maximum time in milliseconds before returning best move found. Default: 2000 */
  timeout?: number;
}

/**
 * A move the bot can make
 */
export interface BotMove {
  /** The action name to perform */
  action: string;
  /** The arguments for the action */
  args: Record<string, unknown>;
}

/**
 * Internal node in the MCTS search tree
 */
export interface MCTSNode {
  /** Serialized game state at this node */
  snapshot: GameStateSnapshot;
  /** Flow state at this node */
  flowState: FlowState;
  /** Parent node (null for root) */
  parent: MCTSNode | null;
  /** Move that led to this node */
  parentMove: BotMove | null;
  /** Child nodes that have been explored */
  children: MCTSNode[];
  /** Moves that haven't been tried yet */
  untriedMoves: BotMove[];
  /** Number of times this node has been visited */
  visits: number;
  /** Cumulative value (wins) from this node */
  value: number;
  /** Which player is to move at this node */
  currentPlayer: number;
}

/**
 * An objective that guides AI decision-making during playouts
 */
export interface Objective {
  /** Function to check if this objective is achieved */
  checker: (game: Game, playerIndex: number) => boolean;
  /** Weight for this objective (positive = good for player, negative = bad) */
  weight: number;
}

/**
 * AI configuration that can be attached to a game definition
 */
export interface AIConfig {
  /**
   * Optional objectives function to guide AI decisions.
   * Returns objectives that give partial credit during playouts.
   */
  objectives?: (game: Game, playerIndex: number) => Record<string, Objective>;
}

/**
 * Default bot configuration
 */
export const DEFAULT_CONFIG: BotConfig = {
  iterations: 100,
  playoutDepth: 5,
  async: true,
  timeout: 2000,
};

/**
 * Preset difficulty levels
 * Note: iterations are kept very low because game operations are slow (~18ms per move).
 * The timeout ensures the bot always returns within a reasonable time.
 */
export const DIFFICULTY_PRESETS: Record<string, Partial<BotConfig>> = {
  easy: { iterations: 3, playoutDepth: 3, timeout: 1000 },
  medium: { iterations: 5, playoutDepth: 4, timeout: 1500 },
  hard: { iterations: 8, playoutDepth: 5, timeout: 2000 },
};

/**
 * Difficulty level type
 */
export type DifficultyLevel = keyof typeof DIFFICULTY_PRESETS;
