import type { Game, GameOptions, FlowState, SerializedAction } from '../engine/index.js';

/** Game class constructor type */
export type GameClass<G extends Game = Game> = new (options: GameOptions) => G;

/**
 * Game type classification based on win condition patterns.
 * Used for selecting appropriate zero-config heuristics.
 */
export type GameType =
  | 'connection'   // Win by forming path between edges (Hex)
  | 'capture'      // Win by capturing/blocking all opponent pieces (Checkers)
  | 'racing'       // Win by reaching target score first (Cribbage)
  | 'collection'   // Win by collecting most of something (Go Fish)
  | 'territory'    // Win by controlling most area (Go) - future
  | 'elimination'  // Win when opponents eliminated - future
  | 'unknown';     // Fallback when pattern not detected

/**
 * Win condition analysis result.
 * Describes how a game determines victory.
 */
export interface WinConditionInfo {
  /** Detected game type */
  gameType: GameType;
  /** Confidence level (0-1) of the detection */
  confidence: number;
  /** Patterns that led to this classification */
  indicators: string[];
  /** Win condition involves reaching a score threshold */
  scoreBased: boolean;
  /** Win condition involves removing opponent pieces/options */
  eliminationBased: boolean;
  /** Win condition involves forming paths or connections */
  connectionBased: boolean;
  /** Win condition involves collecting sets or items */
  collectionBased: boolean;
}

/**
 * Discovered element type information
 */
export interface ElementTypeInfo {
  /** Class name (e.g., 'Piece', 'Card') */
  className: string;
  /** Numeric properties found (e.g., 'value', 'rank') */
  numericProperties: string[];
  /** Boolean properties found (e.g., 'isKing', 'isRevealed') */
  booleanProperties: string[];
  /** String properties found (e.g., 'suit', 'color') */
  stringProperties: string[];
  /** Whether elements of this type have player ownership */
  hasOwnership: boolean;
  /** Whether elements exist in a spatial grid (have row/column) */
  isSpatial: boolean;
  /** Sample values for string properties (for enumeration) */
  stringEnums: Record<string, Set<string>>;
}

/**
 * Discovered player information
 */
export interface PlayerTypeInfo {
  /** Numeric properties on players (e.g., 'score', 'health') */
  numericProperties: string[];
  /** Boolean properties on players */
  booleanProperties: string[];
  /** String properties on players */
  stringProperties: string[];
}

/**
 * Discovered spatial structure
 */
export interface SpatialInfo {
  /** Whether there's a board/grid */
  hasBoard: boolean;
  /** Board dimensions if found */
  dimensions?: { rows: number; columns: number };
  /** Center region (for center control features) */
  centerRegion?: { minRow: number; maxRow: number; minCol: number; maxCol: number };
  /** Whether it's a hex grid */
  isHex: boolean;
}

/**
 * Complete game structure discovery result
 */
export interface GameStructure {
  /** All discovered element types */
  elementTypes: Map<string, ElementTypeInfo>;
  /** Player type information */
  playerInfo: PlayerTypeInfo;
  /** Spatial/board information */
  spatialInfo: SpatialInfo;
  /** Number of players */
  playerCount: number;
  /** Win condition analysis */
  winConditionInfo: WinConditionInfo;
}

/**
 * Serializable element type info (for worker thread communication).
 * Converts Set to array for structured cloning.
 */
export interface SerializableElementTypeInfo {
  /** Class name (e.g., 'Piece', 'Card') */
  className: string;
  /** Numeric properties found (e.g., 'value', 'rank') */
  numericProperties: string[];
  /** Boolean properties found (e.g., 'isKing', 'isRevealed') */
  booleanProperties: string[];
  /** String properties found (e.g., 'suit', 'color') */
  stringProperties: string[];
  /** Whether elements of this type have player ownership */
  hasOwnership: boolean;
  /** Whether elements exist in a spatial grid (have row/column) */
  isSpatial: boolean;
  /** Sample values for string properties (arrays instead of Sets for serialization) */
  stringEnums: Record<string, string[]>;
}

/**
 * Serializable game structure for worker thread communication.
 * All fields are structured-cloneable (no Map/Set).
 */
export interface SerializableGameStructure {
  /** All discovered element types (Record instead of Map) */
  elementTypes: Record<string, SerializableElementTypeInfo>;
  /** Player type information */
  playerInfo: PlayerTypeInfo;
  /** Spatial/board information */
  spatialInfo: SpatialInfo;
  /** Number of players */
  playerCount: number;
  /** Win condition analysis */
  winConditionInfo: WinConditionInfo;
}

/**
 * A candidate feature to evaluate
 */
export interface CandidateFeature {
  /** Unique identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** The category of feature */
  category: 'count' | 'sum' | 'comparison' | 'ratio' | 'spatial' | 'boolean' | 'score';
  /** Function to evaluate this feature for a player */
  evaluate: (game: Game, playerIndex: number) => boolean;
  /** The template that generated this feature */
  templateId: string;
}

/**
 * Data collected during a single game state
 */
export interface StateSnapshot {
  /** Action number in the game */
  actionNumber: number;
  /** Which player is deciding */
  decidingPlayer: number;
  /** Feature values at this state */
  featureValues: Map<string, boolean>;
  /** Available actions at this state */
  availableActions: string[];
  /** Action taken (if recorded) */
  actionTaken?: string;
  /** Action arguments (if recorded) */
  actionArgs?: Record<string, unknown>;
}

/**
 * Data collected from a single game
 */
export interface GameData {
  /** Unique game identifier (seed) */
  gameId: string;
  /** Number of players */
  playerCount: number;
  /** All state snapshots during the game */
  states: StateSnapshot[];
  /** Winner indices (empty array for draw) */
  winners: number[];
  /** Total actions in the game */
  totalActions: number;
  /** Game completed successfully */
  completed: boolean;
}

/**
 * Statistics for a single feature
 */
export interface FeatureStats {
  /** Feature ID */
  featureId: string;
  /** Times feature was true for eventual winner */
  trueAndWon: number;
  /** Times feature was true for eventual loser */
  trueAndLost: number;
  /** Times feature was false for eventual winner */
  falseAndWon: number;
  /** Times feature was false for eventual loser */
  falseAndLost: number;
  /** Win rate when feature is true */
  winRateWhenTrue: number;
  /** Win rate when feature is false */
  winRateWhenFalse: number;
  /** Correlation coefficient with winning */
  correlation: number;
  /** Statistical significance (chi-squared p-value) */
  pValue: number;
}

/**
 * Action preference data
 */
export interface ActionStats {
  /** Action name */
  actionName: string;
  /** Times this action was taken and player won */
  takenAndWon: number;
  /** Times this action was taken and player lost */
  takenAndLost: number;
  /** Times this action was available but not taken, player won */
  notTakenAndWon: number;
  /** Times this action was available but not taken, player lost */
  notTakenAndLost: number;
  /** Win rate when action is taken */
  winRateWhenTaken: number;
  /** Win rate when action is not taken (but available) */
  winRateWhenNotTaken: number;
}

/**
 * A learned objective (feature + weight)
 */
export interface LearnedObjective {
  /** Feature ID */
  featureId: string;
  /** Human-readable description */
  description: string;
  /** Learned weight */
  weight: number;
  /** The checker function code (as string) */
  checkerCode: string;
  /** Correlation with winning (for reference) */
  correlation: number;
}

/**
 * A learned action preference
 */
export interface LearnedActionPreference {
  /** Action name */
  actionName: string;
  /** Context features that trigger this preference */
  contextFeatures: string[];
  /** Preference weight (positive = prefer, negative = avoid) */
  weight: number;
}

/**
 * Complete training result
 */
export interface TrainingResult {
  /** Learned objectives (position evaluation) */
  objectives: LearnedObjective[];
  /** Learned action preferences */
  actionPreferences: LearnedActionPreference[];
  /** Feature statistics (for debugging) */
  featureStats: FeatureStats[];
  /** Action statistics (for debugging) */
  actionStats: ActionStats[];
  /** Training metadata */
  metadata: {
    gamesPlayed: number;
    gamesCompleted: number;
    totalStates: number;
    candidateFeaturesGenerated: number;
    featuresSelected: number;
    iterations: number;
    finalWinRate: number; // Win rate of trained AI vs random
  };
}

/**
 * Training configuration
 */
export interface TrainingConfig {
  /** Number of games per iteration */
  gamesPerIteration: number;
  /** Number of training iterations */
  iterations: number;
  /** Minimum correlation to keep a feature */
  minCorrelation: number;
  /** Maximum features to keep */
  maxFeatures: number;
  /** Whether to learn action preferences */
  learnActions: boolean;
  /** Timeout per game in ms */
  gameTimeout: number;
  /** Maximum actions per game */
  maxActionsPerGame: number;
  /** Progress callback */
  onProgress?: (progress: TrainingProgress) => void;
  /** Random seed for reproducibility */
  seed?: string;
  /** Path to existing ai.ts to build upon */
  existingAIPath?: string;
  /**
   * MCTS iterations for oracle (training games).
   * Higher = better quality training data but slower.
   * @default 50
   */
  oracleMCTSIterations?: number;
  /**
   * MCTS iterations when using learned objectives.
   * Can be lower since heuristics help guide search.
   * @default 10
   */
  trainedMCTSIterations?: number;
  /**
   * MCTS iterations for benchmark evaluation.
   * Should be high for accurate measurement.
   * @default 100
   */
  benchmarkMCTSIterations?: number;
  /**
   * @deprecated Use oracleMCTSIterations instead. Kept for backwards compatibility.
   */
  mctsIterations?: number;

  // ─────────────────────────────────────────────────────────────────────────────
  // Evolution Settings (µ+λ evolutionary strategy for weight optimization)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Enable evolutionary weight optimization after correlation-based training */
  evolve?: boolean;
  /** Evolution generations (default 5) */
  evolutionGenerations?: number;
  /** Parent population size µ (default 5) */
  evolutionMu?: number;
  /** Offspring population size λ (default 20) */
  evolutionLambda?: number;
  /** Initial mutation sigma (default 1.0) */
  evolutionSigma?: number;
  /** Benchmark games per fitness evaluation (default 50) */
  evolutionBenchmarkGames?: number;
}

/**
 * Training progress update
 */
export interface TrainingProgress {
  /** Current iteration (1-indexed) */
  iteration: number;
  /** Total iterations */
  totalIterations: number;
  /** Games completed in current iteration */
  gamesCompleted: number;
  /** Total games in current iteration */
  totalGames: number;
  /** Current best win rate */
  bestWinRate: number;
  /** Number of features selected */
  featuresSelected: number;
  /** Status message */
  message: string;
}

/**
 * Default training configuration
 */
export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  gamesPerIteration: 100,
  iterations: 3,
  minCorrelation: 0.01, // Lower threshold to discover more features
  maxFeatures: 20,
  learnActions: true,
  gameTimeout: 60000, // 60s per game
  maxActionsPerGame: 300,
  oracleMCTSIterations: 50, // Strong oracle for quality training games
  trainedMCTSIterations: 10, // Lower when objectives guide search
  benchmarkMCTSIterations: 100, // Strong for accurate evaluation
  // Evolution defaults
  evolve: false,
  evolutionGenerations: 5,
  evolutionMu: 5,
  evolutionLambda: 20,
  evolutionSigma: 1.0,
  evolutionBenchmarkGames: 50,
};

/**
 * Options for simulating a single game.
 * Used by simulateSingleGame function.
 */
export interface SingleGameOptions {
  /** Player count for the game */
  playerCount: number;
  /** Features to evaluate during simulation */
  features: CandidateFeature[];
  /** Timeout per game in ms */
  timeout: number;
  /** Maximum actions per game */
  maxActions: number;
  /** Seed for reproducibility */
  seed: string;
  /** AI configuration for players */
  aiConfig?: {
    useAI: boolean;
    iterations?: number;
    objectives?: LearnedObjective[];
  };
}

/**
 * Serializable simulation options for worker thread communication.
 * All fields are structured-cloneable (no functions).
 * Workers regenerate features from structure using generateCandidateFeatures().
 */
export interface SerializableSimulationOptions {
  /** Path to compiled game module (for dynamic import in worker) */
  gameModulePath: string;
  /** Game type identifier */
  gameType: string;
  /** Player count for the game */
  playerCount: number;
  /** Timeout per game in ms */
  timeout: number;
  /** Maximum actions per game */
  maxActions: number;
  /** Seed for reproducibility */
  seed: string;
  /** Game structure for feature regeneration */
  structure: SerializableGameStructure;
  /** AI configuration (objectives are serializable since checkerCode is a string) */
  aiConfig?: {
    useAI: boolean;
    iterations?: number;
    objectives?: Array<{
      featureId: string;
      description: string;
      weight: number;
      checkerCode: string;
      correlation: number;
    }>;
  };
}
