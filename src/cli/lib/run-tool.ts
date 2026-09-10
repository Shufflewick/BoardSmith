import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface RunToolOptions {
  /** Directory to run the tool in. Also where `node_modules/.bin` is looked up. */
  cwd: string;
}

/**
 * Spawn a developer tool the same way for every BoardSmith workspace, so
 * `boardsmith <command>` is the single way to invoke it.
 *
 * Prefers the workspace's own `node_modules/.bin/<bin>` so a declared
 * devDependency is always what runs — no network fetch, no version drift. Falls
 * back to `npx` only for tools that are deliberately NOT dependencies
 * (`jscpd`, `fallow`), matching how they have always been invoked.
 *
 * `capture` decides where the child's stdout goes: inherited (the developer
 * reads it) or piped back to the caller (a command reasons about it).
 */
function spawnTool(
  bin: string,
  args: string[],
  options: RunToolOptions,
  capture: boolean,
): Promise<{ code: number; stdout: string }> {
  const localBin = join(options.cwd, 'node_modules', '.bin', bin);
  const useLocal = existsSync(localBin);
  const command = useLocal ? localBin : 'npx';
  const commandArgs = useLocal ? args : [bin, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      // stderr stays inherited even when stdout is captured: progress and
      // warnings belong on the developer's terminal, not in the parsed value.
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      // On Windows both `npx` and the `.bin` shims are batch files, which
      // `spawn` cannot execute without a shell. Everywhere else, running
      // without a shell keeps glob arguments (e.g. 'src/**/*.vue') intact so
      // the tool does its own matching rather than the shell doing it first.
      shell: process.platform === 'win32',
    });

    // Buffered whole and decoded ONCE at the end. A chunk boundary can fall
    // inside a multi-byte UTF-8 character, and decoding each chunk on its own
    // replaces the halves with U+FFFD -- so the captured text stops being what
    // the tool printed. `boardsmith audit --dupes-baseline` hashes the source
    // text `fallow dupes` reports, so one mangled character silently changed an
    // accepted clone group's key (#241).
    const stdoutChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
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
    child.on('close', (code, signal) =>
      resolve({
        code: signal ? 1 : code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
      }));
  });
}

/**
 * Run a developer tool (vitest, eslint, stylelint, ...) with its output on the
 * developer's terminal.
 *
 * Resolves with the child's exit code and never throws on a non-zero exit: the
 * caller decides what a failing tool means for the command as a whole. Rejects
 * only when the tool could not be spawned at all.
 */
export async function runTool(
  bin: string,
  args: string[],
  options: RunToolOptions,
): Promise<number> {
  const { code } = await spawnTool(bin, args, options, false);
  return code;
}

/**
 * Run a developer tool and hand back what it wrote to stdout.
 *
 * For tools that emit a machine-readable report a command has to reason about
 * (`fallow audit --format json`). The exit code comes back too, because a tool
 * that exits non-zero on findings still wrote the report that explains them.
 */
export function runToolCapturingStdout(
  bin: string,
  args: string[],
  options: RunToolOptions,
): Promise<{ code: number; stdout: string }> {
  return spawnTool(bin, args, options, true);
}
