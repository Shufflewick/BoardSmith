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

import type { Game, GameCommand, TutorialDefinition } from '../engine/index.js';
import { executeCommand, dueSeats, canSeatAct, availableActionsForSeat } from '../engine/index.js';
import { validateTutorialDefinition, initialProgress } from '../engine/tutorial/progress.js';
import { GameRunner, type GameStateSnapshot, type GameRunnerOptions } from '../runtime/index.js';
import { createBot, parseAILevel } from '../ai/index.js';
import { PickHandler } from './pick-handler.js';
import {
  buildSingleActionMetadata,
  buildPlayerState,
  computeUndoInfo,
  buildActionTraces,
  computeElementDiff,
} from './utils.js';

// ---------------------------------------------------------------------------
// Op discriminated union
// ---------------------------------------------------------------------------

export type Op =
  | { type: 'start' }
  | { type: 'action'; actionName: string; player: number; args: Record<string, unknown> }
  | {
      type: 'selectionStep';
      player: number;
      selectionName: string;
      value: unknown;
      actionName?: string;
      initialArgs?: Record<string, unknown>;
    }
  | {
      type: 'resolveChoices';
      actionName: string;
      player: number;
      selectionName: string;
      args: Record<string, unknown>;
    }
  | { type: 'cancelAction'; player: number }
  | { type: 'undo'; player: number }
  | { type: 'aiTurn'; seats: Array<{ seat: number; level?: string }> }
  // Debug ops (dev-only; the debug panel issues these over the platform bridge).
  // Read-only ops report state without mutating; the rest edit state like a move.
  | { type: 'debugHistory' }
  | { type: 'debugStateAt'; actionIndex: number; player: number }
  | { type: 'debugStateDiff'; fromIndex: number; toIndex: number; player: number }
  | { type: 'debugActionTraces'; player: number }
  | { type: 'debugRewind'; actionIndex: number }
  | { type: 'debugReorder'; cardId: number; targetIndex: number }
  | { type: 'debugTransfer'; cardId: number; targetDeckId: number; position: 'first' | 'last' }
  | { type: 'debugShuffle'; deckId: number }
  | { type: 'startTutorial'; player: number };

/** The read-only debug ops — reported without mutating or broadcasting state. */
export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  'resolveChoices',
  'debugHistory',
  'debugStateAt',
  'debugStateDiff',
  'debugActionTraces',
]);

// ---------------------------------------------------------------------------
// OpResult
// ---------------------------------------------------------------------------

export interface OpResult {
  success: boolean;
  error?: string;
  category?: 'bundle' | 'executor' | 'protocol';

  // Op-specific fields
  followUp?: unknown;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
  choices?: unknown[];
  validElements?: unknown[];
  multiSelect?: { min: number; max?: number };
  aiMoved?: boolean;
  aiPlayer?: number;

  // Debug op fields
  actionHistory?: unknown[];
  historicalState?: unknown;
  diff?: unknown;
  traces?: unknown[];
  flowContext?: unknown;

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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AIFlowState = {
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
// spectators receive no action prompts. MUST be built from the LIVE runner (its
// zone visibility is set in the game constructor and is NOT serialized, so a
// fromSnapshot reconstruction would lose it and over-reveal).
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
} {
  return {
    snapshot: runner.getSnapshot(),
    flowState: runner.getFlowState(),
    playerViews: buildViews(runner, playerCount),
    spectatorView: buildSpectatorView(runner),
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
  };
}

function errorResult(error: unknown, category: OpResult['category'] = 'bundle'): OpResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: message,
    category,
    snapshot: null,
    pendingState: null,
    flowState: null,
    playerViews: [],
    isComplete: false,
    winners: [],
  };
}

function selectDueAISeat(
  flowState: AIFlowState,
  aiSeats: Set<number>,
): number | undefined {
  return dueSeats(flowState).find(seat => aiSeats.has(seat));
}

// ---------------------------------------------------------------------------
// Op handlers
// ---------------------------------------------------------------------------

function handleStart(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
): OpResult {
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
  } as GameRunnerOptions<never>);

  const flowState = runner.start();

  return {
    success: true,
    snapshot: runner.getSnapshot(),
    flowState,
    playerViews: buildViews(runner, gameOptions.playerCount),
    spectatorView: buildSpectatorView(runner),
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
  };
}

function handleAction(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'action' }>,
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  const actionResult = runner.performAction(op.actionName, op.player, op.args);

  if (!actionResult.success) {
    return errorResult(actionResult.error ?? 'Action failed');
  }

  const rawFollowUp = (
    actionResult.flowState as { followUp?: { action: string; args?: Record<string, unknown> } } | undefined
  )?.followUp;

  let followUp: unknown;
  if (rawFollowUp) {
    const game = runner.game as Game;
    const player = game.getPlayer(op.player);
    const metadata = player
      ? buildSingleActionMetadata(game, player, rawFollowUp.action, rawFollowUp.args)
      : undefined;
    followUp = { ...rawFollowUp, metadata };
  }

  return {
    success: true,
    snapshot: runner.getSnapshot(),
    flowState: actionResult.flowState,
    playerViews: buildViews(runner, gameOptions.playerCount),
    spectatorView: buildSpectatorView(runner),
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
    followUp,
  };
}

async function handleSelectionStep(
  def: GameDefinitionLike,
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
    return errorResult(step.error ?? 'Selection step failed');
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    pendingState: step.pendingState,
    done: step.done,
    nextChoices: step.nextChoices,
    actionComplete: step.actionComplete,
    followUp: step.followUp,
  };
}

function handleResolveChoices(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'resolveChoices' }>,
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  const handler = new PickHandler(runner, gameOptions.playerCount);
  const result = handler.getPickChoices(op.actionName, op.selectionName, op.player, op.args);

  if (!result.success) {
    return errorResult(result.error ?? 'Failed to resolve choices');
  }

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    choices: result.choices,
    validElements: result.validElements,
    multiSelect: result.multiSelect,
  };
}

function handleCancelAction(
  def: GameDefinitionLike,
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
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'undo' }>,
): OpResult {
  const runner = runnerFromSnapshot(snapshot, def);

  const flowState = runner.getFlowState() as AIFlowState | undefined;
  if (flowState?.currentPlayer !== op.player) {
    return errorResult("It's not your turn");
  }

  // Pass flowState.moveCount so undo uses the SAME authoritative turn boundary
  // the client was shown (buildPlayerState computes canUndo/turnStartActionIndex
  // with moveCount). Without it the backward-scan fallback can rewind past a
  // phase boundary and silently discard a prior turn's committed actions.
  const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(
    runner.actionHistory,
    op.player,
    flowState.moveCount,
  );
  if (actionsThisTurn === 0) {
    return errorResult('No actions to undo');
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
      `Cannot undo: no turn-start checkpoint at action index ${turnStartActionIndex} ` +
      `(snapshot carries ${snapshot.actionCheckpoints?.length ?? 0} checkpoint(s)). The snapshot must be ` +
      `produced by GameRunner.getSnapshot so per-action checkpoints are present.`,
    );
  }

  return {
    success: true,
    ...stateEnvelope(restored, gameOptions.playerCount),
  };
}

async function handleAITurn(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'aiTurn' }>,
): Promise<OpResult> {
  const runner = runnerFromSnapshot(snapshot, def);

  const flowState = runner.getFlowState() as AIFlowState | undefined;

  const notDue: OpResult = {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    aiMoved: false,
  };

  if (!flowState?.awaitingInput || flowState.complete) {
    return notDue;
  }

  const aiPlayer = selectDueAISeat(flowState, new Set(op.seats.map((s) => s.seat)));
  if (aiPlayer === undefined) {
    return notDue;
  }

  const seatLevel = op.seats.find((s) => s.seat === aiPlayer)?.level;
  const bot = createBot(
    runner.game as Game,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    def.gameType,
    aiPlayer,
    runner.actionHistory,
    parseAILevel(seatLevel ?? 'medium'),
  );

  const move = await bot.play();
  const actionResult = runner.performAction(move.action, aiPlayer, move.args);

  if (!actionResult.success) {
    return errorResult(actionResult.error ?? 'AI action failed');
  }

  return {
    success: true,
    snapshot: runner.getSnapshot(),
    flowState: actionResult.flowState,
    playerViews: buildViews(runner, gameOptions.playerCount),
    spectatorView: buildSpectatorView(runner),
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
    aiMoved: true,
    aiPlayer,
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
  def: GameDefinitionLike,
): GameRunner {
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );
  if (def.tutorial) {
    (runner.game as any).tutorialDefinition = def.tutorial;
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
  def: GameDefinitionLike,
  snap: GameStateSnapshot,
  actionIndex: number,
): GameRunner | null {
  // Carry checkpoints up to and including the restore point so a later getSnapshot
  // keeps the linear history coherent (mirrors the undo op).
  const runner = GameRunner.fromCheckpoint(snap, actionIndex, gameClassOf(def));
  if (runner && def.tutorial) {
    (runner.game as any).tutorialDefinition = def.tutorial;
  }
  return runner;
}

function handleDebugHistory(
  def: GameDefinitionLike,
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
  def: GameDefinitionLike,
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
  def: GameDefinitionLike,
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
  def: GameDefinitionLike,
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

function handleDebugRewind(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'debugRewind' }>,
): OpResult {
  const current = runnerFromSnapshot(snapshot, def);
  const historyLength = current.actionHistory.length;
  if (op.actionIndex < 0 || op.actionIndex > historyLength) {
    return errorResult(
      `Invalid action index: ${op.actionIndex}. History has ${historyLength} actions.`,
      'protocol',
    );
  }
  const restored = runnerFromCheckpoint(def, snapshot, op.actionIndex);
  if (!restored) {
    return errorResult(`No checkpoint at action index ${op.actionIndex}.`, 'executor');
  }
  return { success: true, ...stateEnvelope(restored, gameOptions.playerCount) };
}

function handleDebugCommand(
  def: GameDefinitionLike,
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
 */
export async function executeOp(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: Op,
): Promise<OpResult> {
  try {
    const { playerCount } = gameOptions;
    if (playerCount < def.minPlayers || playerCount > def.maxPlayers) {
      return errorResult(
        `playerCount ${playerCount} is outside the allowed range (${def.minPlayers}-${def.maxPlayers})`,
        'protocol',
      );
    }

    if (op.type === 'start') {
      return handleStart(def, gameOptions);
    }

    // All ops below require an existing snapshot
    const snap = snapshot as GameStateSnapshot;

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
      case 'aiTurn':
        return handleAITurn(def, gameOptions, snap, op);
      case 'debugHistory':
        return handleDebugHistory(def, gameOptions, snap);
      case 'debugStateAt':
        return handleDebugStateAt(def, gameOptions, snap, op);
      case 'debugStateDiff':
        return handleDebugStateDiff(def, gameOptions, snap, op);
      case 'debugActionTraces':
        return handleDebugActionTraces(def, gameOptions, snap, op);
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
      case 'startTutorial': {
        if (!def.tutorial) {
          return errorResult('No tutorial definition on this game.', 'protocol');
        }
        const runner = runnerFromSnapshot(snap, def);
        validateTutorialDefinition(def.tutorial);
        runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
        return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
      }
    }
  } catch (err) {
    return errorResult(err, 'executor');
  }
}
