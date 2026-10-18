import type { Game } from '../element/game.js';
import { encodeValue, decodeValue } from '../element/game-element.js';
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
 * Serialize an action with its arguments. The arguments are written by
 * `encodeValue`, the codec element attributes use (#497).
 *
 * Deliberately stamps NO timestamp (#54). This entry goes straight into
 * `actionHistory`, which is engine-owned state that a snapshot serializes and a
 * replay compares: a clock reading here makes two runs of the same seed produce
 * byte-different output, which is the non-determinism the engine's own lint
 * rules forbid game code from introducing. A host that wants to know when a
 * move was made records that itself, outside the game's state.
 */
export function serializeAction(
  actionName: string,
  player: Player,
  args: Record<string, unknown>,
  game: Game,
  undoable?: boolean,
  branchesBefore?: Readonly<Record<number, string | null>>
): SerializedAction {
  const serialized: SerializedAction = {
    name: actionName,
    player: player.seat,
    args: encodeValue(args, game._ctx, `action '${actionName}'`, 'args', branchesBefore) as Record<string, unknown>,
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
  // serialized.player is 1-indexed position
  const player = game.getPlayer(serialized.player);
  if (!player) {
    throw new Error(`Player at position ${serialized.player} not found.`);
  }

  return {
    actionName: serialized.name,
    player,
    args: decodeValue(serialized.args, game) as Record<string, unknown>,
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
