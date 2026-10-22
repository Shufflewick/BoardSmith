import { resolve, sep } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { configDefaults, mergeConfig } from 'vitest/config';

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
      plugins: [vue(), rerunTriggers()],
      resolve: { dedupe: ['vue'] },
      test: {
        exclude: [...configDefaults.exclude, '.boardsmith/**', '.worktrees/**', '**/tests/browser/**'],
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
