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
  type ServerRequest,
  type ServerResponse as CoreResponse,
  type GameDefinition,
  type AIConfig,
  type SessionInfo,
  type BroadcastAdapter,
} from '@boardsmith/server';

// ============================================
// WebSocket Broadcast Adapter for Node.js
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
  readonly #core: GameServerCore;
  readonly #store: InMemoryGameStore<WsSession>;
  readonly #registry: SimpleGameRegistry;

  constructor(options: LocalServerOptions) {
    this.#port = options.port;

    // Build registry from definitions
    this.#registry = new SimpleGameRegistry(options.definitions);

    // Create in-memory game store with broadcaster factory
    this.#store = new InMemoryGameStore<WsSession>(
      this.#registry,
      () => new WsBroadcastAdapter()
    );

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
    this.#registry.set(definition);
    this.#store.updateRegistry?.(definition);
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all WebSocket connections
      for (const client of this.#wss.clients) {
        client.close();
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

    try {
      // Convert Node request to platform-agnostic request
      const serverRequest = await this.#nodeToServerRequest(req);

      // Handle request through core
      const response = await this.#core.handleRequest(serverRequest);

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

    // Get the game's broadcaster
    const broadcaster = this.#store.getBroadcaster(gameId);
    if (!broadcaster) {
      ws.close(4004, 'Game not found');
      return;
    }

    const effectivePosition = isSpectator ? 0 : playerPosition;

    // Add session to broadcaster
    (broadcaster as WsBroadcastAdapter).addSession(ws, {
      playerPosition,
      isSpectator,
    });

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
            playerPosition,
            isSpectator,
          },
          gameId,
          message
        );
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    });

    ws.on('close', () => {
      (broadcaster as WsBroadcastAdapter).removeSession(ws);
    });
  }
}

export function createLocalServer(options: LocalServerOptions): LocalServer {
  return new LocalServer(options);
}

// Re-export types from server for convenience
export type { GameDefinition, AIConfig };
