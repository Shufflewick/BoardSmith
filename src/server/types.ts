/**
 * Types for the platform-agnostic server core
 */

import type { GameSession, GameDefinition, AIConfig } from '@boardsmith/session';

// ============================================
// Re-export common types from session
// ============================================

export type {
  GameDefinition,
  GameClass,
  GameConfig,
  StoredGameState,
  PlayerGameState,
  SessionInfo,
  AIConfig,
  BroadcastAdapter,
  StorageAdapter,
  CreateGameRequest,
  ActionRequest,
  WebSocketMessage,
  // Lobby types
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
  LobbyUpdate,
  ClaimPositionRequest,
  ClaimPositionResponse,
  PlayerConfig,
} from '@boardsmith/session';

// ============================================
// Server Request/Response Types
// ============================================

/**
 * Platform-agnostic HTTP request
 */
export interface ServerRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

/**
 * Platform-agnostic HTTP response
 */
export interface ServerResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

// ============================================
// Game Store Interface
// ============================================

/**
 * Options for creating a new game
 */
export interface CreateGameOptions {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  aiConfig?: AIConfig;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Display name for lobby UI */
  displayName?: string;
  /** Per-player configurations (for lobby) */
  playerConfigs?: Array<{
    name?: string;
    isAI?: boolean;
    aiLevel?: string;
    [key: string]: unknown;
  }>;
  /** Creator's player ID */
  creatorId?: string;
  /** Whether to use lobby flow (game waits for players to join) */
  useLobby?: boolean;
}

/**
 * Result of game creation
 */
export interface CreateGameResult {
  session: GameSession;
  gameId: string;
}

/**
 * Game store abstraction - manages multiple games
 * Implementations:
 * - InMemoryGameStore: For local development (stores games in Map)
 * - DurableObjectGameStore: For Cloudflare Workers (each DO is one game)
 */
export interface GameStore {
  /**
   * Get an existing game session by ID
   */
  getGame(gameId: string): Promise<GameSession | null>;

  /**
   * Create a new game with the given options
   */
  createGame(gameId: string, options: CreateGameOptions): Promise<GameSession>;

  /**
   * Delete a game by ID
   */
  deleteGame(gameId: string): Promise<void>;

  /**
   * Update the game registry (for hot reloading)
   */
  updateRegistry?(definition: GameDefinition): void;
}

// ============================================
// Game Registry
// ============================================

/**
 * Registry mapping game types to their classes
 */
export interface GameRegistry {
  get(gameType: string): GameDefinition | undefined;
  getAll(): GameDefinition[];
  set(definition: GameDefinition): void;
}

// ============================================
// Matchmaking Types
// ============================================

/**
 * Entry in a matchmaking queue
 */
export interface QueueEntry {
  playerId: string;
  playerName: string;
  timestamp: number;
}

/**
 * Info about a matched game
 */
export interface MatchInfo {
  gameId: string;
  playerPosition: number;
  gameType: string;
  players: string[];
  matchedAt: number;
}

/**
 * Info about a player waiting in queue
 */
export interface WaitingInfo {
  gameType: string;
  playerCount: number;
  position: number;
  queueSize: number;
  joinedAt: number;
}

/**
 * Request to join matchmaking
 */
export interface MatchmakingRequest {
  gameType: string;
  playerCount: number;
  playerId: string;
  playerName?: string;
}

/**
 * Matchmaking store abstraction - manages queues and matches
 * Implementations:
 * - InMemoryMatchmakingStore: For local development
 * - CloudflareKVMatchmakingStore: For Cloudflare Workers
 */
export interface MatchmakingStore {
  /**
   * Get queue entries for a game type + player count
   */
  getQueue(gameType: string, playerCount: number): Promise<QueueEntry[]>;

  /**
   * Set queue entries (with optional TTL in seconds)
   */
  setQueue(gameType: string, playerCount: number, entries: QueueEntry[]): Promise<void>;

  /**
   * Get match info for a player
   */
  getMatch(playerId: string): Promise<MatchInfo | null>;

  /**
   * Set match info for a player (with optional TTL in seconds)
   */
  setMatch(playerId: string, match: MatchInfo, ttlSeconds?: number): Promise<void>;

  /**
   * Delete match info for a player
   */
  deleteMatch(playerId: string): Promise<void>;

  /**
   * Get waiting info for a player
   */
  getWaiting(playerId: string): Promise<WaitingInfo | null>;

  /**
   * Set waiting info for a player (with optional TTL in seconds)
   */
  setWaiting(playerId: string, info: WaitingInfo, ttlSeconds?: number): Promise<void>;

  /**
   * Delete waiting info for a player
   */
  deleteWaiting(playerId: string): Promise<void>;
}

// ============================================
// WebSocket Types
// ============================================

/**
 * Platform-agnostic WebSocket adapter
 */
export interface WebSocketAdapter {
  send(message: unknown): void;
  close(code?: number, reason?: string): void;
}

/**
 * WebSocket session info
 */
export interface WebSocketSession {
  ws: WebSocketAdapter;
  playerPosition: number;
  isSpectator: boolean;
  playerId?: string;
}

// ============================================
// Server Core Options
// ============================================

/**
 * Options for creating a GameServerCore
 */
export interface GameServerCoreOptions {
  /**
   * Game store for managing game sessions
   */
  store: GameStore;

  /**
   * Game registry for looking up game definitions
   */
  registry: GameRegistry;

  /**
   * Matchmaking store (optional - if not provided, matchmaking endpoints return 404)
   */
  matchmaking?: MatchmakingStore;

  /**
   * AI configuration for AI players
   */
  aiConfig?: AIConfig;

  /**
   * Environment identifier (e.g., 'development', 'production')
   */
  environment?: string;
}
