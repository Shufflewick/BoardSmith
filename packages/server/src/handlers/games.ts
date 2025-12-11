/**
 * Game route handlers - platform-agnostic HTTP request handling
 */

import { generateGameId } from '@boardsmith/session';
import type {
  ServerResponse,
  GameStore,
  GameRegistry,
  CreateGameRequest,
  ActionRequest,
  AIConfig,
} from '../types.js';

// ============================================
// Response Helpers
// ============================================

function success(body: unknown, status = 200): ServerResponse {
  return { status, body };
}

function error(message: string, status = 400): ServerResponse {
  return { status, body: { success: false, error: message } };
}

// ============================================
// Game Handlers
// ============================================

/**
 * POST /games - Create a new game
 */
export async function handleCreateGame(
  store: GameStore,
  registry: GameRegistry,
  request: CreateGameRequest,
  aiConfig?: AIConfig
): Promise<ServerResponse> {
  const { gameType, playerCount, playerNames, playerIds, seed, aiPlayers, aiLevel } = request;

  const definition = registry.get(gameType);
  if (!definition) {
    const available = registry.getAll().map((d) => d.gameType).join(', ');
    return error(`Unknown game type: ${gameType}. Available: ${available}`);
  }

  if (playerCount < definition.minPlayers || playerCount > definition.maxPlayers) {
    return error(
      `Player count must be between ${definition.minPlayers} and ${definition.maxPlayers}`
    );
  }

  const gameId = generateGameId();
  const names = playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);

  // Merge AI config from request with default
  const effectiveAiConfig: AIConfig | undefined =
    aiPlayers && aiPlayers.length > 0
      ? { players: aiPlayers, level: aiLevel ?? aiConfig?.level ?? 'medium' }
      : aiConfig;

  const session = await store.createGame(gameId, {
    gameType,
    playerCount,
    playerNames: names,
    playerIds,
    seed,
    aiConfig: effectiveAiConfig,
  });

  const state = session.getState(0);

  return success(
    {
      success: true,
      gameId,
      flowState: state.flowState,
      state: state.state,
    },
    201
  );
}

/**
 * GET /games/:gameId - Get game state
 */
export async function handleGetGame(
  store: GameStore,
  gameId: string,
  playerPosition?: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const player = playerPosition ?? 0;
  const result = session.getState(player);

  return success(result);
}

/**
 * POST /games/:gameId/action - Perform an action
 */
export async function handleAction(
  store: GameStore,
  gameId: string,
  request: ActionRequest
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = await session.performAction(request.action, request.player, request.args);

  if (result.success) {
    return success(result);
  } else {
    return error(result.error ?? 'Action failed');
  }
}

/**
 * GET /games/:gameId/history - Get action history
 */
export async function handleGetHistory(
  store: GameStore,
  gameId: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const history = session.getHistory();
  return success({ success: true, ...history });
}

/**
 * GET /games/:gameId/state-at/:actionIndex - Get state at a specific action (time travel)
 */
export async function handleGetStateAt(
  store: GameStore,
  gameId: string,
  actionIndex: number,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.getStateAtAction(actionIndex, playerPosition);
  if (result.success) {
    return success({ success: true, state: result.state, actionIndex });
  } else {
    return error(result.error ?? 'Failed to get state');
  }
}

/**
 * GET /games/:gameId/state-diff/:fromIndex/:toIndex - Get state diff between two action points
 */
export async function handleGetStateDiff(
  store: GameStore,
  gameId: string,
  fromIndex: number,
  toIndex: number,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.getStateDiff(fromIndex, toIndex, playerPosition);
  if (result.success) {
    return success({ success: true, diff: result.diff });
  } else {
    return error(result.error ?? 'Failed to get state diff');
  }
}

/**
 * POST /games/:gameId/undo - Undo to turn start
 */
export async function handleUndo(
  store: GameStore,
  gameId: string,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = await session.undoToTurnStart(playerPosition);
  if (result.success) {
    return success(result);
  } else {
    return error(result.error ?? 'Undo failed');
  }
}

/**
 * POST /games/:gameId/restart - Restart game with same players
 */
export async function handleRestart(
  store: GameStore,
  registry: GameRegistry,
  gameId: string,
  aiConfig?: AIConfig
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  // Get original game configuration
  const storedState = session.storedState;
  const definition = registry.get(storedState.gameType);
  if (!definition) {
    return error(`Unknown game type: ${storedState.gameType}`);
  }

  // Delete the old game
  await store.deleteGame(gameId);

  // Create a new game with the same configuration (but new random seed)
  const newSession = await store.createGame(gameId, {
    gameType: storedState.gameType,
    playerCount: storedState.playerCount,
    playerNames: storedState.playerNames,
    playerIds: storedState.playerIds,
    aiConfig: storedState.aiConfig ?? aiConfig,
  });

  const state = newSession.getState(0);

  return success({
    success: true,
    flowState: state.flowState,
    state: state.state,
  });
}

/**
 * GET /health - Health check
 */
export function handleHealth(environment?: string): ServerResponse {
  return success({ status: 'ok', environment: environment ?? 'unknown' });
}
