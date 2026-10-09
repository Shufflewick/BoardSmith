/**
 * Pure stateless op executor — the single source of truth for running one
 * BoardSmith game operation against a snapshot and returning a new snapshot.
 *
 * Lifted from ShufflewickPub/executor/src/runner.ts so both the production
 * executor worker and the `boardsmith dev` parity harness share the same logic.
 *
 * `executeOp` is intentionally pure: no I/O, no module-level mutable state,
 * no memory between calls.
 */

import type { Game, GameClass, TutorialDefinition, Annotation, FlowState, FollowUpOffer, HistoryEntry } from '../engine/index.js';
import { ErrorCode, type ChoiceWithRefs, type ValidElement } from '../types/protocol.js';
import { dueSeats, canSeatAct, availableActionsForSeat, flowBoundaryKey, toPublicFlowState } from '../engine/index.js';
import type { BoundaryKeyState } from '../engine/index.js';
import type { HeatmapEntry, SerializedFlowDebugInfo, SerializedPendingActionState, WarningEntry } from './types.js';
import { validateTutorialDefinition, initialProgress, autoAdvanceTutorial } from '../engine/tutorial/progress.js';
import { executeDebugCommand, type GameCommand } from './debug-command.js';
import {
  GameRunner,
  restoreEarlierSnapshot,
  type GameStateSnapshot,
  type CheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
} from '../runtime/index.js';
import { createBot, parseBotLevel } from '../bot/index.js';
import type { BotMove } from '../bot/types.js';
import { describeMoveForHint } from './move-summary.js';
import { PERSIST_KEY, PERSIST_PRIVATE_KEY, type PersistCommit } from '../persistence/persistence.js';
import { PickHandler } from './pick-handler.js';
import { runnerFromSnapshot } from './runner-from-snapshot.js';
import {
  offerFollowUp,
  buildPlayerState,
  buildActionTraces,
  computeElementDiff,
  type ElementChanges,
  serializeFlowDebugInfo,
  assertUndoAllowed,
  UndoRefusedError,
  decideUndo,
  debuggingOffMessage,
} from './utils.js';

// ---------------------------------------------------------------------------
// Op discriminated union
// ---------------------------------------------------------------------------

/**
 * The staleness token a SUBMISSION carries: the identity of the flow position
 * the submission was composed against ({@link flowBoundaryKey}).
 *
 * Specification: `docs/simultaneous-and-interrupt-semantics.md`.
 *
 * **REQUIRED, deliberately.** An optional token is a bypass that every
 * un-updated caller takes by default and silently, which is the exact defect
 * this field exists to close: a submission that names no round lands in
 * whichever round the game happens to be in when it arrives. The compile error
 * at each caller IS the migration.
 *
 * The engine MINTED this value (it rides out on every broadcast as
 * `meta.turnBoundary.key`) and is being handed it back. It is compared for
 * **equality and nothing else** — never parsed, never derived from. Equality or
 * refusal.
 *
 * It can only ever REJECT. `canPlayerAct`/`dueSeats`/the game author's
 * conditions remain the sole authorities on legality; a correct key buys
 * nothing. There is no `?? flowBoundaryKey(current)` fallback anywhere, on any
 * path — an absent key is refused, never defaulted.
 */
export interface BoundaryStamped {
  boundaryKey: string;
}

/**
 * The ops a platform executor runs: everything a deployed game needs, and
 * nothing that only `boardsmith dev` sends. A platform receives these over a
 * wire and validates them with {@link parseExecutorOp}.
 */
export type ExecutorOp =
  | { type: 'start' }
  | ({
      type: 'action';
      actionName: string;
      player: number;
      args: Record<string, unknown>;
    } & BoundaryStamped)
  /**
   * A host closing one seat still due because a deadline the host keeps has
   * passed: a step's own time limit, or any deadline of the host's own on any
   * step, timed or not (#494: host deadlines always win). Only a host composes
   * it, from its own timer: no client message maps to it, so nothing a client
   * sends can become one. The seat is closed the way the step allows: the
   * game's idle action, `idleAction` with `args`, runs as the seat's own action
   * when the step offers it (which drops any follow-up the seat held);
   * otherwise, when the seat holds a follow-up, the follow-up is dropped and the
   * seat's part ends without an action (`GameRunner.closeExpiredHeldSeat`),
   * recorded in the history as a seat expiry. Refused when the seat can take
   * neither. Stamped with the boundary the host armed its timer under, so a
   * round a human closed first refuses it as stale instead of landing it in the
   * next round.
   */
  | ({
      type: 'expireSeat';
      player: number;
      idleAction: string;
      args: Record<string, unknown>;
    } & BoundaryStamped)
  | ({
      type: 'selectionStep';
      player: number;
      selectionName: string;
      value: unknown;
      actionName?: string;
      initialArgs?: Record<string, unknown>;
    } & BoundaryStamped)
  | {
      type: 'resolveChoices';
      actionName: string;
      player: number;
      selectionName: string;
      args: Record<string, unknown>;
    }
  | { type: 'cancelAction'; player: number }
  | { type: 'undo'; player: number }
  | { type: 'botTurn'; seats: Array<{ seat: number; level?: string }> };

/**
 * The ops only `boardsmith dev` sends. `executeOp` runs them, each behind its
 * own gate: the debug family needs `hostOptions.debug`, and the teaching ops
 * are refused when `hostOptions.teachingDisabled` is set. A platform executor
 * does not accept them ({@link parseExecutorOp} refuses every one).
 */
export type DevOp =
  // Debug ops: the debug panel issues these over the dev bridge. Read-only ops
  // report state without mutating; the rest edit state like a move.
  | { type: 'debugHistory' }
  | { type: 'debugStateAt'; actionIndex: number; player: number }
  | { type: 'debugStateDiff'; fromIndex: number; toIndex: number; player: number }
  | { type: 'debugActionTraces'; player: number }
  // debugFlowState: the FLOW-01 locked "debug:* WS op family" channel — returns the
  // same SerializedFlowDebugInfo shape as the session broadcast, plus the requesting
  // seat's own pending action (perspective-scoped via the threaded pendingState).
  | { type: 'debugFlowState'; player: number }
  | { type: 'debugRewind'; actionIndex: number }
  | { type: 'debugReorder'; cardId: number; targetIndex: number }
  | { type: 'debugTransfer'; cardId: number; targetDeckId: number; position: 'first' | 'last' }
  | { type: 'debugShuffle'; deckId: number }
  /**
   * restoreEarlier: go back to a WHOLE earlier snapshot of this game that the
   * host kept itself -- a demo stepping back one move. Run against the CURRENT
   * snapshot, and a restore in every sense a client sees
   * (`restoreEarlierSnapshot`): the restore epoch advances, so seats drop stale
   * element ids and reset their animation watermark. Only the host composes it
   * (`SnapshotSessionHost`'s demo); no client message maps to it.
   */
  | { type: 'restoreEarlier'; snapshot: unknown }
  | { type: 'startTutorial'; player: number }
  | { type: 'exitTutorial'; player: number }
  | { type: 'hint'; seat: number }
  | { type: 'heatmapToggle'; seat: number; visible: boolean }
  // botSuggest: read-only preview — runs MCTS and returns the suggested move WITHOUT
  // mutating the snapshot. Sent by the demo loop in SnapshotSessionHost.
  | { type: 'botSuggest'; seats: Array<{ seat: number; level?: string }> };

/**
 * The lifecycle ops `SnapshotSessionHost.handleOp` handles itself. They need
 * the host's broadcast adapter, its bot pump or a cancellable async lifetime,
 * none of which the stateless executor has, so `executeOp` does not accept
 * them.
 */
export type HostOp =
  | { type: 'demoStart'; delay?: number }
  | { type: 'demoStop' }
  // demoControl: live playback control for a running demo (pause/play/step one move/
  // step back one move) and speed (inter-move delay in ms).
  | { type: 'demoControl'; control: 'pause' | 'play' | 'step' | 'back'; delay?: number }
  /**
   * convertSeatToBot: a seat is now played by a bot.
   *
   * It exists so a conversion is an EVENT THE ENGINE ACKNOWLEDGES AND ACTS ON.
   * The host's bot pump reads the roster the platform last stated with
   * `SnapshotSessionHost.setBotSeats` on every iteration, but `setBotSeats`
   * does not wake the pump, so a table converted between moves would just sit
   * there. This op is the wake, and it refuses a seat the roster does not name.
   *
   * **It deliberately carries NO level, and must never grow one.** The roster is
   * the one statement of which seats a bot plays and how strongly: a seat's
   * level comes from the `setBotSeats` list, and a platform whose bots may act
   * only inside a window (a caretaker) states that by calling `setBotSeats`
   * again when the window changes. A `level` here would be a second statement
   * that could disagree with it. Set the level on the roster; this op says only
   * "the roster changed: acknowledge it and go".
   */
  | { type: 'convertSeatToBot'; seat: number };

/** Every op a `SnapshotSessionHost` accepts through `handleOp`. */
export type Op = ExecutorOp | DevOp | HostOp;

/**
 * The op of type `T`. Functions that answer each op with its own result take
 * their op as this rather than as a type parameter of the op itself, so `T` is
 * inferred from the op's `type` and an object literal is still checked for
 * fields its op does not declare.
 */
export type OpOfType<T extends Op['type']> = { [K in T]: Extract<Op, { type: K }> }[T];

/** The ops `executeOp` runs: every op except the host's own lifecycle ops. */
export type ExecutableOp = ExecutorOp | DevOp;

/** The op types that carry a player's intent, and therefore a boundary key. */
export type SubmissionOpType = Extract<ExecutorOp, BoundaryStamped>['type'];

/**
 * The submission op types, enumerated ONCE.
 *
 * The `Record<SubmissionOpType, true>` makes the enumeration exhaustive: adding
 * a `BoundaryStamped` member to `Op` without listing it here is a compile
 * error. It exists for CALLERS that stamp their own current key (the headless
 * driver); the engine's own staleness guard needs no list at all — it keys on
 * the presence of `boundaryKey`, so it cannot fall out of step with the union.
 */
const SUBMISSION_OP_TYPE_MAP: Record<SubmissionOpType, true> = {
  action: true,
  selectionStep: true,
  expireSeat: true,
};

/**
 * Whether `op` ends a seat's part of the open step, by its own action or by
 * the host closing it at a deadline. A host treats both the same way after the
 * op runs: the seat's half-made picks are dropped, its hint cleared, and the
 * bot seats asked whether the step is now theirs.
 */
export function closesSeat(op: Op): op is Extract<Op, { type: 'action' | 'expireSeat' }> {
  return op.type === 'action' || op.type === 'expireSeat';
}
export const SUBMISSION_OP_TYPES: ReadonlySet<Op['type']> = new Set(
  Object.keys(SUBMISSION_OP_TYPE_MAP) as SubmissionOpType[],
);

/** Every debug op: the op types whose name starts with `debug`. */
export type DebugOpType = Extract<Op['type'], `debug${string}`>;

/**
 * The debug ops, enumerated ONCE (#481). Each runs only when the host turns
 * debugging on (`executeOp`'s `hostOptions.debug`, `SnapshotSessionHost`'s
 * `debug` adapter). The `Record` makes the list exhaustive: an op named
 * `debug…` that is missing here is a compile error, so a new debug op cannot
 * slip past the gate.
 */
const DEBUG_OP_TYPE_MAP: Record<DebugOpType, true> = {
  debugHistory: true,
  debugStateAt: true,
  debugStateDiff: true,
  debugActionTraces: true,
  debugFlowState: true,
  debugRewind: true,
  debugReorder: true,
  debugTransfer: true,
  debugShuffle: true,
};
export const DEBUG_OP_TYPES: ReadonlySet<Op['type']> = new Set(Object.keys(DEBUG_OP_TYPE_MAP) as DebugOpType[]);

/**
 * The ops that report without changing the game: a choices query, the
 * read-only debug ops, and the demo's move preview. A host runs them without
 * applying, publishing or persisting anything.
 */
export type ReadOnlyOpType =
  | 'resolveChoices'
  | 'debugHistory'
  | 'debugStateAt'
  | 'debugStateDiff'
  | 'debugActionTraces'
  | 'debugFlowState'
  | 'botSuggest';

const READ_ONLY_OP_TYPE_MAP: Record<ReadOnlyOpType, true> = {
  resolveChoices: true,
  debugHistory: true,
  debugStateAt: true,
  debugStateDiff: true,
  debugActionTraces: true,
  debugFlowState: true,
  botSuggest: true,
};
export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set(Object.keys(READ_ONLY_OP_TYPE_MAP) as ReadOnlyOpType[]);

/** Whether `op` reports without changing the game ({@link ReadOnlyOpType}). */
export function isReadOnlyOp(op: Op): op is Extract<Op, { type: ReadOnlyOpType }> {
  return READ_ONLY_OP_TYPES.has(op.type);
}

// ---------------------------------------------------------------------------
// OpResult
// ---------------------------------------------------------------------------

/** Where a refusal came from: the game's own rules, the executor, or the op itself. */
export type OpFailureCategory = 'bundle' | 'executor' | 'protocol';

/**
 * Every refused op, whatever its type. A refusal changed nothing, so it
 * carries no state: the caller keeps the state it already holds.
 */
export interface OpFailure {
  success: false;
  error: string;
  /**
   * Structured error code. A failure forwarded from the runner or the pick
   * handler carries the code they gave (e.g. NOT_YOUR_TURN, ENGINE_ERROR,
   * CHOICES_EVALUATION_ERROR), and a code is never invented for one that gave
   * none. The engine's own protocol refusals carry their own code
   * (STALE_SUBMISSION).
   */
  errorCode?: ErrorCode;
  category: OpFailureCategory;
  /**
   * Set only by a refused `botTurn`: the bot seat whose move the game refused,
   * so a host can hold that seat back until the game changes instead of asking
   * it for the same move again (#421).
   */
  botPlayer?: number;
}

/**
 * The game after an op, on every op that runs the game (all but a choices
 * query). It holds the state ONCE: the flow state and the winners the game
 * declared are read out of `snapshot` (`snapshot.flowState`,
 * `snapshot.winners`, or `flowStateOf`/`isCompleteOf`/`winnersOf` from
 * `boardsmith/session-host`), never reported a second time beside it (#536).
 *
 * `playerViews` (indexed by seat - 1) and `spectatorView` are for the host to
 * publish. Neither is a reply to the seat that sent the op: a host shapes its
 * reply from the op's own fields.
 */
export interface StateEnvelope {
  snapshot: GameStateSnapshot;
  playerViews: unknown[];
  /**
   * Public observer view: seat 0, no hidden information, no action metadata.
   * The same `{ flowState, state }` shape as a player view.
   */
  spectatorView: unknown;
  /**
   * The flow position for the debug panel, computed once for every seat (the
   * same serializer the session broadcast and `debugFlowState` use).
   */
  flowDebugInfo: SerializedFlowDebugInfo;
  /**
   * What the game asked the host to store (#527): the values of its reserved
   * `persist` and `persistPrivate` root attributes, read off the game root
   * after the op. No view carries either. A host commits this at game over;
   * `readPersistCommit` (`boardsmith/persistence`) validates it.
   */
  persistCommit: PersistCommit;
}

/** What a move that may chain on returns to the seat that made it. */
interface MoveOutcome {
  /** The follow-up the action chained to, with its action's metadata. */
  followUp?: FollowUpOffer;
  /**
   * `ActionResult.data` from the action this op executed: the acting seat's
   * return value (BUG-017). Reaches only the caller of this op, never a view.
   */
  data?: Record<string, unknown>;
  /** `ActionResult.message` from the action this op executed (BUG-012). */
  message?: string;
}

/**
 * The fields each op returns on success, beside the {@link StateEnvelope} when
 * it has one ({@link OpSuccess}). One entry per op type: an op added to `Op`
 * without one here does not compile.
 */
export interface OpSuccessFields {
  start: Record<never, never>;
  action: MoveOutcome;
  /**
   * The host closed the seat, so no seat is the caller: there is no follow-up
   * to offer and no return value to hand back.
   */
  expireSeat: Record<never, never>;
  selectionStep: MoveOutcome & {
    /** The acting seat's half-made selection, or `null` once the action completed or was dropped. */
    pendingState: Record<string, unknown> | null;
    done?: boolean;
    nextChoices?: ChoiceWithRefs[];
    actionComplete?: boolean;
    /**
     * Structured, inspectable warnings carried up from the pick (e.g.
     * boardRefs()/display()/boardRef() throwing but recovering via a graceful
     * fallback). A warning never refuses the op — see WarningEntry.
     */
    warnings?: WarningEntry[];
  };
  resolveChoices: {
    choices?: ChoiceWithRefs[];
    validElements?: ValidElement[];
    multiSelect?: { min: number; max?: number };
    /**
     * The ordered-list bounds of the step this answered (#249, #480), resolved
     * against the selections already made. Absent on a step that is not an
     * ordered list.
     */
    orderedList?: { min: number; max?: number };
    warnings?: WarningEntry[];
  };
  cancelAction: Record<never, never>;
  undo: Record<never, never>;
  botTurn: {
    /** The bot seat that moved. */
    botPlayer?: number;
    /** Whether a bot seat moved. False when none was due, or one was due and stalled. */
    botMoved: boolean;
    /**
     * A bot seat that was due but could not move (#29). `botMoved` is false
     * both when no bot seat was due and when one could not act; this tells
     * the second apart, as a stalled seat a host should report. Present only
     * in the second case.
     */
    botStalled?: { seat: number; reason: string };
  };
  debugHistory: { actionHistory: HistoryEntry[] };
  debugStateAt: { historicalState: unknown };
  debugStateDiff: { diff: ElementDiff };
  debugActionTraces: { traces: unknown[]; flowContext: unknown };
  /** The asking seat's own pending action, beside the envelope's `flowDebugInfo`. */
  debugFlowState: { pendingAction?: SerializedPendingActionState };
  debugRewind: Record<never, never>;
  debugReorder: Record<never, never>;
  debugTransfer: Record<never, never>;
  debugShuffle: Record<never, never>;
  restoreEarlier: Record<never, never>;
  startTutorial: Record<never, never>;
  exitTutorial: Record<never, never>;
  /** The hint for one seat, which the host keeps as teaching state. */
  hint: { hintAnnotation: { seat: number; annotation: Annotation } };
  /** The heatmap for one seat, which the host keeps as teaching state. */
  heatmapToggle: { heatmapUpdate: { seat: number; visible: boolean; entries: HeatmapEntry[] } };
  /** The move a bot seat would make, previewed without making it. */
  botSuggest: { botPlayer: number; suggestedAction: string; suggestedArgs: Record<string, unknown> };
  demoStart: Record<never, never>;
  demoStop: Record<never, never>;
  demoControl: Record<never, never>;
  /**
   * The seat a `convertSeatToBot` op converted: the engine's ACKNOWLEDGEMENT
   * that it saw the conversion. An echo, not a record: the host stores
   * nothing about the conversion and the roster remains the adapter's.
   */
  convertSeatToBot: { convertedSeat: number };
}

/**
 * The ops whose success carries no {@link StateEnvelope}: a choices query
 * changes nothing and answers one seat (#450), and the host's lifecycle ops
 * publish through the host itself.
 */
type StatelessOpType = 'resolveChoices' | HostOp['type'];

/**
 * What every success shares. `error` and `errorCode` are named only to say they
 * are absent, so `result.error` reads as `undefined` on a success without
 * narrowing first.
 */
interface Succeeded {
  success: true;
  error?: undefined;
  errorCode?: undefined;
}

/** A successful `T` op: its own fields, and the game when the op runs it. */
export type OpSuccess<T extends Op['type']> = T extends Op['type']
  ? Succeeded & (T extends StatelessOpType ? Record<never, never> : StateEnvelope) & OpSuccessFields[T]
  : never;

/** What a `T` op answers: its success, or the shared refusal. */
export type OpResultFor<T extends Op['type']> = OpSuccess<T> | OpFailure;

/** What any op answers. Narrow it by the op that was sent with {@link OpResultFor}. */
export type OpResult = { [T in Op['type']]: OpResultFor<T> }[Op['type']];

/** What the `debugStateDiff` op answers: the elements that changed between two action indices. */
export interface ElementDiff extends ElementChanges {
  /** The from action index */
  fromIndex: number;
  /** The to action index */
  toIndex: number;
}

// ---------------------------------------------------------------------------
// GameDefinitionLike
// ---------------------------------------------------------------------------

export interface GameDefinitionLike {
  /**
   * The author's game class, typed exactly as {@link GameDefinition.gameClass}
   * so a real game class is assignable with no cast (#138). The previous
   * `new (...args: unknown[]) => unknown` was satisfied by NO game class at
   * all — `unknown[]` is not assignable to a constructor's `GameOptions`
   * parameter — so every call site erased the class with an assertion, which
   * is the one thing this field exists to prevent.
   */
  gameClass: GameClass;
  gameType: string;
  /**
   * The TABLE's seat range, optional for the same reason it is optional on
   * {@link GameDefinition}: a world game has no table roster. Every op in this
   * module runs a table, so a caller that reaches one has already established
   * the counts exist.
   */
  minPlayers?: number;
  maxPlayers?: number;
  /**
   * Optional tutorial definition — threaded un-serialized into each runner
   * this module builds (`handleStart`, `runnerFromSnapshot`, `runnerFromCheckpoint`).
   * When present, `buildPlayerState` emits `hasTutorial: true` in every broadcast.
   */
  tutorial?: TutorialDefinition;
  /**
   * Optional bot configuration — passed to `createBot` by EVERY op that builds a
   * bot: botTurn, botSuggest, hint, and heatmapToggle. Provides the MCTS hooks
   * (`objectives`, `moveOrdering`, `playoutPolicy`, `threatResponseMoves`,
   * `uctConstant`) plus `hintTargetFromMove` for per-game board-highlight
   * extraction. A bot built without it searches with generic defaults, so any op
   * that skips it plays a materially different (and worse) game than the one the
   * game author configured. When absent entirely, hint/heatmap ops return a
   * protocol error (fail-loud: no bot config → no hint available).
   */
  bot?: import('../bot/types.js').BotStrategy;
  /**
   * Optional per-action undo checkpoint retention policy — threaded into EVERY
   * runner this module builds (fresh, restored, and checkpoint-restored alike).
   * It is declared on the game definition rather than carried in the snapshot
   * precisely because every stateless op rebuilds its runner from scratch: a
   * policy that lived in the snapshot could be silently lost by any op that
   * forgot to copy it forward, and the game would revert to retaining one full
   * element-tree copy per action for the rest of its life. Absent: retain
   * everything (the default).
   */
  checkpoints?: CheckpointPolicy;
  /**
   * Optional undo policy — read off the runner by `decideUndo`, the one undo
   * rule `handleUndo` and every seat's `canUndo` share. Declared on the game definition (never carried in the
   * snapshot) for the same reason as `checkpoints`: every stateless op rebuilds
   * its runner, and a policy living in the snapshot could be dropped by any op
   * that forgot to copy it forward. Absent: no random fence (the default).
   */
  undo?: UndoPolicy;
}

/**
 * A game definition with this op's HOST session policy resolved onto it.
 *
 * `executeOp` builds one on every call and hands it to every handler, so the
 * three runner-construction sites in this module (`handleStart`,
 * `runnerFromSnapshot`, `runnerFromCheckpoint`) can read the policy without
 * threading an extra parameter through twenty handler signatures — the kind of
 * plumbing where one missed call site silently re-allows randomness.
 *
 * `randomness` is REQUIRED and is written unconditionally from `hostOptions`,
 * so a published bundle cannot declare it (or smuggle a value through) — the
 * host is the only authority on whether a session may draw.
 */
type RunnerDef = GameDefinitionLike & { readonly randomness: RandomnessPolicy };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type BotFlowState = {
  awaitingInput?: boolean;
  complete?: boolean;
  currentPlayer?: number;
  moveCount?: number;
  awaitingPlayers?: Array<{
    playerIndex: number;
    completed: boolean;
    availableActions: string[];
  }>;
};

function buildViews(runner: GameRunner, playerCount: number): unknown[] {
  const flowState = runner.getFlowState();
  return Array.from({ length: playerCount }, (_, i) => ({
    flowState: toPublicFlowState(flowState),
    state: buildPlayerState(runner, [], i + 1, { includeActionMetadata: true }),
  }));
}

// Public observer view. Position 0 is the spectator sentinel (see utils.ts:418):
// no player has seat 0, so only mode:'all' elements are visible — mode:'owner'/
// 'hidden' element contents are omitted. includeActionMetadata:false ensures
// spectators receive no action prompts. Built from `runner` (the caller's
// current runner, whether freshly constructed by `handleStart` or restored via
// `runnerFromSnapshot`/`GameRunner.fromSnapshot`) — zone visibility now
// round-trips through serialization (SEC-01/F1/F7: `Space.toJSON`/
// `_restoreZoneVisibility`), so both cases redact identically.
function buildSpectatorView(runner: GameRunner): unknown {
  return {
    flowState: toPublicFlowState(runner.getFlowState()),
    state: buildPlayerState(runner, [], 0, { includeActionMetadata: false }),
  };
}

function stateEnvelope(runner: GameRunner, playerCount: number): StateEnvelope {
  // getSnapshot() records the op's checkpoint, so it runs before any view is
  // built: each view's canUndo reads the settled checkpoint window (#385).
  const snapshot = runner.getSnapshot();
  return {
    snapshot,
    playerViews: buildViews(runner, playerCount),
    spectatorView: buildSpectatorView(runner),
    // Computed once for every seat.
    // SnapshotSessionHost merges this into every per-seat view's `state`
    // alongside its own per-seat pendingAction lookup (see
    // SnapshotSessionHost.mergeTransientState / lastFlowDebugInfo).
    flowDebugInfo: serializeFlowDebugInfo(runner.game),
    persistCommit: persistCommitOf(snapshot),
  };
}

/**
 * The reserved commit attributes of the game `snapshot` holds, as the game
 * set them. Read from the snapshot's own serialization of the game root, the
 * one place both channels live, so the commit is the game's and no view's.
 */
function persistCommitOf(snapshot: GameStateSnapshot): PersistCommit {
  const attributes = snapshot.state.attributes;
  const commit: PersistCommit = {};
  if (attributes[PERSIST_KEY] !== undefined) commit.public = attributes[PERSIST_KEY];
  if (attributes[PERSIST_PRIVATE_KEY] !== undefined) commit.private = attributes[PERSIST_PRIVATE_KEY];
  return commit;
}

function errorResult(
  error: unknown,
  category: OpFailureCategory = 'bundle',
  errorCode?: ErrorCode,
): OpFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
    ...(errorCode === undefined ? {} : { errorCode }),
    category,
  };
}

/**
 * The refusal for a debug op that may not run, or null when it may (#481).
 * Every host asks this one question, so they cannot disagree about the answer.
 *
 * @param debug - whether the host turned debugging on for this session
 * @param askingSeat - the seat that sent the op, when the caller knows it. A
 *   debug op that reports a seat's view (it names a `player`) is refused unless
 *   that `player` is the asking seat, so no seat can read another seat's view.
 */
export function debugOpRefusal(op: Op, debug: boolean, askingSeat?: number): OpFailure | null {
  if (!DEBUG_OP_TYPES.has(op.type)) return null;
  if (!debug) return errorResult(debuggingOffMessage(op.type), 'protocol');
  if (askingSeat !== undefined && 'player' in op && op.player !== askingSeat) {
    return errorResult(
      `Seat ${askingSeat} asked for seat ${op.player}'s view with '${op.type}', and was refused. ` +
        'A debug view shows only the seat that asks for it; switch to that seat to see its view.',
      'protocol',
    );
  }
  return null;
}

/**
 * The refusal a stale submission gets. Specification:
 * `docs/simultaneous-and-interrupt-semantics.md` §3.
 *
 * It names what happened and what to do, and nothing else — no frame path, no
 * file, no internal identifier (T-68-14). And it leaves the seat a way forward:
 * after this refusal the seat can still act in the CURRENT round.
 */
export const STALE_SUBMISSION_MESSAGE =
  'The round you acted in has closed; reload to see the current round.';

/**
 * The ONE staleness comparison in the codebase.
 *
 * Keyed on the PRESENCE of `boundaryKey` rather than on a list of op types, so
 * an op that is later given a boundary key is guarded the moment it has one:
 * a token-bearing op that bypasses this guard is not expressible. Two
 * comparison sites would be the duplicate-enforcement shape the motto forbids.
 *
 * Returns a refusal, or `undefined` to mean "carry on to the checks that
 * already existed". Those are its only two outcomes — it can narrow what is
 * permitted and can never widen it.
 */
function refuseStaleSubmission(snapshot: GameStateSnapshot | null, op: ExecutableOp): OpFailure | undefined {
  if (!('boundaryKey' in op)) return undefined;
  // Equality against the key this very snapshot's flow position mints. No
  // parsing, no structural tolerance, and no default for an absent or
  // wrong-typed value: anything that is not equal is stale.
  if (op.boundaryKey === flowBoundaryKey(snapshot?.flowState as BoundaryKeyState | undefined)) return undefined;
  // The engine's own outcome, with its own code (#535): a stale refusal is
  // normal (the round resolved without this seat), and a host must tell it
  // apart from every other refusal without reading the message.
  return errorResult(STALE_SUBMISSION_MESSAGE, 'protocol', ErrorCode.STALE_SUBMISSION);
}

function selectDueBotSeat(
  flowState: BotFlowState,
  botSeats: Set<number>,
): number | undefined {
  return dueSeats(flowState).find(seat => botSeats.has(seat));
}

// ---------------------------------------------------------------------------
// Op handlers
// ---------------------------------------------------------------------------

function handleStart(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  seedSnapshot?: GameStateSnapshot,
): OpResultFor<'start'> {
  // A new game mints its own element id key (#447). The only key a start op
  // could carry is one a client wrote into the host's options, and a client
  // that chooses the key can decode every id it is sent; a host restoring a
  // game it holds passes the snapshot, whose gameOptions carry the key.
  if (gameOptions.elementIdKey !== undefined) {
    return errorResult(
      'A start op cannot carry gameOptions.elementIdKey: the engine mints a new game\'s element id ' +
        'key itself, and a key chosen outside the engine would let whoever chose it decode every ' +
        'element id. Remove it from the start options; to resume a saved game, pass its snapshot.',
      'protocol',
    );
  }

  // Seed plug-in point (FEAT-01/168-02): when a seed snapshot rides in via
  // hostOptions (NEVER gameOptions — same WR-04/D-01 rationale as
  // teachingDisabled: gameOptions persists into snapshot.gameOptions and
  // would leak this transient host directive into game state), the first
  // started state IS the seed's state — restored via the SAME
  // runnerFromSnapshot + stateEnvelope primitives every other op uses, not
  // a rebuilt load path. No seed => unchanged fresh-start behavior below.
  //
  // Every start is a NEW game, a start from the same saved position included,
  // so the seed's own `gameInstanceId` is not adopted: each restart from it
  // would otherwise be published as the game it replaced (#356).
  if (seedSnapshot) {
    const { gameInstanceId: _seedsGame, ...position } = seedSnapshot;
    return {
      success: true,
      ...stateEnvelope(runnerFromSnapshot(position, def), gameOptions.playerCount),
    };
  }

  // Thread tutorial definition un-serialized.
  // The game constructor strips `tutorial` from _constructorOptions so it is not
  // persisted in the snapshot; runnerFromSnapshot re-supplies it on restore.
  const effectiveOptions = def.tutorial
    ? { ...gameOptions, tutorial: def.tutorial }
    : gameOptions;
  const runner = new GameRunner({
    GameClass: def.gameClass,
    gameType: def.gameType,
    gameOptions: effectiveOptions,
    checkpoints: def.checkpoints,
    randomness: def.randomness,
    undo: def.undo,
  });

  runner.start();

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
  };
}

/** Advance the tutorial of every seat whose tutorial is running. */
function advanceRunningTutorials(game: Game): void {
  for (const [seat, progress] of game.tutorialProgress) {
    if (progress.status === 'running') {
      autoAdvanceTutorial(game, seat);
    }
  }
}

function handleAction(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'action' }>,
): OpResultFor<'action'> {
  const runner = runnerFromSnapshot(snapshot, def);
  const actionResult = runner.performAction(op.actionName, op.player, op.args);

  if (!actionResult.success) {
    return errorResult(actionResult.error ?? 'Action failed', 'bundle', actionResult.errorCode);
  }

  // This is the CR-01 fix: stateless-ops was the only non-test path missing this pump.
  const game = runner.game as Game;
  advanceRunningTutorials(game);

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    followUp: offerFollowUp(game, actionResult.flowState, op.player),
    // The acting seat's return value from execute() (BUG-017/BUG-012).
    data: actionResult.data,
    message: actionResult.message,
  };
}

/**
 * The host's deadline close of one seat: the idle action as the seat's own
 * action when the step offers it, else the held seat's expiry. The result carries the
 * state envelope only: the host is the caller, not a seat, so there is no
 * follow-up to offer and no return value to hand back.
 */
function handleExpireSeat(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'expireSeat' }>,
): OpResultFor<'expireSeat'> {
  const runner = runnerFromSnapshot(snapshot, def);
  const expired = runner.closeExpiredHeldSeat(op.player, op.idleAction);
  if (!expired) {
    const actionResult = runner.performAction(op.idleAction, op.player, op.args);
    if (!actionResult.success) {
      return errorResult(actionResult.error ?? 'Idle action failed', 'bundle', actionResult.errorCode);
    }
  }

  advanceRunningTutorials(runner.game as Game);
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}

async function handleSelectionStep(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  pendingState: Record<string, unknown> | null,
  op: Extract<Op, { type: 'selectionStep' }>,
): Promise<OpResultFor<'selectionStep'>> {
  const runner = runnerFromSnapshot(snapshot, def);

  const handler = new PickHandler(runner, gameOptions.playerCount);
  const step = await handler.processSelectionStep(
    op.player,
    op.selectionName,
    op.value,
    op.actionName,
    op.initialArgs,
    pendingState,
  );

  if (!step.success) {
    return errorResult(step.error ?? 'Selection step failed', 'bundle', step.errorCode);
  }

  // Fired after every selection step (not just actionComplete) so predicates
  // that depend on mid-action state still evaluate correctly.
  advanceRunningTutorials(runner.game as Game);

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    pendingState: step.pendingState,
    done: step.done,
    nextChoices: step.nextChoices,
    actionComplete: step.actionComplete,
    followUp: step.followUp,
    warnings: step.warnings,
    // Present only on the step that completes the action (BUG-017/BUG-012).
    data: step.data,
    message: step.message,
  };
}

function handleResolveChoices(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'resolveChoices' }>,
): OpResultFor<'resolveChoices'> {
  const runner = runnerFromSnapshot(snapshot, def);

  const handler = new PickHandler(runner, gameOptions.playerCount);
  const result = handler.getPickChoices(op.actionName, op.selectionName, op.player, op.args);

  if (!result.success) {
    return errorResult(result.error ?? 'Failed to resolve choices', 'bundle', result.errorCode);
  }

  // The answer and nothing else (#450): this result goes to the ONE seat that
  // asked, and every host used to pass it through whole -- the unredacted
  // snapshot and every seat's view with it. A query changes no state, so it
  // has none to report.
  return {
    success: true,
    choices: result.choices,
    validElements: result.validElements,
    multiSelect: result.multiSelect,
    orderedList: result.orderedList,
    warnings: result.warnings,
  };
}

function handleCancelAction(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  pendingState: Record<string, unknown> | null,
  op: Extract<Op, { type: 'cancelAction' }>,
): OpResultFor<'cancelAction'> {
  const runner = runnerFromSnapshot(snapshot, def);

  const handler = new PickHandler(runner, gameOptions.playerCount);
  handler.cancelPendingAction(op.player, pendingState);

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
  };
}

function handleUndo(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'undo' }>,
): OpResultFor<'undo'> {
  const runner = runnerFromSnapshot(snapshot, def);

  // Validate player seat (1-indexed).
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(
      `Invalid player: ${op.player}. Player seats are 1-indexed (1 to ${gameOptions.playerCount}).`,
      'protocol',
      ErrorCode.INVALID_PLAYER,
    );
  }

  // The one undo rule (#373), shared with the `canUndo` every seat is sent, so the
  // offer and this decision cannot disagree. It is also the server-side
  // enforcement (UNDO-01/UNDO-02): the client's `canUndo` is never trusted.
  const decision = decideUndo(runner, op.player);
  if (!decision.allowed) {
    const category = decision.errorCode === ErrorCode.UNDO_NOT_ALLOWED ? 'executor' : 'bundle';
    return errorResult(decision.error, category, decision.errorCode);
  }

  // Restore the turn-start state AUTHORITATIVELY from the per-action checkpoint
  // captured at that action count — NOT by replaying actionHistory. Replay
  // re-runs `start()` + recorded actions, which never re-applies pending/
  // selection mutations (Piece.putInto, recorded in neither command nor action
  // history); it loses prior-turn equipment and mis-positions the flow (a later
  // action by another player then throws "Not Player N's turn"). The checkpoint
  // is the exact serialized state at the turn boundary, so restoring it keeps
  // every prior mutation and the correct flow position. fromCheckpoint
  // rehydrates the lean checkpoint and carries the prefix
  // `[0..turnStartActionIndex]` forward so further undos still resolve.
  const restored = runnerFromCheckpoint(def, snapshot, decision.turnStartActionIndex);
  if (!restored) {
    throw new Error(
      'Undo was allowed but no checkpoint exists at the start of this turn. ' +
      `decideUndo checks for that checkpoint, so this is a BoardSmith bug; please report it.`,
    );
  }

  return {
    success: true,
    ...stateEnvelope(restored, gameOptions.playerCount),
  };
}

async function handleBotTurn(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'botTurn' }>,
): Promise<OpResultFor<'botTurn'>> {
  const runner = runnerFromSnapshot(snapshot, def);

  const flowState = runner.getFlowState() as BotFlowState | undefined;

  const notDue: OpSuccess<'botTurn'> = {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    botMoved: false,
  };

  if (!flowState?.awaitingInput || flowState.complete) {
    return notDue;
  }

  const botPlayer = selectDueBotSeat(flowState, new Set(op.seats.map((s) => s.seat)));
  if (botPlayer === undefined) {
    return notDue;
  }

  const seatLevel = op.seats.find((s) => s.seat === botPlayer)?.level;
  // `def.bot` MUST be threaded through — it carries the game's MCTS hooks
  // (objectives, moveOrdering, playoutPolicy, threatResponseMoves, uctConstant).
  // Omitting it silently downgrades every bot turn to a hookless generic search
  // that treats concede-style actions (resign / offer draw) as ordinary moves and,
  // at low iteration budgets, picks them — chess bots resigned on move one.
  // handleHint already passes it; this is the same bot, so it gets the same config.
  const bot = createBot(
    runner.game as Game,
    def.gameClass,
    def.gameType,
    botPlayer,
    runner.actionHistory,
    parseBotLevel(seatLevel ?? 'medium'),
    def.bot,
  );

  // #29: this used to be an unguarded `await bot.play()` whose throw escaped
  // executeOp entirely — the dev host logged it, the covered seat never acted,
  // and a simultaneousActionStep could not close its round, so the whole table
  // waited forever. Bot cover is not opt-in (a page reload in dev is a
  // disconnect), so a hidden-information game reached this in ordinary
  // playtesting with no bot flag anywhere.
  //
  // Both outcomes are now this seat's problem alone: `null` means the bot found
  // nothing it could search from its own redacted view, and a throw means the
  // bot itself is broken. Either way the seat is reported as not due, which
  // stalls one seat instead of locking the session.
  let move: BotMove | null;
  try {
    move = await bot.play();
  } catch (error) {
    console.error(`[BoardSmith] Bot for seat ${botPlayer} failed to choose a move:`, error);
    return { ...notDue, botStalled: { seat: botPlayer, reason: 'The bot failed while choosing a move.' } };
  }
  if (!move) {
    return {
      ...notDue,
      botStalled: {
        seat: botPlayer,
        reason: bot.lastStallReason ?? 'The bot had no move it could search from this seat\'s view.',
      },
    };
  }

  const actionResult = runner.performAction(move.action, botPlayer, move.args);

  if (!actionResult.success) {
    // Names the seat, so a driver can hold that seat back until the game
    // changes instead of asking it for the same refused move again (#421).
    return {
      ...errorResult(actionResult.error ?? 'bot action failed', 'bundle', actionResult.errorCode),
      botPlayer,
    };
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    botMoved: true,
    botPlayer,
  };
}

// ---------------------------------------------------------------------------
// Teaching op handlers (hint / heatmapToggle)
// ---------------------------------------------------------------------------

/** Fallback destination argument names — checked when hintTargetFromMove is absent. */
const DEST_ARGS = ['to', 'destination', 'target', 'square', 'cell', 'position'] as const;

async function handleHint(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'hint' }>,
  teachingDisabled: boolean,
): Promise<OpResultFor<'hint'>> {
  // Fail-loud: teaching features locked out by the host (via hostOptions —
  // deliberately NOT gameOptions, see WR-04/D-01 on executeOp).
  if (teachingDisabled) {
    return errorResult('Teaching features are disabled for this session.', 'protocol');
  }
  // Fail-loud: no bot config means hint is impossible.
  if (!def.bot?.objectives) {
    return errorResult('No bot configuration on this game — hint is unavailable.', 'protocol');
  }
  // Fail-loud: seat out of range.
  if (op.seat < 1 || op.seat > gameOptions.playerCount) {
    return errorResult(
      `Invalid seat ${op.seat}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }

  const runner = runnerFromSnapshot(snapshot, def);
  const flowState = runner.getFlowState() as BotFlowState;

  // Fail-loud: seat not awaiting input (per-spec: hint only when the seat can act).
  if (!canSeatAct(flowState as unknown as FlowState, op.seat)) {
    return errorResult(`Cannot hint: seat ${op.seat} is not awaiting input`, 'protocol');
  }

  const bot = createBot(
    runner.game as Game,
    def.gameClass,
    def.gameType,
    op.seat,
    runner.actionHistory,
    parseBotLevel('medium'),
    def.bot,
  );

  const move = await bot.play();
  if (!move) {
    // Nothing searchable from this seat's own view (#29) — there is no hint to
    // give, and saying so beats highlighting an arbitrary square.
    return errorResult(
      bot.lastStallReason ?? 'No hint is available: the bot found no move it could evaluate from this seat\'s view.',
      'bundle',
    );
  }

  // Extract the board highlight target: hintTargetFromMove first, then DEST_ARGS fallback.
  let target: import('../engine/index.js').ElementRef | undefined;
  if (def.bot.hintTargetFromMove) {
    target = def.bot.hintTargetFromMove(move);
  } else {
    for (const key of DEST_ARGS) {
      const val = (move.args as Record<string, unknown>)[key];
      if (typeof val === 'number') { target = { id: val }; break; }
      if (typeof val === 'string') { target = { notation: val }; break; }
    }
  }

  const annotation: Annotation = {
    text: describeMoveForHint(move.args as Record<string, unknown>),
    ...(target ? { target: { kind: 'element' as const, ref: target } } : {}),
  };

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    hintAnnotation: { seat: op.seat, annotation },
  };
}

async function handleHeatmapToggle(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'heatmapToggle' }>,
  teachingDisabled: boolean,
): Promise<OpResultFor<'heatmapToggle'>> {
  // Fail-loud: teaching features locked out by the host (via hostOptions —
  // deliberately NOT gameOptions, see WR-04/D-01 on executeOp).
  if (teachingDisabled) {
    return errorResult('Teaching features are disabled for this session.', 'protocol');
  }

  const runner = runnerFromSnapshot(snapshot, def);

  // WR-02: validate seat range before the visible=false short-circuit so that
  // out-of-range seats (e.g. seat:0 or seat:99) fail-loud on BOTH paths,
  // matching the visible=true validation contract (CLAUDE.md fail-fast rule).
  if (op.seat < 1 || op.seat > gameOptions.playerCount) {
    return errorResult(
      `Invalid seat ${op.seat}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }

  // visible=false short-circuit: clear heatmap entries without running the bot
  // (no MCTS needed to hide the overlay).
  if (!op.visible) {
    return {
      success: true,
      ...stateEnvelope(runner, gameOptions.playerCount),
      heatmapUpdate: { seat: op.seat, visible: false, entries: [] },
    };
  }

  // visible=true: compute heatmap entries via bot.playWithStats().
  // Fail-loud: no bot config means heatmap is impossible.
  if (!def.bot?.objectives) {
    return errorResult('No bot configuration on this game — heatmap is unavailable.', 'protocol');
  }

  const flowState = runner.getFlowState() as BotFlowState;
  if (!canSeatAct(flowState as unknown as FlowState, op.seat)) {
    return errorResult(`Cannot show heatmap: seat ${op.seat} is not awaiting input`, 'protocol');
  }

  const bot = createBot(
    runner.game as Game,
    def.gameClass,
    def.gameType,
    op.seat,
    runner.actionHistory,
    parseBotLevel('medium'),
    def.bot,
  );

  const { stats } = await bot.playWithStats();

  // Deduplicate by cell key.
  // Keep the highest normalizedValue per cell key; mark exactly one isBest=true.
  const byCell = new Map<string, HeatmapEntry>();
  for (const stat of stats) {
    // Extract the cell ref from the move using the same priority chain as hint.
    let ref: import('../engine/index.js').ElementRef | undefined;
    if (def.bot.hintTargetFromMove) {
      ref = def.bot.hintTargetFromMove(stat.move);
    } else {
      for (const key of DEST_ARGS) {
        const val = (stat.move.args as Record<string, unknown>)[key];
        if (typeof val === 'number') { ref = { id: val }; break; }
        if (typeof val === 'string') { ref = { notation: val }; break; }
      }
    }
    if (!ref) continue;
    const cellKey = ref.id !== undefined ? `id:${ref.id}`
      : ref.notation !== undefined ? `notation:${ref.notation}`
      : `name:${(ref as { name?: string }).name}`;
    const existing = byCell.get(cellKey);
    if (!existing || stat.value > existing.normalizedValue) {
      byCell.set(cellKey, { cellRef: ref, normalizedValue: stat.value, isBest: false });
    }
  }
  const entries = [...byCell.values()];
  if (entries.length > 0) {
    const best = entries.reduce((a, b) => a.normalizedValue > b.normalizedValue ? a : b);
    best.isBest = true;
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    heatmapUpdate: { seat: op.seat, visible: true, entries },
  };
}

// ---------------------------------------------------------------------------
// botSuggest op handler (read-only preview)
// ---------------------------------------------------------------------------

/**
 * Start a tutorial for `op.player`: apply the tutorial's setup, put the flow
 * back at its beginning (#546), activate the first step and run the
 * auto-advance pump. Refused, with the game left as it was, when the restarted
 * flow would not prompt the learner: a tutorial the learner cannot act in is a
 * dead table.
 */
function handleStartTutorial(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'startTutorial' }>,
  teachingDisabled: boolean,
): OpResultFor<'startTutorial'> {
  // Fail-loud: teaching features locked out by the host (via hostOptions,
  // deliberately NOT gameOptions, see WR-04/D-01 on executeOp).
  if (teachingDisabled) {
    return errorResult('Teaching features are disabled for this session.', 'protocol');
  }
  if (!def.tutorial) {
    return errorResult('No tutorial definition on this game.', 'protocol');
  }
  // WR-01: validate seat range before touching any state, as handleDebugActionTraces does.
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(
      `Invalid player seat ${op.player}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }
  // IN-01: validate definition BEFORE constructing the runner (fail-loud before expensive work).
  validateTutorialDefinition(def.tutorial);
  const runner = runnerFromSnapshot(snapshot, def);
  // R-01: apply the tutorial's setup callback before setting initial progress so
  // the board is in the deterministic tutorial position before any advanceWhen
  // predicates fire. setup is optional; games without a preset omit it.
  def.tutorial.setup?.(runner.game as Game);
  // #546: a tutorial begins on the learner's turn, so hand the turn back
  // to the flow's first seat. This runs none of the game's opening again.
  runner.game.restartFlowForTutorial();
  // A refusal discards this runner, so the caller's snapshot is untouched.
  const due = dueSeats(runner.getFlowState());
  if (!due.includes(op.player)) {
    const toMove = due.length > 0 ? `seat ${due.join(', ')} is` : 'no seat is';
    return errorResult(
      `The tutorial cannot start for seat ${op.player}: it opens at the start of the game, where ` +
        `${toMove} to move, not seat ${op.player}. Start the tutorial from the seat that moves first.`,
      'protocol',
    );
  }
  runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
  // CR-01: pump auto-advance immediately after setting initial progress so steps
  // with always-true advanceWhen predicates (e.g. capture-tip) advance before
  // the learner's first action, matching the simulate-tutorial parity invariant.
  autoAdvanceTutorial(runner.game as Game, op.player);
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}

/**
 * Run MCTS to preview the move a bot seat would make WITHOUT mutating the
 * snapshot. The demo loop calls this to narrate the move before executing it
 * via the existing `action` op — never re-running MCTS for the execute step
 * (which would risk a narrate/execute mismatch if MCTS is non-deterministic).
 *
 * Mirrors handleBotTurn's bot construction but stops short of performAction.
 * Returns the snapshot unchanged; only `suggestedAction`, `suggestedArgs`,
 * and `botPlayer` are set beyond the standard stateEnvelope fields.
 */
async function handleBotSuggest(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'botSuggest' }>,
): Promise<OpResultFor<'botSuggest'>> {
  // Fail-loud: no bot config means suggestion is impossible.
  if (!def.bot?.objectives) {
    return errorResult('No bot configuration on this game — botSuggest is unavailable.', 'protocol');
  }

  const runner = runnerFromSnapshot(snapshot, def);
  const flowState = runner.getFlowState() as BotFlowState | undefined;

  // Find the seat currently awaiting input among the given seats.
  const botSeatSet = new Set(op.seats.map((s) => s.seat));
  const botPlayer = selectDueBotSeat(flowState ?? {}, botSeatSet);
  if (botPlayer === undefined) {
    return errorResult(
      'No seat among the given seats is currently awaiting input.',
      'protocol',
    );
  }

  const seatLevel = op.seats.find((s) => s.seat === botPlayer)?.level;
  const bot = createBot(
    runner.game as Game,
    def.gameClass,
    def.gameType,
    botPlayer,
    runner.actionHistory,
    parseBotLevel(seatLevel ?? 'medium'),
    def.bot,
  );

  const move = await bot.play();
  if (!move) {
    // The demo has nothing to show for this seat (#29).
    return errorResult(
      bot.lastStallReason ?? 'The demo bot found no move it could evaluate from this seat\'s view.',
      'bundle',
    );
  }

  // Return the preview — snapshot is NOT mutated (read-only, per READ_ONLY_OP_TYPES).
  // Per RESEARCH Pitfall 8: the stateEnvelope playerViews are discarded by the demo
  // loop (it reads only botPlayer/suggestedAction/suggestedArgs). Acceptable for Phase 110.
  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    botPlayer,
    suggestedAction: move.action,
    suggestedArgs: move.args as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Debug op handlers
// ---------------------------------------------------------------------------

/**
 * Reconstruct the runner at a historical action index AUTHORITATIVELY from the
 * snapshot's per-action checkpoints — never by replay. `actionCheckpoints[k]` is
 * the exact serialized state when k actions had been recorded (the same data the
 * undo op restores from), so time-travel and rewind preserve every prior
 * mutation instead of re-deriving them. Returns null if the checkpoint is absent.
 */
function runnerFromCheckpoint(
  def: RunnerDef,
  snap: GameStateSnapshot,
  actionIndex: number,
): GameRunner | null {
  // Carry checkpoints up to and including the restore point so a later getSnapshot
  // keeps the linear history coherent (mirrors the undo op).
  const runner = GameRunner.fromCheckpoint(snap, actionIndex, def.gameClass, {
    checkpoints: def.checkpoints,
    randomness: def.randomness,
    undo: def.undo,
  });
  if (runner && def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  return runner;
}

function handleRestoreEarlier(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'restoreEarlier' }>,
): OpResultFor<'restoreEarlier'> {
  const runner = restoreEarlierSnapshot(snapshot, op.snapshot as GameStateSnapshot, def.gameClass, {
    checkpoints: def.checkpoints,
    randomness: def.randomness,
    undo: def.undo,
  });
  if (def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}

function handleDebugHistory(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
): OpResultFor<'debugHistory'> {
  const runner = runnerFromSnapshot(snapshot, def);
  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    actionHistory: [...runner.actionHistory],
  };
}

function handleDebugStateAt(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'debugStateAt' }>,
): OpResultFor<'debugStateAt'> {
  const current = runnerFromSnapshot(snapshot, def);
  const historyLength = current.actionHistory.length;
  if (op.actionIndex < 0 || op.actionIndex > historyLength) {
    return errorResult(
      `Invalid action index: ${op.actionIndex}. History has ${historyLength} actions.`,
      'protocol',
    );
  }
  const at = runnerFromCheckpoint(def, snapshot, op.actionIndex);
  if (!at) {
    return errorResult(`No checkpoint at action index ${op.actionIndex}.`, 'executor');
  }
  return {
    success: true,
    ...stateEnvelope(current, gameOptions.playerCount),
    historicalState: buildPlayerState(at, [], op.player, { includeActionMetadata: false }),
  };
}

function handleDebugStateDiff(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'debugStateDiff' }>,
): OpResultFor<'debugStateDiff'> {
  const current = runnerFromSnapshot(snapshot, def);
  const historyLength = current.actionHistory.length;
  if (op.fromIndex < 0 || op.fromIndex > historyLength) {
    return errorResult(`Invalid fromIndex: ${op.fromIndex}`, 'protocol');
  }
  if (op.toIndex < 0 || op.toIndex > historyLength) {
    return errorResult(`Invalid toIndex: ${op.toIndex}`, 'protocol');
  }
  const fromRunner = runnerFromCheckpoint(def, snapshot, op.fromIndex);
  const toRunner = runnerFromCheckpoint(def, snapshot, op.toIndex);
  if (!fromRunner || !toRunner) {
    return errorResult('Missing checkpoint for state diff.', 'executor');
  }
  const fromView = buildPlayerState(fromRunner, [], op.player, { includeActionMetadata: false }).view;
  const toView = buildPlayerState(toRunner, [], op.player, { includeActionMetadata: false }).view;

  const { added, removed, changed } = computeElementDiff(fromView, toView);

  return {
    success: true,
    ...stateEnvelope(current, gameOptions.playerCount),
    diff: { added, removed, changed, fromIndex: op.fromIndex, toIndex: op.toIndex },
  };
}

function handleDebugActionTraces(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'debugActionTraces' }>,
): OpResultFor<'debugActionTraces'> {
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(`Invalid player seat: ${op.player}.`, 'protocol');
  }
  const runner = runnerFromSnapshot(snapshot, def);
  const traces = buildActionTraces(runner, op.player);

  const flowState = runner.getFlowState();

  // Canonical seat-activity predicates collapse the simultaneous/sequential
  // split: a seat that cannot act has no flow-allowed actions.
  const isMyTurn = canSeatAct(flowState, op.player);
  const flowAllowedActions = availableActionsForSeat(flowState, op.player);

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    traces,
    flowContext: {
      flowAllowedActions,
      currentPlayer: flowState?.currentPlayer,
      isMyTurn,
      currentPhase: flowState?.currentPhase,
    },
  };
}

function handleDebugFlowState(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  pendingState: Record<string, unknown> | null,
  op: Extract<Op, { type: 'debugFlowState' }>,
): OpResultFor<'debugFlowState'> {
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(`Invalid player seat: ${op.player}.`, 'protocol');
  }
  const runner = runnerFromSnapshot(snapshot, def);

  // SECURITY (T-123-10): pendingAction is derived ONLY from the passed-in
  // pendingState — the requesting seat's own persisted pending state, threaded
  // by the host (naturally seat-scoped) — never by reading another seat's state.
  const pendingAction = (pendingState as unknown as SerializedPendingActionState | null) ?? undefined;

  return {
    success: true,
    // stateEnvelope() already computes flowDebugInfo (same shared serializer);
    // spread it through rather than recomputing.
    ...stateEnvelope(runner, gameOptions.playerCount),
    pendingAction,
  };
}

function handleDebugRewind(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'debugRewind' }>,
): OpResultFor<'debugRewind'> {
  const current = runnerFromSnapshot(snapshot, def);
  const historyLength = current.actionHistory.length;
  if (op.actionIndex < 0) {
    return errorResult(
      `Invalid action index: ${op.actionIndex}. History has ${historyLength} actions.`,
      'protocol',
      ErrorCode.INVALID_ACTION_INDEX,
    );
  }
  // A target at or past the current history length is a forward rewind, not a
  // no-op — reject it.
  if (op.actionIndex >= historyLength) {
    return errorResult(
      `Cannot rewind forward: target ${op.actionIndex} >= current ${historyLength}`,
      'protocol',
      ErrorCode.CANNOT_REWIND_FORWARD,
    );
  }

  // The same fence handleUndo's decision applies (T-155-02): the debug rewind twin must
  // not be a bypass route around the notUndoable/finished-phase fences.
  try {
    assertUndoAllowed({
      runner: current,
      actionHistory: current.actionHistory,
      turnStartActionIndex: op.actionIndex,
      // Deliberately UNFENCED against random draws: debug rewind is dev-time
      // travel (`boardsmith dev`), the debug ops never run in a deployed
      // session, and rewinding across a draw is the point of the tool.
      fenceRandomRewind: false,
    });
  } catch (err) {
    if (err instanceof UndoRefusedError) {
      return errorResult(err, 'executor', ErrorCode.UNDO_NOT_ALLOWED);
    }
    throw err;
  }

  const restored = runnerFromCheckpoint(def, snapshot, op.actionIndex);
  if (!restored) {
    return errorResult(`No checkpoint at action index ${op.actionIndex}.`, 'executor');
  }
  return { success: true, ...stateEnvelope(restored, gameOptions.playerCount) };
}

function handleDebugCommand(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  command: GameCommand,
): OpResultFor<'debugReorder' | 'debugTransfer' | 'debugShuffle'> {
  const runner = runnerFromSnapshot(snapshot, def);
  const result = executeDebugCommand(runner.game as Game, command);
  if (!result.success) {
    return errorResult(result.error ?? 'Debug command failed');
  }
  return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

/**
 * Execute one operation against the given snapshot and return the new snapshot
 * plus result data. Pure: no I/O, no module-level mutable state.
 *
 * @param def          - Game definition (class + metadata)
 * @param gameOptions  - Options used to construct/restore the game (must include playerCount)
 * @param snapshot     - The current game state snapshot (null for `start`)
 * @param pendingState - The acting seat's persisted pending state (for multi-step selections)
 * @param op           - The operation to execute
 * @param hostOptions  - Host-level session policy, threaded SEPARATELY from
 *                       `gameOptions` (WR-04, phase 131). `teachingDisabled`
 *                       must never live in `gameOptions`: a game may name its
 *                       own option `teachingDisabled` (the D-01 collision),
 *                       and `gameOptions` flows into the Game constructor →
 *                       `_constructorOptions` → `snapshot.gameOptions`, which
 *                       would persist a transient host flag inside game state.
 *                       Mirrors how `pendingState` is threaded positionally.
 *                       `seedSnapshot` (FEAT-01/168-02) follows the same
 *                       rule: a `start` op with a seed threaded here returns
 *                       that seed's state envelope instead of a fresh start.
 *                       `randomness: 'forbidden'` (#18) declares an
 *                       ORDER-ENTRY session: pure intent capture, no draws.
 *                       Every random draw then throws
 *                       `RandomnessForbiddenError`, which surfaces as an error
 *                       OpResult with NO snapshot, so the prior state is
 *                       preserved. It belongs here, per op, because the host is
 *                       the only authority on what kind of session this is —
 *                       and a session that never draws is provably immune to
 *                       re-rolling by undo, by reordering, and by abandoning
 *                       the session and starting a new one (a fresh `start`
 *                       mints a new seed). An order-entry session is normally
 *                       paired with `seedSnapshot`: a fresh start whose setup
 *                       shuffles would (correctly) fail here.
 *                       `debug: true` (#481) allows the debug ops
 *                       (`DEBUG_OP_TYPES`); without it each is refused. The
 *                       executor cannot tell which seat asked, so a host that
 *                       allows debug ops must itself make sure a seat-view op's
 *                       `player` is the asking seat, as `SnapshotSessionHost`
 *                       does.
 */
export async function executeOp<T extends ExecutableOp['type']>(
  definition: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: OpOfType<T>,
  hostOptions?: ExecuteOpHostOptions | null,
): Promise<OpResultFor<T>> {
  // `runOp` answers each op from the case that matched its type, so its answer
  // is this op's. TypeScript narrows `op` inside a switch but cannot carry that
  // narrowing back out to a generic return type, so it is stated here, once.
  return (await runOp(definition, gameOptions, snapshot, pendingState, op, hostOptions)) as OpResultFor<T>;
}

/** The host's session policy for one op (see {@link executeOp}). */
export interface ExecuteOpHostOptions {
  teachingDisabled?: boolean;
  seedSnapshot?: GameStateSnapshot;
  randomness?: RandomnessPolicy;
  debug?: boolean;
}

async function runOp(
  definition: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: ExecutableOp,
  hostOptions: ExecuteOpHostOptions | null | undefined,
): Promise<OpResult> {
  try {
    // #481: debug ops read every seat's history and edit the game outside its
    // rules, so they are refused unless the host turns debugging on. Off is the
    // default: a host that says nothing gets no debug ops.
    const debugRefused = debugOpRefusal(op, hostOptions?.debug === true);
    if (debugRefused) return debugRefused;
    const teachingDisabled = hostOptions?.teachingDisabled ?? false;
    // Written unconditionally from hostOptions, never read off the bundle: the
    // host is the sole authority on whether this session may draw, and every
    // handler below builds its runner from this `def`.
    const randomness: RandomnessPolicy = hostOptions?.randomness ?? 'allowed';
    const def: RunnerDef = { ...definition, randomness };
    const { playerCount } = gameOptions;
    // A BUNDLE WITH NO SEAT RANGE HAS NO TABLE, and is refused by name rather
    // than compared against `undefined` -- `playerCount < undefined` is false,
    // so every bound check here would pass and a world-only bundle would be run
    // as a table until it failed somewhere deep in game code (#354).
    if (def.minPlayers === undefined || def.maxPlayers === undefined) {
      return errorResult(
        `Game "${def.gameType}" declares no minPlayers/maxPlayers, so it has no table to seat ` +
          'anybody at. This is a world-only bundle: create a world of it instead of a session.',
        'protocol',
      );
    }
    if (playerCount < def.minPlayers || playerCount > def.maxPlayers) {
      return errorResult(
        `playerCount ${playerCount} is outside the allowed range (${def.minPlayers}-${def.maxPlayers})`,
        'protocol',
      );
    }

    if (op.type === 'start') {
      return handleStart(def, gameOptions, hostOptions?.seedSnapshot);
    }

    // All ops below require an existing snapshot
    const snap = snapshot as GameStateSnapshot;

    // BSMITH-05: a submission composed against a boundary that has since closed
    // is refused here, BEFORE any action is performed. See
    // docs/simultaneous-and-interrupt-semantics.md.
    const stale = refuseStaleSubmission(snap, op);
    if (stale) return stale;

    switch (op.type) {
      case 'action':
        return handleAction(def, gameOptions, snap, op);
      case 'expireSeat':
        return handleExpireSeat(def, gameOptions, snap, op);
      case 'selectionStep':
        return handleSelectionStep(def, gameOptions, snap, pendingState, op);
      case 'resolveChoices':
        return handleResolveChoices(def, gameOptions, snap, op);
      case 'cancelAction':
        return handleCancelAction(def, gameOptions, snap, pendingState, op);
      case 'undo':
        return handleUndo(def, gameOptions, snap, op);
      case 'botTurn':
        // Refused up front, not left to throw from inside the search: an MCTS
        // playout draws thousands of times, and an order-entry session has no
        // bot seats to begin with. Naming the mode is what makes it fixable.
        if (randomness === 'forbidden') {
          return errorResult(
            'bot turns are unavailable in an order-entry session: bot playouts ' +
            'consume randomness, which this session forbids.',
            'protocol',
          );
        }
        return handleBotTurn(def, gameOptions, snap, op);
      case 'debugHistory':
        return handleDebugHistory(def, gameOptions, snap);
      case 'debugStateAt':
        return handleDebugStateAt(def, gameOptions, snap, op);
      case 'debugStateDiff':
        return handleDebugStateDiff(def, gameOptions, snap, op);
      case 'debugActionTraces':
        return handleDebugActionTraces(def, gameOptions, snap, op);
      case 'debugFlowState':
        return handleDebugFlowState(def, gameOptions, snap, pendingState, op);
      case 'debugRewind':
        return handleDebugRewind(def, gameOptions, snap, op);
      case 'restoreEarlier':
        return handleRestoreEarlier(def, gameOptions, snap, op);
      case 'debugReorder':
        return handleDebugCommand(def, gameOptions, snap, {
          type: 'REORDER_CHILD',
          elementId: op.cardId,
          targetIndex: op.targetIndex,
        });
      case 'debugTransfer':
        return handleDebugCommand(def, gameOptions, snap, {
          type: 'MOVE',
          elementId: op.cardId,
          destinationId: op.targetDeckId,
          position: op.position,
        });
      case 'debugShuffle':
        return handleDebugCommand(def, gameOptions, snap, {
          type: 'SHUFFLE',
          spaceId: op.deckId,
        });
      case 'hint':
        return handleHint(def, gameOptions, snap, op, teachingDisabled);
      case 'heatmapToggle':
        return handleHeatmapToggle(def, gameOptions, snap, op, teachingDisabled);
      case 'botSuggest':
        return handleBotSuggest(def, gameOptions, snap, op);
      case 'startTutorial':
        return handleStartTutorial(def, gameOptions, snap, op, teachingDisabled);
      case 'exitTutorial': {
        if (!def.tutorial) {
          return errorResult('No tutorial definition on this game.', 'protocol');
        }
        if (op.player < 1 || op.player > gameOptions.playerCount) {
          return errorResult(
            `Invalid player seat ${op.player}: must be between 1 and ${gameOptions.playerCount}.`,
            'protocol',
          );
        }
        const runner = runnerFromSnapshot(snap, def);
        const current = runner.game.tutorialProgress.get(op.player);
        runner.game.tutorialProgress.set(op.player, {
          stepId: current?.stepId ?? null,
          status: 'exited',
        });
        return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
      }
    }
    // Every op type has a case above, so `op` is `never` here: an op added to
    // `ExecutorOp` or `DevOp` without a case is a compile error on this line.
    // Only a caller that bypassed the type (a host's lifecycle op, an op read
    // off a wire without `parseExecutorOp`) arrives, and it is refused by name.
    const unhandled: never = op;
    return errorResult(
      `executeOp does not run '${(unhandled as { type: unknown }).type}' ops. A host lifecycle op ` +
        '(demoStart, demoStop, demoControl, convertSeatToBot) goes to SnapshotSessionHost.handleOp; ' +
        'any other op must be one ExecutorOp or DevOp names.',
      'protocol',
    );
  } catch (err) {
    return errorResult(err, 'executor');
  }
}
