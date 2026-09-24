/**
 * No test asserts how long something took (#360).
 *
 * `scripts/merge-branch.sh` runs the whole suite while other merges and
 * worktree suites run on the same machine, at load averages past 100. A test
 * that asserts `elapsed < 1000` then fails with nothing regressed, refuses an
 * unrelated merge, and every agent has to prove the red is not theirs. #354,
 * #355, #360 and #363 were four of those in one day.
 *
 * So the claim a budget stood for has to be stated as the work done: count the
 * reads, the calls or the timers scheduled (see the #313 test in
 * `src/ui/composables/useBoardInteraction.test.ts`), or prove the path taken
 * by what it returned. This scan fails on a test that compares a clock
 * difference, directly or through a variable, with `toBeLessThan`.
 *
 * It does not flag a timestamp checked against the clock
 * (`expect(entry.timestamp).toBeLessThanOrEqual(Date.now())`), which is a
 * claim about a value, not about elapsed time.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CLOCK = String.raw`(?:Date\.now\(\)|performance\.now\(\)|process\.hrtime(?:\.bigint)?\(\))`;

/** Every `expect(...)` a source compares with `toBeLessThan` that measures a clock difference. */
function wallClockBudgets(source) {
  const measured = new Set(
    [...source.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*${CLOCK}\s*-`, 'g'))].map(
      (match) => match[1],
    ),
  );
  const findings = [];
  source.split('\n').forEach((line, index) => {
    const match = /expect\((.*?)\)\s*\.toBeLessThan(?:OrEqual)?\(/.exec(line);
    if (!match) return;
    const subject = match[1].trim();
    if (new RegExp(`${CLOCK}\\s*-`).test(subject) || measured.has(subject)) {
      findings.push({ line: index + 1, text: line.trim() });
    }
  });
  return findings;
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

  it('leaves a timestamp checked against the clock alone', () => {
    expect(wallClockBudgets('expect(entry.timestamp).toBeLessThanOrEqual(Date.now());')).toEqual([]);
  });
});

describe('the test suite (#360)', () => {
  it('holds no wall-clock budget assertion', () => {
    const tracked = execFileSync('git', ['ls-files', 'src', 'docs', 'scripts'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter((path) => /\.test\.(?:ts|mjs)$/.test(path));
    const findings = tracked.flatMap((path) =>
      wallClockBudgets(readFileSync(join(ROOT, path), 'utf-8')).map(
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
