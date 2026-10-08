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
 * WHAT A RESTORE OF A REDACTED TREE READS. A redacted view can be loaded back
 * into a live game -- the MCTS search sandbox does exactly that -- and such a
 * game now reads a granted room as plainly public where it used to read it as
 * hidden-with-a-grant-to-the-reader. NEITHER WAS EVER TRUE about the other
 * seats: the roster the truth lives in was redacted away before the tree left,
 * and a searcher reasoning from `addPlayers: [me]` was reasoning from a fact
 * the engine had invented for it just as much. Accepted deliberately (#411);
 * the checkpoint/restore path, which is the one that must be exact, reads the
 * full `toJSON()` and never comes through here.
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
  return { mode: redactedModeForSeat(state, seat), explicit: state.explicit };
}

/**
 * The mode the redaction writes for one seat: denial, then grant, then the base
 * mode, which is `canPlayerSee`'s own order.
 *
 * The ONE place that order is spelled out. `redactedVisibilityFor` below has to
 * answer exactly what this writes -- a second copy of the precedence is how a
 * grouping key comes to disagree with the bytes it is grouping.
 */
function redactedModeForSeat(state: VisibilityState, seat: number): VisibilityMode {
  if (state.exceptPlayers?.includes(seat)) {
    return state.mode === 'count-only' ? 'count-only' : 'hidden';
  }
  if (state.addPlayers?.includes(seat)) return 'all';
  return state.mode;
}

/**
 * THE MODE `redactVisibilityForSeat` WRITES FOR THIS SEAT, or `null` when this
 * state does not decide what the seat is shown (#411, regrouped by
 * ShufflewickPub #413).
 *
 * A host has to know which seats of a fan-out will hold the same bytes BEFORE
 * it encodes any of them, because finding out by comparing encoded bodies costs
 * the encoding the sharing exists to remove. So it is answered from what the
 * state DECLARES, and it is answered as the very thing the redaction writes.
 *
 * THE REDACTED MODE IS THE SEAT'S WHOLE CONTRIBUTION. What leaves the redaction
 * is `{ mode, explicit }` and nothing else -- no roster, and never the seat
 * number -- and `explicit` is a fact about the state rather than about the
 * reader. So two seats given the same mode here are handed identical bytes.
 * They were also given the same ANSWER: across all four modes, 'all' is written
 * exactly where `canPlayerSee` said yes and 'hidden'/'count-only' exactly where
 * it said no, which `visibility.test.ts` holds over every mode and roster.
 *
 * IT MERGES BRANCHES THAT SPELL ALIKE, which is why it is the mode rather than
 * the branch. A seat granted into a plainly public room and a seat that was
 * never named in it are told the same thing, because there is nothing else to
 * tell them.
 *
 * 'owner' IS THE MODE THE STATE CANNOT ANSWER FOR, and it is refused for every
 * seat it does not grant OUTRIGHT. Ownership is a fact about the ELEMENT rather
 * than about the state, and the serializer consults it twice: `canPlayerSee`
 * shows an owner-only zone to its owner alone, and an owner-only zone that
 * denies everybody still shows its children to its owner under their real ids
 * while giving everybody else synthetic ones. So a seat left to the mode and a
 * seat denied by the roster are both answered `null`; only a seat granted past
 * the mode, which never reaches ownership at all, gets an answer.
 */
export function redactedVisibilityFor(
  state: VisibilityState,
  seat: number
): VisibilityMode | null {
  const mode = redactedModeForSeat(state, seat);
  // 'all' out of an owner-only state is a seat granted PAST the mode, which is
  // the one reader of one whose answer ownership plays no part in.
  if (state.mode === 'owner' && mode !== 'all') return null;
  return mode;
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
