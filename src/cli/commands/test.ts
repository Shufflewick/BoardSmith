import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { getProjectContext } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { discardRecord, runVitestRecorded, testRunVerdict } from '../lib/vitest-run.js';
import { requireGameProject } from '../lib/game-project.js';
import { gameTestRunProblem } from '../lib/test-run-scope.js';
import { runTypecheck } from './typecheck.js';
import { runAuthoredTests } from '../lib/authored-tests.js';

/**
 * The vitest config of BoardSmith's browser regressions (`scripts/*-browser.mjs`), which
 * `boardsmith test --browser` runs in place of the default suite, so the default needs no Chromium.
 */
export const BROWSER_SUITE_CONFIG = 'vitest.browser.config.ts';

interface TestOptions {
  watch?: boolean;
  /** Run BoardSmith's browser regressions (`BROWSER_SUITE_CONFIG`) instead of the default suite. */
  browser?: boolean;
  coverage?: boolean;
  /** A file to write the verdict of a failed run into, for a script to repeat (such as a merge gate). */
  verdictFile?: string;
  selection?: string;
}

/**
 * Run the workspace's tests.
 *
 * Works in both BoardSmith workspaces so there is one way to run tests
 * everywhere: `boardsmith test` in the library runs the library's suite, and in
 * a game project runs that game's suite. Either way it is vitest driven by the
 * workspace's own config: the library's `vitest.config.ts`, a game's `vite.config.ts`.
 *
 * `patterns` are forwarded to vitest as filename filters, e.g.
 * `boardsmith test mcts` runs only test files matching "mcts".
 *
 * `--browser`, in the BoardSmith repository only, runs the browser regressions in Chromium
 * (`BROWSER_SUITE_CONFIG`, #533) instead of the default suite, without the type check.
 *
 * In the BoardSmith repository it type-checks first and runs no test if that
 * fails (#312), except under `--browser`. In a game project it refuses to start when the project's vitest config would
 * also collect the chunk worktrees under `.boardsmith/worktrees/` (#298).
 *
 * A run that does not pass ends with a verdict that says why (#429): the files
 * that failed, or, when vitest itself stopped before its summary, the signal or
 * exit code that stopped it and the files it left unfinished. It names a log
 * holding the run's whole output, and `--verdict-file` writes the same
 * paragraph to a file for a script to repeat. Watch mode is interactive and has
 * no end to report, so it runs vitest as it is.
 */
export async function testCommand(patterns: string[], options: TestOptions): Promise<void> {
  const cwd = process.cwd();
  const context = getProjectContext(cwd);
  if (options.selection !== undefined && (patterns.length > 0 || options.watch || options.browser || options.coverage)) {
    throw new Error('Use --selection by itself, without filename filters, --watch, --browser or --coverage.');
  }

  if (context === 'standalone') {
    await refuseGameProjectThatCannotRun(cwd, options);
  } else {
    await typecheckFirst(cwd, options);
  }

  const label = context === 'monorepo' ? 'BoardSmith' : 'game';
  console.log(chalk.cyan(`\nRunning ${label} tests...\n`));

  if (options.selection !== undefined) {
    try {
      const result = await runAuthoredTests(cwd, options.selection);
      console.log(chalk.green(`\n${result.counts.passed} authored tests passed in ${result.counts.files} files.\n`));
    } catch (error) {
      fail((error as Error).message, 1, options);
    }
    return;
  }

  const args = vitestArgs(patterns, options);

  if (options.watch) {
    process.exit(await runTool('vitest', ['watch', ...args], { cwd }));
  }

  const run = await runVitestRecorded(args, cwd);
  const verdict = testRunVerdict(run, run.progress, { cwd, logPath: run.logPath });
  if (verdict !== undefined) {
    fail(verdict, run.code !== null && run.code !== 0 ? run.code : 1, options);
  }

  discardRecord(run);
  console.log(chalk.green('\nAll tests passed!\n'));
}

/** What vitest is handed after its own subcommand: the options asked for, then the filename filters. */
function vitestArgs(patterns: string[], options: TestOptions): string[] {
  const args: string[] = [];
  if (options.browser) args.push('--config', BROWSER_SUITE_CONFIG);
  if (options.coverage) args.push('--coverage');
  return [...args, ...patterns];
}

/**
 * THE BOARDSMITH REPOSITORY TYPE-CHECKS BEFORE IT TESTS (#312), so a type error stops the run,
 * and the merge that runs it, before a test starts. `--browser` does not: it runs after the
 * default suite (in `agent-policy verify`, on the same commit), which has type-checked already.
 */
async function typecheckFirst(cwd: string, options: TestOptions): Promise<void> {
  if (options.browser) return;
  const typecheck = await runTypecheck(cwd);
  if (typecheck !== 0) {
    fail(
      `The type check failed (vue-tsc exited with code ${typecheck}), so no test ran. ` +
        "Its errors are above; run 'boardsmith typecheck' to see them again.",
      typecheck,
      options,
    );
  }
}

/** Ends a run that did not pass: prints why, hands the same text to `--verdict-file`, and exits. */
function fail(verdict: string, code: number, options: TestOptions): never {
  console.error(chalk.red(`\n${verdict}\n`));
  if (options.verdictFile !== undefined) writeFileSync(options.verdictFile, `${verdict}\n`);
  process.exit(code);
}

/**
 * Stop before vitest starts when a game project is asked for `--browser`, has no
 * tests, or has a vitest config that would also collect the chunk worktrees (#298).
 */
async function refuseGameProjectThatCannotRun(cwd: string, options: TestOptions): Promise<void> {
  requireGameProject(cwd);

  if (options.browser) {
    throw new Error(
      "--browser runs BoardSmith's own browser regressions, and a game has none. " +
        'To open this game in a browser, run `boardsmith smoke`.',
    );
  }

  const problem = await gameTestRunProblem(cwd);
  if (problem !== undefined) {
    console.error(chalk.red(problem));
    process.exit(1);
  }
}
