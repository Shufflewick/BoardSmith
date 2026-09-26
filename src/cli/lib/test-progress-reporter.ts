/**
 * The vitest reporter `boardsmith test` adds to every run, so a run that ends
 * without vitest's summary can still say how far it got (#429).
 *
 * It appends one JSON line per event to the file named by
 * `BOARDSMITH_TEST_PROGRESS_FILE`, with a synchronous write, so every line it
 * wrote is on disk even when the process is killed the instant after:
 *
 * - `paths`: every test file this run will run, once, before any starts.
 * - `started`: a worker has collected a file.
 * - `done`: a file has its result (`pass`, `fail`, ...).
 * - `finished`: vitest reached the end of the run and is about to print its summary.
 *
 * `src/cli/lib/vitest-run.ts` passes it to vitest by path and reads the file
 * back. vitest loads it by path, so it is a file of its own: the CLI build
 * emits it beside `dist/cli.js` (`VITEST_REPORTER_ENTRY` in `build-cli.ts`),
 * and it imports nothing but Node, since it also runs in a game's install.
 */
import { appendFileSync } from 'node:fs';

/** The environment variable naming the file this reporter appends to. */
export const TEST_PROGRESS_FILE_ENV = 'BOARDSMITH_TEST_PROGRESS_FILE';

/** One line of the progress file. */
export type TestProgressEvent =
  | { event: 'paths'; files: string[] }
  | { event: 'started'; file: string }
  | { event: 'done'; file: string; state: string }
  | { event: 'finished' };

/** What of a vitest file task this reporter reads. */
interface FileTask {
  id: string;
  filepath: string;
  result?: { state?: string };
}

/** A task update: the task's id and its result so far. */
type TaskResultPack = [id: string, result: { state?: string } | undefined, ...rest: unknown[]];

/** A result that ends a file: anything but still queued or running. */
function isFinal(state: string | undefined): state is string {
  return state !== undefined && state !== 'run' && state !== 'queued';
}

export default class TestProgressReporter {
  private readonly path: string;
  private readonly fileById = new Map<string, string>();
  private readonly done = new Set<string>();

  constructor() {
    const path = process.env[TEST_PROGRESS_FILE_ENV];
    if (!path) {
      throw new Error(
        `The BoardSmith progress reporter needs ${TEST_PROGRESS_FILE_ENV} set to the file it writes. ` +
          'Run the tests with `boardsmith test`, which sets it.',
      );
    }
    this.path = path;
  }

  private write(event: TestProgressEvent): void {
    appendFileSync(this.path, `${JSON.stringify(event)}\n`);
  }

  private finish(file: string, state: string): void {
    if (this.done.has(file)) return;
    this.done.add(file);
    this.write({ event: 'done', file, state });
  }

  onPathsCollected(paths: string[] = []): void {
    this.write({ event: 'paths', files: paths });
  }

  onCollected(files: FileTask[] = []): void {
    for (const file of files) {
      if (this.fileById.has(file.id)) continue;
      this.fileById.set(file.id, file.filepath);
      this.write({ event: 'started', file: file.filepath });
    }
  }

  onTaskUpdate(packs: TaskResultPack[]): void {
    for (const [id, result] of packs) {
      const file = this.fileById.get(id);
      const state = result?.state;
      if (file !== undefined && isFinal(state)) this.finish(file, state);
    }
  }

  onFinished(files: FileTask[] = []): void {
    for (const file of files) {
      const state = file.result?.state;
      if (isFinal(state)) this.finish(file.filepath, state);
    }
    this.write({ event: 'finished' });
  }
}
