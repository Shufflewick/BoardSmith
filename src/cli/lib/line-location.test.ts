import { describe, it, expect } from 'vitest';
import { fileLines, lineRangeProblem, splitLineLocation } from './line-location.js';

/**
 * THE ONE GRAMMAR FOR A LINE LOCATION in a design record (#414). A claim's `Source:` line and a
 * cited script (`.boardsmith/scratch/probe.mjs:1-5`) are both read by it, so a location one check
 * reads is never a different file, or no file at all, to the other.
 */

describe('splitLineLocation', () => {
  it('reads a single line, :N, as the range N to N', () => {
    expect(splitLineLocation('src/rules/food.ts:42')).toEqual({ path: 'src/rules/food.ts', lines: [42, 42] });
  });

  it('reads a line range, :N-M', () => {
    expect(splitLineLocation('../src/rules/game.ts:120-135')).toEqual({ path: '../src/rules/game.ts', lines: [120, 135] });
  });

  it('reads a compiler-style :LINE:COLUMN as that line, and keeps the column so a reader can refuse it', () => {
    expect(splitLineLocation('src/a.ts:3:7')).toEqual({ path: 'src/a.ts', lines: [3, 3], column: 7 });
  });

  it('leaves a path with no location as it is', () => {
    expect(splitLineLocation('.boardsmith/scratch/probe.mjs')).toEqual({ path: '.boardsmith/scratch/probe.mjs' });
  });

  it('reads @<commit> before the location as the file as it was in that commit (#426)', () => {
    expect(splitLineLocation('../src/rules/damage.ts@611dc8e:42')).toEqual({ path: '../src/rules/damage.ts', lines: [42, 42], commit: '611dc8e' });
    expect(splitLineLocation('src/a.ts@611DC8E0:3-9')).toEqual({ path: 'src/a.ts', lines: [3, 9], commit: '611DC8E0' });
    expect(splitLineLocation('rulebook/08-combat.md@611dc8e')).toEqual({ path: 'rulebook/08-combat.md', commit: '611dc8e' });
  });

  it('takes only a commit hash of at least 7 hex digits after @, so a branch name or a short hash stays in the path', () => {
    expect(splitLineLocation('src/a.ts@main:3')).toEqual({ path: 'src/a.ts@main', lines: [3, 3] });
    expect(splitLineLocation('src/a.ts@611dc8:3')).toEqual({ path: 'src/a.ts@611dc8', lines: [3, 3] });
  });

  it('keeps a backwards range as written, for lineRangeProblem to refuse', () => {
    expect(splitLineLocation('a.ts:9-2')).toEqual({ path: 'a.ts', lines: [9, 2] });
  });
});

describe('fileLines', () => {
  it('does not count the empty text after a final newline as a line', () => {
    expect(fileLines('a\nb\n')).toEqual(['a', 'b']);
    expect(fileLines('a\nb')).toEqual(['a', 'b']);
    expect(fileLines('a\n\n')).toEqual(['a', '']);
  });
});

describe('lineRangeProblem', () => {
  const sevenLines = fileLines(['1', '2', '3', '4', '5', '6', '7'].join('\n'));

  it('accepts a range inside the file, up to its last line', () => {
    expect(lineRangeProblem([1, 7], sevenLines.length)).toBeUndefined();
    expect(lineRangeProblem([4, 4], sevenLines.length)).toBeUndefined();
  });

  it('refuses line 0 and a range that runs backwards', () => {
    expect(lineRangeProblem([0, 3], 7)).toBe('invalid');
    expect(lineRangeProblem([5, 2], 7)).toBe('invalid');
  });

  it('refuses a range that runs past the end of the file', () => {
    expect(lineRangeProblem([3, 8], sevenLines.length)).toBe('past-end');
  });
});
