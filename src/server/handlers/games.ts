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
  GameDefinition,
  ClaimPositionRequest,
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
// Helpers
// ============================================

/**
 * Build effective game options by applying defaults from definition
 */
function buildEffectiveGameOptions(
  definition: GameDefinition,
  provided?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!definition.gameOptions) {
    return provided;
  }

  const result: Record<string, unknown> = {};

  for (const [key, optDef] of Object.entries(definition.gameOptions)) {
    if (provided && key in provided) {
      // Use provided value
      result[key] = provided[key];
    } else if (optDef.default !== undefined) {
      // Use default from definition
      result[key] = optDef.default;
    }
  }

  // If nothing set, return undefined
  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
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
  request: CreateGameRequest & { useLobby?: boolean; creatorId?: string },
  aiConfig?: AIConfig
): Promise<ServerResponse> {
  const {
    gameType,
    playerCount,
    playerNames,
    playerIds,
    seed,
    aiPlayers,
    aiLevel,
    gameOptions,
    playerConfigs,
    useLobby,
    creatorId,
  } = request;

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

  // Build player names from playerConfigs or fallback to playerNames
  let names: string[];
  let effectiveAiPlayers: number[] = aiPlayers ?? [];

  if (playerConfigs && playerConfigs.length > 0) {
    names = playerConfigs.map((config, i) =>
      config.name || (config.isAI ? 'Bot' : `Player ${i + 1}`)
    );
    // Extract AI players from configs
    effectiveAiPlayers = playerConfigs
      .map((config, i) => (config.isAI ? i : -1))
      .filter((i) => i >= 0);
  } else {
    names = playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
  }

  // Merge AI config from request with default
  const effectiveAiConfig: AIConfig | undefined =
    effectiveAiPlayers.length > 0
      ? { players: effectiveAiPlayers, level: aiLevel ?? aiConfig?.level ?? 'medium' }
      : aiConfig;

  // Apply defaults from game definition to options
  let effectiveGameOptions = buildEffectiveGameOptions(definition, gameOptions);

  // Include playerConfigs in game options so games can access per-player settings
  if (playerConfigs && playerConfigs.length > 0) {
    if (!effectiveGameOptions) {
      effectiveGameOptions = {};
    }
    effectiveGameOptions.playerConfigs = playerConfigs;
  }

  const session = await store.createGame(gameId, {
    gameType,
    playerCount,
    playerNames: names,
    playerIds,
    seed,
    aiConfig: effectiveAiConfig,
    gameOptions: effectiveGameOptions,
    displayName: definition.displayName,
    playerConfigs,
    creatorId,
    useLobby,
  });

  // Get initial state from player 1's perspective
  const state = session.getState(1);

  // Include lobby info if using lobby flow
  const lobby = useLobby ? session.getLobbyInfo() : undefined;

  return success(
    {
      success: true,
      gameId,
      flowState: state.flowState,
      state: state.state,
      lobby,
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

  // Default to player 1 if not specified (1-indexed)
  const player = playerPosition ?? 1;
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
 * GET /games/:gameId/action-traces - Get action availability traces (debug)
 * Returns detailed information about why each action is or isn't available.
 * Also returns flowContext showing which actions are restricted by the current flow step.
 */
export async function handleGetActionTraces(
  store: GameStore,
  gameId: string,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.getActionTraces(playerPosition);
  if (result.success) {
    return success({
      success: true,
      traces: result.traces,
      flowContext: result.flowContext,
    });
  } else {
    return error(result.error ?? 'Failed to get action traces');
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
    gameOptions: storedState.gameOptions,
  });

  // Get initial state from player 1's perspective
  const state = newSession.getState(1);

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

// ============================================
// Lobby Handlers
// ============================================

/**
 * GET /games/:gameId/lobby - Get lobby state
 */
export async function handleGetLobby(
  store: GameStore,
  gameId: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const lobby = session.getLobbyInfo();
  if (!lobby) {
    return error('Game does not have a lobby', 400);
  }

  return success({ success: true, lobby });
}

/**
 * POST /games/:gameId/claim-position - Claim a position in the lobby
 */
export async function handleClaimPosition(
  store: GameStore,
  gameId: string,
  request: ClaimPositionRequest
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const { position, playerId, name } = request;

  if (position === undefined || position === null) {
    return error('Position is required');
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (!name) {
    return error('Player name is required');
  }

  const result = await session.claimPosition(position, playerId, name);

  if (result.success) {
    return success({
      success: true,
      lobby: result.lobby,
      position,
    });
  } else {
    return error(result.error ?? 'Failed to claim position');
  }
}

/**
 * POST /games/:gameId/update-name - Update player name in lobby
 */
export async function handleUpdateName(
  store: GameStore,
  gameId: string,
  playerId: string,
  name: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = await session.updateSlotName(playerId, name);

  if (result.success) {
    return success({ success: true });
  } else {
    return error(result.error ?? 'Failed to update name');
  }
}

/**
 * POST /games/:gameId/set-ready - Set player ready state
 */
export async function handleSetReady(
  store: GameStore,
  gameId: string,
  playerId: string,
  ready: boolean
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  const result = await session.setReady(playerId, ready);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to set ready state');
  }
}

/**
 * POST /games/:gameId/add-slot - Add a player slot (host only)
 */
export async function handleAddSlot(
  store: GameStore,
  gameId: string,
  playerId: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  const result = await session.addSlot(playerId);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to add slot');
  }
}

/**
 * POST /games/:gameId/remove-slot - Remove a player slot (host only)
 */
export async function handleRemoveSlot(
  store: GameStore,
  gameId: string,
  playerId: string,
  position: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (position === undefined || position === null) {
    return error('Position is required');
  }

  const result = await session.removeSlot(playerId, position);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to remove slot');
  }
}

/**
 * POST /games/:gameId/set-slot-ai - Toggle slot between open and AI (host only)
 */
export async function handleSetSlotAI(
  store: GameStore,
  gameId: string,
  playerId: string,
  position: number,
  isAI: boolean,
  aiLevel?: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (position === undefined || position === null) {
    return error('Position is required');
  }

  const result = await session.setSlotAI(playerId, position, isAI, aiLevel);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to set slot AI');
  }
}

/**
 * POST /games/:gameId/leave-position - Leave/unclaim position in lobby (non-hosts)
 */
export async function handleLeavePosition(
  store: GameStore,
  gameId: string,
  playerId: string
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  const result = await session.leavePosition(playerId);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to leave position');
  }
}

/**
 * POST /games/:gameId/kick-player - Kick a player from lobby (host only)
 */
export async function handleKickPlayer(
  store: GameStore,
  gameId: string,
  playerId: string,
  position: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (position === undefined || position === null) {
    return error('Position is required');
  }

  const result = await session.kickPlayer(playerId, position);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to kick player');
  }
}

/**
 * POST /games/:gameId/player-options - Update player's options (color, etc.)
 */
export async function handleUpdatePlayerOptions(
  store: GameStore,
  gameId: string,
  playerId: string,
  options: Record<string, unknown>
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (!options || typeof options !== 'object') {
    return error('Options are required');
  }

  const result = await session.updatePlayerOptions(playerId, options);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to update player options');
  }
}

/**
 * POST /games/:gameId/game-options - Update game options (host only)
 */
export async function handleUpdateGameOptions(
  store: GameStore,
  gameId: string,
  playerId: string,
  options: Record<string, unknown>
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (!options || typeof options !== 'object') {
    return error('Options are required');
  }

  const result = await session.updateGameOptions(playerId, options);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to update game options');
  }
}

/**
 * POST /games/:gameId/slot-player-options - Update a specific slot's player options (host only)
 */
export async function handleUpdateSlotPlayerOptions(
  store: GameStore,
  gameId: string,
  playerId: string,
  position: number,
  options: Record<string, unknown>
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  if (!playerId) {
    return error('Player ID is required');
  }

  if (position === undefined || position === null) {
    return error('Position is required');
  }

  if (!options || typeof options !== 'object') {
    return error('Options are required');
  }

  const result = await session.updateSlotPlayerOptions(playerId, position, options);

  if (result.success) {
    return success({ success: true, lobby: result.lobby });
  } else {
    return error(result.error ?? 'Failed to update slot player options');
  }
}

// ============================================
// Repeating Selection Handlers
// ============================================

/**
 * POST /games/:gameId/start-action - Start a pending action (for actions with repeating selections)
 */
export async function handleStartPendingAction(
  store: GameStore,
  gameId: string,
  actionName: string,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  // Check if action has repeating selections
  if (!session.hasRepeatingSelections(actionName)) {
    // If no repeating selections, just return success - client can use normal flow
    return success({
      success: true,
      hasRepeatingSelections: false,
      message: 'Action does not have repeating selections, use normal action flow',
    });
  }

  const result = session.startPendingAction(actionName, playerPosition);

  if (result.success) {
    return success({
      success: true,
      hasRepeatingSelections: true,
      pendingState: result.pendingState,
    });
  } else {
    return error(result.error ?? 'Failed to start pending action');
  }
}

/**
 * POST /games/:gameId/selection-step - Process a selection step for a pending action
 */
export async function handleSelectionStep(
  store: GameStore,
  gameId: string,
  playerPosition: number,
  selectionName: string,
  value: unknown,
  actionName?: string,
  initialArgs?: Record<string, unknown>
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = await session.processSelectionStep(playerPosition, selectionName, value, actionName, initialArgs);

  if (result.success) {
    return success({
      success: true,
      done: result.done,
      nextChoices: result.nextChoices,
      actionComplete: result.actionComplete,
      actionResult: result.actionResult,
      state: result.state,
    });
  } else {
    return error(result.error ?? 'Failed to process selection step');
  }
}

/**
 * POST /games/:gameId/cancel-action - Cancel a pending action
 */
export async function handleCancelPendingAction(
  store: GameStore,
  gameId: string,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  session.cancelPendingAction(playerPosition);

  return success({ success: true, message: 'Pending action cancelled' });
}

/**
 * GET /games/:gameId/pending-action - Get current pending action state for a player
 */
export async function handleGetPendingAction(
  store: GameStore,
  gameId: string,
  playerPosition: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const pendingState = session.getPendingAction(playerPosition);

  return success({
    success: true,
    hasPendingAction: !!pendingState,
    pendingState,
  });
}

/**
 * POST /games/:gameId/rewind - Rewind game to a specific action (debug only)
 * Discards all actions after the target index.
 */
export async function handleRewind(
  store: GameStore,
  gameId: string,
  actionIndex: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = await session.rewindToAction(actionIndex);

  if (result.success) {
    return success({
      success: true,
      actionsDiscarded: result.actionsDiscarded,
      message: `Rewound to action ${actionIndex}`,
    });
  } else {
    return error(result.error ?? 'Rewind failed');
  }
}

// ============================================
// Debug Deck Manipulation Handlers
// ============================================

/**
 * POST /games/:gameId/debug/move-to-top - Move a card to the top of its deck (debug only)
 */
export async function handleMoveCardToTop(
  store: GameStore,
  gameId: string,
  cardId: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.moveCardToTop(cardId);

  if (result.success) {
    return success({
      success: true,
      message: `Card ${cardId} moved to top`,
    });
  } else {
    return error(result.error ?? 'Move failed');
  }
}

/**
 * POST /games/:gameId/debug/reorder-card - Reorder a card within its deck (debug only)
 */
export async function handleReorderCard(
  store: GameStore,
  gameId: string,
  cardId: number,
  targetIndex: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.reorderCard(cardId, targetIndex);

  if (result.success) {
    return success({
      success: true,
      message: `Card ${cardId} moved to position ${targetIndex}`,
    });
  } else {
    return error(result.error ?? 'Reorder failed');
  }
}

/**
 * POST /games/:gameId/debug/transfer-card - Transfer a card to another deck (debug only)
 */
export async function handleTransferCard(
  store: GameStore,
  gameId: string,
  cardId: number,
  targetDeckId: number,
  position: 'first' | 'last' = 'first'
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.transferCard(cardId, targetDeckId, position);

  if (result.success) {
    return success({
      success: true,
      message: `Card ${cardId} transferred to deck ${targetDeckId}`,
    });
  } else {
    return error(result.error ?? 'Transfer failed');
  }
}

/**
 * POST /games/:gameId/debug/shuffle-deck - Shuffle a deck (debug only)
 */
export async function handleShuffleDeck(
  store: GameStore,
  gameId: string,
  deckId: number
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.shuffleDeck(deckId);

  if (result.success) {
    return success({
      success: true,
      message: `Deck ${deckId} shuffled`,
    });
  } else {
    return error(result.error ?? 'Shuffle failed');
  }
}

// ============================================
// Selection Choices Handlers
// ============================================

/**
 * POST /games/:gameId/selection-choices - Get choices for any selection
 * This is the unified endpoint for fetching selection choices on-demand.
 */
export async function handleGetSelectionChoices(
  store: GameStore,
  gameId: string,
  actionName: string,
  selectionName: string,
  playerPosition: number,
  currentArgs: Record<string, unknown> = {}
): Promise<ServerResponse> {
  const session = await store.getGame(gameId);
  if (!session) {
    return error('Game not found', 404);
  }

  const result = session.getSelectionChoices(actionName, selectionName, playerPosition, currentArgs);

  if (result.success) {
    return success({
      success: true,
      choices: result.choices,
      validElements: result.validElements,
      multiSelect: result.multiSelect,
    });
  } else {
    return error(result.error ?? 'Failed to get selection choices');
  }
}
