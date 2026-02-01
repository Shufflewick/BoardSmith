import {
  serializeAction,
  deserializeAction,
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  ActionExecutor,
  type Game,
  type GameOptions,
  type Player,
  type SerializedAction,
  type ActionResult,
  type FlowState,
  type SerializeOptions,
  type GameStateSnapshot,
  type PlayerStateView,
} from '../engine/index.js';

/**
 * Options for creating a game runner
 */
export interface GameRunnerOptions<G extends Game> {
  /** Game class constructor */
  GameClass: new (options: GameOptions) => G;
  /** Game type identifier */
  gameType: string;
  /** Options passed to game constructor */
  gameOptions: GameOptions;
  /** Serialization options */
  serializeOptions?: SerializeOptions;
}

/**
 * Result of performing an action through the runner
 */
export interface ActionExecutionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** The serialized action (for history) */
  serializedAction?: SerializedAction;
  /** Updated flow state */
  flowState?: FlowState;
  /** Player views after the action */
  playerViews?: PlayerStateView[];
}

/**
 * GameRunner manages game execution with action history tracking
 * and provides serialization utilities for client-server sync
 */
export class GameRunner<G extends Game = Game> {
  /** The game instance */
  readonly game: G;

  /** Game type identifier */
  readonly gameType: string;

  /** History of serialized actions */
  readonly actionHistory: SerializedAction[] = [];

  /** Random seed (for deterministic replay) */
  readonly seed?: string;

  /** Serialization options */
  private readonly serializeOptions: SerializeOptions;

  constructor(options: GameRunnerOptions<G>) {
    this.gameType = options.gameType;
    this.seed = options.gameOptions.seed;
    this.serializeOptions = options.serializeOptions ?? { useBranchPaths: true };

    this.game = new options.GameClass(options.gameOptions);
  }

  /**
   * Start the game flow
   */
  start(): FlowState {
    return this.game.startFlow();
  }

  /**
   * Perform an action and record it in history
   */
  performAction(
    actionName: string,
    player: Player | number,
    args: Record<string, unknown>
  ): ActionExecutionResult {
    const playerObj = typeof player === 'number'
      ? this.game.getPlayer(player)
      : player;

    if (!playerObj) {
      return {
        success: false,
        error: `Player not found`,
      };
    }

    const playerIndex = playerObj.seat;

    // Check if game is awaiting input
    if (!this.game.isAwaitingInput()) {
      return {
        success: false,
        error: 'Game is not awaiting input',
      };
    }

    // Check if this player can act (supports both single-player and simultaneous actions)
    if (!this.game.canPlayerAct(playerIndex)) {
      return {
        success: false,
        error: `Not ${playerObj.name}'s turn`,
      };
    }

    // Get the action's undoable flag from its definition
    const actionDef = (this.game as any)._actions?.get(actionName);
    const isUndoable = actionDef?.undoable;

    // Resolve raw element IDs to actual GameElement objects before serializing.
    // This ensures element references are properly serialized (with branch paths or IDs)
    // instead of being passed through as raw numbers which won't survive game restoration.
    let argsToSerialize = args;
    if (actionDef) {
      const executor = new ActionExecutor(this.game);
      argsToSerialize = executor.resolveArgs(actionDef, args, playerObj);
    }

    // Serialize the action before executing (captures current element refs)
    const serializedAction = serializeAction(
      actionName,
      playerObj,
      argsToSerialize,
      this.game,
      this.serializeOptions,
      isUndoable
    );

    // Execute through flow (pass player index for simultaneous actions)
    let flowState: FlowState;
    try {
      flowState = this.game.continueFlow(actionName, args, playerIndex);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Check if the action failed (flow state contains error)
    if (flowState.actionError) {
      return {
        success: false,
        error: flowState.actionError,
        flowState,
      };
    }

    // Record in history
    this.actionHistory.push(serializedAction);

    return {
      success: true,
      serializedAction,
      flowState,
      playerViews: createAllPlayerViews(this.game),
    };
  }

  /**
   * Get the current flow state
   */
  getFlowState(): FlowState | undefined {
    return this.game.getFlowState() ?? undefined;
  }

  /**
   * Get a complete snapshot of the game state
   */
  getSnapshot(): GameStateSnapshot {
    return createSnapshot(
      this.game,
      this.gameType,
      this.actionHistory,
      this.seed
    );
  }

  /**
   * Get the game state from a player's perspective
   */
  getPlayerView(playerPosition: number): PlayerStateView {
    return createPlayerView(this.game, playerPosition);
  }

  /**
   * Get views for all players
   */
  getAllPlayerViews(): PlayerStateView[] {
    return createAllPlayerViews(this.game);
  }

  /**
   * Check if the game is complete
   */
  isComplete(): boolean {
    return this.game.getFlowState()?.complete ?? false;
  }

  /**
   * Get winners (if game is complete)
   */
  getWinners(): Player[] {
    return this.game.getWinners();
  }

  /**
   * Replay a game from a list of serialized actions
   */
  static replay<G extends Game>(
    options: GameRunnerOptions<G>,
    actions: SerializedAction[]
  ): GameRunner<G> {
    const runner = new GameRunner(options);
    runner.start();

    for (const action of actions) {
      const { actionName, player, args } = deserializeAction(action, runner.game);
      const result = runner.performAction(actionName, player, args);

      if (!result.success) {
        throw new Error(`Replay failed at action ${action.name}: ${result.error}`);
      }
    }

    return runner;
  }

  /**
   * Restore a game from a snapshot
   * Note: This creates a new game and replays commands, not a full restore
   */
  static fromSnapshot<G extends Game>(
    snapshot: GameStateSnapshot,
    GameClass: new (options: GameOptions) => G
  ): GameRunner<G> {
    // Use full gameOptions from snapshot if available, falling back to basic options
    // This ensures custom options like playerConfigs are preserved
    const gameOptions = snapshot.gameOptions ?? {
      playerCount: snapshot.state.settings.playerCount as number,
      playerNames: snapshot.state.settings.playerNames as string[],
      seed: snapshot.seed,
    };

    const runner = new GameRunner({
      GameClass,
      gameType: snapshot.gameType,
      gameOptions: gameOptions as GameOptions,
    });

    // Replay commands to restore state
    runner.game.replayCommands(snapshot.commandHistory);

    // Restore action history
    runner.actionHistory.push(...snapshot.actionHistory);

    // Start flow and replay actions to restore flow state
    runner.start();
    for (const action of snapshot.actionHistory) {
      const { actionName, player, args } = deserializeAction(action, runner.game);
      // Pass player seat for simultaneous actions
      runner.game.continueFlow(actionName, args, player.seat);
    }

    return runner;
  }
}
