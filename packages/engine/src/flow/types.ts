import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionDefinition, ActionResult } from '../action/types.js';

/**
 * Flow node types
 */
export type FlowNodeType =
  | 'sequence'
  | 'loop'
  | 'each-player'
  | 'for-each'
  | 'action-step'
  | 'simultaneous-action-step'
  | 'switch'
  | 'if'
  | 'execute'
  | 'phase';

/**
 * Result of a flow step execution
 */
export interface FlowStepResult {
  /** Whether the flow should continue */
  continue: boolean;
  /** Whether the flow needs player input */
  awaitingInput: boolean;
  /** Available actions if awaiting input */
  availableActions?: string[];
  /** Current player if awaiting input */
  currentPlayer?: Player;
  /** Message to display */
  message?: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Serialized flow position for pause/resume
 */
export interface FlowPosition {
  /** Stack of node indices (path through nested flows) */
  path: number[];
  /** Current iteration counts for loops */
  iterations: Record<string, number>;
  /** Current player index for eachPlayer */
  playerIndex?: number;
  /** Current item index for forEach */
  itemIndex?: number;
  /** Variables stored in flow context */
  variables: Record<string, unknown>;
}

/**
 * Context passed to flow nodes during execution
 */
export interface FlowContext<G extends Game = Game> {
  /** The game instance */
  game: G;
  /** Current player (if in a player-scoped flow) */
  player?: Player;
  /** Variables stored during flow execution */
  variables: Record<string, unknown>;
  /** Set a variable */
  set: (name: string, value: unknown) => void;
  /** Get a variable */
  get: <T = unknown>(name: string) => T | undefined;
  /** Result of the last action */
  lastActionResult?: ActionResult;
}

/**
 * Base configuration for all flow nodes
 */
export interface BaseFlowConfig {
  /** Optional name for this flow node (for serialization) */
  name?: string;
}

/**
 * Configuration for sequence flow
 */
export interface SequenceConfig extends BaseFlowConfig {
  /** Steps to execute in order */
  steps: FlowNode[];
}

/**
 * Configuration for loop flow
 */
export interface LoopConfig extends BaseFlowConfig {
  /** Condition to continue looping (evaluated before each iteration) */
  while?: (context: FlowContext) => boolean;
  /** Maximum iterations (safety limit) */
  maxIterations?: number;
  /** Body of the loop */
  do: FlowNode;
}

/**
 * Configuration for each-player flow
 */
export interface EachPlayerConfig extends BaseFlowConfig {
  /** Filter which players to include */
  filter?: (player: Player, context: FlowContext) => boolean;
  /** Direction of rotation */
  direction?: 'forward' | 'backward';
  /** Starting player (defaults to current player) */
  startingPlayer?: (context: FlowContext) => Player;
  /** Body to execute for each player */
  do: FlowNode;
}

/**
 * Configuration for for-each flow
 */
export interface ForEachConfig<T = unknown> extends BaseFlowConfig {
  /** Items to iterate over */
  collection: T[] | ((context: FlowContext) => T[]);
  /** Variable name to store current item */
  as: string;
  /** Body to execute for each item */
  do: FlowNode;
}

/**
 * Configuration for action step
 */
export interface ActionStepConfig extends BaseFlowConfig {
  /** Player who should act (defaults to context.player) */
  player?: (context: FlowContext) => Player;
  /** Actions available to the player */
  actions: string[] | ((context: FlowContext) => string[]);
  /** Prompt to display */
  prompt?: string | ((context: FlowContext) => string);
  /** Continue until this returns true */
  repeatUntil?: (context: FlowContext) => boolean;
  /** Skip if this returns true */
  skipIf?: (context: FlowContext) => boolean;
  /** Optional timeout in milliseconds */
  timeout?: number;
  /** Minimum number of moves required before step can complete */
  minMoves?: number;
  /** Maximum number of moves allowed (auto-completes after this many) */
  maxMoves?: number;
}

/**
 * Configuration for simultaneous action step (multiple players act at once)
 */
export interface SimultaneousActionStepConfig extends BaseFlowConfig {
  /** Players who can act (defaults to all players) */
  players?: (context: FlowContext) => Player[];
  /** Actions available to each player */
  actions: string[] | ((context: FlowContext, player: Player) => string[]);
  /** Prompt to display */
  prompt?: string | ((context: FlowContext) => string);
  /** Condition to check if a player is done (per-player) */
  playerDone?: (context: FlowContext, player: Player) => boolean;
  /** Condition to check if the entire step is complete */
  allDone?: (context: FlowContext) => boolean;
  /** Skip this player if returns true */
  skipPlayer?: (context: FlowContext, player: Player) => boolean;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Configuration for switch flow (branch based on condition)
 */
export interface SwitchConfig extends BaseFlowConfig {
  /** Value to switch on */
  on: (context: FlowContext) => unknown;
  /** Cases to match */
  cases: Record<string, FlowNode>;
  /** Default case if no match */
  default?: FlowNode;
}

/**
 * Configuration for if flow (conditional execution)
 */
export interface IfConfig extends BaseFlowConfig {
  /** Condition to check */
  condition: (context: FlowContext) => boolean;
  /** Execute if true */
  then: FlowNode;
  /** Execute if false */
  else?: FlowNode;
}

/**
 * Configuration for execute flow (run side effect)
 */
export interface ExecuteConfig extends BaseFlowConfig {
  /** Function to execute */
  fn: (context: FlowContext) => void;
}

/**
 * Configuration for phase flow (named game phase)
 */
export interface PhaseConfig extends BaseFlowConfig {
  /** Phase name (required, displayed in UI) */
  name: string;
  /** Body to execute during this phase */
  do: FlowNode;
}

/**
 * Union of all flow node types
 */
export type FlowNode =
  | { type: 'sequence'; config: SequenceConfig }
  | { type: 'loop'; config: LoopConfig }
  | { type: 'each-player'; config: EachPlayerConfig }
  | { type: 'for-each'; config: ForEachConfig }
  | { type: 'action-step'; config: ActionStepConfig }
  | { type: 'simultaneous-action-step'; config: SimultaneousActionStepConfig }
  | { type: 'switch'; config: SwitchConfig }
  | { type: 'if'; config: IfConfig }
  | { type: 'execute'; config: ExecuteConfig }
  | { type: 'phase'; config: PhaseConfig };

/**
 * Per-player awaiting state for simultaneous actions
 */
export interface PlayerAwaitingState {
  /** Player position */
  playerIndex: number;
  /** Actions available to this player */
  availableActions: string[];
  /** Whether this player has completed their action */
  completed: boolean;
}

/**
 * Flow execution state
 */
export interface FlowState {
  /** Current position in the flow */
  position: FlowPosition;
  /** Whether the flow is complete */
  complete: boolean;
  /** Whether awaiting player input */
  awaitingInput: boolean;
  /** Current player if awaiting input (for single-player action steps) */
  currentPlayer?: number;
  /** Available actions if awaiting input (for single-player action steps) */
  availableActions?: string[];
  /** Prompt to display */
  prompt?: string;
  /** Multiple players awaiting input (for simultaneous action steps) */
  awaitingPlayers?: PlayerAwaitingState[];
  /** Current named phase (for UI display) */
  currentPhase?: string;
  /** Move count for current action step (if minMoves/maxMoves configured) */
  moveCount?: number;
  /** Moves remaining until maxMoves (if configured) */
  movesRemaining?: number;
  /** Moves required until minMoves met (if configured) */
  movesRequired?: number;
}

/**
 * Flow definition for a game
 */
export interface FlowDefinition {
  /** The root flow node */
  root: FlowNode;
  /** Setup function called before flow starts */
  setup?: (context: FlowContext) => void;
  /** Check if game is complete */
  isComplete?: (context: FlowContext) => boolean;
  /** Determine winners when complete */
  getWinners?: (context: FlowContext) => Player[];
  /** Called when entering a named phase */
  onEnterPhase?: (phaseName: string, context: FlowContext) => void;
  /** Called when exiting a named phase */
  onExitPhase?: (phaseName: string, context: FlowContext) => void;
}
