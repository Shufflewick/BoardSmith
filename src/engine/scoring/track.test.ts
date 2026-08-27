import { describe, it, expect, vi } from 'vitest';
import { MonotonicTrack, UniqueTrack, CounterTrack } from './track.js';

describe('Track (shared behaviour, exercised through MonotonicTrack)', () => {
  const make = (overrides = {}) =>
    new MonotonicTrack({
      id: 'fulminate',
      direction: 'increasing',
      maxEntries: 3,
      pointsPerEntry: [1, 3, 6],
      completionBonus: 10,
      ...overrides,
    });

  it('defaults name to the id', () => {
    expect(make().name).toBe('fulminate');
    expect(make({ name: 'Fulminate' }).name).toBe('Fulminate');
  });

  it('defaults every position to zero points when none are given', () => {
    const track = new MonotonicTrack({ id: 't', direction: 'increasing', maxEntries: 3 });
    expect(track.pointsPerEntry).toEqual([0, 0, 0]);
  });

  it('defaults the completion bonus and special-entry flag off', () => {
    const track = new MonotonicTrack({ id: 't', direction: 'increasing', maxEntries: 2 });
    expect(track.completionBonus).toBe(0);
    expect(track.allowSpecialEntries).toBe(false);
  });

  it('starts empty', () => {
    const track = make();
    expect(track.isEmpty()).toBe(true);
    expect(track.length).toBe(0);
    expect(track.getLastEntry()).toBeUndefined();
    expect(track.calculatePoints()).toBe(0);
  });

  it('awards the points for the position an entry lands in', () => {
    const track = make();
    expect(track.add(1)).toBe(1);
    expect(track.add(2)).toBe(3);
    expect(track.add(3)).toBe(6);
  });

  it('throws an error naming the value and track when a rule blocks the add', () => {
    const track = make();
    track.add(5);
    expect(() => track.add(2)).toThrow('Cannot add value 2 to track fulminate');
  });

  it('leaves the track untouched when an add is rejected', () => {
    const track = make();
    track.add(5);
    expect(() => track.add(2)).toThrow();
    expect(track.getEntries().map((e) => e.value)).toEqual([5]);
  });

  it('reports completion once every position is filled', () => {
    const track = make();
    expect(track.isComplete()).toBe(false);
    track.add(1);
    track.add(2);
    expect(track.isComplete()).toBe(false);
    track.add(3);
    expect(track.isComplete()).toBe(true);
  });

  it('adds the completion bonus only once the track is full', () => {
    const track = make();
    track.add(1);
    track.add(2);
    expect(track.calculatePoints()).toBe(4);
    track.add(3);
    expect(track.calculatePoints()).toBe(1 + 3 + 6 + 10);
  });

  it('breaks the score into entries, bonus and total', () => {
    const track = make();
    track.add(1);
    track.add(2);
    expect(track.getPointsBreakdown()).toEqual({ entries: 4, bonus: 0, total: 4 });
    track.add(3);
    expect(track.getPointsBreakdown()).toEqual({ entries: 10, bonus: 10, total: 20 });
  });

  it('scores zero points for positions past the pointsPerEntry list', () => {
    const track = new MonotonicTrack({
      id: 't', direction: 'increasing', maxEntries: 3, pointsPerEntry: [5],
    });
    expect(track.add(1)).toBe(5);
    expect(track.add(2)).toBe(0);
  });

  it('reports the most recent entry', () => {
    const track = make();
    track.add(1);
    track.add(2);
    expect(track.getLastEntry()).toEqual({ value: 2, points: 3, isSpecial: false });
  });

  it('removeLastInternal drops the last entry', () => {
    const track = make();
    track.add(1);
    track.add(2);
    track.removeLastInternal();
    expect(track.getEntries().map((e) => e.value)).toEqual([1]);
  });

  it('removeLastInternal on an empty track is a safe no-op', () => {
    const track = make();
    expect(() => track.removeLastInternal()).not.toThrow();
    expect(track.length).toBe(0);
  });

  it('clear empties the track and its score', () => {
    const track = make();
    track.add(1);
    track.add(2);
    track.clear();
    expect(track.isEmpty()).toBe(true);
    expect(track.calculatePoints()).toBe(0);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const track = make();
    track.add(1);
    track.add(2);
    const restored = make();
    restored.fromJSON(track.toJSON());
    expect(restored.getEntries()).toEqual(track.getEntries());
    expect(restored.calculatePoints()).toBe(track.calculatePoints());
  });

  it('toJSON carries the track id', () => {
    expect(make().toJSON().id).toBe('fulminate');
  });

  it('toJSON copies the entries so later adds cannot mutate the snapshot', () => {
    const track = make();
    track.add(1);
    const snapshot = track.toJSON();
    track.add(2);
    expect(snapshot.entries).toHaveLength(1);
  });

  it('fromJSON detaches from the source array', () => {
    const track = make();
    const entries = [{ value: 1, points: 1 }];
    track.fromJSON({ entries });
    entries.push({ value: 2, points: 3 });
    expect(track.length).toBe(1);
  });

  describe('command emitter', () => {
    it('routes an add through the emitter instead of mutating state', () => {
      const track = make();
      const emit = vi.fn();
      track.setCommandEmitter(emit);
      track.add(4, true);
      expect(emit).toHaveBeenCalledWith('fulminate', 4, true);
      expect(track.isEmpty()).toBe(true);
    });

    it('still returns the points the entry will earn', () => {
      const track = make();
      track.setCommandEmitter(vi.fn());
      expect(track.add(4)).toBe(1);
    });

    it('reports the points of the row it filled when the emitter applies the add synchronously', () => {
      const track = make();
      track.setCommandEmitter((_id, value, isSpecial) => track.addInternal(value, isSpecial));

      const first = track.add(1);
      expect(first).toBe(track.getEntries()[0].points);
      expect(first).toBe(1);

      const second = track.add(2);
      expect(second).toBe(track.getEntries()[1].points);
      expect(second).toBe(3);

      const third = track.add(3);
      expect(third).toBe(track.getEntries()[2].points);
      expect(third).toBe(6);

      expect(first + second + third).toBe(track.getPointsBreakdown().entries);
    });

    it('still enforces the track rule before emitting', () => {
      const track = make();
      const emit = vi.fn();
      track.addInternal(5);
      track.setCommandEmitter(emit);
      expect(() => track.add(2)).toThrow();
      expect(emit).not.toHaveBeenCalled();
    });

    it('addInternal bypasses the emitter so the executor can apply the change', () => {
      const track = make();
      const emit = vi.fn();
      track.setCommandEmitter(emit);
      track.addInternal(4);
      expect(emit).not.toHaveBeenCalled();
      expect(track.getEntries().map((e) => e.value)).toEqual([4]);
    });

    it('addInternal enforces the rule too', () => {
      const track = make();
      track.addInternal(5);
      expect(() => track.addInternal(2)).toThrow('Cannot add value 2 to track fulminate');
    });
  });
});

describe('MonotonicTrack', () => {
  const increasing = (overrides = {}) =>
    new MonotonicTrack({ id: 'up', direction: 'increasing', maxEntries: 4, ...overrides });
  const decreasing = (overrides = {}) =>
    new MonotonicTrack({ id: 'down', direction: 'decreasing', maxEntries: 4, ...overrides });

  it('accepts any first value', () => {
    expect(increasing().canAdd(-99)).toBe(true);
    expect(decreasing().canAdd(99)).toBe(true);
  });

  it('increasing requires each value to beat the previous one', () => {
    const track = increasing();
    track.add(3);
    expect(track.canAdd(4)).toBe(true);
    expect(track.canAdd(3)).toBe(false);
    expect(track.canAdd(2)).toBe(false);
  });

  it('decreasing requires each value to fall below the previous one', () => {
    const track = decreasing();
    track.add(3);
    expect(track.canAdd(2)).toBe(true);
    expect(track.canAdd(3)).toBe(false);
    expect(track.canAdd(4)).toBe(false);
  });

  it('allowEqual relaxes the comparison to non-strict', () => {
    const up = increasing({ allowEqual: true });
    up.add(3);
    expect(up.canAdd(3)).toBe(true);
    expect(up.canAdd(2)).toBe(false);

    const down = decreasing({ allowEqual: true });
    down.add(3);
    expect(down.canAdd(3)).toBe(true);
    expect(down.canAdd(4)).toBe(false);
  });

  it('a special entry may equal the previous value when special entries are allowed', () => {
    const track = increasing({ allowSpecialEntries: true });
    track.add(3);
    expect(track.canAdd(3, true)).toBe(true);
    expect(track.canAdd(3, false)).toBe(false);
    expect(track.canAdd(2, true)).toBe(false);
  });

  it('a special entry gains nothing when special entries are not allowed', () => {
    const track = increasing();
    track.add(3);
    expect(track.canAdd(3, true)).toBe(false);
  });

  it('refuses everything once full', () => {
    const track = increasing({ maxEntries: 2 });
    track.add(1);
    track.add(2);
    expect(track.canAdd(3)).toBe(false);
    expect(() => track.add(3)).toThrow();
  });

  it('compares against the last entry, not the largest so far', () => {
    const track = increasing({ allowEqual: true });
    track.add(1);
    track.add(5);
    track.removeLastInternal();
    expect(track.canAdd(2)).toBe(true);
  });

  it('exposes its direction and equality rule', () => {
    expect(increasing().direction).toBe('increasing');
    expect(increasing().allowEqual).toBe(false);
    expect(increasing({ allowEqual: true }).allowEqual).toBe(true);
  });
});

describe('UniqueTrack', () => {
  const make = (overrides = {}) =>
    new UniqueTrack({ id: 'potions', maxEntries: 5, ...overrides });

  it('accepts each value once', () => {
    const track = make();
    track.add(7);
    expect(track.canAdd(8)).toBe(true);
    expect(track.canAdd(7)).toBe(false);
  });

  it('rejects a duplicate regardless of order', () => {
    const track = make();
    track.add(1);
    track.add(2);
    expect(track.canAdd(1)).toBe(false);
  });

  it('enforces the valid range at both ends', () => {
    const track = make({ validRange: { min: 1, max: 3 } });
    expect(track.canAdd(1)).toBe(true);
    expect(track.canAdd(3)).toBe(true);
    expect(track.canAdd(0)).toBe(false);
    expect(track.canAdd(4)).toBe(false);
  });

  it('accepts any value when no range is configured', () => {
    const track = make();
    expect(track.canAdd(-1000)).toBe(true);
    expect(track.canAdd(1000)).toBe(true);
  });

  it('lets a special entry duplicate when special entries are allowed', () => {
    const track = make({ allowSpecialEntries: true });
    track.add(7);
    expect(track.canAdd(7, true)).toBe(true);
    expect(track.canAdd(7, false)).toBe(false);
  });

  it('still enforces the range for a special entry', () => {
    const track = make({ allowSpecialEntries: true, validRange: { min: 1, max: 3 } });
    expect(track.canAdd(9, true)).toBe(false);
  });

  it('refuses everything once full', () => {
    const track = make({ maxEntries: 2 });
    track.add(1);
    track.add(2);
    expect(track.canAdd(3)).toBe(false);
  });

  it('hasValue reports what has been recorded', () => {
    const track = make();
    track.add(4);
    expect(track.hasValue(4)).toBe(true);
    expect(track.hasValue(5)).toBe(false);
  });

  it('getValues returns the recorded values as a set', () => {
    const track = make();
    track.add(4);
    track.add(9);
    expect(track.getValues()).toEqual(new Set([4, 9]));
  });

  it('getValues collapses duplicates admitted as special entries', () => {
    const track = make({ allowSpecialEntries: true });
    track.add(4);
    track.add(4, true);
    expect(track.getValues()).toEqual(new Set([4]));
    expect(track.length).toBe(2);
  });

  it('exposes its configured range', () => {
    expect(make({ validRange: { min: 1, max: 32 } }).validRange).toEqual({ min: 1, max: 32 });
    expect(make().validRange).toBeUndefined();
  });
});

describe('CounterTrack', () => {
  const make = (overrides = {}) =>
    new CounterTrack({ id: 'poison', maxEntries: 3, pointsPerCount: 2, ...overrides });

  it('accepts any value until it is full', () => {
    const track = make();
    expect(track.canAdd(0)).toBe(true);
    expect(track.canAdd(-5)).toBe(true);
    track.increment();
    track.increment();
    track.increment();
    expect(track.canAdd(1)).toBe(false);
  });

  it('scores pointsPerCount for every position', () => {
    const track = make();
    expect(track.pointsPerEntry).toEqual([2, 2, 2]);
    track.increment();
    track.increment();
    expect(track.calculatePoints()).toBe(4);
  });

  it('defaults pointsPerCount to zero', () => {
    const track = new CounterTrack({ id: 'c', maxEntries: 2 });
    expect(track.pointsPerCount).toBe(0);
    track.increment();
    expect(track.calculatePoints()).toBe(0);
  });

  it('adds the completion bonus when the counter maxes out', () => {
    const track = make({ completionBonus: 10 });
    track.increment();
    track.increment();
    expect(track.calculatePoints()).toBe(4);
    track.increment();
    expect(track.calculatePoints()).toBe(6 + 10);
  });

  it('count tracks the number of increments', () => {
    const track = make();
    expect(track.count).toBe(0);
    track.increment();
    expect(track.count).toBe(1);
    track.increment();
    expect(track.count).toBe(2);
  });

  it('increment returns the points earned', () => {
    expect(make().increment()).toBe(2);
  });

  it('increment throws once the counter is full', () => {
    const track = make({ maxEntries: 1 });
    track.increment();
    expect(() => track.increment()).toThrow('to track poison');
  });

  it('increment records a rising value so entries stay distinguishable', () => {
    const track = make();
    track.increment();
    track.increment();
    expect(track.getEntries().map((e) => e.value)).toEqual([1, 2]);
  });

  it('routes increment through the command emitter when one is set', () => {
    const track = make();
    const emit = vi.fn();
    track.setCommandEmitter(emit);
    track.increment();
    expect(emit).toHaveBeenCalledWith('poison', 1, false);
    expect(track.count).toBe(0);
  });
});
