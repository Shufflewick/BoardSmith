import { describe, it, expect } from 'vitest';
import {
  generateCombinations,
  MAX_MULTISELECT_COMBINATIONS,
} from './enumerate-moves.js';

// F-08 (v4.8, bot-01): an unbounded/dynamic multiSelect over an N-item choice
// set is 2^N-1 combinations. Without a cap, N=25 materializes 33M objects
// (multi-GB) and N=30 hangs/OOMs. generateCombinations must bound the number of
// combinations it materializes.
describe('generateCombinations combinatorics guard (F-08)', () => {
  it('caps an unbounded multiSelect (min:1, max:Infinity) over 20 choices instead of materializing 2^20', () => {
    const choices = Array.from({ length: 20 }, (_, i) => i);
    const combos = generateCombinations(choices, 1, Infinity);
    // 2^20 - 1 = 1,048,575 pre-fix. Post-fix: bounded by the cap.
    expect(combos.length).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS);
  });

  it('does not truncate small enumerations that fit under the cap', () => {
    // [1,2,3] with 1..3 -> 7 combinations, well under the cap.
    const combos = generateCombinations([1, 2, 3], 1, 3);
    expect(combos.length).toBe(7);
  });

  it('respects an explicit lower limit', () => {
    const choices = Array.from({ length: 10 }, (_, i) => i);
    const combos = generateCombinations(choices, 1, Infinity, 5);
    expect(combos.length).toBe(5);
  });

  it('caps a fixed-size (min===max) combination that would still explode', () => {
    // C(30, 15) is ~155 million. Must stay bounded.
    const choices = Array.from({ length: 30 }, (_, i) => i);
    const combos = generateCombinations(choices, 15, 15);
    expect(combos.length).toBeLessThanOrEqual(MAX_MULTISELECT_COMBINATIONS);
  });
});
