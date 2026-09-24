import { DESIGN_DIR, resolveDesignRelative } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXAMPLE_REPLAY_VERDICTS,
  EXAMPLE_REPLAY_LEDGER_END,
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
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { archiveRulebookSource, designProjectFixtures } from './design-project.test-helper.js';

/**
 * Writes the two subagent returns in the shapes the contracts give them (#319): the extractor's
 * `{ "examples": [...] }`, and the translator returns filed in one object under the exampleId
 * each was dispatched for. A translation entry names its slice and line only so this helper can
 * compute that id; neither field is part of the translator's return.
 */
function exampleReturnWriters(writeJson: (name: string, value: unknown) => Promise<string>) {
  return {
    writeExtraction(name: string, examples: unknown[]) {
      return writeJson(name, { examples });
    },
    writeTranslations(name: string, entries: Record<string, unknown>[]) {
      const byId: Record<string, unknown> = {};
      for (const { slicePath, lineNumber, ...translatorReturn } of entries) {
        byId[workedExampleId({ slicePath: String(slicePath), lineNumber: Number(lineNumber) })] =
          translatorReturn;
      }
      return writeJson(name, byId);
    },
  };
}

/**
 * `verify-example-record` on rulebook/02-punch.md refuses these returns with `message`, and the
 * ledger stays empty.
 */
async function expectRecordRefused(
  project: string,
  extraction: string,
  translations: string,
  message: string | RegExp,
): Promise<void> {
  await expect(
    verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction,
      translations,
    }),
  ).rejects.toThrow(message);
  expect(await readExampleReplayVerdicts(project)).toEqual([]);
}

/** The source text of the module under test. */
function replayModuleSource(): string {
  return readFileSync(fileURLToPath(new URL('./verify-example-replay.ts', import.meta.url)), 'utf-8');
}

/** What `verify-example-replay` prints for `project`, as one string. */
async function printedReport(project: string): Promise<string> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await verifyExampleReplayCommand({ project });
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    logSpy.mockRestore();
  }
}

// -------------------------------------------------------------------------------------------
// Task 1 — verdict set + createExampleReplayRecord (the record choke point)
// -------------------------------------------------------------------------------------------

describe('EXAMPLE_REPLAY_VERDICTS', () => {
  it('is exactly the five-member frozen set', () => {
    expect([...EXAMPLE_REPLAY_VERDICTS]).toEqual([
      'agrees',
      'disagrees',
      'example-inconsistent',
      'unexecutable',
      'not-run',
    ]);
    expect(Object.isFrozen(EXAMPLE_REPLAY_VERDICTS)).toBe(true);
  });
});

/** The test a translated record carries (not-run, agrees, disagrees). */
const TRANSLATION = {
  pageCitation: 'p.2, Punch Examples',
  sourceText: 'If you are punched while READY, you become EXHAUSTED.',
  testCode: "it('a READY guard becomes EXHAUSTED', () => {\n  expect(true).toBe(true);\n});",
  imports: [] as string[],
};

const TRANSLATED_VERDICTS = ['not-run', 'agrees', 'disagrees'];

/**
 * A valid record input. A translated verdict gets `TRANSLATION` unless the case passes its own
 * `translation` (including `undefined`, to prove it is required).
 */
function validAgreesInput(overrides: Partial<Parameters<typeof createExampleReplayRecord>[0]> = {}) {
  const input = {
    exampleId: 'rulebook/02-punch.md:84',
    slicePath: 'rulebook/02-punch.md',
    lineNumber: 84,
    kind: 'transition',
    verdict: 'agrees',
    reason: 'The generated test executed and matched the expected outcome.',
    provenance: 'quote-verified',
    ...overrides,
  };
  return TRANSLATED_VERDICTS.includes(input.verdict) && !('translation' in overrides)
    ? { ...input, translation: TRANSLATION }
    : input;
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
      /Invalid verdict "banana".*agrees, disagrees, example-inconsistent, unexecutable, not-run/s,
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

  it.each(['not-run', 'agrees', 'disagrees'])(
    'a "%s" record must carry its translated test',
    (verdict) => {
      expect(() =>
        createExampleReplayRecord(
          validAgreesInput({ verdict, expected: 'X', observed: 'Y', translation: undefined }),
        ),
      ).toThrow(/carries no translated test/);
    },
  );

  it.each(['unexecutable', 'example-inconsistent'])(
    'a "%s" record never carries a translated test',
    (verdict) => {
      expect(() =>
        createExampleReplayRecord(
          validAgreesInput({
            verdict,
            contradictionA: 'a',
            contradictionB: 'b',
            translation: TRANSLATION,
          }),
        ),
      ).toThrow(/carries a translated test/);
    },
  );

  it('a fence marker inside the translated test throws (fence injection)', () => {
    expect(() =>
      createExampleReplayRecord(
        validAgreesInput({
          translation: { ...TRANSLATION, testCode: `// ${EXAMPLE_REPLAY_LEDGER_END}` },
        }),
      ),
    ).toThrow(/translation\.testCode contains a ledger fence marker/);
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
    dir = tempTree('bs-verify-example-replay-ledger-');
  });

  it('exampleReplayLedgerPath resolves to rulebook/.example-replay/EXAMPLE-VERDICTS.md', () => {
    expect(exampleReplayLedgerPath('/project')).toBe(
      join('/project', DESIGN_DIR, 'rulebook', '.example-replay', 'EXAMPLE-VERDICTS.md'),
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

  // WR-02 (178-REVIEW.md) — beginIdx/endIdx were located independently with no ordering check;
  // an end-before-begin (or doubled) fence would silently slice an empty/nonsensical body rather
  // than throw the "malformed ledger" error this function's doc comment promises.
  it('a ledger with the end fence appearing before the begin fence throws, never silently returns an empty/wrong body', async () => {
    const good = recordFor('rulebook/01-a.md', 1);
    await replaceExampleReplayVerdicts(dir, [good]);
    const ledgerPath = exampleReplayLedgerPath(dir);
    const original = await fs.readFile(ledgerPath, 'utf-8');

    // Swap the order of the two fence markers, keeping the body between them intact — this is
    // exactly the "unbalanced fence" shape a hand-edit could produce.
    const corrupted = original
      .replace('<!-- boardsmith:example-replay-verdicts:begin -->', '<<<BEGIN-PLACEHOLDER>>>')
      .replace('<!-- boardsmith:example-replay-verdicts:end -->', '<!-- boardsmith:example-replay-verdicts:begin -->')
      .replace('<<<BEGIN-PLACEHOLDER>>>', '<!-- boardsmith:example-replay-verdicts:end -->');
    await fs.writeFile(ledgerPath, corrupted);

    await expect(readExampleReplayVerdicts(dir)).rejects.toThrow(
      /end fence appears before the begin fence/,
    );
  });

  it('writes go through atomicWriteFile — no direct fs.writeFile/writeFileSync in the module', () => {
    const source = replayModuleSource();
    expect(/\bfs\.writeFile\(|\bwriteFileSync\(/.test(source)).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Task 3 — verifyExampleReplayCommand — the read/report command
// -------------------------------------------------------------------------------------------

describe('verifyExampleReplayCommand — command', () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempTree('bs-verify-example-replay-command-');
  });

  const { makeProject } = designProjectFixtures(() => dir);

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

  it('a slice with zero extractable content lines is reported notDispatchable and carries no extractionPayload (178-12 RED)', async () => {
    // Plain prose only — no quoted lines, no citation header, no Example/Visual marker, no
    // doom-machine header form. `buildExampleExtractionPayload` returns `lines: []` for this
    // text; the defect this test proves was real: BEFORE the fix, `verifyExampleReplayCommand`
    // still emitted a dispatchable `extractionPayload` (just the handshake token + slice header,
    // zero content), so a subagent was asked to "extract" from nothing and correctly refused —
    // the 37.5% "malformed response rate" 178-11's live proof measured was this defect, not
    // model unreliability (see 178-PROOF.md §11).
    const project = await makeProject({
      'rulebook/01-x.md': 'Just some plain prose with no quotes, headers, or markers at all.\n',
    });

    const result = await verifyExampleReplayCommand({ project });
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].extractionPayload).toBeUndefined();
    expect(result.slices[0].notDispatchable).toBe('no-extractable-content');
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
      recordFor('rulebook/01-x.md', 4, { verdict: 'not-run', reason: 'Not run yet.' }),
    ]);

    const result = await verifyExampleReplayCommand({ project });
    expect(result.counts.agrees).toBe(1);
    expect(result.counts.disagrees).toBe(1);
    expect(result.counts['not-run']).toBe(1);
    expect(result.perGameBreakdown).toEqual([
      {
        slicePath: 'rulebook/01-x.md',
        verdictCounts: {
          agrees: 1,
          disagrees: 1,
          'example-inconsistent': 0,
          unexecutable: 0,
          'not-run': 1,
        },
      },
    ]);
  });

  it('names each translated example that has not been run, and the two commands that run it', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'p.1, Definitions:\n"A worked example lives here."\n',
    });
    await recordExampleReplayVerdicts(project, [
      recordFor('rulebook/01-x.md', 2, { verdict: 'not-run', reason: 'Not run yet.' }),
    ]);

    const printed = await printedReport(project);
    expect(printed).toMatch(/not run yet.*verify-example-emit.*verify-example-run/s);
    expect(printed).toContain('rulebook/01-x.md:2');
    expect(printed).not.toContain('never a verdict');
  });
});

// -------------------------------------------------------------------------------------------
// Plan 178-04, Task 1 — verifyExampleRecordCommand — the sole write surface
// -------------------------------------------------------------------------------------------

describe('verifyExampleRecordCommand — record', () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempTree('bs-verify-example-record-');
  });

  const { makeProject, writeJson } = designProjectFixtures(() => dir);
  const { writeExtraction, writeTranslations } = exampleReturnWriters(writeJson);

  const SLICE_TEXT =
    'p.2, Punch Examples:\n' +
    '"If you are punched while READY, you become EXHAUSTED."\n' +
    '"If you are punched while EXHAUSTED, you stay EXHAUSTED."\n';

  function extractionEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
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
      testCode: TRANSLATION.testCode,
      imports: [],
      verdictHint: 'agrees',
      ...overrides,
    };
  }

  it('rejects a --slice-path that escapes rulebook/, naming rulebook, and never reads it', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [translationEntry()]);
    const ledgerPath = exampleReplayLedgerPath(project);
    expect(
      await fs.readFile(ledgerPath, 'utf-8').catch(() => null),
    ).toBeNull();

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: '../../../../etc/passwd',
        extraction: extractionPath,
        translations: translationPath,
      }),
    ).rejects.toThrow(/rulebook/);

    expect(await fs.readFile(ledgerPath, 'utf-8').catch(() => null)).toBeNull();
  });

  it('two extraction entries sharing lineNumber cause the command to throw naming both, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [
      extractionEntry({ sourceText: 'If you are punched while READY, you become EXHAUSTED.' }),
      extractionEntry({
        sourceText: 'If you are punched while EXHAUSTED, you stay EXHAUSTED.',
        expected: 'Guard stays EXHAUSTED.',
      }),
    ]);
    const translationPath = await writeTranslations('translations.json', [translationEntry()]);

    await expectRecordRefused(project, extractionPath, translationPath, /two entries resolving to the same slicePath\+lineNumber/);
  });

  it('a sourceText absent from the slice is rejected, quoting the offending text, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [
      extractionEntry({ sourceText: 'This sentence does not appear in the slice at all.' }),
    ]);
    const translationPath = await writeTranslations('translations.json', [translationEntry()]);

    await expectRecordRefused(project, extractionPath, translationPath, /This sentence does not appear in the slice at all\./);
  });

  it('records two examples and readExampleReplayVerdicts returns exactly those two, each with the id workedExampleId computes', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [
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
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({ lineNumber: 2 }),
      translationEntry({ lineNumber: 3 }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translations: translationPath,
    });
    expect(result.records).toHaveLength(2);

    const recorded = await readExampleReplayVerdicts(project);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.exampleId).sort()).toEqual(
      ['rulebook/02-punch.md:2', 'rulebook/02-punch.md:3'].sort(),
    );
  });

  // -----------------------------------------------------------------------------------------
  // CR-03 (178-REVIEW.md) — `lineNumber` is model-controlled input; it must be cross-validated
  // against buildExampleExtractionPayload's own retained-line set for the slice BEFORE it is
  // ever used to build a workedExampleId, and must fail closed (never silently collide with, or
  // overwrite, a different genuine example's ledger entry) on a fabricated/off-by-one value.
  // -----------------------------------------------------------------------------------------

  it('a fabricated --extraction lineNumber not among the slice\'s retained lines is rejected, naming the slice and value, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    // SLICE_TEXT has only 3 lines; 99 was never a retained extraction line.
    const extractionPath = await writeExtraction('extraction.json', [
      extractionEntry({ lineNumber: 99 }),
    ]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({ lineNumber: 99 }),
    ]);

    await expectRecordRefused(project, extractionPath, translationPath, /rulebook\/02-punch\.md:99.*never retained/s);
  });

  it('a fabricated lineNumber cannot silently overwrite a genuine, different example already in the ledger', async () => {
    const project = await makeProject({
      'rulebook/02-punch.md': SLICE_TEXT,
    });
    // First, record a genuine example at line 3.
    const extractionPath1 = await writeExtraction('extraction1.json', [
      extractionEntry({
        lineNumber: 3,
        sourceText: 'If you are punched while EXHAUSTED, you stay EXHAUSTED.',
        expected: 'Guard stays EXHAUSTED.',
      }),
    ]);
    const translationPath1 = await writeTranslations('translations1.json', [
      translationEntry({ lineNumber: 3 }),
    ]);
    await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath1,
      translations: translationPath1,
    });
    const before = await readExampleReplayVerdicts(project);
    expect(before).toHaveLength(1);
    expect(before[0].exampleId).toBe('rulebook/02-punch.md:3');

    // A later dispatch reports a fabricated lineNumber (50 — never a retained line of this
    // slice) that, absent the CR-03 fix, would still compose a workedExampleId and reach the
    // upsert path — this must fail closed BEFORE any write, never silently coexist with or
    // overwrite the genuine entry above.
    const extractionPath2 = await writeExtraction('extraction2.json', [
      extractionEntry({ lineNumber: 50, sourceText: 'A sentence never present in this slice.' }),
    ]);
    const translationPath2 = await writeTranslations('translations2.json', [
      translationEntry({ lineNumber: 50 }),
    ]);
    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath2,
        translations: translationPath2,
      }),
    ).rejects.toThrow(/rulebook\/02-punch\.md:50.*never retained/s);

    const after = await readExampleReplayVerdicts(project);
    expect(after).toEqual(before);
  });

  it('requires --slice-path, --extraction and --translations, each named in its own error', async () => {
    await expect(verifyExampleRecordCommand({})).rejects.toThrow(/--slice-path/);
    await expect(
      verifyExampleRecordCommand({ slicePath: 'rulebook/x.md' }),
    ).rejects.toThrow(/--extraction/);
    await expect(
      verifyExampleRecordCommand({ slicePath: 'rulebook/x.md', extraction: '/tmp/x.json' }),
    ).rejects.toThrow(/--translations/);
  });

  // -----------------------------------------------------------------------------------------
  // 178-08 — closing the seam wave 7 flagged: an `example-inconsistent` --extraction entry
  // must be recorded, never thrown for. `seven`'s Run example (printed "5, 6, 7" vs. card art
  // "1, 2, 3", INDEX.md:63 gap #4) is the designated adversarial fixture.
  // -----------------------------------------------------------------------------------------

  const SEVEN_SLICE_TEXT =
    'p.1, Definitions:\n' +
    '"Run: 3+ cards in numeric order."\n' +
    '"example: 5, 6, 7"\n' +
    '\n' +
    'Visual (p.1): The Run example is illustrated by three card images side by side: a red 1, ' +
    'a blue 2, and a red 3 (the printed example text reads 5, 6, 7 while the accompanying card ' +
    'images show 1, 2, 3).\n';

  function inconsistentEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      lineNumber: 3,
      pageCitation: 'p.1, Definitions',
      kind: 'example-inconsistent',
      reason: 'The quoted text reads "5, 6, 7" but the Visual line names card images 1, 2, 3.',
      supportingQuoteLines: [
        '"example: 5, 6, 7"',
        'Visual (p.1): ...the accompanying card images show 1, 2, 3.',
      ],
      ...overrides,
    };
  }

  it('a seven-shaped example-inconsistent --extraction entry is recorded end to end (the 178-07 seam), never thrown for', async () => {
    const project = await makeProject({
      'rulebook/01-definitions.md': SEVEN_SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [inconsistentEntry()]);
    // No --translations entry: extract-example.md's example-inconsistent rule means this example
    // was never dispatched for translation in the first place (verifyExampleTranslateCommand
    // routes it to notTranslated[] instead) — an empty --translations object is the honest input.
    const translationPath = await writeTranslations('translations.json', []);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/01-definitions.md',
      extraction: extractionPath,
      translations: translationPath,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].verdict).toBe('example-inconsistent');
    expect(result.records[0].kind).toBe('example-inconsistent');
    expect(result.records[0].exampleId).toBe('rulebook/01-definitions.md:3');
    expect(result.records[0].contradictionA).toBe('"example: 5, 6, 7"');
    expect(result.records[0].contradictionB).toContain('1, 2, 3');
    expect(result.records[0].reason).toBe(
      'The quoted text reads "5, 6, 7" but the Visual line names card images 1, 2, 3.',
    );

    const recorded = await readExampleReplayVerdicts(project);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].verdict).toBe('example-inconsistent');
  });

  it('an example-inconsistent entry with an empty reason throws, writing nothing', async () => {
    const project = await makeProject({
      'rulebook/01-definitions.md': SEVEN_SLICE_TEXT,
    });
    const extractionPath = await writeExtraction('extraction.json', [
      inconsistentEntry({ reason: '' }),
    ]);
    const translationPath = await writeTranslations('translations.json', []);

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: 'rulebook/01-definitions.md',
        extraction: extractionPath,
        translations: translationPath,
      }),
    ).rejects.toThrow(/example-inconsistent.*no reason/s);

    expect(await readExampleReplayVerdicts(project)).toEqual([]);
  });

  it('a mixed extraction (one transition, one example-inconsistent) records both, keeping the transition example paired with its --translations entry and the inconsistent one standing alone', async () => {
    const project = await makeProject({
      'rulebook/01-definitions.md':
        SEVEN_SLICE_TEXT + '"If you are punched while READY, you become EXHAUSTED."\n',
    });
    const extractionPath = await writeExtraction('extraction.json', [
      inconsistentEntry({ lineNumber: 3 }),
      extractionEntry({ lineNumber: 6 }),
    ]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({ slicePath: 'rulebook/01-definitions.md', lineNumber: 6 }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/01-definitions.md',
      extraction: extractionPath,
      translations: translationPath,
    });

    expect(result.records).toHaveLength(2);
    const byLine = new Map(result.records.map((r) => [r.lineNumber, r]));
    expect(byLine.get(3)?.verdict).toBe('example-inconsistent');
    expect(byLine.get(6)?.verdict).toBe('not-run');
    expect(byLine.get(6)?.kind).toBe('transition');
  });

  // #319: the command reads exactly what the contracts return. `example-contracts.test.ts`
  // carries the contracts' own documented examples through; these cases pin each refusal.

  it('refuses a bare extraction array, naming the { "examples": [...] } shape, writing nothing', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [translationEntry()]);

    await expectRecordRefused(project, extractionPath, translationPath, /\{ "examples": \[ \.\.\. \] \}/);
  });

  it('refuses a translations file that is not an object keyed by exampleId', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeJson('translations.json', [translationEntry()]);

    await expectRecordRefused(project, extractionPath, translationPath, /keyed by exampleId/);
  });

  it('a translated example is recorded not-run, carrying its test and the spec it came from', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({ imports: ["import { strictEqual } from 'node:assert';"] }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translations: translationPath,
    });

    const [recorded] = await readExampleReplayVerdicts(project);
    expect(recorded).toEqual(result.records[0]);
    expect(recorded.verdict).toBe('not-run');
    expect(recorded.expected).toBe('Guard becomes EXHAUSTED.');
    expect(recorded.translation).toEqual({
      pageCitation: 'p.2, Punch Examples',
      sourceText: 'If you are punched while READY, you become EXHAUSTED.',
      testCode: TRANSLATION.testCode,
      imports: ["import { strictEqual } from 'node:assert';"],
    });
  });

  it('never takes agrees/disagrees from verdictHint: a "disagrees" hint is still recorded not-run', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({ verdictHint: 'disagrees' }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translations: translationPath,
    });
    expect(result.records[0].verdict).toBe('not-run');
  });

  it('an unexecutable translator return is recorded unexecutable with its named reason and no test', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry({
        testCode: '',
        verdictHint: 'unexecutable',
        unexecutableReason: 'unmodeled-component-state',
      }),
    ]);

    const result = await verifyExampleRecordCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
      translations: translationPath,
    });
    expect(result.records[0].verdict).toBe('unexecutable');
    expect(result.records[0].reason).toMatch(/^unmodeled-component-state: /);
    expect(result.records[0].translation).toBeUndefined();
  });

  it.each([
    [
      'an unexecutable return without a named reason',
      { testCode: '', verdictHint: 'unexecutable' },
      /without a named reason.*no-matching-symbol/s,
    ],
    [
      'an unexecutable return with a reason outside the list',
      { testCode: '', verdictHint: 'unexecutable', unexecutableReason: 'too-hard' },
      /without a named reason/,
    ],
    [
      'an unexecutable return that carries testCode',
      { verdictHint: 'unexecutable', unexecutableReason: 'no-matching-symbol' },
      /carries testCode/,
    ],
    ['a translated return with empty testCode', { testCode: '  ' }, /no testCode/],
    [
      'a translated return that names an unexecutableReason',
      { unexecutableReason: 'no-matching-symbol' },
      /names an unexecutableReason/,
    ],
    ['a return with an unknown verdictHint', { verdictHint: 'maybe' }, /return shape/],
    ['a return with no imports array', { imports: undefined }, /return shape/],
  ])('refuses %s, writing nothing', async (_label, overrides, message) => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry(overrides),
    ]);

    await expect(
      verifyExampleRecordCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
        translations: translationPath,
      }),
    ).rejects.toThrow(message);
  });

  it('refuses a translations entry keyed by an id no translatable example has', async () => {
    const project = await makeProject({ 'rulebook/02-punch.md': SLICE_TEXT });
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      translationEntry(),
      translationEntry({ lineNumber: 3 }),
    ]);

    await expectRecordRefused(
      project,
      extractionPath,
      translationPath,
      /"rulebook\/02-punch\.md:3" with no matching translatable --extraction entry/,
    );
  });

  // One module holds both verify-example-record and verify-example-translate, so this covers both.
  it('registers no run-id/force/skip/overwrite bypass option anywhere in the module', () => {
    const source = replayModuleSource();
    expect(/run-id|force|--skip|overwrite/.test(source)).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------
// Plan 178-04, Task 2 — provenance gating (178-CONTEXT.md decision 12)
// -------------------------------------------------------------------------------------------

describe('verifyExampleRecordCommand / verifyExampleReplayCommand — provenance gating (decision 12)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempTree('bs-verify-example-provenance-');
  });

  const SLICE_TEXT =
    'p.2, Punch Examples:\n"If you are punched while READY, you become EXHAUSTED."\n';

  function extractionEntry() {
    return {
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

  const { writeJson } = designProjectFixtures(() => dir);
  const { writeExtraction, writeTranslations } = exampleReturnWriters(writeJson);

  /**
   * Records the example through verify-example-record, then stands in for verify-example-run
   * observing a failure: the run keeps every field of the recorded example, provenance
   * included, and changes only the verdict (`example-test-run.test.ts` proves that on a real run).
   */
  async function recordThenObserveFailure(project: string, slicePath: string) {
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);
    const translationPath = await writeTranslations('translations.json', [
      { slicePath, lineNumber: 2, testCode: TRANSLATION.testCode, imports: [], verdictHint: 'agrees' },
    ]);
    const result = await verifyExampleRecordCommand({
      project,
      slicePath,
      extraction: extractionPath,
      translations: translationPath,
    });
    const [notRun] = result.records;
    await recordExampleReplayVerdicts(project, [
      createExampleReplayRecord({
        ...notRun,
        supportingQuoteLines: [...notRun.supportingQuoteLines],
        verdict: 'disagrees',
        reason: 'The emitted test failed against the game.',
        observed: 'Guard remained READY.',
      }),
    ]);
    return result;
  }

  /** No INDEX.md at all — computeVerificationScope never reaches "full"; provenance is null. */
  async function makeUnverifiedProject(): Promise<string> {
    const project = join(dir, 'unverified-project');
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', '02-punch.md'), SLICE_TEXT);
    return project;
  }

  /** A genuinely single-source, fully-archived project — provenance covers every slice. */
  async function makeVerifiedProject(): Promise<string> {
    const project = join(dir, 'verified-project');
    const { bytes: sourceBuf } = await archiveRulebookSource(project);
    await fs.writeFile(join(project, 'rules.pdf'), sourceBuf);
    await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', '02-punch.md'), SLICE_TEXT);
    return project;
  }

  /**
   * The doom-machine shape (verify-enumerate.test.ts's own fixture): `rules.pdf` archived,
   * `cards.pdf` present but unarchived, and the slice named to match `cards.pdf`'s stem so
   * `QuoteVerifiedProvenance.covers()` reports `false` for it.
   */
  async function makeUncoveredSliceProject(): Promise<string> {
    const project = join(dir, 'uncovered-project');
    const { bytes: sourceBuf } = await archiveRulebookSource(project);
    await fs.writeFile(join(project, 'rules.pdf'), sourceBuf);
    await fs.writeFile(join(project, 'cards.pdf'), Buffer.from('fake bytes for cards.pdf\n'));
    await fs.writeFile(join(project, DESIGN_DIR, 'rulebook', 'CARDS.md'), SLICE_TEXT);
    return project;
  }

  it('no archived source at all — every recorded "disagrees" carries quote-unverified, and the report never accuses the code', async () => {
    const project = await makeUnverifiedProject();
    const result = await recordThenObserveFailure(project, 'rulebook/02-punch.md');
    expect(result.provenance).toBe('quote-unverified');
    expect(result.records[0].provenance).toBe('quote-unverified');
    expect((await readExampleReplayVerdicts(project))[0].verdict).toBe('disagrees');

    const printed = await printedReport(project);
    expect(printed).toContain('not an accusation against the code');
  });

  it('archived source does not cover this slice — the same downgrade applies, and the report names the slice', async () => {
    const project = await makeUncoveredSliceProject();
    const result = await recordThenObserveFailure(project, 'rulebook/CARDS.md');
    expect(result.provenance).toBe('quote-unverified');

    const printed = await printedReport(project);
    expect(printed).toContain('rulebook/CARDS.md');
    expect(printed).toContain('not an accusation against the code');
  });

  it('a fully-verified project records the example as quote-verified, and a later "disagrees" keeps both', async () => {
    const project = await makeVerifiedProject();
    const result = await recordThenObserveFailure(project, 'rulebook/02-punch.md');
    expect(result.provenance).toBe('quote-verified');
    expect(result.records[0].provenance).toBe('quote-verified');
    // The downgrade never rewrites the verdict itself — it stays "disagrees" in every case.
    const [observed] = await readExampleReplayVerdicts(project);
    expect(observed.verdict).toBe('disagrees');
    expect(observed.provenance).toBe('quote-verified');
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
    dir = tempTree('bs-verify-example-translate-');
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
      // Keys are written the way a design doc writes them — `rulebook/02-x.md`, not
      // `design/rulebook/02-x.md` — so the fixture exercises the same resolution the CLI does.
      const full = resolveDesignRelative(project, relPath);
      await fs.mkdir(dirname(full), { recursive: true });
      await fs.writeFile(full, text);
    }
    return project;
  }

  const { writeJson } = designProjectFixtures(() => dir);
  const { writeExtraction } = exampleReturnWriters(writeJson);

  function extractionEntry(overrides: Partial<Record<string, unknown>> = {}) {
    return {
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
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);

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
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);

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
    const extractionPath2 = await writeExtraction('extraction2.json', [
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
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);

    const result = await verifyExampleTranslateCommand({
      project,
      slicePath: 'rulebook/02-punch.md',
      extraction: extractionPath,
    });

    const api = await collectGameApiSurface(project);
    const spec = createWorkedExampleSpec({
      id: workedExampleId({ slicePath: 'rulebook/02-punch.md', lineNumber: 2 }),
      sliceText: SLICE_TEXT,
      returned: { ...extractionEntry(), slicePath: 'rulebook/02-punch.md', kind: 'transition' } as Parameters<
        typeof createWorkedExampleSpec
      >[0]['returned'],
    });
    expect(result.payloads[0].translationPayload).toBe(buildExampleTranslationPayload(spec, api));
    expect(result.apiSurfaceSymbolCount).toBe(api.exportedSymbols.length);
  });

  it('two returned entries sharing lineNumber throw naming both, emitting nothing', async () => {
    const project = await makeProject();
    const extractionPath = await writeExtraction('extraction.json', [
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

  // CR-03 (178-REVIEW.md) — same cross-validation as verifyExampleRecordCommand: a fabricated
  // lineNumber must fail closed BEFORE a payload (and therefore a workedExampleId) is ever built.
  it('a fabricated --extraction lineNumber not among the slice\'s retained lines is rejected, naming the slice and value, emitting no payload', async () => {
    const project = await makeProject();
    // SLICE_TEXT has only 3 lines; 99 was never a retained extraction line.
    const extractionPath = await writeExtraction('extraction.json', [
      extractionEntry({ lineNumber: 99 }),
    ]);

    await expect(
      verifyExampleTranslateCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
      }),
    ).rejects.toThrow(/rulebook\/02-punch\.md:99.*never retained/s);
  });

  it('an example-inconsistent entry appears in notTranslated[] with its reason, builds no payload, and exit stays clean', async () => {
    const project = await makeProject();
    const extractionPath = await writeExtraction('extraction.json', [
      {
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

  it('refuses a bare extraction array, naming the { "examples": [...] } shape (#319)', async () => {
    const project = await makeProject();
    const extractionPath = await writeJson('extraction.json', [extractionEntry()]);

    await expect(
      verifyExampleTranslateCommand({
        project,
        slicePath: 'rulebook/02-punch.md',
        extraction: extractionPath,
      }),
    ).rejects.toThrow(/\{ "examples": \[ \.\.\. \] \}/);
  });

  it('a zero-example extraction return produces zero payloads and exit stays clean', async () => {
    const project = await makeProject();
    const extractionPath = await writeExtraction('extraction.json', []);

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
    const extractionPath = await writeExtraction('extraction.json', [extractionEntry()]);

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
});

// -------------------------------------------------------------------------------------------
// Plan 178-05, Task 2 — CHECK-06 one derivation implementation (SC-3)
// -------------------------------------------------------------------------------------------

describe('CHECK-06 — one derivation implementation (SC-3)', () => {
  // THIS BLOCK IS THE FALSIFIER: it fails the moment a second implementation of either payload
  // builder, or of collectGameApiSurface, is added anywhere under src/ — reading source text, not
  // runtime behavior. This milestone has already retired three structurally unfireable backstops
  // (178-CONTEXT.md decision 14's own stated cost); the third test below demonstrates this one
  // genuinely fires, against an in-test mutated COPY of the scan input, never a real file.
  const SHARED_SYMBOLS = [
    'buildExampleTranslationPayload',
    'buildExampleExtractionPayload',
    'collectGameApiSurface',
  ] as const;

  function declarationRe(name: string): RegExp {
    return new RegExp(`^export\\s+(?:async\\s+)?function\\s+${name}\\b`, 'gm');
  }

  async function walkNonTestTsFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        files.push(...(await walkNonTestTsFiles(full)));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        files.push(full);
      }
    }
    return files;
  }

  const HERE = dirname(fileURLToPath(import.meta.url));
  const SRC_ROOT = join(HERE, '..', '..');

  async function collectDeclarationSites(): Promise<Map<string, string[]>> {
    const allFiles = await walkNonTestTsFiles(SRC_ROOT);
    const sites = new Map<string, string[]>();
    for (const name of SHARED_SYMBOLS) sites.set(name, []);
    for (const file of allFiles) {
      const text = await fs.readFile(file, 'utf-8');
      const relPath = relative(SRC_ROOT, file).split('\\').join('/');
      for (const name of SHARED_SYMBOLS) {
        if (declarationRe(name).test(text)) {
          sites.get(name)!.push(relPath);
        }
      }
    }
    return sites;
  }

  it('each shared symbol is declared exactly once across src/, in example-derivation.ts', async () => {
    const sites = await collectDeclarationSites();
    for (const name of SHARED_SYMBOLS) {
      expect(sites.get(name)).toEqual(['cli/commands/example-derivation.ts']);
    }
  });

  it('verify-example-replay.ts imports all three shared symbols from example-derivation.js, and declares none of them itself', async () => {
    const source = await fs.readFile(join(HERE, 'verify-example-replay.ts'), 'utf-8');
    for (const name of SHARED_SYMBOLS) {
      const importRe = new RegExp(
        `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'\\./example-derivation\\.js'`,
      );
      expect(source).toMatch(importRe);
    }
    // No local `function build...Payload` / `function collect...ApiSurface` declaration of any
    // kind (exported or not) may exist in this module — the second implementation this gate
    // exists to forbid.
    expect(source).not.toMatch(/\bfunction\s+build\w*Payload\b/);
    expect(source).not.toMatch(/\bfunction\s+collect\w*ApiSurface\b/);
  });

  it('is a real detector: scanning a mutated COPY of example-derivation.ts (a duplicate declaration appended) reports 2 matches, never a real file on disk', async () => {
    const derivationPath = join(SRC_ROOT, 'cli', 'commands', 'example-derivation.ts');
    const realText = await fs.readFile(derivationPath, 'utf-8');
    const name = 'buildExampleTranslationPayload';

    const realMatches = [...realText.matchAll(declarationRe(name))];
    expect(realMatches).toHaveLength(1);

    // Mutate a COPY of the real text — appended in-memory, never written to disk — to simulate a
    // second implementation appearing anywhere under src/, then re-run the SAME counting logic
    // the two tests above use.
    const mutatedText =
      realText +
      `\nexport function ${name}(spec: unknown, api: unknown): string {\n  return '';\n}\n`;
    const mutatedMatches = [...mutatedText.matchAll(declarationRe(name))];
    expect(mutatedMatches).toHaveLength(2);
    expect(mutatedMatches.length).not.toBe(realMatches.length);
  });
});
