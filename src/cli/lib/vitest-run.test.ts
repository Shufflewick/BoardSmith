import { describe, it, expect } from 'vitest';
import { readTestProgress, testRunVerdict, type TestProgress } from './vitest-run.js';
import type { TestProgressEvent } from './test-progress-reporter.js';

/**
 * How `boardsmith test` words the end of a run (#429). The run itself, with a
 * real vitest and a real kill, is driven in `src/cli/commands/test.test.ts`;
 * these pin every branch of the wording, including the ones a real run
 * reaches only by accident.
 */

const CWD = '/work/game';
const LOG = '/tmp/boardsmith-test-x/output.log';

function progress(...events: TestProgressEvent[]): TestProgress {
  return readTestProgress(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const paths = (...files: string[]): TestProgressEvent => ({ event: 'paths', files: files.map((f) => `${CWD}/${f}`) });
const started = (file: string): TestProgressEvent => ({ event: 'started', file: `${CWD}/${file}` });
const done = (file: string, state = 'pass'): TestProgressEvent => ({ event: 'done', file: `${CWD}/${file}`, state });
const finished: TestProgressEvent = { event: 'finished' };

function verdict(end: { code: number | null; signal: NodeJS.Signals | null }, record: TestProgress): string | undefined {
  return testRunVerdict(end, record, { cwd: CWD, logPath: LOG });
}

describe('readTestProgress', () => {
  it('reads every event, and a last line cut off by a kill is not an event', () => {
    const text = [
      JSON.stringify(paths('a.test.ts', 'b.test.ts')),
      JSON.stringify(started('a.test.ts')),
      JSON.stringify(done('a.test.ts', 'fail')),
      '{"event":"sta',
    ].join('\n');

    const read = readTestProgress(text);

    expect(read.files).toEqual([`${CWD}/a.test.ts`, `${CWD}/b.test.ts`]);
    expect([...read.started]).toEqual([`${CWD}/a.test.ts`]);
    expect([...read.done]).toEqual([[`${CWD}/a.test.ts`, 'fail']]);
    expect(read.finished).toBe(false);
  });

  it('reads an empty file as a run that never started', () => {
    expect(readTestProgress('')).toEqual({ files: undefined, started: new Set(), done: new Map(), finished: false });
  });
});

describe('testRunVerdict', () => {
  it('has nothing to say about a run that finished, passed and exited 0', () => {
    const record = progress(paths('a.test.ts'), started('a.test.ts'), done('a.test.ts'), finished);
    expect(verdict({ code: 0, signal: null }, record)).toBeUndefined();
  });

  it('names the signal, the files still running, how many never started, and the log', () => {
    const record = progress(
      paths('a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'),
      started('a.test.ts'),
      started('b.test.ts'),
      done('a.test.ts'),
      started('c.test.ts'),
    );

    const text = verdict({ code: null, signal: 'SIGKILL' }, record);

    expect(text).toContain('vitest was stopped by SIGKILL before it finished, so this run has no result.');
    expect(text).toContain('`pkill -f vitest` stops every vitest run in every checkout');
    expect(text).toContain('Still running when it stopped (2):\n  b.test.ts\n  c.test.ts');
    expect(text).toContain('Never started: 1 of 4 test files.');
    expect(text).toContain(`Full output: ${LOG}`);
  });

  it('names an exit code that came before the end of the run', () => {
    const record = progress(paths('a.test.ts', 'b.test.ts'), started('a.test.ts'));

    const text = verdict({ code: 1, signal: null }, record);

    expect(text).toContain('vitest exited with code 1 before it finished, so this run has no result.');
    expect(text).toContain('Still running when it stopped (1):\n  a.test.ts');
    expect(text).toContain('Never started: 1 of 2 test files.');
  });

  it('never passes a run that exited 0 without finishing', () => {
    const record = progress(paths('a.test.ts'), started('a.test.ts'));
    expect(verdict({ code: 0, signal: null }, record)).toContain(
      'vitest exited with code 0 before it finished, so this run has no result.',
    );
  });

  it('says vitest ended before it started any file when there is no file list at all', () => {
    const text = verdict({ code: 1, signal: null }, progress());

    expect(text).toContain('vitest exited with code 1 before it started any test file, so this run has no result.');
    expect(text).toContain('Its own error is in the output above');
    expect(text).toContain(`Full output: ${LOG}`);
  });

  it('names the files that never reported when vitest finished without them', () => {
    const record = progress(
      paths('a.test.ts', 'b.test.ts', 'c.test.ts'),
      started('a.test.ts'),
      started('b.test.ts'),
      done('b.test.ts'),
      started('c.test.ts'),
      done('c.test.ts'),
      finished,
    );

    const text = verdict({ code: 1, signal: null }, record);

    expect(text).toContain('vitest finished, but 1 test file never reported a result:\n  a.test.ts');
    expect(text).toContain('the worker process running it exited');
  });

  it('names the failing files of an ordinary failure', () => {
    const record = progress(
      paths('a.test.ts', 'b.test.ts'),
      started('a.test.ts'),
      done('a.test.ts', 'fail'),
      started('b.test.ts'),
      done('b.test.ts'),
      finished,
    );

    const text = verdict({ code: 1, signal: null }, record);

    expect(text).toContain('Tests failed in 1 file:\n  a.test.ts');
    expect(text).toContain(`Full output: ${LOG}`);
  });

  it('points at the unhandled errors when every file passed but vitest still failed the run', () => {
    const record = progress(paths('a.test.ts'), started('a.test.ts'), done('a.test.ts'), finished);

    const text = verdict({ code: 1, signal: null }, record);
    expect(text).toContain('Every test file passed, but vitest exited with code 1: it reported errors outside any test');
    // A globalSetup teardown's error, such as the untracked-file guard's (#579), is printed under
    // "Startup Error" even though it comes after the run.
    expect(text).toContain('Look for "Unhandled Errors", or "Startup Error" for an error from a globalSetup file,');
  });
});
