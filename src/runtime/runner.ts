import { secureRandomHex } from '../utils/secure-random.js';
import { NOTHING_CHANGED, rulesErrorSentence, withDevDetail } from '../engine/action/rules-error.js';
import { ActionExecutor, evaluateConditionWithTrace } from '../engine/action/action.js';
import {
  createActionCheckpoint,
  checkpointAt,
  checkpointCount,
  FlowHaltedError,
  canSeatAct,
  availableActionsForSeat,
  followUpForSeat,
  type Game,
  type GameOptions,
  type Player,
  isSeatExpiry,
  type ActionResult,
  type FlowState,
  type ActionCheckpoint,
  type ActionCheckpointWindow,
  type PendingActionState,
  type ActionDefinition,
  type CheckpointPolicy,
  type UndoPolicy,
} from '../engine/index.js';
import {
  serializeAction,
  deserializeAction,
  createRunnerSnapshot,
  snapshotTree,
  createPlayerView,
  createAllPlayerViews,
  type GameStateSnapshot,
  type PlayerStateView,
} from '../engine/utils/index.js';
import type {
  SerializedAction,
  HistoryEntry,
} from '../engine/action/types.js';
import type { LogEviction, RandomnessPolicy } from '../engine/element/game.js';
import { ErrorCode, type GameOptionDefinition } from '../types/protocol.js';
import { fillGameOptionDefaults } from '../session/game-option-selection.js';
import { PlayerFacingError } from '../engine/errors.js';
import { constructGame, animationFloorOf, type AnimationFloor } from '../engine/element/game.js';
import { acceptsSubmission } from '../engine/utils/enumerate-moves.js';
import type { RandomState } from '../utils/random.js';
import type { MessageEntry } from '../engine/index.js';

/**
 * Re-exported so `boardsmith/runtime` keeps naming these policy types alongside
 * `GameRunnerOptions`. Their single definitions live in the engine
 * (`engine/utils/snapshot.ts`, and `engine/element/game.ts` for
 * `RandomnessPolicy`, which is also a `GameOptions` field) so a published
 * bundle can name them from the two modules it is allowed to import —
 * `boardsmith` and `boardsmith/session`.
 */
export type { CheckpointPolicy, UndoPolicy, RandomnessPolicy };

/**
 * A game's `CheckpointPolicy` plus the one retention choice that belongs to the
 * HOST, never to the game: how much history to keep below the hard cap.
 *
 * - `'turn'` (the default): keep checkpoints back to the start of the current
 *   action-step frame, the oldest point any seat's undo can restore, and drop
 *   everything older. A saved game then stops growing with the action count.
 * - `'full'`: keep every checkpoint, so debug time travel and rewind reach the
 *   first action. `boardsmith dev` runs this way
 *   (`ExecuteOpHostOptions.fullHistory`).
 *
 * A game's `max` caps either.
 */
export interface RunnerCheckpointPolicy extends CheckpointPolicy {
  history?: 'turn' | 'full';
}

/**
 * Options for creating a game runner.
 *
 * `O` is the OPTIONS TYPE THE GAME CLASS ITSELF DECLARES, inferred from
 * `GameClass`'s constructor. A game that widens `GameOptions` with its own
 * rules knobs (Hex's `boardSize`, say) can therefore be constructed through the
 * runner with those knobs set. Typing `gameOptions` as the bare `GameOptions`
 * instead rejected every such option as an excess property (TS2353), which left
 * a game no way to start its own game through the runner.
 *
 * `NoInfer` on `gameOptions` keeps the object literal from being a second
 * inference source: the game class is the one declaration of what this game
 * accepts, and the literal is checked against it rather than widening it.
 */
export interface GameRunnerOptions<G extends Game, O extends GameOptions = GameOptions> {
  /** Game class constructor */
  GameClass: new (options: O) => G;
  /** Game type identifier */
  gameType: string;
  /** Options passed to game constructor */
  gameOptions: NoInfer<O>;
  /** Per-action undo checkpoint retention. Default: back to the turn start. */
  checkpoints?: RunnerCheckpointPolicy;
  /**
   * Whether this session may consume randomness at all. Default: `'allowed'`.
   *
   * `'forbidden'` makes EVERY draw throw `RandomnessForbiddenError` — the
   * order-entry / intent-capture policy (`hostOptions.randomness`). It is a
   * whole-session property rather than a per-action one because the exploit it
   * closes (undo, reorder, redo to re-roll — or abandon the session and start a
   * new one, which mints a new seed) is only shut by drawing zero times.
   *
   * Every runner construction path takes it, so a restore that forgets it
   * silently re-enables draws for the rest of the session.
   */
  randomness?: RandomnessPolicy;
  /**
   * The game's declared undo policy (`GameDefinition.undo`). Default: no
   * random fence.
   *
   * Carried on the runner — like `checkpoints` — so every host path that
   * builds a REPLACEMENT runner can read it off the runner it is replacing
   * instead of re-threading it from the game definition at each call site.
   */
  undo?: UndoPolicy;
  /**
   * The game's option declarations (boardsmith.json's `gameOptions`), when the
   * host has them: a new game starts with every declared option it was not
   * given at its default (#701, #708). A restore (`fromSnapshot`) never passes
   * them, so a save keeps the options it started with.
   */
  declaredGameOptions?: Readonly<Record<string, GameOptionDefinition>>;
  /**
   * Whoever runs this runner throws it away when an op fails and keeps the
   * game from before the op, as a host does. A failed action then tells the
   * player nothing was changed, even where the runner itself could not undo
   * it (#1254).
   */
  discardsFailedOps?: boolean;
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
  /**
   * `ActionResult.data` returned by the action's `execute()` (BUG-017) — the
   * only channel by which an action returns a computed value to the seat that
   * took it. Private to that seat: it is returned to this op's caller and is
   * NOT part of `flowState` or the seats' views, which fan out to the whole table.
   */
  data?: Record<string, unknown>;
  /** `ActionResult.message` returned by the action's `execute()` (BUG-012). */
  message?: string;
  /** A pick callback or `execute()` threw part way, so `runPickOp` says what it undid. */
  partiallyApplied?: boolean;
}

/**
 * GameRunner manages game execution with action history tracking
 * and provides serialization utilities for client-server sync
 */
/**
 * A checkpoint's tree paired with the live log as it stood at that boundary (#25).
 *
 * The watermark is ABSOLUTE — entries ever written — so a log a game has pruned
 * still restores exactly the lines that existed at the boundary and survive:
 * front eviction shifts every position by a known amount, and that amount is
 * what `evicted` carries.
 *
 * The restored tree takes the LIVE eviction count, not the checkpoint's own:
 * the log handed back is a slice of the live log, so its first entry sits at
 * the live offset. Keeping the checkpoint's older count would make the next
 * restore from this one slice the wrong boundary (#803).
 *
 * A checkpoint with no recorded watermark restores the whole log, which is the
 * honest reading of no recorded boundary.
 */
function checkpointWithLiveLog(
  checkpoint: ActionCheckpoint,
  log: MessageEntry[],
  live: LogEviction,
): { state: ActionCheckpoint['state']; messageLog: MessageEntry[] } {
  // Every count is replaced, absent ones included: the per-seat offsets (#903)
  // describe the live log's front exactly as the total does.
  const state = {
    ...checkpoint.state,
    messagesEvicted: live.messagesEvicted,
    messagesEvictedPublic: live.messagesEvictedPublic,
    messagesEvictedTo: live.messagesEvictedTo,
    messagesShownFrom: live.messagesShownFrom,
  };
  if (checkpoint.messageCount === undefined) return { state, messageLog: log };
  const evicted = live.messagesEvicted ?? 0;
  // The watermark counts entries EVER WRITTEN; `evicted` says how many of those
  // are no longer in the log. The difference is the boundary's position in the
  // log as it stands now — negative when every line from that boundary has
  // since been evicted, which honestly restores nothing rather than guessing.
  return { state, messageLog: log.slice(0, Math.max(0, checkpoint.messageCount - evicted)) };
}

/**
 * The refusal for a flow that halted after `actionName` committed, its cause logged once (#1120).
 * Every live completion route reports through here, since the message carries the cause only in
 * dev and nothing logs a halt when it is created, which keeps a bot's search copies quiet (#31).
 * Coded as a crash in the rules is, on every route (#1143).
 */
function reportHalt(actionName: string, halt: FlowHaltedError): ActionExecutionResult {
  console.error(`[BoardSmith] The flow failed after action '${actionName}' was committed:`, halt.cause);
  return { success: false, error: halt.message, errorCode: ErrorCode.ENGINE_ERROR };
}

/**
 * The code of an action that failed: a crash in its rules (#847) is ENGINE_ERROR, as a halt is,
 * so no caller reads it as the rules refusing; anything else is the rules refusing (#1143).
 */
function failureCode(result: ActionResult | undefined): ErrorCode {
  return result?.rulesError ? ErrorCode.ENGINE_ERROR : ErrorCode.ACTION_EXECUTION_ERROR;
}

/** A refused pick's code: a crash in the rules is ENGINE_ERROR, as on every other route (#1142). */
export function pickFailureCode(refused: { rulesError?: boolean }): ErrorCode {
  return refused.rulesError ? ErrorCode.ENGINE_ERROR : ErrorCode.INVALID_PICK;
}

/** What a player is told when a failed action could not be undone (checkpoints off, #808, #989). */
const PARTIAL_CHANGES_KEPT =
  'The action failed part way through, and the game may still hold its partial changes, ' +
  'because per-action checkpoints are turned off for this session so it could not be undone. ' +
  'Check the board before playing on, or restart the game from a save.';

/** The kept history entries before action `actionIndex`, which a checkpoint there restores with. */
function historyBefore(snapshot: GameStateSnapshot, actionIndex: number): HistoryEntry[] {
  const base = snapshot.actionHistoryBase ?? 0;
  if (actionIndex < base) {
    throw new Error(
      `This snapshot has a checkpoint at action ${actionIndex} but its history starts at action ${base}. ` +
      'The runner keeps both itself, so this is a BoardSmith bug; please report it.',
    );
  }
  return snapshot.actionHistory.slice(0, actionIndex - base);
}

export class GameRunner<G extends Game = Game, O extends GameOptions = GameOptions> {
  /** The game instance */
  readonly game: G;

  /** Game type identifier */
  readonly gameType: string;

  /**
   * The game's history: every action taken, and every seat the host closed at
   * a deadline. Entry `i` is action `actionHistoryBase + i`.
   */
  readonly actionHistory: HistoryEntry[] = [];

  /**
   * How many actions `checkpoints: { actionHistory: 'undo' }` has dropped from
   * the front of `actionHistory`. Public like `executeBarrierIndex`.
   */
  actionHistoryBase = 0;

  /** How many actions this game has recorded, dropped ones included: every action index counts from here. */
  get actionCount(): number {
    return this.actionHistoryBase + this.actionHistory.length;
  }

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

  /** This game's checkpoint retention policy. Default: back to the turn start. */
  private readonly checkpointPolicy_: Required<RunnerCheckpointPolicy>;

  /** This game's declared undo policy. Default: no random fence. */
  private readonly undoPolicy_: Required<UndoPolicy>;

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
   * WHICH GAME THIS IS (#356). Minted the first time it is read, adopted
   * from the snapshot by `fromSnapshot`, and carried by `fromCheckpoint` — an
   * undo is the same game, and `restoreEpoch` is what says it moved.
   *
   * Published to every seat as `PlayerGameState.gameInstanceId`. With
   * `restoreEpoch` it names the game tree a client's element ids came from: a
   * new game starts at epoch 0 like the one it replaced, so without this a
   * client could not tell "New game" from an ordinary re-broadcast.
   */
  get gameInstanceId(): string {
    // Minted on first read, so a restore that adopts the snapshot's id draws nothing (#806).
    this.#gameInstanceId ??= secureRandomHex(16, "name a new game's instance", 'restore the game from a snapshot that carries its gameInstanceId');
    return this.#gameInstanceId;
  }

  set gameInstanceId(id: string) {
    this.#gameInstanceId = id;
  }

  #gameInstanceId: string | undefined;

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
   * `performAction`/`executeCollectedAction`: an execute() node immediately
   * following an action-step frequently runs INSIDE the completion of the
   * NEXT flow step, which for the multi-step / repeating-selection funnel
   * (`PendingActionManager`) happens via `continueFlowAfterPendingAction` -- called AFTER
   * `executeCollectedAction` already pushed to history. `captureCheckpoint()`
   * is the one chokepoint the executor already calls, via `getSnapshot()`,
   * once the WHOLE op (including any such trailing flow advance) has settled,
   * so it is also the correct place to
   * observe whether an execute() node ran during this op.
   */
  private recordExecuteBarrierAdvance(): void {
    const completions = this.game.getIrreversibleCommitCount();
    if (completions !== this.lastSeenIrreversibleCommits) {
      this.lastSeenIrreversibleCommits = completions;
      this.executeBarrierIndex = this.actionCount;
    }
  }

  /** The state version just before the pick op in progress ran `execute()`, set by `executeCollectedAction` for `runPickOp`. */
  private versionBeforeExecute: number | undefined;

  /**
   * Random seed (for deterministic replay). Captured from the passed
   * `gameOptions.seed` when supplied; otherwise read back from the game's
   * effective (auto-generated) seed after construction, so any run —
   * including one that let the Game auto-generate its own seed — is
   * replayable.
   */
  readonly seed?: string;

  readonly #discardsFailedOps: boolean;

  constructor(options: GameRunnerOptions<G, O>) {
    this.#discardsFailedOps = options.discardsFailedOps ?? false;
    this.gameType = options.gameType;
    this.checkpointPolicy_ = {
      max: options.checkpoints?.max ?? Number.POSITIVE_INFINITY,
      enabled: options.checkpoints?.enabled ?? true,
      history: options.checkpoints?.history ?? 'turn',
      actionHistory: options.checkpoints?.actionHistory ?? 'all',
    };
    this.undoPolicy_ = {
      fenceRandomRewind: options.undo?.fenceRandomRewind ?? false,
    };
    if (this.checkpointPolicy_.max < 1) {
      throw new Error(
        `checkpoints.max must be at least 1 (got ${this.checkpointPolicy_.max}). ` +
        `Use checkpoints: { enabled: false } to turn checkpointing off entirely.`,
      );
    }

    // Order-entry / intent-capture sessions consume no randomness at all, and
    // the engine enforces that rather than trusting the game to avoid drawing:
    // one cosmetic shuffle silently reopens RNG scumming.
    //
    // Threaded through the game's own CONSTRUCTOR options — not applied to the
    // instance afterwards — because `Game`'s constructor runs before the
    // subclass's body, and games really do draw there (cribbage picks its
    // dealer with `this.random()` in the constructor; sotf derives its map seed
    // the same way). Forbidding after `new GameClass(...)` returned would let
    // every one of those draws through in silence. This is the single
    // constructor every runner path funnels through, so a draw is impossible
    // from the game's first instruction — including anything setup does before
    // `start()` returns.
    this.game = constructGame(options.GameClass, {
      ...fillGameOptionDefaults(options.declaredGameOptions, options.gameOptions),
      randomness: options.randomness,
    });

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
   * turn-boundary state, which undo restores authoritatively. The executor
   * calls it via `getSnapshot`, and `PendingActionManager` calls it after
   * every pick that changes the game. Build a seat's state only after it
   * has run for the op: `canUndo` reads the window it leaves (#385).
   *
   * Then the window is trimmed oldest first: back to the turn start unless
   * the host keeps full history, and to `checkpoints.max` when the game sets
   * one. What remains is the range undo can reach. See
   * `RunnerCheckpointPolicy` and `docs/state-size.md`.
   */
  captureCheckpoint(): void {
    // UNDO-02: the chokepoint for detecting an execute()-barrier advance --
    // see recordExecuteBarrierAdvance's doc comment for why this is the
    // correct place (not the individual history-append call sites). Recorded
    // FIRST so it still happens for a game that has checkpointing disabled:
    // the barrier fences undo, it is not part of undo's payload.
    this.recordExecuteBarrierAdvance();

    // Under `'turn'` history nothing is kept before the oldest point a seat's
    // undo can still restore. No undo restores further back than the current
    // action-step frame's start (`computeUndoInfo`, `simultaneousUndoBoundary`
    // in session/utils.ts), and with no frame open no undo is possible at all.
    // Nor does any undo cross a `.notUndoable()` action or an irreversible
    // `execute()` (`undoFloor`, which `assertUndoAllowed` refuses by), so it
    // starts after the last of those when it lies inside the frame.
    const len = this.actionCount;
    const undoReach = this.checkpointPolicy_.history === 'full'
      ? undefined
      : this.undoFloor(len - (this.getFlowState()?.moveCount ?? 0));
    this.dropUnreadHistory(undoReach);
    if (!this.checkpointPolicy_.enabled) return;

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

    // Then drop from the FRONT. Oldest-first is what makes the retained window
    // the most recent actions -- the ones undo can actually reach: under
    // `'turn'` history, from the undo reach above. `max` caps either policy.
    const keepFrom = undoReach ?? this.checkpointBaseIndex;
    const excess = Math.max(
      keepFrom - this.checkpointBaseIndex,
      this.actionCheckpoints.length - this.checkpointPolicy_.max,
    );
    if (excess > 0) {
      this.actionCheckpoints = this.actionCheckpoints.slice(excess);
      this.checkpointBaseIndex += excess;
    }
  }

  /**
   * Under `checkpoints: { actionHistory: 'undo' }`, drop the history entries no
   * undo reads: those before the one just ahead of `undoReach` (#997). That
   * entry stays: it is what fences undo there, and an undo it refuses names it.
   * A host keeping full history has no reach, and keeps everything.
   */
  private dropUnreadHistory(undoReach: number | undefined): void {
    if (undoReach === undefined || this.checkpointPolicy_.actionHistory !== 'undo') return;
    const drop = undoReach - 1 - this.actionHistoryBase;
    if (drop <= 0) return;
    this.actionHistory.splice(0, drop);
    this.actionHistoryBase += drop;
  }

  /**
   * The oldest action count at or after `from` that an undo may restore: the
   * action after the last `.notUndoable()` entry since `from`, or
   * `executeBarrierIndex`, whichever is later, and never before `from`. The one
   * definition of what undo cannot cross: under `'turn'` history the retained
   * window starts at `undoFloor(frame start)`, and `assertUndoAllowed`
   * (session/utils.ts) refuses any target below `undoFloor(target)`.
   */
  undoFloor(from: number): number {
    // Dropped entries never decide it: the one that fences undo is always kept (`dropUnreadHistory`).
    for (let i = this.actionHistory.length - 1; i >= from - this.actionHistoryBase && i >= 0; i--) {
      if (this.actionHistory[i].undoable === false) return Math.max(i + 1 + this.actionHistoryBase, this.executeBarrierIndex);
    }
    return Math.max(from, this.executeBarrierIndex);
  }

  /**
   * This runner's resolved checkpoint retention policy.
   *
   * Exposed so every host path that builds a REPLACEMENT runner (undo, rewind,
   * HMR reload, new-game reset) can carry the same policy forward by reading it
   * off the runner it is replacing, instead of re-threading it from the game
   * definition at each call site. A path that forgets silently drops the
   * game's cap or the host's history choice from that point on, one call site
   * at a time.
   */
  get checkpointPolicy(): Required<RunnerCheckpointPolicy> {
    return this.checkpointPolicy_;
  }

  /**
   * This runner's resolved undo policy.
   *
   * Exposed for the same reason as `checkpointPolicy`: every path that builds
   * a replacement runner (undo, rewind, HMR reload) reads it off the runner it
   * replaces, so the fence cannot be silently dropped one call site at a time.
   */
  get undoPolicy(): Required<UndoPolicy> {
    return this.undoPolicy_;
  }

  /**
   * The seeded RNG position recorded at the checkpoint for `actionIndex`, or
   * `undefined` when this runner holds no checkpoint there (never captured, or
   * dropped by the retention policy — ask `describeCheckpointAbsence` which).
   *
   * Exists for the undo random fence (`UndoPolicy.fenceRandomRewind`): compare
   * it with `game.getRandomState()` and any difference means a draw was
   * consumed in the span being rewound. The generator advances on draws and on
   * nothing else, so this comparison IS "did anything draw here", in O(1),
   * from data every checkpoint already carries.
   */
  randomStateAt(actionIndex: number): RandomState | undefined {
    return checkpointAt(this.checkpointWindow(), actionIndex).checkpoint?.randomState;
  }

  /**
   * The retained checkpoint window, in the shape a snapshot carries it.
   *
   * Public because a caller that finds nothing at an action index must be able
   * to ask `describeCheckpointAbsence` WHY — pruned by policy, or never
   * captured because checkpointing is off — rather than assert a cause.
   */
  checkpointWindow(): ActionCheckpointWindow {
    return { baseIndex: this.checkpointBaseIndex, entries: [...this.actionCheckpoints] };
  }

  /** Index in `actionCheckpoints` of the checkpoint for the current action count. */
  private get headOffset(): number {
    return this.actionCount - this.checkpointBaseIndex;
  }

  /**
   * Capture the head checkpoint unless one already exists, so a failed action
   * has a state to roll back to, and the window has no gap, even when no
   * snapshot was taken since the last history entry (#802). Hosts snapshot
   * after every op, so there it costs nothing.
   */
  private ensureHeadCheckpoint(): void {
    if (this.checkpointPolicy_.enabled && !this.actionCheckpoints[this.headOffset]) {
      this.captureCheckpoint();
    }
  }

  /**
   * Restore the game to the state it was in before the current action ran.
   *
   * The per-action checkpoint window's head entry IS that state: it is captured
   * at the current action count and the failed action recorded nothing, so no
   * extra serialization is needed for this. The element tree, sequence counter,
   * RNG position, message log and flow are restored together from it, so the
   * open step's awaiting seats come back with the elements (#972) and the flow
   * holds the rebuilt tree's elements (#679).
   *
   * @returns the player-facing error to report (`undoneError`).
   */
  private rollbackToPreActionState(error: string | undefined): string {
    return this.undoneError(error, this.restoreHeadCheckpoint());
  }

  /**
   * The player-facing error of an action that failed part way: `error`
   * followed by `NOTHING_CHANGED` when the game was `restored`, or, when there
   * was no checkpoint to restore (only a game running with
   * `checkpoints: { enabled: false }`, since `ensureHeadCheckpoint` captures
   * one otherwise, #802), by a sentence saying the game may still hold the
   * action's partial changes (#808, #989).
   */
  private undoneError(error: string | undefined, restored: boolean): string {
    const kept = error === undefined ? '' : `${error} `;
    return kept + (restored || this.#discardsFailedOps ? NOTHING_CHANGED : PARTIAL_CHANGES_KEPT);
  }

  /** Put the game back to the head checkpoint, if there is one, and say whether it did. */
  private restoreHeadCheckpoint(): boolean {
    const checkpoint = this.actionCheckpoints[this.headOffset];
    if (!checkpoint) return false;
    if (!checkpoint.flowState) throw new Error('The checkpoint before the failed action holds no flow state, so the action cannot be rolled back.');
    const { state, messageLog } = checkpointWithLiveLog(checkpoint, this.game.messages ?? [], this.game.logEviction);
    this.game.loadSerializedState(state, { messageLog });
    this.game.rollBackFlow(checkpoint.flowState);
    if (checkpoint.sequence !== undefined) {
      this.game._ctx.sequence = checkpoint.sequence;
    }
    this.game.setRandomState(checkpoint.randomState);
    this.game._afterRestoreSubtree();
    return true;
  }

  /**
   * Run one op of a seat's pick-by-pick action so that, if it fails, it keeps
   * nothing (#1169): a host saves nothing for a failed op, so the game and the
   * open action stay as they were before it, and here the game is put back to
   * the head checkpoint, refreshed as the op begins. An op that recorded the
   * action (one whose flow then halted) is not undone, nor is one that changed
   * the game with checkpoints turned off, whose error then says the game may
   * still hold its changes. The op changed the game when game code ran in it
   * before `execute()` (the state version moved) or something threw part way
   * (`partiallyApplied`): an `execute()` that refuses cleanly changed nothing,
   * as `performAction` takes it. `undone` says the game is as before the op;
   * the caller then puts the seat's pending action back as it was.
   * @internal The pick-by-pick state machine's runner half: the session's PendingActionManager is its only caller (#1231).
   */
  runPickOp<R extends { success: boolean; error?: string; partiallyApplied?: boolean }>(run: () => R): { result: R; undone: boolean } {
    const recorded = this.actionCount;
    this.captureCheckpoint();
    const version = this.game._ctx._stateVersion;
    this.versionBeforeExecute = undefined;
    const result = run();
    if (result.success || this.actionCount !== recorded) return { result, undone: false };
    const changed = result.partiallyApplied || (this.versionBeforeExecute ?? this.game._ctx._stateVersion) !== version;
    if (!changed) return { result, undone: true };
    const restored = this.restoreHeadCheckpoint();
    // As `performAction` says it: undone after a throw, and the changes kept when nothing could be restored.
    const told = restored && !result.partiallyApplied ? result : { ...result, error: this.undoneError(result.error, restored) };
    return { result: told, undone: restored };
  }

  /**
   * Perform an action and record it in history
   */  /**
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

    // The history entry is encoded before the move changes anything, so its
    // refs are the positions the action acts on, and only from picks the
    // action's checks accepted, since encoding reads its choice callbacks
    // (#1128): the executor hands over the args its one check accepted.
    const checkedOnCopy = this.checkOnCopy(actionName, playerObj, args);
    if ('success' in checkedOnCopy) return checkedOnCopy;
    const history = this.historyRecorder(actionName, playerObj, args, checkedOnCopy.entry);

    this.ensureHeadCheckpoint();
    // A move refused before any action ran leaves the last move's result in place, so only a new one is this move's.
    const earlier = this.game.getLastActionResult();

    // Execute through flow (pass player index for simultaneous actions)
    let flowState: FlowState;
    try {
      flowState = this.game.continueFlow(actionName, args, playerIndex, history.onAccepted);
    } catch (error) {
      // An offered pick that cannot be encoded is the game's fault, thrown before anything changed (#1070).
      if (error === history.failure) throw error;
      // FlowHaltedError means the flow threw AFTER the action committed its
      // state changes. Record the committed action so actionHistory stays
      // consistent with applied game state (WR-02) — dropping it would make
      // replay/undo/snapshot diverge from what actually happened.
      if (error instanceof FlowHaltedError) {
        this.actionHistory.push(this.recorded(actionName, history.entry));
        return reportHalt(actionName, error);
      }
      // #47: an engine policy error's message was written to be read and goes
      // through; anything else is an arbitrary runtime error whose text would
      // leak internals and tell the reader nothing they can act on.
      if (!(error instanceof PlayerFacingError)) {
        console.error(`[BoardSmith] Flow failed during action '${actionName}':`, error);
      }
      return {
        success: false,
        error: error instanceof PlayerFacingError ? error.message : withDevDetail(rulesErrorSentence(actionName), error),
        errorCode: ErrorCode.ENGINE_ERROR,
      };
    }

    // Check if the action failed (flow state contains error)
    if (flowState.actionError) {
      // Read before the rollback, which restores a flow with no last action.
      const last = this.game.getLastActionResult();
      const failed = last === earlier ? undefined : last;
      // #44: a clean refusal mutated nothing, but a THROW out of execute(), or
      // a repeating selection refused after onEach ran for some picks (#325),
      // may have applied part of its changes before it stopped — leaving the tree
      // half-moved while the player is told nothing happened, and persisting
      // that disagreement at the next snapshot. Undo it.
      return {
        success: false,
        error: flowState.actionPartiallyApplied
          ? this.rollbackToPreActionState(flowState.actionError)
          : flowState.actionError,
        errorCode: failureCode(failed),
        flowState,
      };
    }

    // Record in history
    const serializedAction = this.recorded(actionName, history.entry);
    this.actionHistory.push(serializedAction);

    // The action's own return value to the acting seat. Read straight off the
    // flow engine rather than out of `flowState`, which is broadcast (BUG-017).
    const actionResult = this.game.getLastActionResult();

    return {
      success: true,
      serializedAction,
      flowState,
      data: actionResult?.data,
      message: actionResult?.message,
    };
  }

  /**
   * What only a check on a copy of the game can settle before the move: the
   * history entry of a repeating action the copy accepts, since its picks
   * change the game while they are checked (#1101), and the refusal of picks
   * that cannot be encoded as sent and that the game does not take (#1070).
   * No entry for any other submission, which costs no extra check.
   */
  private checkOnCopy(
    actionName: string,
    player: Player,
    args: Record<string, unknown>
  ): ActionExecutionResult | { entry: SerializedAction | undefined } {
    const action = this.game.getAction(actionName);
    const repeating = action !== undefined && this.game.getActionExecutor().hasRepeatingSelections(action);
    const unencodable = this.unencodableRefusal(actionName, player, action, args);
    if (!repeating && !unencodable) return { entry: undefined };
    if (!acceptsSubmission(this.game, actionName, player.seat, args)) return unencodable ?? { entry: undefined };
    return { entry: repeating ? this.serializeForHistory(actionName, player, args) : undefined };
  }

  /**
   * The refusal of a submission the game does not take whose picks cannot be
   * encoded at all: that is the caller's bad input (#1070). Its picks are
   * encoded as sent, so no game callback runs on them.
   */
  private unencodableRefusal(
    actionName: string,
    player: Player,
    action: ActionDefinition | undefined,
    args: Record<string, unknown>
  ): ActionExecutionResult | undefined {
    try {
      serializeAction(actionName, player, action ? this.game.getActionExecutor().picksOf(action, args) : args, this.game);
      return undefined;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return { success: false, error: error.message, errorCode: ErrorCode.INVALID_PICK };
    }
  }

  /**
   * A move's history entry: `entry` when it is already known, or else encoded
   * by `onAccepted` from the args the action's checks accepted, with `failure`
   * the error it threw when they cannot be encoded.
   */
  private historyRecorder(actionName: string, player: Player, args: Record<string, unknown>, entry: SerializedAction | undefined) {
    const history = {
      entry,
      failure: undefined as unknown,
      onAccepted: (resolved: Record<string, unknown>): void => {
        try {
          history.entry = this.serializeForHistory(actionName, player, args, resolved);
        } catch (error) {
          history.failure = error;
          throw error;
        }
      },
    };
    return history;
  }

  /**
   * The history entry of an action that ran. Only a repeating action, checked
   * on a copy first, can run without one: when the copy refused what the game
   * then took.
   */
  private recorded(actionName: string, serializedAction: SerializedAction | undefined): SerializedAction {
    if (!serializedAction) {
      throw new Error(
        `Action '${actionName}' ran, but the same picks were refused when they were checked on a copy of the game, ` +
          `so the move has no history entry. Its rules read something the game's state does not hold, such as a ` +
          `module-level variable or which game object they were handed: keep everything they read in the game's state.`,
      );
    }
    return serializedAction;
  }

  /**
   * Resolve + serialize an action's args into a history entry.
   *
   * Raw element IDs are first resolved to GameElement objects so they serialize
   * with branch paths (or stable IDs) that survive game restoration, instead of
   * being passed through as raw numbers; `resolved`, when given, holds the args
   * the action's checks already resolved and accepted. This is the single place the
   * `actionHistory` entry shape is produced, shared by:
   *   - `performAction` (single-step actions), and
   *   - `executeCollectedAction` (multi-step / repeating-selection actions).
   * Keeping both paths on this one helper guarantees every `actionHistory` entry
   * is identical in shape regardless of how the action was driven, so replay,
   * undo, and bot history treat them the same.
   *
   * Does NOT push to history — callers decide when to record (e.g. only after a
   * successful execute). `branchesBefore` is a pending action's
   * `branchesBeforePicks`.
   */
  private serializeForHistory(
    actionName: string,
    player: Player,
    args: Record<string, unknown>,
    resolved?: Record<string, unknown>,
    branchesBefore?: Readonly<Record<number, string | null>>
  ): SerializedAction {
    const actionDef = (this.game as any)._actions?.get(actionName);
    const isUndoable = actionDef?.undoable;

    let argsToSerialize = args;
    if (actionDef) {
      // Only the picks: a follow-up's other args are bound again by the engine
      // when the entry is replayed (#662). A skipped pick is absent (#627).
      const executor = new ActionExecutor(this.game);
      const sent = executor.picksOf(actionDef, args);
      argsToSerialize = resolved
        ? Object.fromEntries(Object.keys(sent).filter((name) => name in resolved).map((name) => [name, resolved[name]]))
        : executor.resolveArgs(actionDef, sent, player);
    }

    return serializeAction(
      actionName,
      player,
      argsToSerialize,
      this.game,
      isUndoable,
      branchesBefore
    );
  }

  /**
   * Execute a fully-collected pending action, the completion step of
   * `PendingActionManager`: record it and advance the flow when it succeeds. Run it inside `runPickOp`, which
   * puts the game back when it fails (#44, #801, #1169). A flow that halts
   * after the action is refused, as in `performAction`, rather than thrown (#1120).
   * A pick that is no longer on offer, or the action's `validate`, refuses it
   * before anything runs: the step is undone and `onCancel` does not run (#1169).
   * @internal The pick-by-pick state machine's runner half: the session's PendingActionManager is its only caller (#1231).
   */
  executeCollectedAction(pendingState: PendingActionState, playerPosition: number): ActionExecutionResult {
    const action = this.game.getAction(pendingState.actionName);
    const player = this.game.getPlayer(playerPosition);
    if (!action || !player) {
      throw new Error(`Cannot complete '${pendingState.actionName}' for seat ${playerPosition}: the game has no such action or seat.`);
    }
    const executor = this.game.getActionExecutor();
    const branchesBefore = pendingState.branchesBeforePicks;
    if (!branchesBefore) {
      // A pending state saved by an engine older than #1144 lacks the record.
      throw new PlayerFacingError(
        'This action was started before the game was updated and cannot be finished. Cancel it and take it again.'
      );
    }
    // Serialized before executing, and with each pick where it was before the picks' callbacks moved it (#1144).
    const serializedAction = this.serializeForHistory(action.name, player, pendingState.collectedArgs, undefined, branchesBefore);
    const refusal = executor.pendingActionRefusal(action, player, pendingState);
    if (refusal !== null) return { success: false, error: refusal, errorCode: ErrorCode.ACTION_EXECUTION_ERROR };
    this.versionBeforeExecute = this.game._ctx._stateVersion;
    const actionResult = executor.executePendingAction(action, player, pendingState);

    if (actionResult.success) {
      this.actionHistory.push(serializedAction);
      try {
        this.game.continueFlowAfterPendingAction(actionResult, playerPosition);
      } catch (error) {
        if (!(error instanceof FlowHaltedError)) throw error;
        return reportHalt(action.name, error);
      }
      return actionResult;
    }
    return { ...actionResult, errorCode: failureCode(actionResult) };
  }

  /**
   * Get the current flow state
   */
  getFlowState(): FlowState | undefined {
    return this.game.getFlowState() ?? undefined;
  }

  /**
   * Why `seat` may not take `actionName` right now, or `undefined` when the
   * flow currently offers it that action.
   *
   * A multi-step action is collected one selection at a time and runs when the
   * last arrives, without passing through the flow's own checks first. Every
   * pending-action path asks this, through `refusalToPick`, before any
   * selection is processed, so a pending action can never run on a finished
   * game or as another seat's move (#492).
   *
   * A follow-up counts as offered only to the seat whose action published it
   * (`followUpForSeat`): that is how a chained action that the step does not
   * list is taken, and in a simultaneous step no other seat may take it.
   */
  refusalToAct(actionName: string, seat: number): { error: string; errorCode: ErrorCode } | undefined {
    if (!this.game.getAction(actionName)) {
      return { error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }
    const flowState = this.getFlowState();
    if (flowState?.complete || this.game.isFinished()) {
      return { error: 'The game is finished.', errorCode: ErrorCode.NOT_AWAITING_INPUT };
    }
    if (!flowState?.awaitingInput) {
      return { error: 'The game is not waiting for any action right now.', errorCode: ErrorCode.NOT_AWAITING_INPUT };
    }
    if (!canSeatAct(flowState, seat)) {
      return { error: "It's not your turn.", errorCode: ErrorCode.NOT_YOUR_TURN };
    }
    const offered = availableActionsForSeat(flowState, seat).includes(actionName)
      || followUpForSeat(flowState, seat)?.action === actionName;
    if (!offered) {
      return {
        error: `'${actionName}' is not one of your actions right now.`,
        errorCode: ErrorCode.ACTION_NOT_AVAILABLE,
      };
    }
    return undefined;
  }

  /**
   * Why `seat` may not take the next pick of its pending action `actionName`
   * now, or `undefined` when it may. `pending` is the seat's open pending state,
   * or `undefined` when the pick about to be processed starts the action.
   * `PendingActionManager` asks this before any pick is processed, then calls `markStalePicks`;
   * `takePick` calls `notePickTaken` after each pick that leaves the action open.
   *
   * First, the flow must offer the action to the seat (`refusalToAct`). Then
   * its `condition`, evaluated as hosts evaluate it to show the action (with
   * no args), against the game as it stands (#493):
   *
   * - At the first pick it must hold, as for a whole submission.
   * - At a later pick (the last one completes the action) the action is
   *   refused only when the condition held right after the seat's own previous
   *   pick and does not hold now. Between those two moments nothing of this
   *   action ran, so something else, another seat's move, took it away. A
   *   whole action replays at its place in the history after that move, with
   *   its condition checked first, so letting it complete would record a move
   *   that is not legal where it is recorded.
   * - When the condition already failed right after the seat's own previous
   *   pick (a repeat's `onEach` spent what the condition counts), the pick is
   *   not refused: its picks are part of the action, and the condition was
   *   checked before they ran.
   *
   * Limit: once the action's own picks have ended the condition, nothing here
   * can tell whether another seat's move would also have ended it, because the
   * game as other seats alone would have left it no longer exists. Until the
   * condition holds again after one of the action's picks, such an action is
   * NOT refused even if another seat's move would have taken the condition
   * away. This is a known gap, not a guarantee that other seats' moves are
   * always caught. A pending state without `conditionHeld` (a host resuming
   * from `initialArgs` alone, or one persisted before the field existed) is
   * treated as the first pick.
   *
   * A held follow-up is offered by its chain, not its condition, so its
   * condition is not evaluated at all.
   */
  refusalToPick(
    actionName: string,
    seat: number,
    pending: PendingActionState | undefined,
  ): { error: string; errorCode: ErrorCode } | undefined {
    const refusal = this.refusalToAct(actionName, seat);
    if (refusal) return refusal;
    const failed = this.failedConditionLabels(actionName, seat);
    if (failed.length === 0) return undefined;
    const labels = failed.map((label) => `'${label}'`).join(' and ');
    if (pending?.conditionHeld === undefined) {
      return {
        error: `'${actionName}' is not available to you right now: ${labels} does not hold.`,
        errorCode: ErrorCode.ACTION_NOT_AVAILABLE,
      };
    }
    if (pending.conditionHeld) {
      return {
        error: `'${actionName}' is no longer available to you: the game changed since your last choice, and ${labels} no longer holds.`,
        errorCode: ErrorCode.ACTION_NOT_AVAILABLE,
      };
    }
    return undefined;
  }

  /**
   * Record, after `seat` made a pick that leaves its pending action open,
   * whether the action's condition still holds, so the next pick's
   * `refusalToPick` can tell what took it away.
   */
  notePickTaken(pending: PendingActionState, seat: number): void {
    pending.conditionHeld = this.failedConditionLabels(pending.actionName, seat).length === 0;
    pending.picksOnOffer = this.picksOnOffer(pending, seat);
  }

  /**
   * Before `seat`'s next pick of `pending`, mark each of its own picks that was
   * on offer right after its latest pick and is not now, for
   * `executePendingAction` to re-check (#767). Only another action can have
   * taken it in between, so a pick the action's own `onSelect` took off the
   * offer is never marked.
   * @internal The pick-by-pick state machine's runner half: the session's PendingActionManager is its only caller (#1231).
   */
  markStalePicks(pending: PendingActionState, seat: number): void {
    if (!pending.picksOnOffer) return;
    const onOffer = this.picksOnOffer(pending, seat);
    const taken = pending.picksOnOffer.filter((name) => !onOffer.includes(name));
    if (taken.length > 0) pending.stalePicks = [...new Set([...(pending.stalePicks ?? []), ...taken])];
  }

  /**
   * The seat's own non-repeating picks of `pending` that a whole submission
   * would take now. A pick a held follow-up answered is the engine's and is
   * left out.
   */
  private picksOnOffer(pending: PendingActionState, seat: number): string[] {
    const action = this.game.getAction(pending.actionName)!;
    const executor = this.game.getActionExecutor();
    const player = this.game.getPlayer(seat)!;
    const bound = this.followUpArgsFor(pending.actionName, seat);
    const args = executor.resolveArgs(action, pending.collectedArgs, player);
    return action.selections
      .filter((selection) => args[selection.name] !== undefined
        && !Object.hasOwn(bound, selection.name)
        && !executor.isRepeatingSelection(selection)
        && executor.validateSelection(selection, args[selection.name], player, args, action.name).valid)
      .map((selection) => selection.name);
  }

  /**
   * The labels of `actionName`'s condition that fail for `seat` now, evaluated
   * with no args, as availability is. None for an action without a condition,
   * and none for the seat's held follow-up, whose condition does not apply.
   */
  private failedConditionLabels(actionName: string, seat: number): string[] {
    const action = this.game.getAction(actionName);
    const player = this.game.getPlayer(seat);
    if (!action?.condition || !player) return [];
    if (followUpForSeat(this.getFlowState(), seat)?.action === actionName) return [];
    const { details } = evaluateConditionWithTrace(
      action.condition,
      { game: this.game, player, args: {} },
      `action '${actionName}'`,
    );
    return details.filter((detail) => !detail.passed).map((detail) => detail.label);
  }

  /**
   * A host closing a seat whose deadline passed, on any step, timed or not
   * (#494: host deadlines always win). When `seat` holds a follow-up and the
   * step does not offer `seat` the idle action `actionName`, the follow-up is
   * dropped and the seat's part ends, and the new flow state is returned.
   * Otherwise returns `undefined`, and the host runs the idle action as the
   * seat's own action, which, when the step offers it, also drops the seat's
   * follow-up. The stateless `expireSeat` op is the one caller.
   */
  closeExpiredHeldSeat(seat: number, actionName: string): FlowState | undefined {
    if (!followUpForSeat(this.getFlowState(), seat)) return undefined;
    if (this.refusalToAct(actionName, seat) === undefined) return undefined;
    return this.expireHeldSeat(seat);
  }

  /**
   * Drop `seat`'s held follow-up, end its part in the open step, and record
   * that in `actionHistory` as a seat expiry. No action ran, but the flow
   * moved, so the history has to say so: `replay` re-applies the entry through
   * this same method, and undo counts it (and never reaches behind it). Throws
   * when `seat` holds no follow-up, so a replay on rules that no longer hold
   * one fails loudly.
   */
  private expireHeldSeat(seat: number): FlowState {
    this.ensureHeadCheckpoint();
    const state = this.game.expireHeldSeat(seat);
    this.actionHistory.push({ kind: 'seatExpiry', player: seat, undoable: false });
    return state;
  }

  /**
   * The args `seat`'s held follow-up was published with, when it holds one
   * naming `actionName`; otherwise none. They are the engine's: a client never
   * sends them (#662).
   */
  followUpArgsFor(actionName: string, seat: number): Record<string, unknown> {
    const followUp = followUpForSeat(this.getFlowState(), seat);
    return followUp?.action === actionName ? followUp.args ?? {} : {};
  }

  /**
   * When `pendingState` is `seat`'s held follow-up, bind the args the follow-up
   * was published with before any client pick: a follow-up runs with those,
   * and a pick they answer is passed over, whatever the client sends for it.
   * Every pending action is started through this.
   * @internal The pick-by-pick state machine's runner half: the session's PendingActionManager is its only caller (#1231).
   */
  bindFollowUpArgs(pendingState: PendingActionState, seat: number): void {
    Object.assign(pendingState.collectedArgs, this.followUpArgsFor(pendingState.actionName, seat));
  }

  /**
   * Take one pick of a seat's open pick-by-pick action for
   * `PendingActionManager`: check it
   * is the pick the action is at, make it, and say whether the action is now
   * complete. It does not run the action: the caller does, with
   * `executeCollectedAction`.
   * @internal The pick-by-pick state machine's runner half: the session's PendingActionManager is its only caller (#1231).
   */
  takePick(pendingState: PendingActionState, playerPosition: number, selectionName: string, value: unknown) {
    const action = this.game.getAction(pendingState.actionName);
    if (!action) {
      return { success: false as const, error: `Action not found: ${pendingState.actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }
    const player = this.game.getPlayer(playerPosition);
    if (!player) {
      return { success: false as const, error: `Player not found: ${playerPosition}`, errorCode: ErrorCode.INVALID_PLAYER };
    }
    const selection = action.selections[pendingState.currentSelectionIndex];
    if (!selection) {
      return { success: false as const, error: 'No current selection', errorCode: ErrorCode.PICK_NOT_FOUND };
    }
    if (selection.name !== selectionName) {
      return {
        success: false as const,
        error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${action.selections.findIndex(s => s.name === selectionName)}`,
        errorCode: ErrorCode.PICK_NOT_FOUND,
      };
    }

    const executor = this.game.getActionExecutor();
    const repeating = executor.isRepeatingSelection(selection);
    let step: Omit<ReturnType<ActionExecutor['processRepeatingStep']>, 'error' | 'rulesError'> = { done: true };
    if (repeating) {
      const result = executor.processRepeatingStep(action, player, pendingState, value);
      if (result.error) {
        return { success: false as const, error: result.error, errorCode: pickFailureCode(result), nextChoices: result.nextChoices, partiallyApplied: result.partiallyApplied };
      }
      step = result;
    } else {
      const result = executor.processSelectionStep(action, player, pendingState, selectionName, value);
      if (!result.success) return { success: false as const, error: result.error, errorCode: pickFailureCode(result), partiallyApplied: result.partiallyApplied };
    }

    const complete = step.done && executor.isPendingActionComplete(action, pendingState);
    if (!complete) this.notePickTaken(pendingState, playerPosition);
    return { success: true as const, complete, repeating, done: step.done, nextChoices: step.nextChoices, warnings: step.warnings };
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
    return {
      ...createRunnerSnapshot(this.game, this.gameType, this.actionHistory, this.seed, this.checkpointWindow()),
      ...(this.actionHistoryBase > 0 && { actionHistoryBase: this.actionHistoryBase }),
      executeBarrierIndex: this.executeBarrierIndex,
      restoreEpoch: this.restoreEpoch,
      gameInstanceId: this.gameInstanceId,
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
   * Replay a game from its history: every action is performed again, and every
   * seat the host closed at a deadline is closed again, in order. Throws, naming the
   * entry, when the rules no longer accept one, and when the history no longer
   * starts at action 0 (`checkpoints: { actionHistory: 'undo' }`).
   */
  static replay<G extends Game>(
    options: GameRunnerOptions<G>,
    { actionHistory: history, actionHistoryBase }: Pick<GameStateSnapshot, 'actionHistory' | 'actionHistoryBase'>
  ): GameRunner<G> {
    if (actionHistoryBase) {
      throw new Error(
        `Cannot replay this game: its history starts at action ${actionHistoryBase}, because the game keeps only ` +
        `the history undo needs (checkpoints: { actionHistory: 'undo' }). Replay needs every action from the start.`,
      );
    }
    const runner = new GameRunner(options);
    runner.start();

    for (const entry of history) {
      if (isSeatExpiry(entry)) {
        try {
          runner.expireHeldSeat(entry.player);
        } catch (error) {
          throw new Error(`Replay failed at seat ${entry.player}'s expiry: ${error instanceof Error ? error.message : String(error)}`);
        }
        continue;
      }
      const { actionName, player, args } = deserializeAction(entry, runner.game);
      const result = runner.performAction(actionName, player, args);

      if (!result.success) {
        throw new Error(`Replay failed at action ${entry.name}: ${result.error}`);
      }
    }

    return runner;
  }

  /**
   * Restore a game from a snapshot — fully STATE-AUTHORITATIVE, NO replay.
   *
   * The snapshot already carries the complete authoritative state: the element
   * tree (`snapshotTree(snapshot)` = `game.toJSON()`), the flow engine state
   * (`snapshot.flowState`), the element sequence counter (`snapshot.sequence`),
   * and — since RNG-state capture was added — the seeded RNG position
   * (`snapshot.randomState`). We reconstruct the game directly from those rather
   * than replaying action history.
   *
   * This deliberately does NOT call `start()` or re-run the
   * actionHistory through `continueFlow`. The previous replay-based restore was
   * only ever a way to re-derive the tree, flow position, and RNG advance — all
   * three of which are now restored authoritatively below. Crucially, replay was
   * also unsound: selection-step / pending-completed actions are not recorded
   * in action history, so replaying an incomplete actionHistory
   * mis-positioned the flow and crashed real games (e.g. MERC's bot dictator
   * Day-1 turn: "Player N is not awaiting action"). Restoring state directly
   * sidesteps that entire class of bug.
   *
   * `actionHistory` is still preserved on the runner because the undo op reads
   * `runner.actionHistory` — it is just no longer replayed here.
   */
  static fromSnapshot<G extends Game>(
    snapshot: GameStateSnapshot,
    GameClass: new (options: GameOptions) => G,
    options?: {
      animationFloor?: AnimationFloor;
      checkpoints?: RunnerCheckpointPolicy;
      randomness?: RandomnessPolicy;
      undo?: UndoPolicy;
      discardsFailedOps?: boolean;
    }
  ): GameRunner<G> {
    const tree = snapshotTree(snapshot);
    // Use full gameOptions from snapshot if available, falling back to basic options
    // This ensures custom options like playerConfigs are preserved
    const gameOptions = snapshot.gameOptions ?? {
      playerCount: tree.settings.playerCount as number,
      playerNames: tree.settings.playerNames as string[],
      seed: snapshot.seed,
    };

    // Constructs an initial game tree; everything below overwrites it with the
    // authoritative snapshot state.
    const runner = new GameRunner({
      GameClass,
      gameType: snapshot.gameType,
      gameOptions: gameOptions as GameOptions,
      // The retention policy is NOT carried in the snapshot -- it is declared on
      // the game definition and the host, so every restore must re-supply it. A
      // restore that forgets it silently drops the game's cap or the host's
      // history choice on the very next op.
      checkpoints: options?.checkpoints,
      // Session policy is NOT carried in the snapshot (same reason as the
      // retention policy above): every stateless op rebuilds its runner, so the
      // host re-supplies it per op. A restore that drops it silently re-allows
      // draws for the rest of the session.
      randomness: options?.randomness,
      undo: options?.undo,
      discardsFailedOps: options?.discardsFailedOps,
    });

    // Preserve action history for the undo op (which reads runner.actionHistory).
    // It is intentionally NOT replayed.
    runner.actionHistory.push(...snapshot.actionHistory);
    // Absent: nothing was dropped, the honest reading of a snapshot that does not say.
    runner.actionHistoryBase = snapshot.actionHistoryBase ?? 0;

    // Carry the retained checkpoint window forward so the next getSnapshot keeps
    // the retained entries intact while refreshing the head one.
    //
    // A snapshot with no window (written with checkpoints disabled) starts an
    // EMPTY window at the CURRENT action count, not at 0. Starting at 0 would make the next capture write into
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
    const usable = runner.checkpointPolicy_.enabled && window !== undefined;
    runner.checkpointBaseIndex = usable ? window.baseIndex : runner.actionCount;
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

    // Adopt the game's identity. A snapshot that names none -- a hand-built
    // fixture, or a saved position written before #356 -- has never been
    // published as any game, so the id this runner minted becomes its name, and
    // every snapshot it writes from here on carries it.
    if (snapshot.gameInstanceId !== undefined) runner.gameInstanceId = snapshot.gameInstanceId;

    // Adopt the authoritative element tree. loadSerializedState fully clears and
    // rebuilds the tree from `tree` on its own (see Game.loadSerializedState),
    // so it stands alone with no prior replay.
    //
    // `animationFloor` (UNDO-04): absent for a normal full restore (adopt
    // the persisted animation-event seq, today's behavior); supplied only by
    // `fromCheckpoint` below, so an undo/rewind checkpoint restore can never
    // move the live animation-event id sequence backwards. Do not thread a
    // floor through any other caller of `fromSnapshot` -- see game.ts's
    // `loadSerializedState` doc comment / RESEARCH.md §C.
    // The message log is NOT in the tree (it is a snapshot sibling —
    // see `GameStateSnapshot.messageLog`), so it must be handed over explicitly.
    // `loadSerializedState` assigns it unconditionally, so a snapshot without a
    // log restores an empty one rather than leaving whatever this instance held.
    runner.game.loadSerializedState(tree, {
      ...options,
      messageLog: snapshot.messageLog ?? [],
    });

    // Restore the element sequence counter to its authoritative snapshot value.
    // The fromJSON tree rebuild in loadSerializedState advances _ctx.sequence, so
    // without this reset the next element created after restore would get an id
    // that drifts from what dev assigns (a parity bug) and can trip the
    // deletion-detector console.warn.
    if (snapshot.sequence !== undefined) {
      runner.game._ctx.sequence = snapshot.sequence;
    }

    // Restore the seeded RNG position directly so the next game.random() draw
    // matches the live game exactly. This is what lets us drop the replay: the
    // replay's only surviving contribution was re-advancing the RNG, and it could
    // not account for draws made inside pending/selection executes. Restoring the
    // generator state covers all of those. A snapshot without one is refused.
    runner.game.setRandomState(snapshot.randomState);

    // Restore the authoritative flow state (re-resolves players against the tree
    // just loaded). restoreFlowState builds a fresh FlowEngine from the saved
    // position, so it does not require a prior start().
    //
    // Element-valued flow variables (e.g. a setVar value or a
    // forEach `as` binding) were serialized to element markers by
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

    runner.game._afterRestoreSubtree();
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
   * `actionHistory` is the kept part of the matching prefix `[0..actionIndex)`.
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
    options?: { checkpoints?: RunnerCheckpointPolicy; randomness?: RandomnessPolicy; undo?: UndoPolicy }
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
    const liveTree = snapshotTree(snapshot);
    const animationFloor = animationFloorOf(liveTree);

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
    // Same shape as the `animationFloor` and `executeBarrierIndex` clamps
    // above: derived here, at the single sanctioned checkpoint-restore site, so
    // no undo/rewind caller has to remember it.
    //
    // A checkpoint predating the watermark has no recorded boundary, so the
    // honest restore is the whole log rather than a guess.
    const fullLog = snapshot.messageLog ?? [];
    // The eviction counts ride in the snapshot's tree, which is where the log's
    // position bookkeeping lives.
    const { state, messageLog } = checkpointWithLiveLog(checkpoint, fullLog, liveTree);

    return GameRunner.fromSnapshot<G>(
      {
        version: snapshot.version,
        gameType: snapshot.gameType,
        messageLog,
        flowState: checkpoint.flowState,
        winners: checkpoint.winners,
        actionHistory: historyBefore(snapshot, actionIndex),
        actionHistoryBase: snapshot.actionHistoryBase,
        seed: snapshot.seed,
        sequence: checkpoint.sequence,
        randomState: checkpoint.randomState,
        gameOptions: snapshot.gameOptions,
        // The retained window, truncated at the restore point: entries AHEAD of
        // `actionIndex` describe a timeline this runner no longer has. The base
        // is unchanged -- everything already pruned stays pruned. Its newest
        // entry is the restored tree: `checkpoint` with the live eviction count.
        actionCheckpoints: {
          baseIndex: window!.baseIndex,
          entries: [...window!.entries.slice(0, actionIndex - window!.baseIndex), { ...checkpoint, state }],
        },
        executeBarrierIndex,
        // The restore itself, recorded durably. This is the ONE site that
        // advances the epoch -- same reasoning as `animationFloor` and the
        // `executeBarrierIndex` clamp above: derived at the single sanctioned
        // checkpoint-restore site, so no undo/rewind caller has to remember it,
        // and no host can ship a restore that forgets to tell its clients.
        restoreEpoch: (snapshot.restoreEpoch ?? 0) + 1,
        // The same game, restored: its identity does not change.
        gameInstanceId: snapshot.gameInstanceId,
      },
      GameClass,
      {
        animationFloor,
        checkpoints: options?.checkpoints,
        randomness: options?.randomness,
        undo: options?.undo,
      },
    );
  }
}

/**
 * Restore a WHOLE earlier snapshot of the game `live` is the current state
 * of -- the second sanctioned restore, for a host that kept the earlier
 * snapshot itself (a demo stepping back one move) rather than a checkpoint.
 *
 * It is a restore in every sense a client can see, exactly as
 * {@link GameRunner.fromCheckpoint} is: the epoch advances past the live one, so every
 * seat knows its element ids and animation watermark are stale, and the
 * animation-event id sequence never moves below where `live` was. Loading
 * `earlier` with `fromSnapshot` instead would hand clients an older position
 * under an epoch they have already seen, and the next move's animations
 * would reuse ids they already played.
 *
 * Throws when `earlier` is from another game: that is not a restore.
 */
export function restoreEarlierSnapshot<G extends Game>(
  live: GameStateSnapshot,
  earlier: GameStateSnapshot,
  GameClass: new (options: GameOptions) => G,
  options?: { checkpoints?: RunnerCheckpointPolicy; randomness?: RandomnessPolicy; undo?: UndoPolicy }
): GameRunner<G> {
  if (earlier.gameInstanceId !== live.gameInstanceId) {
    throw new Error(
      'Cannot restore that snapshot here: it is from a different game than the one being played. ' +
      'A restore only goes back in the same game; start a new game from it instead.',
    );
  }
  const runner = GameRunner.fromSnapshot(
    { ...earlier, restoreEpoch: (live.restoreEpoch ?? 0) + 1 },
    GameClass,
    {
      animationFloor: animationFloorOf(snapshotTree(live)),
      checkpoints: options?.checkpoints,
      randomness: options?.randomness,
      undo: options?.undo,
    },
  );
  // `earlier` may be an arranged position, edited to a finished game after its flow was saved.
  runner.game.endFlowIfFinished();
  return runner;
}

/**
 * Why there is no checkpoint at `actionIndex`, as an actionable sentence.
 *
 * `GameRunner.fromCheckpoint` returns `null` for two very different reasons,
 * and reporting them identically is what made the original problem so hard to
 * diagnose. `pruned` is a policy the game author chose and can change;
 * `uncaptured` means the snapshot was not produced by `getSnapshot` at all, or
 * this game has checkpointing disabled.
 *
 * Takes the WINDOW rather than the enclosing snapshot so the live runner
 * (`GameRunner.checkpointWindow()`) can ask it too — the random fence in
 * `assertUndoAllowed` runs before any restore is attempted and has no snapshot
 * in hand, and it must not re-guess a cause this function already knows.
 *
 * `audience` is required, because the two readers must be told different
 * things. `'debug'` (a rewind or a time-travel view, whose caller named the
 * index) gets the index and the window's size. `'seat'` (an undo refusal a
 * player reads) gets neither: both count every seat's actions, so a seat could
 * count another seat's secret ones (#449).
 *
 * `history` is the retention the window was kept under
 * (`RunnerCheckpointPolicy.history`), so the turn window is named as a cause
 * only when it applied.
 */
export function describeCheckpointAbsence(
  window: ActionCheckpointWindow | undefined,
  actionIndex: number,
  audience: 'seat' | 'debug',
  history: 'turn' | 'full',
): string {
  const found = checkpointAt(window, actionIndex);
  if (found.checkpoint) return '';
  const debug = audience === 'debug';
  if (found.absence === 'pruned') {
    const where = debug
      ? `action ${actionIndex} is older than this game's retained undo window ` +
        `(it keeps ${checkpointCount(window)} checkpoint(s), back to action ${window!.baseIndex}). `
      : `the point being restored is older than this game's retained undo window. `;
    // The turn window keeps every target a seat's undo is not fenced from, so
    // only `max` prunes one. A debug read may name any index.
    const turn = debug && history === 'turn'
      ? `This session keeps checkpoints only back to the start of the current turn, or to the ` +
        `last action or step since then that cannot be undone; a host that ` +
        `passes \`fullHistory\` (as boardsmith dev does) keeps them all. `
      : '';
    return where + turn + `Raise or remove \`checkpoints: { max }\` on the game definition to reach further back.`;
  }
  const where = debug
    ? `no checkpoint was captured at action ${actionIndex} (the retained window carries ${checkpointCount(window)}). `
    : `no checkpoint was captured at the point being restored. `;
  return (
    where +
    `Either the snapshot was not produced by GameRunner.getSnapshot, or this game sets ` +
    `\`checkpoints: { enabled: false }\`, which disables undo.`
  );
}
