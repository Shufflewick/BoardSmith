import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { getProjectContext } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';
import { requireGameProject } from '../lib/game-project.js';

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
 */
export async function testCommand(patterns: string[], options: TestOptions): Promise<void> {
  const cwd = process.cwd();
  const context = getProjectContext(cwd);

  if (context === 'standalone') {
    requireGameProject(cwd);

    if (!existsSync(join(cwd, 'tests'))) {
      console.log(chalk.yellow('No tests directory found.'));
      console.log(chalk.dim('Create tests in the tests/ directory'));
      process.exit(0);
    }
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
