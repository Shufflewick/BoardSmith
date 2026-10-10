import { mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolLogged } from './run-tool.js';
import { TEST_PROGRESS_FILE_ENV, type TestProgressEvent } from './test-progress-reporter.js';

/**
 * A `vitest run` that can always say how it ended (#429).
 *
 * vitest prints its summary as the last thing it does, so a vitest process
 * that is killed, or exits early, leaves a run with no summary and no failing
 * test named. The repo's merge gate used to refuse such runs with only "Tests
 * failed with exit code 1". Every run here therefore:
 *
 * - keeps its whole output in `output.log`, in a directory of its own under
 *   the system temp directory, while still printing it as it comes;
 * - adds `test-progress-reporter` to vitest's reporters, which records each
 *   file as it starts and finishes in `progress.jsonl` beside it;
 * - and afterwards compares the two with how the process ended.
 *
 * `testRunVerdict` turns that into the paragraph `boardsmith test` prints. A
 * passing run's directory is removed; any other run's is kept, because the
 * verdict points at its log.
 */

/** How the vitest process ended: an exit code, or the signal that ended it. */
interface VitestEnd {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** What the progress reporter recorded of a run. */
export interface TestProgress {
  /** Every file the run was to run, or undefined when vitest never listed them. */
  files: string[] | undefined;
  /** Files a worker collected. */
  started: Set<string>;
  /** Files with a result, and that result (`pass`, `fail`, `skip`, ...). */
  done: Map<string, string>;
  /** Whether vitest reached the end of the run. */
  finished: boolean;
}

/** A finished `vitest run`: how it ended and what it recorded. */
interface RecordedVitestRun extends VitestEnd {
  progress: TestProgress;
  /** The directory holding `output.log` and `progress.jsonl`. */
  recordDir: string;
  logPath: string;
}

/**
 * The reporter file, beside this module with this module's own extension: the
 * `.ts` source when this checkout runs from source, and `dist/` beside the CLI
 * bundle in an install (`VITEST_REPORTER_ENTRY` in `build-cli.ts`).
 */
function progressReporterPath(): string {
  const extension = extname(fileURLToPath(import.meta.url));
  return fileURLToPath(new URL(`./test-progress-reporter${extension}`, import.meta.url));
}

/** Reads the progress file's lines. A last line cut short by a kill is not an event. */
export function readTestProgress(text: string): TestProgress {
  const progress: TestProgress = { files: undefined, started: new Set(), done: new Map(), finished: false };
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event: TestProgressEvent;
    try {
      event = JSON.parse(line) as TestProgressEvent;
    } catch {
      continue;
    }
    switch (event.event) {
      case 'paths':
        progress.files = event.files;
        break;
      case 'started':
        progress.started.add(event.file);
        break;
      case 'done':
        progress.done.set(event.file, event.state);
        break;
      case 'finished':
        progress.finished = true;
        break;
    }
  }
  return progress;
}

/**
 * Runs `vitest run <args>` in `cwd`, printing its output as it comes and
 * recording it and the run's progress. Resolves once vitest has exited,
 * however it exited.
 */
export async function runVitestRecorded(args: string[], cwd: string): Promise<RecordedVitestRun> {
  const recordDir = mkdtempSync(join(tmpdir(), 'boardsmith-test-'));
  const logPath = join(recordDir, 'output.log');
  const progressPath = join(recordDir, 'progress.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env, [TEST_PROGRESS_FILE_ENV]: progressPath };
  // The output reaches the terminal through a pipe now; keep vitest's colours when a person is watching.
  if (process.stdout.isTTY && env.FORCE_COLOR === undefined) env.FORCE_COLOR = '1';

  const end = await runToolLogged(
    'vitest',
    ['run', '--reporter=default', `--reporter=${progressReporterPath()}`, ...args],
    { cwd, env, logPath },
  );
  const progress = readTestProgress(existsSync(progressPath) ? readFileSync(progressPath, 'utf-8') : '');
  return { ...end, progress, recordDir, logPath };
}

/** Removes a run's record. For a run with nothing to report. */
export function discardRecord(run: RecordedVitestRun): void {
  rmSync(run.recordDir, { recursive: true, force: true });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** How a verdict names files: relative to the directory the run was started in. */
type Show = (file: string) => string;

/** The lines for a run vitest did not finish: the reason, then what it left unfinished. */
function unfinishedRun(how: string, end: VitestEnd, progress: TestProgress, files: string[], show: Show): string[] {
  const running = files.filter((f) => progress.started.has(f) && !progress.done.has(f));
  const neverStarted = files.filter((f) => !progress.started.has(f)).length;
  const lines = [`vitest ${how} before it finished, so this run has no result.`];
  if (end.signal === 'SIGKILL') {
    lines.push(
      'SIGKILL comes from outside vitest: most often another process on this machine killing by name ' +
        '(`pkill -f vitest` stops every vitest run in every checkout), otherwise the system running out of memory.',
    );
  }
  if (running.length > 0) lines.push(`Still running when it stopped (${running.length}):`, ...running.map(show));
  if (neverStarted > 0) lines.push(`Never started: ${neverStarted} of ${plural(files.length, 'test file', 'test files')}.`);
  return lines;
}

/** The lines for a run vitest finished that still did not pass, or undefined when it passed. */
function finishedRun(end: VitestEnd, progress: TestProgress, files: string[], show: Show): string[] | undefined {
  const unreported = files.filter((f) => !progress.done.has(f));
  if (unreported.length > 0) {
    return [
      `vitest finished, but ${plural(unreported.length, 'test file', 'test files')} never reported a result:`,
      ...unreported.map(show),
      'A file stops without a result when the worker process running it exited, so its tests did not all run.',
    ];
  }
  const failed = files.filter((f) => progress.done.get(f) === 'fail');
  if (failed.length > 0) return [`Tests failed in ${plural(failed.length, 'file', 'files')}:`, ...failed.map(show)];
  if (end.code !== 0) {
    return [
      `Every test file passed, but vitest exited with code ${end.code}: it reported errors outside any test.`,
      'Look for "Unhandled Errors", or "Startup Error" for an error from a globalSetup file, in the output.',
    ];
  }
  return undefined;
}

/**
 * Why a run did not pass, as a paragraph that names what to look at and ends
 * with the log, or undefined when it passed: vitest finished, every file it
 * listed has a result, none failed, and it exited 0.
 */
export function testRunVerdict(
  end: VitestEnd,
  progress: TestProgress,
  where: { cwd: string; logPath: string },
): string | undefined {
  const root = existsSync(where.cwd) ? realpathSync(where.cwd) : where.cwd;
  const show: Show = (file) => `  ${relative(root, file) || file}`;
  const how = end.signal !== null ? `was stopped by ${end.signal}` : `exited with code ${end.code}`;

  let lines: string[] | undefined;
  if (progress.files === undefined) {
    lines = [
      `vitest ${how} before it started any test file, so this run has no result.`,
      'Its own error is in the output above, if it printed one.',
    ];
  } else if (!progress.finished || end.signal !== null) {
    lines = unfinishedRun(how, end, progress, progress.files, show);
  } else {
    lines = finishedRun(end, progress, progress.files, show);
  }
  return lines === undefined ? undefined : [...lines, `Full output: ${where.logPath}`].join('\n');
}
