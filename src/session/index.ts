/**
 * @boardsmith/session - Game session management
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
 * } from '@boardsmith/session';
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
  UpdateNameRequest,
  // Pick types (new terminology)
  PickMetadata,
  PickFilter,
  PickChoicesResponse,
  PickTrace,
  // Deprecated aliases (for backward compatibility)
  SelectionMetadata,
  SelectionFilter,
  SelectionChoicesResponse,
  SelectionTrace,
} from './types.js';

// Error codes enum (value export, not just type)
export { ErrorCode } from './types.js';

// ============================================
// Utilities
// ============================================

export {
  generateGameId,
  isPlayersTurn,
  buildPlayerState,
} from './utils.js';

// ============================================
// Player Colors
// ============================================

export {
  STANDARD_PLAYER_COLORS,
  DEFAULT_PLAYER_COLORS,
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

export type { PickStepResult, SelectionStepResult } from './pending-action-manager.js';
