import type { SerializedAction } from '../action/types.js';

/**
 * Standardized replay format for:
 * - Local debugging (time-travel)
 * - Platform replay viewing
 * - Bug reproduction (download replays)
 */
export interface ReplayFile {
  /** Replay format version */
  version: 1;

  /** Game type identifier (e.g., "go-fish", "cribbage") */
  gameType: string;

  /** Game code revision/version when played */
  gameRevision: string;

  /** Random seed for deterministic replay */
  seed: string;

  /** Number of players in this game */
  playerCount: number;

  /** Player names/identifiers */
  playerNames: string[];

  /** Complete action history */
  actions: SerializedAction[];

  /** How the game ended */
  outcome: 'complete' | 'aborted';

  /** Winner positions (if game completed) */
  winners?: number[];

  /** ISO timestamp when game was played */
  timestamp: string;

  /** Optional metadata */
  metadata?: {
    /** Duration in milliseconds */
    duration?: number;
    /** Platform version */
    platform?: string;
    /** Custom game-specific data */
    custom?: Record<string, unknown>;
  };
}

/**
 * Create a new replay file from game data
 */
export function createReplayFile(options: {
  gameType: string;
  gameRevision: string;
  seed: string;
  playerCount: number;
  playerNames: string[];
  actions: SerializedAction[];
  outcome: 'complete' | 'aborted';
  winners?: number[];
  metadata?: ReplayFile['metadata'];
}): ReplayFile {
  return {
    version: 1,
    gameType: options.gameType,
    gameRevision: options.gameRevision,
    seed: options.seed,
    playerCount: options.playerCount,
    playerNames: options.playerNames,
    actions: options.actions,
    outcome: options.outcome,
    winners: options.winners,
    timestamp: new Date().toISOString(),
    metadata: options.metadata,
  };
}

/**
 * Validate a replay file structure
 */
export function validateReplayFile(data: unknown): data is ReplayFile {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const replay = data as Record<string, unknown>;

  return (
    replay.version === 1 &&
    typeof replay.gameType === 'string' &&
    typeof replay.gameRevision === 'string' &&
    typeof replay.seed === 'string' &&
    typeof replay.playerCount === 'number' &&
    Array.isArray(replay.playerNames) &&
    Array.isArray(replay.actions) &&
    (replay.outcome === 'complete' || replay.outcome === 'aborted') &&
    typeof replay.timestamp === 'string'
  );
}

/**
 * Parse a JSON string into a ReplayFile
 * @throws Error if invalid format
 */
export function parseReplayFile(json: string): ReplayFile {
  const data = JSON.parse(json);
  if (!validateReplayFile(data)) {
    throw new Error('Invalid replay file format');
  }
  return data;
}
