/**
 * No test asserts how long something took (#360).
 *
 * The merge gate (`agent-policy thread merge`) runs the whole suite while other merges and
 * worktree suites run on the same machine, at load averages past 100. A test
 * that asserts `elapsed < 1000` then fails with nothing regressed, refuses an
 * unrelated merge, and every agent has to prove the red is not theirs. #354,
 * #355, #360 and #363 were four of those in one day.
 *
 * So the claim a budget stood for has to be stated as the work done: count the
 * reads, the calls or the timers scheduled (see the #313 test in
 * `src/ui/composables/useBoardInteraction.test.ts`), or prove the path taken
 * by what it returned. This scan fails on any `expect(...)` whose subject
 * subtracts a clock read, or a variable assigned one, directly or through a
 * variable holding that difference, whatever the matcher (#919).
 *
 * It does not flag a timestamp checked against the clock
 * (`expect(entry.timestamp).toBeLessThanOrEqual(Date.now())`), which is a
 * claim about a value, not about elapsed time.
 */
import { describe, it, expect } from 'vitest';
import { trackedTestFiles } from './tracked-tests.test-helper.mjs';

const CLOCK = String.raw`(?:Date\.now\(\)|performance\.now\(\)|process\.hrtime(?:\.bigint)?\(\))`;

/** The text between `source[open]`, an opening parenthesis, and its match. */
function parenthesised(source, open) {
  let depth = 0;
  for (let at = open; at < source.length; at++) {
    if (source[at] === '(') depth++;
    else if (source[at] === ')' && --depth === 0) return source.slice(open + 1, at);
  }
  return source.slice(open + 1);
}

/** Every `expect(...)` in a source whose subject measures a clock difference, with any matcher. */
function wallClockBudgets(source) {
  const assigned = (value) => [...source.matchAll(new RegExp(String.raw`(?<![.\w])(\w+)\s*=\s*(${value})`, 'g'))];
  const clockVars = assigned(CLOCK).map((match) => match[1]);
  const term = [CLOCK, ...clockVars.map((name) => String.raw`\b${name}\b`)].join('|');
  const difference = new RegExp(String.raw`(?:${term})\s*-(?![-=])|(?<![-=])-\s*(?:${term})`);
  const measured = assigned('[^;\n]*')
    .filter((match) => difference.test(match[2]))
    .map((match) => match[1]);
  const measures = (subject) =>
    difference.test(subject) || measured.some((name) => new RegExp(String.raw`\b${name}\b`).test(subject));
  const lines = source.split('\n');
  return [...source.matchAll(/\bexpect\(/g)]
    .filter((match) => measures(parenthesised(source, match.index + match[0].length - 1)))
    .map((match) => {
      const line = source.slice(0, match.index).split('\n').length;
      return { line, text: lines[line - 1].trim() };
    });
}

describe('wallClockBudgets', () => {
  it('finds a budget on a clock difference held in a variable', () => {
    const source = [
      'const started = performance.now();',
      'work();',
      'const elapsed = performance.now() - started;',
      'expect(elapsed).toBeLessThan(1000);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 4, text: 'expect(elapsed).toBeLessThan(1000);' }]);
  });

  it('finds a budget on a clock difference written inline', () => {
    expect(wallClockBudgets('expect(Date.now() - start).toBeLessThan(500);')).toHaveLength(1);
  });

  it('finds a budget on the difference of two clock reads (#919)', () => {
    const source = [
      'const t0 = performance.now();',
      'work();',
      'const t1 = performance.now();',
      'expect(t1 - t0).toBeLessThan(100);',
    ].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 4, text: 'expect(t1 - t0).toBeLessThan(100);' }]);
  });

  it('finds a budget compared inside the subject, whatever the matcher (#919)', () => {
    expect(wallClockBudgets('expect(Date.now() - start < 500).toBe(true);')).toHaveLength(1);
  });

  it('finds a budget whose expect( spans lines (#919)', () => {
    const source = ['const elapsed = Date.now() - started;', 'expect(', '  elapsed,', ').toBeLessThan(500);'].join('\n');
    expect(wallClockBudgets(source)).toEqual([{ line: 2, text: 'expect(' }]);
  });

  it('leaves a timestamp checked against the clock alone', () => {
    expect(wallClockBudgets('expect(entry.timestamp).toBeLessThanOrEqual(Date.now());')).toEqual([]);
  });
});

describe('the test suite (#360)', () => {
  it('holds no wall-clock budget assertion', () => {
    const tracked = trackedTestFiles(['src', 'docs', 'scripts'])
      // This file's own examples above are budgets on purpose.
      .filter(({ path }) => path !== 'scripts/no-wall-clock-budgets.test.mjs');
    const findings = tracked.flatMap(({ path, text }) =>
      wallClockBudgets(text).map(
        ({ line, text }) => `${path}:${line}  ${text}`,
      ),
    );
    expect(
      findings,
      'These tests assert how long something took, which fails on a busy machine with nothing '
        + 'wrong. Assert the work done instead (calls, reads, timers scheduled) or the path taken.',
    ).toEqual([]);
  });
});
