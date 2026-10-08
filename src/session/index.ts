/**
 * boardsmith/session - Game session management
 *
 * This package provides a unified API for managing game sessions across different platforms
 * (local development, Cloudflare Workers, etc.) while keeping game designers
 * isolated from implementation details.
 *
 * Every host runs the same `SnapshotSessionHost` over the pure `executeOp`:
 * the `boardsmith dev` host, ShufflewickPub, and `createHeadlessSession`, which
 * drives one in process for tests and simulations.
 *
 * @example
 * ```typescript
 * import { createHeadlessSession } from 'boardsmith/session';
 * import { gameDefinition } from './rules/index.js';
 *
 * const session = createHeadlessSession(gameDefinition, { playerCount: 2, seed: 'demo' });
 * await session.start();
 * await session.send(1, { type: 'action', actionName: 'move', player: 1, args: { to: 'b4' } });
 * const seat1 = session.playerState(1); // what seat 1 was last published
 * ```
 */

// ============================================
// Types
// ============================================

export type { CheckpointPolicy, UndoPolicy, GameClass } from '../engine/index.js';

export type {
  GameDefinition,
  PlayerGameState,
  CreateGameRequest,
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
  ClaimSeatRequest,
  ClaimSeatResponse,
  JoinLobbyRequest,
  JoinLobbyResponse,
  // Pick types
  PickMetadata,
  PickFilter,
  PickChoicesResponse,
  PickTrace,
  // Action schema types
  ActionMetadata,
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

// The one way a client's choice of game options is admitted (#447).
export {
  selectGameOptions,
  assertDeclarableGameOptions,
  GameOptionSelectionError,
  HOST_OWNED_GAME_OPTION_KEYS,
  type GameOptionSelection,
} from './game-option-selection.js';

export { PickHandler } from './pick-handler.js';

export type { PickStepResult } from './pending-action-manager.js';

// Exposed so stateless hosts (the ShufflewickPub executor) can replicate
// undo-to-turn-start by truncating the action history and replaying.
export { computeUndoInfo, debuggingOffMessage } from './utils.js';

// Exposed so the stateless executor can enrich an action's followUp with the
// same metadata the dev server attaches, letting the embedded UI auto-start it.
export { buildSingleActionMetadata } from './utils.js';

// Pure stateless op executor — single source of truth for per-op game execution.
export * from './stateless-ops.js';
export { parseExecutorOp, type ParsedExecutorOp } from './parse-executor-op.js';

// Stateful session host: threads snapshot/pendingStates, enforces broadcast-before-response
// ordering, and drives the bot pump. Accepts an injected executeOp adapter so the same
// host class works in-process (dev) and via remote RPC (production executor worker).
export * from './snapshot-session-host.js';
// How a host holds the work a session starts itself while its rules are replaced (#388).
export type { HostWorkGate } from './host-work-gate.js';

// ============================================
// Headless Simulation
// ============================================

export { createHeadlessSession, type HeadlessSession, type HeadlessGameOptions } from './headless-session.js';

/**
 * THE BACKEND AND THE CAPABILITY SET IT RESOLVES TO (#171).
 *
 * One object, derived at build from the backend plus the compiled definition,
 * that every reader consults instead of the backend's name.
 */
export {
  GAME_BACKENDS,
  isGameBackend,
  resolveCapabilities,
  capabilityContradictions,
} from './capabilities.js';
export type { GameBackend, GameCapabilities, CapabilityInputs } from './capabilities.js';
