import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getProjectContext } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { requireGameProject } from '../lib/game-project.js';
import { testRunScopeProblem } from '../lib/test-run-scope.js';
import { runTypecheck } from './typecheck.js';

interface TestOptions {
  watch?: boolean;
  coverage?: boolean;
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
    if (typecheck !== 0) process.exit(typecheck);
  }

  const label = context === 'monorepo' ? 'BoardSmith' : 'game';
  console.log(chalk.cyan(`\nRunning ${label} tests...\n`));

  const args = [options.watch ? 'watch' : 'run'];
  if (options.coverage) args.push('--coverage');
  args.push(...patterns);

  const code = await runTool('vitest', args, { cwd });

  if (code !== 0) {
    console.log(chalk.red(`\nTests failed with exit code ${code}\n`));
    process.exit(code);
  }

  console.log(chalk.green('\nAll tests passed!\n'));
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
