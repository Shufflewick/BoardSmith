// Re-export serialization utilities from engine
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  type SerializedReference,
  type SerializeOptions,
} from '../engine/index.js';

// Re-export state snapshots from engine
export {
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  type GameStateSnapshot,
  type PlayerStateView,
} from '../engine/index.js';

// Re-export replay types from engine
export {
  createReplayFile,
  validateReplayFile,
  parseReplayFile,
  type ReplayFile,
} from '../engine/index.js';

// Game runner (runtime-specific)
export {
  GameRunner,
  type GameRunnerOptions,
  type ActionExecutionResult,
} from './runner.js';
