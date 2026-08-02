import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface RunToolOptions {
  /** Directory to run the tool in. Also where `node_modules/.bin` is looked up. */
  cwd: string;
}

/**
 * Run a developer tool (vitest, eslint, stylelint, ...) the same way for every
 * BoardSmith workspace, so `boardsmith <command>` is the single way to invoke it.
 *
 * Prefers the workspace's own `node_modules/.bin/<bin>` so a declared
 * devDependency is always what runs — no network fetch, no version drift. Falls
 * back to `npx` only for tools that are deliberately NOT dependencies
 * (`jscpd`, `fallow`), matching how they have always been invoked.
 *
 * Resolves with the child's exit code and never throws on a non-zero exit: the
 * caller decides what a failing tool means for the command as a whole. Rejects
 * only when the tool could not be spawned at all.
 */
export function runTool(bin: string, args: string[], options: RunToolOptions): Promise<number> {
  const localBin = join(options.cwd, 'node_modules', '.bin', bin);
  const useLocal = existsSync(localBin);
  const command = useLocal ? localBin : 'npx';
  const commandArgs = useLocal ? args : [bin, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      stdio: 'inherit',
      // On Windows both `npx` and the `.bin` shims are batch files, which
      // `spawn` cannot execute without a shell. Everywhere else, running
      // without a shell keeps glob arguments (e.g. 'src/**/*.vue') intact so
      // the tool does its own matching rather than the shell doing it first.
      shell: process.platform === 'win32',
    });

    child.on('error', (error) => {
      reject(
        new Error(
          `Could not run ${bin}: ${error.message}\n`
          + `Install it in this project with: npm install -D ${bin}`,
        ),
      );
    });

    // A tool killed by a signal produced no verdict — treat that as a failure
    // rather than reporting the `null` exit code as success.
    child.on('close', (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}
