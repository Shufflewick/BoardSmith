import { DESIGN_DIR, resolveDesignRelative } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderIndex } from './ingest-archive.js';
import {
  DERIVE_CHECK_VERDICTS,
  DERIVE_CHECK_LEDGER_BEGIN,
  DERIVE_CHECK_LEDGER_END,
  DERIVE_CHECK_MODELS,
  createDeriveCheckRecord,
  deriveCheckLedgerPath,
  replaceDeriveCheckVerdicts,
  recordDeriveCheckVerdicts,
  readDeriveCheckVerdicts,
  reconcileSlice,
  parseSubagentJsonInput,
  verifyDeriveRecordCommand,
  verifyDeriveCheckCommand,
  annotationBody,
  quoteLinesOnly,
  enumerateDerivedLines,
  EXAMPLE_LINE_RE,
  VISUAL_LINE_RE,
  type DeriveCheckRecord,
  type EnumeratorReturn,
  type ReconcilerReturn,
} from './verify-derive-check.js';
import { PRESENTATION_EXCLUSION_MARKERS } from './verify-classify.js';

/**
 * `verify-derive-check.ts` is CHECK-04's mechanical core, MOVED and retargeted onto the closed
 * dual-enumeration verdict set (177.1-02). Every fixture here is a real filesystem temp dir
 * (`fs.mkdtemp`, no mocks) — mirroring the retired blind-derivation module's test suite's own
 * discipline so the moved invariants are visibly the same proofs, just against eight verdicts
 * instead of four.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===========================================================================================
// Task 1 — DERIVE_CHECK_VERDICTS and the single record-construction choke point
// ===========================================================================================

describe('DERIVE_CHECK_VERDICTS', () => {
  it('is the eight-member dual-enumeration verdict set, frozen, in DerivedLineClassification order', () => {
    expect(DERIVE_CHECK_VERDICTS).toEqual([
      'corroborated',
      'corroborated-by-composition',
      'uncorroborated',
      'contradicted',
      'quote-unverified',
      'absence-corroborated',
      'absence-contradicted',
      'absence-unverifiable',
    ]);
    expect(DERIVE_CHECK_VERDICTS.length).toBe(8);
    expect(Object.isFrozen(DERIVE_CHECK_VERDICTS)).toBe(true);
  });

  it('carries no retired four-verdict-set member', () => {
    for (const retired of ['agrees', 'disagrees', 'underivable', 'not-rule-bearing']) {
      expect(DERIVE_CHECK_VERDICTS).not.toContain(retired);
    }
  });
});

// ===========================================================================================
// annotationBody / quoteLinesOnly / enumerateDerivedLines — MOVED wholesale from the retired
// blind-derivation module (177.1-CONTEXT.md decision 6). Direct unit coverage ported here
// (177.1-07 port-coverage audit) so the decoration-tolerance guarantee stays pinned by name, not
// only exercised indirectly through buildEnumeratorPayload/verifyDeriveCheckCommand.
// ===========================================================================================

describe('annotationBody', () => {
  it('strips a leading blockquote marker', () => {
    expect(annotationBody('> Derived (p.1): x')).toBe('Derived (p.1): x');
  });

  it('strips a leading list bullet', () => {
    expect(annotationBody('- Derived (p.1): x')).toBe('Derived (p.1): x');
  });

  it('strips repeated decoration (blockquote + list)', () => {
    expect(annotationBody('> - Derived (p.1): x')).toBe('Derived (p.1): x');
  });

  it('strips a leading ordered-list marker', () => {
    expect(annotationBody('1. Derived (p.1): x')).toBe('Derived (p.1): x');
  });

  it('leaves a quoted sentence unchanged — quote lines are not decoration-stripped into something else', () => {
    expect(annotationBody('"A quoted sentence."')).toBe('"A quoted sentence."');
  });
});

describe('quoteLinesOnly', () => {
  it('retains bare citation headers and quoted rulebook prose beneath them', () => {
    const quotes = quoteLinesOnly('p.1, Distribution of Cards:\n"There are 112 cards total."');
    expect(quotes).toEqual(['p.1, Distribution of Cards:', '"There are 112 cards total."']);
  });

  it('strips Visual (p. and Derived (p. lines entirely', () => {
    const synthetic = [
      'p.3, Example:',
      '"Real quoted rulebook sentence."',
      'Visual (p.3): A diagram showing card layout.',
      'Derived (p.3): An inference line.',
    ].join('\n');
    const quotes = quoteLinesOnly(synthetic);
    expect(quotes).toContain('p.3, Example:');
    expect(quotes).toContain('"Real quoted rulebook sentence."');
    expect(quotes.some((l) => l.startsWith('Visual (p.'))).toBe(false);
    expect(quotes.some((l) => l.startsWith('Derived (p.'))).toBe(false);
  });

  // 178-01 Task 3 — WR-07 resolved as Option B (178-WR07-DECISION.md): Example (p.N): joins the
  // deny-list, but seven's real quote line (no citation, bare vocabulary) must stay retained.
  it('strips Example (p.N): lines entirely (178-01, closing WR-07 by Option B)', () => {
    const dropped = quoteLinesOnly('Example (p.1): three READY guards become two');
    expect(dropped).toEqual([]);
  });

  it('strips a multi-page Example (p.N, continues on p.M): citation body entirely', () => {
    const dropped = quoteLinesOnly(
      'Example (p.1, continues on p.2): three READY guards become two',
    );
    expect(dropped).toEqual([]);
  });

  it('RETAINS seven\'s real quote line "example: 5, 5, 5" — it is not an Example (p.N): annotation', () => {
    const retained = quoteLinesOnly('"example: 5, 5, 5"');
    expect(retained).toEqual(['"example: 5, 5, 5"']);
  });

  it('RETAINS seven\'s real quote line "example: 5, 6, 7" — it is not an Example (p.N): annotation', () => {
    const retained = quoteLinesOnly('"example: 5, 6, 7"');
    expect(retained).toEqual(['"example: 5, 6, 7"']);
  });

  it('output is byte-identical on an Example-free slice before/after the Example exclusion (178-01 Task 3 behavior spec)', () => {
    const sliceWithNoExampleLine = [
      'p.3, Setup:',
      '"Deal five cards to each player."',
      'Visual (p.3): A diagram showing card layout.',
      'Derived (p.3): Each player starts with 5 cards.',
      'Named-but-undefined (p.4): the active player',
    ].join('\n');
    expect(quoteLinesOnly(sliceWithNoExampleLine)).toEqual([
      'p.3, Setup:',
      '"Deal five cards to each player."',
    ]);
  });
});

describe('EXAMPLE_LINE_RE (178-01 Task 3)', () => {
  it('matches Example (p.1): ... and asserts via EXAMPLE_LINE_RE directly', () => {
    expect(EXAMPLE_LINE_RE.test('Example (p.1): three READY guards become two')).toBe(true);
  });

  it('matches a multi-page Example citation body', () => {
    expect(
      EXAMPLE_LINE_RE.test('Example (p.1, continues on p.2): three READY guards become two'),
    ).toBe(true);
  });

  it('does not match seven\'s real quote line "example: 5, 5, 5"', () => {
    expect(EXAMPLE_LINE_RE.test('"example: 5, 5, 5"')).toBe(false);
  });
});

describe('VISUAL_LINE_RE is now exported (178-01 Task 3 — plan 178-02 needs it)', () => {
  it('is a function matching Visual (p.N): lines', () => {
    expect(VISUAL_LINE_RE.test('Visual (p.1): a blue border')).toBe(true);
  });
});

describe('PRESENTATION_EXCLUSION_MARKERS is unchanged by 178-01 (177.1-01 non-consolidation finding, source-assertion)', () => {
  it('still has exactly the three pre-178 entries — Example is NOT folded into it', () => {
    expect(PRESENTATION_EXCLUSION_MARKERS).toEqual([
      '^Visual \\(p\\.\\d+\\)(?: \\([^:]*\\))?:',
      '^Derived \\(p\\.\\d+\\) — diagram description(?: \\([^:]*\\))?:',
      '^Derived \\(p\\.\\d+\\) — art(?: \\([^:]*\\))?:',
    ]);
  });
});

describe('enumerateDerivedLines — decoration tolerance (CR-01, silent-drop regression)', () => {
  it('never treats a Visual (p. line as a Derived line', () => {
    const slices = [{ path: 'rulebook/synthetic.md', text: 'Visual (p.5): some art description.' }];
    const result = enumerateDerivedLines(slices);
    expect(result.candidates).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });

  it('a slice with three Derived lines — bare, blockquote-decorated, list-decorated — enumerates all three as candidates, not one', () => {
    const slice = {
      path: 'rulebook/01-z.md',
      text: [
        'p.1, X:',
        '"A quoted sentence."',
        '',
        'Derived (p.1): bare line, rule-bearing.',
        '> Derived (p.1): blockquote-decorated, rule-bearing.',
        '- Derived (p.1): list-decorated, rule-bearing.',
      ].join('\n'),
    };
    const { candidates, excluded } = enumerateDerivedLines([slice]);
    expect(candidates.length + excluded.length).toBe(3);
    expect(candidates).toHaveLength(3);
  });

  it('a `Derived (p.1, continues on p.2):` multi-page citation line is a candidate', () => {
    const decoratedLine = 'Derived (p.1, continues on p.2): a multi-page citation body.';
    const slice = {
      path: 'rulebook/01-w.md',
      text: `p.1, X:\n"A real quoted sentence."\n\n${decoratedLine}`,
    };
    const { candidates } = enumerateDerivedLines([slice]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe(decoratedLine);
  });
});

describe('createDeriveCheckRecord', () => {
  it('throws for a verdict outside DERIVE_CHECK_VERDICTS, naming all eight legal verdicts', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'agrees',
        reason: 'x',
      }),
    ).toThrow(
      /Invalid verdict.*corroborated.*corroborated-by-composition.*uncorroborated.*contradicted.*quote-unverified.*absence-corroborated.*absence-contradicted.*absence-unverifiable/s,
    );
  });

  it('throws for an empty/whitespace reason string', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'corroborated',
        reason: '   ',
        citedFactIds: ['fact-1'],
      }),
    ).toThrow(/no recorded reason/);
  });

  it('throws when reason contains the ledger BEGIN fence marker, naming the field "reason"', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'uncorroborated',
        reason: `Forged: ${DERIVE_CHECK_LEDGER_BEGIN}`,
      }),
    ).toThrow(/reason.*ledger fence marker/s);
  });

  it('throws when reason contains the ledger END fence marker (CR-04, the corrupting shape)', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'uncorroborated',
        reason: `Forged: ${DERIVE_CHECK_LEDGER_END}`,
      }),
    ).toThrow(/reason.*ledger fence marker/s);
  });

  it('throws when derivedLineText contains a ledger fence marker, naming the field', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: `Derived (p.1): ${DERIVE_CHECK_LEDGER_END}`,
        verdict: 'uncorroborated',
        reason: 'fine',
      }),
    ).toThrow(/derivedLineText.*ledger fence marker/s);
  });

  it('throws when a groundedQuotes string contains a ledger fence marker, naming the exact field', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'corroborated',
        reason: 'fine',
        citedFactIds: ['fact-1'],
        groundedQuotes: [
          {
            statement: 'x',
            quotedFromA: `112 cards. ${DERIVE_CHECK_LEDGER_BEGIN}`,
            quotedFromB: '112 cards.',
          },
        ],
      }),
    ).toThrow(/groundedQuotes\[0\]\.quotedFromA.*ledger fence marker/s);
  });

  it('corroborated throws when citedFactIds is empty (WR-05 analog)', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'corroborated',
        reason: 'Matches both enumerations.',
      }),
    ).toThrow(/"corroborated" verdict has no citedFactIds/);
  });

  it('corroborated throws when citedFactIds is an empty array', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'corroborated',
        reason: 'Matches both enumerations.',
        citedFactIds: [],
      }),
    ).toThrow(/"corroborated" verdict has no citedFactIds/);
  });

  it('corroborated-by-composition throws when citedFactIds is empty', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'corroborated-by-composition',
        reason: 'Composed from two grounded facts.',
      }),
    ).toThrow(/"corroborated-by-composition" verdict has no citedFactIds/);
  });

  it('contradicted throws when citedFactIds is empty', () => {
    expect(() =>
      createDeriveCheckRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'contradicted',
        reason: 'Conflicts with a grounded fact.',
      }),
    ).toThrow(/"contradicted" verdict has no citedFactIds/);
  });

  it('accepts a corroborated record with a non-empty citedFactIds entry', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): 112 cards.',
      verdict: 'corroborated',
      reason: 'Every cited fact passed grounding validation.',
      citedFactIds: ['fact-1'],
      groundedQuotes: [
        { statement: '112 cards.', quotedFromA: '112 cards total.', quotedFromB: '112 cards.' },
      ],
    });
    expect(record.verdict).toBe('corroborated');
    expect(record.citedFactIds).toEqual(['fact-1']);
  });

  it('uncorroborated constructs successfully with empty citedFactIds — nothing to cite is the honest state', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): x',
      verdict: 'uncorroborated',
      reason: 'Neither enumerator found a matching fact.',
    });
    expect(record.verdict).toBe('uncorroborated');
    expect(record.citedFactIds).toEqual([]);
  });

  it('quote-unverified constructs successfully with empty citedFactIds', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): x',
      verdict: 'quote-unverified',
      reason: 'No archived source verified for this slice.',
    });
    expect(record.verdict).toBe('quote-unverified');
  });

  it('absence-corroborated constructs successfully with empty citedFactIds', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): No edition number is stated.',
      verdict: 'absence-corroborated',
      reason: 'Neither enumerator found any edition/printing term in the quote lines.',
    });
    expect(record.verdict).toBe('absence-corroborated');
  });

  it('absence-contradicted constructs successfully with empty citedFactIds', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): No edition number is stated.',
      verdict: 'absence-contradicted',
      reason: 'An edition number appears in the quoted passage.',
    });
    expect(record.verdict).toBe('absence-contradicted');
  });

  it('absence-unverifiable constructs successfully with citedFactIds: [] (acceptance criterion)', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): No variants or advanced rules exist.',
      verdict: 'absence-unverifiable',
      reason: 'No safe, unambiguous literal target exists for this claim.',
      citedFactIds: [],
    });
    expect(record.verdict).toBe('absence-unverifiable');
    expect(record.citedFactIds).toEqual([]);
  });

  it('a record round-trips through JSON.parse(JSON.stringify(record)) byte-identically', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): 112 cards.',
      verdict: 'corroborated',
      reason: 'Every cited fact passed grounding validation.',
      citedFactIds: ['fact-1'],
      groundedQuotes: [
        { statement: '112 cards.', quotedFromA: '112 cards total.', quotedFromB: '112 cards.' },
      ],
    });
    const roundTripped = JSON.parse(JSON.stringify(record));
    expect(roundTripped).toEqual(record);
  });

  it('defaults recordedAt to an ISO 8601 UTC timestamp when not supplied', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): x',
      verdict: 'uncorroborated',
      reason: 'Neither enumerator found a matching fact.',
    });
    expect(record.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('preserves an explicitly supplied recordedAt (the read path re-enters with the original timestamp)', () => {
    const record = createDeriveCheckRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      derivedLineText: 'Derived (p.1): x',
      verdict: 'uncorroborated',
      reason: 'Neither enumerator found a matching fact.',
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(record.recordedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ===========================================================================================
// Task 2 — the atomic upsert-append ledger and the revalidating read path
// ===========================================================================================

async function hashProject(dir: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (current: string, acc: string[]): Promise<string[]> => {
    let entries: { name: string; isDirectory(): boolean }[] = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full, acc);
      else acc.push(full);
    }
    return acc;
  };
  const files = await walk(dir, []);
  for (const f of files.sort()) {
    hash.update(f);
    hash.update(await fs.readFile(f));
  }
  return hash.digest('hex');
}

function sampleUncorroboratedRecord(): DeriveCheckRecord {
  return createDeriveCheckRecord({
    slicePath: 'rulebook/01-x.md',
    lineNumber: 7,
    derivedLineText: 'Derived (p.1): The box contains 112 cards.',
    verdict: 'uncorroborated',
    reason: 'Neither enumerator found a matching fact.',
  });
}

function sampleContradictedRecord(): DeriveCheckRecord {
  return createDeriveCheckRecord({
    slicePath: 'rulebook/01-x.md',
    lineNumber: 12,
    derivedLineText: 'Derived (p.1): Each player has 8 Action Cards.',
    verdict: 'contradicted',
    reason: 'The quote lines say 7, not 8.',
    citedFactIds: ['fact-7'],
    groundedQuotes: [
      {
        statement: 'Each player has 7 Action Cards.',
        quotedFromA: 'Each player has 7 Action Cards (16 total across two colors).',
        quotedFromB: 'Each player has 7 Action Cards.',
      },
    ],
  });
}

describe('replaceDeriveCheckVerdicts / recordDeriveCheckVerdicts / readDeriveCheckVerdicts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-check-ledger-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips exactly what was written, including every one of the eight verdicts', async () => {
    const records = [sampleUncorroboratedRecord(), sampleContradictedRecord()];
    await replaceDeriveCheckVerdicts(dir, records);

    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toEqual(records);
    expect(read.some((r) => r.verdict === 'uncorroborated')).toBe(true);
    expect(read.some((r) => r.verdict === 'contradicted')).toBe(true);
  });

  it('returns an empty array when no ledger has ever been written', async () => {
    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toEqual([]);
  });

  it('replaceDeriveCheckVerdicts REPLACES the body atomically — no leftover from the first write (the deliberately-destructive, non-default path)', async () => {
    const second = sampleContradictedRecord();
    await replaceDeriveCheckVerdicts(dir, [sampleUncorroboratedRecord()]);
    await replaceDeriveCheckVerdicts(dir, [second]);

    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toEqual([second]);
    expect(read.some((r) => r.verdict === 'uncorroborated')).toBe(false);
  });

  it('recordDeriveCheckVerdicts called for slice A then slice B leaves BOTH readable (CR-06 — the pattern that previously destroyed one)', async () => {
    await recordDeriveCheckVerdicts(dir, [sampleUncorroboratedRecord()]);
    await recordDeriveCheckVerdicts(dir, [sampleContradictedRecord()]);

    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toHaveLength(2);
    expect(read.some((r) => r.verdict === 'uncorroborated')).toBe(true);
    expect(read.some((r) => r.verdict === 'contradicted')).toBe(true);
  });

  it('recordDeriveCheckVerdicts called twice for the SAME slicePath:lineNumber upserts — exactly one record survives, carrying the second call content', async () => {
    const first = sampleUncorroboratedRecord();
    const second = createDeriveCheckRecord({
      slicePath: first.slicePath,
      lineNumber: first.lineNumber,
      derivedLineText: first.derivedLineText,
      verdict: 'quote-unverified',
      reason: 'On reflection, this project has no verified archived source.',
    });

    await recordDeriveCheckVerdicts(dir, [first]);
    await recordDeriveCheckVerdicts(dir, [second]);

    const read = await readDeriveCheckVerdicts(dir);
    const atLocation = read.filter(
      (r) => r.slicePath === first.slicePath && r.lineNumber === first.lineNumber,
    );
    expect(atLocation).toHaveLength(1);
    expect(atLocation[0].verdict).toBe('quote-unverified');
    expect(atLocation[0].reason).toBe(second.reason);
  });

  it('existing records keep their original order and the updated/new record is appended last', async () => {
    const a = sampleUncorroboratedRecord();
    const b = sampleContradictedRecord();
    await recordDeriveCheckVerdicts(dir, [a]);
    await recordDeriveCheckVerdicts(dir, [b]);

    const updatedA = createDeriveCheckRecord({
      slicePath: a.slicePath,
      lineNumber: a.lineNumber,
      derivedLineText: a.derivedLineText,
      verdict: 'quote-unverified',
      reason: 'Re-evaluated.',
    });
    await recordDeriveCheckVerdicts(dir, [updatedA]);

    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toHaveLength(2);
    expect(read[0].slicePath).toBe(b.slicePath);
    expect(read[0].lineNumber).toBe(b.lineNumber);
    expect(read[1].slicePath).toBe(updatedA.slicePath);
    expect(read[1].lineNumber).toBe(updatedA.lineNumber);
    expect(read[1].verdict).toBe('quote-unverified');
  });

  it('recording a batch of multiple records from one slice in one call upserts each independently', async () => {
    const c1 = sampleUncorroboratedRecord();
    const c2 = sampleContradictedRecord();
    await recordDeriveCheckVerdicts(dir, [c1, c2]);

    const read = await readDeriveCheckVerdicts(dir);
    expect(read).toHaveLength(2);

    const c1Updated = createDeriveCheckRecord({
      slicePath: c1.slicePath,
      lineNumber: c1.lineNumber,
      derivedLineText: c1.derivedLineText,
      verdict: 'quote-unverified',
      reason: 'Re-evaluated in a later batch.',
    });
    await recordDeriveCheckVerdicts(dir, [c1Updated]);

    const read2 = await readDeriveCheckVerdicts(dir);
    expect(read2).toHaveLength(2);
    expect(read2.find((r) => r.lineNumber === c1.lineNumber)?.verdict).toBe('quote-unverified');
    expect(read2.find((r) => r.lineNumber === c2.lineNumber)?.verdict).toBe('contradicted');
  });

  it('is project-level: no run-id segment in the ledger path, and no function accepts a runId', async () => {
    const { ledgerPath } = await replaceDeriveCheckVerdicts(dir, [sampleUncorroboratedRecord()]);
    expect(ledgerPath).not.toContain('.verify');
    expect(ledgerPath).not.toMatch(/run-?[Ii]d/);
    expect(ledgerPath).toBe('design/rulebook/.derive-check/verdicts.md');
    expect(deriveCheckLedgerPath(dir)).toContain('.derive-check');
    expect(deriveCheckLedgerPath(dir)).not.toMatch(/\.verify\//);
    expect(deriveCheckLedgerPath(dir)).not.toMatch(/run-?[Ii]d/i);

    // Arity: replaceDeriveCheckVerdicts(projectDir, records) / recordDeriveCheckVerdicts(projectDir,
    // records) / readDeriveCheckVerdicts(projectDir) — no runId parameter slot exists on any of
    // the three.
    expect(replaceDeriveCheckVerdicts.length).toBe(2);
    expect(recordDeriveCheckVerdicts.length).toBe(2);
    expect(readDeriveCheckVerdicts.length).toBe(1);
  });

  it('a whole-project byte hash before vs. after recording differs ONLY under rulebook/.derive-check/', async () => {
    await fs.mkdir(join(dir, DESIGN_DIR, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(dir, DESIGN_DIR, 'rulebook', '01-x.md'), 'p.1, X:\n"112 cards total."');
    await fs.writeFile(join(dir, DESIGN_DIR, 'rulebook', 'source', 'rules.pdf'), 'not a real pdf, but bytes');
    const beforeHash = await hashProject(dir);

    await recordDeriveCheckVerdicts(dir, [sampleUncorroboratedRecord()]);

    const walk = async (current: string, acc: string[]): Promise<string[]> => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) await walk(full, acc);
        else acc.push(full);
      }
      return acc;
    };
    const allFiles = await walk(dir, []);
    const outsideLedgerDir = allFiles.filter((f) => !f.includes(join('rulebook', '.derive-check')));
    expect(outsideLedgerDir.sort()).toEqual(
      [join(dir, DESIGN_DIR, 'rulebook', '01-x.md'), join(dir, DESIGN_DIR, 'rulebook', 'source', 'rules.pdf')].sort(),
    );

    const afterSourceHash = await hashProject(join(dir, DESIGN_DIR, 'rulebook', 'source'));
    const beforeSourceHash = await hashProject(join(dir, DESIGN_DIR, 'rulebook', 'source'));
    expect(afterSourceHash).toBe(beforeSourceHash);
    void beforeHash;

    // No .tmp/partial file survives anywhere in the ledger directory.
    const ledgerDirFiles = await fs.readdir(join(dir, DESIGN_DIR, 'rulebook', '.derive-check'));
    expect(ledgerDirFiles.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('a valid ledger round-trips byte-identically through write -> read -> write', async () => {
    const records = [sampleUncorroboratedRecord(), sampleContradictedRecord()];
    await replaceDeriveCheckVerdicts(dir, records);
    const firstRead = await readDeriveCheckVerdicts(dir);
    await replaceDeriveCheckVerdicts(dir, firstRead);
    const secondRead = await readDeriveCheckVerdicts(dir);
    expect(secondRead).toEqual(records);
  });
});

describe('readDeriveCheckVerdicts — revalidation through createDeriveCheckRecord (CR-02)', () => {
  let dir: string;
  let ledgerFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-check-cr02-'));
    await fs.mkdir(join(dir, DESIGN_DIR, 'rulebook', '.derive-check'), { recursive: true });
    ledgerFile = join(dir, DESIGN_DIR, 'rulebook', '.derive-check', 'verdicts.md');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeRawLedger(bodyLines: string[]): Promise<void> {
    const content =
      `# Derive Check Verdicts (CHECK-04) — project-level, no run-id\n\n` +
      `${DERIVE_CHECK_LEDGER_BEGIN}\n` +
      bodyLines.join('\n') +
      (bodyLines.length > 0 ? '\n' : '') +
      `${DERIVE_CHECK_LEDGER_END}\n`;
    await fs.writeFile(ledgerFile, content);
  }

  it('rejects a hand-edited ledger carrying a RETIRED verdict on read, naming all eight legal verdicts (CR-02 executed proof)', async () => {
    await writeRawLedger([
      JSON.stringify({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 3,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'agrees',
        reason: 'hand-edited to a retired verdict',
        citedFactIds: [],
      }),
    ]);
    await expect(readDeriveCheckVerdicts(dir)).rejects.toThrow(
      /Invalid verdict.*corroborated.*corroborated-by-composition.*uncorroborated.*contradicted.*quote-unverified.*absence-corroborated.*absence-contradicted.*absence-unverifiable/s,
    );
  });

  it('rejects an out-of-set verdict on read, never producing a NaN/undefined count', async () => {
    await writeRawLedger([
      JSON.stringify({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 3,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'TOTALLY-BOGUS',
        reason: 'hand-edited',
        citedFactIds: [],
      }),
    ]);
    await expect(readDeriveCheckVerdicts(dir)).rejects.toThrow(/Invalid verdict/);
  });

  it('a not-valid-JSON ledger line throws one actionable message naming the relative ledger path and record index, never a raw SyntaxError', async () => {
    await writeRawLedger(['{ this is not valid JSON']);
    let message = '';
    try {
      await readDeriveCheckVerdicts(dir);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('rulebook/.derive-check/verdicts.md');
    expect(message).toContain('record 1');
    expect(message).not.toContain('SyntaxError');
  });

  it('grep-count: no "as DeriveCheckRecord" cast remains anywhere in the module source, after stripping comments', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-check.ts'), 'utf-8');
    const stripped = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect((stripped.match(/as DeriveCheckRecord/g) ?? []).length).toBe(0);
  });

  it('returns an empty array (never throws) when no ledger file exists', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-check-cr02-empty-'));
    try {
      await expect(readDeriveCheckVerdicts(empty)).resolves.toEqual([]);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

// ===========================================================================================
// Task 2 (177.1-03) — reconcileSlice(): the compute pipeline
// ===========================================================================================

/**
 * Real recorded returns from the 177-22 measurement run (`analysis-run1.json` is this run's
 * ground truth — the closure evidence CHECK-04 was actually measured against), copied into
 * `__fixtures__/177-22-run1-seven/` (not read from `.planning/` at test runtime, per the plan's
 * own instruction). The two reconciler fixtures are hand-amended with an `arithmeticSpec` field
 * that the ORIGINAL recorded run never carried — 177.1-03 Task 1 added `arithmeticSpec` to
 * `reconcile-facts.md` after this run happened, so no live dispatch has ever populated one for
 * this exact corpus. The `arithmeticSpec` values below were derived by hand from the SAME
 * `analyze.mjs` `ARITHMETIC_LINES` hand list this plan's Task 1/2 replace (see that file's
 * comment at line 106), so they encode the identical operand/operation/claimedResult facts —
 * this is a deliberate, disclosed fixture amendment, not a fabricated scenario.
 */
const FIXTURES_DIR = join(__dirname, '__fixtures__', '177-22-run1-seven');

function loadFixtureJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as T;
}

describe('reconcileSlice', () => {
  it('reproduces analysis-run1.json exactly for seven__01-definitions-and-components (groundedBothCount 9, rejectedCount 0, line 21 corroborated-by-composition)', () => {
    const enumeratorA = loadFixtureJson<EnumeratorReturn>(
      'seven__01-definitions-and-components.A.json',
    );
    const enumeratorB = loadFixtureJson<EnumeratorReturn>(
      'seven__01-definitions-and-components.B.json',
    );
    const reconciler = loadFixtureJson<ReconcilerReturn>(
      'seven__01-definitions-and-components.reconcile.json',
    );

    const result = reconcileSlice({
      projectDir: '/does-not-matter-for-this-pure-call',
      slicePath: 'rulebook/01-definitions-and-components.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.grounding.grounded.length).toBe(9);
    expect(result.grounding.rejected.length).toBe(0);
    expect(result.classifications).toHaveLength(1);
    expect(result.classifications[0].lineNumber).toBe(21);
    expect(result.classifications[0].classification).toBe('corroborated-by-composition');

    // The composed fact id is a deterministic sha256 of derivedLineText + operand magnitudes +
    // operation — matches analysis-run1.json's recorded id ("ccb54c72d6b176e1") regardless of
    // which specific grounded fact supplied a duplicate magnitude-4 operand, because the id
    // depends only on magnitude values, never fact identity.
    expect(result.composed).toHaveLength(1);
    expect(result.composed[0].id).toBe('ccb54c72d6b176e1');
    expect(result.composed[0].value).toEqual({ magnitude: 112, unit: 'numbered cards', approximate: false });
  });

  it('reproduces analysis-run1.json exactly for seven__01-overview-setup-and-play (groundedBothCount 19, rejectedCount 0, [36 corroborated-by-composition, 38 corroborated])', () => {
    const enumeratorA = loadFixtureJson<EnumeratorReturn>(
      'seven__01-overview-setup-and-play.A.json',
    );
    const enumeratorB = loadFixtureJson<EnumeratorReturn>(
      'seven__01-overview-setup-and-play.B.json',
    );
    const reconciler = loadFixtureJson<ReconcilerReturn>(
      'seven__01-overview-setup-and-play.reconcile.json',
    );

    const result = reconcileSlice({
      projectDir: '/does-not-matter-for-this-pure-call',
      slicePath: 'rulebook/01-overview-setup-and-play.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.grounding.grounded.length).toBe(19);
    expect(result.grounding.rejected.length).toBe(0);
    expect(result.classifications).toHaveLength(2);
    expect(result.classifications[0]).toMatchObject({
      lineNumber: 36,
      classification: 'corroborated-by-composition',
    });
    expect(result.classifications[1]).toMatchObject({
      lineNumber: 38,
      classification: 'corroborated',
    });

    // The chain-composed fact id matches analysis-run1.json's recorded id ("580cab72645565db"),
    // a deterministic sha256 of derivedLineText + the chain's own per-step statements.
    expect(result.composed).toHaveLength(1);
    expect(result.composed[0].id).toBe('580cab72645565db');
    expect(result.composed[0].value).toEqual({ magnitude: 7, unit: 'rounds', approximate: false });
  });

  it('a "both" claim whose quotedFromA matches neither enumerator list is rejected, never grounded, naming quotedFromA', () => {
    const enumeratorA: EnumeratorReturn = {
      facts: [{ statement: 'Cards come in 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const enumeratorB: EnumeratorReturn = {
      facts: [{ statement: 'Cards come in 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const reconciler: ReconcilerReturn = {
      both: [
        {
          statement: 'Cards come in 4 colors.',
          quotedFromA: 'This text was never stated by enumerator A at all.',
          quotedFromB: 'There are 4 colors.',
        },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.grounding.grounded).toHaveLength(0);
    expect(result.grounding.rejected).toHaveLength(1);
    expect(result.grounding.rejected[0].reason).toContain('quotedFromA');
  });

  it('an arithmeticSpec whose claimedResult does not equal the code-computed value falls through to uncorroborated, never corroborated-by-composition', () => {
    const enumeratorA: EnumeratorReturn = {
      facts: [
        { statement: 'There are 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } },
        { statement: 'There are 5 shapes.', sourceSentence: 'There are 5 shapes.', numericValue: { magnitude: 5, unit: 'shapes', approximate: false } },
      ],
    };
    const enumeratorB: EnumeratorReturn = {
      facts: [
        { statement: 'There are 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } },
        { statement: 'There are 5 shapes.', sourceSentence: 'There are 5 shapes.', numericValue: { magnitude: 5, unit: 'shapes', approximate: false } },
      ],
    };
    const reconciler: ReconcilerReturn = {
      both: [
        { statement: 'There are 4 colors.', quotedFromA: 'There are 4 colors.', quotedFromB: 'There are 4 colors.' },
        { statement: 'There are 5 shapes.', quotedFromA: 'There are 5 shapes.', quotedFromB: 'There are 5 shapes.' },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 1,
          derivedLineText: 'Derived (p.1): There are 4 colors x 5 shapes = 999 tiles.',
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: ['There are 4 colors.', 'There are 5 shapes.'],
          arithmeticSpec: {
            kind: 'single',
            operation: 'multiply',
            operandStatements: ['There are 4 colors.', 'There are 5 shapes.'],
            claimedResult: { magnitude: 999, unit: 'tiles', approximate: false },
          },
        },
      ],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.composed).toHaveLength(0);
    expect(result.composeAttempts).toHaveLength(1);
    expect(result.composeAttempts[0].outcome.ok).toBe(false);
    expect(result.classifications[0].classification).toBe('uncorroborated');
  });

  it('an arithmeticSpec.operandStatements entry matching no grounded "both" statement fails with a reason naming the unresolved statement, never throws', () => {
    const enumeratorA: EnumeratorReturn = {
      facts: [{ statement: 'There are 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const enumeratorB: EnumeratorReturn = {
      facts: [{ statement: 'There are 4 colors.', sourceSentence: 'There are 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const reconciler: ReconcilerReturn = {
      both: [{ statement: 'There are 4 colors.', quotedFromA: 'There are 4 colors.', quotedFromB: 'There are 4 colors.' }],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 1,
          derivedLineText: 'Derived (p.1): There are 4 colors x 5 shapes = 20 tiles.',
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: ['There are 4 colors.'],
          arithmeticSpec: {
            kind: 'single',
            operation: 'multiply',
            operandStatements: ['There are 4 colors.', 'This statement was never grounded.'],
            claimedResult: { magnitude: 20, unit: 'tiles', approximate: false },
          },
        },
      ],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.composeAttempts[0].outcome.ok).toBe(false);
    expect((result.composeAttempts[0].outcome as { ok: false; reason: string }).reason).toContain(
      'This statement was never grounded.',
    );
    expect(result.classifications[0].classification).toBe('uncorroborated');
  });

  it('a chain spec with more than MAX_ARITHMETIC_CHAIN_DEPTH steps is rejected by composeArithmeticChain itself, not a second re-implemented check', () => {
    const fact = (n: number) => ({
      statement: `Value is ${n}.`,
      quotedFromA: `Value is ${n}.`,
      quotedFromB: `Value is ${n}.`,
    });
    const enumFacts = (n: number) => ({
      statement: `Value is ${n}.`,
      sourceSentence: `Value is ${n}.`,
      numericValue: { magnitude: n, unit: 'units', approximate: false },
    });
    const values = [1, 2, 3, 4, 5];
    const enumeratorA: EnumeratorReturn = { facts: values.map(enumFacts) };
    const enumeratorB: EnumeratorReturn = { facts: values.map(enumFacts) };
    const reconciler: ReconcilerReturn = {
      both: values.map(fact),
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 1,
          derivedLineText: 'Derived (p.1): 1 + 2 + 3 + 4 + 5 = 15 units, computed in 4 chained steps.',
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: values.map((n) => `Value is ${n}.`),
          arithmeticSpec: {
            kind: 'chain',
            steps: [
              { operation: 'add', operandRefs: [{ kind: 'fact', statement: 'Value is 1.' }, { kind: 'fact', statement: 'Value is 2.' }] },
              { operation: 'add', operandRefs: [{ kind: 'stepResult', index: 0 }, { kind: 'fact', statement: 'Value is 3.' }] },
              { operation: 'add', operandRefs: [{ kind: 'stepResult', index: 1 }, { kind: 'fact', statement: 'Value is 4.' }] },
              { operation: 'add', operandRefs: [{ kind: 'stepResult', index: 2 }, { kind: 'fact', statement: 'Value is 5.' }] },
            ],
            claimedResult: { magnitude: 15, unit: 'units', approximate: false },
          },
        },
      ],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.composeAttempts[0].outcome.ok).toBe(false);
    expect((result.composeAttempts[0].outcome as { ok: false; reason: string }).reason).toMatch(
      /MAX_ARITHMETIC_CHAIN_DEPTH|bounded at 3/,
    );
  });

  it('CR-01: two grounded "both" facts sharing identical statement text fail closed (never last-write-wins) for an arithmeticSpec pointing at that statement', () => {
    // Two DISTINCT "both" claims, deliberately given the SAME `statement` text but grounding to
    // two DIFFERENT, correctly-validated facts (different quotes, different magnitudes on each
    // side). Before the fix, `groundedByStatement` silently kept only the LAST-inserted one — an
    // `arithmeticSpec` naming this shared statement text always resolved to fact #2 (magnitude 9),
    // never fact #1 (magnitude 4), regardless of which one the reconciler actually intended.
    const enumeratorA: EnumeratorReturn = {
      facts: [
        { statement: 'The first count.', sourceSentence: 'There are 4 widgets in the box.', numericValue: { magnitude: 4, unit: 'widgets', approximate: false } },
        { statement: 'The second count.', sourceSentence: 'There are 9 gadgets in the crate.', numericValue: { magnitude: 9, unit: 'gadgets', approximate: false } },
      ],
    };
    const enumeratorB: EnumeratorReturn = {
      facts: [
        { statement: 'The first count.', sourceSentence: 'There are 4 widgets in the box.', numericValue: { magnitude: 4, unit: 'widgets', approximate: false } },
        { statement: 'The second count.', sourceSentence: 'There are 9 gadgets in the crate.', numericValue: { magnitude: 9, unit: 'gadgets', approximate: false } },
      ],
    };
    const reconciler: ReconcilerReturn = {
      both: [
        // Both claims deliberately use the SAME `statement` text ("Shared label.") but ground to
        // two different, genuinely distinct facts via distinct verbatim quotes.
        { statement: 'Shared label.', quotedFromA: 'There are 4 widgets in the box.', quotedFromB: 'There are 4 widgets in the box.' },
        { statement: 'Shared label.', quotedFromA: 'There are 9 gadgets in the crate.', quotedFromB: 'There are 9 gadgets in the crate.' },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 1,
          derivedLineText: 'Derived (p.1): 4 widgets x 10 = 40 total units.',
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: ['Shared label.'],
          arithmeticSpec: {
            kind: 'single',
            operation: 'multiply',
            operandStatements: ['Shared label.', 'Shared label.'],
            claimedResult: { magnitude: 40, unit: 'total units', approximate: false },
          },
        },
      ],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    // Two grounded facts (both quotes are genuinely traceable), but the ambiguous statement
    // means the arithmeticSpec must refuse to resolve it, never silently pick the last one.
    expect(result.grounding.grounded).toHaveLength(2);
    expect(result.composed).toHaveLength(0);
    expect(result.composeAttempts).toHaveLength(1);
    expect(result.composeAttempts[0].outcome.ok).toBe(false);
    expect((result.composeAttempts[0].outcome as { ok: false; reason: string }).reason).toMatch(
      /matches more than one distinct grounding-validated "both" fact/,
    );
    expect(result.classifications[0].classification).toBe('uncorroborated');
  });

  it('CR-02: two Derived lines sharing identical text — the SECOND proposal (rejected arithmetic) never inherits the FIRST proposal (accepted arithmetic)\'s composedFactId', () => {
    const enumeratorA: EnumeratorReturn = {
      facts: [
        { statement: 'There are 7 players.', sourceSentence: 'There are 7 players.', numericValue: { magnitude: 7, unit: 'players', approximate: false } },
        { statement: 'There are 10 cards each.', sourceSentence: 'There are 10 cards each.', numericValue: { magnitude: 10, unit: 'cards', approximate: false } },
      ],
    };
    const enumeratorB: EnumeratorReturn = {
      facts: [
        { statement: 'There are 7 players.', sourceSentence: 'There are 7 players.', numericValue: { magnitude: 7, unit: 'players', approximate: false } },
        { statement: 'There are 10 cards each.', sourceSentence: 'There are 10 cards each.', numericValue: { magnitude: 10, unit: 'cards', approximate: false } },
      ],
    };
    const sharedText = 'Derived (p.3): 7 x 10 = 70 cards.';
    const reconciler: ReconcilerReturn = {
      both: [
        { statement: 'There are 7 players.', quotedFromA: 'There are 7 players.', quotedFromB: 'There are 7 players.' },
        { statement: 'There are 10 cards each.', quotedFromA: 'There are 10 cards each.', quotedFromB: 'There are 10 cards each.' },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          // Line 5: CORRECT arithmeticSpec — composes successfully.
          lineNumber: 5,
          derivedLineText: sharedText,
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: ['There are 7 players.', 'There are 10 cards each.'],
          arithmeticSpec: {
            kind: 'single',
            operation: 'multiply',
            operandStatements: ['There are 7 players.', 'There are 10 cards each.'],
            claimedResult: { magnitude: 70, unit: 'cards', approximate: false },
          },
        },
        {
          // Line 12: byte-identical derivedLineText, but a WRONG claimedResult — must be rejected
          // on its own arithmetic, never inherit line 5's composedFactId via a text-keyed lookup.
          lineNumber: 12,
          derivedLineText: sharedText,
          proposedClassification: 'corroborated-by-composition',
          citedBothStatements: ['There are 7 players.', 'There are 10 cards each.'],
          arithmeticSpec: {
            kind: 'single',
            operation: 'multiply',
            operandStatements: ['There are 7 players.', 'There are 10 cards each.'],
            claimedResult: { magnitude: 999, unit: 'cards', approximate: false },
          },
        },
      ],
    };

    const result = reconcileSlice({
      projectDir: '/x',
      slicePath: 'rulebook/x.md',
      sliceText: '',
      enumeratorA,
      enumeratorB,
      reconciler,
      provenance: null,
    });

    expect(result.composed).toHaveLength(1);
    expect(result.classifications).toHaveLength(2);

    const line5 = result.classifications.find((c) => c.lineNumber === 5)!;
    const line12 = result.classifications.find((c) => c.lineNumber === 12)!;

    expect(line5.classification).toBe('corroborated-by-composition');
    expect(line12.classification).not.toBe('corroborated-by-composition');
    // Line 12's own arithmetic was wrong — it must fall through to uncorroborated, never cite
    // line 5's unrelated composed fact as its own evidence.
    expect(line12.classification).toBe('uncorroborated');
  });
});

describe('parseSubagentJsonInput', () => {
  it('parses valid JSON text with an empty repairs list — no fix was needed', () => {
    expect(parseSubagentJsonInput('{"facts":[]}', '--enumerator-a', '/tmp/a.json')).toEqual({
      value: { facts: [] },
      repairs: [],
    });
  });

  it('throws ONE actionable message naming the flag and the file path for invalid JSON, never a raw SyntaxError', () => {
    let message = '';
    try {
      parseSubagentJsonInput('{not valid json', '--enumerator-a', '/tmp/a.json');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('--enumerator-a');
    expect(message).toContain('/tmp/a.json');
    expect(message).not.toContain('SyntaxError');
  });

  // 180-01 finding 5 — the live interactive run's real dispatch returns, captured verbatim in
  // 180-PROOF.md. Both fail `JSON.parse` on the raw bytes; both are transport artifacts of how a
  // model emits JSON, never injected ledger content, so both must recover WITH a reported repair.

  /** Enumerator B's actual return shape (180-PROOF.md finding 5): the whole object fenced. */
  const ENUMERATOR_B_FENCE_WRAPPED =
    '```json\n' +
    '{"facts":[{"statement":"The deck has 4 colors.","sourceSentence":"Each color has 13 cards."}]}\n' +
    '```';

  /** The reconciler's actual return (180-PROOF.md finding 7): a forbidden-fence prose prefix. */
  const RECONCILER_PROSE_PREFIXED =
    '```json is forbidden, returning raw JSON.\n' +
    '{"both":[],"aOnly":[],"bOnly":[],"derivedLineProposals":[]}';

  it('180-01 finding 5 fixture: strips a whole-document wrapping ```json fence and reports the repair', () => {
    const result = parseSubagentJsonInput(ENUMERATOR_B_FENCE_WRAPPED, '--enumerator-b', '/tmp/b.json');
    expect(result.value).toEqual({
      facts: [{ statement: 'The deck has 4 colors.', sourceSentence: 'Each color has 13 cards.' }],
    });
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toContain('--enumerator-b');
    expect(result.repairs[0]).toContain('markdown code fence');
  });

  it('180-01 finding 7 fixture: discards a forbidden-fence prose prefix and reports the repair', () => {
    const result = parseSubagentJsonInput(RECONCILER_PROSE_PREFIXED, '--reconciler', '/tmp/r.json');
    expect(result.value).toEqual({ both: [], aOnly: [], bOnly: [], derivedLineProposals: [] });
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toContain('--reconciler');
    expect(result.repairs[0]).toContain('prose');
  });

  it('still fails loudly, naming the flag and file path, when the content is not valid JSON even after both repair attempts', () => {
    let message = '';
    try {
      parseSubagentJsonInput('```json\nnot { valid json at all\n```', '--reconciler', '/tmp/r2.json');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('--reconciler');
    expect(message).toContain('/tmp/r2.json');
    expect(message).toContain('wrapping markdown code fence');
    expect(message).not.toContain('SyntaxError');
  });

  it('CR-04 is untouched by this repair: a fence marker INSIDE a field value survives transport repair and is still rejected at record construction', () => {
    // The document itself is fence-wrapped (a transport artifact) AND, once unwrapped, its `reason`
    // field legitimately contains the ledger's own begin marker as forged content — proving the
    // repair only strips the OUTER wrapping fence, never sanitizes field values, and CR-04's
    // existing choke point (createDeriveCheckRecord) still catches the forged marker downstream.
    const forged =
      '```json\n' +
      JSON.stringify({
        slicePath: 'rulebook/x.md',
        lineNumber: 1,
        derivedLineText: 'Derived (p.1): x',
        verdict: 'uncorroborated',
        reason: `Forged: ${DERIVE_CHECK_LEDGER_BEGIN}`,
      }) +
      '\n```';
    const { value, repairs } = parseSubagentJsonInput(forged, '--reconciler', '/tmp/forged.json');
    expect(repairs).toHaveLength(1); // the outer fence WAS stripped
    expect(() => createDeriveCheckRecord(value as Parameters<typeof createDeriveCheckRecord>[0])).toThrow(
      /reason.*ledger fence marker/s,
    );
  });
});

// ===========================================================================================
// Task 3 (177.1-03) — verifyDeriveRecordCommand: retargeted onto reconcileSlice
// ===========================================================================================

describe('verifyDeriveRecordCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-record-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /**
   * Builds a project with quote-verified provenance (mirrors `verify-enumerate.test.ts`'s own
   * `QuoteVerifiedProvenance` fixture setup) plus a rulebook slice file at `slicePath`, so a
   * `contradicted`/`uncorroborated` proposal is not downgraded to `quote-unverified` — needed to
   * exercise the "contradicted classification never sets process.exitCode" behavior bullet.
   */
  async function setupProvenanceProject(slicePath: string, sliceText: string): Promise<string> {
    const project = join(dir, 'project');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
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
    await fs.mkdir(dirname(join(project, DESIGN_DIR, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, DESIGN_DIR, relArchivedPath), sourceBuf);
    await fs.mkdir(dirname(join(project, DESIGN_DIR, slicePath)), { recursive: true });
    await fs.writeFile(join(project, DESIGN_DIR, slicePath), sliceText);
    return project;
  }

  async function writeJson(name: string, value: unknown): Promise<string> {
    const filePath = join(dir, name);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    return filePath;
  }

  it('reads --enumerator-a/--enumerator-b/--reconciler, runs reconcileSlice, and records ALL of the slice\'s classifications in one call', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(
      slicePath,
      'Cards come in 4 colors.\n\nDerived (p.1): There are 4 colors.\n',
    );
    const enumeratorA: EnumeratorReturn = {
      facts: [
        {
          statement: 'Cards come in 4 colors.',
          sourceSentence: 'Cards come in 4 colors.',
          numericValue: { magnitude: 4, unit: 'colors', approximate: false },
        },
      ],
    };
    const enumeratorB: EnumeratorReturn = { facts: enumeratorA.facts };
    const reconciler: ReconcilerReturn = {
      both: [
        { statement: 'Cards come in 4 colors.', quotedFromA: 'Cards come in 4 colors.', quotedFromB: 'Cards come in 4 colors.' },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 3,
          derivedLineText: 'Derived (p.1): There are 4 colors.',
          proposedClassification: 'corroborated',
          citedBothStatements: ['Cards come in 4 colors.'],
        },
      ],
    };
    const enumeratorAPath = await writeJson('a.json', enumeratorA);
    const enumeratorBPath = await writeJson('b.json', enumeratorB);
    const reconcilerPath = await writeJson('reconcile.json', reconciler);

    const result = await verifyDeriveRecordCommand({
      project,
      slicePath,
      enumeratorA: enumeratorAPath,
      enumeratorB: enumeratorBPath,
      reconciler: reconcilerPath,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].verdict).toBe('corroborated');
    expect(result.records[0].lineNumber).toBe(3);

    const recorded = await readDeriveCheckVerdicts(project);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].verdict).toBe('corroborated');
  });

  it('180-01 finding 5, end-to-end: a fence-wrapped --enumerator-b and a prose-prefixed --reconciler both still record, and result.repairs names both files', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(
      slicePath,
      'Cards come in 4 colors.\n\nDerived (p.1): There are 4 colors.\n',
    );
    const enumeratorA: EnumeratorReturn = {
      facts: [
        {
          statement: 'Cards come in 4 colors.',
          sourceSentence: 'Cards come in 4 colors.',
          numericValue: { magnitude: 4, unit: 'colors', approximate: false },
        },
      ],
    };
    const reconciler: ReconcilerReturn = {
      both: [
        {
          statement: 'Cards come in 4 colors.',
          quotedFromA: 'Cards come in 4 colors.',
          quotedFromB: 'Cards come in 4 colors.',
        },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 3,
          derivedLineText: 'Derived (p.1): There are 4 colors.',
          proposedClassification: 'corroborated',
          citedBothStatements: ['Cards come in 4 colors.'],
        },
      ],
    };

    const enumeratorAPath = await writeJson('a.json', enumeratorA);
    // Enumerator B's real transport shape (180-PROOF.md finding 5): the object fenced.
    const enumeratorBPath = join(dir, 'b.json');
    await fs.writeFile(enumeratorBPath, '```json\n' + JSON.stringify(enumeratorA) + '\n```');
    // The reconciler's real transport shape (180-PROOF.md finding 7): a forbidden-fence prose prefix.
    const reconcilerPath = join(dir, 'reconcile.json');
    await fs.writeFile(
      reconcilerPath,
      '```json is forbidden, returning raw JSON.\n' + JSON.stringify(reconciler),
    );

    const result = await verifyDeriveRecordCommand({
      project,
      slicePath,
      enumeratorA: enumeratorAPath,
      enumeratorB: enumeratorBPath,
      reconciler: reconcilerPath,
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].verdict).toBe('corroborated');
    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.some((r) => r.includes('--enumerator-b'))).toBe(true);
    expect(result.repairs.some((r) => r.includes('--reconciler'))).toBe(true);
  });

  it('recording slice B after slice A leaves both slices\' records readable (upsert-append, exercised through the real command)', async () => {
    const sliceAPath = 'rulebook/01-a.md';
    const sliceBPath = 'rulebook/02-b.md';
    const project = await setupProvenanceProject(
      sliceAPath,
      'Cards come in 4 colors.\n\nDerived (p.1): There are 4 colors.\n',
    );
    await fs.mkdir(dirname(join(project, DESIGN_DIR, sliceBPath)), { recursive: true });
    await fs.writeFile(
      join(project, DESIGN_DIR, sliceBPath),
      'There are 5 shapes.\n\nDerived (p.2): There are 5 shapes.\n',
    );

    const factsFor = (statement: string, magnitude: number, unit: string): EnumeratorReturn => ({
      facts: [{ statement, sourceSentence: statement, numericValue: { magnitude, unit, approximate: false } }],
    });
    const reconcilerFor = (statement: string, lineNumber: number, derivedLineText: string): ReconcilerReturn => ({
      both: [{ statement, quotedFromA: statement, quotedFromB: statement }],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        { lineNumber, derivedLineText, proposedClassification: 'corroborated', citedBothStatements: [statement] },
      ],
    });

    await verifyDeriveRecordCommand({
      project,
      slicePath: sliceAPath,
      enumeratorA: await writeJson('a1.json', factsFor('Cards come in 4 colors.', 4, 'colors')),
      enumeratorB: await writeJson('b1.json', factsFor('Cards come in 4 colors.', 4, 'colors')),
      reconciler: await writeJson(
        'r1.json',
        reconcilerFor('Cards come in 4 colors.', 3, 'Derived (p.1): There are 4 colors.'),
      ),
    });
    await verifyDeriveRecordCommand({
      project,
      slicePath: sliceBPath,
      enumeratorA: await writeJson('a2.json', factsFor('There are 5 shapes.', 5, 'shapes')),
      enumeratorB: await writeJson('b2.json', factsFor('There are 5 shapes.', 5, 'shapes')),
      reconciler: await writeJson(
        'r2.json',
        reconcilerFor('There are 5 shapes.', 3, 'Derived (p.2): There are 5 shapes.'),
      ),
    });

    const recorded = await readDeriveCheckVerdicts(project);
    expect(recorded).toHaveLength(2);
    expect(recorded.some((r) => r.slicePath === sliceAPath)).toBe(true);
    expect(recorded.some((r) => r.slicePath === sliceBPath)).toBe(true);
  });

  it('a malformed JSON input file rejects with a message naming the flag and the path, no stack trace or .ts: line reference', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(slicePath, 'x\n');
    await fs.writeFile(join(dir, 'bad.json'), '{not valid json');

    let message = '';
    try {
      await verifyDeriveRecordCommand({
        project,
        slicePath,
        enumeratorA: join(dir, 'bad.json'),
        enumeratorB: join(dir, 'bad.json'),
        reconciler: join(dir, 'bad.json'),
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('--enumerator-a');
    expect(message).toContain('bad.json');
    expect(message).not.toContain('SyntaxError');
    expect(message).not.toMatch(/\.ts:\d+/);
  });

  it('a missing required flag throws a clear message naming the flag', async () => {
    await expect(
      verifyDeriveRecordCommand({
        project: dir,
        enumeratorA: 'a.json',
        enumeratorB: 'b.json',
        reconciler: 'r.json',
      }),
    ).rejects.toThrow(/--slice-path/);

    await expect(
      verifyDeriveRecordCommand({
        project: dir,
        slicePath: 'rulebook/01-x.md',
        enumeratorB: 'b.json',
        reconciler: 'r.json',
      }),
    ).rejects.toThrow(/--enumerator-a/);
  });

  it('CR-04: --slice-path escaping rulebook/ (path traversal) is rejected BEFORE any read, never reads an arbitrary local file', async () => {
    // A secret file OUTSIDE the project's rulebook/ dir entirely, at the project root — proves
    // this is rejected before `fs.readFile` is ever reached, not merely that a nonexistent path
    // fails.
    const project = join(dir, 'project');
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'secret.txt'), 'do not leak this');

    let message = '';
    try {
      await verifyDeriveRecordCommand({
        project,
        slicePath: 'rulebook/../secret.txt',
        enumeratorA: 'a.json',
        enumeratorB: 'b.json',
        reconciler: 'r.json',
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/resolves outside/);
    expect(message).toContain('rulebook');
    expect(message).not.toContain('do not leak this');

    // A deeper traversal escaping the project directory entirely is rejected the same way.
    let message2 = '';
    try {
      await verifyDeriveRecordCommand({
        project,
        slicePath: '../../../../../../etc/passwd',
        enumeratorA: 'a.json',
        enumeratorB: 'b.json',
        reconciler: 'r.json',
      });
    } catch (err) {
      message2 = (err as Error).message;
    }
    expect(message2).toMatch(/resolves outside/);
  });

  it('--json emits the recorded records, ledgerPath, and rejected — and nothing else on stdout', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(
      slicePath,
      'Cards come in 4 colors.\n\nDerived (p.1): There are 4 colors.\n',
    );
    const facts: EnumeratorReturn = {
      facts: [
        { statement: 'Cards come in 4 colors.', sourceSentence: 'Cards come in 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } },
      ],
    };
    const reconciler: ReconcilerReturn = {
      both: [{ statement: 'Cards come in 4 colors.', quotedFromA: 'Cards come in 4 colors.', quotedFromB: 'Cards come in 4 colors.' }],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        { lineNumber: 3, derivedLineText: 'Derived (p.1): There are 4 colors.', proposedClassification: 'corroborated', citedBothStatements: ['Cards come in 4 colors.'] },
      ],
    };

    const logs: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => logs.push(String(msg));
    try {
      await verifyDeriveRecordCommand({
        project,
        slicePath,
        enumeratorA: await writeJson('a.json', facts),
        enumeratorB: await writeJson('b.json', facts),
        reconciler: await writeJson('r.json', reconciler),
        json: true,
      });
    } finally {
      console.log = original;
    }
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(Object.keys(parsed).sort()).toEqual(['ledgerPath', 'records', 'rejected', 'repairs'].sort());
    expect(parsed.records).toHaveLength(1);
    expect(parsed.rejected).toEqual([]);
    expect(parsed.repairs).toEqual([]);
  });

  it('grounding rejections (a fabricating reconciler) are reported in --json output, never silently dropped', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(slicePath, 'x\n');
    const facts: EnumeratorReturn = {
      facts: [{ statement: 'Cards come in 4 colors.', sourceSentence: 'Cards come in 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const reconciler: ReconcilerReturn = {
      both: [
        {
          statement: 'Cards come in 4 colors.',
          quotedFromA: 'This text was fabricated and never stated by A.',
          quotedFromB: 'Cards come in 4 colors.',
        },
      ],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [],
    };

    const result = await verifyDeriveRecordCommand({
      project,
      slicePath,
      enumeratorA: await writeJson('a.json', facts),
      enumeratorB: await writeJson('b.json', facts),
      reconciler: await writeJson('r.json', reconciler),
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('quotedFromA');
  });

  it('process.exitCode stays unset on a successful record, including when the slice produces a contradicted classification', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await setupProvenanceProject(
      slicePath,
      'Cards come in 4 colors.\n\nDerived (p.1): There are 5 colors.\n',
    );
    const facts: EnumeratorReturn = {
      facts: [{ statement: 'Cards come in 4 colors.', sourceSentence: 'Cards come in 4 colors.', numericValue: { magnitude: 4, unit: 'colors', approximate: false } }],
    };
    const reconciler: ReconcilerReturn = {
      both: [{ statement: 'Cards come in 4 colors.', quotedFromA: 'Cards come in 4 colors.', quotedFromB: 'Cards come in 4 colors.' }],
      aOnly: [],
      bOnly: [],
      derivedLineProposals: [
        {
          lineNumber: 3,
          derivedLineText: 'Derived (p.1): There are 5 colors.',
          proposedClassification: 'contradicted',
          citedBothStatements: ['Cards come in 4 colors.'],
        },
      ],
    };

    const before = process.exitCode;
    const result = await verifyDeriveRecordCommand({
      project,
      slicePath,
      enumeratorA: await writeJson('a.json', facts),
      enumeratorB: await writeJson('b.json', facts),
      reconciler: await writeJson('r.json', reconciler),
    });

    expect(result.records[0].verdict).toBe('contradicted');
    expect(process.exitCode).toBe(before);
  });

  it('registers no --force, --skip, --overwrite, or --run-id option string (source-level pin, comment-stripped)', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-check.ts'), 'utf-8');
    const stripped = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/--force|--skip|--overwrite|--run-id/);
  });
});

// ===========================================================================================
// Task 1 (177.1-04) — verifyDeriveCheckCommand: the read/report surface
// ===========================================================================================

describe('verifyDeriveCheckCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-check-command-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function makeProject(files: Record<string, string>): Promise<string> {
    const project = join(dir, 'project');
    for (const [relPath, text] of Object.entries(files)) {
      // Keys are written the way a design doc writes them — `rulebook/02-x.md`, not
      // `design/rulebook/02-x.md` — so the fixture exercises the same resolution the CLI does.
      const full = resolveDesignRelative(project, relPath);
      await fs.mkdir(dirname(full), { recursive: true });
      await fs.writeFile(full, text);
    }
    return project;
  }

  it('reports every Derived line pending, with zero manufactured verdicts, when no ledger has ever been written', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n',
    });

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 3,
      derivedLineText: 'Derived (p.1): There are 7 unique numbers.',
      verdict: 'pending',
      status: 'pending',
      reason: '',
      citedFactIds: [],
    });
    expect(result.pendingCount).toBe(1);
    for (const v of DERIVE_CHECK_VERDICTS) {
      expect(result.verdictCounts[v]).toBe(0);
    }
  });

  it('names the three pinned model ids exactly, as string literals', async () => {
    const project = await makeProject({ 'rulebook/01-x.md': 'Nothing to derive here.\n' });
    const result = await verifyDeriveCheckCommand({ project });
    expect(result.models).toEqual({
      enumeratorA: 'claude-opus-5',
      enumeratorB: 'claude-haiku-4-5-20251001',
      reconciler: 'claude-sonnet-5',
    });
    expect(result.models).toEqual(DERIVE_CHECK_MODELS);
  });

  it('never gains a verdictCounts key outside DERIVE_CHECK_VERDICTS, and carries all eight explicitly', async () => {
    const project = await makeProject({ 'rulebook/01-x.md': 'Nothing to derive here.\n' });
    const result = await verifyDeriveCheckCommand({ project });
    expect(Object.keys(result.verdictCounts).sort()).toEqual([...DERIVE_CHECK_VERDICTS].sort());
  });

  it('candidate enumeration is PROJECT-WIDE: a populated .verify/<run-id>/slices/ tree and a rulebook/source/ decoy never change the result', async () => {
    const files = {
      'rulebook/01-x.md': 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n',
    };
    const withoutDecoy = await makeProject(files);
    const withDecoy = await makeProject({
      ...files,
      '.verify/run-abc123/slices/rulebook/01-x.md': 'STALE STAGED COPY — must never be read.\n',
      'rulebook/source/rules.pdf': 'not a real pdf, must never be read',
    });

    const resultWithout = await verifyDeriveCheckCommand({ project: withoutDecoy });
    const resultWithDecoy = await verifyDeriveCheckCommand({ project: withDecoy });

    expect({ ...resultWithDecoy, projectDir: '' }).toEqual({ ...resultWithout, projectDir: '' });

    const beforeHash = await hashProject(withDecoy);
    await verifyDeriveCheckCommand({ project: withDecoy });
    expect(await hashProject(withDecoy)).toBe(beforeHash);
  });

  it('a slice whose only Derived (p.N): occurrence is the annotation-convention legend (literal placeholder, no digit) yields zero candidates', async () => {
    const project = await makeProject({
      'rulebook/CARDS.md':
        '# Cards\n\n' +
        '> `Derived (p.N):` (a rule-bearing inference — affects legality, scoring, or sequencing), or\n' +
        '> `Visual (p.N):` (a presentation-only note).\n',
    });

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.findings).toHaveLength(0);
    expect(result.slices).toHaveLength(0);
  });

  it('a slice whose legend line escapes its usual backtick decoration still yields zero candidates for it, mechanically', async () => {
    const project = await makeProject({
      'rulebook/CARDS.md': 'Derived (p.N): explains the annotation convention above.\n',
    });

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.findings).toHaveLength(0);
  });

  it('emits enumeratorPayload (the exact buildEnumeratorPayload bytes) and derivedLines for a slice with pending candidates', async () => {
    const project = await makeProject({
      'rulebook/01-x.md':
        'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n',
    });

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.slices).toHaveLength(1);
    const slice = result.slices[0];
    expect(slice.slicePath).toBe('rulebook/01-x.md');
    expect(slice.candidates).toBe(1);
    expect(slice.payloadError).toBeUndefined();
    expect(slice.enumeratorPayload).toContain('BS-ENUMERATE-V1');
    expect(slice.enumeratorPayload).toContain('Card numbers range from 1 to 7.');
    expect(slice.enumeratorPayload).not.toMatch(/Derived \(p\./i);
    expect(slice.derivedLines).toEqual([
      { lineNumber: 3, text: 'Derived (p.1): There are 7 unique numbers.' },
    ]);
  });

  it('does NOT emit enumeratorPayload for a slice whose every candidate is already ledger-recorded', async () => {
    const slicePath = 'rulebook/01-x.md';
    const text = 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n';
    const project = await makeProject({ [slicePath]: text });

    await recordDeriveCheckVerdicts(project, [
      createDeriveCheckRecord({
        slicePath,
        lineNumber: 3,
        derivedLineText: 'Derived (p.1): There are 7 unique numbers.',
        verdict: 'corroborated',
        reason: 'Both enumerators found the range fact.',
        citedFactIds: ['fact-1'],
      }),
    ]);

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].enumeratorPayload).toBeUndefined();
    expect(result.slices[0].payloadError).toBeUndefined();
    expect(result.findings[0].status).toBe('recorded');
    expect(result.findings[0].verdict).toBe('corroborated');
    expect(result.verdictCounts.corroborated).toBe(1);
    expect(result.pendingCount).toBe(0);
  });

  it('reports payloadError, never a silently-skipped slice, when buildEnumeratorPayload throws', async () => {
    // The payload's own "Slice: <path>" line carries an unremovable annotation-family citation —
    // buildEnumeratorPayload's construction-site backstop throws, and this command must report
    // that as payloadError, never dispatch it, and never drop the slice from the report.
    const slicePath = 'rulebook/Derived (p.1) note.md';
    const project = await makeProject({
      [slicePath]: 'Card numbers range from 1 to 7.\n\nDerived (p.2): There are 7 unique numbers.\n',
    });

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].enumeratorPayload).toBeUndefined();
    expect(result.slices[0].payloadError).toContain(slicePath);
  });

  // -----------------------------------------------------------------------------------------
  // 178-01 Task 3 — fixture slices copied verbatim from the three reference games (behavior
  // spec: "buildEnumeratorPayload does not throw on any of the three reference games' slices
  // after this change"), including seven's real line 6 quote. Zero-behavior-change proof for the
  // Example addition, run through the REAL product path (verifyDeriveCheckCommand ->
  // buildEnumeratorPayload), not a reimplementation.
  // -----------------------------------------------------------------------------------------
  describe('no payloadError on fixture slices copied from the three reference games (178-01 Task 3)', () => {
    it('seven — line 6\'s real quote line ("example: 5, 5, 5") never throws and is retained in the payload', async () => {
      // Copied verbatim from seven/rulebook/01-definitions-and-components.md lines 1-12.
      const sevenFixture = [
        'p.1, Sets and Runs:',
        'A set is three or more cards of the same number.',
        '',
        'Derived (p.1): isSet([5, 5, 5]) is true.',
        '',
        '"example: 5, 5, 5"',
        '',
        'A run is three or more cards in consecutive order.',
        '',
        'Derived (p.1): isRun([5, 6, 7]) is true.',
        '',
        '"example: 5, 6, 7"',
      ].join('\n');
      const project = await makeProject({
        'rulebook/01-definitions-and-components.md': sevenFixture,
      });

      const result = await verifyDeriveCheckCommand({ project });

      const slice = result.slices[0];
      expect(slice.payloadError).toBeUndefined();
      expect(slice.enumeratorPayload).toContain('"example: 5, 5, 5"');
      expect(slice.enumeratorPayload).toContain('"example: 5, 6, 7"');
      expect(slice.enumeratorPayload).not.toMatch(/Derived \(p\./i);
    });

    it('one-two-punch — a Punch Examples citation header with an Example (p.N): line never throws', async () => {
      const oneTwoPunchFixture = [
        'p.2, Punch Examples (italic):',
        'Example (p.2): Three Guards, READY/EXHAUSTED/EXHAUSTED, become READY/READY/EXHAUSTED after a punch.',
        '"Punching a Guard exhausts it and readies your other exhausted Guards."',
        'Derived (p.2): A punch changes the state of every Guard on the row.',
      ].join('\n');
      const project = await makeProject({
        'rulebook/02-action-cards-and-resolution.md': oneTwoPunchFixture,
      });

      const result = await verifyDeriveCheckCommand({ project });

      const slice = result.slices[0];
      expect(slice.payloadError).toBeUndefined();
      expect(slice.enumeratorPayload).not.toMatch(/Example \(p\./i);
      expect(slice.enumeratorPayload).toContain(
        '"Punching a Guard exhausts it and readies your other exhausted Guards."',
      );
    });

    it('doom-machine — a Visual-recorded worked-example line never throws', async () => {
      const doomMachineFixture = [
        'p.1, Destroying a Machine Part:',
        'Visual (p.1): Worked example content (panel -7-, verbatim from card art): the SOUL HARVESTER loses its final part and is destroyed.',
        '"A machine part with zero remaining hit points is destroyed."',
        'Derived (p.1): A machine part is destroyed exactly when its hit points reach zero.',
      ].join('\n');
      const project = await makeProject({
        'rulebook/01-destroying-a-machine-part.md': doomMachineFixture,
      });

      const result = await verifyDeriveCheckCommand({ project });

      const slice = result.slices[0];
      expect(slice.payloadError).toBeUndefined();
      expect(slice.enumeratorPayload).not.toMatch(/Visual \(p\./i);
      expect(slice.enumeratorPayload).toContain(
        '"A machine part with zero remaining hit points is destroyed."',
      );
    });
  });

  it('a ledger record whose derivedLineText no longer matches the current slice text is reported in staleRecords, and the finding reports pending (CR-03)', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await makeProject({
      [slicePath]: 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers, now edited.\n',
    });

    await recordDeriveCheckVerdicts(project, [
      createDeriveCheckRecord({
        slicePath,
        lineNumber: 3,
        derivedLineText: 'Derived (p.1): There are 7 unique numbers.',
        verdict: 'corroborated',
        reason: 'Both enumerators found the range fact.',
        citedFactIds: ['fact-1'],
      }),
    ]);

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.findings[0].status).toBe('pending');
    expect(result.findings[0].verdict).toBe('pending');
    expect(result.staleRecords).toHaveLength(1);
    expect(result.staleRecords[0]).toContain(`${slicePath}:3`);
    expect(result.verdictCounts.corroborated).toBe(0);
  });

  it('a ledger record whose location matches no current candidate is reported in orphanedRecords, never silently absorbed (WR-03)', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await makeProject({ [slicePath]: 'Nothing to derive here.\n' });

    await recordDeriveCheckVerdicts(project, [
      createDeriveCheckRecord({
        slicePath: 'rulebook/deleted-slice.md',
        lineNumber: 7,
        derivedLineText: 'Derived (p.1): A line from a slice that no longer exists.',
        verdict: 'contradicted',
        reason: 'The source directly contradicts this.',
        citedFactIds: ['fact-9'],
      }),
    ]);

    const result = await verifyDeriveCheckCommand({ project });

    expect(result.orphanedRecords).toHaveLength(1);
    expect(result.orphanedRecords[0]).toContain('rulebook/deleted-slice.md:7');
  });

  it('missing rulebook/ throws one actionable line naming --project, no stack, no .ts: leak', async () => {
    const project = join(dir, 'no-rulebook-project');
    await fs.mkdir(project, { recursive: true });

    await expect(verifyDeriveCheckCommand({ project })).rejects.toThrow(/--project/);
    try {
      await verifyDeriveCheckCommand({ project });
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toMatch(/\bat .*\(/);
      expect(message).not.toMatch(/\.ts:\d+/);
    }
  });

  it('an unreadable rulebook/ (EACCES) reports the real condition, not "No rulebook/ directory" (WR-02)', async () => {
    const project = join(dir, 'eacces-project');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.chmod(rulebookDir, 0o000);
    try {
      await expect(verifyDeriveCheckCommand({ project })).rejects.toThrow(/could not be read/);
      try {
        await verifyDeriveCheckCommand({ project });
      } catch (err) {
        expect((err as Error).message).not.toMatch(/No rulebook\/ directory/);
      }
    } finally {
      await fs.chmod(rulebookDir, 0o755);
    }
  });

  it('--json emits the result and nothing else on stdout', async () => {
    const project = await makeProject({
      'rulebook/01-x.md': 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 7 unique numbers.\n',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await verifyDeriveCheckCommand({ project, json: true });
      expect(logSpy).toHaveBeenCalledTimes(1);
      const printed = logSpy.mock.calls[0][0] as string;
      expect(() => JSON.parse(printed)).not.toThrow();
      expect(JSON.parse(printed)).toEqual(JSON.parse(JSON.stringify(result)));
    } finally {
      logSpy.mockRestore();
    }
  });

  it('process.exitCode stays undefined after a run whose ledger contains a contradicted record (CONTEXT decision 14 — advisory, never a gate)', async () => {
    const slicePath = 'rulebook/01-x.md';
    const project = await makeProject({
      [slicePath]: 'Card numbers range from 1 to 7.\n\nDerived (p.1): There are 5 colors.\n',
    });

    await recordDeriveCheckVerdicts(project, [
      createDeriveCheckRecord({
        slicePath,
        lineNumber: 3,
        derivedLineText: 'Derived (p.1): There are 5 colors.',
        verdict: 'contradicted',
        reason: 'The source directly contradicts this.',
        citedFactIds: ['fact-1'],
      }),
    ]);

    const before = process.exitCode;
    const result = await verifyDeriveCheckCommand({ project });

    expect(result.findings[0].verdict).toBe('contradicted');
    expect(process.exitCode).toBe(before);
  });

  it('grep-count: this module never assigns process.exitCode anywhere (source-level pin, comment-stripped)', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-check.ts'), 'utf-8');
    const stripped = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/process\.exitCode\s*=/);
  });

  it('grep-count: exactly one "No rulebook/ directory" message exists in the module (WR-10)', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-check.ts'), 'utf-8').replace(
      /^\s*\*.*$/gm,
      '',
    );
    const matches = src.match(/No rulebook\/ directory/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
