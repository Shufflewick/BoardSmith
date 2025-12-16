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
  handleUndo,
  handleRestart,
  handleHealth,
} from './handlers/games.js';

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
          session.ws.send({ type: 'error', error: 'Spectators cannot perform actions' });
          return;
        }

        if (!gameSession) {
          session.ws.send({ type: 'error', error: 'Game not found' });
          return;
        }

        const result = await gameSession.performAction(
          message.action!,
          session.playerPosition,
          message.args || {}
        );

        if (!result.success) {
          session.ws.send({ type: 'error', error: result.error });
        }
        // Success case: broadcast happens automatically in GameSession
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
}
