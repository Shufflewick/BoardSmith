/**
 * A game's test classes by file name (#1494), the one copy of the rule: `index.js` sorts vitest's
 * runs by it, `boardsmith test --changed` explains a change with no unit test by it (#1502), and
 * `test-step-check` sorts a chunk's changed files by it, for itself and `boardsmith verify` (#1506),
 * and `testRunScopeProblem` reads the shipped excludes from it.
 * A module of its own, importing nothing, so the CLI can read it without loading vite.
 */

/** A sim's file name, `*.sim.test.ts` or any other spelling vitest collects: a random-game sim, a whole match, a bot game or a pace or budget run. */
export const SIM_FILES = '**/*.sim.{test,spec}.?(c|m)[jt]s?(x)';
export const SIM_FILE = /\.sim\.(test|spec)\.[cm]?[jt]sx?$/;

/** A file vitest collects by default, and the suffix a rename to a sim puts `.sim` before. */
export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** The folders `defineGameViteConfig` adds to vitest's excludes; `index.js` says why each is left out. */
export const GAME_EXCLUDES = Object.freeze(['.boardsmith/**', '.worktrees/**', '**/tests/browser/**']);

/** vitest's `configDefaults.exclude`, copied because the CLI does not load vitest; `index.test.ts` holds it to the installed vitest. */
export const VITEST_EXCLUDES = Object.freeze([
  '**/node_modules/**',
  '**/dist/**',
  '**/cypress/**',
  '**/.{idea,git,cache,output,temp}/**',
  '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
]);
