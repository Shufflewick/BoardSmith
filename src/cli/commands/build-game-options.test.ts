/**
 * `boardsmith build` and boardsmith.json's game options (#701): the manifest
 * the platform's lobby reads lists every option but the designer-only ones, and
 * the rules bundle carries them all, so a published game's `start` op starts
 * even a designer-only option at its default. A gameDefinition that still
 * declares gameOptions is refused, saying where they go.
 *
 * The builds run while the file is collected, where no test timeout applies
 * (#363). The tests assert what they left behind.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { buildCommand } from './build.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import * as engine from '../../engine/index.js';
import * as session from '../../session/index.js';
import { declaredGameOptionsOf } from '../../session/game-option-selection.js';

const fixtureGame = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');

const lobbyOption = { id: 'rounds', type: 'number', label: 'Rounds', min: 1, max: 9, default: 3 };
const knob = { id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true };

/** A table project declaring both options in boardsmith.json, with `extra` in its gameDefinition. */
function project(extra = ''): string {
  const dir = tempTree('boardsmith-build-game-options-');
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: 'fixture', displayName: 'Fixture', backend: 'table', gameOptions: [lobbyOption, knob] }),
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body></body></html>\n');
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'rules', 'index.ts'),
    [
      `import { DeadEndGame } from ${JSON.stringify(fixtureGame)};`,
      `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', minPlayers: 3, maxPlayers: 4,${extra} };`,
      `export const answer = 42;`,
      '',
    ].join('\n'),
  );
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

/**
 * The built CommonJS rules, evaluated with this checkout standing in for the
 * boardsmith a platform runner provides. The fixture game imports the engine by
 * path, so the bundle holds a copy of it, which needs Node's own modules.
 */
function loadBuiltRules(dir: string): Record<string, unknown> {
  const provided: Record<string, unknown> = { boardsmith: engine, 'boardsmith/session': session };
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (isBuiltin(id)) return createRequire(import.meta.url)(id);
    if (!(id in provided)) throw new Error(`The built rules require ${id}, which no platform runner provides.`);
    return provided[id];
  };
  const file = join(dir, 'dist', 'rules', 'rules.js');
  new Function('require', 'module', 'exports', '__filename', '__dirname', readFileSync(file, 'utf-8'))(
    require,
    module,
    module.exports,
    file,
    dirname(file),
  );
  return module.exports;
}

const built = project();
const builtError = await buildIn(built);

const stale = project(` gameOptions: { rounds: { type: 'number', label: 'Rounds', default: 3 } }`);
const staleError = await buildIn(stale);

describe('boardsmith build publishes boardsmith.json\'s game options (#701)', () => {
  it('the manifest lists every option but the designer-only ones', () => {
    expect(builtError).toBeUndefined();
    const manifest = JSON.parse(readFileSync(join(built, 'dist', 'manifest.json'), 'utf-8'));
    expect(manifest.gameOptions).toEqual([lobbyOption]);
  });

  it('the rules bundle carries every option, so the platform starts a designer-only one at its default', () => {
    const rules = loadBuiltRules(built);
    expect(declaredGameOptionsOf(rules.gameDefinition as object)).toEqual({
      rounds: { type: 'number', label: 'Rounds', min: 1, max: 9, default: 3 },
      lootScale: { type: 'number', label: 'Loot scale', default: 1, designerOnly: true },
    });
    expect(rules.answer).toBe(42);
  });

  it('refuses a gameDefinition that still declares gameOptions, saying to move them to boardsmith.json', () => {
    expect(String(staleError)).toMatch(/gameDefinition declares gameOptions.*boardsmith\.json/);
  });
});
