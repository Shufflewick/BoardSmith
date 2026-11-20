// Serialization utilities
export {
  serializeAction,
  deserializeAction,
  isSerializedReference,
} from './serializer.js';

export type {
  SerializedReference,
} from './serializer.js';

// State snapshots
export {
  createSnapshot,
  createSeatSnapshot,
  type SeatSnapshot,
  createRunnerSnapshot,
  snapshotTree,
  createActionCheckpoint,
  checkpointAt,
  checkpointCount,
  createPlayerView,
  createAllPlayerViews,
} from './snapshot.js';

export type {
  GameStateSnapshot,
  ActionCheckpoint,
  ActionCheckpointWindow,
  CheckpointAbsence,
  CheckpointPolicy,
  UndoPolicy,
  PlayerStateView,
} from './snapshot.js';

// Legal-move enumeration (INTRO-04)
export { enumerateLegalMoves } from './enumerate-moves.js';

