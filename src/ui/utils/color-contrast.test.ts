import { describe, it, expect } from 'vitest';
import { contrastInk } from './color-contrast';

describe('contrastInk', () => {
  it('picks black ink for a near-white seat color', () => {
    const { ink } = contrastInk('#ecf0f1');
    expect(ink).toBe('#000000');
  });

  it('picks white ink for a dark seat color', () => {
    const { ink } = contrastInk('#2c3e50');
    expect(ink).toBe('#ffffff');
  });

  it('derives a dark halo text-shadow for white ink', () => {
    const { ink, textShadow } = contrastInk('#2c3e50');
    expect(ink).toBe('#ffffff');
    expect(textShadow).toBe('0 1px 2px rgba(0,0,0,.5)');
  });

  it('drops the text-shadow (none) for black ink', () => {
    const { ink, textShadow } = contrastInk('#ecf0f1');
    expect(ink).toBe('#000000');
    expect(textShadow).toBe('none');
  });

  it('accepts #rrggbb, #rgb, rgb(), and rgba() equivalently', () => {
    const long = contrastInk('#2c3e50');
    const rgbForm = contrastInk('rgb(44,62,80)');
    const rgbaForm = contrastInk('rgba(44,62,80,1)');
    const shortHexEquivalent = contrastInk('#abc');
    const shortHexRgb = contrastInk('rgb(170,187,204)');

    expect(rgbForm.ink).toBe(long.ink);
    expect(rgbaForm.ink).toBe(long.ink);
    expect(shortHexEquivalent.ink).toBe(shortHexRgb.ink);
  });

  it('throws an actionable error naming the bad value and supported formats for unparseable input', () => {
    expect(() => contrastInk('not-a-color')).toThrow(/not-a-color/);
    expect(() => contrastInk('not-a-color')).toThrow(/#rgb|#rrggbb|rgb\(|rgba\(/);
  });

  it('covers the full STANDARD_PLAYER_COLORS palette without throwing', () => {
    const palette = [
      '#e74c3c',
      '#3498db',
      '#27ae60',
      '#e67e22',
      '#9b59b6',
      '#f1c40f',
      '#95a5a6',
      '#ecf0f1',
    ];
    for (const color of palette) {
      expect(() => contrastInk(color)).not.toThrow();
    }
  });

  // CR-02: createColorOption() accepts ANY CSS color string with no format
  // restriction — named colors and hsl() are legal, common author choices.
  describe('named colors and hsl() (CR-02)', () => {
    it('accepts a standard CSS named color and picks the correct ink', () => {
      // crimson (#dc143c) is dark enough to need white ink.
      const { ink } = contrastInk('crimson');
      expect(ink).toBe('#ffffff');
    });

    it('named colors are case-insensitive', () => {
      expect(contrastInk('CRIMSON').ink).toBe(contrastInk('crimson').ink);
    });

    it('a named color resolves to the same ink as its hex equivalent', () => {
      expect(contrastInk('white').ink).toBe(contrastInk('#ffffff').ink);
      expect(contrastInk('black').ink).toBe(contrastInk('#000000').ink);
    });

    it('accepts hsl() and hsla() and picks the correct ink', () => {
      // hsl(348, 83%, 47%) ~= crimson
      const hslForm = contrastInk('hsl(348, 83%, 47%)');
      const hslaForm = contrastInk('hsla(348, 83%, 47%, 1)');
      expect(hslForm.ink).toBe('#ffffff');
      expect(hslaForm.ink).toBe('#ffffff');
    });

    it('accepts hsl() with a deg suffix on the hue', () => {
      expect(() => contrastInk('hsl(348deg, 83%, 47%)')).not.toThrow();
    });
  });

  // WR-03: rgb()/rgba() must reject out-of-gamut channels rather than
  // silently accepting them — matches the "fail loud on anything else"
  // contract this function's own docstring promises.
  describe('out-of-range channel rejection (WR-03)', () => {
    it('throws for an rgb() channel above 255', () => {
      expect(() => contrastInk('rgb(999, 0, 0)')).toThrow(/out of range/i);
    });

    it('throws for an rgba() channel above 255', () => {
      expect(() => contrastInk('rgba(0, 300, 0, 1)')).toThrow(/out of range/i);
    });

    it('throws for hsl() saturation/lightness above 100%', () => {
      expect(() => contrastInk('hsl(0, 150%, 50%)')).toThrow(/out of range/i);
      expect(() => contrastInk('hsl(0, 50%, 150%)')).toThrow(/out of range/i);
    });

    it('still accepts an in-range rgb() at the boundary (255)', () => {
      expect(() => contrastInk('rgb(255, 255, 255)')).not.toThrow();
    });
  });

  it('throws (not silently guesses) for a genuinely unparseable color', () => {
    expect(() => contrastInk('not-a-real-color-name')).toThrow(/not-a-real-color-name/);
  });
});
