import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getProjectContext } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { discardRecord, runVitestRecorded, testRunVerdict } from '../lib/vitest-run.js';
import { requireGameProject } from '../lib/game-project.js';
import { testRunScopeProblem } from '../lib/test-run-scope.js';
import { runTypecheck } from './typecheck.js';

interface TestOptions {
  watch?: boolean;
  coverage?: boolean;
  /** A file to write the verdict of a failed run into, for a script to repeat (such as a merge gate). */
  verdictFile?: string;
}

/**
 * Run the workspace's tests.
 *
 * Works in both BoardSmith workspaces so there is one way to run tests
 * everywhere: `boardsmith test` in the library runs the library's suite, and in
 * a game project runs that game's suite. Either way it is vitest driven by the
 * workspace's own `vitest.config.ts`.
 *
 * `patterns` are forwarded to vitest as filename filters, e.g.
 * `boardsmith test mcts` runs only test files matching "mcts".
 *
 * In the BoardSmith repository it type-checks first and runs no test if that
 * fails (#312). In a game project it refuses to start when the project's vitest config would
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

  if (context === 'standalone') {
    await refuseGameProjectThatCannotRun(cwd);
  } else {
    // THE BOARDSMITH REPOSITORY TYPE-CHECKS BEFORE IT TESTS (#312), so a type
    // error stops the run, and the merge that runs it, before a test starts.
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

  const label = context === 'monorepo' ? 'BoardSmith' : 'game';
  console.log(chalk.cyan(`\nRunning ${label} tests...\n`));

  const args: string[] = [];
  if (options.coverage) args.push('--coverage');
  args.push(...patterns);

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

/** Ends a run that did not pass: prints why, hands the same text to `--verdict-file`, and exits. */
function fail(verdict: string, code: number, options: TestOptions): never {
  console.error(chalk.red(`\n${verdict}\n`));
  if (options.verdictFile !== undefined) writeFileSync(options.verdictFile, `${verdict}\n`);
  process.exit(code);
}

/**
 * Stop before vitest starts when a game project has no tests, or when its
 * vitest config would also collect the chunk worktrees (#298).
 */
async function refuseGameProjectThatCannotRun(cwd: string): Promise<void> {
  requireGameProject(cwd);

  if (!existsSync(join(cwd, 'tests'))) {
    console.log(chalk.yellow('No tests directory found.'));
    console.log(chalk.dim('Create tests in the tests/ directory'));
    process.exit(0);
  }

  const problem = await testRunScopeProblem(cwd);
  if (problem !== undefined) {
    console.error(chalk.red(problem));
    process.exit(1);
  }
}
