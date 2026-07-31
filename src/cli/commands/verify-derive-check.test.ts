import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DERIVE_CHECK_VERDICTS,
  DERIVE_CHECK_LEDGER_BEGIN,
  DERIVE_CHECK_LEDGER_END,
  createDeriveCheckRecord,
  deriveCheckLedgerPath,
  replaceDeriveCheckVerdicts,
  recordDeriveCheckVerdicts,
  readDeriveCheckVerdicts,
  type DeriveCheckRecord,
} from './verify-derive-check.js';

/**
 * `verify-derive-check.ts` is CHECK-04's mechanical core, MOVED and retargeted onto the closed
 * dual-enumeration verdict set (177.1-02). Every fixture here is a real filesystem temp dir
 * (`fs.mkdtemp`, no mocks) — mirroring `verify-derive-recheck.test.ts`'s own discipline so the
 * moved invariants are visibly the same proofs, just against eight verdicts instead of four.
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
    expect(ledgerPath).toBe('rulebook/.derive-check/verdicts.md');
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
    await fs.mkdir(join(dir, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(dir, 'rulebook', '01-x.md'), 'p.1, X:\n"112 cards total."');
    await fs.writeFile(join(dir, 'rulebook', 'source', 'rules.pdf'), 'not a real pdf, but bytes');
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
      [join(dir, 'rulebook', '01-x.md'), join(dir, 'rulebook', 'source', 'rules.pdf')].sort(),
    );

    const afterSourceHash = await hashProject(join(dir, 'rulebook', 'source'));
    const beforeSourceHash = await hashProject(join(dir, 'rulebook', 'source'));
    expect(afterSourceHash).toBe(beforeSourceHash);
    void beforeHash;

    // No .tmp/partial file survives anywhere in the ledger directory.
    const ledgerDirFiles = await fs.readdir(join(dir, 'rulebook', '.derive-check'));
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
    await fs.mkdir(join(dir, 'rulebook', '.derive-check'), { recursive: true });
    ledgerFile = join(dir, 'rulebook', '.derive-check', 'verdicts.md');
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
