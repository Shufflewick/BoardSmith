import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateGameId } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateGameId', () => {
  it('is 8 characters long', () => {
    expect(generateGameId()).toHaveLength(8);
  });

  it('uses only lowercase letters and digits, so it is safe in a URL', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateGameId()).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  it('does not repeat itself across a realistic burst of games', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generateGameId()));
    expect(ids.size).toBe(2000);
  });

  it('draws from the full 36-character alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      for (const char of generateGameId()) seen.add(char);
    }
    expect(seen.size).toBe(36);
  });

  it('fills every one of the eight positions from the alphabet', () => {
    // A stuck position would quietly shrink the ID space; check each slot varies.
    const perPosition = Array.from({ length: 8 }, () => new Set<string>());
    for (let i = 0; i < 500; i++) {
      const id = generateGameId();
      for (let pos = 0; pos < 8; pos++) perPosition[pos].add(id[pos]);
    }
    for (const slot of perPosition) {
      expect(slot.size).toBeGreaterThan(20);
    }
  });

  it('maps the low end of the random range to the first alphabet character', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(generateGameId()).toBe('aaaaaaaa');
  });

  it('never runs off the end of the alphabet at the top of the random range', () => {
    // Math.random() is exclusive of 1, but the nearest representable value below
    // it must still index a real character rather than undefined.
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999999999999);
    expect(generateGameId()).toBe('99999999');
  });
});
