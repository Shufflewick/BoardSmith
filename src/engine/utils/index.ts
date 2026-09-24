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
export { enumerateLegalMoves, generateCombinations } from './enumerate-moves.js';

// Arg builder (INTRO-03)
export { buildActionArgs } from './arg-builder.js';
export type { BuildActionArgsOptions } from './arg-builder.js';

