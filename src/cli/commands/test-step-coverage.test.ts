import { describe, it, expect } from 'vitest';
import { promises as fs, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { countsAt, decodeMappings, readCoverage } from './test-step-coverage.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

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
  it('refuses a character that is not base64, naming it', () => {
    expect(() => decodeMappings('AA!A')).toThrow('holds "!", which is not base64');
  });
});

describe('readCoverage: an unreadable coverage file (#1110)', () => {
  it('names the file rather than saying the run wrote nothing', async () => {
    const tree = tempTree('bs-coverage-unreadable-');
    const dir = realpathSync(tree);
    const test = join(dir, 'a.test.ts');
    await fs.writeFile(test, '');
    const coverage = join(dir, 'coverage', `${encodeURIComponent(test)}.json`);
    await fs.mkdir(coverage, { recursive: true });
    await expect(readCoverage(join(dir, 'coverage'), dir, test, 'a.test.ts')).rejects.toThrow(`Could not read ${coverage} (EISDIR)`);
  });

  it('says the run wrote nothing when the test file itself is gone', async () => {
    const tree = tempTree('bs-coverage-unreadable-');
    const dir = realpathSync(tree);
    await expect(readCoverage(join(dir, 'coverage'), dir, join(dir, 'gone.test.ts'), 'gone.test.ts')).rejects.toThrow(
      'The run that records which game code gone.test.ts runs wrote nothing for it',
    );
  });
});
