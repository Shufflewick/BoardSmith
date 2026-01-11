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
} from './snapshot.js';

export type {
  GameStateSnapshot,
  PlayerStateView,
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

// Action helpers
export {
  resolveElementArg,
  isResolvedElement,
} from './action-helpers.js';

// Dev state transfer (for HMR)
export {
  captureDevState,
  restoreDevState,
  validateDevSnapshot,
  formatValidationErrors,
  validateFlowPosition,
  formatFlowRecovery,
  getSnapshotElementCount,
  createTrackedRandom,
  getRandomCallCount,
  resetRandomCallCounter,
  // Checkpoints for fast HMR recovery
  createCheckpoint,
  restoreFromCheckpoint,
} from './dev-state.js';

export type {
  DevSnapshot,
  RestoreDevStateOptions,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationErrorType,
  ValidationWarningType,
  FlowPositionValidation,
  // Checkpoint types
  DevCheckpoint,
  RestoreFromCheckpointOptions,
  CheckpointRestoreResult,
} from './dev-state.js';
