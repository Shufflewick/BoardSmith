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
  createActionCheckpoint,
  createPlayerView,
  createAllPlayerViews,
} from './snapshot.js';

export type {
  GameStateSnapshot,
  ActionCheckpoint,
  PlayerStateView,
} from './snapshot.js';

// Dev state transfer (for HMR)
export {
  captureDevState,
  restoreDevState,
  validateDevSnapshot,
  formatValidationErrors,
  validateFlowPosition,
  formatFlowRecovery,
  getSnapshotElementCount,
  // Dev checkpoints for fast HMR recovery
  createDevCheckpoint,
  restoreFromDevCheckpoint,
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
  // Dev checkpoint types
  DevCheckpoint,
  RestoreFromDevCheckpointOptions,
  DevCheckpointRestoreResult,
} from './dev-state.js';
