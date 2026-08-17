import { describe, it, expect } from 'vitest';
import {
  easeOutCubic,
  easeInCubic,
  easeInOutCubic,
  linear,
  easeOutQuad,
  easeInQuad,
  type EasingFunction,
} from './easing.js';

const ALL: Array<[string, EasingFunction]> = [
  ['easeOutCubic', easeOutCubic],
  ['easeInCubic', easeInCubic],
  ['easeInOutCubic', easeInOutCubic],
  ['linear', linear],
  ['easeOutQuad', easeOutQuad],
  ['easeInQuad', easeInQuad],
];

describe('easing functions', () => {
  describe.each(ALL)('%s', (_name, fn) => {
    it('pins both endpoints so an animation starts at rest and lands exactly', () => {
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    });

    it('never leaves [0, 1] across the whole progress range', () => {
      for (let i = 0; i <= 100; i++) {
        const eased = fn(i / 100);
        expect(eased).toBeGreaterThanOrEqual(0);
        expect(eased).toBeLessThanOrEqual(1);
      }
    });

    it('is monotonically increasing (no visual backtracking mid-animation)', () => {
      let previous = fn(0);
      for (let i = 1; i <= 100; i++) {
        const current = fn(i / 100);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    });
  });

  it('linear is the identity function', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(linear(t)).toBe(t);
    }
  });

  it('ease-out curves run ahead of linear (fast start, slow finish)', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOutCubic(t)).toBeGreaterThan(t);
      expect(easeOutQuad(t)).toBeGreaterThan(t);
    }
  });

  it('ease-in curves lag linear (slow start, fast finish)', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeInCubic(t)).toBeLessThan(t);
      expect(easeInQuad(t)).toBeLessThan(t);
    }
  });

  it('cubic is more aggressive than quad at the same progress', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(easeOutCubic(t)).toBeGreaterThan(easeOutQuad(t));
      expect(easeInCubic(t)).toBeLessThan(easeInQuad(t));
    }
  });

  it('easeOutCubic matches its documented 1 - (1 - t)^3 curve', () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(easeOutCubic(0.25)).toBeCloseTo(1 - Math.pow(0.75, 3), 10);
  });

  it('easeInCubic matches t^3', () => {
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 10);
    expect(easeInCubic(0.25)).toBeCloseTo(0.015625, 10);
  });

  it('easeOutQuad and easeInQuad are mirror images about the midpoint', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(easeOutQuad(t)).toBeCloseTo(1 - easeInQuad(1 - t), 10);
    }
  });

  it('easeInOutCubic crosses exactly halfway at the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it('easeInOutCubic is symmetric about the midpoint', () => {
    for (const t of [0, 0.1, 0.25, 0.4, 0.5]) {
      expect(easeInOutCubic(t)).toBeCloseTo(1 - easeInOutCubic(1 - t), 10);
    }
  });

  it('easeInOutCubic eases in below linear then eases out above it', () => {
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });
});
