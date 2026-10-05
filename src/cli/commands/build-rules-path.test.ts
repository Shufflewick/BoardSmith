/**
 * `boardsmith build` reads its rules from where the manifest says they are
 * (#531). `paths.rules` is honoured by `dev`, `simulate` and `validate`; a build
 * that hardcoded `src/rules` either failed on a project laid out another way or,
 * worse, shipped an old `src/rules` left beside the real one.
 *
 * Both builds run while the file is collected, where no test timeout applies,
 * because each runs Vite twice and bundles the rules (#363). The tests assert
 * what the builds left behind.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildCommand } from './build.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/** A real game class, so the build can load the rules it compiled. */
const fixtureGame = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');

/** Rules whose only distinguishing fact is their seat range. */
function rulesSource(maxPlayers: number): string {
  return [
    `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: ${maxPlayers} };`,
    '',
  ].join('\n');
}

/** A table project whose real rules live in `custom/rules`, optionally with a decoy `src/rules`. */
function customRulesProject(decoy: boolean): string {
  const dir = tempTree('boardsmith-build-rules-path-');
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table', paths: { rules: 'custom/rules' } }),
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body></body></html>\n');
  mkdirSync(join(dir, 'custom', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'custom', 'rules', 'index.ts'), rulesSource(5));
  if (decoy) {
    mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
    writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rulesSource(9));
  }
  return dir;
}

/** Runs build from inside `dir`, then restores the cwd. Returns what it threw, if anything. */
async function buildIn(dir: string): Promise<unknown> {
  const originalCwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(dir);
  try {
    await buildCommand({});
    return undefined;
  } catch (thrown) {
    return thrown;
  } finally {
    process.chdir(originalCwd);
    log.mockRestore();
  }
}

function builtManifest(dir: string): { playerCount?: { min: number; max: number } } {
  return JSON.parse(readFileSync(join(dir, 'dist', 'manifest.json'), 'utf-8'));
}

function builtRules(dir: string): string {
  return readFileSync(join(dir, 'dist', 'rules', 'rules.js'), 'utf-8');
}

const onlyCustom = customRulesProject(false);
const onlyCustomError = await buildIn(onlyCustom);

const withDecoy = customRulesProject(true);
const withDecoyError = await buildIn(withDecoy);

describe('boardsmith build honours paths.rules (#531)', () => {
  it('builds a project whose rules live only at paths.rules', () => {
    expect(onlyCustomError).toBeUndefined();
    expect(builtManifest(onlyCustom).playerCount).toEqual({ min: 3, max: 5 });
  });

  it('builds the rules paths.rules names, not an old src/rules beside them', () => {
    expect(withDecoyError).toBeUndefined();
    expect(builtManifest(withDecoy).playerCount).toEqual({ min: 3, max: 5 });
    expect(builtRules(withDecoy)).not.toMatch(/maxPlayers:\s*9/);
  });
});
