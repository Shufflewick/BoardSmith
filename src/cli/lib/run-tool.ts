import { createWriteStream, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

export interface RunToolOptions {
  /** Directory to run the tool in. Also where `node_modules/.bin` is looked up. */
  cwd: string;
}

/** Where the child's output goes: the terminal, stdout back to the caller, or both streams teed into a log. */
type Output = 'inherit' | 'capture' | { log: string };

/** How a tool ended: its exit code, or the signal that ended it. */
interface ToolEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
}

/**
 * Tools boardsmith itself depends on at an exact version, keyed by bin name,
 * each mapped to its entry script inside the package.
 *
 * These run from boardsmith's OWN install whatever the cwd, because their
 * output is a verdict boardsmith reasons about against committed baselines:
 * fallow's findings change between releases, so a game's own copy or a global
 * one on PATH would grade the same tree differently on every machine (#545).
 */
const BOARDSMITH_TOOLS: Readonly<Record<string, string>> = {
  fallow: 'fallow/bin/fallow',
};

/** The entry script of `bin` in boardsmith's own install, or a readable error. */
function boardsmithToolScript(bin: string, entry: string): string {
  try {
    return createRequire(import.meta.url).resolve(entry);
  } catch {
    throw new Error(
      `boardsmith depends on ${bin}, but its install has no copy of it.\n`
      + 'Reinstall boardsmith\'s dependencies with: npm install',
    );
  }
}

/**
 * The command and arguments that run `bin` for a workspace at `cwd`: the one
 * resolution every spawn of a developer tool goes through, exported so a test
 * that must run the same binary as `boardsmith audit` can.
 */
export function toolCommand(bin: string, args: string[], cwd: string): { command: string; commandArgs: string[] } {
  const entry = BOARDSMITH_TOOLS[bin];
  if (entry !== undefined) {
    // Resolved from this module, so it is the copy boardsmith's package.json
    // pins, and run with this Node, so no shell or PATH lookup is involved.
    return { command: process.execPath, commandArgs: [boardsmithToolScript(bin, entry), ...args] };
  }
  const localBin = join(cwd, 'node_modules', '.bin', bin);
  return existsSync(localBin)
    ? { command: localBin, commandArgs: args }
    : { command: 'npx', commandArgs: [bin, ...args] };
}

/**
 * The fallow command a report tells a developer to run from `cwd`, naming the
 * same pinned copy `boardsmith audit` runs. `npx fallow` would not: outside
 * this repository it finds a global fallow or fetches the latest one.
 */
export function fallowCommandLine(args: string[], cwd: string): string {
  const script = boardsmithToolScript('fallow', BOARDSMITH_TOOLS.fallow);
  return ['node', relative(cwd, script), ...args].join(' ');
}

/**
 * Spawn a developer tool the same way for every BoardSmith workspace, so
 * `boardsmith <command>` is the single way to invoke it.
 *
 * A tool boardsmith depends on (`BOARDSMITH_TOOLS`) runs from boardsmith's own
 * install. Any other tool prefers the workspace's own `node_modules/.bin/<bin>`
 * so a declared devDependency is always what runs, and falls back to `npx` when
 * the workspace has none.
 *
 * `output` decides where the child's output goes: inherited (the developer
 * reads it), stdout piped back to the caller (a command reasons about it), or
 * both streams passed through AND kept in a log (a run that must be explained
 * afterwards).
 */
function spawnTool(
  bin: string,
  args: string[],
  options: RunToolOptions & { env?: NodeJS.ProcessEnv },
  output: Output,
): Promise<ToolEnd> {
  const { command, commandArgs } = toolCommand(bin, args, options.cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      // stderr stays inherited when only stdout is captured: progress and
      // warnings belong on the developer's terminal, not in the parsed value.
      stdio: output === 'inherit' ? 'inherit' : output === 'capture' ? ['inherit', 'pipe', 'inherit'] : ['inherit', 'pipe', 'pipe'],
      // On Windows both `npx` and the `.bin` shims are batch files, which
      // `spawn` cannot execute without a shell; Node itself needs none. Everywhere else, running
      // without a shell keeps glob arguments (e.g. 'src/**/*.vue') intact so
      // the tool does its own matching rather than the shell doing it first.
      shell: process.platform === 'win32' && command !== process.execPath,
    });

    // Buffered whole and decoded ONCE at the end. A chunk boundary can fall
    // inside a multi-byte UTF-8 character, and decoding each chunk on its own
    // replaces the halves with U+FFFD -- so the captured text stops being what
    // the tool printed. `boardsmith audit --dupes-baseline` hashes the source
    // text `fallow dupes` reports, so one mangled character silently changed an
    // accepted clone group's key (#241).
    const stdoutChunks: Buffer[] = [];
    const logged = typeof output === 'object' ? teeIntoLog(child, output.log) : undefined;
    if (output === 'capture') {
      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }

    child.on('error', (error) => {
      reject(
        new Error(
          `Could not run ${bin}: ${error.message}\n`
          + `Install it in this project with: npm install -D ${bin}`,
        ),
      );
    });

    child.on('close', (code, signal) => {
      const end = { code, signal, stdout: Buffer.concat(stdoutChunks).toString('utf-8') };
      if (logged === undefined) resolve(end);
      else logged.end(() => resolve(end));
    });
  });
}

/**
 * Passes the child's stdout and stderr through to this process's own, and
 * appends both, as they arrive, to the file at `logPath`.
 */
function teeIntoLog(child: ChildProcess, logPath: string): ReturnType<typeof createWriteStream> {
  const log = createWriteStream(logPath, { flags: 'a' });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    log.write(chunk);
  });
  return log;
}

/** A tool killed by a signal produced no verdict: that is a failure, not the `null` exit code read as success. */
function exitCodeOf(end: ToolEnd): number {
  return end.signal ? 1 : end.code ?? 1;
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
  return exitCodeOf(await spawnTool(bin, args, options, 'inherit'));
}

/**
 * Run a developer tool and hand back what it wrote to stdout.
 *
 * For tools that emit a machine-readable report a command has to reason about
 * (`fallow audit --format json`). The exit code comes back too, because a tool
 * that exits non-zero on findings still wrote the report that explains them.
 */
export async function runToolCapturingStdout(
  bin: string,
  args: string[],
  options: RunToolOptions,
): Promise<{ code: number; stdout: string }> {
  const end = await spawnTool(bin, args, options, 'capture');
  return { code: exitCodeOf(end), stdout: end.stdout };
}

/**
 * Run a developer tool with its output on the developer's terminal AND in the
 * file at `logPath`, and resolve with how it ended: its exit code, or the
 * signal that stopped it, which the other two runners fold into a code.
 *
 * For a run whose failure has to be explained after the fact (`boardsmith
 * test`, #429): the log survives the terminal, and the signal is the reason.
 */
export async function runToolLogged(
  bin: string,
  args: string[],
  options: RunToolOptions & { env: NodeJS.ProcessEnv; logPath: string },
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const { code, signal } = await spawnTool(bin, args, options, { log: options.logPath });
  return { code, signal };
}
