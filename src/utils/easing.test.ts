import { describe, it, expect } from 'vitest';
import { easeOutCubic } from './easing.js';

describe('easeOutCubic', () => {
  it('pins both endpoints so an animation starts at rest and lands exactly', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('never leaves [0, 1] and never moves backwards across the whole progress range', () => {
    let previous = easeOutCubic(0);
    for (let i = 1; i <= 100; i++) {
      const current = easeOutCubic(i / 100);
      expect(current).toBeGreaterThanOrEqual(previous);
      expect(current).toBeLessThanOrEqual(1);
      previous = current;
    }
  });

  it('runs ahead of linear progress (fast start, slow finish)', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOutCubic(t)).toBeGreaterThan(t);
    }
  });

  it('matches its documented 1 - (1 - t)^3 curve', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(0.25)).toBeCloseTo(1 - Math.pow(0.75, 3), 10);
  });
});
