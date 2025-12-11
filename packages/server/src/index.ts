/**
 * @boardsmith/server
 *
 * Platform-agnostic server core for BoardSmith games.
 * Provides shared HTTP routing and WebSocket handling that works
 * with both local development (Node.js) and production (Cloudflare Workers).
 */

// Core
export { GameServerCore } from './core.js';

// Types
export type {
  // Server types
  ServerRequest,
  ServerResponse,
  GameServerCoreOptions,
  CreateGameOptions,
  CreateGameResult,

  // Store interfaces
  GameStore,
  GameRegistry,
  MatchmakingStore,

  // Matchmaking types
  QueueEntry,
  MatchInfo,
  WaitingInfo,
  MatchmakingRequest,

  // WebSocket types
  WebSocketAdapter,
  WebSocketSession,

  // Re-exported from session
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
} from './types.js';

// Store implementations
export {
  InMemoryGameStore,
  SimpleGameRegistry,
  type GameSessionWithBroadcaster,
  type BroadcasterFactory,
} from './stores/in-memory-games.js';

export { InMemoryMatchmakingStore } from './stores/in-memory-matchmaking.js';

// Handlers (for advanced use cases)
export {
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

export {
  handleMatchmakingJoin,
  handleMatchmakingStatus,
  handleMatchmakingLeave,
} from './handlers/matchmaking.js';
