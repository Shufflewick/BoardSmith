import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionResult, EvaluatedAction, SelectionMetadata } from '../action/types.js';
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
 * FlowEngine executes flow definitions and manages game state progression.
 * It handles pausing for player input and resuming from serialized positions.
 */
export class FlowEngine<G extends Game = Game> {
  private game: G;
  private definition: FlowDefinition;
  private stack: ExecutionFrame[] = [];
  private variables: Record<string, unknown> = {};
  private currentPlayer?: Player;
  private awaitingInput = false;
  private availableActions: string[] = [];
  private prompt?: string;
  private complete = false;
  private lastActionResult?: ActionResult;
  /** For simultaneous action steps - tracks which players can act */
  private awaitingPlayers: PlayerAwaitingState[] = [];

  constructor(game: G, definition: FlowDefinition) {
    this.game = game;
    this.definition = definition;
  }

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
      // Action failed, stay in same state
      return this.getState();
    }

    // Clear awaiting state
    this.awaitingInput = false;

    // Mark the current ActionStep frame as completed (unless repeatUntil keeps it going)
    if (currentFrame?.node.type === 'action-step') {
      const config = currentFrame.node.config as ActionStepConfig;
      // Check if we should repeat
      if (!config.repeatUntil || config.repeatUntil(this.createContext())) {
        currentFrame.completed = true;
      }
      // NOTE: Don't clear lastActionResult here - let the flow read it first
      // It will be overwritten by the next action anyway
    }

    return this.run();
  }

  /**
   * Resume a simultaneous action step after a player's action
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

    // Execute the action
    const player = this.game.players[actingPlayerIndex];
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
      playerState.availableActions = actions.filter((actionName) => {
        const action = this.game.getAction(actionName);
        if (!action) return false;
        return this.game.getAvailableActions(player as any).some((a) => a.name === actionName);
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
      prompt: this.prompt,
      awaitingPlayers: this.awaitingPlayers.length > 0 ? this.awaitingPlayers : undefined,
    };

    // Add rich action details if awaiting input
    if (this.awaitingInput && this.currentPlayer) {
      state.actionDetails = this.buildActionDetails(this.currentPlayer, this.availableActions);
    }

    return state;
  }

  /**
   * Build rich action details including availability and selection metadata
   */
  private buildActionDetails(player: Player, requestedActions: string[]): EvaluatedAction[] {
    const details: EvaluatedAction[] = [];
    const executor = this.game.getActionExecutor();

    for (const actionName of requestedActions) {
      const action = this.game.getAction(actionName);
      if (!action) continue;

      const isValid = executor.isActionAvailable(action, player);
      const invalidReason = isValid ? undefined : executor.getActionUnavailableReason(action, player);

      // Build selection metadata
      const selections: SelectionMetadata[] = action.selections.map((sel) => {
        const metadata: SelectionMetadata = {
          name: sel.name,
          type: sel.type,
          prompt: sel.prompt,
          optional: sel.optional,
          skipIfOnlyOne: sel.skipIfOnlyOne,
        };

        // Add choice count for choice/player/element types
        if (sel.type === 'choice' || sel.type === 'player' || sel.type === 'element') {
          const choices = executor.getChoices(sel, player, {});
          metadata.choiceCount = choices.length;
        }

        return metadata;
      });

      details.push({
        name: actionName,
        isValid,
        invalidReason,
        prompt: action.prompt,
        selections,
      });
    }

    return details;
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

    // Set player from position
    if (position.playerIndex !== undefined) {
      this.currentPlayer = this.game.players[position.playerIndex];
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

  // ============================================
  // Private Methods
  // ============================================

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
   * Main execution loop - runs until awaiting input or complete
   */
  private run(): FlowState {
    let iterations = 0;

    while (this.stack.length > 0 && !this.awaitingInput && !this.complete) {
      iterations++;
      if (iterations > DEFAULT_MAX_ITERATIONS) {
        throw new Error('Flow exceeded maximum iterations - possible infinite loop');
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
      default:
        frame.completed = true;
        return { continue: true, awaitingInput: false };
    }
  }

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

  private executeActionStep(
    frame: ExecutionFrame,
    config: ActionStepConfig,
    context: FlowContext
  ): FlowStepResult {
    // Check skip condition
    if (config.skipIf?.(context)) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Check repeat-until (if we have a last action result)
    if (this.lastActionResult && config.repeatUntil?.(context)) {
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

    // Filter to only available actions
    const available = actions.filter((actionName) => {
      const action = this.game.getAction(actionName);
      if (!action) return false;
      return this.game.getAvailableActions(player as any).some((a) => a.name === actionName);
    });

    if (available.length === 0) {
      // No available actions, complete this step
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }

    // Prompt for input
    this.currentPlayer = player;
    this.availableActions = available;
    this.prompt = typeof config.prompt === 'function' ? config.prompt(context) : config.prompt;

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
        if (!action) return false;
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

    // Set prompt
    this.prompt = typeof config.prompt === 'function' ? config.prompt(context) : config.prompt;

    // Don't mark completed - waiting for all players
    return {
      continue: false,
      awaitingInput: true,
    };
  }

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
}
