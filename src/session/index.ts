/**
 * boardsmith/session - Game session management
 *
 * This package provides a unified API for managing game sessions across different platforms
 * (local development, Cloudflare Workers, etc.) while keeping game designers
 * isolated from implementation details.
 *
 * @example
 * ```typescript
 * import {
 *   GameSession,
 *   generateGameId,
 *   type GameDefinition,
 *   type StorageAdapter,
 *   type BroadcastAdapter,
 * } from 'boardsmith/session';
 *
 * // Create a game session
 * const session = GameSession.create({
 *   gameType: 'checkers',
 *   GameClass: CheckersGame,
 *   playerCount: 2,
 *   playerNames: ['Alice', 'Bob'],
 * });
 *
 * // Get state for a player
 * const { flowState, state } = session.getState(0);
 *
 * // Perform an action
 * const result = await session.performAction('move', 0, { from: 'a3', to: 'b4' });
 * ```
 */

// ============================================
// Types
// ============================================

export type {
  GameClass,
  GameDefinition,
  GameConfig,
  StoredGameState,
  PlayerGameState,
  SessionInfo,
  StateUpdate,
  AIConfig,
  StorageAdapter,
  BroadcastAdapter,
  CreateGameRequest,
  ActionRequest,
  WebSocketMessage,
  // Player option types
  PlayerOptionDefinition,
  StandardPlayerOption,
  ExclusivePlayerOption,
  PlayerConfig,
  GamePreset,
  // Game option types
  GameOptionDefinition,
  NumberOption,
  SelectOption,
  BooleanOption,
  // Lobby types
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
  LobbyUpdate,
  ClaimSeatRequest,
  ClaimSeatResponse,
  JoinLobbyRequest,
  JoinLobbyResponse,
  UpdateNameRequest,
  // Pick types
  PickMetadata,
  PickFilter,
  PickChoicesResponse,
  PickTrace,
} from './types.js';

// Error codes enum (value export, not just type)
export { ErrorCode } from './types.js';

// ============================================
// Utilities
// ============================================

export {
  generateGameId,
  isPlayersTurn,
  buildActionMetadata,
  buildPlayerState,
} from './utils.js';

// ============================================
// Player Colors
// ============================================

export {
  STANDARD_PLAYER_COLORS,
  createColorOption,
  type ColorChoice,
  type ColorOptionDefinition,
} from './colors.js';

// ============================================
// Core Classes
// ============================================

export {
  GameSession,
  type GameSessionOptions,
  type ActionResult,
  type UndoResult,
} from './game-session.js';

export { AIController } from './ai-controller.js';

export {
  CheckpointManager,
  type CheckpointManagerOptions,
} from './checkpoint-manager.js';

export { PickHandler } from './pick-handler.js';

export type { PickStepResult } from './pending-action-manager.js';

// Exposed so stateless hosts (the ShufflewickPub executor) can replicate
// undo-to-turn-start by truncating the action history and replaying.
export { computeUndoInfo } from './utils.js';

// Exposed so the stateless executor can enrich an action's followUp with the
// same metadata the dev server attaches, letting the embedded UI auto-start it.
export { buildSingleActionMetadata } from './utils.js';

// Pure stateless op executor — single source of truth for per-op game execution.
export * from './stateless-ops.js';

// Stateful session host: threads snapshot/pendingStates, enforces broadcast-before-response
// ordering, and drives the AI pump. Accepts an injected executeOp adapter so the same
// host class works in-process (dev) and via remote RPC (production executor worker).
export * from './snapshot-session-host.js';
