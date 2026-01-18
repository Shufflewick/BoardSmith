// Re-export serialization utilities from engine
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  type SerializedReference,
  type SerializeOptions,
} from '@boardsmith/engine';

// Re-export state snapshots from engine
export {
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  type GameStateSnapshot,
  type PlayerStateView,
} from '@boardsmith/engine';

// Re-export replay types from engine
export {
  createReplayFile,
  validateReplayFile,
  parseReplayFile,
  type ReplayFile,
} from '@boardsmith/engine';

// Game runner (runtime-specific)
export {
  GameRunner,
  type GameRunnerOptions,
  type ActionExecutionResult,
} from './runner.js';
