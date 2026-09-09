import { describe, it, expect } from 'vitest';
import {
  canPlayerSee,
  visibilityFromMode,
  resolveVisibility,
  copyVisibilityState,
  redactVisibilityForSeat,
  visibilityRedactsAlikeFor,
  DEFAULT_VISIBILITY,
  type VisibilityState,
  type VisibilityMode,
} from './visibility.js';

const state = (partial: Partial<VisibilityState>): VisibilityState => ({
  mode: 'all',
  explicit: true,
  ...partial,
});

describe('canPlayerSee', () => {
  describe("mode 'all'", () => {
    it('shows the element to every seat', () => {
      const vis = state({ mode: 'all' });
      for (const seat of [0, 1, 2, 3]) {
        expect(canPlayerSee(vis, seat, undefined)).toBe(true);
      }
    });

    it('hides it from seats on the exception list', () => {
      const vis = state({ mode: 'all', exceptPlayers: [1] });
      expect(canPlayerSee(vis, 0, undefined)).toBe(true);
      expect(canPlayerSee(vis, 1, undefined)).toBe(false);
      expect(canPlayerSee(vis, 2, undefined)).toBe(true);
    });
  });

  describe("mode 'owner'", () => {
    it('shows the element only to its owner', () => {
      const vis = state({ mode: 'owner' });
      expect(canPlayerSee(vis, 0, 0)).toBe(true);
      expect(canPlayerSee(vis, 1, 0)).toBe(false);
    });

    it('hides it from everyone when there is no owner', () => {
      const vis = state({ mode: 'owner' });
      for (const seat of [0, 1, 2]) {
        expect(canPlayerSee(vis, seat, undefined)).toBe(false);
      }
    });

    it('grants vision to explicitly added seats', () => {
      const vis = state({ mode: 'owner', addPlayers: [2] });
      expect(canPlayerSee(vis, 0, 0)).toBe(true);
      expect(canPlayerSee(vis, 1, 0)).toBe(false);
      expect(canPlayerSee(vis, 2, 0)).toBe(true);
    });
  });

  describe("modes 'hidden' and 'count-only'", () => {
    it.each(['hidden', 'count-only'] as const)('hides %s from every seat, owner included', (mode) => {
      const vis = state({ mode });
      expect(canPlayerSee(vis, 0, 0)).toBe(false);
      expect(canPlayerSee(vis, 1, 0)).toBe(false);
    });

    it.each(['hidden', 'count-only'] as const)('%s can still be opened to a named seat', (mode) => {
      const vis = state({ mode, addPlayers: [1] });
      expect(canPlayerSee(vis, 0, 0)).toBe(false);
      expect(canPlayerSee(vis, 1, 0)).toBe(true);
    });
  });

  describe('precedence', () => {
    it('an exception beats an inclusion for the same seat', () => {
      const vis = state({ mode: 'hidden', addPlayers: [1], exceptPlayers: [1] });
      expect(canPlayerSee(vis, 1, 1)).toBe(false);
    });

    it('an exception beats ownership', () => {
      const vis = state({ mode: 'owner', exceptPlayers: [0] });
      expect(canPlayerSee(vis, 0, 0)).toBe(false);
    });
  });

  it('treats empty grant lists as absent', () => {
    const vis = state({ mode: 'hidden', addPlayers: [], exceptPlayers: [] });
    expect(canPlayerSee(vis, 0, 0)).toBe(false);
    expect(canPlayerSee(state({ mode: 'all', exceptPlayers: [] }), 0, undefined)).toBe(true);
  });

  it('does not mutate the visibility state it is handed', () => {
    const vis = state({ mode: 'owner', addPlayers: [2], exceptPlayers: [3] });
    const before = JSON.parse(JSON.stringify(vis));
    canPlayerSee(vis, 1, 0);
    expect(vis).toEqual(before);
  });
});

describe('visibilityFromMode', () => {
  it.each(['all', 'owner', 'hidden', 'count-only'] as const)(
    'builds an explicit state for mode %s',
    (mode) => {
      expect(visibilityFromMode(mode)).toEqual({ mode, explicit: true });
    }
  );

  it('marks the result explicit so it wins over inherited zone visibility', () => {
    const child = visibilityFromMode('hidden');
    expect(resolveVisibility(child, visibilityFromMode('all'))).toBe(child);
  });

  it('returns a fresh object each call', () => {
    expect(visibilityFromMode('all')).not.toBe(visibilityFromMode('all'));
  });

  it('agrees with canPlayerSee for every mode', () => {
    const expected: Record<VisibilityMode, boolean> = {
      all: true,
      owner: true,
      hidden: false,
      'count-only': false,
    };
    for (const [mode, ownerCanSee] of Object.entries(expected) as [VisibilityMode, boolean][]) {
      expect(canPlayerSee(visibilityFromMode(mode), 0, 0)).toBe(ownerCanSee);
    }
  });
});

describe('DEFAULT_VISIBILITY', () => {
  it('is public, inherited visibility', () => {
    expect(DEFAULT_VISIBILITY).toEqual({ mode: 'all', explicit: false });
  });

  it('is not explicit, so a zone setting can still override it', () => {
    const resolved = resolveVisibility(DEFAULT_VISIBILITY, visibilityFromMode('hidden'));
    expect(resolved.mode).toBe('hidden');
  });

  it('survives resolveVisibility unmutated', () => {
    resolveVisibility(undefined, undefined);
    resolveVisibility(DEFAULT_VISIBILITY, visibilityFromMode('owner'));
    expect(DEFAULT_VISIBILITY).toEqual({ mode: 'all', explicit: false });
  });
});

describe('resolveVisibility', () => {
  it('keeps an explicit child override untouched', () => {
    const child = state({ mode: 'hidden', explicit: true });
    expect(resolveVisibility(child, state({ mode: 'all' }))).toBe(child);
  });

  it('inherits the parent zone when the child is not explicit', () => {
    const parent = state({ mode: 'owner', addPlayers: [3] });
    const resolved = resolveVisibility(state({ mode: 'all', explicit: false }), parent);
    expect(resolved.mode).toBe('owner');
    expect(resolved.addPlayers).toEqual([3]);
  });

  it('marks an inherited result as not explicit so deeper zones keep inheriting', () => {
    const resolved = resolveVisibility(undefined, state({ mode: 'hidden' }));
    expect(resolved.explicit).toBe(false);
  });

  it('inherits when the child is undefined entirely', () => {
    expect(resolveVisibility(undefined, state({ mode: 'count-only' })).mode).toBe('count-only');
  });

  it('falls back to the public default with no child and no parent', () => {
    expect(resolveVisibility(undefined, undefined)).toEqual(DEFAULT_VISIBILITY);
  });

  it('does not alias the parent object it inherited from', () => {
    const parent = state({ mode: 'hidden' });
    const resolved = resolveVisibility(undefined, parent);
    expect(resolved).not.toBe(parent);
    expect(parent.explicit).toBe(true);
  });

  it('an explicit child beats the parent even when both are hidden-ish', () => {
    const child = visibilityFromMode('all');
    expect(resolveVisibility(child, visibilityFromMode('hidden')).mode).toBe('all');
  });
});

describe('copyVisibilityState', () => {
  it('reproduces every field', () => {
    const original = state({ mode: 'owner', addPlayers: [1, 2], exceptPlayers: [3] });
    expect(copyVisibilityState(original)).toEqual(original);
  });

  it('detaches the grant arrays so later grants cannot corrupt a snapshot', () => {
    const original = state({ mode: 'hidden', addPlayers: [1], exceptPlayers: [2] });
    const copy = copyVisibilityState(original);
    original.addPlayers!.push(9);
    original.exceptPlayers!.push(8);
    expect(copy.addPlayers).toEqual([1]);
    expect(copy.exceptPlayers).toEqual([2]);
  });

  it('detaches the top-level object', () => {
    const original = state({ mode: 'all' });
    const copy = copyVisibilityState(original);
    original.mode = 'hidden';
    expect(copy.mode).toBe('all');
  });

  it('omits absent grant lists rather than inventing empty ones', () => {
    const copy = copyVisibilityState(state({ mode: 'all' }));
    expect('addPlayers' in copy).toBe(false);
    expect('exceptPlayers' in copy).toBe(false);
  });
});

/**
 * ShufflewickPub #411: THE REDACTED STATE NAMES NOBODY.
 *
 * The roster is redacted because it names every other seat granted or denied
 * vision, and that is who-can-see-what (the F-09 leak class). What the reader
 * is owed out of it is one bit: whether IT is included. Spelling that bit as
 * `addPlayers: [yourSeat]` made every reader's copy different, so a room
 * scoped to everybody standing in it was one encoding per watcher. Spelling it
 * in the MODE instead says the same thing in the same bytes to every reader
 * who holds the same grant, and tells each of them strictly less than the
 * roster did.
 */
describe('redactVisibilityForSeat', () => {
  const MODES: VisibilityMode[] = ['all', 'owner', 'hidden', 'count-only'];

  it('names nobody at all, not even the seat that is reading it', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 1, 2], exceptPlayers: [4] });
    for (const seat of [0, 1, 2, 3, 4]) {
      const redacted = redactVisibilityForSeat(full, seat);
      expect('addPlayers' in redacted, `seat ${seat}`).toBe(false);
      expect('exceptPlayers' in redacted, `seat ${seat}`).toBe(false);
    }
  });

  it('spells a grant the same way for every granted seat', () => {
    const full = state({ mode: 'hidden', addPlayers: [1, 2, 3] });
    const spellings = new Set(
      [1, 2, 3].map((seat) => JSON.stringify(redactVisibilityForSeat(full, seat))),
    );
    expect(spellings.size, 'one spelling for the whole granted roster').toBe(1);
  });

  it('spells a denial the same way for every denied seat', () => {
    const full = state({ mode: 'all', exceptPlayers: [1, 2, 3] });
    const spellings = new Set(
      [1, 2, 3].map((seat) => JSON.stringify(redactVisibilityForSeat(full, seat))),
    );
    expect(spellings.size).toBe(1);
  });

  it('tells a granted reader nothing about who else was let in', () => {
    // Strictly LESS than the roster told it: a reader can no longer tell a
    // room it was let into from a room that was public all along, and there is
    // nothing left in the state that could name another seat.
    const grantedIn = redactVisibilityForSeat(state({ mode: 'hidden', addPlayers: [1, 2, 3] }), 1);
    const publicAllAlong = redactVisibilityForSeat(state({ mode: 'all' }), 1);
    expect(grantedIn).toEqual(publicAllAlong);
  });

  it('gives every seat the answer canPlayerSee gave it, over every mode and roster', () => {
    // THE SAFETY ARGUMENT, exhaustively rather than by sample. The redaction
    // may spell the answer differently; it may never change it. `canPlayerSee`
    // reads denial, then grant, then the base mode, which is exactly the three
    // branches the redaction writes.
    for (const mode of MODES) {
      for (const addPlayers of [undefined, [1], [1, 2]]) {
        for (const exceptPlayers of [undefined, [1], [2, 3]]) {
          const full = state({ mode, addPlayers, exceptPlayers });
          for (const seat of [0, 1, 2, 3]) {
            for (const owner of [undefined, 0, 1]) {
              expect(
                canPlayerSee(redactVisibilityForSeat(full, seat), seat, owner),
                `mode ${mode} add ${addPlayers} except ${exceptPlayers} seat ${seat} owner ${owner}`,
              ).toBe(canPlayerSee(full, seat, owner));
            }
          }
        }
      }
    }
  });

  it('keeps a count-only zone count-only for the reader it denies', () => {
    // `canPlayerSee` refuses 'hidden' and 'count-only' alike, but the
    // serializer shows a count for one and nothing at all for the other, and
    // the children were written from the LIVE mode before this ran.
    const full = state({ mode: 'count-only', exceptPlayers: [1] });
    expect(redactVisibilityForSeat(full, 1)).toEqual({ mode: 'count-only', explicit: true });
  });

  it('carries the explicit flag through, so inheritance still resolves', () => {
    const inherited = redactVisibilityForSeat(
      { mode: 'hidden', addPlayers: [1], explicit: false },
      1,
    );
    expect(inherited).toEqual({ mode: 'all', explicit: false });
  });

  it('leaves the source state untouched', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 1] });
    redactVisibilityForSeat(full, 1);
    expect(full.addPlayers).toEqual([0, 1]);
  });
});

/**
 * The question a host has to answer BEFORE it encodes anything (#411): will
 * these seats hold the same bytes? Answered from what the state declares,
 * because finding out by comparing encoded bodies costs the encoding this
 * exists to remove.
 */
describe('visibilityRedactsAlikeFor', () => {
  /** The predicate, held against actually redacting and comparing. */
  function alike(full: VisibilityState, seats: readonly number[]): boolean {
    return new Set(seats.map((seat) => JSON.stringify(redactVisibilityForSeat(full, seat)))).size === 1;
  }

  it('says yes when every seat holds the same grant', () => {
    const full = state({ mode: 'hidden', addPlayers: [1, 2, 3] });
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(true);
    expect(alike(full, [1, 2, 3])).toBe(true);
  });

  it('says no when one seat in the audience is outside the grant', () => {
    const full = state({ mode: 'hidden', addPlayers: [1, 2] });
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(false);
    expect(alike(full, [1, 2, 3])).toBe(false);
  });

  it('says no when one seat in the audience is denied', () => {
    const full = state({ mode: 'all', exceptPlayers: [3] });
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(false);
    expect(alike(full, [1, 2, 3])).toBe(false);
  });

  it('says yes when every seat in the audience is denied', () => {
    const full = state({ mode: 'all', exceptPlayers: [1, 2, 3] });
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(true);
    expect(alike(full, [1, 2, 3])).toBe(true);
  });

  it('says yes for a plain mode nobody is named in', () => {
    expect(visibilityRedactsAlikeFor(state({ mode: 'hidden' }), [1, 2, 3])).toBe(true);
    expect(visibilityRedactsAlikeFor(state({ mode: 'all' }), [1, 2, 3])).toBe(true);
  });

  it('says NO for an owner-only mode, whose bytes are alike but whose answer is not', () => {
    // Ownership is not in the state, so the bytes cannot show the difference
    // and comparing them would be the wrong question. What differs is what the
    // serializer DOES with them: the owner sees the contents and nobody else
    // does.
    const full = state({ mode: 'owner' });
    expect(alike(full, [1, 2, 3]), 'the bytes match').toBe(true);
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(false);
  });

  it('says yes for an owner-only mode every seat has been granted past', () => {
    const full = state({ mode: 'owner', addPlayers: [1, 2, 3] });
    expect(visibilityRedactsAlikeFor(full, [1, 2, 3])).toBe(true);
    expect(alike(full, [1, 2, 3])).toBe(true);
  });

  it('says yes for an empty audience, which has nothing to disagree about', () => {
    expect(visibilityRedactsAlikeFor(state({ mode: 'owner' }), [])).toBe(true);
  });
});
