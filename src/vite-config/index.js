import { relative, resolve, sep } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { parseAst } from 'vite';
import { configDefaults, mergeConfig } from 'vitest/config';
import { GAME_EXCLUDES, SIM_FILE, SIM_FILES, TEST_FILE } from './test-files.js';

/**
 * A game's whole vite and vitest config. A game's `vite.config.ts` is
 *
 *   import { defineGameViteConfig } from 'boardsmith/vite-config';
 *   export default defineGameViteConfig();
 *
 * and it has no `vitest.config.*` (vitest reads `vite.config.ts` when there is none). Settings of the
 * game's own (`test.setupFiles`, an extra `test.exclude`) are passed in and merged over this one, so
 * an exclude a game adds sits beside the shipped ones rather than replacing them.
 *
 * What it sets:
 * - The Vue plugin.
 * - `resolve.dedupe: ['vue']`. `boardsmith` installs as a symlink to a checkout carrying its own
 *   copy of vue, so without it the bundle can hold two Vue runtimes, two reactivity systems and two
 *   provide/inject registries, which silently breaks state shared across the game/library boundary.
 *   A single-copy guarantee, not a version pin: the game installs whichever vue it likes.
 * - A test run that covers this checkout only. vitest's discovery walks into dot-directories, so it
 *   leaves out `.boardsmith/` (chunks built side by side in `.boardsmith/worktrees/`, scratch
 *   scripts), `.worktrees/` (agent-policy threads, each a full checkout with its own suite) and the
 *   in-browser smoke test under `tests/browser/` at any depth, which runs under Playwright
 *   (`boardsmith verify`, `boardsmith smoke`), not vitest. `configDefaults.exclude` is spread in
 *   because setting `exclude` at all replaces vitest's defaults.
 * - The rerun triggers of `rerunTriggers` below.
 * - The test classes of `testClasses` below: sims (`*.sim.test.ts`) run only under `--mode sims`.
 *
 * `boardsmith test`, `constraint-check`, `chunk-merge` and `verify` refuse a project whose config is
 * not built with this (`testRunScopeProblem`).
 *
 * Plain JavaScript, with its types in `index.d.ts`, because Node loads a vite config's imports
 * itself: it strips no TypeScript from a file under `node_modules`, where a packed or vendored
 * boardsmith lives.
 *
 * @param {import('vitest/config').UserConfig} [overrides]
 * @returns {import('vitest/config').UserConfig}
 */
export function defineGameViteConfig(overrides = {}) {
  return mergeConfig(
    {
      plugins: [vue(), rerunTriggers(), testClasses()],
      resolve: { dedupe: ['vue'] },
      test: {
        exclude: [...configDefaults.exclude, ...GAME_EXCLUDES],
      },
    },
    overrides,
  );
}

/**
 * Files no test imports whose change makes `vitest --changed` run the whole suite: vitest's own
 * triggers, the project's `vite.config.*` or `vitest.config.*` (vitest 3's default glob ends in `/**`
 * and so misses the file itself, #1419, #1420), and its `boardsmith.json`, which `TestGame` and the
 * headless session read game options from (#1211). BoardSmith's own vitest config uses it too.
 *
 * Every trigger is anchored at the project root (vite's `root`, not a `test.root` inside it), which a
 * plugin learns from the config it is handed (#1307): vitest matches triggers against absolute paths
 * and its `**` skips dot folders, so an unanchored trigger missed a game checked out under
 * `.worktrees/`, and matched other checkouts' and folders' files.
 *
 * @returns {import('vite').Plugin}
 */
export function rerunTriggers() {
  return {
    name: 'boardsmith:rerun-triggers',
    config(config) {
      // vitest compares forward-slash paths, so a Windows root is written with them before glob characters are escaped.
      const root = resolve(config.root || process.cwd()).split(sep).join('/').replace(/[\\*?[\]{}()!+@|]/g, '\\$&');
      return { test: { forceRerunTriggers: [...configDefaults.forceRerunTriggers, '{vitest,vite}.config.*', 'boardsmith.json'].map((trigger) => `${root}/${trigger}`) } };
    },
  };
}

/** The vite mode `boardsmith test --sims` runs vitest in. */
const SIM_MODE = 'sims';

/** What makes a test a sim: the names it imports that play whole games, by module. */
const SIM_TOOLS = {
  'boardsmith/testing': ['simulateRandomGames', 'replayRandomGame'],
  'boardsmith/sim': ['playGame'],
  'boardsmith/bot': ['createBot', 'MCTSBot'],
  'boardsmith/bot-trainer': ['benchmarkBot', 'WeightEvolver'],
};

/**
 * A game's test classes by file name (#1494): a unit test is `*.test.ts`, a sim is `*.sim.test.ts`.
 * Sims never run automatically: a plain run (`boardsmith test`, `verify`, the mutation runner,
 * agent-policy's `vitest run --changed` and suite slices) leaves them out, and `vitest --mode sims`
 * (`boardsmith test --sims`) runs only them.
 *
 * A test file outside `*.sim.test.ts` that imports a sim tool (`SIM_TOOLS`) fails as vitest loads
 * it, naming the file and its new name, so a slow test cannot drift back into the automated suite.
 * The check lives here because this config is the one thing every run of a game's tests loads.
 * shortcut: it reads the test file's own imports only, so a helper module that wraps a sim tool passes; follow the imports if that happens.
 *
 * @returns {import('vite').Plugin}
 */
export function testClasses() {
  let root = process.cwd();
  return {
    name: 'boardsmith:test-classes',
    config(config, { mode }) {
      if (mode !== SIM_MODE) return { test: { exclude: [SIM_FILES] } };
      // Set, not returned: vite would add a game's own include beside it, and run its unit tests too.
      config.test = { ...config.test, include: [SIM_FILES] };
    },
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      if (!TEST_FILE.test(id) || SIM_FILE.test(id)) return undefined;
      const used = parseAst(code).body.flatMap((node) => {
        const tools = node.type === 'ImportDeclaration' ? SIM_TOOLS[node.source.value] : undefined;
        if (tools === undefined) return [];
        const names = node.specifiers.flatMap((s) => (s.type === 'ImportSpecifier' && tools.includes(s.imported.name) ? [s.imported.name] : []));
        return names.length === 0 ? [] : [`${names.join(' and ')} from ${node.source.value}`];
      });
      if (used.length === 0) return undefined;
      const file = relative(root, id).split(sep).join('/');
      throw new Error(
        `${file} uses ${used.join(', ')}, which plays whole games. A test that does is a sim, and sims run only on request: ` +
          `rename it to ${file.replace(TEST_FILE, (suffix) => `.sim${suffix}`)} and run it with \`boardsmith test --sims\`.`,
      );
    },
  };
}
