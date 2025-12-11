import type { Game } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { SerializedAction } from '../action/types.js';

/**
 * Reference types used in serialized actions
 */
export type SerializedReference =
  | { __elementRef: string }  // Element reference by branch path
  | { __elementId: number }   // Element reference by ID
  | { __playerRef: number };  // Player reference by position

/**
 * Options for serialization
 */
export interface SerializeOptions {
  /** Use branch paths instead of IDs (more stable across serialization) */
  useBranchPaths?: boolean;
}

/**
 * Serialize a value that may contain game elements or players
 * Converts elements to `{ __elementRef: "0/2/5" }` or `{ __elementId: 123 }`
 * Converts players to `{ __playerRef: 0 }`
 */
export function serializeValue(
  value: unknown,
  game: Game,
  options: SerializeOptions = {}
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle GameElement references
  if (value instanceof Object && 'branch' in value && typeof (value as GameElement).branch === 'function') {
    const element = value as GameElement;
    if (options.useBranchPaths) {
      return { __elementRef: element.branch() };
    }
    return { __elementId: element.id };
  }

  // Handle Player references
  if (value instanceof Object && 'position' in value && typeof (value as Player).position === 'number') {
    const player = value as Player;
    return { __playerRef: player.position };
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => serializeValue(item, game, options));
  }

  // Handle plain objects
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeValue(val, game, options);
    }
    return result;
  }

  // Primitives pass through
  return value;
}

/**
 * Deserialize a value that may contain element/player references
 * Converts `{ __elementRef: "0/2/5" }` back to GameElement
 * Converts `{ __playerRef: 0 }` back to Player
 */
export function deserializeValue(
  value: unknown,
  game: Game
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle element reference by branch path
  if (typeof value === 'object' && value !== null && '__elementRef' in value) {
    const ref = value as { __elementRef: string };
    return game.atBranch(ref.__elementRef);
  }

  // Handle element reference by ID
  if (typeof value === 'object' && value !== null && '__elementId' in value) {
    const ref = value as { __elementId: number };
    return game.first({ id: ref.__elementId } as Record<string, unknown>);
  }

  // Handle player reference
  if (typeof value === 'object' && value !== null && '__playerRef' in value) {
    const ref = value as { __playerRef: number };
    return game.players[ref.__playerRef];
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => deserializeValue(item, game));
  }

  // Handle plain objects
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deserializeValue(val, game);
    }
    return result;
  }

  // Primitives pass through
  return value;
}

/**
 * Serialize an action with its arguments
 */
export function serializeAction(
  actionName: string,
  player: Player,
  args: Record<string, unknown>,
  game: Game,
  options: SerializeOptions = {},
  undoable?: boolean
): SerializedAction {
  const serialized: SerializedAction = {
    name: actionName,
    player: player.position,
    args: serializeValue(args, game, options) as Record<string, unknown>,
    timestamp: Date.now(),
  };

  // Only include undoable if explicitly false (default is true)
  if (undoable === false) {
    serialized.undoable = false;
  }

  return serialized;
}

/**
 * Deserialize an action and resolve its arguments
 */
export function deserializeAction(
  serialized: SerializedAction,
  game: Game
): { actionName: string; player: Player; args: Record<string, unknown> } {
  const player = game.players[serialized.player];
  if (!player) {
    throw new Error(`Player ${serialized.player} not found`);
  }

  return {
    actionName: serialized.name,
    player,
    args: deserializeValue(serialized.args, game) as Record<string, unknown>,
  };
}

/**
 * Check if a value is a serialized reference
 */
export function isSerializedReference(value: unknown): value is SerializedReference {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return '__elementRef' in value || '__elementId' in value || '__playerRef' in value;
}
