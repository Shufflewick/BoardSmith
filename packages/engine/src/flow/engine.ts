import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionResult } from '../action/types.js';
import type {
  FlowNode,
  FlowContext,
  FlowPosition,
  FlowState,
  FlowStepResult,
  FlowDefinition,
  SequenceConfig,
  LoopConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  ExecuteConfig,
  PhaseConfig,
  PlayerAwaitingState,
} from './types.js';

/**
 * Maximum iterations for safety (prevent infinite loops)
 */
const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * Creates a flow context for execution
 */
function createContext<G extends Game>(
  game: G,
  player?: Player,
  variables: Record<string, unknown> = {}
): FlowContext<G> {
  return {
    game,
    player,
    variables,
    set: (name: string, value: unknown) => {
      variables[name] = value;
    },
    get: <T = unknown>(name: string): T | undefined => {
      return variables[name] as T | undefined;
    },
  };
}

/**
 * Internal execution state for tracking position in nested flows
 */
interface ExecutionFrame {
  node: FlowNode;
  index: number; // Current step index for sequences, iteration for loops
  completed: boolean;
  data?: Record<string, unknown>; // Node-specific data
}

/**
 * Executes flow definitions and manages game state progression.
 *
 * FlowEngine is the runtime interpreter for flow definitions created with
 * {@link defineFlow} and flow builder functions. It handles:
 * - Executing flow nodes (sequences, loops, conditionals, action steps)
 * - Pausing at action steps to wait for player input
 * - Resuming after player actions
 * - Tracking game completion and determining winners
 * - Serializing/restoring state for persistence
 *
 * Most game developers don't interact with FlowEngine directly - instead use
 * the flow builder functions to define game flow, and the game session handles
 * engine operations automatically.
 *
 * @example
 * ```typescript
 * // Define the flow
 * const flow = defineFlow({
 *   setup: (ctx) => { ... },
 *   root: loop({
 *     while: (ctx) => !ctx.game.isFinished(),
 *     do: eachPlayer({ do: playerTurn })
 *   }),
 *   isComplete: (ctx) => someoneWon(ctx),
 *   getWinners: (ctx) => [getWinner(ctx)]
 * });
 *
 * // Engine is created internally by GameSession
 * const engine = new FlowEngine(game, flow);
 * const state = engine.start();
 *
 * // When player acts
 * const newState = engine.resume('playCard', { card: 42 });
 * ```
 */
export class FlowEngine<G extends Game = Game> {
  private game: G;
  private definition: FlowDefinition;
  private stack: ExecutionFrame[] = [];
  private variables: Record<string, unknown> = {};
  private currentPlayer?: Player;
  private awaitingInput = false;
  private availableActions: string[] = [];
  private complete = false;
  private lastActionResult?: ActionResult;
  /** Error from last action if it failed (cleared on success) */
  private actionError?: string;
  /** For simultaneous action steps - tracks which players can act */
  private awaitingPlayers: PlayerAwaitingState[] = [];
  /** Current named phase (for UI display) */
  private currentPhase?: string;
  /** Track warned actions to avoid console spam */
  private warnedUnknownActions = new Set<string>();
  /** Move count for current action step with move limits */
  private moveCount = 0;
  /** Current action step config (for move limit tracking) */
  private currentActionConfig?: ActionStepConfig;

  constructor(game: G, definition: FlowDefinition) {
    this.game = game;
    this.definition = definition;
  }

  // ============================================================================
  // SECTION: Public API
  // Purpose: External interface - start, resume, getState, restore, isComplete, getWinners
  // ============================================================================

  /**
   * Start the flow from the beginning
   */
  start(): FlowState {
    // Run setup if defined
    const context = this.createContext();
    if (this.definition.setup) {
      this.definition.setup(context);
    }

    // Initialize stack with root node
    this.stack = [{ node: this.definition.root, index: 0, completed: false }];
    this.variables = { ...context.variables };
    this.currentPlayer = this.game.players.current;
    this.awaitingInput = false;
    this.complete = false;

    // Execute until we need input or complete
    return this.run();
  }

  /**
   * Resume flow after player action
   * @param actionName The action to perform
   * @param args The action arguments
   * @param playerIndex Optional player index for simultaneous actions (if not provided, uses current player)
   */
  resume(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    const currentFrame = this.stack[this.stack.length - 1];

    // Handle simultaneous action step
    if (currentFrame?.node.type === 'simultaneous-action-step') {
      return this.resumeSimultaneousAction(actionName, args, playerIndex, currentFrame);
    }

    // Execute the action (regular action step)
    const result = this.game.performAction(actionName, this.currentPlayer!, args);
    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state and record the error
      this.actionError = result.error;
      return this.getState();
    }

    // Clear error and awaiting state on success
    this.actionError = undefined;
    this.awaitingInput = false;

    // Handle action step completion logic
    if (currentFrame?.node.type === 'action-step') {
      const config = currentFrame.node.config as ActionStepConfig;

      // If action returned a followUp, don't complete the step or count the move yet.
      // The followUp chain must complete first. Only when the final action in the chain
      // completes (no followUp) do we count it as a move and check completion.
      // This prevents followUp chains from counting against parent loop's maxIterations.
      if (result.followUp) {
        // Stay in the same actionStep, waiting for the followUp to be executed
        return this.run();
      }

      // Increment move count (only when action chain is complete - no followUp)
      const currentMoveCount = (currentFrame.data?.moveCount as number) ?? 0;
      const newMoveCount = currentMoveCount + 1;
      currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };

      // Check if maxMoves reached - auto-complete
      if (config.maxMoves && newMoveCount >= config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = undefined;
        this.moveCount = 0;
      }
      // Check repeatUntil - only complete if minMoves is met
      else if (config.repeatUntil) {
        const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
        if (config.repeatUntil(this.createContext()) && minMovesMet) {
          currentFrame.completed = true;
          this.currentActionConfig = undefined;
          this.moveCount = 0;
        }
      }
      // No repeatUntil and no maxMoves - complete after single action (unless minMoves/maxMoves configured)
      else if (!config.minMoves && !config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = undefined;
        this.moveCount = 0;
      }
      // Has minMoves but no maxMoves and no repeatUntil - keep going
      // The executeActionStep will check minMoves when re-entered
    }

    return this.run();
  }

  /**
   * Resume flow after an action was executed externally (e.g., via pending action).
   * This is like resume() but skips the action execution since it already happened.
   * @param result The result of the externally-executed action
   */
  resumeAfterExternalAction(result: ActionResult): FlowState {
    if (!this.awaitingInput) {
      throw new Error('Flow is not awaiting input');
    }

    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state
      return this.getState();
    }

    // Clear awaiting state
    this.awaitingInput = false;

    // Handle action step completion logic
    const currentFrame = this.stack[this.stack.length - 1];
    if (currentFrame?.node.type === 'action-step') {
      const config = currentFrame.node.config as ActionStepConfig;

      // If action returned a followUp, don't complete the step or count the move yet.
      // The followUp chain must complete first. Only when the final action in the chain
      // completes (no followUp) do we count it as a move and check completion.
      // This prevents followUp chains from counting against parent loop's maxIterations.
      if (result.followUp) {
        // Stay in the same actionStep, waiting for the followUp to be executed
        return this.run();
      }

      // Increment move count (only when action chain is complete - no followUp)
      const currentMoveCount = (currentFrame.data?.moveCount as number) ?? 0;
      const newMoveCount = currentMoveCount + 1;
      currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };

      // Check if maxMoves reached - auto-complete
      if (config.maxMoves && newMoveCount >= config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = undefined;
        this.moveCount = 0;
      }
      // Check repeatUntil - only complete if minMoves is met
      else if (config.repeatUntil) {
        const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
        if (config.repeatUntil(this.createContext()) && minMovesMet) {
          currentFrame.completed = true;
          this.currentActionConfig = undefined;
          this.moveCount = 0;
        }
      }
      // No repeatUntil and no maxMoves - complete after single action (unless minMoves/maxMoves configured)
      else if (!config.minMoves && !config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = undefined;
        this.moveCount = 0;
      }
    }

    return this.run();
  }

  // ============================================================================
  // SECTION: Resume Handling
  // Purpose: Private methods for handling different resume scenarios
  // ============================================================================

  /**
   * Resume a simultaneous action step after a player's action.
   *
   * Handles multi-player concurrent action scenarios where all players can act
   * independently. Validates the acting player, executes their action, then
   * re-evaluates completion conditions:
   * - playerDone: Per-player completion check (called after each action)
   * - allDone: Global completion check (step completes when true)
   * - Auto-completes players with no remaining available actions
   *
   * Continues awaiting input until all players are done or allDone returns true.
   */
  private resumeSimultaneousAction(
    actionName: string,
    args: Record<string, unknown>,
    playerIndex: number | undefined,
    frame: ExecutionFrame
  ): FlowState {
    const config = frame.node.config as SimultaneousActionStepConfig;

    // Determine which player is acting
    let actingPlayerIndex = playerIndex;
    if (actingPlayerIndex === undefined) {
      // If not provided, use the first awaiting player
      const firstAwaiting = this.awaitingPlayers.find(p => !p.completed && p.availableActions.length > 0);
      if (firstAwaiting) {
        actingPlayerIndex = firstAwaiting.playerIndex;
      }
    }

    if (actingPlayerIndex === undefined) {
      throw new Error('No player specified and no awaiting players found');
    }

    // Validate player can act
    const playerState = this.awaitingPlayers.find(p => p.playerIndex === actingPlayerIndex);
    if (!playerState) {
      throw new Error(`Player ${actingPlayerIndex} is not awaiting action`);
    }
    if (playerState.completed) {
      throw new Error(`Player ${actingPlayerIndex} has already completed their action`);
    }
    if (!playerState.availableActions.includes(actionName)) {
      throw new Error(`Action ${actionName} is not available for player ${actingPlayerIndex}`);
    }

    // Execute the action (actingPlayerIndex is 1-indexed position)
    const player = this.game.players.get(actingPlayerIndex);
    if (!player) {
      throw new Error(`Invalid player position: ${actingPlayerIndex}`);
    }
    const result = this.game.performAction(actionName, player as any, args);
    this.lastActionResult = result;

    if (!result.success) {
      // Action failed, stay in same state
      return this.getState();
    }

    // Check if this player is done (re-evaluate after action)
    const context = this.createContext();
    if (config.playerDone) {
      playerState.completed = config.playerDone(context, player);
    }

    // Re-evaluate available actions for this player
    if (!playerState.completed) {
      const actions = typeof config.actions === 'function'
        ? config.actions(context, player)
        : config.actions;
      playerState.availableActions = actions.filter((availableActionName) => {
        const action = this.game.getAction(availableActionName);
        if (!action) return false;
        return this.game.getAvailableActions(player as any).some((a) => a.name === availableActionName);
      });
      // If no available actions left, mark as completed
      if (playerState.availableActions.length === 0) {
        playerState.completed = true;
      }
    }

    // Check if all players are done
    const allDone = config.allDone
      ? config.allDone(context)
      : this.awaitingPlayers.every(p => p.completed);

    if (allDone) {
      // Clear awaiting state and complete the step
      this.awaitingInput = false;
      this.awaitingPlayers = [];
      frame.completed = true;
      return this.run();
    }

    // Still awaiting other players
    return this.getState();
  }

  /**
   * Get the current flow state
   */
  getState(): FlowState {
    const state: FlowState = {
      position: this.getPosition(),
      complete: this.complete,
      awaitingInput: this.awaitingInput,
      currentPlayer: this.currentPlayer?.position,
      availableActions: this.awaitingInput ? this.availableActions : undefined,
      awaitingPlayers: this.awaitingPlayers.length > 0 ? this.awaitingPlayers : undefined,
      currentPhase: this.currentPhase,
    };

    // Add move count info if in an action step with limits
    if (this.currentActionConfig && (this.currentActionConfig.minMoves || this.currentActionConfig.maxMoves)) {
      state.moveCount = this.moveCount;
      if (this.currentActionConfig.maxMoves) {
        state.movesRemaining = this.currentActionConfig.maxMoves - this.moveCount;
      }
      if (this.currentActionConfig.minMoves) {
        state.movesRequired = Math.max(0, this.currentActionConfig.minMoves - this.moveCount);
      }
    }

    // Include action error if present
    if (this.actionError) {
      state.actionError = this.actionError;
    }

    // Include followUp if last action returned one
    if (this.lastActionResult?.followUp) {
      state.followUp = this.lastActionResult.followUp;
    }

    return state;
  }

  /**
   * Restore flow from a serialized position
   */
  restore(position: FlowPosition): void {
    this.variables = { ...position.variables };
    this.stack = [];

    // Rebuild stack from path
    let currentNode = this.definition.root;
    for (let i = 0; i < position.path.length; i++) {
      const index = position.path[i];
      const iterationKey = `__iter_${i}`;
      const iteration = position.iterations[iterationKey] ?? 0;

      this.stack.push({
        node: currentNode,
        index,
        completed: false,
        data: { iteration },
      });

      // Navigate to child node for next level
      currentNode = this.getChildNode(currentNode, index);
    }

    // Set player from position (playerIndex is 1-indexed)
    if (position.playerIndex !== undefined) {
      this.currentPlayer = this.game.players.get(position.playerIndex);
    }
  }

  /**
   * Check if the game is complete
   */
  isComplete(): boolean {
    return this.complete;
  }

  /**
   * Get the winners (if game is complete)
   */
  getWinners(): Player[] {
    if (!this.complete) return [];
    if (this.definition.getWinners) {
      return this.definition.getWinners(this.createContext());
    }
    return [];
  }

  // ============================================================================
  // SECTION: Core Execution Loop
  // Purpose: Context creation, position tracking, main execution loop
  // ============================================================================

  private createContext(): FlowContext<G> {
    const context = createContext(this.game, this.currentPlayer, this.variables);
    context.lastActionResult = this.lastActionResult;
    return context;
  }

  private getPosition(): FlowPosition {
    const path: number[] = [];
    const iterations: Record<string, number> = {};

    for (let i = 0; i < this.stack.length; i++) {
      const frame = this.stack[i];
      path.push(frame.index);
      if (frame.data?.iteration !== undefined) {
        iterations[`__iter_${i}`] = frame.data.iteration as number;
      }
    }

    return {
      path,
      iterations,
      playerIndex: this.currentPlayer?.position,
      variables: { ...this.variables },
    };
  }

  private getChildNode(node: FlowNode, index: number): FlowNode {
    switch (node.type) {
      case 'sequence':
        return node.config.steps[index];
      case 'loop':
      case 'each-player':
      case 'for-each':
      case 'phase':
        return node.config.do;
      case 'if':
        return index === 0 ? node.config.then : (node.config.else ?? node.config.then);
      case 'switch': {
        const cases = Object.values(node.config.cases);
        return cases[index] ?? node.config.default ?? cases[0];
      }
      default:
        return node;
    }
  }

  /**
   * Main execution loop - runs until awaiting input or complete.
   *
   * Uses a stack-based state machine to execute nested flow nodes. Each iteration
   * processes one node, which may push children onto the stack (e.g., sequence steps)
   * or mark itself complete. The loop exits when:
   * - A node requires player input (awaitingInput)
   * - The game's isComplete() returns true
   * - The stack empties (all nodes processed)
   *
   * Includes iteration safety (DEFAULT_MAX_ITERATIONS) to detect infinite loops
   * from misconfigured while/repeatUntil conditions.
   */
  private run(): FlowState {
    let iterations = 0;

    while (this.stack.length > 0 && !this.awaitingInput && !this.complete) {
      iterations++;
      if (iterations > DEFAULT_MAX_ITERATIONS) {
        // Build helpful error message with context
        const frame = this.stack[this.stack.length - 1];
        const nodeName = frame?.node?.config?.name ?? frame?.node?.type ?? 'unknown';
        const nodeType = frame?.node?.type ?? 'unknown';
        const stackTrace = this.stack.map((f, i) =>
          `  ${i}: ${f.node.type}${f.node.config?.name ? ` "${f.node.config.name}"` : ''} (index: ${f.index})`
        ).join('\n');

        throw new Error(
          `Flow exceeded ${DEFAULT_MAX_ITERATIONS} iterations - possible infinite loop.\n\n` +
          `Current node: ${nodeType}${nodeName !== nodeType ? ` "${nodeName}"` : ''}\n` +
          `Flow stack:\n${stackTrace}\n\n` +
          `Common causes:\n` +
          `- A while() condition that never becomes false\n` +
          `- Missing state update that should break the loop\n` +
          `- Condition references stale game state\n` +
          `- isFinished() never returns true\n\n` +
          `Fix: Check the while/repeatUntil conditions in the nodes above.`
        );
      }

      const frame = this.stack[this.stack.length - 1];

      // If frame is already completed (e.g., from resume), pop it and continue
      if (frame.completed) {
        this.stack.pop();
        continue;
      }

      const result = this.executeNode(frame);

      if (result.awaitingInput) {
        this.awaitingInput = true;
        break;
      }

      if (frame.completed) {
        this.stack.pop();
      }

      // Check game completion after each node execution
      if (this.definition.isComplete?.(this.createContext())) {
        this.complete = true;
        break;
      }
    }

    // Check completion after stack empty
    if (this.stack.length === 0 || this.definition.isComplete?.(this.createContext())) {
      this.complete = true;
    }

    return this.getState();
  }

  // ============================================================================
  // SECTION: Node Dispatch
  // Purpose: Node type dispatch and routing
  // ============================================================================

  /**
   * Execute a single flow node
   */
  private executeNode(frame: ExecutionFrame): FlowStepResult {
    const context = this.createContext();

    switch (frame.node.type) {
      case 'sequence':
        return this.executeSequence(frame, frame.node.config, context);
      case 'loop':
        return this.executeLoop(frame, frame.node.config, context);
      case 'each-player':
        return this.executeEachPlayer(frame, frame.node.config, context);
      case 'for-each':
        return this.executeForEach(frame, frame.node.config, context);
      case 'action-step':
        return this.executeActionStep(frame, frame.node.config, context);
      case 'simultaneous-action-step':
        return this.executeSimultaneousActionStep(frame, frame.node.config, context);
      case 'switch':
        return this.executeSwitch(frame, frame.node.config, context);
      case 'if':
        return this.executeIf(frame, frame.node.config, context);
      case 'execute':
        return this.executeExecute(frame, frame.node.config, context);
      case 'phase':
        return this.executePhase(frame, frame.node.config, context);
      default:
        frame.completed = true;
        return { continue: true, awaitingInput: false };
    }
  }

  // ============================================================================
  // SECTION: Flow Control Executors
  // Purpose: Sequence, loop, each-player, for-each execution
  // ============================================================================

  private executeSequence(
    frame: ExecutionFrame,
    config: SequenceConfig,
    context: FlowContext
  ): FlowStepResult {
    if (frame.index >= config.steps.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Push next step onto stack
    const nextStep = config.steps[frame.index];
    this.stack.push({ node: nextStep, index: 0, completed: false });
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeLoop(
    frame: ExecutionFrame,
    config: LoopConfig,
    context: FlowContext
  ): FlowStepResult {
    const iteration = (frame.data?.iteration as number) ?? 0;
    const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    // Check termination conditions
    if (iteration >= maxIterations) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    if (config.while && !config.while(context)) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Push loop body and increment iteration
    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, iteration: iteration + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeEachPlayer(
    frame: ExecutionFrame,
    config: EachPlayerConfig,
    context: FlowContext
  ): FlowStepResult {
    // Get players to iterate over
    let players = [...this.game.players];

    if (config.filter) {
      players = players.filter((p) => config.filter!(p, context));
    }

    if (config.direction === 'backward') {
      players.reverse();
    }

    // Determine starting index
    if (frame.data?.playerIndex === undefined) {
      let startIndex = 0;
      if (config.startingPlayer) {
        const startPlayer = config.startingPlayer(context);
        startIndex = players.findIndex((p) => p === startPlayer);
        if (startIndex === -1) startIndex = 0;
      }
      frame.data = { ...frame.data, playerIndex: startIndex, players };
    }

    const playerIndex = frame.data.playerIndex as number;
    const playerList = (frame.data.players as Player[]) ?? players;

    if (playerIndex >= playerList.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Set current player and execute body
    this.currentPlayer = playerList[playerIndex];
    this.variables[config.name ?? 'currentPlayer'] = this.currentPlayer;

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, playerIndex: playerIndex + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  private executeForEach(
    frame: ExecutionFrame,
    config: ForEachConfig,
    context: FlowContext
  ): FlowStepResult {
    // Get items to iterate
    const items = typeof config.collection === 'function'
      ? config.collection(context)
      : config.collection;

    const itemIndex = (frame.data?.itemIndex as number) ?? 0;

    if (itemIndex >= items.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Set current item variable
    this.variables[config.as] = items[itemIndex];

    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
    frame.index++;

    return { continue: true, awaitingInput: false };
  }

  // ============================================================================
  // SECTION: Action Step Executors
  // Purpose: Action step and simultaneous action step execution
  // ============================================================================

  /**
   * Execute an action step - the primary player interaction point.
   *
   * Handles complex move counting logic:
   * - minMoves: Minimum actions required before step can complete
   * - maxMoves: Maximum actions allowed (auto-completes when reached)
   * - repeatUntil: Condition-based completion (only checked after minMoves met)
   *
   * Move counting only increments when a full action chain completes (no followUp),
   * preventing followUp chains from counting against move limits.
   *
   * Filters available actions to those actually valid for the current player,
   * warning once about unknown action names to help catch typos.
   */
  private executeActionStep(
    frame: ExecutionFrame,
    config: ActionStepConfig,
    context: FlowContext
  ): FlowStepResult {
    // Check skip condition
    if (config.skipIf?.(context)) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Initialize move count on first entry
    if (frame.data?.moveCount === undefined) {
      frame.data = { ...frame.data, moveCount: 0 };
    }
    const moveCount = frame.data.moveCount as number;

    // Check if maxMoves reached
    if (config.maxMoves && moveCount >= config.maxMoves) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Check repeat-until (if we have a last action result and minMoves is met)
    const minMovesMet = !config.minMoves || moveCount >= config.minMoves;
    if (this.lastActionResult && config.repeatUntil?.(context) && minMovesMet) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      this.lastActionResult = undefined;
      return { continue: true, awaitingInput: false };
    }

    // Determine player
    const player = config.player ? config.player(context) : context.player;
    if (!player) {
      throw new Error('ActionStep requires a player');
    }

    // Get available actions
    const actions = typeof config.actions === 'function'
      ? config.actions(context)
      : config.actions;

    // Filter to only available actions, warning about non-existent ones
    const allAvailable = this.game.getAvailableActions(player as any);
    const available = actions.filter((actionName) => {
      const action = this.game.getAction(actionName);
      if (!action) {
        // Warn once per action name to avoid console spam
        if (!this.warnedUnknownActions.has(actionName)) {
          this.warnedUnknownActions.add(actionName);
          console.warn(
            `[BoardSmith] Flow step '${config.name ?? 'action-step'}' references unknown action '${actionName}'. ` +
            `Did you forget to register it with game.defineAction('${actionName}', ...)?`
          );
        }
        return false;
      }
      return allAvailable.some((a) => a.name === actionName);
    });

    // If no available actions and minMoves met, complete
    if (available.length === 0 && minMovesMet) {
      this.currentActionConfig = undefined;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // If no available actions but minMoves not met, this is an error state
    if (available.length === 0 && !minMovesMet) {
      throw new Error(`ActionStep requires ${config.minMoves} moves but only ${moveCount} were possible`);
    }

    // Store config for getState() move count tracking
    this.currentActionConfig = config;
    this.moveCount = moveCount;

    // Prompt for input
    this.currentPlayer = player;
    this.availableActions = available;

    // Don't mark completed yet - we'll continue after input
    return {
      continue: false,
      awaitingInput: true,
      availableActions: available,
      currentPlayer: player,
    };
  }

  private executeSimultaneousActionStep(
    frame: ExecutionFrame,
    config: SimultaneousActionStepConfig,
    context: FlowContext
  ): FlowStepResult {
    // Get players who should participate
    const players = config.players
      ? config.players(context)
      : [...this.game.players];

    // Build awaiting state for each player
    this.awaitingPlayers = [];

    for (const player of players) {
      // Check if player should be skipped
      if (config.skipPlayer?.(context, player)) {
        continue;
      }

      // Check if player is already done
      if (config.playerDone?.(context, player)) {
        continue;
      }

      // Get available actions for this player
      const actions = typeof config.actions === 'function'
        ? config.actions(context, player)
        : config.actions;

      const available = actions.filter((actionName) => {
        const action = this.game.getAction(actionName);
        if (!action) {
          // Warn once per action name to avoid console spam
          if (!this.warnedUnknownActions.has(actionName)) {
            this.warnedUnknownActions.add(actionName);
            console.warn(
              `[BoardSmith] Flow step '${config.name ?? 'simultaneous-action-step'}' references unknown action '${actionName}'. ` +
              `Did you forget to register it with game.defineAction('${actionName}', ...)?`
            );
          }
          return false;
        }
        return this.game.getAvailableActions(player as any).some((a) => a.name === actionName);
      });

      // Only add player if they have available actions
      if (available.length > 0) {
        this.awaitingPlayers.push({
          playerIndex: player.position,
          availableActions: available,
          completed: false,
        });
      }
    }

    // If no players need to act, complete immediately
    if (this.awaitingPlayers.length === 0) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Check if allDone already returns true
    if (config.allDone?.(context)) {
      this.awaitingPlayers = [];
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Don't mark completed - waiting for all players
    return {
      continue: false,
      awaitingInput: true,
    };
  }

  // ============================================================================
  // SECTION: Conditional Executors
  // Purpose: Switch, if, execute, phase execution
  // ============================================================================

  private executeSwitch(
    frame: ExecutionFrame,
    config: SwitchConfig,
    context: FlowContext
  ): FlowStepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const value = config.on(context);
    const stringValue = String(value);

    const branch = config.cases[stringValue] ?? config.default;
    if (!branch) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    this.stack.push({ node: branch, index: 0, completed: false });
    frame.data = { branchPushed: true };

    return { continue: true, awaitingInput: false };
  }

  private executeIf(
    frame: ExecutionFrame,
    config: IfConfig,
    context: FlowContext
  ): FlowStepResult {
    // If we've already pushed a branch, we're done (child has completed)
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    const condition = config.condition(context);

    if (condition) {
      this.stack.push({ node: config.then, index: 0, completed: false });
      frame.data = { branchPushed: true };
    } else if (config.else) {
      this.stack.push({ node: config.else, index: 0, completed: false });
      frame.data = { branchPushed: true };
    } else {
      // No branch to execute, complete immediately
      frame.completed = true;
    }

    return { continue: true, awaitingInput: false };
  }

  private executeExecute(
    frame: ExecutionFrame,
    config: ExecuteConfig,
    context: FlowContext
  ): FlowStepResult {
    // Run the side effect function
    config.fn(context);
    // Update variables in engine from context
    this.variables = { ...context.variables };
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }

  private executePhase(
    frame: ExecutionFrame,
    config: PhaseConfig,
    context: FlowContext
  ): FlowStepResult {
    // If we haven't entered this phase yet
    if (!frame.data?.entered) {
      // Set current phase
      const previousPhase = this.currentPhase;
      this.currentPhase = config.name;

      // Call onEnterPhase hook
      if (this.definition.onEnterPhase) {
        this.definition.onEnterPhase(config.name, context);
      }

      // Push the phase body and mark as entered
      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { entered: true, previousPhase };

      return { continue: true, awaitingInput: false };
    }

    // Phase body has completed - call onExitPhase hook
    if (this.definition.onExitPhase) {
      this.definition.onExitPhase(config.name, context);
    }

    // Restore previous phase (for nested phases)
    this.currentPhase = frame.data.previousPhase as string | undefined;
    frame.completed = true;

    return { continue: true, awaitingInput: false };
  }
}
