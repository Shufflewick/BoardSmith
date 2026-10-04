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

// Game runner (runtime-specific)
export {
  GameRunner,
  describeCheckpointAbsence,
  restoreEarlierSnapshot,
  type GameRunnerOptions,
  type CheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
  type ActionExecutionResult,
  type PendingStepResult,
} from './runner.js';

// History entry types (used by callers that invoke GameRunner.replay)
export type { SerializedAction, SerializedSeatExpiry, HistoryEntry } from '../engine/index.js';
