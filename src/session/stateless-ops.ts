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

import type { Game } from '../engine/index.js';
import { GameRunner, type GameStateSnapshot, type GameRunnerOptions, type SerializedAction } from '../runtime/index.js';
import { createBot, parseAILevel } from '../ai/index.js';
import { PickHandler, buildSingleActionMetadata, buildPlayerState, computeUndoInfo } from './index.js';

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
  | { type: 'aiTurn'; seats: Array<{ seat: number; level?: string }> };

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

  // State envelope — always present on success
  snapshot: unknown;
  pendingState: Record<string, unknown> | null;
  flowState: unknown;
  playerViews: unknown[];
  isComplete: boolean;
  winners: number[];
}

// ---------------------------------------------------------------------------
// GameDefinitionLike
// ---------------------------------------------------------------------------

export interface GameDefinitionLike {
  gameClass: new (...args: unknown[]) => unknown;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AIFlowState = {
  awaitingInput?: boolean;
  complete?: boolean;
  currentPlayer?: number;
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

function stateEnvelope(runner: GameRunner, playerCount: number): {
  snapshot: unknown;
  flowState: unknown;
  playerViews: unknown[];
  isComplete: boolean;
  winners: number[];
  pendingState: null;
} {
  return {
    snapshot: runner.getSnapshot(),
    flowState: runner.getFlowState(),
    playerViews: buildViews(runner, playerCount),
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
  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    for (const playerState of flowState.awaitingPlayers) {
      if (
        !playerState.completed &&
        playerState.availableActions.length > 0 &&
        aiSeats.has(playerState.playerIndex)
      ) {
        return playerState.playerIndex;
      }
    }
    return undefined;
  }

  if (flowState.currentPlayer !== undefined && aiSeats.has(flowState.currentPlayer)) {
    return flowState.currentPlayer;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Op handlers
// ---------------------------------------------------------------------------

function handleStart(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
): OpResult {
  const runner = new GameRunner({
    GameClass: def.gameClass as GameRunnerOptions<never>['GameClass'],
    gameType: def.gameType,
    gameOptions,
  } as GameRunnerOptions<never>);

  const flowState = runner.start();

  return {
    success: true,
    snapshot: runner.getSnapshot(),
    flowState,
    playerViews: buildViews(runner, gameOptions.playerCount),
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
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

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
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

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
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

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
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

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
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

  const flowState = runner.getFlowState() as AIFlowState | undefined;
  if (flowState?.currentPlayer !== op.player) {
    return errorResult("It's not your turn");
  }

  const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(runner.actionHistory, op.player);
  if (actionsThisTurn === 0) {
    return errorResult('No actions to undo');
  }

  const actionsToReplay = runner.actionHistory.slice(0, turnStartActionIndex);

  const replayGameOptions = {
    ...gameOptions,
    ...(snapshot.gameOptions ?? {}),
    ...(snapshot.seed != null ? { seed: snapshot.seed } : {}),
  };

  const replayed = GameRunner.replay(
    {
      GameClass: def.gameClass,
      gameType: def.gameType,
      gameOptions: replayGameOptions,
    } as unknown as GameRunnerOptions<never>,
    actionsToReplay as SerializedAction[],
  );

  return {
    success: true,
    ...stateEnvelope(replayed, gameOptions.playerCount),
  };
}

async function handleAITurn(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; [key: string]: unknown },
  snapshot: GameStateSnapshot,
  op: Extract<Op, { type: 'aiTurn' }>,
): Promise<OpResult> {
  const runner = GameRunner.fromSnapshot(
    snapshot,
    def.gameClass as GameRunnerOptions<never>['GameClass'],
  );

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
    isComplete: runner.isComplete(),
    winners: runner.getWinners().map((p) => p.seat),
    pendingState: null,
    aiMoved: true,
    aiPlayer,
  };
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
    }
  } catch (err) {
    return errorResult(err, 'executor');
  }
}
