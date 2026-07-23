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
 * Redact a zone/element VisibilityState for a single receiving seat (F-09
 * residual). The FULL grant roster (`addPlayers` / `exceptPlayers`) names
 * every OTHER seat that has been granted or denied vision of a hidden zone —
 * broadcasting it to all seats leaks who-can-see-what, the same class of leak
 * F-09 addressed. This keeps only the receiving seat's OWN grant/denial so a
 * client still knows whether IT is included, and drops all other seats.
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
  const redacted: VisibilityState = { mode: state.mode, explicit: state.explicit };
  if (state.addPlayers?.includes(seat)) {
    redacted.addPlayers = [seat];
  }
  if (state.exceptPlayers?.includes(seat)) {
    redacted.exceptPlayers = [seat];
  }
  return redacted;
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
