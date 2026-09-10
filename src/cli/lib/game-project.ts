import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { resolveUserPath } from './user-path.js';

/**
 * A game's `boardsmith.json`, as far as the CLI commands that read it care.
 * Only the keys a command actually touches are named; the index signature
 * carries the rest, because the manifest is the author's file and the CLI is
 * not its schema (`boardsmith validate` is).
 */
interface GameProjectConfig {
  name?: string;
  displayName?: string;
  gameId?: string;
  publisherId?: string;
  publisher?: string;
  /** The single backend declaration (#171): "table" or "world". */
  backend?: unknown;
  paths?: {
    rules?: string;
    ui?: string;
  };
  [key: string]: unknown;
}

/** A game's `package.json`, which is the ONE place its version is stated. */
interface GameProjectPackage {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

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

/**
 * BOTH of a game project's manifests, for the commands that need both.
 *
 * `build` and `publish` each read `boardsmith.json` and then `package.json`,
 * because a game's identity is in one and its version is in the other
 * (ShufflewickPub #240) — and each had its own wording for the same two
 * failures, so the same missing file was a different error depending on which
 * command you happened to run.
 *
 * Both files are read BEFORE any work starts: a project that cannot state what
 * it is should hear about it in a second, not after a full compile.
 */
export function requireGameProjectManifests(cwd: string): {
  configPath: string;
  config: GameProjectConfig;
  pkg: GameProjectPackage;
} {
  const configPath = requireGameProject(cwd);
  const config: GameProjectConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(chalk.red('Error: package.json not found'));
    console.error(
      chalk.dim('A BoardSmith game states its version in package.json, and the build reads it from there.'),
    );
    process.exit(1);
  }
  const pkg: GameProjectPackage = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  return { configPath, config, pkg };
}

/**
 * Where a project's rules live: `paths.rules` when the manifest declares one,
 * `src/rules` otherwise. The default belongs here rather than in each command,
 * so a project cannot be laid out one way for `dev` and another for `simulate`.
 */
export function resolveRulesDir(cwd: string, config: { paths?: { rules?: string } }): string {
  return config.paths?.rules
    ? resolveUserPath(cwd, config.paths.rules)
    : join(cwd, 'src', 'rules');
}

/**
 * THE ONE PLACE A COMMAND CHECKS THE RULES ARE THERE.
 *
 * `dev` and `simulate` both load the compiled rules through
 * `loadGameDefinition`, and both first checked for the entry point by hand so
 * the failure names the missing file instead of a module-resolution stack.
 *
 * @returns the path to the rules entry point, which `dev` also hands to its
 * Vite plugin as the module to re-export `gameDefinition` from.
 */
export function requireRulesIndex(rulesPath: string): string {
  const rulesIndexPath = join(rulesPath, 'index.ts');
  if (!existsSync(rulesIndexPath)) {
    console.error(chalk.red(`Error: Rules not found at ${rulesIndexPath}`));
    console.error(chalk.dim('Make sure your game has a src/rules/index.ts that exports gameDefinition'));
    process.exit(1);
  }
  return rulesIndexPath;
}
