import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  verifyExampleRecordCommand,
  verifyExampleTranslateCommand,
  type ExampleReplayRecord,
} from './verify-example-replay.js';
import {
  buildExampleExtractionPayload,
  buildExampleTranslationPayload,
  collectGameApiSurface,
  createWorkedExampleSpec,
  workedExampleId,
} from './example-derivation.js';
import { renderIndex } from './ingest-archive.js';

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

// -------------------------------------------------------------------------------------------
// Plan 178-04, Task 1 — verifyExampleRecordCommand — the sole write surface
// -------------------------------------------------------------------------------------------

describe('verifyExampleRecordCommand — record', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-example-record-'));
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

  async function writeJson(name: string, value: unknown): Promise<string> {
    const filePath = join(dir, name);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    return filePath;
  }

  const SLICE_TEXT =
    'p.2, Punch Examples:\n' +
    '"If you are punched while READY, you become EXHAUSTED."\n' +
    '"If you are punched while EXHAUSTED, you stay EXHAUSTED."\n';

  function extractionEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      slicePath: 'rulebook/02-punch.md',
      lineNumber: 2,
      pageCitation: 'p.2, Punch Examples',
      kind: 'transition',
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      setup: 'Guard is READY.',
      action: 'Guard is punched.',
      expected: 'Guard becomes EXHAUSTED.',
      supportingQuoteLines: ['If you are punched while READY, you become EXHAUSTED.'],
      ...overrides,
    };
  }

  function translationEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      slicePath: 'rulebook/02-punch.md',
      lineNumber: 2,
      verdict: 'agrees',
      reason: 'The generated test executed and matched the expected outcome.',
      ...overrides,
    };
  }

  it('rejects a --slice-path that escapes rulebook/, naming rulebook, and never reads it', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);
    const translationPath = await writeJson('translation.json', [translationEntry()]);
    const ledgerPath = exampleReplayLedgerPath(project);
    expect(
      await fs.readFile(ledgerPath, 'utf-8').catch(() => null),
    ).toBeNull();

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: '../../../../etc/passwd',
        extraction: extractionPath,
        translation: translationPath,
      }),
    ).rejects.toThrow(/rulebook/);

    expect(await fs.readFile(ledgerPath, 'utf-8').catch(() => null)).toBeNull();
  });

  it('two extraction entries sharing lineNumber cause the command to throw naming both, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeJson('extraction.json', [
      extractionEntry({ sourceText: 'If you are punched while READY, you become EXHAUSTED.' }),
      extractionEntry({
        sourceText: 'If you are punched while EXHAUSTED, you stay EXHAUSTED.',
        expected: 'Guard stays EXHAUSTED.',
      }),
    ]);
    const translationPath = await writeJson('translation.json', [translationEntry()]);

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
        translation: translationPath,
      }),
    ).rejects.toThrow(/two entries resolving to the same slicePath\+lineNumber/);

    expect(await readExampleReplayVerdicts(project)).toEqual([]);
  });

  it('a sourceText absent from the slice is rejected, quoting the offending text, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeJson('extraction.json', [
      extractionEntry({ sourceText: 'This sentence does not appear in the slice at all.' }),
    ]);
    const translationPath = await writeJson('translation.json', [translationEntry()]);

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
        translation: translationPath,
      }),
    ).rejects.toThrow(/This sentence does not appear in the slice at all\./);

    expect(await readExampleReplayVerdicts(project)).toEqual([]);
  });

  it('records two examples and readExampleReplayVerdicts returns exactly those two, each with the id workedExampleId computes', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeJson('extraction.json', [
      extractionEntry({
        lineNumber: 2,
        sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      }),
      extractionEntry({
        lineNumber: 3,
        sourceText: 'If you are punched while EXHAUSTED, you stay EXHAUSTED.',
        expected: 'Guard stays EXHAUSTED.',
      }),
    ]);
    const translationPath = await writeJson('translation.json', [
      translationEntry({ lineNumber: 2 }),
      translationEntry({ lineNumber: 3 }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translation: translationPath,
    });
    expect(result.records).toHaveLength(2);

    const recorded = await readExampleReplayVerdicts(project);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.exampleId).sort()).toEqual(
      ['rulebook/02-punch.md:2', 'rulebook/02-punch.md:3'].sort(),
    );
  });

  it('requires --project/--extraction/--translation via a matching --slice-path, --extraction, --translation error respectively', async () => {
    await expect(verifyExampleRecordCommand({})).rejects.toThrow(/--slice-path/);
    await expect(
      verifyExampleRecordCommand({ slicePath: 'rulebook/x.md' }),
    ).rejects.toThrow(/--extraction/);
    await expect(
      verifyExampleRecordCommand({ slicePath: 'rulebook/x.md', extraction: '/tmp/x.json' }),
    ).rejects.toThrow(/--translation/);
  });

  it('registers no run-id/force/skip/overwrite bypass option anywhere in the module', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./verify-example-replay.ts', import.meta.url)),
      'utf-8',
    );
    expect(/run-id|force|--skip|overwrite/.test(source)).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Plan 178-04, Task 2 — provenance gating (178-CONTEXT.md decision 12)
// -------------------------------------------------------------------------------------------

describe('verifyExampleRecordCommand / verifyExampleReplayCommand — provenance gating (decision 12)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-example-provenance-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const SLICE_TEXT =
    'p.2, Punch Examples:\n"If you are punched while READY, you become EXHAUSTED."\n';

  function extractionEntry() {
    return {
      slicePath: 'rulebook/02-punch.md',
      lineNumber: 2,
      pageCitation: 'p.2, Punch Examples',
      kind: 'transition' as const,
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      setup: 'Guard is READY.',
      action: 'Guard is punched.',
      expected: 'Guard becomes EXHAUSTED.',
      supportingQuoteLines: ['If you are punched while READY, you become EXHAUSTED.'],
    };
  }

  function disagreesTranslationEntry() {
    return {
      slicePath: 'rulebook/02-punch.md',
      lineNumber: 2,
      verdict: 'disagrees' as const,
      reason: 'The generated test failed to match the expected outcome.',
      expected: 'Guard becomes EXHAUSTED.',
      observed: 'Guard remained READY.',
    };
  }

  async function writeJson(name: string, value: unknown): Promise<string> {
    const filePath = join(dir, name);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    return filePath;
  }

  /** No INDEX.md at all — computeVerificationScope never reaches "full"; provenance is null. */
  async function makeUnverifiedProject(): Promise<string> {
    const project = join(dir, 'unverified-project');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'rulebook', '02-punch.md'), SLICE_TEXT);
    return project;
  }

  /** A genuinely single-source, fully-archived project — provenance covers every slice. */
  async function makeVerifiedProject(): Promise<string> {
    const project = join(dir, 'verified-project');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    await fs.writeFile(join(project, 'rules.pdf'), sourceBuf);
    await fs.writeFile(join(project, 'rulebook', '02-punch.md'), SLICE_TEXT);
    return project;
  }

  /**
   * The doom-machine shape (verify-enumerate.test.ts's own fixture): `rules.pdf` archived,
   * `cards.pdf` present but unarchived, and the slice named to match `cards.pdf`'s stem so
   * `QuoteVerifiedProvenance.covers()` reports `false` for it.
   */
  async function makeUncoveredSliceProject(): Promise<string> {
    const project = join(dir, 'uncovered-project');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    await fs.writeFile(join(project, 'rules.pdf'), sourceBuf);
    await fs.writeFile(join(project, 'cards.pdf'), Buffer.from('fake bytes for cards.pdf\n'));
    await fs.writeFile(join(rulebookDir, 'CARDS.md'), SLICE_TEXT);
    return project;
  }

  it('no archived source at all — every recorded "disagrees" carries quote-unverified, and the report never accuses the code', async () => {
    const project = await makeUnverifiedProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);
    const translationPath = await writeJson('translation.json', [disagreesTranslationEntry()]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translation: translationPath,
    });
    expect(result.provenance).toBe('quote-unverified');
    expect(result.records[0].provenance).toBe('quote-unverified');
    expect(result.records[0].verdict).toBe('disagrees');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await verifyExampleReplayCommand({ project });
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).toContain('not an accusation against the code');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('archived source does not cover this slice — the same downgrade applies, and the report names the slice', async () => {
    const project = await makeUncoveredSliceProject();
    const extractionPath = await writeJson('extraction.json', [
      { ...extractionEntry(), slicePath: 'rulebook/CARDS.md' },
    ]);
    const translationPath = await writeJson('translation.json', [
      { ...disagreesTranslationEntry(), slicePath: 'rulebook/CARDS.md' },
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/CARDS.md',
      extraction: extractionPath,
      translation: translationPath,
    });
    expect(result.provenance).toBe('quote-unverified');
    expect(result.records[0].verdict).toBe('disagrees');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await verifyExampleReplayCommand({ project });
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).toContain('rulebook/CARDS.md');
      expect(printed).toContain('not an accusation against the code');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('a fully-verified project records "disagrees" as quote-verified, and the verdict string stays "disagrees" in both cases', async () => {
    const project = await makeVerifiedProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);
    const translationPath = await writeJson('translation.json', [disagreesTranslationEntry()]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translation: translationPath,
    });
    expect(result.provenance).toBe('quote-verified');
    expect(result.records[0].provenance).toBe('quote-verified');
    // The downgrade never rewrites the verdict itself — it stays "disagrees" in every case.
    expect(result.records[0].verdict).toBe('disagrees');
  });

  it('createExampleReplayRecord throws when provenance is omitted', () => {
    expect(() =>
      createExampleReplayRecord({
        exampleId: 'rulebook/02-punch.md:2',
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 2,
        kind: 'transition',
        verdict: 'agrees',
        reason: 'ok',
        provenance: undefined as unknown as string,
      }),
    ).toThrow(/Invalid provenance/);
  });

  it('non-empty unarchivedSources — each basename appears in the report output', async () => {
    const project = await makeUncoveredSliceProject();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await verifyExampleReplayCommand({ project });
      expect(result.unarchivedSources).toEqual(['cards.pdf']);
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).toContain('cards.pdf');
    } finally {
      logSpy.mockRestore();
    }
  });
});

// -------------------------------------------------------------------------------------------
// Plan 178-05, Task 1 — verifyExampleTranslateCommand (the second dispatch's byte source)
// -------------------------------------------------------------------------------------------

describe('verifyExampleTranslateCommand — translate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-example-translate-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const SLICE_TEXT =
    'p.2, Punch Examples:\n' +
    '"If you are punched while READY, you become EXHAUSTED."\n' +
    '"If you are punched while EXHAUSTED, you stay EXHAUSTED."\n';

  async function makeProject(files: Record<string, string> = {}): Promise<string> {
    const project = join(dir, 'project');
    const withDefaults = {
      'rulebook/02-punch.md': SLICE_TEXT,
      'src/rules/index.ts':
        "export function checkPunch(input: { ready: boolean }): boolean {\n" +
        '  return input.ready;\n' +
        '}\n',
      ...files,
    };
    for (const [relPath, text] of Object.entries(withDefaults)) {
      const full = join(project, relPath);
      await fs.mkdir(dirname(full), { recursive: true });
      await fs.writeFile(full, text);
    }
    return project;
  }

  async function writeJson(name: string, value: unknown): Promise<string> {
    const filePath = join(dir, name);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    return filePath;
  }

  function extractionEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      slicePath: 'rulebook/02-punch.md',
      lineNumber: 2,
      pageCitation: 'p.2, Punch Examples',
      kind: 'transition',
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      setup: 'Guard is READY.',
      action: 'Guard is punched.',
      expected: 'Guard becomes EXHAUSTED.',
      supportingQuoteLines: ['If you are punched while READY, you become EXHAUSTED.'],
      ...overrides,
    };
  }

  it('rejects a --slice-path that escapes rulebook/, naming rulebook, and emits no payload', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);

    await expect(
      verifyExampleTranslateCommand({
        project,
        slicePath: '../../../../etc/passwd',
        extraction: extractionPath,
      }),
    ).rejects.toThrow(/rulebook/);
  });

  it('each emitted exampleId deep-equals workedExampleId for its own entry, unaffected by changing the model-supplied text', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);

    const result = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0].exampleId).toBe(
      workedExampleId({ slicePath: 'rulebook/02-punch.md', lineNumber: 2 }),
    );

    // Changing the model-supplied prose (expected outcome) must not change the id.
    const extractionPath2 = await writeJson('extraction2.json', [
      extractionEntry({ expected: 'A totally different worded outcome.' }),
    ]);
    const result2 = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath2,
    });
    expect(result2.payloads[0].exampleId).toBe(result.payloads[0].exampleId);
  });

  it('each emitted translationPayload is byte-equal to buildExampleTranslationPayload called directly with the same spec and surface', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);

    const result = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });

    const api = await collectGameApiSurface(project);
    const spec = createWorkedExampleSpec({
      id: workedExampleId({ slicePath: 'rulebook/02-punch.md', lineNumber: 2 }),
      sliceText: SLICE_TEXT,
      returned: { ...extractionEntry(), kind: 'transition' } as Parameters<
        typeof createWorkedExampleSpec
      >[0]['returned'],
    });
    expect(result.payloads[0].translationPayload).toBe(buildExampleTranslationPayload(spec, api));
    expect(result.apiSurfaceSymbolCount).toBe(api.exportedSymbols.length);
  });

  it('two returned entries sharing lineNumber throw naming both, emitting nothing', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [
      extractionEntry({ sourceText: 'If you are punched while READY, you become EXHAUSTED.' }),
      extractionEntry({
        sourceText: 'If you are punched while EXHAUSTED, you stay EXHAUSTED.',
        expected: 'Guard stays EXHAUSTED.',
      }),
    ]);

    await expect(
      verifyExampleTranslateCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
      }),
    ).rejects.toThrow(/two entries resolving to the same slicePath\+lineNumber/);
  });

  it('an example-inconsistent entry appears in notTranslated[] with its reason, builds no payload, and exit stays clean', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [
      {
        slicePath: 'rulebook/02-punch.md',
        lineNumber: 3,
        kind: 'example-inconsistent',
        reason: 'The printed text and the card art disagree about the resulting state.',
      },
    ]);

    const result = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });
    expect(result.payloads).toEqual([]);
    expect(result.notTranslated).toEqual([
      {
        lineNumber: 3,
        reason: 'The printed text and the card art disagree about the resulting state.',
      },
    ]);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  it('a zero-example extraction return produces zero payloads and exit stays clean', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', []);

    const result = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });
    expect(result.payloads).toEqual([]);
    expect(result.notTranslated).toEqual([]);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  it('writes nothing: the ledger file bytes/mtime are unchanged and no file is created under the project', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);

    const ledgerPath = exampleReplayLedgerPath(project);
    expect(await fs.readFile(ledgerPath, 'utf-8').catch(() => null)).toBeNull();

    const beforeFiles = new Set(
      (await fs.readdir(project, { recursive: true } as { recursive: true })) as string[],
    );

    await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });

    expect(await fs.readFile(ledgerPath, 'utf-8').catch(() => null)).toBeNull();
    const afterFiles = new Set(
      (await fs.readdir(project, { recursive: true } as { recursive: true })) as string[],
    );
    expect(afterFiles).toEqual(beforeFiles);
  });

  it('registers no run-id/force/skip/overwrite bypass option anywhere in the module', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./verify-example-replay.ts', import.meta.url)),
      'utf-8',
    );
    expect(/run-id|force|--skip|overwrite/.test(source)).toBe(false);
  });
});
