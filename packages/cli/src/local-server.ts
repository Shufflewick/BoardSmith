/**
 * Local development server for BoardSmith games
 * Provides the same HTTP/WebSocket API as the production worker
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  GameSession,
  generateGameId,
  type GameDefinition,
  type SessionInfo,
  type BroadcastAdapter,
  type AIConfig,
  type CreateGameRequest,
  type ActionRequest,
} from '@boardsmith/session';

// ============================================
// WebSocket Broadcast Adapter
// ============================================

interface WsSession extends SessionInfo {
  ws: WebSocket;
}

class WsBroadcastAdapter implements BroadcastAdapter<WsSession> {
  readonly #sessions = new Map<WebSocket, WsSession>();

  addSession(ws: WebSocket, info: SessionInfo): void {
    this.#sessions.set(ws, { ...info, ws });
  }

  removeSession(ws: WebSocket): void {
    this.#sessions.delete(ws);
  }

  getSessions(): WsSession[] {
    return [...this.#sessions.values()];
  }

  send(session: WsSession, message: unknown): void {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(message));
    }
  }

  /** Broadcast a message to all connected sessions */
  broadcast(message: unknown): void {
    const json = JSON.stringify(message);
    for (const session of this.#sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(json);
      }
    }
  }
}

// ============================================
// Game Session Wrapper (adds broadcasting)
// ============================================

interface GameSessionWithBroadcaster {
  session: GameSession;
  broadcaster: WsBroadcastAdapter;
}

// ============================================
// Local Server
// ============================================

export interface LocalServerOptions {
  port: number;
  definitions: GameDefinition[];
  onReady?: (port: number) => void;
  aiConfig?: AIConfig;
}

export class LocalServer {
  readonly #server: Server;
  readonly #wss: WebSocketServer;
  readonly #port: number;
  readonly #gameRegistry: Map<string, GameDefinition> = new Map();
  readonly #games: Map<string, GameSessionWithBroadcaster> = new Map();
  readonly #aiConfig?: AIConfig;

  constructor(options: LocalServerOptions) {
    this.#port = options.port;
    this.#aiConfig = options.aiConfig;

    // Build registry
    for (const def of options.definitions) {
      this.#gameRegistry.set(def.gameType, def);
    }

    // Create HTTP server
    this.#server = createServer((req, res) => this.#handleRequest(req, res));

    // Create WebSocket server
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#wss.on('connection', (ws, req) => this.#handleWebSocket(ws, req));

    // Start listening
    this.#server.listen(this.#port, () => {
      options.onReady?.(this.#port);
    });
  }

  updateDefinition(definition: GameDefinition): void {
    // Update the registry
    this.#gameRegistry.set(definition.gameType, definition);

    // For each active game of this type, reload the game instance
    for (const [gameId, gameData] of this.#games.entries()) {
      if (gameData.session.runner.game.constructor.name === definition.gameClass.name) {
        // Note: We can't hot-swap the running game instance without losing state
        // Instead, just update the registry so new games use the new definition
        // Existing games continue with their current instance
        console.log(`  Game ${gameId} will continue with current rules (restart to apply changes)`);
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all WebSocket connections
      for (const { broadcaster } of this.#games.values()) {
        for (const session of broadcaster.getSessions()) {
          session.ws.close();
        }
      }

      this.#wss.close(() => {
        this.#server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${this.#port}`);
    const path = url.pathname;

    try {
      // POST /games - Create a new game
      if (path === '/games' && req.method === 'POST') {
        const body = await this.#readBody<CreateGameRequest>(req);
        const result = this.#createGame(body);

        if (result.success) {
          this.#sendJson(res, 201, result);
        } else {
          this.#sendJson(res, 400, result);
        }
        return;
      }

      // GET /games/:gameId - Get game state
      const getGameMatch = path.match(/^\/games\/([^/]+)$/);
      if (getGameMatch && req.method === 'GET') {
        const gameId = getGameMatch[1];
        const playerParam = url.searchParams.get('player');
        const player = playerParam ? parseInt(playerParam, 10) : 0;

        const gameData = this.#games.get(gameId);
        if (!gameData) {
          this.#sendJson(res, 404, { success: false, error: 'Game not found' });
          return;
        }

        const result = gameData.session.getState(player);
        this.#sendJson(res, 200, result);
        return;
      }

      // POST /games/:gameId/action - Perform an action
      const actionMatch = path.match(/^\/games\/([^/]+)\/action$/);
      if (actionMatch && req.method === 'POST') {
        const gameId = actionMatch[1];
        const body = await this.#readBody<ActionRequest>(req);

        const gameData = this.#games.get(gameId);
        if (!gameData) {
          this.#sendJson(res, 404, { success: false, error: 'Game not found' });
          return;
        }

        const result = await gameData.session.performAction(body.action, body.player, body.args);
        if (result.success) {
          this.#sendJson(res, 200, result);
        } else {
          this.#sendJson(res, 400, result);
        }
        return;
      }

      // GET /games/:gameId/history - Get action history
      const historyMatch = path.match(/^\/games\/([^/]+)\/history$/);
      if (historyMatch && req.method === 'GET') {
        const gameId = historyMatch[1];

        const gameData = this.#games.get(gameId);
        if (!gameData) {
          this.#sendJson(res, 404, { success: false, error: 'Game not found' });
          return;
        }

        const history = gameData.session.getHistory();
        this.#sendJson(res, 200, { success: true, ...history });
        return;
      }

      // GET /games/:gameId/state-at/:actionIndex - Get state at a specific action (for time travel)
      const stateAtMatch = path.match(/^\/games\/([^/]+)\/state-at\/(\d+)$/);
      if (stateAtMatch && req.method === 'GET') {
        const gameId = stateAtMatch[1];
        const actionIndex = parseInt(stateAtMatch[2], 10);
        const urlObj = new URL(req.url || '', `http://localhost:${this.#port}`);
        const playerPosition = parseInt(urlObj.searchParams.get('player') || '0', 10);

        const gameData = this.#games.get(gameId);
        if (!gameData) {
          this.#sendJson(res, 404, { success: false, error: 'Game not found' });
          return;
        }

        const result = gameData.session.getStateAtAction(actionIndex, playerPosition);
        if (result.success) {
          this.#sendJson(res, 200, { success: true, state: result.state, actionIndex });
        } else {
          this.#sendJson(res, 400, { success: false, error: result.error });
        }
        return;
      }

      // POST /games/:gameId/restart - Restart game with same players
      const restartMatch = path.match(/^\/games\/([^/]+)\/restart$/);
      if (restartMatch && req.method === 'POST') {
        const gameId = restartMatch[1];

        const gameData = this.#games.get(gameId);
        if (!gameData) {
          this.#sendJson(res, 404, { success: false, error: 'Game not found' });
          return;
        }

        const result = this.#restartGame(gameId, gameData);
        if (result.success) {
          this.#sendJson(res, 200, result);
        } else {
          this.#sendJson(res, 400, result);
        }
        return;
      }

      // GET /health - Health check
      if (path === '/health') {
        this.#sendJson(res, 200, { status: 'ok', environment: 'development' });
        return;
      }

      this.#sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      console.error('Server error:', error);
      this.#sendJson(res, 500, {
        success: false,
        error: error instanceof Error ? error.message : 'Internal error',
      });
    }
  }

  #createGame(request: CreateGameRequest): {
    success: boolean;
    gameId?: string;
    error?: string;
    flowState?: unknown;
    state?: unknown;
  } {
    const { gameType, playerCount, playerNames, seed } = request;

    const definition = this.#gameRegistry.get(gameType);
    if (!definition) {
      return {
        success: false,
        error: `Unknown game type: ${gameType}. Available: ${[...this.#gameRegistry.keys()].join(', ')}`,
      };
    }

    if (playerCount < definition.minPlayers || playerCount > definition.maxPlayers) {
      return {
        success: false,
        error: `Player count must be between ${definition.minPlayers} and ${definition.maxPlayers}`,
      };
    }

    const gameId = generateGameId();
    const names = playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);

    // Create session using the host package
    const session = GameSession.create({
      gameType,
      GameClass: definition.gameClass,
      playerCount,
      playerNames: names,
      seed,
      aiConfig: this.#aiConfig,
    });

    // Set up broadcasting
    const broadcaster = new WsBroadcastAdapter();
    session.setBroadcaster(broadcaster);

    this.#games.set(gameId, { session, broadcaster });

    const state = session.getState(0);

    return {
      success: true,
      gameId,
      flowState: state.flowState,
      state: state.state,
    };
  }

  #restartGame(
    gameId: string,
    oldGameData: { session: GameSession<any>; broadcaster: WsBroadcastAdapter }
  ): {
    success: boolean;
    error?: string;
    flowState?: unknown;
    state?: unknown;
  } {
    // Get the original game configuration
    const oldSession = oldGameData.session;
    const gameType = oldSession.gameType;
    const playerNames = oldSession.playerNames;
    const playerCount = playerNames.length;

    const definition = this.#gameRegistry.get(gameType);
    if (!definition) {
      return {
        success: false,
        error: `Unknown game type: ${gameType}`,
      };
    }

    // Create a new session with the same configuration but fresh state
    const session = GameSession.create({
      gameType,
      GameClass: definition.gameClass,
      playerCount,
      playerNames,
      // Use a new random seed for variety
      seed: undefined,
      aiConfig: this.#aiConfig,
    });

    // Reuse the existing broadcaster so connected clients get updates
    const broadcaster = oldGameData.broadcaster;
    session.setBroadcaster(broadcaster);

    // Replace the old game with the new one
    this.#games.set(gameId, { session, broadcaster });

    // Get the initial state and broadcast to all connected clients
    const state = session.getState(0);

    // Broadcast the restart to all connected clients
    broadcaster.broadcast({
      type: 'restart',
      flowState: state.flowState,
      state: state.state,
    });

    return {
      success: true,
      flowState: state.flowState,
      state: state.state,
    };
  }

  async #handleWebSocket(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.#port}`);

    const match = url.pathname.match(/^\/games\/([^/]+)$/);
    if (!match) {
      ws.close(4000, 'Invalid WebSocket path');
      return;
    }

    const gameId = match[1];
    const playerParam = url.searchParams.get('player');
    const playerPosition = playerParam ? parseInt(playerParam, 10) : 0;
    const isSpectator = url.searchParams.get('spectator') === 'true';

    const gameData = this.#games.get(gameId);
    if (!gameData) {
      ws.close(4004, 'Game not found');
      return;
    }

    const { session, broadcaster } = gameData;
    const effectivePosition = isSpectator ? 0 : playerPosition;

    // Add session to broadcaster
    broadcaster.addSession(ws, {
      playerPosition,
      isSpectator,
    });

    // Send initial state
    const initialState = session.getState(effectivePosition);
    ws.send(JSON.stringify({
      type: 'state',
      flowState: initialState.flowState,
      state: initialState.state,
      playerPosition,
      isSpectator,
    }));

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case 'action':
            if (isSpectator) {
              ws.send(JSON.stringify({ type: 'error', error: 'Spectators cannot perform actions' }));
              return;
            }

            const result = await session.performAction(
              message.action,
              playerPosition,
              message.args || {}
            );

            if (!result.success) {
              ws.send(JSON.stringify({ type: 'error', error: result.error }));
            }
            // Success case: broadcast happens automatically in GameSession
            break;

          case 'getState':
            const state = session.getState(effectivePosition);
            ws.send(JSON.stringify({
              type: 'state',
              flowState: state.flowState,
              state: state.state,
              playerPosition,
              isSpectator,
            }));
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    });

    ws.on('close', () => {
      broadcaster.removeSession(ws);
    });
  }

  #readBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  #sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

export function createLocalServer(options: LocalServerOptions): LocalServer {
  return new LocalServer(options);
}

// Re-export types from host for convenience
export type { GameDefinition, AIConfig };
