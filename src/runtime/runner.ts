import {
  serializeAction,
  deserializeAction,
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  ActionExecutor,
  GameElement,
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
 * Re-link a flow-variable value to the authoritative game tree.
 *
 * Flow variables (e.g. an `executeForEach` `as` binding) can hold live
 * GameElement/Player values, and `FlowPosition` serializes `variables`/`frameData`
 * verbatim. Over the snapshot JSON boundary an element value becomes a detached
 * `ElementJSON` (`{ className, id, attributes, ... }`); in-process it stays a
 * reference into the PRE-restore tree. Either way it no longer points at the tree
 * just loaded by `loadSerializedState`. This re-resolves such values by id against
 * the loaded `game`:
 *   - a live `GameElement` -> the same-id element in `game`
 *   - a serialized element (numeric `id` + matching `className`) -> the live element
 * Non-element values are walked structurally and returned unchanged. An id that no
 * longer resolves is left as-is rather than nulled, so a stale reference surfaces
 * loudly instead of silently becoming null.
 */
function relinkFlowValue(value: unknown, game: Game): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // Live element (in-process restore): re-resolve by id into the loaded tree.
  if (value instanceof GameElement) {
    return game.getElementById(value.id) ?? value;
  }

  // Serialized element (JSON boundary): a toJSON() payload carries numeric `id`
  // and string `className`. Only treat it as an element if an element with that
  // id AND class actually exists in the loaded tree.
  const obj = value as Record<string, unknown>;
  if (typeof obj.id === 'number' && typeof obj.className === 'string') {
    const live = game.getElementById(obj.id);
    if (live && live.constructor.name === obj.className) {
      return live;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => relinkFlowValue(item, game));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(obj)) {
    result[key] = relinkFlowValue(entry, game);
  }
  return result;
}

/**
 * Return a copy of `flowState` whose `position.variables`/`position.frameData`
 * element values are re-linked to the loaded `game` tree (see `relinkFlowValue`).
 *
 * Exported so the MCTS bot's authoritative root restore shares the exact same
 * flow-relinking as `GameRunner.fromSnapshot` (single source of truth).
 */
export function relinkFlowState(flowState: FlowState, game: Game): FlowState {
  const position = flowState.position;
  return {
    ...flowState,
    position: {
      ...position,
      variables: relinkFlowValue(position.variables, game) as Record<string, unknown>,
      frameData: position.frameData
        ? (relinkFlowValue(position.frameData, game) as Record<string, Record<string, unknown>>)
        : undefined,
    },
  };
}

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

  /**
   * Per-action authoritative undo checkpoints. `actionCheckpoints[k]` is the
   * latest full snapshot observed while `k` actions were recorded. Carried
   * across the stateless snapshot boundary (loaded in `fromSnapshot`, emitted
   * by `getSnapshot`) and read by the undo op. See `GameStateSnapshot`.
   */
  private actionCheckpoints: GameStateSnapshot[] = [];

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
    const base = createSnapshot(this.game, this.gameType, this.actionHistory, this.seed);
    const len = this.actionHistory.length;
    this.actionCheckpoints = this.actionCheckpoints.slice(0, len);
    this.actionCheckpoints[len] = base;
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
    const base = this.actionCheckpoints[this.actionHistory.length];
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
    // Flow variables/frameData are first re-linked to the loaded tree: an
    // element-valued flow variable (e.g. an executeForEach `as` binding read after
    // a mid-loop await) serializes to a detached ElementJSON over the snapshot
    // JSON boundary and would otherwise stay detached from the restored tree.
    // relinkFlowState re-resolves those by id so they become live refs again.
    if (snapshot.flowState) {
      runner.game.restoreFlowState(relinkFlowState(snapshot.flowState, runner.game));
    }

    return runner;
  }
}
