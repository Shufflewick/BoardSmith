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
import { executeCommand, dueSeats, canSeatAct, availableActionsForSeat } from '../engine/index.js';
import type { HeatmapEntry } from './types.js';
import { validateTutorialDefinition, initialProgress, autoAdvanceTutorial } from '../engine/tutorial/progress.js';
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
  | { type: 'startTutorial'; player: number }
  | { type: 'hint'; seat: number }
  | { type: 'heatmapToggle'; seat: number; visible: boolean }
  // aiSuggest: read-only preview — runs MCTS and returns the suggested move WITHOUT
  // mutating the snapshot. Consumed by runDemoLoop in SnapshotSessionHost.
  | { type: 'aiSuggest'; seats: Array<{ seat: number; level?: string }> }
  // demoStart / demoStop are host lifecycle ops handled by SnapshotSessionHost.handleOp
  // directly (they need the broadcast adapter + cancellable async lifetime that the
  // stateless executor does not have). They are in the Op union for type-safety when
  // passed through bridge.ts translateOp → handleOp. They MUST NOT be added to the
  // executeOp switch — see fallback at the end of the switch for the guard.
  | { type: 'demoStart'; delay?: number }
  | { type: 'demoStop' };

/** The read-only debug ops — reported without mutating or broadcasting state. */
export const READ_ONLY_OP_TYPES: ReadonlySet<Op['type']> = new Set([
  'resolveChoices',
  'debugHistory',
  'debugStateAt',
  'debugStateDiff',
  'debugActionTraces',
  // aiSuggest is read-only: runs MCTS to preview a move but does NOT mutate the snapshot.
  'aiSuggest',
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

  // Transient teaching annotation results — consumed by SnapshotSessionHost
  // to update transientTeachingState. Returned by hint/heatmapToggle ops.
  hintAnnotation?: { seat: number; annotation: Annotation };
  heatmapUpdate?: { seat: number; visible: boolean; entries: HeatmapEntry[] };

  // aiSuggest result — the previewed move (read-only; snapshot is NOT mutated).
  // Consumed by runDemoLoop in SnapshotSessionHost (never by executeOp).
  suggestedAction?: string;
  suggestedArgs?: Record<string, unknown>;

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
  /**
   * Optional AI configuration — passed to `createBot` for hint/heatmap ops.
   * Provides `hintTargetFromMove` for per-game board-highlight extraction and
   * `objectives` for MCTS evaluation. When absent, hint/heatmap ops return a
   * protocol error (fail-loud: no AI config → no hint available).
   */
  ai?: import('../ai/types.js').AIConfig;
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
// Teaching op handlers (hint / heatmapToggle)
// ---------------------------------------------------------------------------

/** Fallback destination argument names — checked when hintTargetFromMove is absent. */
const DEST_ARGS = ['to', 'destination', 'target', 'square', 'cell', 'position'] as const;

async function handleHint(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'hint' }>,
): Promise<OpResult> {
  // Fail-loud: no AI config means hint is impossible.
  if (!def.ai?.objectives) {
    return errorResult('No AI configuration on this game — hint is unavailable.', 'protocol');
  }
  // Fail-loud: seat out of range.
  if (op.seat < 1 || op.seat > gameOptions.playerCount) {
    return errorResult(
      `Invalid seat ${op.seat}: must be between 1 and ${gameOptions.playerCount}.`,
      'protocol',
    );
  }

  const runner = runnerFromSnapshot(snapshot, def);
  const flowState = runner.getFlowState() as AIFlowState;

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
    parseAILevel('medium'),
    def.ai,
  );

  const move = await bot.play();

  // Extract the board highlight target using the same priority chain as
  // GameSession.#extractMoveTarget(): hintTargetFromMove first, then DEST_ARGS fallback.
  let target: import('../engine/index.js').ElementRef | undefined;
  if (def.ai.hintTargetFromMove) {
    target = def.ai.hintTargetFromMove(move);
  } else {
    for (const key of DEST_ARGS) {
      const val = (move.args as Record<string, unknown>)[key];
      if (typeof val === 'number') { target = { id: val }; break; }
      if (typeof val === 'string') { target = { notation: val }; break; }
    }
  }

  const annotation: Annotation = {
    text: 'Suggested move',
    ...(target ? { target: { kind: 'element' as const, ref: target } } : {}),
  };

  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    hintAnnotation: { seat: op.seat, annotation },
  };
}

async function handleHeatmapToggle(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'heatmapToggle' }>,
): Promise<OpResult> {
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
  // Fail-loud: no AI config means heatmap is impossible.
  if (!def.ai?.objectives) {
    return errorResult('No AI configuration on this game — heatmap is unavailable.', 'protocol');
  }

  const flowState = runner.getFlowState() as AIFlowState;
  if (!canSeatAct(flowState as unknown as FlowState, op.seat)) {
    return errorResult(`Cannot show heatmap: seat ${op.seat} is not awaiting input`, 'protocol');
  }

  const bot = createBot(
    runner.game as Game,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    def.gameType,
    op.seat,
    runner.actionHistory,
    parseAILevel('medium'),
    def.ai,
  );

  const { stats } = await bot.playWithStats();

  // Deduplicate by cell key — mirrors game-session.ts:1007-1026 #buildHeatmapEntries.
  // Keep the highest normalizedValue per cell key; mark exactly one isBest=true.
  const byCell = new Map<string, HeatmapEntry>();
  for (const stat of stats) {
    // Extract the cell ref from the move using the same priority chain as hint.
    let ref: import('../engine/index.js').ElementRef | undefined;
    if (def.ai.hintTargetFromMove) {
      ref = def.ai.hintTargetFromMove(stat.move);
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
// aiSuggest op handler (read-only preview)
// ---------------------------------------------------------------------------

/**
 * Run MCTS to preview the move an AI seat would make WITHOUT mutating the
 * snapshot. The demo loop calls this to narrate the move before executing it
 * via the existing `action` op — never re-running MCTS for the execute step
 * (which would risk a narrate/execute mismatch if MCTS is non-deterministic).
 *
 * Mirrors handleAITurn's bot construction but stops short of performAction.
 * Returns the snapshot unchanged; only `suggestedAction`, `suggestedArgs`,
 * and `aiPlayer` are set beyond the standard stateEnvelope fields.
 */
async function handleAISuggest(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'aiSuggest' }>,
): Promise<OpResult> {
  // Fail-loud: no AI config means suggestion is impossible.
  if (!def.ai?.objectives) {
    return errorResult('No AI configuration on this game — aiSuggest is unavailable.', 'protocol');
  }

  const runner = runnerFromSnapshot(snapshot, def);
  const flowState = runner.getFlowState() as AIFlowState | undefined;

  // Find the seat currently awaiting input among the given seats.
  const aiSeatSet = new Set(op.seats.map((s) => s.seat));
  const aiPlayer = selectDueAISeat(flowState ?? {}, aiSeatSet);
  if (aiPlayer === undefined) {
    return errorResult(
      'No seat among the given seats is currently awaiting input.',
      'protocol',
    );
  }

  const seatLevel = op.seats.find((s) => s.seat === aiPlayer)?.level;
  const bot = createBot(
    runner.game as Game,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
    def.gameType,
    aiPlayer,
    runner.actionHistory,
    parseAILevel(seatLevel ?? 'medium'),
    def.ai,
  );

  const move = await bot.play();

  // Return the preview — snapshot is NOT mutated (read-only, per READ_ONLY_OP_TYPES).
  // Per RESEARCH Pitfall 8: the stateEnvelope playerViews are discarded by the demo
  // loop (it reads only aiPlayer/suggestedAction/suggestedArgs). Acceptable for Phase 110.
  return {
    success: true,
    ...stateEnvelope(runner, gameOptions.playerCount),
    aiPlayer,
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
  def: GameDefinitionLike,
): GameRunner {
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
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
  def: GameDefinitionLike,
  snap: GameStateSnapshot,
  actionIndex: number,
): GameRunner | null {
  // Carry checkpoints up to and including the restore point so a later getSnapshot
  // keeps the linear history coherent (mirrors the undo op).
  const runner = GameRunner.fromCheckpoint(snap, actionIndex, gameClassOf(def));
  if (runner && def.tutorial) {
    (runner.game as Game).tutorialDefinition = def.tutorial;
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
      case 'hint':
        return handleHint(def, gameOptions, snap, op);
      case 'heatmapToggle':
        return handleHeatmapToggle(def, gameOptions, snap, op);
      case 'aiSuggest':
        return handleAISuggest(def, gameOptions, snap, op);
      case 'startTutorial': {
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
        runner.game.tutorialProgress.set(op.player, initialProgress(def.tutorial));
        // CR-01: pump auto-advance immediately after setting initial progress so steps
        // with always-true advanceWhen predicates (e.g. capture-tip) advance before
        // the learner's first action, matching the simulate-tutorial parity invariant.
        autoAdvanceTutorial(runner.game as Game, op.player);
        return { success: true, ...stateEnvelope(runner, gameOptions.playerCount) };
      }
    }
    // Fallback for host-only ops (demoStart / demoStop) that are intercepted by
    // SnapshotSessionHost.handleOp before reaching this function. If they somehow
    // reach executeOp, fail loud rather than silently returning undefined.
    // This branch also satisfies TypeScript's return-completeness check now that
    // demoStart/demoStop are in the Op union.
    return errorResult(
      `Op type '${(op as { type: string }).type}' is a host lifecycle op and cannot be executed directly`,
      'protocol',
    );
  } catch (err) {
    return errorResult(err, 'executor');
  }
}
