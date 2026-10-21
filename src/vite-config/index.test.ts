import { describe, it, expect } from 'vitest';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';
import { defineGameViteConfig } from './index.js';
import { tempTree } from '../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../testing/installed-modules.test-helper.js';
import { commitAll, git, initRepo } from '../cli/lib/verify-result.test-helper.js';

const CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A game whose vite.config.ts uses a packed boardsmith: a real directory under node_modules, not a symlink to a checkout. */
function packedGame(prefix: string, within = ''): string {
  const tree = tempTree(prefix);
  const game = join(tree, within);
  const packed = join(game, 'node_modules', 'boardsmith');
  mkdirSync(join(packed, 'src'), { recursive: true });
  cpSync(join(CHECKOUT, 'package.json'), join(packed, 'package.json'));
  cpSync(join(CHECKOUT, 'src', 'vite-config'), join(packed, 'src', 'vite-config'), { recursive: true });
  for (const name of readdirSync(INSTALLED_MODULES)) symlinkSync(join(INSTALLED_MODULES, name), join(game, 'node_modules', name), 'dir');
  writeFileSync(join(game, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(game, 'vite.config.ts'), "import { defineGameViteConfig } from 'boardsmith/vite-config';\nexport default defineGameViteConfig();\n");
  return game;
}

/**
 * #528: a game's vite and vitest config is shipped by BoardSmith, so a change to what a test run
 * leaves out reaches every game with the package, not by a copy in each game.
 */
describe('defineGameViteConfig', () => {
  it('gives a game the Vue plugin, one Vue runtime, and a test run that covers only its own checkout', () => {
    const config = defineGameViteConfig();
    expect(config.plugins?.flat().map((p) => (p && typeof p === 'object' && 'name' in p ? p.name : p))).toEqual(['vite:vue', 'boardsmith:rerun-triggers']);
    expect(config.resolve?.dedupe).toEqual(['vue']);
    expect(config.test?.exclude).toEqual([...configDefaults.exclude, '.boardsmith/**', '.worktrees/**', '**/tests/browser/**']);
  });

  it("anchors the rerun triggers at the project root, not a test root inside it (#1307)", () => {
    // boardsmith.json, package.json and vite.config.ts sit at the project root, whatever folder the tests run from.
    const plugin = defineGameViteConfig().plugins?.flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'boardsmith:rerun-triggers') as unknown as { config: (c: object) => { test: { forceRerunTriggers: string[] } } };
    const { test } = plugin.config({ root: '/p/game', test: { root: '/p/game/tests' } });
    expect(test.forceRerunTriggers).toEqual([...configDefaults.forceRerunTriggers, 'boardsmith.json'].map((t) => `/p/game/${t}`));
  });

  it("keeps a game's own settings, adding its excludes to the shipped ones", () => {
    const config = defineGameViteConfig({ test: { setupFiles: ['./tests/setup.ts'], exclude: ['tests/tdd/**'] } });
    expect(config.test?.setupFiles).toEqual(['./tests/setup.ts']);
    expect(config.test?.exclude).toEqual([
      ...configDefaults.exclude,
      '.boardsmith/**',
      '.worktrees/**',
      '**/tests/browser/**',
      'tests/tdd/**',
    ]);
    expect(config.resolve?.dedupe).toEqual(['vue']);
  });

  it('loads from a packed boardsmith under node_modules, where Node strips no TypeScript', () => {
    // A vendored or published boardsmith is a real directory under node_modules, not a symlink to a checkout.
    const game = packedGame('bs-vite-config-packed-');
    for (const file of ['tests/a.test.ts', '.worktrees/x/tests/a.test.ts', '.boardsmith/worktrees/y/tests/a.test.ts']) {
      mkdirSync(dirname(join(game, file)), { recursive: true });
      writeFileSync(join(game, file), "import { it } from 'vitest';\nit('holds', () => {});\n");
    }

    const listed = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['list', '--filesOnly'], { cwd: game, encoding: 'utf-8' });

    expect(`${listed.stdout}${listed.stderr}`.trim()).toBe('tests/a.test.ts');
    expect(listed.status).toBe(0);
  }, 60_000);

  /** `vitest run --changed HEAD` in a packed game at `within` whose only uncommitted change is `changed`. */
  function changedRun(within: string, changed: string) {
    const game = packedGame('bs-vite-config-rerun-', within);
    writeFileSync(join(game, 'boardsmith.json'), '{ "name": "g" }\n');
    mkdirSync(dirname(join(game, changed)), { recursive: true });
    if (!existsSync(join(game, changed))) writeFileSync(join(game, changed), '{ "name": "g" }\n');
    mkdirSync(join(game, 'tests'), { recursive: true });
    writeFileSync(join(game, 'tests', 'a.test.ts'), "import { it } from 'vitest';\nit('holds', () => {});\n");
    writeFileSync(join(game, '.gitignore'), 'node_modules\n');
    initRepo(game);
    commitAll(game, 'base');
    appendFileSync(join(game, changed), '\n');
    expect(git(game, 'status', '--porcelain')).toBe(` M ${changed}\n`);
    return spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['run', '--changed', 'HEAD', '--passWithNoTests'], { cwd: game, encoding: 'utf-8' });
  }

  it.each([
    ['', 'boardsmith.json'],
    ['.worktrees/t', 'boardsmith.json'],
    ['.worktrees/t', 'package.json'],
  ])('runs every test under --changed when only its own config changed, in a game at "%s": %s (#1211, #1307)', (within, changed) => {
    // No test imports boardsmith.json, yet TestGame and the headless session read their options from it.
    // A thread or chunk worktree puts the game under a dot folder, where verify runs.
    const run = changedRun(within, changed);

    expect(`${run.stdout}${run.stderr}`).toContain('tests/a.test.ts');
    expect(run.status).toBe(0);
  }, 60_000);

  it.each(['sub/boardsmith.json', '.worktrees/x/boardsmith.json', '.boardsmith/worktrees/y/boardsmith.json'])(
    'runs no test under --changed when only a boardsmith.json other than its own changed: %s (#1307)',
    (changed) => {
      // A nested checkout or another folder's file is not the options this game's tests read.
      const run = changedRun('', changed);

      expect(`${run.stdout}${run.stderr}`).not.toContain('tests/a.test.ts');
      expect(run.status).toBe(0);
    },
    60_000,
  );
});
