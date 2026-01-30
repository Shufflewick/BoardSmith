/**
 * BoardSmith Game Worker
 *
 * Cloudflare Worker library for running board games in a sandboxed environment.
 * Uses Durable Objects for game state persistence and WebSocket connections.
 * Uses KV for matchmaking queues.
 *
 * Now uses @boardsmith/server for shared routing and matchmaking logic.
 *
 * Usage:
 * ```typescript
 * import { gameDefinition } from './my-game-rules';
 * import { createGameWorker, createGameStateDurableObject, buildRegistries } from '@boardsmith/worker';
 *
 * const { gameRegistry, gameConfigRegistry } = buildRegistries([gameDefinition]);
 * export const GameState = createGameStateDurableObject(gameRegistry);
 * export default createGameWorker({ gameRegistry, gameConfigRegistry });
 * ```
 */

import {
  GameSession,
  generateGameId,
  type GameClass,
  type GameDefinition,
  type GameConfig,
  type StoredGameState,
  type PlayerGameState,
  type SessionInfo,
  type AIConfig,
  type BroadcastAdapter,
  type StorageAdapter,
} from '../session/index.js';
import type { FlowState } from '../engine/index.js';
import {
  type MatchmakingStore,
  type QueueEntry,
  type MatchInfo,
  type WaitingInfo,
  type GameRegistry as ServerGameRegistry,
  handleMatchmakingJoin,
  handleMatchmakingStatus,
  handleMatchmakingLeave,
} from '../server/index.js';

// ============================================
// Re-export types from session for convenience
// ============================================

export type {
  GameClass,
  GameDefinition,
  GameConfig,
  StoredGameState,
  PlayerGameState,
  AIConfig,
} from '../session/index.js';

// ============================================
// Worker-specific Types
// ============================================

export interface GameRegistry {
  [gameType: string]: GameClass;
}

export interface GameConfigRegistry {
  [gameType: string]: GameConfig;
}

export interface Env {
  GAME_STATE: DurableObjectNamespace;
  MATCHMAKING: KVNamespace;
  ENVIRONMENT: string;
}

export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
}

export interface ActionRequest {
  action: string;
  player: number;
  args: Record<string, unknown>;
}

export interface MatchmakingRequest {
  gameType: string;
  playerCount: number;
  playerId: string;
  playerName?: string;
}

export interface GameResponse {
  success: boolean;
  gameId?: string;
  state?: PlayerGameState;
  flowState?: FlowState;
  error?: string;
}

export interface WebSocketMessage {
  type: 'action' | 'ping' | 'getState';
  action?: string;
  args?: Record<string, unknown>;
  /** Request ID for action request/response correlation */
  requestId?: string;
}

export interface WebSocketSession extends SessionInfo {
  /** Player seat (1-indexed). Alias for compatibility with SessionInfo. */
  playerSeat: number;
  /** Player position (1-indexed). Same as playerSeat, used in worker code. */
  playerPosition: number;
}

export interface WorkerConfig {
  gameRegistry: GameRegistry;
  gameConfigRegistry: GameConfigRegistry;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Build game and config registries from an array of game definitions.
 */
export function buildRegistries(definitions: GameDefinition[]): {
  gameRegistry: GameRegistry;
  gameConfigRegistry: GameConfigRegistry;
} {
  const gameRegistry: GameRegistry = {};
  const gameConfigRegistry: GameConfigRegistry = {};

  for (const def of definitions) {
    gameRegistry[def.gameType] = def.gameClass;
    gameConfigRegistry[def.gameType] = {
      minPlayers: def.minPlayers,
      maxPlayers: def.maxPlayers,
    };
  }

  return { gameRegistry, gameConfigRegistry };
}

// ============================================
// Storage Adapter for Durable Objects
// ============================================

class DurableObjectStorageAdapter implements StorageAdapter {
  readonly #state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async save(gameState: StoredGameState): Promise<void> {
    await this.#state.storage.put('game', gameState);
  }

  async load(): Promise<StoredGameState | null> {
    const stored = await this.#state.storage.get<StoredGameState>('game');
    return stored ?? null;
  }
}

// ============================================
// Broadcast Adapter for Cloudflare WebSockets
// ============================================

class CloudflareBroadcastAdapter implements BroadcastAdapter<WebSocketSession> {
  readonly #state: DurableObjectState;
  readonly #sessions: Map<WebSocket, WebSocketSession>;

  constructor(state: DurableObjectState, sessions: Map<WebSocket, WebSocketSession>) {
    this.#state = state;
    this.#sessions = sessions;
  }

  getSessions(): WebSocketSession[] {
    const webSockets = this.#state.getWebSockets();
    const sessions: WebSocketSession[] = [];

    for (const ws of webSockets) {
      let session = this.#sessions.get(ws);
      if (!session) {
        session = getWebSocketSession(ws);
        if (session) {
          this.#sessions.set(ws, session);
        }
      }
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  send(session: WebSocketSession, message: unknown): void {
    // Find the WebSocket for this session
    const webSockets = this.#state.getWebSockets();
    for (const ws of webSockets) {
      const wsSession = this.#sessions.get(ws) ?? getWebSocketSession(ws);
      if (wsSession && wsSession.playerPosition === session.playerPosition && wsSession.isSpectator === session.isSpectator) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          console.error('Send error:', error);
        }
        break;
      }
    }
  }
}

// ============================================
// Cloudflare KV Matchmaking Store Adapter
// ============================================

/**
 * Adapter that implements MatchmakingStore using Cloudflare KV.
 */
class CloudflareKVMatchmakingStore implements MatchmakingStore {
  readonly #kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.#kv = kv;
  }

  #queueKey(gameType: string, playerCount: number): string {
    return `queue:${gameType}:${playerCount}`;
  }

  async getQueue(gameType: string, playerCount: number): Promise<QueueEntry[]> {
    const key = this.#queueKey(gameType, playerCount);
    const data = await this.#kv.get(key);
    return data ? JSON.parse(data) : [];
  }

  async setQueue(gameType: string, playerCount: number, entries: QueueEntry[]): Promise<void> {
    const key = this.#queueKey(gameType, playerCount);
    await this.#kv.put(key, JSON.stringify(entries));
  }

  async getMatch(playerId: string): Promise<MatchInfo | null> {
    const data = await this.#kv.get(`match:${playerId}`);
    return data ? JSON.parse(data) : null;
  }

  async setMatch(playerId: string, match: MatchInfo, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = ttlSeconds ? { expirationTtl: ttlSeconds } : {};
    await this.#kv.put(`match:${playerId}`, JSON.stringify(match), options);
  }

  async deleteMatch(playerId: string): Promise<void> {
    await this.#kv.delete(`match:${playerId}`);
  }

  async getWaiting(playerId: string): Promise<WaitingInfo | null> {
    const data = await this.#kv.get(`waiting:${playerId}`);
    return data ? JSON.parse(data) : null;
  }

  async setWaiting(playerId: string, info: WaitingInfo, ttlSeconds?: number): Promise<void> {
    const options: KVNamespacePutOptions = ttlSeconds ? { expirationTtl: ttlSeconds } : {};
    await this.#kv.put(`waiting:${playerId}`, JSON.stringify(info), options);
  }

  async deleteWaiting(playerId: string): Promise<void> {
    await this.#kv.delete(`waiting:${playerId}`);
  }
}

// ============================================
// Worker Game Registry Adapter
// ============================================

/**
 * Adapter that wraps the worker's GameRegistry to implement the server's GameRegistry interface.
 */
class WorkerGameRegistryAdapter implements ServerGameRegistry {
  readonly #registry: GameRegistry;
  readonly #configRegistry: GameConfigRegistry;

  constructor(registry: GameRegistry, configRegistry: GameConfigRegistry) {
    this.#registry = registry;
    this.#configRegistry = configRegistry;
  }

  get(gameType: string): GameDefinition | undefined {
    const GameClass = this.#registry[gameType];
    if (!GameClass) return undefined;

    const config = this.#configRegistry[gameType] || { minPlayers: 2, maxPlayers: 6 };
    return {
      gameType,
      gameClass: GameClass,
      minPlayers: config.minPlayers,
      maxPlayers: config.maxPlayers,
    };
  }

  getAll(): GameDefinition[] {
    return Object.keys(this.#registry).map(gameType => this.get(gameType)!).filter(Boolean);
  }

  set(_definition: GameDefinition): void {
    // Not supported in worker - registry is read-only
    throw new Error('Worker game registry is read-only');
  }
}

// ============================================
// Worker Factory
// ============================================

/**
 * Create a Cloudflare Worker that handles game requests.
 * Pass in registries built from your game definitions.
 */
export function createGameWorker(config: WorkerConfig) {
  const { gameRegistry, gameConfigRegistry } = config;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
  };

  // Create registry adapter for shared handlers
  const registryAdapter = new WorkerGameRegistryAdapter(gameRegistry, gameConfigRegistry);

  async function handleCreateGame(
    body: CreateGameRequest,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const { gameType, playerCount, playerNames, playerIds, seed, aiPlayers, aiLevel } = body;

    if (!gameRegistry[gameType]) {
      return Response.json(
        { success: false, error: `Unknown game type: ${gameType}. Available: ${Object.keys(gameRegistry).join(', ')}` },
        { status: 400, headers }
      );
    }

    const gameConfig = gameConfigRegistry[gameType] || { minPlayers: 2, maxPlayers: 6 };
    if (playerCount < gameConfig.minPlayers || playerCount > gameConfig.maxPlayers) {
      return Response.json(
        { success: false, error: `Player count must be between ${gameConfig.minPlayers} and ${gameConfig.maxPlayers}` },
        { status: 400, headers }
      );
    }

    const gameId = generateGameId();
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request('http://internal/create', {
      method: 'POST',
      body: JSON.stringify({ gameType, playerCount, playerNames, playerIds, seed, aiPlayers, aiLevel }),
    }));

    const result = await response.json() as GameResponse;

    if (result.success) {
      return Response.json({ ...result, gameId }, { status: 201, headers });
    } else {
      return Response.json(result, { status: 400, headers });
    }
  }

  async function handleGetGame(
    gameId: string,
    player: number | undefined,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const url = player !== undefined ? `http://internal/state?player=${player}` : 'http://internal/state';
    const response = await stub.fetch(new Request(url));
    const result = await response.json();

    return Response.json(result, { status: response.status, headers });
  }

  async function handleWebSocketUpgrade(
    gameId: string,
    url: URL,
    env: Env
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const wsUrl = new URL('http://internal/websocket');
    wsUrl.search = url.search;

    return stub.fetch(new Request(wsUrl, {
      headers: {
        'Upgrade': 'websocket',
      },
    }));
  }

  async function handleAction(
    gameId: string,
    body: ActionRequest,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request('http://internal/action', {
      method: 'POST',
      body: JSON.stringify(body),
    }));

    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  }

  async function handleGetHistory(
    gameId: string,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request('http://internal/history'));
    const result = await response.json();

    return Response.json(result, { status: response.status, headers });
  }

  async function handleGetStateAt(
    gameId: string,
    actionIndex: number,
    playerPosition: number,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(
      new Request(`http://internal/state-at/${actionIndex}?player=${playerPosition}`)
    );
    const result = await response.json();

    return Response.json(result, { status: response.status, headers });
  }

  async function handleGetStateDiff(
    gameId: string,
    fromIndex: number,
    toIndex: number,
    playerPosition: number,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(
      new Request(`http://internal/state-diff/${fromIndex}/${toIndex}?player=${playerPosition}`)
    );
    const result = await response.json();

    return Response.json(result, { status: response.status, headers });
  }

  async function handleUndo(
    gameId: string,
    body: { player?: number },
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request('http://internal/undo', {
      method: 'POST',
      body: JSON.stringify(body),
    }));

    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  }

  async function handleRestart(
    gameId: string,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request('http://internal/restart', {
      method: 'POST',
    }));

    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  }

  async function handleLobbyRoute(
    gameId: string,
    action: string,
    body: unknown,
    env: Env,
    headers: Record<string, string>
  ): Promise<Response> {
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    const response = await stub.fetch(new Request(`http://internal/lobby/${action}`, {
      method: action === 'GET' ? 'GET' : 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }));

    const result = await response.json();
    return Response.json(result, { status: response.status, headers });
  }

  /**
   * Game creation callback for matchmaking - creates game in Durable Object
   */
  async function createGameForMatchmaking(
    gameType: string,
    playerCount: number,
    playerNames: string[],
    playerIds: string[],
    env: Env
  ): Promise<string> {
    const gameId = generateGameId();
    const id = env.GAME_STATE.idFromName(gameId);
    const stub = env.GAME_STATE.get(id);

    await stub.fetch(new Request('http://internal/create', {
      method: 'POST',
      body: JSON.stringify({
        gameType,
        playerCount,
        playerNames,
        playerIds,
      }),
    }));

    return gameId;
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Create matchmaking store for this request
      const matchmakingStore = new CloudflareKVMatchmakingStore(env.MATCHMAKING);

      try {
        // Game routes
        if (path === '/games' && request.method === 'POST') {
          const body = await request.json() as CreateGameRequest;
          return await handleCreateGame(body, env, corsHeaders);
        }

        const getMatch = path.match(/^\/games\/([^/]+)$/);
        if (getMatch) {
          const gameId = getMatch[1];

          if (request.headers.get('Upgrade') === 'websocket') {
            return await handleWebSocketUpgrade(gameId, url, env);
          }

          if (request.method === 'GET') {
            const playerParam = url.searchParams.get('player');
            const player = playerParam ? parseInt(playerParam, 10) : undefined;
            return await handleGetGame(gameId, player, env, corsHeaders);
          }
        }

        const actionMatch = path.match(/^\/games\/([^/]+)\/action$/);
        if (actionMatch && request.method === 'POST') {
          const gameId = actionMatch[1];
          const body = await request.json() as ActionRequest;
          return await handleAction(gameId, body, env, corsHeaders);
        }

        const historyMatch = path.match(/^\/games\/([^/]+)\/history$/);
        if (historyMatch && request.method === 'GET') {
          const gameId = historyMatch[1];
          return await handleGetHistory(gameId, env, corsHeaders);
        }

        const stateAtMatch = path.match(/^\/games\/([^/]+)\/state-at\/(\d+)$/);
        if (stateAtMatch && request.method === 'GET') {
          const gameId = stateAtMatch[1];
          const actionIndex = parseInt(stateAtMatch[2], 10);
          const playerPosition = parseInt(url.searchParams.get('player') || '0', 10);
          return await handleGetStateAt(gameId, actionIndex, playerPosition, env, corsHeaders);
        }

        const stateDiffMatch = path.match(/^\/games\/([^/]+)\/state-diff\/(\d+)\/(\d+)$/);
        if (stateDiffMatch && request.method === 'GET') {
          const gameId = stateDiffMatch[1];
          const fromIndex = parseInt(stateDiffMatch[2], 10);
          const toIndex = parseInt(stateDiffMatch[3], 10);
          const playerPosition = parseInt(url.searchParams.get('player') || '0', 10);
          return await handleGetStateDiff(gameId, fromIndex, toIndex, playerPosition, env, corsHeaders);
        }

        const undoMatch = path.match(/^\/games\/([^/]+)\/undo$/);
        if (undoMatch && request.method === 'POST') {
          const gameId = undoMatch[1];
          const body = await request.json() as { player?: number };
          return await handleUndo(gameId, body, env, corsHeaders);
        }

        const restartMatch = path.match(/^\/games\/([^/]+)\/restart$/);
        if (restartMatch && request.method === 'POST') {
          const gameId = restartMatch[1];
          return await handleRestart(gameId, env, corsHeaders);
        }

        // Lobby routes
        const lobbyMatch = path.match(/^\/games\/([^/]+)\/lobby$/);
        if (lobbyMatch && request.method === 'GET') {
          const gameId = lobbyMatch[1];
          return await handleLobbyRoute(gameId, 'GET', null, env, corsHeaders);
        }

        const claimPositionMatch = path.match(/^\/games\/([^/]+)\/claim-position$/);
        if (claimPositionMatch && request.method === 'POST') {
          const gameId = claimPositionMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'claim-position', body, env, corsHeaders);
        }

        const updateNameMatch = path.match(/^\/games\/([^/]+)\/update-name$/);
        if (updateNameMatch && request.method === 'POST') {
          const gameId = updateNameMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'update-name', body, env, corsHeaders);
        }

        const setReadyMatch = path.match(/^\/games\/([^/]+)\/set-ready$/);
        if (setReadyMatch && request.method === 'POST') {
          const gameId = setReadyMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'set-ready', body, env, corsHeaders);
        }

        const addSlotMatch = path.match(/^\/games\/([^/]+)\/add-slot$/);
        if (addSlotMatch && request.method === 'POST') {
          const gameId = addSlotMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'add-slot', body, env, corsHeaders);
        }

        const removeSlotMatch = path.match(/^\/games\/([^/]+)\/remove-slot$/);
        if (removeSlotMatch && request.method === 'POST') {
          const gameId = removeSlotMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'remove-slot', body, env, corsHeaders);
        }

        const setSlotAIMatch = path.match(/^\/games\/([^/]+)\/set-slot-ai$/);
        if (setSlotAIMatch && request.method === 'POST') {
          const gameId = setSlotAIMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'set-slot-ai', body, env, corsHeaders);
        }

        const leavePositionMatch = path.match(/^\/games\/([^/]+)\/leave-position$/);
        if (leavePositionMatch && request.method === 'POST') {
          const gameId = leavePositionMatch[1];
          const body = await request.json();
          return await handleLobbyRoute(gameId, 'leave-position', body, env, corsHeaders);
        }

        // Matchmaking routes - use shared handlers from @boardsmith/server
        if (path === '/matchmaking/join' && request.method === 'POST') {
          const body = await request.json() as MatchmakingRequest;
          const result = await handleMatchmakingJoin(
            matchmakingStore,
            registryAdapter,
            body,
            (gameType, playerCount, playerNames, playerIds) =>
              createGameForMatchmaking(gameType, playerCount, playerNames, playerIds, env)
          );
          return Response.json(result.body, { status: result.status, headers: corsHeaders });
        }

        if (path === '/matchmaking/status' && request.method === 'GET') {
          const playerId = url.searchParams.get('playerId');
          if (!playerId) {
            return Response.json({ success: false, error: 'playerId required' }, { status: 400, headers: corsHeaders });
          }
          const result = await handleMatchmakingStatus(matchmakingStore, playerId);
          return Response.json(result.body, { status: result.status, headers: corsHeaders });
        }

        if (path === '/matchmaking/leave' && request.method === 'POST') {
          const body = await request.json() as { playerId: string };
          const result = await handleMatchmakingLeave(matchmakingStore, body.playerId);
          return Response.json(result.body, { status: result.status, headers: corsHeaders });
        }

        // Health check
        if (path === '/health') {
          return Response.json({ status: 'ok', environment: env.ENVIRONMENT }, { headers: corsHeaders });
        }

        return Response.json(
          { success: false, error: 'Not found' },
          { status: 404, headers: corsHeaders }
        );
      } catch (error) {
        console.error('Worker error:', error);
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : 'Internal error' },
          { status: 500, headers: corsHeaders }
        );
      }
    },
  };
}

// ============================================
// Durable Object Helpers
// ============================================

function getWebSocketSession(ws: WebSocket): WebSocketSession | undefined {
  try {
    const attachment = (ws as any).deserializeAttachment?.();
    if (attachment && typeof attachment.playerPosition === 'number') {
      return attachment as WebSocketSession;
    }
  } catch {
    // Intentionally silent: attachment retrieval is best-effort for debugging.
    // If it fails, returning undefined is the correct fallback behavior.
  }
  return undefined;
}

// ============================================
// Durable Object Factory
// ============================================

/**
 * Create a Durable Object class for managing game state.
 * Pass in a game registry built from your game definitions.
 */
export function createGameStateDurableObject(gameRegistry: GameRegistry) {
  return class GameStateDurableObject implements DurableObject {
    readonly #state: DurableObjectState;
    readonly #registry: GameRegistry;
    readonly #sessions: Map<WebSocket, WebSocketSession> = new Map();
    readonly #storage: DurableObjectStorageAdapter;
    #gameSession: GameSession | null = null;

    constructor(state: DurableObjectState) {
      this.#state = state;
      this.#registry = gameRegistry;
      this.#storage = new DurableObjectStorageAdapter(state);
    }

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;

      try {
        if (path === '/websocket' && request.headers.get('Upgrade') === 'websocket') {
          return await this.#handleWebSocketUpgrade(url);
        }

        if (path === '/create' && request.method === 'POST') {
          return await this.#handleCreate(request);
        }

        if (path === '/state' && request.method === 'GET') {
          const playerParam = url.searchParams.get('player');
          const player = playerParam ? parseInt(playerParam, 10) : undefined;
          return await this.#handleGetState(player);
        }

        if (path === '/action' && request.method === 'POST') {
          return await this.#handleAction(request);
        }

        if (path === '/history' && request.method === 'GET') {
          return await this.#handleGetHistory();
        }

        const stateAtMatch = path.match(/^\/state-at\/(\d+)$/);
        if (stateAtMatch && request.method === 'GET') {
          const actionIndex = parseInt(stateAtMatch[1], 10);
          const urlObj = new URL(request.url);
          const playerPosition = parseInt(urlObj.searchParams.get('player') || '0', 10);
          return await this.#handleGetStateAt(actionIndex, playerPosition);
        }

        const stateDiffMatch = path.match(/^\/state-diff\/(\d+)\/(\d+)$/);
        if (stateDiffMatch && request.method === 'GET') {
          const fromIndex = parseInt(stateDiffMatch[1], 10);
          const toIndex = parseInt(stateDiffMatch[2], 10);
          const urlObj = new URL(request.url);
          const playerPosition = parseInt(urlObj.searchParams.get('player') || '0', 10);
          return await this.#handleGetStateDiff(fromIndex, toIndex, playerPosition);
        }

        if (path === '/undo' && request.method === 'POST') {
          return await this.#handleUndo(request);
        }

        if (path === '/restart' && request.method === 'POST') {
          return await this.#handleRestart();
        }

        // Lobby routes
        const lobbyMatch = path.match(/^\/lobby\/(.+)$/);
        if (lobbyMatch) {
          const action = lobbyMatch[1];
          return await this.#handleLobbyAction(action, request);
        }

        return Response.json({ success: false, error: 'Not found' }, { status: 404 });
      } catch (error) {
        console.error('Durable Object error:', error);
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : 'Internal error' },
          { status: 500 }
        );
      }
    }

    async #handleWebSocketUpgrade(url: URL): Promise<Response> {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const playerParam = url.searchParams.get('player');
      const playerId = url.searchParams.get('playerId');
      const isSpectator = url.searchParams.get('spectator') === 'true';

      let playerPosition = playerParam ? parseInt(playerParam, 10) : -1;

      await this.#ensureLoaded();

      // Check if playerId maps to a player position (from lobby slots or playerIds)
      if (playerId && this.#gameSession) {
        const storedState = this.#gameSession.storedState;

        // First check lobby slots
        const lobbyPosition = this.#gameSession.getSeatForPlayer(playerId);
        if (lobbyPosition !== undefined) {
          playerPosition = lobbyPosition;
        } else if (storedState.playerIds) {
          // Fallback to playerIds array
          const foundPosition = storedState.playerIds.indexOf(playerId);
          if (foundPosition >= 0) {
            playerPosition = foundPosition;
          }
        }
      }

      const sessionData: WebSocketSession = {
        playerId: playerId ?? undefined,
        playerPosition,
        playerSeat: playerPosition,  // Alias for SessionInfo compatibility
        isSpectator,
      };

      this.#state.acceptWebSocket(server);
      (server as any).serializeAttachment?.(sessionData);
      this.#sessions.set(server, sessionData);

      // Mark player as connected in lobby
      if (playerId && this.#gameSession) {
        await this.#gameSession.setPlayerConnected(playerId, true);
      }

      // Send initial state or lobby info
      if (this.#gameSession) {
        const lobbyInfo = this.#gameSession.getLobbyInfo();

        // If in lobby waiting state, send lobby info
        if (lobbyInfo && lobbyInfo.state === 'waiting') {
          server.send(JSON.stringify({
            type: 'lobby',
            lobby: lobbyInfo,
          }));
        } else {
          // Send game state
          const state = this.#gameSession.getState(isSpectator ? 0 : playerPosition);
          const flowState = this.#gameSession.getFlowState();

          server.send(JSON.stringify({
            type: 'state',
            flowState,
            state: state.state,
            playerPosition,
            isSpectator,
          }));
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
      let session = this.#sessions.get(ws);
      if (!session) {
        session = getWebSocketSession(ws);
        if (session) {
          this.#sessions.set(ws, session);
        }
      }

      if (!session) {
        ws.send(JSON.stringify({ type: 'error', error: 'Session expired. Please refresh the page.' }));
        return;
      }

      try {
        const data = JSON.parse(message as string) as WebSocketMessage;

        switch (data.type) {
          case 'action':
            if (session.isSpectator) {
              const errorResult = { type: 'actionResult', requestId: data.requestId, success: false, error: 'Spectators cannot perform actions' };
              ws.send(JSON.stringify(errorResult));
              return;
            }

            await this.#ensureLoaded();
            if (!this.#gameSession) {
              const errorResult = { type: 'actionResult', requestId: data.requestId, success: false, error: 'Game not found' };
              ws.send(JSON.stringify(errorResult));
              return;
            }

            const result = await this.#gameSession.performAction(
              data.action!,
              session.playerPosition,
              data.args || {}
            );

            // Always send action result back to the requesting client
            const actionResult = {
              type: 'actionResult',
              requestId: data.requestId,
              success: result.success,
              error: result.error,
              data: result.data,
              message: result.message,
            };
            ws.send(JSON.stringify(actionResult));
            // Success case: broadcast of state update happens automatically via session
            break;

          case 'getState':
            await this.#ensureLoaded();
            if (this.#gameSession) {
              const effectivePosition = session.isSpectator ? 0 : session.playerPosition;
              const state = this.#gameSession.getState(effectivePosition);
              const flowState = this.#gameSession.getFlowState();
              ws.send(JSON.stringify({
                type: 'state',
                flowState,
                state: state.state,
                playerPosition: session.playerPosition,
                isSpectator: session.isSpectator,
              }));
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }));
      }
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
      const session = this.#sessions.get(ws);
      this.#sessions.delete(ws);

      // Mark player as disconnected in lobby
      if (session?.playerId && this.#gameSession) {
        await this.#gameSession.setPlayerConnected(session.playerId, false);
      }
    }

    async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
      console.error('WebSocket error:', error);
      const session = this.#sessions.get(ws);
      this.#sessions.delete(ws);

      // Mark player as disconnected in lobby
      if (session?.playerId && this.#gameSession) {
        await this.#gameSession.setPlayerConnected(session.playerId, false);
      }
    }

    async #handleCreate(request: Request): Promise<Response> {
      const body = await request.json() as CreateGameRequest;
      const { gameType, playerCount, playerNames, playerIds, seed, aiPlayers, aiLevel } = body;

      const existing = await this.#storage.load();
      if (existing) {
        return Response.json(
          { success: false, error: 'Game already exists' },
          { status: 409 }
        );
      }

      const GameClass = this.#registry[gameType];
      if (!GameClass) {
        return Response.json(
          { success: false, error: `Unknown game type: ${gameType}` },
          { status: 400 }
        );
      }

      const names = playerNames ?? Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);

      // Build AI config if AI players are specified
      const aiConfig: AIConfig | undefined = aiPlayers && aiPlayers.length > 0
        ? { players: aiPlayers, level: aiLevel || 'medium' }
        : undefined;

      // Create session using the host package
      this.#gameSession = GameSession.create({
        gameType,
        GameClass,
        playerCount,
        playerNames: names,
        playerIds,
        seed,
        storage: this.#storage,
        aiConfig,
      });

      // Set up broadcasting
      const broadcaster = new CloudflareBroadcastAdapter(this.#state, this.#sessions);
      this.#gameSession.setBroadcaster(broadcaster);

      const flowState = this.#gameSession.getFlowState();
      // Use player 1's view for initial creation response (clients get their own view via WebSocket)
      const state = this.#gameSession.buildPlayerState(1);

      return Response.json({
        success: true,
        flowState,
        state,
      });
    }

    async #handleGetState(player?: number): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const playerPos = player ?? 0;
      const result = this.#gameSession.getState(playerPos);

      return Response.json({
        success: true,
        flowState: result.flowState,
        state: result.state,
      });
    }

    async #handleAction(request: Request): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const body = await request.json() as ActionRequest;
      const { action, player, args } = body;

      const result = await this.#gameSession.performAction(action, player, args);

      if (!result.success) {
        return Response.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return Response.json({
        success: true,
        flowState: result.flowState,
        state: result.state,
        serializedAction: result.serializedAction,
      });
    }

    async #handleGetHistory(): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const history = this.#gameSession.getHistory();

      return Response.json({
        success: true,
        actionHistory: history.actionHistory,
        createdAt: history.createdAt,
      });
    }

    async #handleGetStateAt(actionIndex: number, playerPosition: number): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const result = this.#gameSession.getStateAtAction(actionIndex, playerPosition);

      if (!result.success) {
        return Response.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return Response.json({
        success: true,
        state: result.state,
        actionIndex,
      });
    }

    async #handleGetStateDiff(fromIndex: number, toIndex: number, playerPosition: number): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const result = this.#gameSession.getStateDiff(fromIndex, toIndex, playerPosition);

      if (!result.success) {
        return Response.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return Response.json({
        success: true,
        diff: result.diff,
        fromIndex,
        toIndex,
      });
    }

    async #handleUndo(request: Request): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      const body = await request.json() as { player?: number };
      const playerPosition = body.player ?? 0;

      const result = await this.#gameSession.undoToTurnStart(playerPosition);

      if (!result.success) {
        return Response.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return Response.json({
        success: true,
        flowState: result.flowState,
        state: result.state,
      });
    }

    async #handleRestart(): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      // Get original game configuration
      const storedState = this.#gameSession.storedState;
      const GameClass = this.#registry[storedState.gameType];
      if (!GameClass) {
        return Response.json(
          { success: false, error: `Unknown game type: ${storedState.gameType}` },
          { status: 400 }
        );
      }

      // Create a new game session with the same configuration (but new random seed)
      this.#gameSession = GameSession.create({
        gameType: storedState.gameType,
        GameClass,
        playerCount: storedState.playerCount,
        playerNames: storedState.playerNames,
        playerIds: storedState.playerIds,
        storage: this.#storage,
        aiConfig: storedState.aiConfig,
      });

      // Set up broadcasting
      const broadcaster = new CloudflareBroadcastAdapter(this.#state, this.#sessions);
      this.#gameSession.setBroadcaster(broadcaster);

      const state = this.#gameSession.getState(0);

      return Response.json({
        success: true,
        flowState: state.flowState,
        state: state.state,
      });
    }

    async #handleLobbyAction(action: string, request: Request): Promise<Response> {
      await this.#ensureLoaded();

      if (!this.#gameSession) {
        return Response.json(
          { success: false, error: 'Game not found' },
          { status: 404 }
        );
      }

      // GET lobby info
      if (action === 'GET') {
        const lobbyInfo = this.#gameSession.getLobbyInfo();
        if (!lobbyInfo) {
          return Response.json(
            { success: false, error: 'Game does not have a lobby' },
            { status: 400 }
          );
        }
        return Response.json(lobbyInfo);
      }

      // All other actions need a body
      const body = await request.json() as Record<string, unknown>;

      switch (action) {
        case 'claim-position': {
          const { seat, name, playerId } = body as { seat: number; name: string; playerId: string };
          const result = await this.#gameSession.claimSeat(seat, playerId, name);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'update-name': {
          const { playerId, name } = body as { playerId: string; name: string };
          const result = await this.#gameSession.updateSlotName(playerId, name);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'set-ready': {
          const { playerId, ready } = body as { playerId: string; ready: boolean };
          const result = await this.#gameSession.setReady(playerId, ready);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'add-slot': {
          const { playerId } = body as { playerId: string };
          const result = await this.#gameSession.addSlot(playerId);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'remove-slot': {
          const { playerId, seat } = body as { playerId: string; seat: number };
          const result = await this.#gameSession.removeSlot(playerId, seat);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'set-slot-ai': {
          const { playerId, seat, isAI, aiLevel } = body as { playerId: string; seat: number; isAI: boolean; aiLevel?: string };
          const result = await this.#gameSession.setSlotAI(playerId, seat, isAI, aiLevel);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        case 'leave-position': {
          const { playerId } = body as { playerId: string };
          const result = await this.#gameSession.leaveSeat(playerId);
          return Response.json(result, { status: result.success ? 200 : 400 });
        }

        default:
          return Response.json(
            { success: false, error: `Unknown lobby action: ${action}` },
            { status: 400 }
          );
      }
    }

    async #ensureLoaded(): Promise<void> {
      if (this.#gameSession) return;

      const stored = await this.#storage.load();
      if (!stored) return;

      const GameClass = this.#registry[stored.gameType];
      if (!GameClass) return;

      try {
        this.#gameSession = GameSession.restore(stored, GameClass, this.#storage);

        // Set up broadcasting
        const broadcaster = new CloudflareBroadcastAdapter(this.#state, this.#sessions);
        this.#gameSession.setBroadcaster(broadcaster);
      } catch (error) {
        console.error(`Restore failed for game, resetting to initial state: ${error}`);

        // Create a fresh game with the same config
        this.#gameSession = GameSession.create({
          gameType: stored.gameType,
          GameClass,
          playerCount: stored.playerCount,
          playerNames: stored.playerNames,
          playerIds: stored.playerIds,
          seed: stored.seed,
          storage: this.#storage,
          aiConfig: stored.aiConfig,
        });

        // Set up broadcasting
        const broadcaster = new CloudflareBroadcastAdapter(this.#state, this.#sessions);
        this.#gameSession.setBroadcaster(broadcaster);
      }
    }
  };
}
