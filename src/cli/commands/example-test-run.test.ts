import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from '../lib/project-paths.js';
import { verifyExampleEmitCommand } from './example-test-emit.js';
import { verifyExampleRunCommand } from './example-test-run.js';
import {
  createExampleReplayRecord,
  readExampleReplayVerdicts,
  recordExampleReplayVerdicts,
} from './verify-example-replay.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

const SLICE_PATH = 'rulebook/02-punch.md';
const SLICE_TEXT =
  'p.2, Punch Examples:\n' +
  '"If you are punched while READY, you become EXHAUSTED."\n' +
  '"If you are punched while EXHAUSTED, you stay EXHAUSTED."\n';

/**
 * A chunk citing SLICE_PATH in a project that resolves 'vitest' the way a generated game does
 * (the checkout's install, symlinked in as its node_modules).
 */
async function mkProject(dir: string): Promise<string> {
  const project = join(dir, 'project');
  await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
  await fs.writeFile(join(project, DESIGN_DIR, SLICE_PATH), SLICE_TEXT);
  await fs.mkdir(join(project, DESIGN_DIR, 'chunks', 'punch'), { recursive: true });
  await fs.writeFile(
    join(project, DESIGN_DIR, 'chunks', 'punch', 'CHUNK.md'),
    `# punch\n\n## Verified Against\n\nCites ${SLICE_PATH}.\n`,
  );
  await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  return project;
}

/** A not-run record, as verify-example-record writes one, whose stored test is `testCode`. */
function notRunRecord(lineNumber: number, testCode: string, provenance = 'quote-verified') {
  return createExampleReplayRecord({
    exampleId: `${SLICE_PATH}:${lineNumber}`,
    slicePath: SLICE_PATH,
    lineNumber,
    lineText: SLICE_TEXT.split('\n')[lineNumber - 1],
    kind: 'transition',
    verdict: 'not-run',
    reason: 'Translated into a test that has not been run yet.',
    expected: 'The Guard ends EXHAUSTED.',
    supportingQuoteLines: ['"If you are punched while READY, you become EXHAUSTED."'],
    provenance,
    translation: {
      pageCitation: 'p.2, Punch Examples',
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      testCode,
      imports: [],
    },
  });
}

/** `verify-example-run --chunk punch` refuses with `message`, and every example stays not-run. */
async function expectRunRefused(project: string, message: RegExp): Promise<void> {
  await expect(verifyExampleRunCommand({ project, chunk: 'punch' })).rejects.toThrow(message);
  for (const record of await readExampleReplayVerdicts(project)) {
    expect(record.verdict).toBe('not-run');
  }
}

const PASSING = "it('ends EXHAUSTED', () => {\n  expect('EXHAUSTED').toBe('EXHAUSTED');\n});";
const FAILING = "it('ends EXHAUSTED', () => {\n  expect('READY').toBe('EXHAUSTED');\n});";

describe('verifyExampleRunCommand', () => {
  let dir: string;
  let project: string;

  beforeEach(async () => {
    dir = tempTree('bs-example-run-');
    project = await mkProject(dir);
  });

  it('requires --chunk', async () => {
    await expect(verifyExampleRunCommand({ project })).rejects.toThrow('--chunk');
  });

  it('records agrees for a passing test and disagrees, with the failure observed, for a failing one', async () => {
    await recordExampleReplayVerdicts(project, [
      notRunRecord(2, PASSING),
      notRunRecord(3, FAILING, 'quote-unverified'),
    ]);
    await verifyExampleEmitCommand({ project, chunk: 'punch' });

    const result = await verifyExampleRunCommand({ project, chunk: 'punch' });
    expect(result.records.map((r) => [r.lineNumber, r.verdict])).toEqual([
      [2, 'agrees'],
      [3, 'disagrees'],
    ]);

    const byLine = new Map(
      (await readExampleReplayVerdicts(project)).map((r) => [r.lineNumber, r]),
    );
    const disagrees = byLine.get(3)!;
    expect(disagrees.expected).toBe('The Guard ends EXHAUSTED.');
    expect(disagrees.observed).toContain("expected 'READY' to be 'EXHAUSTED'");
    expect(disagrees.observed).not.toMatch(/\bat\s.*:\d+:\d+/); // no stack trace
    // Everything the record step decided survives the run.
    expect(disagrees.provenance).toBe('quote-unverified');
    expect(disagrees.translation?.testCode).toBe(FAILING);
    expect(disagrees.testFilePath).toBe('tests/examples/punch.examples.test.ts');
    expect(byLine.get(2)!.provenance).toBe('quote-verified');

    // The file emit writes from the ledger is unchanged by the run, so a re-run needs no re-emit.
    const again = await verifyExampleRunCommand({ project, chunk: 'punch' });
    expect(again.records.map((r) => r.verdict)).toEqual(['agrees', 'disagrees']);
  }, 60_000);

  it('refuses to run before the file is emitted, naming the command to run first', async () => {
    await recordExampleReplayVerdicts(project, [notRunRecord(2, PASSING)]);
    await expectRunRefused(project, /missing.*boardsmith verify-example-emit --chunk punch/s);
  });

  it('refuses to run a file that no longer matches the ledger, writing nothing', async () => {
    await recordExampleReplayVerdicts(project, [notRunRecord(2, PASSING)]);
    await verifyExampleEmitCommand({ project, chunk: 'punch' });
    await recordExampleReplayVerdicts(project, [notRunRecord(2, FAILING)]);

    await expectRunRefused(project, /out of date with the ledger/);
  });

  it('a skipped test observed nothing: it is refused, and nothing is recorded', async () => {
    await recordExampleReplayVerdicts(project, [
      notRunRecord(2, PASSING),
      notRunRecord(3, "it.skip('ends EXHAUSTED', () => {\n  expect(1).toBe(1);\n});"),
    ]);
    await verifyExampleEmitCommand({ project, chunk: 'punch' });

    await expectRunRefused(project, /rulebook\/02-punch\.md:3 was skipped/);
  }, 60_000);

  it('a file that fails to load is refused with what vitest said, and nothing is recorded', async () => {
    const usesMissingModule = "it('ends EXHAUSTED', () => {\n  expect(punch()).toBe('EXHAUSTED');\n});";
    await recordExampleReplayVerdicts(project, [
      createExampleReplayRecord({
        ...notRunRecord(2, usesMissingModule),
        supportingQuoteLines: [],
        translation: {
          pageCitation: 'p.2, Punch Examples',
          sourceText: 'If you are punched while READY, you become EXHAUSTED.',
          testCode: usesMissingModule,
          imports: ["import { punch } from '../../src/rules/missing.js';"],
        },
      }),
    ]);
    await verifyExampleEmitCommand({ project, chunk: 'punch' });

    await expectRunRefused(project, /rulebook\/02-punch\.md:2 did not run.*vitest said:.*missing/s);
  }, 60_000);

  it('a chunk with no translated examples has nothing to run and records nothing', async () => {
    await verifyExampleEmitCommand({ project, chunk: 'punch' });
    const result = await verifyExampleRunCommand({ project, chunk: 'punch' });
    expect(result.records).toEqual([]);
    expect(await readExampleReplayVerdicts(project)).toEqual([]);
  });
});
