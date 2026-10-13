/**
 * The balance simulator benchmark (#556): its arguments, and one run end to end
 * at one game per player count, which checks the report's shape, not its times.
 *
 * The run is its own Node process, as the benchmark is meant to be run, and
 * happens while the file is collected, where no test timeout applies: it
 * scaffolds a project and bundles the rules eight times.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');

// A hang guard, so a bench that never ends fails this file instead of holding it open.
const ran = spawnSync(process.execPath, [RUN, '--games', '1'], { encoding: 'utf8', timeout: 300_000 });

/** The table's rows: [policy, players, games]. */
const rows = ran.stdout
  .split('\n')
  .filter((line) => /^\| (random|greedy) \|/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()).slice(1, 4));

describe('the balance simulator benchmark', () => {
  it('takes --games per player count, 3,000 by default, and --out', () => {
    expect(parseArgs([])).toEqual({ games: 3000, out: undefined });
    expect(parseArgs(['--games', '10', '--out', 'baseline.md'])).toEqual({ games: 10, out: resolve('baseline.md') });
  });

  it('refuses a games count that is not a positive whole number, a flag with no value, and an unknown flag', () => {
    expect(() => parseArgs(['--games', '0'])).toThrow(/--games must be a whole number/);
    expect(() => parseArgs(['--games', 'many'])).toThrow(/--games must be a whole number/);
    expect(() => parseArgs(['--out'])).toThrow(/--out needs a value/);
    expect(() => parseArgs(['--jobs', '2'])).toThrow(/Unknown option --jobs/);
  });

  it('runs to the end', () => {
    expect(ran.stderr).not.toMatch(/failed|Error/);
    expect(ran.status).toBe(0);
  });

  it('times random and greedy at 2, 4 and 6 players, then all three in one command', () => {
    expect(rows).toEqual(['random', 'greedy'].flatMap((policy) => [
      [policy, '2', '1'],
      [policy, '4', '1'],
      [policy, '6', '1'],
      [policy, '2,4,6', '3'],
    ]));
  });

  it('records where it was measured: commit, Node, machine and load at the start and end', () => {
    expect(ran.stdout).toMatch(/^- BoardSmith commit: /m);
    expect(ran.stdout).toContain(`- Node: ${process.version}`);
    expect(ran.stdout).toMatch(/^- Machine: \d+ x /m);
    expect(ran.stdout).toMatch(/^- Load average \(1, 5, 15 min\): [\d., ]+ at the start; [\d., ]+ at the end$/m);
  });
});
