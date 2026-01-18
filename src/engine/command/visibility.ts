/**
 * Visibility modes for game elements
 *
 * - 'all': Visible to all players (default)
 * - 'owner': Visible only to the element's owner
 * - 'hidden': Not visible to any player
 * - 'count-only': Players can see count but not contents (e.g., opponent's hand)
 * - 'unordered': Players can see contents but not order (e.g., shuffled deck peek)
 */
export type VisibilityMode = 'all' | 'owner' | 'hidden' | 'count-only' | 'unordered';

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
    case 'unordered':
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
