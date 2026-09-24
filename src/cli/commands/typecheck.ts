import chalk from 'chalk';
import { requireBoardsmithWorkspace } from '../lib/project-context.js';
import { runTool } from '../lib/run-tool.js';

/**
 * Type-check the workspace with `vue-tsc --noEmit -p tsconfig.json` (#312) and
 * return its exit code.
 *
 * `vue-tsc` rather than `tsc` because plain `tsc` cannot read a `.vue` file, so
 * it checks neither an SFC's script nor its template. In the BoardSmith
 * repository `boardsmith test` calls this first; docs/typecheck.md says what
 * the repository's tsconfig.json covers.
 */
export async function runTypecheck(cwd: string): Promise<number> {
  console.log(chalk.cyan('\nType-checking with vue-tsc...\n'));
  const code = await runTool('vue-tsc', ['--noEmit', '-p', 'tsconfig.json'], { cwd });
  if (code !== 0) {
    console.error(chalk.red('\nThe type check failed. Fix the errors above, then run `boardsmith typecheck` again.\n'));
  }
  return code;
}

export async function typecheckCommand(): Promise<void> {
  const cwd = process.cwd();
  requireBoardsmithWorkspace(cwd);
  const code = await runTypecheck(cwd);
  if (code !== 0) process.exit(code);
  console.log(chalk.green('No type errors.\n'));
}
