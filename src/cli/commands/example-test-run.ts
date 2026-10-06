import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { runToolCapturingStdout } from '../lib/run-tool.js';
import {
  chunkDescribeTitle,
  renderChunkExampleTests,
  type ChunkExampleTests,
} from './example-test-emit.js';
import {
  createExampleReplayRecord,
  recordExampleReplayVerdicts,
  type ExampleReplayRecord,
} from './verify-example-replay.js';

/**
 * `example-test-run.ts` — where a worked example's `agrees`/`disagrees` verdict comes from (#319).
 *
 * The translator only writes a test and offers a `verdictHint`, which is a guess. The verdict of
 * record is what happens when that test runs against the real game, so this command runs the
 * chunk's emitted example-test file with the project's own vitest and records, for each
 * translated example, `agrees` when its test passed and `disagrees` when it failed — with the
 * failure as the observed outcome. It is the only place either verdict is written.
 */

interface VerifyExampleRunOptions {
  project?: string;
  chunk?: string;
  json?: boolean;
}

interface VerifyExampleRunResult {
  chunk: string;
  relTestFilePath: string;
  /** The records this run wrote: one `agrees`/`disagrees` per translated example. */
  records: ExampleReplayRecord[];
}

/** The parts of vitest's JSON report this command reads. */
interface VitestJsonReport {
  testResults: {
    name: string;
    message?: string;
    assertionResults: {
      ancestorTitles: string[];
      title: string;
      status: string;
      failureMessages: string[];
    }[];
  }[];
}

/**
 * Runs one test file with the project's vitest and returns its JSON report. Not
 * `runVitestRecorded` (lib/vitest-run.ts), which prints the run for a person: this command reads
 * each test's result from vitest's JSON reporter instead.
 */
async function runVitestReport(projectDir: string, relTestFilePath: string): Promise<VitestJsonReport> {
  const outDir = await fs.mkdtemp(join(tmpdir(), 'boardsmith-example-run-'));
  const outFile = join(outDir, 'report.json');
  try {
    // The exit code is not the verdict: vitest exits non-zero whenever a test fails, and a
    // failing test is a `disagrees`, not a tool failure. The report says what happened.
    await runToolCapturingStdout(
      'vitest',
      ['run', relTestFilePath, '--reporter=json', `--outputFile=${outFile}`],
      { cwd: projectDir },
    );
    let text: string;
    try {
      text = await fs.readFile(outFile, 'utf-8');
    } catch {
      throw new Error(
        `vitest wrote no report for ${relTestFilePath}.\n` +
          `Run \`boardsmith test ${relTestFilePath}\` in the project to see why — usually the ` +
          `project's vitest config does not include tests/examples/.`,
      );
    }
    return JSON.parse(text) as VitestJsonReport;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
}

/** vitest's failure text up to its stack trace, without colour codes. */
function failureSummary(messages: readonly string[]): string {
  const text = messages.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
  const lines = text.split('\n');
  const stackStart = lines.findIndex((line) => /^\s+at\s/.test(line));
  const summary = (stackStart === -1 ? lines : lines.slice(0, stackStart)).join('\n').trim();
  return summary.length > 0 ? summary : 'The test failed without a message.';
}

/** The emitted file's results, found by path (vitest reports the file's real path). */
async function fileResultFor(
  report: VitestJsonReport,
  tests: ChunkExampleTests,
): Promise<VitestJsonReport['testResults'][number]> {
  // Real path on both sides: under a symlinked directory (macOS's /var -> /private/var, for one)
  // the path we composed and the one vitest reports differ.
  const realTestFilePath = await fs.realpath(tests.testFilePath);
  const fileResult = report.testResults.find((r) => resolve(r.name) === realTestFilePath);
  if (!fileResult) {
    throw new Error(
      `vitest did not run ${tests.relTestFilePath}.\n` +
        `Check that the project's vitest config includes tests/examples/, then run this again.`,
    );
  }
  return fileResult;
}

/**
 * One translated example's verdict from its tests' results: `agrees` when every one passed,
 * `disagrees` (with the failure as the observed outcome) when any failed. Throws when none ran
 * or one was skipped, because then nothing was observed.
 */
function observeExample(
  record: ChunkExampleTests['executable'][number],
  fileResult: VitestJsonReport['testResults'][number],
  chunkTitle: string,
  relTestFilePath: string,
): ExampleReplayRecord {
  const results = fileResult.assertionResults.filter(
    (a) => a.ancestorTitles[0] === chunkTitle && a.ancestorTitles[1] === record.exampleId,
  );
  const where = `${record.slicePath}:${record.lineNumber}`;
  if (results.length === 0) {
    throw new Error(
      `The test for the worked example at ${where} did not run.\n` +
        `${fileResult.message ? `vitest said: ${fileResult.message}\n` : ''}` +
        `Fix the translated test (re-dispatch the translator and record its return again), ` +
        `emit, and run this again. Nothing was recorded.`,
    );
  }
  const notRun = results.find((a) => a.status !== 'passed' && a.status !== 'failed');
  if (notRun) {
    throw new Error(
      `The test "${notRun.title}" for the worked example at ${where} was ${notRun.status}, so ` +
        `it observed nothing.\nA worked-example test must run. Re-dispatch the translator and ` +
        `record its return again. Nothing was recorded.`,
    );
  }
  const failed = results.filter((a) => a.status === 'failed');
  const observed = {
    exampleId: record.exampleId,
    slicePath: record.slicePath,
    lineNumber: record.lineNumber,
    lineText: record.lineText,
    kind: record.kind,
    expected: record.expected,
    supportingQuoteLines: [...record.supportingQuoteLines],
    provenance: record.provenance,
    testFilePath: relTestFilePath,
    translation: record.translation,
  };
  if (failed.length === 0) {
    return createExampleReplayRecord({
      ...observed,
      verdict: 'agrees',
      reason: 'The emitted test passed against the game.',
    });
  }
  return createExampleReplayRecord({
    ...observed,
    verdict: 'disagrees',
    reason: 'The emitted test failed against the game.',
    observed: failureSummary(failed.flatMap((a) => a.failureMessages)),
  });
}

function printRunResult(result: VerifyExampleRunResult): void {
  if (result.records.length === 0) {
    console.log(chalk.green(`✓ ${result.relTestFilePath} has no translated examples to run.`));
    return;
  }
  const disagrees = result.records.filter((r) => r.verdict === 'disagrees');
  console.log(
    chalk.green(
      `✓ Ran ${result.relTestFilePath}: ${result.records.length - disagrees.length} agree, ` +
        `${disagrees.length} disagree.`,
    ),
  );
  for (const record of disagrees) {
    console.log(chalk.yellow(`  ⚠ ${record.slicePath}:${record.lineNumber} — ${record.observed}`));
  }
}

/**
 * `boardsmith verify-example-run` — runs `--chunk`'s emitted example-test file and records the
 * observed verdict of every translated example in it.
 *
 * Refuses to run unless the file on disk is exactly what `verify-example-emit` would write from
 * the ledger now, so the verdict it records is about the test the ledger holds. Every translated
 * example must have run: a test that was skipped, or a file that failed to load, is a tool
 * failure with the reason, never a verdict. Nothing is written until every example has one.
 */
export async function verifyExampleRunCommand(
  options: VerifyExampleRunOptions = {},
): Promise<VerifyExampleRunResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  if (!options.chunk) {
    throw new Error('verify-example-run requires --chunk <slug>.');
  }
  const chunk = options.chunk;
  const tests = await renderChunkExampleTests(projectDir, chunk);

  const onDisk = await fs.readFile(tests.testFilePath, 'utf-8').catch(() => null);
  if (onDisk !== tests.fileText) {
    throw new Error(
      `${tests.relTestFilePath} is ${onDisk === null ? 'missing' : 'out of date with the ledger'}.\n` +
        `Run \`boardsmith verify-example-emit --chunk ${chunk}\` first, then run this again.`,
    );
  }

  const result: VerifyExampleRunResult = { chunk, relTestFilePath: tests.relTestFilePath, records: [] };
  if (tests.executable.length > 0) {
    const report = await runVitestReport(projectDir, tests.relTestFilePath);
    const fileResult = await fileResultFor(report, tests);
    const chunkTitle = chunkDescribeTitle(chunk);
    result.records = tests.executable.map((record) =>
      observeExample(record, fileResult, chunkTitle, tests.relTestFilePath),
    );
    await recordExampleReplayVerdicts(projectDir, result.records);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printRunResult(result);
  }
  return result;
}
