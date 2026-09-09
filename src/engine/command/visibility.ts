/**
 * Visibility modes for game elements
 *
 * - 'all': Visible to all players (default)
 * - 'owner': Visible only to the element's owner
 * - 'hidden': Not visible to any player
 * - 'count-only': Players can see count but not contents (e.g., opponent's hand)
 */
export type VisibilityMode = 'all' | 'owner' | 'hidden' | 'count-only';

/**
 * Complete visibility state for an element
 */
export interface VisibilityState {
  /** Base visibility mode */
  mode: VisibilityMode;
  /** Additional players who can see (beyond the mode) */
  addPlayers?: number[];
  /** Players excluded from seeing (only applies to 'all' mode) */
  exceptPlayers?: number[];
  /** Whether this is explicitly set or inherited */
  explicit: boolean;
}

/**
 * Resolve effective visibility for an element given its state and player
 */
export function canPlayerSee(
  visibility: VisibilityState,
  playerPosition: number,
  ownerPosition: number | undefined
): boolean {
  // Check exceptPlayers first (exclusion list)
  if (visibility.exceptPlayers?.includes(playerPosition)) {
    return false;
  }

  // Check addPlayers (inclusion list override)
  if (visibility.addPlayers?.includes(playerPosition)) {
    return true;
  }

  // Apply base mode
  switch (visibility.mode) {
    case 'all':
      return true;
    case 'owner':
      return ownerPosition !== undefined && playerPosition === ownerPosition;
    case 'hidden':
    case 'count-only':
      return false;
    default:
      return true;
  }
}

/**
 * Default visibility (visible to all)
 */
export const DEFAULT_VISIBILITY: VisibilityState = {
  mode: 'all',
  explicit: false,
};

/**
 * Deep-copy a VisibilityState.
 *
 * Serialization boundaries (toJSON emit / fromJSON adopt) MUST copy rather
 * than share the live object (CR-02, phase 131): `addVisibleTo` /
 * `addZoneVisibleTo` / `hideContentsFrom` mutate the state in place, so a
 * snapshot or checkpoint holding the live reference would be retroactively
 * corrupted by later mutations, and undo/rewind could never roll a
 * visibility grant back.
 */
export function copyVisibilityState(state: VisibilityState): VisibilityState {
  return {
    ...state,
    ...(state.addPlayers && { addPlayers: [...state.addPlayers] }),
    ...(state.exceptPlayers && { exceptPlayers: [...state.exceptPlayers] }),
  };
}

/**
 * How a zone/element VisibilityState is spelled for ONE receiving seat (the
 * F-09 residual, and ShufflewickPub #411).
 *
 * The full roster (`addPlayers` / `exceptPlayers`) names every OTHER seat that
 * has been granted or denied vision, and broadcasting it discloses
 * who-can-see-what: the leak class F-09 addressed. What the reader is owed out
 * of that roster is one bit, whether IT is included, and the reader's own seat
 * number is no part of that bit.
 *
 * SO THE ANSWER IS SPELLED IN THE MODE, AND THE ROSTER GOES ENTIRELY. A
 * granted reader is told 'all'; a denied reader is told the mode that denies
 * everybody; a reader named in neither keeps the base mode. That is exactly
 * `canPlayerSee`'s precedence -- denial, then grant, then the mode -- so every
 * reader is given the same answer it was given before, which
 * `visibility.test.ts` holds over every mode and roster rather than by sample.
 *
 * WHY IT IS SPELLED THAT WAY (#411): `addPlayers: [yourSeat]` made every
 * reader's copy different, so a room scoped with `addVisibleTo` to everybody
 * standing in it was one encoding per watcher -- a 500-seat plaza was 500
 * copies of one answer. Two seats holding the same grant now hold the same
 * bytes. The reader also learns strictly LESS than the roster told it: it can
 * no longer tell a room it was let into from a room that was public all along.
 *
 * A COUNT-ONLY ZONE STAYS COUNT-ONLY WHEN IT DENIES. `canPlayerSee` refuses
 * 'hidden' and 'count-only' alike, but the serializer shows a count for one and
 * nothing at all for the other, and the children were already written from the
 * LIVE mode before this runs.
 *
 * Use ONLY on the per-player serialization path (`toJSONForPlayer`). The
 * full-fidelity `copyVisibilityState` is what the checkpoint/restore path
 * (full `toJSON`) uses; that must keep the complete roster, so never route
 * restore serialization through here.
 */
export function redactVisibilityForSeat(
  state: VisibilityState,
  seat: number
): VisibilityState {
  if (state.exceptPlayers?.includes(seat)) {
    return {
      mode: state.mode === 'count-only' ? 'count-only' : 'hidden',
      explicit: state.explicit,
    };
  }
  if (state.addPlayers?.includes(seat)) {
    return { mode: 'all', explicit: state.explicit };
  }
  return { mode: state.mode, explicit: state.explicit };
}

/**
 * True when `redactVisibilityForSeat` writes the same state for every seat in
 * `seats`, AND the serializer does the same thing with it (#411).
 *
 * A host has to know whether an audience shares a body BEFORE it encodes one,
 * because finding out by comparing encoded bodies costs the encoding the
 * sharing exists to remove. So this is answered from what the state DECLARES:
 * which of the three branches above each seat falls down.
 *
 * 'owner' IS THE CASE THE BYTES CANNOT SHOW. An owner-only state redacts to the
 * same bytes for everybody, and the serializer still shows the contents to the
 * owner alone -- ownership is a fact about the element, not about the state.
 * So a reader left to the base mode is only alike when that mode is not
 * 'owner'. A seat granted or denied outright never reaches the mode at all.
 */
export function visibilityRedactsAlikeFor(
  state: VisibilityState,
  seats: readonly number[]
): boolean {
  let first: 'denied' | 'granted' | 'base' | undefined;
  for (const seat of seats) {
    const branch = state.exceptPlayers?.includes(seat)
      ? 'denied'
      : state.addPlayers?.includes(seat)
        ? 'granted'
        : 'base';
    if (branch === 'base' && state.mode === 'owner') return false;
    if (first === undefined) first = branch;
    else if (branch !== first) return false;
  }
  return true;
}

/**
 * Create visibility state from a mode
 */
export function visibilityFromMode(mode: VisibilityMode): VisibilityState {
  return {
    mode,
    explicit: true,
  };
}

/**
 * Merge parent visibility with child override
 */
export function resolveVisibility(
  childVisibility: VisibilityState | undefined,
  parentVisibility: VisibilityState | undefined
): VisibilityState {
  // If child has explicit visibility, use it
  if (childVisibility?.explicit) {
    return childVisibility;
  }

  // Otherwise inherit from parent
  if (parentVisibility) {
    return {
      ...parentVisibility,
      explicit: false, // Mark as inherited
    };
  }

  // Default to visible to all
  return DEFAULT_VISIBILITY;
}
