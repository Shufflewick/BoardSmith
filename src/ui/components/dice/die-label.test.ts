/**
 * A die drawn in WebGL is pixels and nothing else: its face value exists only
 * on a canvas, so nothing reads it out (issue 82). This is the text that says
 * what the die shows.
 */
import { describe, it, expect } from 'vitest';
import { dieAriaLabel } from './die-label.js';

describe('dieAriaLabel', () => {
  it('says which die it is and what it shows', () => {
    expect(dieAriaLabel(6, 4)).toBe('d6 showing 4');
    expect(dieAriaLabel(20, 17)).toBe('d20 showing 17');
  });

  it('prefers a custom face label over the raw number', () => {
    expect(dieAriaLabel(6, 3, ['ash', 'bone', 'clay', 'dust', 'ember', 'fern'])).toBe(
      'd6 showing clay',
    );
  });

  it('falls back to the number when the face has no custom label', () => {
    expect(dieAriaLabel(6, 5, ['ash', 'bone'])).toBe('d6 showing 5');
  });

  it('reads a zero-indexed d10 as the face it is actually showing', () => {
    // Face 1 of a zero-indexed d10 is painted "0", face 10 is painted "9" -
    // the same mapping Die3D uses when it draws the face textures.
    expect(dieAriaLabel(10, 1, undefined, true)).toBe('d10 showing 0');
    expect(dieAriaLabel(10, 10, undefined, true)).toBe('d10 showing 9');
    expect(dieAriaLabel(10, 10)).toBe('d10 showing 10');
  });
});
