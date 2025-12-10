// Serialization utilities
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
} from './serializer.js';

export type {
  SerializedReference,
  SerializeOptions,
} from './serializer.js';

// State snapshots
export {
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  computeDiff,
} from './snapshot.js';

export type {
  GameStateSnapshot,
  PlayerStateView,
  StateDiff,
} from './snapshot.js';

// Replay system
export {
  createReplayFile,
  validateReplayFile,
  parseReplayFile,
} from './replay.js';

export type {
  ReplayFile,
} from './replay.js';
