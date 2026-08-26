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

import type { Game, GameCommand, TutorialDefinition, Annotation, FlowState } from '../engine/index.js';
import { ErrorCode } from '../types/protocol.js';
import { executeCommand, dueSeats, canSeatAct, availableActionsForSeat, flowBoundaryKey } from '../engine/index.js';
import type { BoundaryKeyState } from '../engine/index.js';
import type { HeatmapEntry, SerializedFlowDebugInfo, SerializedPendingActionState, WarningEntry } from './types.js';
import { validateTutorialDefinition, initialProgress, autoAdvanceTutorial } from '../engine/tutorial/progress.js';
import {
  GameRunner,
  describeCheckpointAbsence,
  type GameStateSnapshot,
  type GameRunnerOptions,
  type CheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
} from '../runtime/index.js';
import { createBot, parseBotLevel } from '../bot/index.js';
import type { BotMove } from '../bot/types.js';
import { describeMoveForHint } from './move-summary.js';
import { PickHandler } from './pick-handler.js';
import {
  buildSingleActionMetadata,
  buildPlayerState,
  computeUndoEligibility,
  buildActionTraces,
  computeElementDiff,
  serializeFlowDebugInfo,
  assertUndoAllowed,
  UndoRefusedError,
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

export type Op =
  | { type: 'start' }
  | ({ type: 'action'; actionName: string; player: number; args: Record<string, unknown> } & BoundaryStamped)
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
  | { type: 'botTurn'; seats: Array<{ seat: number; level?: string }> }
  // Debug ops (dev-only; the debug panel issues these over the platform bridge).
  // Read-only ops report state without mutating; the rest edit state like a move.
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
  | { type: 'startTutorial'; player: number }
  | { type: 'exitTutorial'; player: number }
  | { type: 'hint'; seat: number }
  | { type: 'heatmapToggle'; seat: number; visible: boolean }
  // botSuggest: read-only preview — runs MCTS and returns the suggested move WITHOUT
  // mutating the snapshot. Consumed by runDemoLoop in SnapshotSessionHost.
  | { type: 'botSuggest'; seats: Array<{ seat: number; level?: string }> }
  // demoStart / demoStop are host lifecycle ops handled by SnapshotSessionHost.handleOp
  // directly (they need the broadcast adapter + cancellable async lifetime that the
  // stateless executor does not have). They are in the Op union for type-safety when
  // passed through bridge.ts translateOp → handleOp. They MUST NOT be added to the
  // executeOp switch — see fallback at the end of the switch for the guard.
  | { type: 'demoStart'; delay?: number }
  | { type: 'demoStop' }
  // demoControl: live playback control for a running demo (pause/play/step one move/
  // step back one move) and speed (inter-move delay in ms). Host lifecycle op like
  // demoStart/demoStop — handled in SnapshotSessionHost.handleOp, never in executeOp.
  | { type: 'demoControl'; control: 'pause' | 'play' | 'step' | 'back'; delay?: number }
  /**
   * convertSeatToBot: a seat is now played by a bot. A host lifecycle op like the
   * demo family — handled in `SnapshotSessionHost.handleOp`, never in executeOp.
   *
   * It exists so a conversion is an EVENT THE ENGINE ACKNOWLEDGES AND ACTS ON,
   * replacing "mutate a config object and hope the host re-reads it". The re-read
   * always worked — `runBotTurnsInner` re-reads `adapters.botSeats` on every
   * iteration — but nothing woke the pump when the roster changed with no other
   * op in flight, so a table converted between moves just sat there; and with no
   * op to send, no engine test could express a conversion at all.
   *
   * **It deliberately carries NO level, and must never grow one.** The roster
   * stays the ADAPTER's: a seat's level comes from `adapters.botSeats` at the
   * moment the pump reads it, which is also where the platform's caretaker
   * one-window authorization lives. A `level` here would have nowhere to go
   * without the host keeping a seat→bot copy that fights the DO's roster on
   * restore and would let a caretaker bot act outside the window it was
   * authorized for. Set the level on the roster; this op says only "the roster
   * changed — acknowledge it and go".
   */
  | { type: 'convertSeatToBot'; seat: number };

/** The op types that carry a player's intent, and therefore a boundary key. */
export type SubmissionOpType = Extract<Op, BoundaryStamped>['type'];

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
};
export const SUBMISSION_OP_TYPES: ReadonlySet<Op['type']> = new Set(
  Object.keys(SUBMISSION_OP_TYPE_MAP) as SubmissionOpType[],
);

/** The read-only debug ops — reported without mutating or broadcasting state. */
export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  'resolveChoices',
  'debugHistory',
  'debugStateAt',
  'debugStateDiff',
  'debugActionTraces',
  'debugFlowState',
  // botSuggest is read-only: runs MCTS to preview a move but does NOT mutate the snapshot.
  'botSuggest',
]);

// ---------------------------------------------------------------------------
// OpResult
// ---------------------------------------------------------------------------

export interface OpResult {
  success: boolean;
  error?: string;
  /**
   * Structured error code, threaded through from the underlying runner/
   * pick-handler result when one exists (e.g. NOT_YOUR_TURN, ENGINE_ERROR,
   * CHOICES_EVALUATION_ERROR). Undefined for protocol-level failures that have
   * no upstream errorCode to forward — never fabricated.
   */
  errorCode?: ErrorCode;
  category?: 'bundle' | 'executor' | 'protocol';
  /**
   * Structured, inspectable warnings carried up from a pick response (e.g.
   * boardRefs()/display()/boardRef() throwing but recovering via a graceful
   * fallback). Never flips success:false — see WarningEntry.
   */
  warnings?: WarningEntry[];

  /**
   * `ActionResult.data` from the action this op executed — the acting seat's
   * return value (BUG-017). Set by the `action` op and by the `selectionStep`
   * op that completes a multi-step action; absent everywhere else.
   *
   * Reaches only the caller of this op. It is NOT part of the state envelope
   * and is never broadcast (per-seat player views publish no such field).
   */
  data?: Record<string, unknown>;
  /** `ActionResult.message` from the action this op executed (BUG-012). */
  message?: string;

  // Op-specific fields
  followUp?: unknown;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
  choices?: unknown[];
  validElements?: unknown[];
  multiSelect?: { min: number; max?: number };
  botMoved?: boolean;
  botPlayer?: number;
  /**
   * A bot seat that was due but could not move (#29).
   *
   * `botMoved` is false for both "no bot seat was due" and "a bot seat was due
   * and could not act", and those need telling apart: the second is a stalled
   * seat a host should report, and it used to be an exception that escaped
   * executeOp and locked the whole table instead. Present only in the second
   * case.
   */
  botStalled?: { seat: number; reason: string };
  /**
   * The seat a `convertSeatToBot` op converted — the engine's ACKNOWLEDGEMENT
   * that it saw the conversion, as opposed to a roster mutation it may or may
   * not have noticed. Present only on a successful `convertSeatToBot`.
   *
   * It is an echo, not a record: the host stores nothing about the conversion
   * and the snapshot carries nothing about it. The roster remains the adapter's.
   */
  convertedSeat?: number;

  // Transient teaching annotation results — consumed by SnapshotSessionHost
  // to update transientTeachingState. Returned by hint/heatmapToggle ops.
  hintAnnotation?: { seat: number; annotation: Annotation };
  heatmapUpdate?: { seat: number; visible: boolean; entries: HeatmapEntry[] };

  // botSuggest result — the previewed move (read-only; snapshot is NOT mutated).
  // Consumed by runDemoLoop in SnapshotSessionHost (never by executeOp).
  suggestedAction?: string;
  suggestedArgs?: Record<string, unknown>;

  // Debug op fields
  actionHistory?: unknown[];
  historicalState?: unknown;
  diff?: unknown;
  traces?: unknown[];
  flowContext?: unknown;
  // debug:flow-state result fields — the SAME shared serialized shape as the
  // session broadcast (Plan 04 Task 1), no divergent structure across channels.
  flowDebugInfo?: SerializedFlowDebugInfo;
  pendingAction?: SerializedPendingActionState;

  // State envelope — always present on success
  snapshot: unknown;
  pendingState: Record<string, unknown> | null;
  flowState: unknown;
  playerViews: unknown[];
  isComplete: boolean;
  winners: number[];
  // Public observer (spectator) view — position 0, no hidden info, no action
  // metadata. Mirrors a per-player view's `{ flowState, state }` shape so a host
  // can read `spectatorView.state` exactly like `playerViews[i].state`. Present
  // on every state-mutating op (start + ops that spread stateEnvelope).
  spectatorView?: unknown;
}

// ---------------------------------------------------------------------------
// GameDefinitionLike
// ---------------------------------------------------------------------------

export interface GameDefinitionLike {
  gameClass: new (...args: unknown[]) => unknown;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * Optional tutorial definition — threaded un-serialized into each runner
   * (mirrors how game-session.ts re-supplies it after fromSnapshot/fromCheckpoint).
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
   * Optional undo policy — threaded into the shared `assertUndoAllowed` guard
   * by `handleUndo`. Declared on the game definition (never carried in the
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
    flowState,
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
    flowState: runner.getFlowState(),
    state: buildPlayerState(runner, [], 0, { includeActionMetadata: false }),
  };
}

function stateEnvelope(runner: GameRunner, playerCount: number): {
  snapshot: unknown;
  flowState: unknown;
  playerViews: unknown[];
  spectatorView: unknown;
  isComplete: boolean;
  winners: number[];
  pendingState: null;
  flowDebugInfo: SerializedFlowDebugInfo;
} {
  return {
    snapshot: runner.getSnapshot(),
    flowState: runner.getFlowState(),
    playerViews: buildViews(runner, playerCount),
    spectatorView: buildSpectatorView(runner),
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
    // Present on every state-mutating op (top-level, computed once — mirrors
    // GameSession.broadcast()'s "compute once, reuse across seats" pattern).
    // SnapshotSessionHost merges this into every per-seat view's `state`
    // alongside the host's own per-seat pendingAction lookup (see
    // SnapshotSessionHost.mergeTransientState / lastFlowDebugInfo).
    flowDebugInfo: serializeFlowDebugInfo(runner.game),
  };
}

function errorResult(
  error: unknown,
  category: OpResult['category'] = 'bundle',
  errorCode?: ErrorCode,
): OpResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
    errorCode,
    category,
    snapshot: null,
    pendingState: null,
    flowState: null,
    playerViews: [],
    isComplete: false,
    winners: [],
  };
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
function refuseStaleSubmission(snapshot: GameStateSnapshot | null, op: Op): OpResult | undefined {
  if (!('boundaryKey' in op)) return undefined;
  // Equality against the key this very snapshot's flow position mints. No
  // parsing, no structural tolerance, and no default for an absent or
  // wrong-typed value: anything that is not equal is stale.
  if (op.boundaryKey === flowBoundaryKey(snapshot?.flowState as BoundaryKeyState | undefined)) return undefined;
  // 'protocol', and no errorCode: this refusal is raised here, ahead of any
  // runner call, so there is no upstream ErrorCode to forward and one must
  // never be fabricated (see OpResult.errorCode).
  return errorResult(STALE_SUBMISSION_MESSAGE, 'protocol');
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
): OpResult {
  // Seed plug-in point (FEAT-01/168-02): when a seed snapshot rides in via
  // hostOptions (NEVER gameOptions — same WR-04/D-01 rationale as
  // teachingDisabled: gameOptions persists into snapshot.gameOptions and
  // would leak this transient host directive into game state), the first
  // started state IS the seed's state — restored via the SAME
  // runnerFromSnapshot + stateEnvelope primitives every other op uses, not
  // a rebuilt load path. No seed => unchanged fresh-start behavior below.
  if (seedSnapshot) {
    return {
      success: true,
      ...stateEnvelope(runnerFromSnapshot(seedSnapshot, def), gameOptions.playerCount),
    };
  }

  // Thread tutorial definition un-serialized (mirrors game-session.ts create()).
  // The game constructor strips `tutorial` from _constructorOptions so it is not
  // persisted in the snapshot; runnerFromSnapshot re-supplies it on restore.
  const effectiveOptions = def.tutorial
    ? { ...gameOptions, tutorial: def.tutorial }
    : gameOptions;
  const runner = new GameRunner({
    GameClass: def.gameClass as GameRunnerOptions<never>['GameClass'],
    gameType: def.gameType,
    gameOptions: effectiveOptions,
    checkpoints: def.checkpoints,
    randomness: def.randomness,
    undo: def.undo,
  } as GameRunnerOptions<never>);

  runner.start();

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
  };
}

function handleAction(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'action' }>,
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  const actionResult = runner.performAction(op.actionName, op.player, op.args);

  if (!actionResult.success) {
    return errorResult(actionResult.error ?? 'Action failed', 'bundle', actionResult.errorCode);
  }

  // Mirror game-session.ts: advance tutorial for all seats with a running tutorial.
  // This is the CR-01 fix: stateless-ops was the only non-test path missing this pump.
  const game = runner.game as Game;
  for (const [seat, progress] of game.tutorialProgress) {
    if (progress.status === 'running') {
      autoAdvanceTutorial(game, seat);
    }
  }

  const rawFollowUp = (
    actionResult.flowState as { followUp?: { action: string; args?: Record<string, unknown> } } | undefined
  )?.followUp;

  let followUp: unknown;
  if (rawFollowUp) {
    const player = game.getPlayer(op.player);
    const metadata = player
      ? buildSingleActionMetadata(game, player, rawFollowUp.action, rawFollowUp.args)
      : undefined;
    followUp = { ...rawFollowUp, metadata };
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    // stateEnvelope() re-reads flowState from the runner; actionResult.flowState
    // is the authoritative value returned by performAction — override with it.
    flowState: actionResult.flowState,
    followUp,
    // The acting seat's return value from execute() (BUG-017/BUG-012).
    data: actionResult.data,
    message: actionResult.message,
  };
}

async function handleSelectionStep(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  pendingState: Record<string, unknown> | null,
  op: Extract<Op, { type: 'selectionStep' }>,
): Promise<OpResult> {
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

  // Mirror game-session.ts: advance tutorial for all seats with a running tutorial.
  // Fired after every selection step (not just actionComplete) so predicates
  // that depend on mid-action state still evaluate correctly.
  const game = runner.game as Game;
  for (const [seat, progress] of game.tutorialProgress) {
    if (progress.status === 'running') {
      autoAdvanceTutorial(game, seat);
    }
  }

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
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  const handler = new PickHandler(runner, gameOptions.playerCount);
  const result = handler.getPickChoices(op.actionName, op.selectionName, op.player, op.args);

  if (!result.success) {
    return errorResult(result.error ?? 'Failed to resolve choices', 'bundle', result.errorCode);
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    choices: result.choices,
    validElements: result.validElements,
    multiSelect: result.multiSelect,
    warnings: result.warnings,
  };
}

function handleCancelAction(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  pendingState: Record<string, unknown> | null,
  op: Extract<Op, { type: 'cancelAction' }>,
): OpResult {
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
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  // Validate player seat (1-indexed) — parity with StateHistory.undoToTurnStart.
  if (op.player < 1 || op.player > gameOptions.playerCount) {
    return errorResult(
      `Invalid player: ${op.player}. Player seats are 1-indexed (1 to ${gameOptions.playerCount}).`,
      'protocol',
      ErrorCode.INVALID_PLAYER,
    );
  }

  const flowState = runner.getFlowState() as BotFlowState | undefined;

  // Awaiting-aware eligibility (D4/SIM-02): sequential steps keep the EXACT
  // `currentPlayer` contract; a simultaneous step allows any seat that is
  // (or was) awaiting THIS step, with the boundary computed from that
  // seat's OWN action(s) -- not the turn-wide moveCount. Shared with the
  // stateful twin (state-history.ts) -- parity, T-160-* drift guard.
  const { eligible, turnStartActionIndex, actionsThisTurn } = computeUndoEligibility(
    runner.actionHistory,
    flowState,
    op.player,
  );
  if (!eligible) {
    return errorResult("It's not your turn", 'bundle', ErrorCode.NOT_YOUR_TURN);
  }
  if (actionsThisTurn === 0) {
    return errorResult('No actions to undo', 'bundle', ErrorCode.NO_ACTIONS_TO_UNDO);
  }

  // Server-side enforcement (UNDO-01 / UNDO-02 finished-phase fence): refuse
  // an undo that would cross a `.notUndoable()` action or that is attempted
  // once the game is finished. This is the single shared guard also called
  // by `handleDebugRewind` below and by both `state-history.ts` methods --
  // the client's `canUndo` flag is advisory only and must not be trusted.
  try {
    assertUndoAllowed({
      runner,
      actionHistory: runner.actionHistory,
      turnStartActionIndex,
      fenceRandomRewind: runner.undoPolicy.fenceRandomRewind,
    });
  } catch (err) {
    if (err instanceof UndoRefusedError) {
      return errorResult(err, 'executor', ErrorCode.UNDO_NOT_ALLOWED);
    }
    throw err;
  }

  // Restore the turn-start state AUTHORITATIVELY from the per-action checkpoint
  // captured at that action count — NOT by replaying actionHistory. Replay
  // re-runs `start()` + recorded actions, which never re-applies pending/
  // selection mutations (Piece.putInto, recorded in neither command nor action
  // history); it loses prior-turn equipment and mis-positions the flow (a later
  // action by another player then throws "Not Player N's turn"). The checkpoint
  // is the exact serialized state at the turn boundary, so restoring it keeps
  // every prior mutation and the correct flow position.
  // Restore from the per-action checkpoint authoritatively. fromCheckpoint
  // rehydrates the lean checkpoint and carries the prefix `[0..turnStartActionIndex]`
  // forward so further undos (e.g. undoing the now-current turn) still resolve.
  const restored = runnerFromCheckpoint(def, snapshot, turnStartActionIndex);
  if (!restored) {
    return errorResult(
      `Cannot undo to the start of this turn: ` +
      `${describeCheckpointAbsence(snapshot.actionCheckpoints, turnStartActionIndex)}`,
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
): Promise<OpResult> {
  const runner = runnerFromSnapshot(snapshot, def);

  const flowState = runner.getFlowState() as BotFlowState | undefined;

  const notDue: OpResult = {
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
    def.gameClass as GameRunnerOptions<never>['GameClass'],
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
    return errorResult(actionResult.error ?? 'bot action failed', 'bundle', actionResult.errorCode);
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    // stateEnvelope() re-reads flowState from the runner; actionResult.flowState
    // is the authoritative value returned by performAction — override with it.
    flowState: actionResult.flowState,
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
): Promise<OpResult> {
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
    def.gameClass as GameRunnerOptions<never>['GameClass'],
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

  // Extract the board highlight target using the same priority chain as
  // GameSession.#extractMoveTarget(): hintTargetFromMove first, then DEST_ARGS fallback.
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
): Promise<OpResult> {
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
  // (mirrors game-session.ts:1041-1043 — no MCTS needed to hide the overlay).
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
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    def.gameType,
    op.seat,
    runner.actionHistory,
    parseBotLevel('medium'),
    def.bot,
  );

  const { stats } = await bot.playWithStats();

  // Deduplicate by cell key — mirrors game-session.ts:1007-1026 #buildHeatmapEntries.
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
): Promise<OpResult> {
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
    def.gameClass as GameRunnerOptions<never>['GameClass'],
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

function gameClassOf(def: GameDefinitionLike): GameRunnerOptions<never>['GameClass'] {
  return def.gameClass as GameRunnerOptions<never>['GameClass'];
}

/**
 * Restore a runner from a snapshot and thread the tutorial definition back onto
 * the game (tutorials are unserializable attributes excluded from the snapshot;
 * the session layer must re-supply them on every fromSnapshot/fromCheckpoint call,
 * mirroring game-session.ts's replaceRunner guard).
 */
function runnerFromSnapshot(
  snapshot: GameStateSnapshot,
  def: RunnerDef,
): GameRunner {
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    { checkpoints: def.checkpoints, randomness: def.randomness, undo: def.undo },
  );
  if (def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  return runner;
}

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
  const runner = GameRunner.fromCheckpoint(snap, actionIndex, gameClassOf(def), {
    checkpoints: def.checkpoints,
    randomness: def.randomness,
    undo: def.undo,
  });
  if (runner && def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
  }
  return runner;
}

function handleDebugHistory(
  def: RunnerDef,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
): OpResult {
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
): OpResult {
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
): OpResult {
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
): OpResult {
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
): OpResult {
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
): OpResult {
  const current = runnerFromSnapshot(snapshot, def);
  const historyLength = current.actionHistory.length;
  if (op.actionIndex < 0) {
    return errorResult(
      `Invalid action index: ${op.actionIndex}. History has ${historyLength} actions.`,
      'protocol',
      ErrorCode.INVALID_ACTION_INDEX,
    );
  }
  // Parity with StateHistory.rewindToAction: a target at or past the current
  // history length is a forward rewind, not a no-op — reject it identically.
  if (op.actionIndex >= historyLength) {
    return errorResult(
      `Cannot rewind forward: target ${op.actionIndex} >= current ${historyLength}`,
      'protocol',
      ErrorCode.CANNOT_REWIND_FORWARD,
    );
  }

  // Same shared guard as handleUndo (T-155-02): the debug rewind twin must
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
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);
  const result = executeCommand(runner.game as Game, command);
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
 */
export async function executeOp(
  definition: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: Op,
  hostOptions?: {
    teachingDisabled?: boolean;
    seedSnapshot?: GameStateSnapshot;
    randomness?: RandomnessPolicy;
  } | null,
): Promise<OpResult> {
  try {
    const teachingDisabled = hostOptions?.teachingDisabled ?? false;
    // Written unconditionally from hostOptions, never read off the bundle: the
    // host is the sole authority on whether this session may draw, and every
    // handler below builds its runner from this `def`.
    const randomness: RandomnessPolicy = hostOptions?.randomness ?? 'allowed';
    const def: RunnerDef = { ...definition, randomness };
    const { playerCount } = gameOptions;
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
      case 'startTutorial': {
        // Fail-loud: teaching features locked out by the host (via
        // hostOptions — deliberately NOT gameOptions, see WR-04/D-01 above).
        if (teachingDisabled) {
          return errorResult('Teaching features are disabled for this session.', 'protocol');
        }
        if (!def.tutorial) {
          return errorResult('No tutorial definition on this game.', 'protocol');
        }
        // WR-01: validate seat range before touching any state — mirrors handleDebugActionTraces.
        if (op.player < 1 || op.player > gameOptions.playerCount) {
          return errorResult(
            `Invalid player seat ${op.player}: must be between 1 and ${gameOptions.playerCount}.`,
            'protocol',
          );
        }
        // IN-01: validate definition BEFORE constructing the runner (fail-loud before expensive work).
        validateTutorialDefinition(def.tutorial);
        const runner = runnerFromSnapshot(snap, def);
        // R-01: apply the tutorial's setup callback before setting initial progress so
        // the board is in the deterministic tutorial position before any advanceWhen
        // predicates fire. setup is optional; games without a preset omit it.
        def.tutorial.setup?.(runner.game as Game);
        runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
        // CR-01: pump auto-advance immediately after setting initial progress so steps
        // with always-true advanceWhen predicates (e.g. capture-tip) advance before
        // the learner's first action, matching the simulate-tutorial parity invariant.
        autoAdvanceTutorial(runner.game as Game, op.player);
        return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
      }
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
    // Fallback for host-only ops (demoStart / demoStop / demoControl /
    // convertSeatToBot) that are intercepted by SnapshotSessionHost.handleOp
    // before reaching this function. If they somehow reach executeOp, fail loud
    // rather than silently returning undefined. This branch also satisfies
    // TypeScript's return-completeness check now that those ops are in the Op
    // union.
    return errorResult(
      `Op type '${(op as { type: string }).type}' is a host lifecycle op and cannot be executed directly`,
      'protocol',
    );
  } catch (err) {
    return errorResult(err, 'executor');
  }
}
