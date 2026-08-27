/**
 * Colour manipulation helpers (issue #114).
 *
 * These replace the byte-identical `lightenColor`/`darkenColor` copies that
 * had been pasted into the checkers and hex example boards.
 */

import { describe, it, expect } from 'vitest';
import { lightenColor, darkenColor, isLightColor } from './color.js';

describe('lightenColor', () => {
  it('raises every channel by the given fraction of full scale', () => {
    // 0x33 = 51, 51 + round(255 * 0.1) = 51 + 26 = 77
    expect(lightenColor('#333333', 0.1)).toBe('rgb(77, 77, 77)');
  });

  it('clamps at 255 rather than wrapping past white', () => {
    expect(lightenColor('#f0f0f0', 0.5)).toBe('rgb(255, 255, 255)');
  });

  it('is a no-op at zero', () => {
    expect(lightenColor('#e74c3c', 0)).toBe('rgb(231, 76, 60)');
  });

  it('handles each channel independently', () => {
    // 231+26=257->255, 76+26=102, 60+26=86
    expect(lightenColor('#e74c3c', 0.1)).toBe('rgb(255, 102, 86)');
  });

  it('accepts the CSS colour formats the library already parses', () => {
    expect(lightenColor('#333', 0.1)).toBe('rgb(77, 77, 77)');
    expect(lightenColor('rgb(51, 51, 51)', 0.1)).toBe('rgb(77, 77, 77)');
    expect(lightenColor('black', 0.2)).toBe('rgb(51, 51, 51)');
  });
});

describe('darkenColor', () => {
  it('lowers every channel by the given fraction of full scale', () => {
    expect(darkenColor('#333333', 0.1)).toBe('rgb(25, 25, 25)');
  });

  it('clamps at 0 rather than wrapping past black', () => {
    expect(darkenColor('#0f0f0f', 0.5)).toBe('rgb(0, 0, 0)');
  });

  it('is a no-op at zero', () => {
    expect(darkenColor('#e74c3c', 0)).toBe('rgb(231, 76, 60)');
  });

  it('handles each channel independently', () => {
    // 231-51=180, 76-51=25, 60-51=9
    expect(darkenColor('#e74c3c', 0.2)).toBe('rgb(180, 25, 9)');
  });
});

describe('amount validation', () => {
  it.each([
    ['lightenColor', lightenColor],
    ['darkenColor', darkenColor],
  ])('%s rejects an amount outside 0..1 instead of silently clamping', (_name, fn) => {
    expect(() => fn('#333333', 1.5)).toThrow(/between 0 and 1/);
    expect(() => fn('#333333', -0.1)).toThrow(/between 0 and 1/);
    expect(() => fn('#333333', Number.NaN)).toThrow(/between 0 and 1/);
  });

  it.each([
    ['lightenColor', lightenColor],
    ['darkenColor', darkenColor],
  ])('%s fails loud on an unparseable colour rather than returning NaN', (_name, fn) => {
    expect(() => fn('not-a-color', 0.1)).toThrow(/unsupported color value/);
  });
});

describe('isLightColor', () => {
  it('reports the shipped light seat colours as light', () => {
    expect(isLightColor('#ecf0f1')).toBe(true);
    expect(isLightColor('#ffffff')).toBe(true);
  });

  it('reports the shipped dark seat colours as dark', () => {
    expect(isLightColor('#2c3e50')).toBe(false);
    expect(isLightColor('#000000')).toBe(false);
  });

  it('agrees with the library contrast helper about which ink to use', async () => {
    const { contrastInk } = await import('./color-contrast.js');
    for (const seat of ['#e74c3c', '#2c3e50', '#ecf0f1', '#e67e22', '#f1c40f', '#8e44ad']) {
      expect(isLightColor(seat), seat).toBe(contrastInk(seat).ink === '#000000');
    }
  });

  it('fails loud on an unparseable colour', () => {
    expect(() => isLightColor('not-a-color')).toThrow(/unsupported color value/);
  });
});

describe('public surface', () => {
  it('is exported from boardsmith/ui so games do not paste their own copy', async () => {
    const ui = await import('../index.js');
    expect(typeof ui.lightenColor).toBe('function');
    expect(typeof ui.darkenColor).toBe('function');
    expect(typeof ui.isLightColor).toBe('function');
    expect(typeof ui.contrastInk).toBe('function');
  });
});
