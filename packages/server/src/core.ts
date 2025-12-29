/**
 * GameServerCore - Platform-agnostic server that routes HTTP requests to handlers
 */

import type {
  ServerRequest,
  ServerResponse,
  GameServerCoreOptions,
  GameStore,
  GameRegistry,
  MatchmakingStore,
  AIConfig,
  CreateGameRequest,
  ActionRequest,
  WebSocketSession,
  WebSocketMessage,
} from './types.js';

import {
  handleCreateGame,
  handleGetGame,
  handleAction,
  handleGetHistory,
  handleGetStateAt,
  handleGetStateDiff,
  handleGetActionTraces,
  handleUndo,
  handleRestart,
  handleHealth,
  handleGetLobby,
  handleClaimPosition,
  handleUpdateName,
  handleSetReady,
  handleAddSlot,
  handleRemoveSlot,
  handleSetSlotAI,
  handleLeavePosition,
  handleKickPlayer,
  handleUpdatePlayerOptions,
  handleUpdateSlotPlayerOptions,
  handleUpdateGameOptions,
  // Repeating selection handlers
  handleStartPendingAction,
  handleSelectionStep,
  handleCancelPendingAction,
  handleGetPendingAction,
  // Debug handlers
  handleRewind,
  handleMoveCardToTop,
  handleReorderCard,
  handleTransferCard,
  handleShuffleDeck,
  // Deferred choices handler
  handleGetDeferredChoices,
} from './handlers/games.js';
import type { ClaimPositionRequest } from './types.js';

import {
  handleMatchmakingJoin,
  handleMatchmakingStatus,
  handleMatchmakingLeave,
  type CreateGameCallback,
} from './handlers/matchmaking.js';
import { generateGameId } from '@boardsmith/session';

// ============================================
// Response Helpers
// ============================================

function notFound(): ServerResponse {
  return { status: 404, body: { success: false, error: 'Not found' } };
}

function serverError(error: unknown): ServerResponse {
  const message = error instanceof Error ? error.message : 'Internal error';
  return { status: 500, body: { success: false, error: message } };
}

// ============================================
// GameServerCore
// ============================================

/**
 * Platform-agnostic HTTP request router for BoardSmith games.
 *
 * Routes:
 * - POST /games - Create a new game
 * - GET /games/:gameId - Get game state
 * - POST /games/:gameId/action - Perform an action
 * - GET /games/:gameId/history - Get action history
 * - GET /games/:gameId/state-at/:actionIndex - Get state at action (time travel)
 * - GET /games/:gameId/state-diff/:from/:to - Get state diff
 * - POST /games/:gameId/undo - Undo to turn start
 * - POST /games/:gameId/restart - Restart game
 * - POST /matchmaking/join - Join matchmaking queue
 * - GET /matchmaking/status - Check matchmaking status
 * - POST /matchmaking/leave - Leave matchmaking queue
 * - GET /health - Health check
 */
export class GameServerCore {
  readonly #store: GameStore;
  readonly #registry: GameRegistry;
  readonly #matchmaking?: MatchmakingStore;
  readonly #aiConfig?: AIConfig;
  readonly #environment?: string;

  constructor(options: GameServerCoreOptions) {
    this.#store = options.store;
    this.#registry = options.registry;
    this.#matchmaking = options.matchmaking;
    this.#aiConfig = options.aiConfig;
    this.#environment = options.environment;
  }

  /**
   * Handle an HTTP request and return a response
   */
  async handleRequest(request: ServerRequest): Promise<ServerResponse> {
    const { method, path, query, body } = request;

    try {
      // GET /games/definitions - Get game definitions for lobby UI
      if (path === '/games/definitions' && method === 'GET') {
        return this.#handleGetDefinitions();
      }

      // GET /games/list - List all persisted games (for resume feature)
      if (path === '/games/list' && method === 'GET') {
        return this.#handleListGames();
      }

      // POST /games - Create a new game
      if (path === '/games' && method === 'POST') {
        return await handleCreateGame(
          this.#store,
          this.#registry,
          body as CreateGameRequest,
          this.#aiConfig
        );
      }

      // GET /games/:gameId - Get game state
      const getGameMatch = path.match(/^\/games\/([^/]+)$/);
      if (getGameMatch && method === 'GET') {
        const gameId = getGameMatch[1];
        const player = query.player ? parseInt(query.player, 10) : undefined;
        return await handleGetGame(this.#store, gameId, player);
      }

      // POST /games/:gameId/action - Perform an action
      const actionMatch = path.match(/^\/games\/([^/]+)\/action$/);
      if (actionMatch && method === 'POST') {
        const gameId = actionMatch[1];
        return await handleAction(this.#store, gameId, body as ActionRequest);
      }

      // GET /games/:gameId/history - Get action history
      const historyMatch = path.match(/^\/games\/([^/]+)\/history$/);
      if (historyMatch && method === 'GET') {
        const gameId = historyMatch[1];
        return await handleGetHistory(this.#store, gameId);
      }

      // GET /games/:gameId/state-at/:actionIndex - Time travel
      const stateAtMatch = path.match(/^\/games\/([^/]+)\/state-at\/(\d+)$/);
      if (stateAtMatch && method === 'GET') {
        const gameId = stateAtMatch[1];
        const actionIndex = parseInt(stateAtMatch[2], 10);
        const playerPosition = parseInt(query.player || '0', 10);
        return await handleGetStateAt(this.#store, gameId, actionIndex, playerPosition);
      }

      // GET /games/:gameId/state-diff/:from/:to - State diff
      const stateDiffMatch = path.match(/^\/games\/([^/]+)\/state-diff\/(\d+)\/(\d+)$/);
      if (stateDiffMatch && method === 'GET') {
        const gameId = stateDiffMatch[1];
        const fromIndex = parseInt(stateDiffMatch[2], 10);
        const toIndex = parseInt(stateDiffMatch[3], 10);
        const playerPosition = parseInt(query.player || '0', 10);
        return await handleGetStateDiff(this.#store, gameId, fromIndex, toIndex, playerPosition);
      }

      // GET /games/:gameId/action-traces - Action availability traces (debug)
      const actionTracesMatch = path.match(/^\/games\/([^/]+)\/action-traces$/);
      if (actionTracesMatch && method === 'GET') {
        // Note: This is a debug endpoint. Consider disabling in production.
        const gameId = actionTracesMatch[1];
        const playerPosition = parseInt(query.player || '0', 10);
        return await handleGetActionTraces(this.#store, gameId, playerPosition);
      }

      // ============================================
      // Repeating Selection Routes
      // ============================================

      // POST /games/:gameId/start-action - Start a pending action (for repeating selections)
      const startActionMatch = path.match(/^\/games\/([^/]+)\/start-action$/);
      if (startActionMatch && method === 'POST') {
        const gameId = startActionMatch[1];
        const { action, player } = body as { action: string; player: number };
        return await handleStartPendingAction(this.#store, gameId, action, player);
      }

      // POST /games/:gameId/selection-step - Process a selection step
      const selectionStepMatch = path.match(/^\/games\/([^/]+)\/selection-step$/);
      if (selectionStepMatch && method === 'POST') {
        const gameId = selectionStepMatch[1];
        const { player, selectionName, value, action, initialArgs } = body as { player: number; selectionName: string; value: unknown; action?: string; initialArgs?: Record<string, unknown> };
        return await handleSelectionStep(this.#store, gameId, player, selectionName, value, action, initialArgs);
      }

      // POST /games/:gameId/cancel-action - Cancel a pending action
      const cancelActionMatch = path.match(/^\/games\/([^/]+)\/cancel-action$/);
      if (cancelActionMatch && method === 'POST') {
        const gameId = cancelActionMatch[1];
        const { player } = body as { player: number };
        return await handleCancelPendingAction(this.#store, gameId, player);
      }

      // GET /games/:gameId/pending-action - Get pending action state
      const pendingActionMatch = path.match(/^\/games\/([^/]+)\/pending-action$/);
      if (pendingActionMatch && method === 'GET') {
        const gameId = pendingActionMatch[1];
        const playerPosition = parseInt(query.player || '0', 10);
        return await handleGetPendingAction(this.#store, gameId, playerPosition);
      }

      // POST /games/:gameId/rewind - Rewind to a specific action (debug only)
      const rewindMatch = path.match(/^\/games\/([^/]+)\/rewind$/);
      if (rewindMatch && method === 'POST') {
        const gameId = rewindMatch[1];
        const { actionIndex } = body as { actionIndex: number };
        return await handleRewind(this.#store, gameId, actionIndex);
      }

      // ============================================
      // Debug Deck Manipulation Routes
      // ============================================

      // POST /games/:gameId/debug/move-to-top - Move card to top of deck (debug only)
      const moveToTopMatch = path.match(/^\/games\/([^/]+)\/debug\/move-to-top$/);
      if (moveToTopMatch && method === 'POST') {
        const gameId = moveToTopMatch[1];
        const { cardId } = body as { cardId: number };
        return await handleMoveCardToTop(this.#store, gameId, cardId);
      }

      // POST /games/:gameId/debug/reorder-card - Reorder card within deck (debug only)
      const reorderCardMatch = path.match(/^\/games\/([^/]+)\/debug\/reorder-card$/);
      if (reorderCardMatch && method === 'POST') {
        const gameId = reorderCardMatch[1];
        const { cardId, targetIndex } = body as { cardId: number; targetIndex: number };
        return await handleReorderCard(this.#store, gameId, cardId, targetIndex);
      }

      // POST /games/:gameId/debug/transfer-card - Transfer card to another deck (debug only)
      const transferCardMatch = path.match(/^\/games\/([^/]+)\/debug\/transfer-card$/);
      if (transferCardMatch && method === 'POST') {
        const gameId = transferCardMatch[1];
        const { cardId, targetDeckId, position } = body as { cardId: number; targetDeckId: number; position?: 'first' | 'last' };
        return await handleTransferCard(this.#store, gameId, cardId, targetDeckId, position);
      }

      // POST /games/:gameId/debug/shuffle-deck - Shuffle a deck (debug only)
      const shuffleDeckMatch = path.match(/^\/games\/([^/]+)\/debug\/shuffle-deck$/);
      if (shuffleDeckMatch && method === 'POST') {
        const gameId = shuffleDeckMatch[1];
        const { deckId } = body as { deckId: number };
        return await handleShuffleDeck(this.#store, gameId, deckId);
      }

      // ============================================
      // Deferred Choices Route
      // ============================================

      // POST /games/:gameId/deferred-choices - Get choices for deferred selections
      const deferredChoicesMatch = path.match(/^\/games\/([^/]+)\/deferred-choices$/);
      if (deferredChoicesMatch && method === 'POST') {
        const gameId = deferredChoicesMatch[1];
        const { action, selection, player, currentArgs } = body as {
          action: string;
          selection: string;
          player: number;
          currentArgs?: Record<string, unknown>;
        };
        return await handleGetDeferredChoices(this.#store, gameId, action, selection, player, currentArgs || {});
      }

      // POST /games/:gameId/undo - Undo to turn start
      const undoMatch = path.match(/^\/games\/([^/]+)\/undo$/);
      if (undoMatch && method === 'POST') {
        const gameId = undoMatch[1];
        const playerPosition = (body as { player?: number })?.player ?? 0;
        return await handleUndo(this.#store, gameId, playerPosition);
      }

      // POST /games/:gameId/restart - Restart game
      const restartMatch = path.match(/^\/games\/([^/]+)\/restart$/);
      if (restartMatch && method === 'POST') {
        const gameId = restartMatch[1];
        return await handleRestart(this.#store, this.#registry, gameId, this.#aiConfig);
      }

      // GET /games/:gameId/lobby - Get lobby state
      const lobbyMatch = path.match(/^\/games\/([^/]+)\/lobby$/);
      if (lobbyMatch && method === 'GET') {
        const gameId = lobbyMatch[1];
        return await handleGetLobby(this.#store, gameId);
      }

      // POST /games/:gameId/claim-position - Claim a position in the lobby
      const claimMatch = path.match(/^\/games\/([^/]+)\/claim-position$/);
      if (claimMatch && method === 'POST') {
        const gameId = claimMatch[1];
        return await handleClaimPosition(this.#store, gameId, body as ClaimPositionRequest);
      }

      // POST /games/:gameId/update-name - Update player name in lobby
      const updateNameLobbyMatch = path.match(/^\/games\/([^/]+)\/update-name$/);
      if (updateNameLobbyMatch && method === 'POST') {
        const gameId = updateNameLobbyMatch[1];
        const { playerId, name } = body as { playerId: string; name: string };
        return await handleUpdateName(this.#store, gameId, playerId, name);
      }

      // POST /games/:gameId/set-ready - Set player ready state
      const setReadyMatch = path.match(/^\/games\/([^/]+)\/set-ready$/);
      if (setReadyMatch && method === 'POST') {
        const gameId = setReadyMatch[1];
        const { playerId, ready } = body as { playerId: string; ready: boolean };
        return await handleSetReady(this.#store, gameId, playerId, ready);
      }

      // POST /games/:gameId/add-slot - Add a player slot (host only)
      const addSlotMatch = path.match(/^\/games\/([^/]+)\/add-slot$/);
      if (addSlotMatch && method === 'POST') {
        const gameId = addSlotMatch[1];
        const { playerId } = body as { playerId: string };
        return await handleAddSlot(this.#store, gameId, playerId);
      }

      // POST /games/:gameId/remove-slot - Remove a player slot (host only)
      const removeSlotMatch = path.match(/^\/games\/([^/]+)\/remove-slot$/);
      if (removeSlotMatch && method === 'POST') {
        const gameId = removeSlotMatch[1];
        const { playerId, position } = body as { playerId: string; position: number };
        return await handleRemoveSlot(this.#store, gameId, playerId, position);
      }

      // POST /games/:gameId/set-slot-ai - Toggle slot between open and AI (host only)
      const setSlotAIMatch = path.match(/^\/games\/([^/]+)\/set-slot-ai$/);
      if (setSlotAIMatch && method === 'POST') {
        const gameId = setSlotAIMatch[1];
        const { playerId, position, isAI, aiLevel } = body as { playerId: string; position: number; isAI: boolean; aiLevel?: string };
        return await handleSetSlotAI(this.#store, gameId, playerId, position, isAI, aiLevel);
      }

      // POST /games/:gameId/leave-position - Leave/unclaim position in lobby (non-hosts)
      const leavePositionMatch = path.match(/^\/games\/([^/]+)\/leave-position$/);
      if (leavePositionMatch && method === 'POST') {
        const gameId = leavePositionMatch[1];
        const { playerId } = body as { playerId: string };
        return await handleLeavePosition(this.#store, gameId, playerId);
      }

      // POST /games/:gameId/kick-player - Kick a player from lobby (host only)
      const kickPlayerMatch = path.match(/^\/games\/([^/]+)\/kick-player$/);
      if (kickPlayerMatch && method === 'POST') {
        const gameId = kickPlayerMatch[1];
        const { playerId, position } = body as { playerId: string; position: number };
        return await handleKickPlayer(this.#store, gameId, playerId, position);
      }

      // POST /games/:gameId/player-options - Update player's options (color, etc.)
      const playerOptionsMatch = path.match(/^\/games\/([^/]+)\/player-options$/);
      if (playerOptionsMatch && method === 'POST') {
        const gameId = playerOptionsMatch[1];
        const { playerId, options } = body as { playerId: string; options: Record<string, unknown> };
        return await handleUpdatePlayerOptions(this.#store, gameId, playerId, options);
      }

      // POST /games/:gameId/game-options - Update game options (host only)
      const gameOptionsMatch = path.match(/^\/games\/([^/]+)\/game-options$/);
      if (gameOptionsMatch && method === 'POST') {
        const gameId = gameOptionsMatch[1];
        const { playerId, options } = body as { playerId: string; options: Record<string, unknown> };
        return await handleUpdateGameOptions(this.#store, gameId, playerId, options);
      }

      // POST /games/:gameId/slot-player-options - Update a slot's player options (host only)
      const slotPlayerOptionsMatch = path.match(/^\/games\/([^/]+)\/slot-player-options$/);
      if (slotPlayerOptionsMatch && method === 'POST') {
        const gameId = slotPlayerOptionsMatch[1];
        const { playerId, position, options } = body as { playerId: string; position: number; options: Record<string, unknown> };
        return await handleUpdateSlotPlayerOptions(this.#store, gameId, playerId, position, options);
      }

      // PUT /games/:gameId/players/:position/name - Update player name
      const updateNameMatch = path.match(/^\/games\/([^/]+)\/players\/(\d+)\/name$/);
      if (updateNameMatch && method === 'PUT') {
        const gameId = updateNameMatch[1];
        const position = parseInt(updateNameMatch[2], 10);
        const newName = (body as { name?: string })?.name;
        if (!newName) {
          return { status: 400, body: { success: false, error: 'Name is required' } };
        }
        return await this.#handleUpdatePlayerName(gameId, position, newName);
      }

      // Matchmaking routes (only if matchmaking store is provided)
      if (this.#matchmaking) {
        // POST /matchmaking/join
        if (path === '/matchmaking/join' && method === 'POST') {
          // Default createGame callback uses the store
          const createGame: CreateGameCallback = async (gameType, playerCount, playerNames, playerIds) => {
            const gameId = generateGameId();
            await this.#store.createGame(gameId, {
              gameType,
              playerCount,
              playerNames,
              playerIds,
            });
            return gameId;
          };

          return await handleMatchmakingJoin(
            this.#matchmaking,
            this.#registry,
            body as any,
            createGame
          );
        }

        // GET /matchmaking/status
        if (path === '/matchmaking/status' && method === 'GET') {
          const playerId = query.playerId;
          if (!playerId) {
            return { status: 400, body: { success: false, error: 'playerId required' } };
          }
          return await handleMatchmakingStatus(this.#matchmaking, playerId);
        }

        // POST /matchmaking/leave
        if (path === '/matchmaking/leave' && method === 'POST') {
          const playerId = (body as { playerId?: string })?.playerId;
          if (!playerId) {
            return { status: 400, body: { success: false, error: 'playerId required' } };
          }
          return await handleMatchmakingLeave(this.#matchmaking, playerId);
        }
      }

      // GET /health - Health check
      if (path === '/health') {
        return handleHealth(this.#environment);
      }

      return notFound();
    } catch (error) {
      console.error('Server error:', error);
      return serverError(error);
    }
  }

  /**
   * Handle a WebSocket message for a game session
   */
  async handleWebSocketMessage(
    session: WebSocketSession,
    gameId: string,
    message: WebSocketMessage
  ): Promise<void> {
    const gameSession = await this.#store.getGame(gameId);

    switch (message.type) {
      case 'action':
        if (session.isSpectator) {
          session.ws.send({
            type: 'actionResult',
            requestId: message.requestId,
            success: false,
            error: 'Spectators cannot perform actions',
          });
          return;
        }

        if (!gameSession) {
          session.ws.send({
            type: 'actionResult',
            requestId: message.requestId,
            success: false,
            error: 'Game not found',
          });
          return;
        }

        const result = await gameSession.performAction(
          message.action!,
          session.playerPosition,
          message.args || {}
        );

        // Always send action result back to the requesting client
        session.ws.send({
          type: 'actionResult',
          requestId: message.requestId,
          success: result.success,
          error: result.error,
          data: result.data,
          message: result.message,
        });
        // Success case: broadcast of state update happens automatically in GameSession
        break;

      case 'getState':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        const effectivePosition = session.isSpectator ? 0 : session.playerPosition;
        const stateResult = gameSession.getState(effectivePosition);
        const flowState = gameSession.getFlowState();
        session.ws.send({
          type: 'state',
          flowState,
          state: stateResult.state,
          playerPosition: session.playerPosition,
          isSpectator: session.isSpectator,
        });
        break;

      case 'ping':
        session.ws.send({ type: 'pong', timestamp: Date.now() });
        break;

      case 'getLobby':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        const lobbyInfo = gameSession.getLobbyInfo();
        if (lobbyInfo) {
          session.ws.send({ type: 'lobby', lobby: lobbyInfo });
        } else {
          session.ws.send({ type: 'error', error: 'Game does not have a lobby' });
        }
        break;

      case 'claimPosition':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (message.position === undefined || message.name === undefined || !session.playerId) {
          session.ws.send({ type: 'error', error: 'Position, name, and playerId are required' });
          return;
        }

        const claimResult = await gameSession.claimPosition(
          message.position,
          session.playerId,
          message.name
        );

        if (!claimResult.success) {
          session.ws.send({ type: 'error', error: claimResult.error });
        }
        // Success: broadcast happens automatically in GameSession.claimPosition
        break;

      case 'updateName':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || !message.name) {
          session.ws.send({ type: 'error', error: 'PlayerId and name are required' });
          return;
        }

        const nameResult = await gameSession.updateSlotName(session.playerId, message.name);
        if (!nameResult.success) {
          session.ws.send({ type: 'error', error: nameResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'setReady':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || message.ready === undefined) {
          session.ws.send({ type: 'error', error: 'PlayerId and ready state are required' });
          return;
        }

        const readyResult = await gameSession.setReady(session.playerId, message.ready);
        if (!readyResult.success) {
          session.ws.send({ type: 'error', error: readyResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'addSlot':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId) {
          session.ws.send({ type: 'error', error: 'PlayerId is required' });
          return;
        }

        const addSlotResult = await gameSession.addSlot(session.playerId);
        if (!addSlotResult.success) {
          session.ws.send({ type: 'error', error: addSlotResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'removeSlot':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || message.position === undefined) {
          session.ws.send({ type: 'error', error: 'PlayerId and position are required' });
          return;
        }

        const removeSlotResult = await gameSession.removeSlot(session.playerId, message.position);
        if (!removeSlotResult.success) {
          session.ws.send({ type: 'error', error: removeSlotResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'setSlotAI':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || message.position === undefined || message.isAI === undefined) {
          session.ws.send({ type: 'error', error: 'PlayerId, position, and isAI are required' });
          return;
        }

        const setSlotAIResult = await gameSession.setSlotAI(
          session.playerId,
          message.position,
          message.isAI,
          message.aiLevel
        );
        if (!setSlotAIResult.success) {
          session.ws.send({ type: 'error', error: setSlotAIResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'leavePosition':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId) {
          session.ws.send({ type: 'error', error: 'PlayerId is required' });
          return;
        }

        const leavePositionResult = await gameSession.leavePosition(session.playerId);
        if (!leavePositionResult.success) {
          session.ws.send({ type: 'error', error: leavePositionResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'kickPlayer':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || message.position === undefined) {
          session.ws.send({ type: 'error', error: 'PlayerId and position are required' });
          return;
        }

        const kickPlayerResult = await gameSession.kickPlayer(session.playerId, message.position);
        if (!kickPlayerResult.success) {
          session.ws.send({ type: 'error', error: kickPlayerResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'updatePlayerOptions':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || !message.playerOptions) {
          session.ws.send({ type: 'error', error: 'PlayerId and playerOptions are required' });
          return;
        }

        const updateOptionsResult = await gameSession.updatePlayerOptions(
          session.playerId,
          message.playerOptions
        );
        if (!updateOptionsResult.success) {
          session.ws.send({ type: 'error', error: updateOptionsResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'updateSlotPlayerOptions':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || message.position === undefined || !message.playerOptions) {
          session.ws.send({ type: 'error', error: 'PlayerId, position, and playerOptions are required' });
          return;
        }

        const updateSlotOptionsResult = await gameSession.updateSlotPlayerOptions(
          session.playerId,
          message.position,
          message.playerOptions
        );
        if (!updateSlotOptionsResult.success) {
          session.ws.send({ type: 'error', error: updateSlotOptionsResult.error });
        }
        // Success: broadcast happens automatically
        break;

      case 'updateGameOptions':
        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        if (!session.playerId || !message.gameOptions) {
          session.ws.send({ type: 'error', error: 'PlayerId and gameOptions are required' });
          return;
        }

        const updateGameOptionsResult = await gameSession.updateGameOptions(
          session.playerId,
          message.gameOptions
        );
        if (!updateGameOptionsResult.success) {
          session.ws.send({ type: 'error', error: updateGameOptionsResult.error });
        }
        // Success: broadcast happens automatically
        break;
    }
  }

  /**
   * Get initial state to send when a WebSocket connects
   */
  async getWebSocketInitialState(
    gameId: string,
    playerPosition: number,
    isSpectator: boolean
  ): Promise<{ type: string; flowState: unknown; state: unknown; playerPosition: number; isSpectator: boolean } | null> {
    const gameSession = await this.#store.getGame(gameId);
    if (!gameSession) {
      return null;
    }

    const effectivePosition = isSpectator ? 0 : playerPosition;
    const stateResult = gameSession.getState(effectivePosition);
    const flowState = gameSession.getFlowState();

    // Send PlayerGameState (stateResult.state contains players, view, canUndo, etc.)
    return {
      type: 'state',
      flowState,
      state: stateResult.state,
      playerPosition,
      isSpectator,
    };
  }

  /**
   * Get the game store (for platform-specific operations)
   */
  get store(): GameStore {
    return this.#store;
  }

  /**
   * Get the game registry (for platform-specific operations)
   */
  get registry(): GameRegistry {
    return this.#registry;
  }

  /**
   * Handle PUT /games/:gameId/players/:position/name - Update player name
   */
  async #handleUpdatePlayerName(gameId: string, position: number, name: string): Promise<ServerResponse> {
    const gameSession = await this.#store.getGame(gameId);
    if (!gameSession) {
      return { status: 404, body: { success: false, error: 'Game not found' } };
    }

    try {
      gameSession.updatePlayerName(position, name);
      return { status: 200, body: { success: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update player name';
      return { status: 400, body: { success: false, error: message } };
    }
  }

  #handleGetDefinitions(): ServerResponse {
    const allDefinitions = this.#registry.getAll();

    const definitions = allDefinitions.map((def) => ({
      gameType: def.gameType,
      displayName: def.displayName ?? def.gameType,
      minPlayers: def.minPlayers,
      maxPlayers: def.maxPlayers,
      gameOptions: def.gameOptions ?? {},
      playerOptions: def.playerOptions ?? {},
      presets: def.presets ?? [],
    }));

    return {
      status: 200,
      body: { success: true, definitions },
    };
  }

  #handleListGames(): ServerResponse {
    // Check if store has listGames method (only SqliteGameStore has it)
    if ('listGames' in this.#store && typeof this.#store.listGames === 'function') {
      const gameIds = (this.#store as { listGames: () => string[] }).listGames();
      return {
        status: 200,
        body: { success: true, games: gameIds },
      };
    }

    // In-memory store doesn't support listing (games don't survive restart anyway)
    return {
      status: 200,
      body: { success: true, games: [] },
    };
  }
}
