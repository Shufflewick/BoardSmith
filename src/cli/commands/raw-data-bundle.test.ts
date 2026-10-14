/**
 * A game's card data imported with `?raw` loads through every way the CLI
 * builds rules (#556): `boardsmith simulate` (the CLI's own esbuild bundle) and
 * `boardsmith build` (Vite for the shipped rules, the esbuild bundle for the
 * manifest). Vitest reads `?raw` natively; `src/engine/utils/csv.test.ts`
 * covers that.
 *
 * The fixture's seat range comes from its CSV, so a run that reports it proves
 * the file's text reached the rules. Both commands run while the file is
 * collected, where no test timeout applies (#363).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildCommand } from './build.js';
import { simulateCommand } from './simulate.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureGame = resolve(here, 'simulate.fixture.ts');
const engine = resolve(here, '../../engine/index.ts');

const dir = tempTree('boardsmith-raw-data-');
writeFileSync(
  join(dir, 'boardsmith.json'),
  JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table', gameOptions: [{ id: 'deadEnd', type: 'number', label: 'Dead end', default: 5 }] }),
);
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body></body></html>\n');
mkdirSync(join(dir, 'src', 'rules', 'data'), { recursive: true });
writeFileSync(join(dir, 'src', 'rules', 'data', 'seats.csv'), 'seat,label\n1,Red\n2,Blue\n3,"Green, dark"\n4,Gold\n');
writeFileSync(
  join(dir, 'src', 'rules', 'index.ts'),
  [
    `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};`,
    `import { parseCsv } from ${JSON.stringify(engine)};`,
    `import seatsCsv from './data/seats.csv?raw';`,
    `const seats = parseCsv(seatsCsv, { seat: 'number', label: 'string' }, { source: 'data/seats.csv' });`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', displayName: 'Fixture',`,
    `  minPlayers: 3, maxPlayers: seats.length };`,
  ].join('\n'),
);

/** Runs `command` from inside `dir`, returning what it printed, the exit code it set and what it threw. */
async function runIn(command: () => Promise<void>): Promise<{ output: string; exitCode: unknown; thrown: unknown }> {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const printed: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void printed.push(parts.map(String).join(' ')));
  process.chdir(dir);
  try {
    await command();
    return { output: printed.join('\n'), exitCode: process.exitCode, thrown: undefined };
  } catch (thrown) {
    return { output: printed.join('\n'), exitCode: process.exitCode, thrown };
  } finally {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    log.mockRestore();
  }
}

const simulated = await runIn(() => simulateCommand({ games: '1', seed: 'raw', json: true, gameOption: ['deadEnd=100'] }));
const built = await runIn(() => buildCommand({}));

describe('card data imported with ?raw (#556)', () => {
  it('boardsmith simulate bundles the CSV text with the rules', () => {
    expect(simulated.thrown).toBeUndefined();
    expect(JSON.parse(simulated.output).run.players).toEqual([3, 4]);
  });

  it('boardsmith build ships the CSV text in the rules and reads it for the manifest', () => {
    expect(built.thrown).toBeUndefined();
    expect(readFileSync(join(dir, 'dist', 'rules', 'rules.js'), 'utf-8')).toContain('Green, dark');
    expect(JSON.parse(readFileSync(join(dir, 'dist', 'manifest.json'), 'utf-8')).playerCount).toEqual({ min: 3, max: 4 });
  });
});
