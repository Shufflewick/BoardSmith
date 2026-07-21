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
});
