import {
  serializeAction,
  deserializeAction,
  createSnapshot,
  createActionCheckpoint,
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
  type ActionCheckpoint,
  type PlayerStateView,
} from '../engine/index.js';
import { ErrorCode } from '../types/protocol.js';

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
  /**
   * Structured error code when a failure originates inside the runner.
   * Set at the point the error is detected so callers never have to re-infer
   * it from the message prose.
   */
  errorCode?: ErrorCode;
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

  /**
   * Per-action authoritative undo checkpoints. `actionCheckpoints[k]` is the
   * latest LEAN checkpoint (`ActionCheckpoint`: element tree, flow position,
   * sequence, RNG only) observed while `k` actions were recorded. Carried across
   * the stateless snapshot boundary (loaded in `fromSnapshot`, emitted by
   * `getSnapshot`) and restored via `fromCheckpoint`, which rehydrates the
   * snapshot-wide invariants + action-history prefix from the enclosing snapshot.
   * See `GameStateSnapshot.actionCheckpoints`.
   */
  private actionCheckpoints: ActionCheckpoint[] = [];

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
    const flowState = this.game.startFlow();
    // Seed actionCheckpoints[0] with the initial in-flow state so undoing the
    // first turn has a turn-start checkpoint to restore.
    this.captureCheckpoint();
    return flowState;
  }

  /**
   * Refresh the per-action undo checkpoint for the current action count.
   *
   * `actionCheckpoints[k]` holds the latest authoritative state observed while
   * `k` actions are recorded. We keep `[0..len-1]` frozen and overwrite `[len]`
   * with the current state, dropping any entries beyond `len`. Calling this after
   * every state change (each recorded action AND each trailing pending/selection
   * mutation) makes `[len]` capture the complete turn-boundary state — which undo
   * restores authoritatively. The stateless path calls it via `getSnapshot`; the
   * stateful `GameSession` calls it from its broadcast funnel.
   */
  captureCheckpoint(): void {
    const len = this.actionHistory.length;
    this.actionCheckpoints = this.actionCheckpoints.slice(0, len);
    this.actionCheckpoints[len] = createActionCheckpoint(this.game);
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
        errorCode: ErrorCode.INVALID_PLAYER,
      };
    }

    const playerIndex = playerObj.seat;

    // Check if game is awaiting input
    if (!this.game.isAwaitingInput()) {
      return {
        success: false,
        error: 'Game is not awaiting input',
        errorCode: ErrorCode.NOT_AWAITING_INPUT,
      };
    }

    // Check if this player can act (supports both single-player and simultaneous actions)
    if (!this.game.canPlayerAct(playerIndex)) {
      return {
        success: false,
        error: `Not ${playerObj.name}'s turn`,
        errorCode: ErrorCode.NOT_YOUR_TURN,
      };
    }

    // Serialize the action before executing (captures current element refs)
    const serializedAction = this.serializeForHistory(actionName, playerObj, args);

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
   * Resolve + serialize an action's args into a history entry.
   *
   * Raw element IDs are first resolved to GameElement objects so they serialize
   * with branch paths (or stable IDs) that survive game restoration, instead of
   * being passed through as raw numbers. This is the single place the
   * `actionHistory` entry shape is produced, shared by:
   *   - `performAction` (single-step actions), and
   *   - the pending-action completion funnel (multi-step / repeating-selection
   *     actions, via `PendingActionManager`).
   * Keeping both paths on this one helper guarantees every `actionHistory` entry
   * is identical in shape regardless of how the action was driven, so replay,
   * undo, and AI history treat them the same.
   *
   * Does NOT push to history — callers decide when to record (e.g. only after a
   * successful execute). Use `recordSerializedAction` to append.
   */
  serializeForHistory(
    actionName: string,
    player: Player,
    args: Record<string, unknown>
  ): SerializedAction {
    const actionDef = (this.game as any)._actions?.get(actionName);
    const isUndoable = actionDef?.undoable;

    let argsToSerialize = args;
    if (actionDef) {
      const executor = new ActionExecutor(this.game);
      argsToSerialize = executor.resolveArgs(actionDef, args, player);
    }

    return serializeAction(
      actionName,
      player,
      argsToSerialize,
      this.game,
      this.serializeOptions,
      isUndoable
    );
  }

  /**
   * Append an already-serialized action to history.
   *
   * Used by the multi-step pending-action completion path, which serializes the
   * collected args BEFORE executing (so recorded element refs are replay-safe)
   * but must defer the actual history append until execution succeeds. Single
   * source of truth: `performAction` and this method are the only writers of
   * `actionHistory` entries during normal play.
   */
  recordSerializedAction(serializedAction: SerializedAction): void {
    this.actionHistory.push(serializedAction);
  }

  /**
   * Get the current flow state
   */
  getFlowState(): FlowState | undefined {
    return this.game.getFlowState() ?? undefined;
  }

  /**
   * Get a complete snapshot of the game state, including the per-action undo
   * checkpoints.
   *
   * `actionCheckpoints[k]` holds the latest authoritative state observed while
   * `k` actions were recorded. We keep `[0..len-1]` frozen and refresh `[len]`
   * to the current state on every call: that captures any trailing
   * pending/selection mutations (e.g. `Piece.putInto`, recorded in neither
   * command nor action history) that ran AFTER the k-th action but before the
   * (k+1)-th, so undoing a later turn restores the true turn-start state.
   * Entries beyond `len` are dropped (e.g. after an undo rewinds the history).
   */
  getSnapshot(): GameStateSnapshot {
    this.captureCheckpoint();
    const base = createSnapshot(this.game, this.gameType, this.actionHistory, this.seed);
    return { ...base, actionCheckpoints: [...this.actionCheckpoints] };
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
   * Restore a game from a snapshot — fully STATE-AUTHORITATIVE, NO replay.
   *
   * The snapshot already carries the complete authoritative state: the element
   * tree (`snapshot.state` = `game.toJSON()`), the flow engine state
   * (`snapshot.flowState`), the element sequence counter (`snapshot.sequence`),
   * and — since RNG-state capture was added — the seeded RNG position
   * (`snapshot.randomState`). We reconstruct the game directly from those rather
   * than replaying command/action history.
   *
   * This deliberately does NOT call `replayCommands`, `start()`, or re-run the
   * actionHistory through `continueFlow`. The previous replay-based restore was
   * only ever a way to re-derive the tree, flow position, and RNG advance — all
   * three of which are now restored authoritatively below. Crucially, replay was
   * also unsound: selection-step / pending-completed actions are recorded in
   * NEITHER command nor action history, so replaying an incomplete actionHistory
   * mis-positioned the flow and crashed real games (e.g. MERC's AI dictator
   * Day-1 turn: "Player N is not awaiting action"). Restoring state directly
   * sidesteps that entire class of bug.
   *
   * `actionHistory` is still preserved on the runner because the undo op reads
   * `runner.actionHistory` — it is just no longer replayed here.
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

    // Constructs an initial game tree; everything below overwrites it with the
    // authoritative snapshot state.
    const runner = new GameRunner({
      GameClass,
      gameType: snapshot.gameType,
      gameOptions: gameOptions as GameOptions,
    });

    // Preserve action history for the undo op (which reads runner.actionHistory).
    // It is intentionally NOT replayed.
    runner.actionHistory.push(...snapshot.actionHistory);

    // Carry the per-action undo checkpoints forward so the next getSnapshot keeps
    // [0..len-1] intact while refreshing [len]. Older snapshots without the field
    // start fresh (their checkpoint at the current action count is rebuilt below).
    runner.actionCheckpoints = snapshot.actionCheckpoints ? [...snapshot.actionCheckpoints] : [];

    // Adopt the authoritative element tree. loadSerializedState fully clears and
    // rebuilds the tree from snapshot.state on its own (see Game.loadSerializedState
    // / Game.restoreGame), so it stands alone with no prior replay.
    runner.game.loadSerializedState(snapshot.state);

    // Restore the element sequence counter to its authoritative snapshot value.
    // The fromJSON tree rebuild in loadSerializedState advances _ctx.sequence, so
    // without this reset the next element created after restore would get an id
    // that drifts from what dev assigns (a parity bug) and can trip the
    // deletion-detector console.warn. Mirrors restoreDevState.
    if (snapshot.sequence !== undefined) {
      runner.game._ctx.sequence = snapshot.sequence;
    }

    // Restore the seeded RNG position directly so the next game.random() draw
    // matches the live game exactly. This is what lets us drop the replay: the
    // replay's only surviving contribution was re-advancing the RNG, and it could
    // not account for draws made inside pending/selection executes. Restoring the
    // generator state covers all of those. Skip for older snapshots that predate
    // RNG-state capture.
    if (snapshot.randomState !== undefined) {
      runner.game.setRandomState(snapshot.randomState);
    }

    // Restore the authoritative flow state (re-resolves players against the tree
    // just loaded). restoreFlowState builds a fresh FlowEngine from the saved
    // position, so it does not require a prior start().
    //
    // Element-valued flow variables (e.g. eachPlayer's currentPlayer, an
    // executeForEach `as` binding) were serialized to element markers by
    // getPosition; restoreFlowState relinks them to the loaded tree internally.
    if (snapshot.flowState) {
      runner.game.restoreFlowState(snapshot.flowState);
    }

    return runner;
  }

  /**
   * Restore a runner at a historical action index from an enclosing snapshot's
   * per-action checkpoints — the SINGLE sanctioned way to restore a checkpoint.
   *
   * `actionCheckpoints[k]` is a LEAN `ActionCheckpoint` (element tree, flow
   * position, sequence, RNG only). Restoring it requires the snapshot-wide
   * invariants (`gameType`, `seed`, `gameOptions`, `version`) and the
   * action-history PREFIX — none of which are duplicated per entry. This method
   * rehydrates them from the enclosing `snapshot` and hands a full, restorable
   * `GameStateSnapshot` to `fromSnapshot`. Keeping that rehydration here (instead
   * of at each call site) is what makes the lean checkpoints safe: a lean entry
   * can never be passed to `fromSnapshot` directly.
   *
   * The restored runner carries the checkpoint prefix `[0..actionIndex]` forward
   * so subsequent undos/rewinds from it still resolve authoritatively, and its
   * `actionHistory` is the matching prefix `[0..actionIndex)`.
   *
   * Returns `null` when no checkpoint exists at `actionIndex` (the caller decides
   * how to surface that).
   */
  static fromCheckpoint<G extends Game>(
    snapshot: GameStateSnapshot,
    actionIndex: number,
    GameClass: new (options: GameOptions) => G
  ): GameRunner<G> | null {
    const checkpoints = snapshot.actionCheckpoints;
    const checkpoint = checkpoints?.[actionIndex];
    if (!checkpoint) return null;

    return GameRunner.fromSnapshot<G>(
      {
        version: snapshot.version,
        gameType: snapshot.gameType,
        state: checkpoint.state,
        flowState: checkpoint.flowState,
        actionHistory: snapshot.actionHistory.slice(0, actionIndex),
        seed: snapshot.seed,
        sequence: checkpoint.sequence,
        randomState: checkpoint.randomState,
        gameOptions: snapshot.gameOptions,
        actionCheckpoints: checkpoints!.slice(0, actionIndex + 1),
      },
      GameClass,
    );
  }
}
