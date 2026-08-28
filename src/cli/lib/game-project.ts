import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * THE ONE PLACE A COMMAND CHECKS IT IS IN A GAME PROJECT.
 *
 * `analyze`, `evolve-bot-weights`, `simulate`, `test` and `validate` each
 * carried a verbatim copy of this: the same path, the same two lines of advice
 * and the same exit code. Five copies of one sentence is five chances for a
 * command to tell an author something slightly different about the same
 * mistake.
 *
 * @returns the path to `boardsmith.json`, for the caller that then reads it.
 */
export function requireGameProject(cwd: string): string {
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    console.error(chalk.red('Error: boardsmith.json not found'));
    console.error(chalk.dim('Make sure you are in a BoardSmith game project directory'));
    process.exit(1);
  }
  return configPath;
}
