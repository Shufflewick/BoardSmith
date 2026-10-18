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
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devProject } from '../../src/cli/commands/dev-project.test-helper.ts';

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const game = await devProject(false);

// The game declares an option and refuses to start without it, as cribbage
// does with targetScore: the bench must start games as every host does, with
// boardsmith.json's declared defaults filled (#1081).
const configPath = join(game, 'boardsmith.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
writeFileSync(configPath, JSON.stringify({ ...config, gameOptions: [{ id: 'rounds', type: 'number', label: 'Rounds', default: 3 }] }));
const gamePath = join(game, 'src', 'rules', 'game.ts');
writeFileSync(
  gamePath,
  readFileSync(gamePath, 'utf8').replace(
    '    super(options);\n',
    "    super(options);\n    if ((options as { rounds?: number }).rounds !== 3) throw new Error('The declared default of rounds was not filled.');\n",
  ),
);

/** Run the bench on the scaffolded game and return what it printed. */
function bench() {
  const { NODE_ENV: _unset, ...env } = process.env;
  // A hang guard, so a bench that never ends fails this file instead of holding it open.
  const ran = spawnSync(process.execPath, [RUN, game], { encoding: 'utf8', env, timeout: 300_000 });
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

  it("starts the game with boardsmith.json's declared option defaults", () => {
    expect(first.output).not.toContain('The declared default of rounds was not filled.');
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
