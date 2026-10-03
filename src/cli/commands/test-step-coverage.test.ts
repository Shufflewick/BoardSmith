import { describe, it, expect } from 'vitest';
import { countsAt, decodeMappings } from './test-step-coverage.js';

/**
 * #485: a test that pins earlier behaviour is mutation-tested on the game code it runs, read from
 * V8's block coverage. These are the two pieces that turn that coverage into source positions.
 */
describe('countsAt', () => {
  it('gives each offset the count of the innermost range around it, and 0 outside them all', () => {
    // A function run once whose `if` block never ran, and a second function never called.
    const ranges: Array<[number, number, number]> = [[0, 100, 1], [10, 50, 1], [20, 30, 0], [60, 90, 0]];
    expect(countsAt(ranges, [5, 15, 25, 30, 55, 70, 95, 120])).toEqual([1, 1, 0, 1, 1, 0, 1, 0]);
  });

  it('lets the later of two ranges with the same extent win, as V8 means a block inside its function', () => {
    expect(countsAt([[0, 10, 1], [0, 10, 0]], [5])).toEqual([0]);
  });

  it('stays fast on a whole game', () => {
    const ranges: Array<[number, number, number]> = Array.from({ length: 20_000 }, (_, i) => [i * 10, i * 10 + 5, i % 2]);
    const offsets = Array.from({ length: 200_000 }, (_, i) => i);
    const started = Date.now();
    expect(countsAt(ranges, offsets).slice(0, 12)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('decodeMappings', () => {
  it('reads each segment as a generated column with its original line and column', () => {
    // Fields are deltas: the column carries over between lines, and `F` is -2. A five-field segment
    // (with a name) reads the same, and a one-field segment, which maps to nothing, is dropped.
    expect(decodeMappings('AAAA,EAAE;AACF,IAAI,CAAC;gBAAgBA,C')).toEqual([
      [[0, 0, 0], [2, 0, 2]],
      [[0, 1, 0], [4, 1, 4], [5, 1, 5]],
      [[16, 1, 21]],
    ]);
  });
});
