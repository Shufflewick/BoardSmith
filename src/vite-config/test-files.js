/**
 * A game's test classes by file name (#1494), the one copy of the rule: `index.js` sorts vitest's
 * runs by it, and `boardsmith test --changed` explains a change with no unit test by it (#1502).
 * A module of its own, importing nothing, so the CLI can read it without loading vite.
 */

/** A sim's file name, `*.sim.test.ts` or any other spelling vitest collects: a random-game sim, a whole match, a bot game or a pace or budget run. */
export const SIM_FILES = '**/*.sim.{test,spec}.?(c|m)[jt]s?(x)';
export const SIM_FILE = /\.sim\.(test|spec)\.[cm]?[jt]sx?$/;

/** A file vitest collects by default, and the suffix a rename to a sim puts `.sim` before. */
export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
