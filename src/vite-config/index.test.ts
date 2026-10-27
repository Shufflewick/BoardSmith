import { describe, it, expect } from 'vitest';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';
import { defineGameViteConfig, testClasses } from './index.js';
import { VITEST_EXCLUDES } from './test-files.js';
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
    expect(config.plugins?.flat().map((p) => (p && typeof p === 'object' && 'name' in p ? p.name : p))).toEqual(['vite:vue', 'boardsmith:rerun-triggers', 'boardsmith:test-classes']);
    expect(config.resolve?.dedupe).toEqual(['vue']);
    expect(config.test?.exclude).toEqual([...configDefaults.exclude, '.boardsmith/**', '.worktrees/**', '**/tests/browser/**']);
  });

  it("copies vitest's default excludes for the CLI, which does not load vitest", () => {
    expect(VITEST_EXCLUDES).toEqual(configDefaults.exclude);
  });

  it("anchors the rerun triggers at the project root, not a test root inside it (#1307)", () => {
    // boardsmith.json, package.json and vite.config.ts sit at the project root, whatever folder the tests run from.
    const plugin = defineGameViteConfig().plugins?.flat().find((p) => p && typeof p === 'object' && 'name' in p && p.name === 'boardsmith:rerun-triggers') as unknown as { config: (c: object) => { test: { forceRerunTriggers: string[] } } };
    const { test } = plugin.config({ root: '/p/game', test: { root: '/p/game/tests' } });
    expect(test.forceRerunTriggers).toEqual([...configDefaults.forceRerunTriggers, '{vitest,vite}.config.*', 'boardsmith.json'].map((t) => `/p/game/${t}`));
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

  /** A packed game holding `files`, each a passing test unless given its own text. */
  function packedGameWith(prefix: string, files: Record<string, string>): string {
    const game = packedGame(prefix);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(game, file)), { recursive: true });
      writeFileSync(join(game, file), text);
    }
    return game;
  }

  const PASSING = "import { it } from 'vitest';\nit('holds', () => {});\n";

  it.each([
    [[], ['tests/a.test.ts', 'tests/e.spec.js']],
    [['--mode', 'sims'], ['tests/b.sim.test.ts', 'tests/c.sim.spec.ts', 'tests/d.sim.test.js']],
  ])('leaves the sims out of a run, and runs only them in vitest %j (#1494)', (args, expected) => {
    // `boardsmith test --sims` is `vitest run --mode sims`; every other run (verify, mutation, agent-policy's --changed and slices) is plain.
    const files = ['tests/a.test.ts', 'tests/b.sim.test.ts', 'tests/c.sim.spec.ts', 'tests/d.sim.test.js', 'tests/e.spec.js'];
    const game = packedGameWith('bs-vite-config-classes-', Object.fromEntries(files.map((file) => [file, PASSING])));

    const listed = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['list', '--filesOnly', ...args], { cwd: game, encoding: 'utf-8' });

    expect(`${listed.stdout}${listed.stderr}`.trim().split('\n').sort()).toEqual(expected);
    expect(listed.status).toBe(0);
  }, 60_000);

  it("runs only the sims under --mode sims, whatever include the game passes in (#1494)", () => {
    const game = packedGameWith('bs-vite-config-classes-include-', {
      'vite.config.ts': "import { defineGameViteConfig } from 'boardsmith/vite-config';\nexport default defineGameViteConfig({ test: { include: ['tests/**/*.test.ts'] } });\n",
      'tests/a.test.ts': PASSING,
      'tests/b.sim.test.ts': PASSING,
    });

    const listed = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['list', '--filesOnly', '--mode', 'sims'], { cwd: game, encoding: 'utf-8' });

    expect(`${listed.stdout}${listed.stderr}`.trim()).toBe('tests/b.sim.test.ts');
    expect(listed.status).toBe(0);
  }, 60_000);

  it('refuses a plain test file that calls simulateRandomGames, telling them to rename it (#1494)', () => {
    const game = packedGameWith('bs-vite-config-sim-tool-', {
      'tests/a.test.ts': "import { it } from 'vitest';\nimport { simulateRandomGames } from 'boardsmith/testing';\nit('plays', () => simulateRandomGames);\n",
    });

    const run = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['run'], { cwd: game, encoding: 'utf-8' });

    expect(`${run.stdout}${run.stderr}`).toContain(
      'tests/a.test.ts uses simulateRandomGames from boardsmith/testing, which plays whole games. A test that does is a sim, and sims run only on request: rename it to tests/a.sim.test.ts and run it with `boardsmith test --sims`.',
    );
    expect(run.status).not.toBe(0);
  }, 60_000);

  /** What the test-classes plugin makes of `code` at `id`, in a project at /p/game: undefined, or the refusal. */
  function refusal(code: string, id: string): string | undefined {
    const plugin = testClasses() as unknown as { configResolved: (c: object) => void; transform: (code: string, id: string) => unknown };
    plugin.configResolved({ root: '/p/game' });
    try {
      plugin.transform(code, id);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it.each([
    ["import { simulateRandomGames as sim } from 'boardsmith/testing';", 'simulateRandomGames from boardsmith/testing'],
    ["import { replayRandomGame } from 'boardsmith/testing';", 'replayRandomGame from boardsmith/testing'],
    ["import { playGame } from 'boardsmith/sim';", 'playGame from boardsmith/sim'],
    ["import { createBot, searchCopyForSeat } from 'boardsmith/bot';", 'createBot from boardsmith/bot'],
    ["import { MCTSBot } from 'boardsmith/bot';", 'MCTSBot from boardsmith/bot'],
    ["import { benchmarkBot, WeightEvolver } from 'boardsmith/bot-trainer';", 'benchmarkBot and WeightEvolver from boardsmith/bot-trainer'],
  ])('names the sim tool a plain test file uses: %s (#1494)', (code, named) => {
    expect(refusal(code, '/p/game/tests/x.spec.ts')).toContain(`tests/x.spec.ts uses ${named}, which plays whole games.`);
    expect(refusal(code, '/p/game/tests/x.spec.ts')).toContain('rename it to tests/x.sim.spec.ts');
  });

  it.each([
    ["import { simulateRandomGames } from 'boardsmith/testing';", '/p/game/tests/x.sim.test.ts'],
    ["import { simulateRandomGames } from 'boardsmith/testing';", '/p/game/tests/x.sim.spec.js'],
    ["import { playGame } from 'boardsmith/sim';", '/p/game/src/sim/run.ts'],
    ["import { searchCopyForSeat, parseBotLevel } from 'boardsmith/bot';", '/p/game/tests/x.test.ts'],
    ["import { createTestGame } from 'boardsmith/testing';", '/p/game/tests/x.test.ts'],
  ])('lets a sim file, a non-test file, or a test using no sim tool through: %s at %s (#1494)', (code, id) => {
    expect(refusal(code, id)).toBeUndefined();
  });

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
    ['', 'vite.config.ts'],
    ['.worktrees/t', 'vite.config.ts'],
  ])('runs every test under --changed when only its own config changed, in a game at "%s": %s (#1211, #1307)', (within, changed) => {
    // No test imports boardsmith.json or vite.config.ts, yet TestGame and the headless session read their options from one and vitest runs on the other (#1420).
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
