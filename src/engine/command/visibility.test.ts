import { describe, it, expect } from 'vitest';
import {
  canPlayerSee,
  visibilityFromMode,
  resolveVisibility,
  copyVisibilityState,
  redactVisibilityForSeat,
  redactedVisibilityFor,
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
 * The question a host has to answer BEFORE it encodes anything (#411, regrouped
 * by ShufflewickPub #413): which seats will hold the same bytes?
 *
 * Answered from what the state DECLARES, because finding out by comparing
 * encoded bodies costs the encoding this exists to remove -- and answered as
 * the very thing the redaction writes, which is a MODE and nothing else. Two
 * seats given the same mode are handed the same spelling and were given the
 * same answer by `canPlayerSee`.
 *
 * `null` IS THE REFUSAL, and it is what keeps the answer complete. An 'owner'
 * mode is decided against the reader's OWNERSHIP of the element, which is not
 * in the state at all: two seats can be spelled the same way by an owner-mode
 * state and still be shown different things, so it refuses to answer for them
 * rather than claim they match.
 */
describe('redactedVisibilityFor', () => {
  const MODES_HERE: VisibilityMode[] = ['all', 'owner', 'hidden', 'count-only'];
  const ROSTERS = [undefined, [1], [1, 2], [1, 2, 3]];
  const SEATS_HERE = [0, 1, 2, 3, 4];
  const OWNERS = [undefined, 0, 1, 2, 3, 4];

  /** Every state there is to spell: every mode against every pair of rosters. */
  const EVERY_STATE: VisibilityState[] = MODES_HERE.flatMap((mode) =>
    ROSTERS.flatMap((addPlayers) =>
      ROSTERS.map((exceptPlayers) => state({ mode, addPlayers, exceptPlayers })),
    ),
  );

  /** Every pair of seats, including a seat against itself. */
  const EVERY_PAIR: [number, number][] = SEATS_HERE.flatMap((first) =>
    SEATS_HERE.map((second): [number, number] => [first, second]),
  );

  const shown = (full: VisibilityState): string =>
    `mode ${full.mode} add ${full.addPlayers} except ${full.exceptPlayers}`;

  it('answers exactly the mode the redaction writes, over every mode and roster', () => {
    // The tie that makes this a signature rather than a second opinion: where
    // it answers at all, it answers what the bytes will actually say.
    for (const full of EVERY_STATE) {
      for (const seat of SEATS_HERE) {
        const spelled = redactedVisibilityFor(full, seat);
        if (spelled === null) continue;
        expect(spelled, `${shown(full)} seat ${seat}`).toBe(
          redactVisibilityForSeat(full, seat).mode,
        );
      }
    }
  });

  it('refuses an owner-mode state for every seat it does not grant outright', () => {
    // Ownership is a fact about the ELEMENT, so the state cannot say what a
    // reader left to the base mode -- or denied while owning the thing -- will
    // be shown. A seat granted past the mode never reaches it.
    const owned = state({ mode: 'owner', addPlayers: [1], exceptPlayers: [2] });
    expect(redactedVisibilityFor(owned, 1)).toBe('all');
    expect(redactedVisibilityFor(owned, 2), 'a denied owner is still shown its own').toBe(null);
    expect(redactedVisibilityFor(owned, 3)).toBe(null);
  });

  it('answers every seat of every mode ownership does not enter', () => {
    // The complement, so the refusal cannot quietly widen into "never group
    // anything": 'owner' is the ONLY mode ownership enters, and every seat of
    // every other mode is answered whatever the rosters say.
    for (const full of EVERY_STATE) {
      for (const seat of SEATS_HERE) {
        const grantedOutright =
          full.exceptPlayers?.includes(seat) !== true && full.addPlayers?.includes(seat) === true;
        expect(
          redactedVisibilityFor(full, seat) === null,
          `${shown(full)} seat ${seat}: only an owner-only state it does not grant may refuse`,
        ).toBe(full.mode === 'owner' && !grantedOutright);
      }
    }
  });

  it('gives two seats spelled alike the same bytes and the same answer', () => {
    // THE NON-COLLISION ARGUMENT, exhaustively rather than by sample: over
    // every mode, every roster and every owner, two seats given the same mode
    // here are handed identical redacted bytes AND were given identical answers
    // by `canPlayerSee`. A signature that could group two seats owed different
    // views would fail here.
    for (const full of EVERY_STATE) {
      for (const [first, second] of EVERY_PAIR) {
        const spelled = redactedVisibilityFor(full, first);
        if (spelled === null || spelled !== redactedVisibilityFor(full, second)) continue;
        expectSpelledAlike(full, first, second, spelled);
      }
    }
  });

  /** What two seats spelled the same way are owed: the same bytes, the same answer. */
  function expectSpelledAlike(
    full: VisibilityState,
    first: number,
    second: number,
    spelled: VisibilityMode,
  ): void {
    const where = `${shown(full)} seats ${first}/${second} spelled ${spelled}`;
    expect(
      JSON.stringify(redactVisibilityForSeat(full, first)),
      `${where}: spelled alike, different bytes`,
    ).toBe(JSON.stringify(redactVisibilityForSeat(full, second)));
    for (const owner of OWNERS) {
      expect(
        canPlayerSee(full, first, owner),
        `${where} owner ${owner}: spelled alike, different answer`,
      ).toBe(canPlayerSee(full, second, owner));
    }
  }

  it('merges a grant into a room that was public all along', () => {
    // There is nothing to tell a granted reader of a public room that a reader
    // who was never named is not already told, so they are one group.
    const full = state({ mode: 'all', addPlayers: [1] });
    expect(redactedVisibilityFor(full, 1)).toBe('all');
    expect(redactedVisibilityFor(full, 2)).toBe('all');
  });

  it('splits a partly-granted room into the two groups it really has', () => {
    // What #413 is for. The whole audience does not agree, and it does not have
    // to: the granted are spelled one way and the ungranted another.
    const full = state({ mode: 'hidden', addPlayers: [1, 2] });
    expect([1, 2, 3, 4].map((seat) => redactedVisibilityFor(full, seat))).toEqual([
      'all',
      'all',
      'hidden',
      'hidden',
    ]);
  });

  it('keeps a denied reader of a count-only zone apart from a granted one', () => {
    const full = state({ mode: 'count-only', addPlayers: [1], exceptPlayers: [2] });
    expect(redactedVisibilityFor(full, 1)).toBe('all');
    expect(redactedVisibilityFor(full, 2)).toBe('count-only');
    expect(redactedVisibilityFor(full, 3)).toBe('count-only');
  });
});
