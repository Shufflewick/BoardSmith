import { describe, it, expect } from 'vitest';
import { cpSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';
import { defineGameViteConfig } from './index.js';
import { tempTree } from '../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../testing/installed-modules.test-helper.js';

const CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * #528: a game's vite and vitest config is shipped by BoardSmith, so a change to what a test run
 * leaves out reaches every game with the package, not by a copy in each game.
 */
describe('defineGameViteConfig', () => {
  it('gives a game the Vue plugin, one Vue runtime, and a test run that covers only its own checkout', () => {
    const config = defineGameViteConfig();
    expect(config.plugins?.flat().map((p) => (p && typeof p === 'object' && 'name' in p ? p.name : p))).toEqual(['vite:vue']);
    expect(config.resolve?.dedupe).toEqual(['vue']);
    expect(config.test?.exclude).toEqual([...configDefaults.exclude, '.boardsmith/**', '.worktrees/**', '**/tests/browser/**']);
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
    const game = tempTree('bs-vite-config-packed-');
    const packed = join(game, 'node_modules', 'boardsmith');
    mkdirSync(join(packed, 'src'), { recursive: true });
    cpSync(join(CHECKOUT, 'package.json'), join(packed, 'package.json'));
    cpSync(join(CHECKOUT, 'src', 'vite-config'), join(packed, 'src', 'vite-config'), { recursive: true });
    for (const name of readdirSync(INSTALLED_MODULES)) symlinkSync(join(INSTALLED_MODULES, name), join(game, 'node_modules', name), 'dir');
    writeFileSync(join(game, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(join(game, 'vite.config.ts'), "import { defineGameViteConfig } from 'boardsmith/vite-config';\nexport default defineGameViteConfig();\n");
    for (const file of ['tests/a.test.ts', '.worktrees/x/tests/a.test.ts', '.boardsmith/worktrees/y/tests/a.test.ts']) {
      mkdirSync(dirname(join(game, file)), { recursive: true });
      writeFileSync(join(game, file), "import { it } from 'vitest';\nit('holds', () => {});\n");
    }

    const listed = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['list', '--filesOnly'], { cwd: game, encoding: 'utf-8' });

    expect(`${listed.stdout}${listed.stderr}`.trim()).toBe('tests/a.test.ts');
    expect(listed.status).toBe(0);
  }, 60_000);
});
