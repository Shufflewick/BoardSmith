import { describe, it, expect, vi } from 'vitest';
import { contrastInk, parseColor, seatInk } from './color-contrast';
import { _clearShownWarnings } from '../../utils/dev.js';
import { createColorOption } from '../../session/colors.js';

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

  it('covers the full default player palette without throwing', () => {
    // Reads the REAL exported palette. A hardcoded copy of the hex values used
    // to live here, which meant adding or changing a player colour could not
    // fail this test — exactly the case it exists to catch.
    for (const { value, label } of createColorOption().choices) {
      expect(() => contrastInk(value), `${label} (${value})`).not.toThrow();
    }
  });

  it('picks a readable ink for every colour in the real palette', () => {
    for (const { value, label } of createColorOption().choices) {
      const { ink } = contrastInk(value);
      expect(['#ffffff', '#000000'], `${label} (${value})`).toContain(ink);
    }
  });

  // CR-02: colorPalette accepts ANY CSS color string with no format
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
  // #1754: colorPalette accepts any CSS colour, so every CSS Color 4 format
  // must read as the colour the browser draws, or a pale seat gets white ink.
  describe('CSS Color 4 formats (#1754)', () => {
    // Expected channels are what Chromium draws for each colour on an sRGB canvas, except
    // rec2020, where Chromium still uses the transfer curve CSS Color 4 replaced; that row is the spec's.
    it.each([
      ['oklch(0.95 0.05 100)', [246, 240, 202]],
      ['oklch(0.3 0.1 260)', [11, 43, 95]],
      ['oklch(62.8% 0.2577 29.23)', [255, 0, 0]],
      ['oklab(0.7 -0.1 0.05)', [99, 179, 125]],
      ['lab(54.29 80.82 69.89)', [255, 0, 0]],
      ['lch(60 40 200)', [0, 163, 167]],
      ['hwb(200 20% 30%)', [51, 136, 179]],
      ['hwb(0 60% 60%)', [128, 128, 128]],
      ['color(display-p3 0.8 0.5 0.3)', [217, 123, 64]],
      ['color(srgb 0.2 0.4 0.6)', [51, 102, 153]],
      ['color(srgb-linear 0.2 0.4 0.6)', [124, 170, 203]],
      ['color(a98-rgb 0.5 0.6 0.4)', [116, 154, 99]],
      ['color(prophoto-rgb 0.5 0.4 0.4)', [167, 115, 121]],
      ['color(rec2020 0.5 0.5 0.3)', [123, 121, 56]],
      ['color(xyz 0.3 0.3 0.3)', [162, 145, 143]],
      ['color(xyz-d50 0.3 0.3 0.25)', [156, 147, 150]],
      ['color(xyz-d65 0.2 0.25 0.3)', [95, 146, 144]],
      ['rgb(50% 20% 10%)', [128, 51, 26]],
      ['hsl(200 60% 50%)', [51, 153, 204]],
      ['hsl(3.14rad 60% 50%)', [51, 204, 204]],
      ['hsl(200grad 50% 50%)', [64, 191, 191]],
      ['oklch(0.7 none 100)', [158, 158, 158]],
      ['rgb(none 100 200)', [0, 100, 200]],
      ['color(display-p3 1 0 0)', [255, 0, 0]],
    ])('reads %s as the colour the browser draws', (css, [r, g, b]) => {
      const drawn = parseColor(css);
      for (const [got, want] of [[drawn.r, r], [drawn.g, g], [drawn.b, b]]) {
        expect(Math.abs(got - want), `${css} -> ${JSON.stringify(drawn)}`).toBeLessThanOrEqual(1);
      }
      expect(drawn.a).toBe(1);
    });

    it.each([
      ['rgb(10 20 30 / 50%)', { r: 10, g: 20, b: 30, a: 0.5 }],
      ['hsl(0.5turn 60 50 / 0.5)', { r: 51, g: 204, b: 204, a: 0.5 }],
      ['#abcd', { r: 170, g: 187, b: 204, a: 221 / 255 }],
      ['#11223344', { r: 17, g: 34, b: 51, a: 68 / 255 }],
      ['transparent', { r: 0, g: 0, b: 0, a: 0 }],
    ])('reads the alpha of %s', (css, want) => {
      expect(parseColor(css)).toEqual(want);
    });

    it('gives a pale oklch() seat black ink, with no warning', () => {
      _clearShownWarnings();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(seatInk('oklch(0.95 0.05 100)', 'PlayerToken').ink).toBe('#000000');
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it.each([
      'rgb(255, 50%, 0)',
      'hsl(200, 60, 50)',
      'rgb(none, 0, 0)',
      'lab(50, 20, 30)',
      'oklch(0.5 0.1)',
      'color(cmyk 0 0 0)',
      'color-mix(in srgb, red, blue)',
    ])('refuses %s, which the browser does not draw or BoardSmith cannot resolve', (css) => {
      expect(() => parseColor(css)).toThrow(css);
    });
  });
});
