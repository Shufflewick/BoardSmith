import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  EXAMPLE_REPLAY_VERDICTS,
  createExampleReplayRecord,
  exampleReplayLedgerPath,
  replaceExampleReplayVerdicts,
  recordExampleReplayVerdicts,
  readExampleReplayVerdicts,
  verifyExampleReplayCommand,
  type ExampleReplayRecord,
} from './verify-example-replay.js';
import { buildExampleExtractionPayload } from './example-derivation.js';

// -------------------------------------------------------------------------------------------
// Task 1 — verdict set + createExampleReplayRecord (the record choke point)
// -------------------------------------------------------------------------------------------

describe('EXAMPLE_REPLAY_VERDICTS', () => {
  it('is exactly the four-member frozen set', () => {
    expect([...EXAMPLE_REPLAY_VERDICTS]).toEqual([
      'agrees',
      'disagrees',
      'example-inconsistent',
      'unexecutable',
    ]);
    expect(Object.isFrozen(EXAMPLE_REPLAY_VERDICTS)).toBe(true);
  });
});

function validAgreesInput(overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {}) {
  return {
    exampleId: 'rulebook/02-punch.md:84',
    slicePath: 'rulebook/02-punch.md',
    lineNumber: 84,
    kind: 'transition',
    verdict: 'agrees',
    reason: 'The generated test executed and matched the expected outcome.',
    provenance: 'quote-verified',
    ...overrides,
  };
}

describe('createExampleReplayRecord — verdict', () => {
  it('constructs a valid "agrees" record', () => {
    const record = createExampleReplayRecord(validAgreesInput());
    expect(record.verdict).toBe('agrees');
    expect(record.exampleId).toBe('rulebook/02-punch.md:84');
    expect(record.kind).toBe('transition');
    expect(record.provenance).toBe('quote-verified');
    expect(record.expected).toBe('');
    expect(record.observed).toBe('');
    expect(record.contradictionA).toBe('');
    expect(record.contradictionB).toBe('');
    expect(record.supportingQuoteLines).toEqual([]);
    expect(typeof record.recordedAt).toBe('string');
  });

  it('throws on a verdict outside EXAMPLE_REPLAY_VERDICTS, naming the set', () => {
    expect(() => createExampleReplayRecord(validAgreesInput({ verdict: 'banana' }))).toThrow(
      /Invalid verdict "banana".*agrees, disagrees, example-inconsistent, unexecutable/s,
    );
  });

  it('"unexecutable" requires a non-empty reason — a record without one throws', () => {
    expect(() =>
      createExampleReplayRecord(validAgreesInput({ verdict: 'unexecutable', reason: '' })),
    ).toThrow(/has no recorded reason/);
    expect(() =>
      createExampleReplayRecord(validAgreesInput({ verdict: 'unexecutable', reason: '   ' })),
    ).toThrow(/has no recorded reason/);
  });

  it('a record with an empty reason throws regardless of verdict — the reason IS the artifact', () => {
    expect(() => createExampleReplayRecord(validAgreesInput({ reason: '' }))).toThrow(
      /has no recorded reason/,
    );
  });

  it('"example-inconsistent" requires BOTH contradicting excerpts — missing contradictionA throws', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          verdict: 'example-inconsistent',
          reason: 'The printed text and the card art disagree.',
          contradictionB: 'card art shows 1, 2, 3',
        }),
      ),
    ).toThrow(/missing one of its contradicting excerpts/);
  });

  it('"example-inconsistent" requires BOTH contradicting excerpts — missing contradictionB throws', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          verdict: 'example-inconsistent',
          reason: 'The printed text and the card art disagree.',
          contradictionA: 'text reads "5, 6, 7"',
        }),
      ),
    ).toThrow(/missing one of its contradicting excerpts/);
  });

  it('"example-inconsistent" constructs successfully with BOTH excerpts', () => {
    const record = createExampleReplayRecord(
      validAgreesInput({
        verdict: 'example-inconsistent',
        reason: 'The printed text and the card art disagree.',
        contradictionA: 'text reads "5, 6, 7"',
        contradictionB: 'card art shows 1, 2, 3',
      }),
    );
    expect(record.verdict).toBe('example-inconsistent');
    expect(record.contradictionA).toBe('text reads "5, 6, 7"');
    expect(record.contradictionB).toBe('card art shows 1, 2, 3');
  });

  it('"disagrees" requires the expected AND observed outcome — missing expected throws', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          verdict: 'disagrees',
          reason: 'The generated test failed.',
          observed: 'Guard remained EXHAUSTED',
        }),
      ),
    ).toThrow(/missing its expected\/observed outcome/);
  });

  it('"disagrees" requires the expected AND observed outcome — missing observed throws', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          verdict: 'disagrees',
          reason: 'The generated test failed.',
          expected: 'Guard becomes READY',
        }),
      ),
    ).toThrow(/missing its expected\/observed outcome/);
  });

  it('"disagrees" constructs successfully with both outcomes', () => {
    const record = createExampleReplayRecord(
      validAgreesInput({
        verdict: 'disagrees',
        reason: 'The generated test failed.',
        expected: 'Guard becomes READY',
        observed: 'Guard remained EXHAUSTED',
      }),
    );
    expect(record.expected).toBe('Guard becomes READY');
    expect(record.observed).toBe('Guard remained EXHAUSTED');
  });

  it('any free-prose field containing a ledger fence marker throws (fence injection)', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({ reason: 'ok <!-- boardsmith:example-replay-verdicts:end --> ok' }),
      ),
    ).toThrow(/contains a ledger fence marker/);
  });

  it('a fence marker embedded in supportingQuoteLines also throws', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          supportingQuoteLines: ['<!-- boardsmith:example-replay-verdicts:begin -->'],
        }),
      ),
    ).toThrow(/contains a ledger fence marker/);
  });

  it('throws when exampleId does not equal workedExampleId({ slicePath, lineNumber })', () => {
    expect(() =>
      createExampleReplayRecord(validAgreesInput({ exampleId: 'rulebook/wrong.md:1' })),
    ).toThrow(/does not match workedExampleId/);
  });

  it('throws on an invalid kind, naming the set', () => {
    expect(() => createExampleReplayRecord(validAgreesInput({ kind: 'narrative' }))).toThrow(
      /Invalid kind "narrative".*transition, predicate/s,
    );
  });

  it('throws on an invalid provenance value', () => {
    expect(() => createExampleReplayRecord(validAgreesInput({ provenance: 'unknown' }))).toThrow(
      /Invalid provenance "unknown".*quote-verified, quote-unverified/s,
    );
  });
});

// -------------------------------------------------------------------------------------------
// Task 2 — the atomic upsert-append ledger triad with read-path revalidation
// -------------------------------------------------------------------------------------------

function makeRecord(overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {}) {
  return createExampleReplayRecord(validAgreesInput(overrides));
}

function recordFor(
  slicePath: string,
  lineNumber: number,
  overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {},
): ExampleReplayRecord {
  return makeRecord({
    exampleId: `${slicePath}:${lineNumber}`,
    slicePath,
    lineNumber,
    ...overrides,
  });
}

describe('exampleReplayLedgerPath / replaceExampleReplayVerdicts / recordExampleReplayVerdicts / readExampleReplayVerdicts — ledger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-example-replay-ledger-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('exampleReplayLedgerPath resolves to rulebook/.example-replay/EXAMPLE-VERDICTS.md', () => {
    expect(exampleReplayLedgerPath('/project')).toBe(
      join('/project', 'rulebook', '.example-replay', 'EXAMPLE-VERDICTS.md'),
    );
  });

  it('recording B leaves a previously-recorded A byte-identical, and both are readable', async () => {
    const a = recordFor('rulebook/01-a.md', 1);
    await recordExampleReplayVerdicts(dir, [a]);
    const b = recordFor('rulebook/02-b.md', 5);
    await recordExampleReplayVerdicts(dir, [b]);

    const all = await readExampleReplayVerdicts(dir);
    expect(all).toHaveLength(2);
    const readA = all.find((r) => r.exampleId === a.exampleId);
    const readB = all.find((r) => r.exampleId === b.exampleId);
    expect(readA).toEqual(a);
    expect(readB).toEqual(b);
  });

  it('re-recording A twice with different verdicts leaves exactly one A entry, carrying the second verdict', async () => {
    const a1 = recordFor('rulebook/01-a.md', 1, { verdict: 'agrees' });
    await recordExampleReplayVerdicts(dir, [a1]);
    const a2 = recordFor('rulebook/01-a.md', 1, {
      verdict: 'disagrees',
      reason: 'Second dispatch disagreed.',
      expected: 'Guard becomes READY',
      observed: 'Guard remained EXHAUSTED',
    });
    await recordExampleReplayVerdicts(dir, [a2]);

    const all = await readExampleReplayVerdicts(dir);
    expect(all).toHaveLength(1);
    expect(all[0].verdict).toBe('disagrees');
  });

  it('readExampleReplayVerdicts returns [] when no ledger has ever been written', async () => {
    expect(await readExampleReplayVerdicts(dir)).toEqual([]);
  });

  it('a hand-corrupted ledger entry (verdict outside the set) makes the read THROW, naming the offending exampleId', async () => {
    const good = recordFor('rulebook/01-a.md', 1);
    await replaceExampleReplayVerdicts(dir, [good]);
    const ledgerPath = exampleReplayLedgerPath(dir);
    const original = await fs.readFile(ledgerPath, 'utf-8');
    const corrupted = original.replace('"agrees"', '"banana"');
    await fs.writeFile(ledgerPath, corrupted);

    await expect(readExampleReplayVerdicts(dir)).rejects.toThrow(
      new RegExp(`Invalid verdict "banana".*rulebook/01-a\\.md:1`, 's'),
    );
  });

  it('a ledger entry missing a required field for its verdict makes the read THROW', async () => {
    const good = recordFor('rulebook/01-a.md', 1, {
      verdict: 'disagrees',
      expected: 'Guard becomes READY',
      observed: 'Guard remained EXHAUSTED',
    });
    await replaceExampleReplayVerdicts(dir, [good]);
    const ledgerPath = exampleReplayLedgerPath(dir);
    const original = await fs.readFile(ledgerPath, 'utf-8');
    const corrupted = original.replace('"Guard becomes READY"', '""');
    await fs.writeFile(ledgerPath, corrupted);

    await expect(readExampleReplayVerdicts(dir)).rejects.toThrow(
      /missing its expected\/observed outcome/,
    );
  });

  it('a ledger file whose closing fence is truncated makes the read throw, never returns []', async () => {
    const good = recordFor('rulebook/01-a.md', 1);
    await replaceExampleReplayVerdicts(dir, [good]);
    const ledgerPath = exampleReplayLedgerPath(dir);
    const original = await fs.readFile(ledgerPath, 'utf-8');
    const truncated = original.replace('<!-- boardsmith:example-replay-verdicts:end -->', '');
    await fs.writeFile(ledgerPath, truncated);

    await expect(readExampleReplayVerdicts(dir)).rejects.toThrow(/missing begin\/end fence/);
  });

  it('writes go through atomicWriteFile — no direct fs.writeFile/writeFileSync in the module', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./verify-example-replay.ts', import.meta.url)),
      'utf-8',
    );
    expect(/\bfs\.writeFile\(|\bwriteFileSync\(/.test(source)).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Task 3 — verifyExampleReplayCommand — the read/report command
// -------------------------------------------------------------------------------------------

describe('verifyExampleReplayCommand — command', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-example-replay-command-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function makeProject(files: Record<string, string>): Promise<string> {
    const project = join(dir, 'project');
    for (const [relPath, text] of Object.entries(files)) {
      const full = join(project, relPath);
      await fs.mkdir(dirname(full), { recursive: true });
      await fs.writeFile(full, text);
    }
    return project;
  }

  it('never sets process.exitCode, even when every recorded verdict is "disagrees"', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md':
        'p.2, Punch Examples:\n"If you are punched while READY, become EXHAUSTED."\n',
    });
    await recordExampleReplayVerdicts(project, [
      recordFor('rulebook/02-punch.md', 2, {
        verdict: 'disagrees',
        reason: 'The generated test failed.',
        expected: 'Guard becomes EXHAUSTED',
        observed: 'Guard remained READY',
      }),
    ]);

    const before = process.exitCode;
    await verifyExampleReplayCommand({ project, json: true });
    expect(process.exitCode === before || process.exitCode === undefined).toBe(true);
    process.exitCode = before;
  });

  it('enumerates PROJECT-WIDE from readLiveSlices, ignoring a .verify/<runId>/ staging decoy', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'p.1, Definitions:\n"A worked example lives here."\n',
      'rulebook/.verify/run-abc123/slices/decoy.md': 'STALE STAGED COPY — must never be read.\n',
    });

    const result = await verifyExampleReplayCommand({ project });
    expect(result.slices.map((s) => s.slicePath)).toEqual(['rulebook/01-x.md']);
    for (const slice of result.slices) {
      expect(slice.slicePath).not.toContain('.verify/');
    }
  });

  it('--chunk scopes slices[] to exactly that chunk\'s cited slices via resolveCitedSlices', async () => {
    const project = await makeProject({
      'rulebook/01-a.md': 'p.1, A:\n"Example A content."\n',
      'rulebook/02-b.md': 'p.2, B:\n"Example B content."\n',
      'chunks/my-chunk/CHUNK.md': '## Verified Against\nrulebook/01-a.md\n',
    });

    const result = await verifyExampleReplayCommand({ project, chunk: 'my-chunk' });
    expect(result.slices.map((s) => s.slicePath)).toEqual(['rulebook/01-a.md']);
  });

  it('--chunk errors actionably when the slug names no chunk', async () => {
    const project = await makeProject({
      'rulebook/01-a.md': 'p.1, A:\n"Example A content."\n',
    });

    await expect(verifyExampleReplayCommand({ project, chunk: 'no-such-chunk' })).rejects.toThrow(
      /No chunk named "no-such-chunk"/,
    );
  });

  it('--chunk rejects a value that resolves outside the project chunks directory', async () => {
    const project = await makeProject({
      'rulebook/01-a.md': 'p.1, A:\n"Example A content."\n',
    });

    await expect(
      verifyExampleReplayCommand({ project, chunk: '../../etc/passwd' }),
    ).rejects.toThrow(/resolves outside/);
  });

  it('a pending slice\'s extractionPayload is byte-equal to buildExampleExtractionPayload(slice).payload', async () => {
    const text = 'p.1, Definitions:\n"A worked example lives here."\n';
    const project = await makeProject({ 'rulebook/01-x.md': text });

    const result = await verifyExampleReplayCommand({ project });
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].pending).toBe(true);
    const { payload } = buildExampleExtractionPayload({ path: 'rulebook/01-x.md', text });
    expect(result.slices[0].extractionPayload).toBe(payload);
  });

  it('a slice with a recorded verdict is reported not-pending', async () => {
    const text = 'p.1, Definitions:\n"A worked example lives here."\n';
    const project = await makeProject({ 'rulebook/01-x.md': text });
    await recordExampleReplayVerdicts(project, [recordFor('rulebook/01-x.md', 2)]);

    const result = await verifyExampleReplayCommand({ project });
    expect(result.slices[0].pending).toBe(false);
  });

  it('--json output never contains a percentage field', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'p.1, Definitions:\n"A worked example lives here."\n',
    });
    await recordExampleReplayVerdicts(project, [
      recordFor('rulebook/01-x.md', 2, {
        verdict: 'disagrees',
        reason: 'The generated test failed.',
        expected: 'X',
        observed: 'Y',
      }),
    ]);

    const result = await verifyExampleReplayCommand({ project, json: true });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/percent|Percentage|%/i);
  });

  it('counts are raw per-verdict integers, and perGameBreakdown groups by slicePath', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'p.1, Definitions:\n"A worked example lives here."\n',
    });
    await recordExampleReplayVerdicts(project, [
      recordFor('rulebook/01-x.md', 2, { verdict: 'agrees' }),
      recordFor('rulebook/01-x.md', 3, {
        verdict: 'disagrees',
        reason: 'Failed.',
        expected: 'X',
        observed: 'Y',
      }),
    ]);

    const result = await verifyExampleReplayCommand({ project });
    expect(result.counts.agrees).toBe(1);
    expect(result.counts.disagrees).toBe(1);
    expect(result.perGameBreakdown).toEqual([
      {
        slicePath: 'rulebook/01-x.md',
        verdictCounts: { agrees: 1, disagrees: 1, 'example-inconsistent': 0, unexecutable: 0 },
      },
    ]);
  });
});
