import type { Game, FlowState } from '@boardsmith/engine';

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
 *
 * Uses path-based state management: nodes track the number of commands
 * executed to reach them from their parent, enabling efficient undo-based
 * state rollback instead of full snapshot restoration.
 */
export interface MCTSNode {
  /** Flow state at this node (small, kept as snapshot) */
  flowState: FlowState;
  /** Parent node (null for root) */
  parent: MCTSNode | null;
  /** Move that led to this node from parent */
  parentMove: BotMove | null;
  /** Number of commands executed to reach this state from parent */
  commandCount: number;
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
  iterations: 300,
  playoutDepth: 0, // Immediate evaluation using objectives (no random moves)
  async: true,
  timeout: 2000,
};

/**
 * Preset difficulty levels
 *
 * With objectives-based evaluation:
 * - playoutDepth: 0 means immediate evaluation using objectives (no random moves)
 * - Higher iterations explore more of the search space
 * - Timeout acts as safety net for large branching factors
 */
export const DIFFICULTY_PRESETS: Record<string, Partial<BotConfig>> = {
  easy: { iterations: 100, playoutDepth: 0, timeout: 1000 },
  medium: { iterations: 300, playoutDepth: 0, timeout: 1500 },
  hard: { iterations: 500, playoutDepth: 0, timeout: 2000 },
};

/**
 * Difficulty level type
 */
export type DifficultyLevel = keyof typeof DIFFICULTY_PRESETS;
