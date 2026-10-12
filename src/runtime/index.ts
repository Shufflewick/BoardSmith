// Serialization utilities
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  type SerializedReference,
  type SerializeOptions,
} from '../engine/utils/serializer.js';

// State snapshots
export {
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  type GameStateSnapshot,
  type PlayerStateView,
} from '../engine/utils/snapshot.js';

// Game runner (runtime-specific)
export {
  GameRunner,
  describeCheckpointAbsence,
  restoreEarlierSnapshot,
  type GameRunnerOptions,
  type CheckpointPolicy,
  type RunnerCheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
  type ActionExecutionResult,
  type PendingStepResult,
} from './runner.js';

// History entry types (used by callers that invoke GameRunner.replay)
export type { SerializedAction, SerializedSeatExpiry, HistoryEntry } from '../engine/action/types.js';
