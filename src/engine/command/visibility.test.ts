import { describe, it, expect } from 'vitest';
import {
  canPlayerSee,
  visibilityFromMode,
  resolveVisibility,
  copyVisibilityState,
  redactVisibilityForSeat,
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

describe('redactVisibilityForSeat', () => {
  it('keeps the receiving seat own grant and drops every other seat', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 1, 2] });
    expect(redactVisibilityForSeat(full, 1)).toEqual({
      mode: 'hidden',
      explicit: true,
      addPlayers: [1],
    });
  });

  it('drops the roster entirely for a seat that was never granted', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 2] });
    expect(redactVisibilityForSeat(full, 1)).toEqual({ mode: 'hidden', explicit: true });
  });

  it('keeps the receiving seat own exclusion and drops the others', () => {
    const full = state({ mode: 'all', exceptPlayers: [1, 2] });
    expect(redactVisibilityForSeat(full, 2)).toEqual({
      mode: 'all',
      explicit: true,
      exceptPlayers: [2],
    });
  });

  it('keeps both lists when the seat appears in both', () => {
    const full = state({ mode: 'owner', addPlayers: [1], exceptPlayers: [1] });
    expect(redactVisibilityForSeat(full, 1)).toEqual({
      mode: 'owner',
      explicit: true,
      addPlayers: [1],
      exceptPlayers: [1],
    });
  });

  it('never leaks another seat identity into the redacted payload', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 3, 4], exceptPlayers: [5] });
    const redacted = redactVisibilityForSeat(full, 3);
    const leaked = JSON.stringify(redacted);
    for (const other of ['0', '4', '5']) {
      expect(leaked.includes(`[${other}]`)).toBe(false);
    }
    expect(redacted.addPlayers).toEqual([3]);
  });

  it('preserves the answer canPlayerSee gives for the receiving seat', () => {
    const full = state({ mode: 'hidden', addPlayers: [1, 2], exceptPlayers: [3] });
    for (const seat of [1, 2, 3, 4]) {
      expect(canPlayerSee(redactVisibilityForSeat(full, seat), seat, 0))
        .toBe(canPlayerSee(full, seat, 0));
    }
  });

  it('leaves the source state untouched', () => {
    const full = state({ mode: 'hidden', addPlayers: [0, 1] });
    redactVisibilityForSeat(full, 1);
    expect(full.addPlayers).toEqual([0, 1]);
  });
});
