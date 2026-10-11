/**
 * The bot benchmark end to end (#630), on a game `boardsmith init` scaffolds.
 *
 * It runs as its own Node process, the way it is meant to be run, because the
 * test runner sets `import.meta.env` and so is always in development mode. What
 * is asserted is the work done: the bench forced production mode, found three
 * positions, and the fixed search ran exactly its step count and chose the same
 * move both times it ran.
 *
 * The scaffold and both runs happen while the file is collected, where no test
 * timeout applies: each run bundles the game and loads the engine.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devProject } from '../../src/cli/commands/dev-project.test-helper.ts';

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const game = await devProject(false);

/** Run the bench on the scaffolded game and return what it printed. */
function bench() {
  const { NODE_ENV: _unset, ...env } = process.env;
  const ran = spawnSync(process.execPath, [RUN, game], { encoding: 'utf8', env });
  return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
}

/** The fixed-search table's rows: [position, steps, chosen move]. */
function fixedRows(output) {
  const section = output.split('## Fixed')[1] ?? '';
  return section
    .split('\n')
    .filter((line) => line.startsWith('| dev-game |'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return [cells[2], Number(cells[3]), cells.at(-2)];
    });
}

const first = bench();
const second = bench();

describe('the bot benchmark', () => {
  it('runs to the end', () => {
    expect(first.output).not.toMatch(/Error/);
    expect(first.status).toBe(0);
  });

  it('measures in production mode though it was started without NODE_ENV', () => {
    expect(first.output).toContain('Mode: production');
  });

  it('searches an early, a middle and a late position', () => {
    expect(fixedRows(first.output).map(([position]) => position.split(' ')[0])).toEqual(['early', 'middle', 'late']);
  });

  it('runs the fixed search for exactly its step count, and chooses the same move each run', () => {
    expect(fixedRows(first.output).map(([, steps]) => steps)).toEqual([300, 300, 300]);
    expect(fixedRows(second.output)).toEqual(fixedRows(first.output));
  });
});
