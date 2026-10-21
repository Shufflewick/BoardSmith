import { describe, it, expect } from 'vitest';
import {
  monotonicTrack,
  uniqueTrack,
  counterTrack,
  canAddToTrack,
  addToTrack,
  incrementCounter,
  isTrackComplete,
  trackPoints,
} from './track.js';

describe('track functions (#779)', () => {
  it('a new track is plain data with its defaults filled in', () => {
    expect(monotonicTrack({ id: 'f', direction: 'increasing', maxEntries: 2 })).toEqual({
      kind: 'monotonic',
      id: 'f',
      name: 'f',
      maxEntries: 2,
      pointsPerEntry: [0, 0],
      completionBonus: 0,
      allowSpecialEntries: false,
      direction: 'increasing',
      allowEqual: false,
      entries: [],
    });
  });

  it('addToTrack records the entry and returns the points for its position', () => {
    const track = monotonicTrack({ id: 'f', direction: 'increasing', maxEntries: 3, pointsPerEntry: [1, 3, 6] });
    expect(addToTrack(track, 4)).toBe(1);
    expect(addToTrack(track, 9)).toBe(3);
    expect(track.entries).toEqual([
      { value: 4, points: 1, isSpecial: false },
      { value: 9, points: 3, isSpecial: false },
    ]);
  });

  it('addToTrack scores 0 for a position past the end of pointsPerEntry', () => {
    const track = uniqueTrack({ id: 'u', maxEntries: 3, pointsPerEntry: [4] });
    expect(addToTrack(track, 1)).toBe(4);
    expect(addToTrack(track, 2)).toBe(0);
  });

  it('addToTrack throws, naming the value and track, and leaves the track untouched when refused', () => {
    const track = monotonicTrack({ id: 'fulminate', direction: 'increasing', maxEntries: 3 });
    addToTrack(track, 5);
    expect(() => addToTrack(track, 5)).toThrow('Cannot add value 5 to track fulminate');
    expect(track.entries).toHaveLength(1);
  });

  describe('monotonic', () => {
    it('increasing needs each value above the last; decreasing below it', () => {
      const up = monotonicTrack({ id: 'u', direction: 'increasing', maxEntries: 5 });
      addToTrack(up, 3);
      expect(canAddToTrack(up, 3)).toBe(false);
      expect(canAddToTrack(up, 4)).toBe(true);
      const down = monotonicTrack({ id: 'd', direction: 'decreasing', maxEntries: 5 });
      addToTrack(down, 3);
      expect(canAddToTrack(down, 3)).toBe(false);
      expect(canAddToTrack(down, 2)).toBe(true);
    });

    it('allowEqual, or a special entry on a track that allows them, may repeat the last value', () => {
      const equal = monotonicTrack({ id: 'e', direction: 'increasing', maxEntries: 5, allowEqual: true });
      addToTrack(equal, 3);
      expect(canAddToTrack(equal, 3)).toBe(true);
      const special = monotonicTrack({ id: 's', direction: 'increasing', maxEntries: 5, allowSpecialEntries: true });
      addToTrack(special, 3);
      expect(canAddToTrack(special, 3)).toBe(false);
      expect(canAddToTrack(special, 3, true)).toBe(true);
      const plain = monotonicTrack({ id: 'p', direction: 'increasing', maxEntries: 5 });
      addToTrack(plain, 3);
      expect(canAddToTrack(plain, 3, true)).toBe(false);
    });
  });

  describe('unique', () => {
    it('accepts each value once and only inside the range', () => {
      const track = uniqueTrack({ id: 'p', maxEntries: 5, validRange: { min: 1, max: 6 } });
      expect(canAddToTrack(track, 0)).toBe(false);
      expect(canAddToTrack(track, 7)).toBe(false);
      addToTrack(track, 6);
      expect(canAddToTrack(track, 6)).toBe(false);
      expect(canAddToTrack(track, 1)).toBe(true);
    });

    it('a special entry may duplicate when the track allows it, but never leave the range', () => {
      const track = uniqueTrack({ id: 'p', maxEntries: 5, validRange: { min: 1, max: 6 }, allowSpecialEntries: true });
      addToTrack(track, 2);
      expect(canAddToTrack(track, 2, true)).toBe(true);
      expect(canAddToTrack(track, 9, true)).toBe(false);
    });

    it('a special entry may not duplicate on a track that does not allow special entries', () => {
      const track = uniqueTrack({ id: 'p', maxEntries: 5 });
      addToTrack(track, 2);
      expect(canAddToTrack(track, 2, true)).toBe(false);
    });
  });

  describe('counter', () => {
    it('incrementCounter scores pointsPerCount per mark and refuses once full', () => {
      const track = counterTrack({ id: 'poison', maxEntries: 2, pointsPerCount: 2, completionBonus: 10 });
      expect(incrementCounter(track)).toBe(2);
      expect(isTrackComplete(track)).toBe(false);
      expect(trackPoints(track)).toBe(2);
      incrementCounter(track);
      expect(isTrackComplete(track)).toBe(true);
      expect(trackPoints(track)).toBe(14);
      expect(() => incrementCounter(track)).toThrow('Cannot add value 3 to track poison');
    });
  });

  it('every kind refuses everything once full', () => {
    for (const track of [
      monotonicTrack({ id: 'm', direction: 'increasing', maxEntries: 1 }),
      uniqueTrack({ id: 'u', maxEntries: 1 }),
      counterTrack({ id: 'c', maxEntries: 1 }),
    ]) {
      addToTrack(track, 1);
      expect(canAddToTrack(track, 2, true)).toBe(false);
    }
  });

  it('trackPoints adds the completion bonus only once the track is full', () => {
    const track = monotonicTrack({ id: 'f', direction: 'increasing', maxEntries: 2, pointsPerEntry: [1, 3], completionBonus: 10 });
    addToTrack(track, 1);
    expect(trackPoints(track)).toBe(1);
    addToTrack(track, 2);
    expect(trackPoints(track)).toBe(14);
  });
});

describe('track size (#786)', () => {
  const makers = {
    monotonicTrack: (maxEntries: number) => monotonicTrack({ id: 't', direction: 'increasing', maxEntries, completionBonus: 5 }),
    uniqueTrack: (maxEntries: number) => uniqueTrack({ id: 't', maxEntries, completionBonus: 5 }),
    counterTrack: (maxEntries: number) => counterTrack({ id: 't', maxEntries, completionBonus: 5 }),
  };

  for (const [name, make] of Object.entries(makers)) {
    it.each([0, -1, 1.5, NaN])(`${name} refuses maxEntries %s, so an empty track never earns its bonus`, (maxEntries) => {
      expect(() => make(maxEntries)).toThrow(/Track "t" needs maxEntries of 1 or more/);
    });
  }
});
