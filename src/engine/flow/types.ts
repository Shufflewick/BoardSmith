import type { Game, PlayerOf } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { ActionDefinition, ActionResult, FollowUpAction } from '../action/types.js';

/**
 * Flow node types
 */
export type FlowNodeType =
  | 'sequence'
  | 'loop'
  | 'repeat'
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
}

/**
 * Serialized flow position for pause/resume
 */
export interface FlowPosition {
  /** Stack of node indices (path through nested flows) */
  path: number[];
  /** Current iteration counts for loops */
  iterations: Record<string, number>;
  /** Per-frame execution metadata needed for accurate restore */
  frameData?: Record<string, Record<string, unknown>>;
  /** Current player index for eachPlayer */
  playerIndex?: number;
  /** Variables stored in flow context */
  variables: Record<string, unknown>;
  /**
   * The acting seat's run of committed actions, so a `turnScope: 'continue'`
   * step entered after a restore carries the same count it would have carried
   * without one. See {@link TurnRun}.
   */
  turnRun?: TurnRun;
}

/**
 * Context passed to flow nodes during execution
 */
export interface FlowContext<G extends Game = Game> {
  /** The game instance */
  game: G;
  /**
   * Current player (if in a player-scoped flow), typed as the game's own
   * Player subclass -- see {@link PlayerOf}.
   */
  player?: PlayerOf<G>;
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
export interface SequenceConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Steps to execute in order */
  steps: FlowNode<G>[];
}

/**
 * Configuration for loop flow
 */
export interface LoopConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Condition to continue looping (evaluated before each iteration) */
  while?: (context: FlowContext<G>) => boolean;
  /** Maximum iterations (safety limit) */
  maxIterations?: number;
  /**
   * Opt-in for a genuinely unbounded game — makes `maxIterations` optional.
   * The high global whole-flow safety tripwire (DEFAULT_MAX_ITERATIONS) still
   * applies even when this is set, so a genuinely stuck loop still fails loud
   * instead of hanging the process.
   */
  unbounded?: boolean;
  /** Body of the loop */
  do: FlowNode<G>;
}

/**
 * Configuration for repeat flow
 */
export interface RepeatNodeConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Number of iterations to run */
  times: number;
  /** Body of the repeat */
  do: FlowNode<G>;
}

/**
 * Configuration for each-player flow
 */
export interface EachPlayerConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Filter which players to include */
  filter?: (player: PlayerOf<G>, context: FlowContext<G>) => boolean;
  /** Direction of rotation */
  direction?: 'forward' | 'backward';
  /** Starting player (defaults to current player) */
  startingPlayer?: (context: FlowContext<G>) => PlayerOf<G>;
  /** Body to execute for each player */
  do: FlowNode<G>;
}

/**
 * Configuration for for-each flow.
 *
 * Items are restricted to `GameElement | string | number | boolean | null`
 * because the loop snapshots the collection on entry and the per-item snapshot
 * must round-trip through checkpoint/restore (matches the runtime throw in
 * `executeForEach`).
 */
export interface ForEachConfig<
  T extends GameElement | string | number | boolean | null = GameElement | string | number | boolean | null,
  G extends Game = Game,
> extends BaseFlowConfig {
  /** Items to iterate over */
  collection: T[] | ((context: FlowContext<G>) => T[]);
  /** Variable name to store current item */
  as: string;
  /** Body to execute for each item */
  do: FlowNode<G>;
}

/**
 * Configuration for action step
 */
export interface ActionStepConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Player who should act (defaults to context.player) */
  player?: (context: FlowContext<G>) => PlayerOf<G>;
  /** Actions available to the player */
  actions: string[] | ((context: FlowContext<G>) => string[]);
  /** Continue until this returns true */
  repeatUntil?: (context: FlowContext<G>) => boolean;
  /** Skip if this returns true */
  skipIf?: (context: FlowContext<G>) => boolean;
  /** Minimum number of moves required before step can complete */
  minMoves?: number;
  /** Maximum number of moves allowed (auto-completes after this many) */
  maxMoves?: number;
  /**
   * What a FRESH entry into this step means for the seat that just acted:
   * the continuation of the turn it is already taking, or the start of a new
   * one.
   *
   * Undo reach is measured in `moveCount`, which lives on the action-step
   * FRAME. A step re-entered from a `loop`, or reached as the next step of a
   * `sequence`, gets a NEW frame -- so without this field its `moveCount`
   * starts at 0 and the seat cannot take back the action it just took, even
   * though its turn is still going.
   *
   * - `'continue'` -- this entry continues the same turn. The frame starts
   *   with the run's move count already on it, so undo reaches back over the
   *   whole run. `minMoves`/`maxMoves`, if declared, then bound the RUN rather
   *   than the single entry, which is the same thing when the run is one turn.
   * - `'restart'` -- this entry is a new turn. The frame starts at 0 and undo
   *   does not reach behind it. This is what a closed turn boundary looks like.
   *
   * Required only where the answer is genuinely ambiguous: the engine is about
   * to prompt the SAME seat that committed the immediately preceding action,
   * in a NEW frame. Everywhere else -- the first action of the game, a step
   * that stays open via `repeatUntil`, or any step reached after a DIFFERENT
   * seat acted -- there is nothing to carry and the field is not consulted.
   * Leaving it out on an ambiguous step is not silent: the engine warns in dev
   * and publishes {@link FlowState.turnScopeUndeclared}, so an undo attempted
   * there is refused with the reason rather than with "No actions to undo".
   * It does not throw, because both readings are plausible and only the author
   * knows which -- a `sequence` of same-seat steps is one turn in Polyhedral
   * Potions and three separate turns in
   * `session/testing/solo-undo-authoritative.test.ts`.
   */
  turnScope?: TurnScope;
}

/**
 * Whether a fresh entry into an action step continues the acting seat's
 * current turn or begins a new one. See {@link ActionStepConfig.turnScope}.
 */
export type TurnScope = 'continue' | 'restart';

/**
 * The acting seat's run of committed actions, carried across the frame
 * boundaries a `loop` or a `sequence` of steps creates.
 *
 * Lives on {@link FlowPosition} rather than only in memory because a restore
 * (`GameRunner.fromSnapshot`, an MCTS clone, the dev-server HMR transfer) can
 * land between the action that ended one frame and the entry that opens the
 * next. Without it the engine would reach that entry with nothing to carry and
 * would seed a `'continue'` step at 0 -- silently the same zero-reach defect
 * `turnScope` exists to remove.
 */
export interface TurnRun {
  /** Seat number of the player whose run this is. */
  player: number;
  /** Committed actions in the run so far. */
  count: number;
}

/**
 * Configuration for simultaneous action step (multiple players act at once)
 */
export interface SimultaneousActionStepConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Players who can act (defaults to all players) */
  players?: (context: FlowContext<G>) => PlayerOf<G>[];
  /** Actions available to each player */
  actions: string[] | ((context: FlowContext<G>, player: PlayerOf<G>) => string[]);
  /** Condition to check if a player is done (per-player) */
  playerDone?: (context: FlowContext<G>, player: PlayerOf<G>) => boolean;
  /** Condition to check if the entire step is complete */
  allDone?: (context: FlowContext<G>) => boolean;
  /** Skip this player if returns true */
  skipPlayer?: (context: FlowContext<G>, player: PlayerOf<G>) => boolean;
}

/**
 * Configuration for switch flow (branch based on condition)
 */
export interface SwitchConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Value to switch on */
  on: (context: FlowContext<G>) => unknown;
  /** Cases to match */
  cases: Record<string, FlowNode<G>>;
  /** Default case if no match */
  default?: FlowNode<G>;
}

/**
 * Configuration for if flow (conditional execution)
 */
export interface IfConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Condition to check */
  condition: (context: FlowContext<G>) => boolean;
  /** Execute if true */
  then: FlowNode<G>;
  /** Execute if false */
  else?: FlowNode<G>;
}

/**
 * Configuration for execute flow (run side effect)
 */
export interface ExecuteConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Function to execute */
  fn: (context: FlowContext<G>) => void;
  /**
   * Does this step COMMIT something an undo cannot honestly take back
   * (UNDO-02)?
   *
   * `false`/absent (the default) — the step is undo-transparent. Anything it
   * touches lives in the game state, and a checkpoint restore reproduces it
   * exactly, so undo/rewind may cross it freely. This covers the overwhelmingly
   * common case: flow bookkeeping (`ctx.set('turnComplete', true)`, resetting a
   * per-turn flag), derived state, messages.
   *
   * `true` — undo and rewind are FENCED at this point: no restore may target an
   * action before it. Mark a step irreversible when its effect escapes the state
   * model, and the canonical case is INFORMATION REACHING A HUMAN — dealing or
   * revealing hidden cards, showing a secret role. Restoring the tree un-deals
   * the card; it cannot un-see it, so allowing the rewind would let a player
   * learn what they should not know and then take it back.
   *
   * Choose by asking "if the engine restored the snapshot from just before this
   * step, would anything be WRONG?" — not "is this step important". Scoring,
   * drawing into a face-down deck, and moving pieces are all state, and state
   * restores.
   */
  irreversible?: boolean;
}

/**
 * Configuration for phase flow (named game phase)
 */
export interface PhaseConfig<G extends Game = Game> extends BaseFlowConfig {
  /** Phase name (required, displayed in UI) */
  name: string;
  /** Body to execute during this phase */
  do: FlowNode<G>;
}

/**
 * Union of all flow node types
 */
export type FlowNode<G extends Game = Game> =
  | { type: 'sequence'; config: SequenceConfig<G> }
  | { type: 'loop'; config: LoopConfig<G> }
  | { type: 'repeat'; config: RepeatNodeConfig<G> }
  | { type: 'each-player'; config: EachPlayerConfig<G> }
  | { type: 'for-each'; config: ForEachConfig<GameElement | string | number | boolean | null, G> }
  | { type: 'action-step'; config: ActionStepConfig<G> }
  | { type: 'simultaneous-action-step'; config: SimultaneousActionStepConfig<G> }
  | { type: 'switch'; config: SwitchConfig<G> }
  | { type: 'if'; config: IfConfig<G> }
  | { type: 'execute'; config: ExecuteConfig<G> }
  | { type: 'phase'; config: PhaseConfig<G> };

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
  /** Multiple players awaiting input (for simultaneous action steps) */
  awaitingPlayers?: PlayerAwaitingState[];
  /** Current named phase (for UI display) */
  currentPhase?: string;
  /**
   * Number of moves taken in the CURRENTLY ACTIVE action-step frame. Published
   * for every action step (not only ones declaring minMoves/maxMoves) --
   * `session/utils.ts`'s `computeUndoInfo` treats this as the sole
   * authoritative undo-boundary signal (UNDO-03): a MISSING value means "not
   * currently in an action step" and is treated as undo-unavailable, never as
   * "fall back to a heuristic" (no such fallback exists). Genuinely absent
   * only when the flow isn't awaiting an action-step's input at all.
   */
  moveCount?: number;
  /**
   * Name of the action step whose fresh entry re-prompted the seat that had
   * just acted WITHOUT declaring {@link ActionStepConfig.turnScope}.
   *
   * Present only while that frame is the active one. `moveCount` is 0 there
   * for a structural reason rather than because the seat has done nothing, so
   * the undo refusal quotes this instead of the misleading "No actions to
   * undo" that made the defect look like a design decision.
   */
  turnScopeUndeclared?: string;
  /** Moves remaining until maxMoves (if configured) */
  movesRemaining?: number;
  /** Moves required until minMoves met (if configured) */
  movesRequired?: number;
  /** Error from last action if it failed (cleared on success) */
  actionError?: string;
  /**
   * True when `actionError` came from author code THROWING inside `execute()`,
   * rather than from a clean refusal or a validation rejection (#44). The
   * runner rolls the game back to the pre-action checkpoint when it sees this,
   * because a throw may have applied part of its changes.
   */
  actionThrew?: boolean;
  /**
   * Follow-up action to chain after the last action completed.
   * When present, the client should automatically start this action
   * with the provided args pre-filled.
   */
  followUp?: FollowUpAction;
  // NOTE (BUG-017): `ActionResult.data`/`.message` deliberately do NOT live
  // here, even though `followUp` does. `FlowState` fans out: `stateless-ops`'s
  // `buildViews`/`buildSpectatorView` hand the whole object to EVERY seat and
  // to the spectator. `data` is the acting seat's private return value (a map
  // recall, a scout report), so a field on this interface would publish it to
  // the whole table — the same leak that rules out `game.animate()` as a
  // channel. It travels instead via `FlowEngine.getLastActionResult()`, read
  // by `GameRunner.performAction` and returned only to that op's caller.
}

/**
 * Structured, human- and machine-readable description of "where in the flow
 * are we right now" — produced by `describeFlowPosition()` and exposed via
 * `Game.getFlowDebugInfo()`.
 */
export interface FlowDebugInfo {
  /** Current named phase, read directly from `FlowState.currentPhase`. */
  phase?: string;
  /** Most-specific named node reached by following the flow position's path; falls back to the node's `type` (e.g. `'action-step'`) when unnamed. */
  step?: string;
  /** Raw index path, for machine consumers that want the exact position. */
  path: number[];
  /** Seat(s) currently awaited, mirrors `FlowState.currentPlayer`/`awaitingPlayers`. */
  awaiting: {
    /** Current player seat if awaiting input (single-player action steps). */
    currentPlayer?: number;
    /** Seats awaiting input (simultaneous action steps). */
    awaitingPlayers?: number[];
  };
  /** Human-readable one-liner, e.g. "phase *pegging* -> step *player-turn*, waiting on seat 2". */
  describe(): string;
}

/**
 * Flow definition for a game
 */
export interface FlowDefinition<G extends Game = Game> {
  /** The root flow node */
  root: FlowNode<G>;
  /** Setup function called before flow starts */
  setup?: (context: FlowContext<G>) => void;
  /** Check if game is complete */
  isComplete?: (context: FlowContext<G>) => boolean;
  /** Determine winners when complete */
  getWinners?: (context: FlowContext<G>) => PlayerOf<G>[];
  /** Called when entering a named phase */
  onEnterPhase?: (phaseName: string, context: FlowContext<G>) => void;
  /** Called when exiting a named phase */
  onExitPhase?: (phaseName: string, context: FlowContext<G>) => void;
}
