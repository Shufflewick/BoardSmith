/**
 * boardsmith/session - Game session management
 *
 * This package provides a unified API for managing game sessions across different platforms
 * (local development, Cloudflare Workers, etc.) while keeping game designers
 * isolated from implementation details.
 *
 * Every host runs the same `SnapshotSessionHost` over the pure `executeOp`:
 * the `boardsmith dev` host, ShufflewickPub, and `boardsmith/testing`'s
 * `createHeadlessSession`, which drives one in process for a game's tests.
 */

// ============================================
// Types
// ============================================

export type { CheckpointPolicy, UndoPolicy, GameClass } from '../engine/index.js';

export type {
  GameDefinition,
  PlayerGameState,
  // Player option types
  PlayerOptionDefinition,
  StandardPlayerOption,
  NumberPlayerOption,
  BooleanPlayerOption,
  ExclusivePlayerOption,
  PlayerConfig,
  GamePreset,
  PresetSeat,
  // Game option types
  GameOptionDefinition,
  NumberOption,
  SelectOption,
  BooleanOption,
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
  buildActionMetadata,
  buildPlayerState,
} from './utils.js';

// ============================================
// Player Colors
// ============================================

export {
  createColorOption,
  type ColorChoice,
  type ColorOptionDefinition,
} from './colors.js';

// ============================================
// Core Classes
// ============================================

// The one way a client's choice of game options is admitted (#447), and the one
// place they are declared, boardsmith.json's gameOptions list (#701).
export {
  selectGameOptions,
  parseGameOptionList,
  GameOptionSelectionError,
  HOST_OWNED_GAME_OPTION_KEYS,
  type GameOptionSelection,
} from './game-option-selection.js';

export { PickHandler } from './pick-handler.js';

// Exposed so a host that refuses a debug request says it the way the executor does.
export { debuggingOffMessage } from './utils.js';

// The one reader of a snapshot's element tree (#804): hosts that inspect a
// stored snapshot read the tree through it, never `snapshot.state`.
export { snapshotTree } from '../engine/utils/index.js';

// Pure stateless op executor — single source of truth for per-op game execution.
export * from './stateless-ops.js';
export { parseExecutorOp, type ParsedExecutorOp } from './parse-executor-op.js';

// Stateful session host: threads snapshot/pendingStates, enforces broadcast-before-response
// ordering, and drives the bot pump. Accepts an injected executeOp adapter so the same
// host class works in-process (dev) and via remote RPC (production executor worker).
export * from './snapshot-session-host.js';
// How a host holds the work a session starts itself while its rules are replaced (#388).
export type { HostWorkGate } from './host-work-gate.js';

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
export type { GameBackend, GameCapabilities } from './capabilities.js';

// The time per turn a table plays at, and a game's declared default (#1830).
export { TIME_PER_TURN_MS, DEFAULT_TIME_PER_TURN, timePerTurnProblem, type TimePerTurn } from './time-per-turn.js';
