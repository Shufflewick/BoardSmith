/**
 * WHERE A CLI COMMAND BUNDLES A PROJECT'S RULES OR KEEPS A RUN'S WORK FILES, ONE DIRECTORY PER RUN
 * (#543, #544).
 *
 * A fixed `.boardsmith/<command>-tmp/` was shared by every run of that command in the project, so
 * two validates of one game at once (two worktrees' suites on one machine) wrote into one folder,
 * and the first to finish deleted the bundle the other was about to import. verify's suite report
 * and the mutation checks' generated files had the same fault in fixed `.boardsmith/scratch/`
 * folders (#544). Now each run makes a fresh directory and removes only that one.
 *
 * It sits inside the project, not the OS temp directory, so the bundle resolves the project's own
 * `node_modules`. `.boardsmith/` itself is never a command's to remove: it also holds the scratch
 * directory and the git worktrees of chunks built side by side, and `boardsmith dev` stopping once
 * deleted both (#391).
 *
 * A command that runs once and ends uses {@link withCommandBuildDir}, which also removes the
 * directory when a signal stops the run. `boardsmith dev`, which holds its directory until the
 * host stops, uses {@link makeCommandBuildDir} and hands the removal to its teardown.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The CLI commands that bundle a project's rules into a build directory of their own, and the runs
 * that keep work files in one: `verify` for its suite's report, `verify-mutation` and
 * `test-step-check` for the mutation checks' generated vitest config, mutants and reports.
 */
type BuildingCommand =
  | 'dev'
  | 'simulate'
  | 'build'
  | 'validate'
  | 'evolve-bot-weights'
  | 'verify'
  | 'verify-mutation'
  | 'test-step-check';

/**
 * The name every build directory of `command` starts with, inside `.boardsmith/`. Each run's
 * directory is this followed by a few random characters.
 */
export function commandBuildDirPrefix(command: BuildingCommand): string {
  return `${command}-tmp-`;
}

/** Makes a fresh, empty build directory for one run of `command`, and returns its absolute path. */
export function makeCommandBuildDir(projectDir: string, command: BuildingCommand): string {
  const parent = join(projectDir, '.boardsmith');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, commandBuildDirPrefix(command)));
}

const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Runs `use` with a fresh build directory for one run of `command`, and removes that directory
 * when `use` settles or when SIGINT or SIGTERM stops the run.
 *
 * Node skips `finally` when a signal ends the process, so on a signal this removes the directory
 * itself and then raises the same signal again, so the process still ends the way that signal
 * ends it: a stopped run never exits 0 and reads as a pass.
 */
export async function withCommandBuildDir<T>(
  projectDir: string,
  command: BuildingCommand,
  use: (buildDir: string) => Promise<T>,
): Promise<T> {
  return withDirRemovedAfter(makeCommandBuildDir(projectDir, command), use);
}

/**
 * Runs `use` with `dir`, a directory this run made, and removes `dir` when `use` settles or when
 * SIGINT or SIGTERM stops the run, the same way {@link withCommandBuildDir} removes a build directory.
 */
export async function withDirRemovedAfter<T>(dir: string, use: (dir: string) => Promise<T>): Promise<T> {
  const remove = (): void => rmSync(dir, { recursive: true, force: true });
  const release = (): void => {
    for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
  };
  function onSignal(signal: NodeJS.Signals): void {
    release();
    remove();
    process.kill(process.pid, signal);
  }
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
  try {
    return await use(dir);
  } finally {
    release();
    remove();
  }
}
