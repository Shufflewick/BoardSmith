import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUserPath } from './user-path.js';
import { resolveWorldMode } from './world-project.js';
import { SMOKE_SPEC_PATH } from '../../testing/browser-smoke-verdict.js';
import type { PlatformTarget } from './publish-api.js';

/** The ids one publishing platform gave a game (#704). */
export interface PlatformIds {
  gameId?: string;
  publisherId?: string;
}

/**
 * A game's `boardsmith.json`, as far as the CLI commands that read it care.
 * Only the keys a command actually touches are named; the index signature
 * carries the rest, because the manifest is the author's file and the CLI is
 * not its schema (`boardsmith validate` is).
 */
export interface GameProjectConfig {
  name?: string;
  displayName?: string;
  /** Each platform's ids, kept apart because dev and prod are separate deployments (#704). */
  platforms?: Partial<Record<PlatformTarget, PlatformIds>>;
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
 * `evolve-bot-weights`, `simulate`, `test` and `validate` each carried a
 * verbatim copy of this: the same path, the same two lines of advice and the
 * same exit code. Four copies of one sentence is four chances for a command to
 * tell an author something slightly different about the same mistake.
 *
 * Throws rather than exiting, like every guard here (#532), so a command run
 * inside another one (`verify` runs `validate` and `build`) stops there too.
 *
 * @returns the path to `boardsmith.json`, for the caller that then reads it.
 */
export function requireGameProject(cwd: string): string {
  const configPath = join(cwd, 'boardsmith.json');
  if (!existsSync(configPath)) {
    throw new Error(
      'boardsmith.json not found.\nMake sure you are in a BoardSmith game project directory.',
    );
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
    throw new Error(
      'package.json not found.\n' +
        'A BoardSmith game states its version in package.json, and the build reads it from there.',
    );
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
 * `build`, `dev`, `simulate` and `evolve-bot-weights` load the compiled rules
 * through `loadGameDefinition`, and each first checks for the entry point by
 * hand so the failure names the missing file instead of a module-resolution
 * stack.
 *
 * @returns the path to the rules entry point, which `dev` also hands to its
 * Vite plugin as the module to re-export `gameDefinition` from.
 */
export function requireRulesIndex(rulesPath: string): string {
  const rulesIndexPath = join(rulesPath, 'index.ts');
  if (!existsSync(rulesIndexPath)) {
    throw new Error(
      `Rules not found at ${rulesIndexPath}.\n` +
        `Make sure ${rulesIndexPath} exists and exports gameDefinition, or point "paths.rules" in ` +
        'boardsmith.json at the directory that holds your rules.',
    );
  }
  return rulesIndexPath;
}

/** The page a table's UI is served from. */
export const TABLE_UI_ENTRY = 'index.html';

/**
 * Every file of a table's UI, in the order `boardsmith add-ui` writes them (`tableUiFiles`).
 * `boardsmith init --sim` writes none of them.
 */
export const TABLE_UI_PATHS = [
  TABLE_UI_ENTRY,
  'src/main.ts',
  'src/ui/index.ts',
  'src/ui/uis.ts',
  'src/ui/App.vue',
  'src/ui/components/GameTable.vue',
  'tests/a11y.example.test.ts',
  SMOKE_SPEC_PATH,
] as const;

/**
 * THE ONE PLACE A TABLE'S UI STATE IS DECIDED, from which of {@link TABLE_UI_PATHS} it has.
 * `none`: no UI yet (`boardsmith init --sim`). `present`: it has `index.html`. `broken`: it lost
 * `index.html` but kept other UI files, which every command treats as a failure, never as no UI.
 * `files` lists the UI files present.
 */
export type TableUiState = { state: 'none' } | { state: 'present' | 'broken'; files: string[] };

export function tableUiState(cwd: string): TableUiState {
  const files = TABLE_UI_PATHS.filter((path) => existsSync(join(cwd, path)));
  if (files.length === 0) return { state: 'none' };
  return { state: files[0] === TABLE_UI_ENTRY ? 'present' : 'broken', files };
}

/**
 * Why this project has no UI to serve, build or walk, or undefined when it has one: `none` for a
 * table with no UI yet, `broken` for one that lost `index.html`. A world always has one (`build`
 * and `dev` write its entry when it is missing).
 */
export function projectUiProblem(
  cwd: string,
  config: { backend?: unknown },
): { state: 'none' | 'broken'; problem: string } | undefined {
  if (resolveWorldMode(config)) return undefined;
  const ui = tableUiState(cwd);
  if (ui.state === 'none') return { state: 'none', problem: 'This project has no UI yet. Run `boardsmith add-ui`.' };
  if (ui.state === 'present') return undefined;
  return {
    state: 'broken',
    problem:
      `${TABLE_UI_ENTRY} is missing, but this project has UI files (${ui.files.join(', ')}); ` +
      `restore ${TABLE_UI_ENTRY}, or remove them and run \`boardsmith add-ui\`.`,
  };
}

/**
 * THE ONE PLACE A COMMAND REFUSES A PROJECT WITH NO UI (`dev`, `build`, `smoke`, `publish`).
 * `boardsmith verify` skips its build and smoke checks for a table with none yet instead, and
 * fails them for a broken one (`projectUiProblem`).
 */
export function requireTableUi(cwd: string, config: { backend?: unknown }): void {
  const ui = projectUiProblem(cwd, config);
  if (ui !== undefined) throw new Error(ui.problem);
}
