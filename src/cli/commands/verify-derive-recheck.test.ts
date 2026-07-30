import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DERIVE_VERDICTS,
  BLIND_DERIVE_TOKEN,
  createDeriveVerdictRecord,
  readLiveSlices,
  quoteLinesOnly,
  enumerateDerivedLines,
  buildBlindDerivePayload,
  recordDeriveVerdicts,
  readDeriveVerdicts,
  type DerivedLineEntry,
  type DeriveVerdictRecord,
} from './verify-derive-recheck.js';

/**
 * `verify-derive-recheck.ts` is CHECK-04's mechanical core (177-CONTEXT.md decision 2/5). Every
 * fixture here is either a real filesystem temp dir (`fs.mkdtemp`, no mocks) or the REAL archived
 * live slices Phase 174 committed and Phase 177's context/research directly measured — never
 * invented slice bodies for the corpus-wide leak-proof assertions this plan pins.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES_ROOT = join(
  __dirname,
  '../../../.planning/phases/174-verify-classifier/174-FIXTURES',
);

async function readFixture(relPath: string): Promise<string> {
  return fs.readFile(join(FIXTURES_ROOT, relPath), 'utf-8');
}

/** The real rule-bearing live slice files for each pinned reference game (174-FIXTURES). */
const GAME_FILES: Record<string, string[]> = {
  seven: ['01-definitions-and-components.md', '01-overview-setup-and-play.md', '02-solo-variant.md'],
  'one-two-punch': ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'],
};

async function loadGameSlices(game: string): Promise<{ path: string; text: string }[]> {
  return Promise.all(
    GAME_FILES[game].map(async (name) => ({
      path: `rulebook/${name}`,
      text: await readFixture(`${game}/live/${name}`),
    })),
  );
}

/** Strips `/* *\/` block comments and `//` line comments so a source assertion never
 * false-positives on this module's own doc comments (176-01's established technique). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ===========================================================================================
// Task 1 — DERIVE_VERDICTS and the single record-construction choke point
// ===========================================================================================

describe('DERIVE_VERDICTS', () => {
  it('is the locked four-member enum, frozen, in order', () => {
    expect(DERIVE_VERDICTS).toEqual(['agrees', 'disagrees', 'underivable', 'not-rule-bearing']);
    expect(Object.isFrozen(DERIVE_VERDICTS)).toBe(true);
  });
});

describe('createDeriveVerdictRecord', () => {
  it('throws for a verdict outside DERIVE_VERDICTS, naming all four legal verdicts', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): x',
        verdict: 'probably-agrees',
        reasoning: 'x',
      }),
    ).toThrow(/Invalid verdict.*agrees.*disagrees.*underivable.*not-rule-bearing/s);
  });

  it('throws for an empty/whitespace reasoning string', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): x',
        verdict: 'agrees',
        reasoning: '   ',
      }),
    ).toThrow(/no recorded reasoning/);
  });

  it('underivable constructs successfully and round-trips unchanged, never rewritten to agrees or disagrees', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 21,
      originalLine: 'Derived (p.1): The full deck is therefore 112 numbered cards.',
      verdict: 'underivable',
      reasoning: 'The supporting fact is itself a diagram-description Derived line, not a quote.',
    });
    expect(record.verdict).toBe('underivable');
  });

  it('not-rule-bearing constructs successfully with no rederivedReading required', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 33,
      originalLine: 'Derived (p.1): Card art is minimal and bold.',
      verdict: 'not-rule-bearing',
      reasoning: 'A pure art/layout description; no rule to re-derive.',
    });
    expect(record.verdict).toBe('not-rule-bearing');
    expect(record.rederivedReading).toBeUndefined();
  });

  it('disagrees requires both-derivations quoted verbatim: throws with empty originalReading', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 21,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'disagrees',
        reasoning: 'The counts differ.',
        originalReading: '',
        rederivedReading: '96 cards.',
      }),
    ).toThrow(/no originalReading quoted verbatim/);
  });

  it('disagrees requires both-derivations quoted verbatim: throws with empty rederivedReading', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 21,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'disagrees',
        reasoning: 'The counts differ.',
        originalReading: '112 cards.',
        rederivedReading: '   ',
      }),
    ).toThrow(/no rederivedReading quoted verbatim/);
  });

  it('disagrees succeeds when both-derivations readings are non-empty', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 21,
      originalLine: 'Derived (p.1): 112 cards.',
      verdict: 'disagrees',
      reasoning: 'The counts differ.',
      originalReading: '112 cards.',
      rederivedReading: '96 cards.',
    });
    expect(record.originalReading).toBe('112 cards.');
    expect(record.rederivedReading).toBe('96 cards.');
  });

  it('verify-derive-recheck.ts contains no rule-bearingness keyword or phrase-list (no-phrase-list)', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-recheck.ts'), 'utf-8');
    const RULE_BEARINGNESS_PHRASE_MARKERS = [
      'RULE_BEARING_KEYWORDS',
      'RULE_BEARINGNESS_PHRASES',
      'ruleBearingKeywords',
      'is rule-bearing if',
    ];
    for (const marker of RULE_BEARINGNESS_PHRASE_MARKERS) {
      expect(src).not.toContain(marker);
    }
    expect(src).not.toMatch(/RULE_BEARING(?:NESS)?_(?:KEYWORDS|PHRASES|MARKERS)/);
  });
});

// ===========================================================================================
// Task 2 — quoteLinesOnly, buildBlindDerivePayload, and live-slice enumeration
// ===========================================================================================

describe('readLiveSlices', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-'));
    await fs.mkdir(join(dir, 'rulebook'));
    await fs.writeFile(join(dir, 'rulebook', 'INDEX.md'), '# index');
    await fs.writeFile(join(dir, 'rulebook', '00-visual-survey.md'), '# visual survey');
    await fs.writeFile(join(dir, 'rulebook', '01-setup.md'), 'p.1, Setup:\n"Deal 7 cards."');
    await fs.writeFile(join(dir, 'rulebook', '02-play.md'), 'p.2, Play:\n"Draw a card."');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('excludes INDEX.md and 00-visual-survey.md, reading the two real rule slices', async () => {
    const slices = await readLiveSlices(dir);
    const paths = slices.map((s) => s.path).sort();
    expect(paths).toEqual(['rulebook/01-setup.md', 'rulebook/02-play.md']);
  });

  it('throws a single actionable line when the project has no rulebook/ directory', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-empty-'));
    try {
      await expect(readLiveSlices(empty)).rejects.toThrow(/No rulebook\/ directory/);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe('quoteLinesOnly', () => {
  it('retains bare citation headers and quoted rulebook prose beneath them', () => {
    const quotes = quoteLinesOnly('p.1, Distribution of Cards:\n"There are 112 cards total."');
    expect(quotes).toEqual(['p.1, Distribution of Cards:', '"There are 112 cards total."']);
  });

  it('strips Visual (p. lines entirely (visual)', () => {
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

  it('over every committed live slice in both games, zero lines start with Derived (p. or Visual (p.', async () => {
    for (const game of Object.keys(GAME_FILES)) {
      const slices = await loadGameSlices(game);
      for (const slice of slices) {
        const quotes = quoteLinesOnly(slice.text);
        expect(quotes.filter((l) => l.startsWith('Derived (p.'))).toHaveLength(0);
        expect(quotes.filter((l) => l.startsWith('Visual (p.'))).toHaveLength(0);
      }
    }
  });

  it('never returns empty on a real slice — not so aggressive it strips everything', async () => {
    for (const game of Object.keys(GAME_FILES)) {
      const slices = await loadGameSlices(game);
      for (const slice of slices) {
        expect(quoteLinesOnly(slice.text).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('enumerateDerivedLines', () => {
  it('yields exactly 10 total Derived lines for seven and 12 for one-two-punch (22 total)', async () => {
    const sevenSlices = await loadGameSlices('seven');
    const otpSlices = await loadGameSlices('one-two-punch');

    const sevenResult = enumerateDerivedLines(sevenSlices);
    const otpResult = enumerateDerivedLines(otpSlices);

    const sevenTotal = sevenResult.candidates.length + sevenResult.excluded.length;
    const otpTotal = otpResult.candidates.length + otpResult.excluded.length;

    expect(sevenTotal).toBe(10);
    expect(otpTotal).toBe(12);
    expect(sevenTotal + otpTotal).toBe(22);
  });

  it('never treats a Visual (p. line as a Derived line (visual)', () => {
    const slices = [{ path: 'rulebook/synthetic.md', text: 'Visual (p.5): some art description.' }];
    const result = enumerateDerivedLines(slices);
    expect(result.candidates).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
  });

  it('records 1-based line numbers and verbatim text for a real candidate', async () => {
    const slices = await loadGameSlices('seven');
    const result = enumerateDerivedLines(slices);
    const entry = [...result.candidates, ...result.excluded][0];
    expect(entry.lineNumber).toBeGreaterThan(0);
    expect(entry.text.startsWith('Derived (p.')).toBe(true);
  });
});

describe('buildBlindDerivePayload', () => {
  it('carries the BS-DERIVE-V1 handshake token', () => {
    const slice = { path: 'rulebook/01-x.md', text: 'p.1, X:\n"quoted."' };
    const entry: DerivedLineEntry = { slicePath: slice.path, lineNumber: 3, text: 'Derived (p.1): x' };
    const payload = buildBlindDerivePayload(slice, entry);
    expect(payload).toContain(BLIND_DERIVE_TOKEN);
  });

  it('for every one of the 22 real Derived lines, contains zero Derived (p. and zero Visual (p. occurrences (blind)', async () => {
    let checked = 0;
    for (const game of Object.keys(GAME_FILES)) {
      const slices = await loadGameSlices(game);
      const sliceByPath = new Map(slices.map((s) => [s.path, s] as const));
      const { candidates, excluded } = enumerateDerivedLines(slices);
      for (const entry of [...candidates, ...excluded]) {
        const slice = sliceByPath.get(entry.slicePath);
        expect(slice).toBeDefined();
        const payload = buildBlindDerivePayload(slice!, entry);
        const derivedCount = (payload.match(/Derived \(p\./g) ?? []).length;
        const visualCount = (payload.match(/Visual \(p\./g) ?? []).length;
        expect(derivedCount).toBe(0);
        expect(visualCount).toBe(0);
        expect(payload).not.toContain(entry.text);
        checked++;
      }
    }
    expect(checked).toBe(22);
  });

  it('never leaks the entry own originalLine text into the payload', () => {
    const slice = {
      path: 'rulebook/01-x.md',
      text: 'p.1, X:\n"A 112-card deck."\n\nDerived (p.1): 112 cards total.',
    };
    const entry: DerivedLineEntry = {
      slicePath: slice.path,
      lineNumber: 4,
      text: 'Derived (p.1): 112 cards total.',
    };
    const payload = buildBlindDerivePayload(slice, entry);
    expect(payload).not.toContain(entry.text);
  });
});

describe('module source guarantees', () => {
  it('never constructs a .verify/ staging path in code, and does not import resolveFreshTranscription (live)', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-recheck.ts'), 'utf-8');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('.verify');
    const importLines = src
      .split('\n')
      .filter((l) => l.trim().startsWith('import'))
      .join('\n');
    expect(importLines).not.toContain('resolveFreshTranscription');
  });

  it('never calls fs.writeFile/writeFileSync directly — atomicWriteFile is the only durable write', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-recheck.ts'), 'utf-8');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toMatch(/[^.]writeFile\(/);
    expect(codeOnly).not.toContain('writeFileSync(');
  });

});

// ===========================================================================================
// Task 1 (continued) — the project-level ledger through the one atomic write path
// ===========================================================================================

/** Whole-project content hash: every file's relative path + bytes, in sorted order. */
async function hashProject(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.slice(root.length));
    hash.update(await fs.readFile(f));
  }
  return hash.digest('hex');
}

function sampleUnderivableRecord(): DeriveVerdictRecord {
  return createDeriveVerdictRecord({
    slicePath: 'rulebook/01-x.md',
    lineNumber: 7,
    originalLine: 'Derived (p.1): The box contains 112 cards.',
    verdict: 'underivable',
    reasoning: 'The supporting fact is itself a diagram-description Derived line, not a quote.',
  });
}

function sampleDisagreesRecord(): DeriveVerdictRecord {
  return createDeriveVerdictRecord({
    slicePath: 'rulebook/01-x.md',
    lineNumber: 12,
    originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
    verdict: 'disagrees',
    reasoning: 'The quote lines say 7, not 8.',
    originalReading: 'Each player has 8 Action Cards.',
    rederivedReading: 'Each player has 7 Action Cards, per the quoted distribution table.',
  });
}

describe('recordDeriveVerdicts / readDeriveVerdicts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-ledger-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips exactly what was written, including an underivable record', async () => {
    const records = [sampleUnderivableRecord(), sampleDisagreesRecord()];
    await recordDeriveVerdicts(dir, records);

    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual(records);
    expect(read.some((r) => r.verdict === 'underivable')).toBe(true);
  });

  it('returns an empty array when no ledger has ever been written', async () => {
    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual([]);
  });

  it('re-recording REPLACES the body atomically — no leftover from the first write', async () => {
    await recordDeriveVerdicts(dir, [sampleUnderivableRecord()]);
    await recordDeriveVerdicts(dir, [sampleDisagreesRecord()]);

    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual([sampleDisagreesRecord()]);
    expect(read.some((r) => r.verdict === 'underivable')).toBe(false);
  });

  it('is project-level: no run-id segment in the ledger path, and neither function accepts a runId', async () => {
    const { ledgerPath } = await recordDeriveVerdicts(dir, [sampleUnderivableRecord()]);
    expect(ledgerPath).not.toContain('.verify');
    expect(ledgerPath).not.toMatch(/run-?[Ii]d/);
    expect(ledgerPath).toBe('rulebook/.derive-recheck/DERIVE-VERDICTS.md');

    // 2-arity (projectDir, records) / 1-arity (projectDir) — no runId parameter slot exists.
    expect(recordDeriveVerdicts.length).toBe(2);
    expect(readDeriveVerdicts.length).toBe(1);
  });

  it('source-free: a whole-project byte hash before vs. after recording differs ONLY under rulebook/.derive-recheck/, and the archive decoy is never touched', async () => {
    // Seed a project shaped like a real bs-project: a live slice, plus a decoy at an
    // archive-shaped path (`rulebook/source/...`) this module must never open or write.
    await fs.mkdir(join(dir, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(dir, 'rulebook', '01-x.md'), 'p.1, X:\n"112 cards total."');
    await fs.writeFile(join(dir, 'rulebook', 'source', 'rules.pdf'), 'not a real pdf, but bytes');
    const archiveHashBefore = await hashProject(join(dir, 'rulebook', 'source'));
    const sliceHashBefore = await fs.readFile(join(dir, 'rulebook', '01-x.md'), 'utf-8');

    await recordDeriveVerdicts(dir, [sampleUnderivableRecord()]);

    const archiveHashAfter = await hashProject(join(dir, 'rulebook', 'source'));
    const sliceHashAfter = await fs.readFile(join(dir, 'rulebook', '01-x.md'), 'utf-8');
    expect(archiveHashAfter).toBe(archiveHashBefore);
    expect(sliceHashAfter).toBe(sliceHashBefore);

    // Only rulebook/.derive-recheck/ is new — confirm by walking the whole project and
    // checking every changed/new file lives under that one directory.
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
    const outsideLedgerDir = allFiles.filter(
      (f) => !f.includes(join('rulebook', '.derive-recheck')),
    );
    // Every file outside the ledger dir is one of the two seeded, untouched files.
    expect(outsideLedgerDir.sort()).toEqual(
      [join(dir, 'rulebook', '01-x.md'), join(dir, 'rulebook', 'source', 'rules.pdf')].sort(),
    );
  });
});
