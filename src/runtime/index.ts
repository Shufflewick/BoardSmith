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
  type GameRunnerOptions,
  type CheckpointPolicy,
  type UndoPolicy,
  type RandomnessPolicy,
  type ActionExecutionResult,
  type PendingStepResult,
} from './runner.js';

// Serialized action type (used by callers that invoke GameRunner.replay)
export type { SerializedAction } from '../engine/index.js';
