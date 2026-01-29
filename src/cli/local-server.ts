/**
 * Local development server for BoardSmith games
 * Uses the shared @boardsmith/server core with Node.js HTTP and WebSocket adapters
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  GameServerCore,
  InMemoryGameStore,
  InMemoryMatchmakingStore,
  SimpleGameRegistry,
  SqliteGameStore,
  type ServerRequest,
  type ServerResponse as CoreResponse,
  type GameDefinition,
  type AIConfig,
  type SessionInfo,
  type BroadcastAdapter,
  type GameStore,
} from '../server/index.js';

// ============================================
// WebSocket Broadcast Adapter for Node.js
// ============================================

interface WsSession extends SessionInfo {
  ws: WebSocket;
  playerId?: string;
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
// Local Server
// ============================================

export interface LocalServerOptions {
  port: number;
  host?: string;
  definitions: GameDefinition[];
  onReady?: (port: number) => void;
  aiConfig?: AIConfig;
  /**
   * Path to SQLite database for persistent game storage.
   * If true, uses default path '.boardsmith/games.db'.
   * If false or undefined, uses in-memory storage (games lost on restart).
   */
  persist?: string | boolean;
  /**
   * Enable debug mode for verbose logging of actions, flow, and commands.
   */
  debug?: boolean;
}

export class LocalServer {
  readonly #server: Server;
  readonly #wss: WebSocketServer;
  readonly #port: number;
  readonly #core: GameServerCore;
  readonly #store: InMemoryGameStore<WsSession> | SqliteGameStore<WsSession>;
  readonly #registry: SimpleGameRegistry;
  readonly #readyPromise: Promise<void>;
  readonly #isPersistent: boolean;
  readonly #debug: boolean;

  /** Promise that resolves when the server is ready to accept connections */
  get ready(): Promise<void> {
    return this.#readyPromise;
  }

  /** Whether this server uses SQLite persistence */
  get isPersistent(): boolean {
    return this.#isPersistent;
  }

  /** List all persisted game IDs (only works with SQLite persistence) */
  listPersistedGames(): string[] {
    if (this.#isPersistent && 'listGames' in this.#store) {
      return (this.#store as SqliteGameStore<WsSession>).listGames();
    }
    return [];
  }

  constructor(options: LocalServerOptions) {
    this.#port = options.port;
    this.#debug = options.debug ?? false;

    // Build registry from definitions
    this.#registry = new SimpleGameRegistry(options.definitions);

    // Create game store - SQLite for persistence, in-memory otherwise
    if (options.persist) {
      const dbPath = typeof options.persist === 'string'
        ? options.persist
        : '.boardsmith/games.db';
      this.#store = new SqliteGameStore<WsSession>(
        dbPath,
        this.#registry,
        () => new WsBroadcastAdapter()
      );
      this.#isPersistent = true;
      console.log(`  Using SQLite persistence: ${dbPath}`);
    } else {
      this.#store = new InMemoryGameStore<WsSession>(
        this.#registry,
        () => new WsBroadcastAdapter()
      );
      this.#isPersistent = false;
    }

    // Create in-memory matchmaking store
    const matchmaking = new InMemoryMatchmakingStore();

    // Create the server core
    this.#core = new GameServerCore({
      store: this.#store,
      registry: this.#registry,
      matchmaking,
      aiConfig: options.aiConfig,
      environment: 'development',
    });

    // Create HTTP server with proper async error handling
    this.#server = createServer((req, res) => {
      this.#handleRequest(req, res).catch((error) => {
        console.error('Unhandled request error:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
        }
      });
    });

    // Create WebSocket server
    this.#wss = new WebSocketServer({ server: this.#server });
    this.#wss.on('connection', (ws, req) => this.#handleWebSocket(ws, req));

    // Start listening and create ready promise
    this.#readyPromise = new Promise<void>((resolve) => {
      const listenCallback = () => {
        options.onReady?.(this.#port);
        resolve();
      };
      if (options.host) {
        this.#server.listen(this.#port, options.host, listenCallback);
      } else {
        this.#server.listen(this.#port, listenCallback);
      }
    });
  }

  updateDefinition(definition: GameDefinition): void {
    this.#registry.set(definition);
    this.#store.updateRegistry?.(definition);
  }

  /** Log a debug message if debug mode is enabled */
  #log(...args: unknown[]): void {
    if (this.#debug) {
      console.log('[DEBUG]', ...args);
    }
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all WebSocket connections
      for (const client of this.#wss.clients) {
        client.close();
      }

      this.#wss.close(() => {
        this.#server.close((err) => {
          if (err) {
            reject(err);
          } else {
            // Close SQLite database if using persistence
            if (this.#isPersistent && 'close' in this.#store) {
              (this.#store as SqliteGameStore<WsSession>).close();
            }
            resolve();
          }
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

    try {
      // Convert Node request to platform-agnostic request
      const serverRequest = await this.#nodeToServerRequest(req);

      this.#log(`${serverRequest.method} ${serverRequest.path}`, serverRequest.body);

      // Handle request through core
      const response = await this.#core.handleRequest(serverRequest);

      this.#log(`Response: ${response.status}`, response.body);

      // Send response
      this.#sendResponse(res, response);
    } catch (error) {
      console.error('Server error:', error);
      this.#sendResponse(res, {
        status: 500,
        body: { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      });
    }
  }

  async #nodeToServerRequest(req: IncomingMessage): Promise<ServerRequest> {
    const url = new URL(req.url || '/', `http://localhost:${this.#port}`);

    // Parse query params
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }

    // Read body for POST requests
    let body: unknown = {};
    if (req.method === 'POST') {
      body = await this.#readBody(req);
    }

    return {
      method: req.method || 'GET',
      path: url.pathname,
      query,
      body,
    };
  }

  #readBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  #sendResponse(res: ServerResponse, response: CoreResponse): void {
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
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
    const playerId = url.searchParams.get('playerId') ?? undefined;

    this.#log(`WebSocket connection: game=${gameId}, player=${playerPosition}, spectator=${isSpectator}`);

    // First, ensure the game is loaded (this will restore from SQLite if persisted)
    const game = await this.#store.getGame(gameId);
    if (!game) {
      ws.close(4004, 'Game not found');
      return;
    }

    // Get the game's broadcaster (now guaranteed to exist after getGame)
    const broadcaster = this.#store.getBroadcaster(gameId);
    if (!broadcaster) {
      ws.close(4004, 'Game broadcaster not found');
      return;
    }

    const effectivePosition = isSpectator ? 0 : playerPosition;

    // Add session to broadcaster
    (broadcaster as WsBroadcastAdapter).addSession(ws, {
      playerSeat: playerPosition,
      isSpectator,
      playerId,
    });

    // Mark player as connected in lobby
    if (playerId) {
      const gameSession = await this.#store.getGame(gameId);
      if (gameSession) {
        await gameSession.setPlayerConnected(playerId, true);
      }
    }

    // Send initial state
    const initialState = await this.#core.getWebSocketInitialState(gameId, playerPosition, isSpectator);
    if (initialState) {
      ws.send(JSON.stringify(initialState));
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Create a WebSocket adapter for the core
        const wsAdapter = {
          send: (msg: unknown) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(msg));
            }
          },
          close: (code?: number, reason?: string) => {
            ws.close(code, reason);
          },
        };

        await this.#core.handleWebSocketMessage(
          {
            ws: wsAdapter,
            playerSeat: playerPosition,
            isSpectator,
            playerId,
          },
          gameId,
          message
        );
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    });

    ws.on('close', async () => {
      (broadcaster as WsBroadcastAdapter).removeSession(ws);

      // Mark player as disconnected in lobby (triggers timeout for auto-kick)
      if (playerId) {
        const gameSession = await this.#store.getGame(gameId);
        if (gameSession) {
          await gameSession.setPlayerConnected(playerId, false);
        }
      }
    });
  }
}

export function createLocalServer(options: LocalServerOptions): LocalServer {
  return new LocalServer(options);
}

// Re-export types from server for convenience
export type { GameDefinition, AIConfig };
