import {
  serializeAction,
  deserializeAction,
  createSnapshot,
  createActionCheckpoint,
  checkpointAt,
  checkpointCount,
  createPlayerView,
  createAllPlayerViews,
  ActionExecutor,
  FlowHaltedError,
  type Game,
  type GameOptions,
  type Player,
  type SerializedAction,
  type ActionResult,
  type FlowState,
  type FlowDebugInfo,
  type SerializeOptions,
  type GameStateSnapshot,
  type ActionCheckpoint,
  type ActionCheckpointWindow,
  type PlayerStateView,
  type PendingActionState,
  type ActionDefinition,
  type CheckpointPolicy,
} from '../engine/index.js';
import { ErrorCode } from '../types/protocol.js';

/**
 * Re-exported so `boardsmith/runtime` keeps naming the policy type alongside
 * `GameRunnerOptions`. Its single definition lives in the engine
 * (`engine/utils/snapshot.ts`) so a published bundle can name it from the two
 * modules it is allowed to import — `boardsmith` and `boardsmith/session`.
 */
export type { CheckpointPolicy };

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
  /** Per-action undo checkpoint retention. Default: retain everything. */
  checkpoints?: CheckpointPolicy;
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
   * The RETAINED WINDOW of per-action authoritative undo checkpoints: the
   * latest LEAN checkpoint (`ActionCheckpoint`: element tree, flow position,
   * sequence, RNG only) observed at each action count from
   * `checkpointBaseIndex` up to the current action count. Carried across the
   * stateless snapshot boundary (loaded in `fromSnapshot`, emitted by
   * `getSnapshot`) and restored via `fromCheckpoint`, which rehydrates the
   * snapshot-wide invariants + action-history prefix from the enclosing
   * snapshot. See `GameStateSnapshot.actionCheckpoints`.
   */
  private actionCheckpoints: ActionCheckpoint[] = [];

  /**
   * The action count `actionCheckpoints[0]` was captured at. Non-zero once a
   * `checkpoints.max` policy has dropped older entries — the whole point of
   * tracking it is that a lookup below it is provably PRUNED, not missing, so
   * the refusal can name the policy instead of guessing at a bug.
   */
  private checkpointBaseIndex = 0;

  /** This game's checkpoint retention policy. Default: retain everything. */
  private readonly checkpointPolicy_: Required<CheckpointPolicy>;

  /**
   * The durable commitment fence (UNDO-02, 155-02): the action-history length
   * at the moment the MOST RECENT `execute({ irreversible: true })` flow node
   * completed. An ordinary bookkeeping `execute()` never moves it -- its
   * effects are game state, and a checkpoint restore reproduces them exactly,
   * so undo may cross it freely (see `ExecuteConfig.irreversible`).
   * Read by the session layer's shared `assertUndoAllowed` guard
   * (`session/utils.ts`) to refuse an undo/rewind that would cross it.
   * Public (like `actionHistory`) rather than accessed via a getter -- there
   * is nothing to compute on read; the invariant lives entirely in how this
   * field is WRITTEN (see `#recordExecuteBarrierAdvance`, `getSnapshot`,
   * `fromSnapshot`, `fromCheckpoint`).
   *
   * Mirrors `actionCheckpoints`'s plumbing exactly: seeded on construction,
   * refreshed after every history append, carried through `getSnapshot` /
   * `fromSnapshot`, and clamped on `fromCheckpoint`.
   */
  executeBarrierIndex = 0;

  /**
   * How many CHECKPOINT RESTORES (undo / rewind / host-driven restore) this
   * timeline has undergone. Advanced in exactly one place —
   * `fromCheckpoint`, the single sanctioned restore site — and adopted from
   * the snapshot by `fromSnapshot`, so it is durable across the stateless
   * boundary exactly like `executeBarrierIndex`.
   *
   * Published to every seat as `PlayerGameState.restoreEpoch`: it is the
   * client's "the runner was replaced, every element id you captured is
   * stale" signal. See `GameStateSnapshot.restoreEpoch`.
   */
  restoreEpoch = 0;

  /**
   * Last-observed value of `game.getIrreversibleCommitCount()` (the live
   * `FlowEngine`'s monotonic commitment counter). Compared on every history
   * append to detect an advance; NOT itself persisted -- a fresh `FlowEngine`
   * (built on every restore) always starts its own counter at 0, so this
   * field is explicitly re-baselined to the freshly-built engine's counter
   * immediately after restore (`fromSnapshot`), rather than assumed to carry
   * over. Re-baselining, not the counter's raw value, is what makes
   * `executeBarrierIndex` durable across a restore.
   */
  private lastSeenIrreversibleCommits = 0;

  /**
   * Compare the live flow engine's irreversible-commitment counter to the last
   * seen value; if it advanced, extend `executeBarrierIndex` to the current
   * action-history length (the barrier is set AT the action count where the
   * commitment completed) and update the last-seen value. Idempotent to
   * call repeatedly with no intervening advance -- a no-op once the counter
   * has already been observed.
   *
   * Called from `captureCheckpoint()` rather than directly from
   * `performAction`/`recordSerializedAction`: an execute() node immediately
   * following an action-step frequently runs INSIDE the completion of the
   * NEXT flow step, which for the multi-step / repeating-selection funnel
   * (`completePendingAction` here, `PendingActionManager` on the session
   * layer) happens via `continueFlowAfterPendingAction` -- called AFTER
   * `recordSerializedAction` already pushed to history. `captureCheckpoint()`
   * is the one chokepoint both executors already call once the WHOLE op
   * (including any such trailing flow advance) has settled -- the stateless
   * path via `getSnapshot()`, the stateful path via `GameSession.broadcast()`
   * (see that method's doc comment) -- so it is also the correct place to
   * observe whether an execute() node ran during this op.
   */
  private recordExecuteBarrierAdvance(): void {
    const completions = this.game.getIrreversibleCommitCount();
    if (completions !== this.lastSeenIrreversibleCommits) {
      this.lastSeenIrreversibleCommits = completions;
      this.executeBarrierIndex = this.actionHistory.length;
    }
  }

  /**
   * Per-player in-progress pending-action state for multi-step / repeating-
   * selection actions driven directly through the runner. This mirrors
   * `PendingActionManager`'s session-layer state machine, but is a session-free
   * path built directly on `ActionExecutor.createPendingActionState` /
   * `processSelectionStep` / `processRepeatingStep` / `executePendingAction` —
   * there is no storage/broadcast callback plumbing here since `GameRunner` has
   * no `GameSession`. Cleared automatically when the action completes.
   */
  private pendingActions: Map<number, PendingActionState> = new Map();

  /**
   * Random seed (for deterministic replay). Captured from the passed
   * `gameOptions.seed` when supplied; otherwise read back from the game's
   * effective (auto-generated) seed after construction, so any run —
   * including one that let the Game auto-generate its own seed — is
   * replayable.
   */
  readonly seed?: string;

  /** Serialization options */
  private readonly serializeOptions: SerializeOptions;

  constructor(options: GameRunnerOptions<G>) {
    this.gameType = options.gameType;
    this.serializeOptions = options.serializeOptions ?? { useBranchPaths: true };
    this.checkpointPolicy_ = {
      max: options.checkpoints?.max ?? Number.POSITIVE_INFINITY,
      enabled: options.checkpoints?.enabled ?? true,
    };
    if (this.checkpointPolicy_.max < 1) {
      throw new Error(
        `checkpoints.max must be at least 1 (got ${this.checkpointPolicy_.max}). ` +
        `Use checkpoints: { enabled: false } to turn checkpointing off entirely.`,
      );
    }

    this.game = new options.GameClass(options.gameOptions);

    // Capture the effective seed: use the passed seed when supplied, or read
    // back the auto-generated seed from the game's constructor options so an
    // un-seeded run is still replayable.
    this.seed =
      options.gameOptions.seed ??
      (this.game.getConstructorOptions().seed as string | undefined);
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
   * Refresh the per-action undo checkpoint for the current action count, and
   * apply the retention policy.
   *
   * The checkpoint at action count `k` holds the latest authoritative state
   * observed while `k` actions are recorded. Retained entries below the head
   * stay frozen; the head entry is overwritten with the current state; entries
   * ahead of it (redo state left by an undo) are dropped. Calling this after
   * every state change — each recorded action AND each trailing
   * pending/selection mutation — makes the head capture the complete
   * turn-boundary state, which undo restores authoritatively. The stateless
   * path calls it via `getSnapshot`; the stateful `GameSession` calls it from
   * its broadcast funnel.
   *
   * Then the window is trimmed to `checkpoints.max` (default: unbounded),
   * oldest first — so what remains is the most recent range, which is the
   * range undo can reach. See `CheckpointPolicy` and `docs/state-size.md`.
   */
  captureCheckpoint(): void {
    // UNDO-02: the chokepoint for detecting an execute()-barrier advance --
    // see recordExecuteBarrierAdvance's doc comment for why this is the
    // correct place (not the individual history-append call sites). Recorded
    // FIRST so it still happens for a game that has checkpointing disabled:
    // the barrier fences undo, it is not part of undo's payload.
    this.recordExecuteBarrierAdvance();
    if (!this.checkpointPolicy_.enabled) return;

    const len = this.actionHistory.length;
    const headOffset = len - this.checkpointBaseIndex;
    if (headOffset < 0) {
      // The head is BELOW the retained window -- the history was rewound past
      // everything retained. Nothing in the window describes this timeline any
      // more, so restart it here rather than keeping entries that claim action
      // counts the runner no longer has.
      this.checkpointBaseIndex = len;
      this.actionCheckpoints = [createActionCheckpoint(this.game)];
      return;
    }
    // Drop anything AHEAD of the head (redo state left by an undo), then
    // overwrite the head entry itself with the current state.
    this.actionCheckpoints = this.actionCheckpoints.slice(0, headOffset);
    this.actionCheckpoints[headOffset] = createActionCheckpoint(this.game);

    // Then drop from the FRONT down to the retention limit. Oldest-first is
    // what makes the retained window the most recent actions -- the ones undo
    // can actually reach.
    const excess = this.actionCheckpoints.length - this.checkpointPolicy_.max;
    if (excess > 0) {
      this.actionCheckpoints = this.actionCheckpoints.slice(excess);
      this.checkpointBaseIndex += excess;
    }
  }

  /**
   * This runner's resolved checkpoint retention policy.
   *
   * Exposed so every host path that builds a REPLACEMENT runner (undo, rewind,
   * HMR reload, new-game reset) can carry the same policy forward by reading it
   * off the runner it is replacing, instead of re-threading it from the game
   * definition at each call site. A path that forgets silently reverts that
   * game to unbounded retention from that point on -- the whole failure this
   * policy exists to prevent, reintroduced one call site at a time.
   */
  get checkpointPolicy(): Required<CheckpointPolicy> {
    return this.checkpointPolicy_;
  }

  /** The retained checkpoint window, in the shape a snapshot carries it. */
  private checkpointWindow(): ActionCheckpointWindow {
    return { baseIndex: this.checkpointBaseIndex, entries: [...this.actionCheckpoints] };
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
      // FlowHaltedError means the flow threw AFTER the action committed its
      // state changes. Record the committed action so actionHistory stays
      // consistent with applied game state (WR-02) — dropping it would make
      // replay/undo/snapshot diverge from what actually happened.
      if (error instanceof FlowHaltedError) {
        this.actionHistory.push(serializedAction);
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: ErrorCode.ENGINE_ERROR,
      };
    }

    // Check if the action failed (flow state contains error)
    if (flowState.actionError) {
      return {
        success: false,
        error: flowState.actionError,
        errorCode: ErrorCode.ACTION_EXECUTION_ERROR,
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
   * Get a structured, human- and machine-readable description of the current
   * flow position. Thin passthrough mirroring the `getFlowState()` passthrough
   * above — never throws, never returns `undefined` (see `Game.getFlowDebugInfo()`).
   */
  getFlowDebugInfo(): FlowDebugInfo {
    return this.game.getFlowDebugInfo();
  }

  /**
   * Start tracking a multi-step / repeating-selection action for a player,
   * session-free (no `GameSession`/`PendingActionManager` involved). Uses
   * `ActionExecutor.createPendingActionState` directly — the same primitive
   * `PendingActionManager.startPendingAction` uses on the session layer.
   *
   * Returns `undefined` (does not throw) when the action or player is not
   * found, matching the graceful-degradation convention of
   * `getActionSpace`/`getActionSchema`.
   */
  startPendingAction(actionName: string, playerPosition: number): PendingActionState | undefined {
    const action = this.game.getAction(actionName);
    if (!action) return undefined;
    if (!this.game.getPlayer(playerPosition)) return undefined;

    const executor = this.game.getActionExecutor();
    const pendingState = executor.createPendingActionState(actionName, playerPosition);
    this.pendingActions.set(playerPosition, pendingState);
    return pendingState;
  }

  /**
   * Process one selection step of a player's in-progress pending action
   * (started via `startPendingAction`). Session-free mirror of
   * `PendingActionManager.processSelectionStep` — handles both regular and
   * repeating selections, and auto-completes + executes the action (recording
   * it in `actionHistory` via the same `serializeForHistory`/
   * `recordSerializedAction` funnel `performAction` uses) once every selection
   * has been supplied.
   *
   * Clears the tracked pending state once the action completes, whether it
   * succeeds or fails to execute.
   */
  processSelectionStep(
    playerPosition: number,
    selectionName: string,
    value: unknown
  ): { success: boolean; error?: string; actionComplete?: boolean } {
    const pendingState = this.pendingActions.get(playerPosition);
    if (!pendingState) {
      return { success: false, error: 'No pending action for this player. Call startPendingAction first.' };
    }

    const action = this.game.getAction(pendingState.actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${pendingState.actionName}` };
    }

    const player = this.game.getPlayer(playerPosition);
    if (!player) {
      return { success: false, error: `Player not found: ${playerPosition}` };
    }

    const executor = this.game.getActionExecutor();
    const selection = action.selections[pendingState.currentSelectionIndex];
    if (!selection) {
      return { success: false, error: 'No current selection' };
    }

    if (selection.name !== selectionName) {
      return {
        success: false,
        error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName}`,
      };
    }

    if (executor.isRepeatingSelection(selection)) {
      const result = executor.processRepeatingStep(action, player, pendingState, value);
      if (result.error) {
        return { success: false, error: result.error };
      }
      if (result.done && executor.isPendingActionComplete(action, pendingState)) {
        return this.completePendingAction(executor, action, player, pendingState, playerPosition);
      }
      return { success: true, actionComplete: false };
    }

    const stepResult = executor.processSelectionStep(action, player, pendingState, selectionName, value);
    if (!stepResult.success) {
      return { success: false, error: stepResult.error };
    }

    if (executor.isPendingActionComplete(action, pendingState)) {
      return this.completePendingAction(executor, action, player, pendingState, playerPosition);
    }

    return { success: true, actionComplete: false };
  }

  /**
   * Execute a fully-collected pending action and record it in `actionHistory`,
   * clearing the tracked state for the player. Shared completion path for both
   * regular and repeating selection steps in `processSelectionStep`, mirroring
   * `PendingActionManager.#completePendingAction` minus the storage/broadcast
   * side effects.
   */
  private completePendingAction(
    executor: ActionExecutor,
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    playerPosition: number
  ): { success: boolean; error?: string; actionComplete: true } {
    const serializedAction = this.serializeForHistory(action.name, player, pendingState.collectedArgs);
    const actionResult = executor.executePendingAction(action, player, pendingState);
    this.pendingActions.delete(playerPosition);

    if (actionResult.success) {
      this.recordSerializedAction(serializedAction);
      this.game.continueFlowAfterPendingAction(actionResult);
    }

    return { success: actionResult.success, error: actionResult.error, actionComplete: true };
  }

  /**
   * Get a read-only snapshot of a player's in-progress pending action —
   * current selection index, completed selections, and accumulated
   * repeating-selection state.
   *
   * Never returns the live mutable `PendingActionState` (RESEARCH.md
   * Anti-Pattern): the top-level object, `collectedArgs`, and
   * `repeating.accumulated` are always copied, and `onSelectFired` is a fresh
   * `Set`, so reassigning/pushing into any of those containers on the
   * returned value never affects subsequent calls or game state. This copy is
   * NOT recursive, though — object/array values stored *inside*
   * `collectedArgs` (e.g. a repeating selection accumulating structured
   * picks) are copied by reference, so mutating a nested value in place would
   * still corrupt the live internal state.
   *
   * Returns `undefined` when nothing is pending for the player, including for
   * an out-of-range seat (no throw, matching `getActionSpace`/`getActionSchema`).
   */
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    const state = this.pendingActions.get(playerPosition);
    if (!state) return undefined;

    return {
      ...state,
      collectedArgs: { ...state.collectedArgs },
      repeating: state.repeating
        ? { ...state.repeating, accumulated: [...state.repeating.accumulated] }
        : undefined,
      onSelectFired: state.onSelectFired ? new Set(state.onSelectFired) : undefined,
    };
  }

  /**
   * Get a complete snapshot of the game state, including the per-action undo
   * checkpoints.
   *
   * The checkpoint at action count `k` holds the latest authoritative state
   * observed while `k` actions were recorded. Retained entries stay frozen and
   * the head is refreshed to the current state on every call: that captures any
   * trailing pending/selection mutations (e.g. `Piece.putInto`, recorded in
   * neither command nor action history) that ran AFTER the k-th action but
   * before the (k+1)-th, so undoing a later turn restores the true turn-start
   * state. Entries ahead of the head are dropped (e.g. after an undo rewinds
   * the history), and entries older than `checkpoints.max` are dropped from the
   * front.
   */
  getSnapshot(): GameStateSnapshot {
    this.captureCheckpoint();
    const base = createSnapshot(this.game, this.gameType, this.actionHistory, this.seed);
    return {
      ...base,
      actionCheckpoints: this.checkpointWindow(),
      executeBarrierIndex: this.executeBarrierIndex,
      restoreEpoch: this.restoreEpoch,
    };
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
    GameClass: new (options: GameOptions) => G,
    options?: { animationSeqFloor?: number; checkpoints?: CheckpointPolicy }
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
      // The retention policy is NOT carried in the snapshot -- it is declared on
      // the game definition, so every restore must re-supply it. A restore that
      // forgets it silently reverts that game to unbounded retention on the very
      // next op, which is the defect this policy exists to prevent.
      checkpoints: options?.checkpoints,
    });

    // Preserve action history for the undo op (which reads runner.actionHistory).
    // It is intentionally NOT replayed.
    runner.actionHistory.push(...snapshot.actionHistory);

    // Carry the retained checkpoint window forward so the next getSnapshot keeps
    // the retained entries intact while refreshing the head one.
    //
    // A snapshot with no window -- or one whose `actionCheckpoints` is not a
    // window at all, which is what a snapshot written by an engine predating
    // the window looks like -- starts an EMPTY window at the CURRENT action
    // count, not at 0. Starting at 0 would make the next capture write into
    // slot `actionHistory.length` of an empty array, leaving a hole per
    // preceding action: `null`s that serialize, cost bytes forever, and read
    // back as "a checkpoint that is missing" rather than "a checkpoint that
    // was never in this window". Undo for the turn in progress is unavailable
    // either way (there is no turn-start entry to restore); the window simply
    // rebuilds from here.
    //
    // A DISABLED policy inherits nothing. `checkpoints: { enabled: false }` is
    // the only setting that makes a game's snapshot size independent of its
    // action count, and inheriting a window would break that promise
    // permanently: `captureCheckpoint` returns before it can prune when the
    // policy is off, so entries carried in here are never refreshed, never
    // dropped, and re-serialize on every snapshot forever. A game that turns
    // checkpoints off after running under the default -- the fix for a session
    // already growing toward its host's state ceiling -- would keep paying for
    // the copies it turned off, and the emitted window would keep reporting
    // retention the runner is not doing. Dropping it here is what makes the
    // emitted window honest evidence of the policy actually in force, which is
    // the only evidence there is (the policy itself is never persisted).
    const window = snapshot.actionCheckpoints;
    const usable =
      runner.checkpointPolicy_.enabled &&
      window &&
      Array.isArray(window.entries) &&
      typeof window.baseIndex === 'number';
    runner.checkpointBaseIndex = usable ? window.baseIndex : snapshot.actionHistory.length;
    runner.actionCheckpoints = usable ? [...window.entries] : [];

    // UNDO-02: adopt the durable execute()-barrier from the snapshot. Absent
    // (older snapshot predating this field, or no execute() has run yet):
    // read as 0 -- no barrier recorded, the honest reading, not a compat
    // shim (project no-back-compat rule).
    runner.executeBarrierIndex = snapshot.executeBarrierIndex ?? 0;

    // Adopt the restore epoch as-is. A plain rehydration is NOT a restore --
    // only `fromCheckpoint` advances it (it hands us an already-incremented
    // snapshot), so reloading the same snapshot twice can never look like a
    // restore to a client comparing epochs.
    runner.restoreEpoch = snapshot.restoreEpoch ?? 0;

    // Adopt the authoritative element tree. loadSerializedState fully clears and
    // rebuilds the tree from snapshot.state on its own (see Game.loadSerializedState
    // / Game.restoreGame), so it stands alone with no prior replay.
    //
    // `animationSeqFloor` (UNDO-04): absent for a normal full restore (adopt
    // the persisted animation-event seq, today's behavior); supplied only by
    // `fromCheckpoint` below, so an undo/rewind checkpoint restore can never
    // move the live animation-event id sequence backwards. Do not thread a
    // floor through any other caller of `fromSnapshot` -- see game.ts's
    // `loadSerializedState` doc comment / RESEARCH.md §C.
    // The message log is NOT in `snapshot.state` (it is a snapshot sibling —
    // see `GameStateSnapshot.messageLog`), so it must be handed over explicitly.
    // `loadSerializedState` assigns it unconditionally, so a snapshot without a
    // log restores an empty one rather than leaving whatever this instance held.
    runner.game.loadSerializedState(snapshot.state, {
      ...options,
      messageLog: snapshot.messageLog ?? [],
    });

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

    // UNDO-02: re-baseline the last-seen execute()-completion count to the
    // FRESHLY BUILT FlowEngine's own counter (always 0 for a brand-new
    // engine -- see game.ts `restoreFlowState`). Without this, the next
    // history append would compare the new engine's 0 against whatever
    // value a PRIOR runner instance last observed and could spuriously
    // detect (or miss) an advance. This is what makes `executeBarrierIndex`
    // -- not the live counter -- the durable fact: every restore starts
    // observation fresh from the persisted number adopted above.
    runner.lastSeenIrreversibleCommits = runner.game.getIrreversibleCommitCount();

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
   * Returns `null` when no checkpoint exists at `actionIndex`. Callers that
   * report the failure should ask `describeCheckpointAbsence` why — an entry
   * dropped by the game's retention policy and an entry that was never captured
   * are different problems with different fixes.
   */
  static fromCheckpoint<G extends Game>(
    snapshot: GameStateSnapshot,
    actionIndex: number,
    GameClass: new (options: GameOptions) => G,
    options?: { checkpoints?: CheckpointPolicy }
  ): GameRunner<G> | null {
    const window = snapshot.actionCheckpoints;
    const found = checkpointAt(window, actionIndex);
    if (!found.checkpoint) return null;
    const checkpoint = found.checkpoint;

    // UNDO-04: derive the animation-event floor from the ENCLOSING LIVE
    // snapshot (not the historical checkpoint) so the restored runner's
    // animation-event id sequence can never regress below where the live
    // game already was. This is what makes the fix self-serving from this
    // single call site -- no undo/rewind executor needs to remember to pass
    // it. See game.ts's `loadSerializedState` doc comment / RESEARCH.md §C.
    const animationSeqFloor = (snapshot.state as { animationEventSeq?: number }).animationEventSeq ?? 0;

    // UNDO-02: clamp the barrier to the restore point. A barrier set AHEAD of
    // `actionIndex` (e.g. from an execute() node that ran after the point
    // being restored to) describes a portion of the timeline this restored
    // runner no longer has -- it must not haunt the rewound runner's own
    // future undos. `Math.min` is exactly the right operation because the
    // barrier is a monotonic high-water mark: what happened AT OR BEFORE
    // `actionIndex` is still real and must still be fenced.
    const executeBarrierIndex = Math.min(snapshot.executeBarrierIndex ?? 0, actionIndex);

    // The log lives once on the enclosing snapshot; this checkpoint carries only
    // the length it had at this action-count boundary. Slicing to that watermark
    // is what makes undo still drop the lines the undone action wrote — the
    // behaviour that used to fall out for free when every checkpoint carried its
    // own copy of the log (CR-02's "undoToTurnStart rolls back game.message()").
    // Same shape as the `animationSeqFloor` and `executeBarrierIndex` clamps
    // above: derived here, at the single sanctioned checkpoint-restore site, so
    // no undo/rewind caller has to remember it.
    //
    // A checkpoint predating the watermark has no recorded boundary, so the
    // honest restore is the whole log rather than a guess.
    const fullLog = snapshot.messageLog ?? [];
    const messageLog = checkpoint.messageCount === undefined
      ? fullLog
      : fullLog.slice(0, checkpoint.messageCount);

    return GameRunner.fromSnapshot<G>(
      {
        version: snapshot.version,
        gameType: snapshot.gameType,
        state: checkpoint.state,
        messageLog,
        flowState: checkpoint.flowState,
        actionHistory: snapshot.actionHistory.slice(0, actionIndex),
        seed: snapshot.seed,
        sequence: checkpoint.sequence,
        randomState: checkpoint.randomState,
        gameOptions: snapshot.gameOptions,
        // The retained window, truncated at the restore point: entries AHEAD of
        // `actionIndex` describe a timeline this runner no longer has. The base
        // is unchanged -- everything already pruned stays pruned.
        actionCheckpoints: {
          baseIndex: window!.baseIndex,
          entries: window!.entries.slice(0, actionIndex - window!.baseIndex + 1),
        },
        executeBarrierIndex,
        // The restore itself, recorded durably. This is the ONE site that
        // advances the epoch -- same reasoning as `animationSeqFloor` and the
        // `executeBarrierIndex` clamp above: derived at the single sanctioned
        // checkpoint-restore site, so no undo/rewind caller has to remember it,
        // and no host can ship a restore that forgets to tell its clients.
        restoreEpoch: (snapshot.restoreEpoch ?? 0) + 1,
      },
      GameClass,
      { animationSeqFloor, checkpoints: options?.checkpoints },
    );
  }
}

/**
 * Why a checkpoint restore at `actionIndex` failed, as an actionable sentence.
 *
 * `GameRunner.fromCheckpoint` returns `null` for two very different reasons,
 * and reporting them identically is what made the original problem so hard to
 * diagnose. `pruned` is a policy the game author chose and can change;
 * `uncaptured` means the snapshot was not produced by `getSnapshot` at all, or
 * this game has checkpointing disabled.
 */
export function describeCheckpointAbsence(
  snapshot: GameStateSnapshot,
  actionIndex: number,
): string {
  const window = snapshot.actionCheckpoints;
  const found = checkpointAt(window, actionIndex);
  if (found.checkpoint) return '';
  if (found.absence === 'pruned') {
    return (
      `action ${actionIndex} is older than this game's retained undo window ` +
      `(it keeps ${checkpointCount(window)} checkpoint(s), back to action ${window!.baseIndex}). ` +
      `Raise or remove \`checkpoints: { max }\` on the game definition to reach further back.`
    );
  }
  return (
    `no checkpoint was captured at action ${actionIndex} ` +
    `(the snapshot carries ${checkpointCount(window)}). Either the snapshot was not produced by ` +
    `GameRunner.getSnapshot, or this game sets \`checkpoints: { enabled: false }\`, which disables undo.`
  );
}
