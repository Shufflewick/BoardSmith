// @vitest-environment jsdom
/**
 * The leak assertion has to actually check something (#20).
 *
 * `stringifyScalar` returned undefined for anything but a string or number, so
 * a game packing private state into arrays contributed ZERO forbidden markers
 * for those fields, and the assertion passed over an almost-empty marker set.
 *
 * (#20 also found the inert controller a world seat was mounted with drifting
 * behind the real one. Since #413 every seat gets the real controller.)
 */
import { describe, it, expect } from 'vitest';
import { _identityCandidatesForTests } from './dom-leak.js';

describe('array-valued attributes produce markers (#20)', () => {
  const candidates = (attributes: Record<string, unknown>) =>
    _identityCandidatesForTests({ className: 'Sector', id: 1, attributes });

  it('still extracts strings and numbers', () => {
    const values = candidates({ species: 'wolf', strength: 12 }).map((c) => c.value);
    expect(values).toContain('wolf');
    expect(values).toContain('12');
  });

  it('extracts each element of an array of scalars', () => {
    // The shape the report describes: private state packed positionally.
    const values = candidates({ stats: [1234, 'wolf'] }).map((c) => c.value);
    expect(values).toContain('1234');
    expect(values).toContain('wolf');
  });

  it('attributes each marker to the field it came from', () => {
    const found = candidates({ stats: [1234, 'wolf'] });
    expect(found.every((c) => c.attribute === 'stats')).toBe(true);
  });

  it('drops a short number reached by recursion — it is not evidence', () => {
    // A positional stat block is full of small integers, and a "3" on the page
    // says a 3 is on screen, not that THIS 3 is. That collision class is why
    // the utility scopes its DOM scan in the first place.
    const values = candidates({ stats: [7, 3, 'wolf'] }).map((c) => c.value);
    expect(values).not.toContain('7');
    expect(values).not.toContain('3');
    expect(values).toContain('wolf');
  });

  it('keeps a short number that is an attribute\'s WHOLE value, as it always did', () => {
    // The attribute name scopes it, and this was the contract before arrays
    // were walked at all.
    expect(candidates({ rank: 3 }).map((c) => c.value)).toContain('3');
  });

  it('reaches inside a nested object, which is the other way state gets packed', () => {
    const values = candidates({ body: { species: 'hare', wounds: 2049 } }).map((c) => c.value);
    expect(values).toContain('hare');
    expect(values).toContain('2049');
  });

  it('reaches inside an array of objects', () => {
    const values = candidates({ pack: [{ name: 'wolf' }, { name: 'hare' }] }).map((c) => c.value);
    expect(values).toContain('wolf');
    expect(values).toContain('hare');
  });

  it('still ignores booleans, which would false-positive on almost any page', () => {
    const values = candidates({ faceUp: true, revealed: [true, false] }).map((c) => c.value);
    expect(values).not.toContain('true');
    expect(values).not.toContain('false');
  });

  it('skips a serialized element reference — an id is a public handle, not identity', () => {
    // Recursing into these is what turns "the page renders element 1" into a
    // reported leak. If element 1's identity is secret, that is element 1's own
    // attributes to protect, and they are walked in their own right.
    const found = candidates({ occupant: { __elementId: 1 } });
    expect(found.map((c) => c.value)).not.toContain('1');
  });

  it('skips a player reference — a seat number is on screen by design', () => {
    const found = candidates({ player: { seat: 1, name: 'A' } });
    expect(found.map((c) => c.value)).not.toContain('1');
    expect(found.map((c) => c.value)).not.toContain('A');
  });

  it('still skips $-prefixed layout metadata', () => {
    const found = candidates({ $gap: 4, $direction: 'row' });
    expect(found).toEqual([]);
  });

  it('does not recurse forever on a self-referencing attribute', () => {
    const loop: Record<string, unknown> = { name: 'wolf' };
    loop.self = loop;
    expect(() => candidates({ loop })).not.toThrow();
    expect(candidates({ loop }).map((c) => c.value)).toContain('wolf');
  });
});
