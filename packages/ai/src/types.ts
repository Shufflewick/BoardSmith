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
  /** Enable transposition table caching for position evaluations. Default: true */
  useTranspositionTable?: boolean;
  /** Number of parallel ensemble searches. Default: 1 */
  parallel?: number;
  /** Enable RAVE (Rapid Action Value Estimation) for faster move learning. Default: true */
  useRAVE?: boolean;
  /** RAVE beta decay constant - higher values trust RAVE longer. Default: 500 */
  raveK?: number;
  /**
   * Static UCT exploration constant override.
   * Default: Math.sqrt(2) ≈ 1.41, theoretically optimal for minimax.
   * Higher values (e.g., 2.0) favor exploration - better for early game.
   * Lower values (e.g., 0.5) favor exploitation - better for late game.
   * Typical range: 0.5 (very exploitative) to 2.0 (very explorative).
   */
  uctC?: number;
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
  /** All legal moves at this position (cached, enumerated once per node) */
  allMoves: BotMove[];
  /** Moves that haven't been tried yet (subset of allMoves) */
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
  /**
   * Evaluate how well this objective is achieved.
   * Returns 0.0 to 1.0 where 0=not achieved, 1=fully achieved,
   * values between for partial achievement.
   */
  checker: (game: Game, playerIndex: number) => number;
  /** Weight for this objective (positive = good for player, negative = bad) */
  weight: number;
}

/**
 * Result from threat response analysis
 */
export interface ThreatResponse {
  /** Moves that address the threat */
  moves: BotMove[];
  /** If true, one of these moves MUST be taken (opponent about to win) */
  urgent: boolean;
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

  /**
   * Optional function to identify threat response moves.
   * When opponent has immediate threats, returns moves that address the threat.
   *
   * Returns { moves, urgent }:
   * - moves: Array of moves that block/address the threat
   * - urgent: If true, opponent is about to win and we MUST pick one of these moves
   *
   * When urgent=false, moves are prioritized for exploration but MCTS still evaluates all options.
   * When urgent=true, MCTS only considers these moves (forces defensive play).
   *
   * @param game - Current game state
   * @param playerIndex - Which player the bot is (1-indexed position)
   * @param availableMoves - All legal moves at this position
   * @returns ThreatResponse with moves and urgency flag
   */
  threatResponseMoves?: (game: Game, playerIndex: number, availableMoves: BotMove[]) => ThreatResponse;

  /**
   * Optional function for smart move selection during MCTS playouts.
   * Instead of random move selection, use game-specific heuristics.
   *
   * For connection games like Hex, this enables path-based strategy:
   * - Prefer moves that shorten own winning path
   * - Prefer moves that lengthen opponent's path
   * - Build coherent connected structures
   *
   * @param game - Current game state
   * @param playerIndex - Which player is moving (1-indexed position)
   * @param availableMoves - Legal moves to choose from
   * @param rng - Random number generator (0-1) for weighted selection
   * @returns Selected move (should use weighted-random, not deterministic)
   */
  playoutPolicy?: (game: Game, playerIndex: number, availableMoves: BotMove[], rng: () => number) => BotMove;

  /**
   * Optional function to order moves by heuristic value for exploration.
   * Returns moves sorted by priority (highest first) to explore promising moves early.
   * Unlike threatResponseMoves (which forces specific moves), this is soft ordering:
   * MCTS still explores all moves, just in a better order.
   *
   * Typical ordering heuristics:
   * - Moves near opponent's recent pieces (contest territory)
   * - Moves adjacent to own stones (connectivity)
   * - Moves in central regions (early game)
   *
   * @param game - Current game state
   * @param playerIndex - Which player the bot is (1-indexed position)
   * @param moves - Available moves to order
   * @returns Moves sorted by priority (explore first → last)
   */
  moveOrdering?: (game: Game, playerIndex: number, moves: BotMove[]) => BotMove[];

  /**
   * Optional function for dynamic UCT exploration constant based on game state.
   * Called once per move selection (not per tree node) for performance.
   *
   * Default: Math.sqrt(2) ≈ 1.41, theoretically optimal for minimax.
   * Higher values (e.g., 1.8-2.0) favor exploration - better for early game.
   * Lower values (e.g., 0.8-1.0) favor exploitation - better for late game.
   *
   * Example phase-based tuning:
   * - Early game (0-30% filled): C=1.8 (explore diverse strategies)
   * - Mid game (30-70% filled): C=sqrt(2) (balanced)
   * - Late game (70%+ filled): C=1.0 (focus on winning lines)
   *
   * @param game - Current game state
   * @param playerIndex - Which player the bot is (1-indexed position)
   * @returns UCT exploration constant (typical range: 0.5 to 2.0)
   */
  uctConstant?: (game: Game, playerIndex: number) => number;
}

/**
 * Default bot configuration
 */
export const DEFAULT_CONFIG: BotConfig = {
  iterations: 300,
  playoutDepth: 3, // Simulate 3 random moves ahead before evaluating
  async: true,
  timeout: 2000,
};

/**
 * Preset difficulty levels
 *
 * With objectives-based evaluation:
 * - playoutDepth controls how many random moves to simulate before evaluating
 * - Higher playoutDepth helps discover forcing sequences but takes longer
 * - Higher iterations explore more of the search space
 * - Timeout acts as safety net for large branching factors
 */
export const DIFFICULTY_PRESETS: Record<string, Partial<BotConfig>> = {
  easy: { iterations: 100, playoutDepth: 2, timeout: 1000 },
  medium: { iterations: 300, playoutDepth: 3, timeout: 1500 },
  hard: { iterations: 500, playoutDepth: 4, timeout: 2000, parallel: 2 },
};

/**
 * Difficulty level type
 */
export type DifficultyLevel = keyof typeof DIFFICULTY_PRESETS;
