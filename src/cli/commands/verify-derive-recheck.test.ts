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
  annotationBody,
  replaceDeriveVerdicts,
  recordDeriveVerdict,
  readDeriveVerdicts,
  verifyDeriveRecheckCommand,
  verifyDeriveRecordCommand,
  formatReading,
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
        rederivedValue: 'x',
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
        rederivedValue: 'x',
        sourceQuotes: ['some quote'],
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
      rederivedValue: 'underivable',
    });
    expect(record.verdict).toBe('underivable');
    expect(record.rederivedValue).toBe('underivable');
  });

  it('not-rule-bearing constructs successfully with no rederivedReading required', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 33,
      originalLine: 'Derived (p.1): Card art is minimal and bold.',
      verdict: 'not-rule-bearing',
      reasoning: 'A pure art/layout description; no rule to re-derive.',
      rederivedValue: 'not-rule-bearing',
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
        rederivedValue: '96 cards.',
        originalReading: '',
        rederivedReading: '96 cards.',
        sourceQuotes: ['a source quote'],
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
        rederivedValue: '96 cards.',
        originalReading: '112 cards.',
        rederivedReading: '   ',
        sourceQuotes: ['a source quote'],
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
      rederivedValue: '96 cards.',
      originalReading: '112 cards.',
      rederivedReading: '96 cards.',
      sourceQuotes: ['There are 96 cards in the box.'],
    });
    expect(record.originalReading).toBe('112 cards.');
    expect(record.rederivedReading).toBe('96 cards.');
    expect(record.rederivedValue).toBe('96 cards.');
  });

  it('throws when reasoning contains the ledger BEGIN fence marker, naming the field "reasoning"', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): x',
        verdict: 'not-rule-bearing',
        reasoning: 'Forged: <!-- boardsmith:derive-verdicts:begin -->',
        rederivedValue: 'not-rule-bearing',
      }),
    ).toThrow(/reasoning.*ledger fence marker/s);
  });

  it('throws when reasoning contains the ledger END fence marker (CR-04, the corrupting shape)', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): x',
        verdict: 'not-rule-bearing',
        reasoning: 'Forged: <!-- boardsmith:derive-verdicts:end -->',
        rederivedValue: 'not-rule-bearing',
      }),
    ).toThrow(/reasoning.*ledger fence marker/s);
  });

  it('throws when originalReading or rederivedReading contains a ledger fence marker', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 21,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'disagrees',
        reasoning: 'The counts differ.',
        rederivedValue: '96 cards.',
        originalReading: '112 cards. <!-- boardsmith:derive-verdicts:end -->',
        rederivedReading: '96 cards.',
        sourceQuotes: ['a quote'],
      }),
    ).toThrow(/originalReading.*ledger fence marker/s);
  });

  it('throws when verdict is agrees and sourceQuotes is absent (WR-05)', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'agrees',
        reasoning: 'They match.',
        rederivedValue: '112 cards.',
      }),
    ).toThrow(/"agrees" verdict has no sourceQuotes cited/);
  });

  it('throws when verdict is agrees and sourceQuotes is an empty array', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'agrees',
        reasoning: 'They match.',
        rederivedValue: '112 cards.',
        sourceQuotes: [],
      }),
    ).toThrow(/"agrees" verdict has no sourceQuotes cited/);
  });

  it('throws when verdict is agrees and sourceQuotes contains only whitespace entries', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'agrees',
        reasoning: 'They match.',
        rederivedValue: '112 cards.',
        sourceQuotes: ['   ', ''],
      }),
    ).toThrow(/"agrees" verdict has no sourceQuotes cited/);
  });

  it('accepts an agrees record with a non-empty sourceQuotes entry', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      originalLine: 'Derived (p.1): 112 cards.',
      verdict: 'agrees',
      reasoning: 'They match.',
      rederivedValue: '112 cards.',
      sourceQuotes: ['There are 112 cards in the box.'],
    });
    expect(record.verdict).toBe('agrees');
  });

  it('accepts an underivable record whose sourceQuotes is empty (nothing to cite)', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      originalLine: 'Derived (p.1): 112 cards.',
      verdict: 'underivable',
      reasoning: 'Nothing in the quote lines supports this.',
      rederivedValue: 'underivable',
      sourceQuotes: [],
    });
    expect(record.verdict).toBe('underivable');
    expect(record.sourceQuotes).toEqual([]);
  });

  it('throws when rederivedValue is "underivable" but verdict is "agrees" (WR-04, the blind pass-through)', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'agrees',
        reasoning: 'Re-adjudicated as agrees anyway.',
        rederivedValue: 'underivable',
        sourceQuotes: ['a quote'],
      }),
    ).toThrow(/blind derivation returned "underivable".*comparison returned "agrees"/s);
  });

  it('throws when rederivedValue is "not-rule-bearing" but verdict is "disagrees" (WR-04)', () => {
    expect(() =>
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 5,
        originalLine: 'Derived (p.1): 112 cards.',
        verdict: 'disagrees',
        reasoning: 'Re-adjudicated as disagrees anyway.',
        rederivedValue: 'not-rule-bearing',
        originalReading: '112 cards.',
        rederivedReading: '96 cards.',
        sourceQuotes: ['a quote'],
      }),
    ).toThrow(/blind derivation returned "not-rule-bearing".*comparison returned "disagrees"/s);
  });

  it('accepts a record whose rederivedValue and verdict both equal "underivable" (the legal pass-through)', () => {
    const record = createDeriveVerdictRecord({
      slicePath: 'rulebook/01-x.md',
      lineNumber: 5,
      originalLine: 'Derived (p.1): 112 cards.',
      verdict: 'underivable',
      reasoning: 'The blind stage could not derive this either.',
      rederivedValue: 'underivable',
    });
    expect(record.verdict).toBe('underivable');
  });

  // 177-08 (closing WR-11): this genuinely IS a source-text property with no behavioral
  // equivalent, so it is deliberately kept — the sole surviving source-text assertion in this
  // file. The four tautological `readFileSync`-and-grep tests in "module source guarantees" below
  // were replaced with behavioral assertions; this one has no behavior to assert instead.
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

  // 177-08 (closing CR-01/WR-11): the `>` blockquote decoration shape below is not invented — it
  // is the SAME decoration the real committed live corpus already emits at
  // 174-FIXTURES/seven/live/01-overview-setup-and-play.md:30 (`> Variant (p.1): Match Length — ...`).
  // That proves blockquote-decorated annotation lines are a real transcription output of this
  // pipeline, not a hypothetical. This case applies the identical decoration to a `Derived` line.
  it('174-FIXTURES/seven/live/01-overview-setup-and-play.md:30 proves the blockquote decoration shape is real: a blockquote-decorated Derived line leaks zero annotation-family matches into the payload and is enumerated as a candidate', () => {
    const decoratedLine = '> Derived (p.1): SECRET blockquote derivation, never dispatched.';
    const slice = {
      path: 'rulebook/01-y.md',
      text: `p.1, X:\n"A real quoted sentence."\n\n${decoratedLine}`,
    };
    const { candidates, excluded } = enumerateDerivedLines([slice]);
    const all = [...candidates, ...excluded];
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe(decoratedLine);
    expect(candidates).toHaveLength(1);

    const payload = buildBlindDerivePayload(slice, all[0]);
    expect(payload.match(/Derived \(p\./g)).toBeNull();
    expect(payload.match(/Visual \(p\./g)).toBeNull();
    expect(payload).not.toContain('SECRET blockquote derivation');
  });

  it('a slice with three Derived lines — bare, blockquote-decorated, list-decorated — enumerates all three as candidates, not one (silent-drop regression)', () => {
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

  it('a `Derived (p.1, continues on p.2):` multi-page citation line is a candidate and is absent from the payload (WR-01)', () => {
    const decoratedLine = 'Derived (p.1, continues on p.2): a multi-page citation body.';
    const slice = {
      path: 'rulebook/01-w.md',
      text: `p.1, X:\n"A real quoted sentence."\n\n${decoratedLine}`,
    };
    const { candidates } = enumerateDerivedLines([slice]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe(decoratedLine);

    const payload = buildBlindDerivePayload(slice, candidates[0]);
    expect(payload).not.toContain('a multi-page citation body');
    expect(payload.match(/Derived \(p\./g)).toBeNull();
  });

  // The construction-site backstop (177-08, closing CR-01) is independent of the prefix regexes:
  // it must catch a leak `quoteLinesOnly` itself cannot anticipate — here, a directly-quoted
  // sentence whose OWN prose happens to mention "Derived (p." mid-sentence, which is not
  // line-initial and so is never a decoration form `annotationBody` strips. This is exactly the
  // "decoration form nobody anticipated" case the backstop exists for, proven by execution rather
  // than asserted.
  it('buildBlindDerivePayload throws (never silently emits) when the assembled payload still matches an annotation family after quoteLinesOnly — the construction-site backstop', () => {
    const slice = {
      path: 'rulebook/01-y.md',
      text: 'p.1, X:\n"See also Derived (p.2): as noted above."',
    };
    const entry: DerivedLineEntry = {
      slicePath: slice.path,
      lineNumber: 2,
      text: 'Derived (p.1): unrelated original line',
    };
    expect(() => buildBlindDerivePayload(slice, entry)).toThrow(
      /still matches an annotation family/,
    );
  });
});

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

describe('module source guarantees', () => {
  // The no-phrase-list test above (`createDeriveVerdictRecord` describe block) is the ONLY
  // surviving source-text assertion in this file (177-08, closing WR-11) — every guarantee below
  // is now pinned behaviorally, not by grepping the module's own spelling.

  it('behavioral replacement for "never constructs a .verify/ staging path": a run against a temp project with BOTH a populated rulebook/.verify/<run-id>/slices/ tree and a rulebook/source/ decoy present produces a result deeply equal to the same run with those trees absent', async () => {
    const withoutDecoys = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-nodecoy-'));
    const withDecoys = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-decoy-'));
    try {
      const sliceContent = [
        'p.1, X:',
        '"A quoted sentence."',
        '',
        'Derived (p.1): a rule-bearing inference.',
      ].join('\n');

      await fs.mkdir(join(withoutDecoys, 'rulebook'), { recursive: true });
      await fs.writeFile(join(withoutDecoys, 'rulebook', '01-x.md'), sliceContent);

      await fs.mkdir(join(withDecoys, 'rulebook'), { recursive: true });
      await fs.writeFile(join(withDecoys, 'rulebook', '01-x.md'), sliceContent);
      // A populated staged-slices tree the module must never read (source-free by construction).
      await fs.mkdir(join(withDecoys, 'rulebook', '.verify', 'run-abc123', 'slices'), {
        recursive: true,
      });
      await fs.writeFile(
        join(withDecoys, 'rulebook', '.verify', 'run-abc123', 'slices', '01-x.md'),
        'Derived (p.1): a DIFFERENT staged inference that must never be read.',
      );
      // The archived source rulebook — must also never be read.
      await fs.mkdir(join(withDecoys, 'rulebook', 'source'), { recursive: true });
      await fs.writeFile(join(withDecoys, 'rulebook', 'source', 'rules.pdf'), 'not a real pdf');

      const resultWithout = await verifyDeriveRecheckCommand({ project: withoutDecoys });
      const resultWithDecoys = await verifyDeriveRecheckCommand({ project: withDecoys });

      expect({ ...resultWithDecoys, project: '' }).toEqual({ ...resultWithout, project: '' });
    } finally {
      await fs.rm(withoutDecoys, { recursive: true, force: true });
      await fs.rm(withDecoys, { recursive: true, force: true });
    }
  });

  it('behavioral replacement for "atomicWriteFile is the only durable FILE write": the post-record whole-project file inventory differs only under rulebook/.derive-recheck/, and no .tmp/partial file survives', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-write-'));
    try {
      await fs.mkdir(join(dir, 'rulebook'), { recursive: true });
      await fs.writeFile(join(dir, 'rulebook', '01-x.md'), 'p.1, X:\n"112 cards total."');

      const before = await hashProject(dir);
      await replaceDeriveVerdicts(dir, [sampleUnderivableRecord()]);
      const after = await hashProject(dir);
      expect(after).not.toBe(before);

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
      expect(outsideLedgerDir).toEqual([join(dir, 'rulebook', '01-x.md')]);

      const ledgerFiles = allFiles.filter((f) => f.includes(join('rulebook', '.derive-recheck')));
      expect(ledgerFiles.some((f) => f.endsWith('.tmp'))).toBe(false);
      expect(ledgerFiles.some((f) => f.includes('.tmp'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('behavioral replacement for "never sets process.exitCode": process.exitCode is undefined after a run that produces a disagrees finding', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-exitcode-'));
    try {
      await fs.mkdir(join(dir, 'rulebook'), { recursive: true });
      await fs.writeFile(
        join(dir, 'rulebook', '01-x.md'),
        [
          'p.1, Distribution:',
          '"Each player has 7 Action Cards."',
          '',
          'Derived (p.1): Each player has 8 Action Cards.',
        ].join('\n'),
      );
      await recordDeriveVerdict(
        dir,
        createDeriveVerdictRecord({
          slicePath: 'rulebook/01-x.md',
          lineNumber: 4,
          originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
          verdict: 'disagrees',
          reasoning: 'The quote lines say 7, not 8.',
          rederivedValue: 'Each player has 7 Action Cards.',
          originalReading: 'Each player has 8 Action Cards.',
          rederivedReading: 'Each player has 7 Action Cards.',
          sourceQuotes: ['Each player has 7 Action Cards.'],
        }),
      );

      expect(process.exitCode).toBeUndefined();
      const result = await verifyDeriveRecheckCommand({ project: dir });
      expect(result.findings.some((f) => f.verdict === 'disagrees')).toBe(true);
      expect(process.exitCode).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
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
    rederivedValue: 'underivable',
  });
}

function sampleDisagreesRecord(): DeriveVerdictRecord {
  return createDeriveVerdictRecord({
    slicePath: 'rulebook/01-x.md',
    lineNumber: 12,
    originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
    verdict: 'disagrees',
    reasoning: 'The quote lines say 7, not 8.',
    rederivedValue: 'Each player has 7 Action Cards, per the quoted distribution table.',
    originalReading: 'Each player has 8 Action Cards.',
    rederivedReading: 'Each player has 7 Action Cards, per the quoted distribution table.',
    sourceQuotes: ['Each player has 7 Action Cards (16 total across two colors).'],
  });
}

describe('replaceDeriveVerdicts / recordDeriveVerdict / readDeriveVerdicts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-ledger-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips exactly what was written, including an underivable record', async () => {
    const records = [sampleUnderivableRecord(), sampleDisagreesRecord()];
    await replaceDeriveVerdicts(dir, records);

    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual(records);
    expect(read.some((r) => r.verdict === 'underivable')).toBe(true);
  });

  it('returns an empty array when no ledger has ever been written', async () => {
    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual([]);
  });

  it('replaceDeriveVerdicts REPLACES the body atomically — no leftover from the first write (177-09: the deliberately-destructive, non-default path)', async () => {
    await replaceDeriveVerdicts(dir, [sampleUnderivableRecord()]);
    await replaceDeriveVerdicts(dir, [sampleDisagreesRecord()]);

    const read = await readDeriveVerdicts(dir);
    expect(read).toEqual([sampleDisagreesRecord()]);
    expect(read.some((r) => r.verdict === 'underivable')).toBe(false);
  });

  it('recordDeriveVerdict called twice for DIFFERENT locations leaves BOTH records readable — the pattern that previously destroyed one (CR-06, fails against the pre-fix API)', async () => {
    await recordDeriveVerdict(dir, sampleUnderivableRecord());
    await recordDeriveVerdict(dir, sampleDisagreesRecord());

    const read = await readDeriveVerdicts(dir);
    expect(read).toHaveLength(2);
    expect(read.some((r) => r.verdict === 'underivable')).toBe(true);
    expect(read.some((r) => r.verdict === 'disagrees')).toBe(true);
  });

  it('recordDeriveVerdict called twice for the SAME slicePath:lineNumber upserts — exactly one record survives, carrying the second call content', async () => {
    const first = sampleUnderivableRecord();
    const second = createDeriveVerdictRecord({
      slicePath: first.slicePath,
      lineNumber: first.lineNumber,
      originalLine: first.originalLine,
      verdict: 'not-rule-bearing',
      reasoning: 'On reflection this is a pure layout note.',
      rederivedValue: 'not-rule-bearing',
    });

    await recordDeriveVerdict(dir, first);
    await recordDeriveVerdict(dir, second);

    const read = await readDeriveVerdicts(dir);
    const atLocation = read.filter(
      (r) => r.slicePath === first.slicePath && r.lineNumber === first.lineNumber,
    );
    expect(atLocation).toHaveLength(1);
    expect(atLocation[0].verdict).toBe('not-rule-bearing');
    expect(atLocation[0].reasoning).toBe(second.reasoning);
  });

  it('recordDeriveVerdict preserves existing order and appends the new/updated record last', async () => {
    const a = sampleUnderivableRecord();
    const b = sampleDisagreesRecord();
    await recordDeriveVerdict(dir, a);
    await recordDeriveVerdict(dir, b);

    const updatedA = createDeriveVerdictRecord({
      slicePath: a.slicePath,
      lineNumber: a.lineNumber,
      originalLine: a.originalLine,
      verdict: 'not-rule-bearing',
      reasoning: 'Re-evaluated.',
      rederivedValue: 'not-rule-bearing',
    });
    await recordDeriveVerdict(dir, updatedA);

    const read = await readDeriveVerdicts(dir);
    expect(read).toHaveLength(2);
    expect(read[0].slicePath).toBe(b.slicePath);
    expect(read[0].lineNumber).toBe(b.lineNumber);
    expect(read[1].slicePath).toBe(updatedA.slicePath);
    expect(read[1].lineNumber).toBe(updatedA.lineNumber);
    expect(read[1].verdict).toBe('not-rule-bearing');
  });

  it('is project-level: no run-id segment in the ledger path, and no function accepts a runId', async () => {
    const { ledgerPath } = await replaceDeriveVerdicts(dir, [sampleUnderivableRecord()]);
    expect(ledgerPath).not.toContain('.verify');
    expect(ledgerPath).not.toMatch(/run-?[Ii]d/);
    expect(ledgerPath).toBe('rulebook/.derive-recheck/DERIVE-VERDICTS.md');

    // Arity: replaceDeriveVerdicts(projectDir, records) / recordDeriveVerdict(projectDir, record)
    // / readDeriveVerdicts(projectDir) — no runId parameter slot exists on any of the three.
    expect(replaceDeriveVerdicts.length).toBe(2);
    expect(recordDeriveVerdict.length).toBe(2);
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

    await recordDeriveVerdict(dir, sampleUnderivableRecord());

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

describe('readDeriveVerdicts — revalidation through createDeriveVerdictRecord (CR-02)', () => {
  let dir: string;
  let ledgerFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-cr02-'));
    await fs.mkdir(join(dir, 'rulebook', '.derive-recheck'), { recursive: true });
    ledgerFile = join(dir, 'rulebook', '.derive-recheck', 'DERIVE-VERDICTS.md');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeRawLedger(bodyLines: string[]): Promise<void> {
    const content =
      `# Derive Verdicts (CHECK-04) — project-level, no run-id\n\n` +
      `<!-- boardsmith:derive-verdicts:begin -->\n` +
      bodyLines.join('\n') +
      (bodyLines.length > 0 ? '\n' : '') +
      `<!-- boardsmith:derive-verdicts:end -->\n`;
    await fs.writeFile(ledgerFile, content);
  }

  it('rejects an out-of-enum verdict on read, never reaching a NaN/null verdict count (CR-02 executed proof)', async () => {
    await writeRawLedger([
      JSON.stringify({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 3,
        originalLine: 'Derived (p.1): x',
        verdict: 'TOTALLY-BOGUS',
        reasoning: 'hand-edited',
        rederivedValue: 'x',
        sourceQuotes: [],
      }),
    ]);
    await expect(readDeriveVerdicts(dir)).rejects.toThrow(/Invalid verdict/);
  });

  it('a not-valid-JSON ledger line throws one actionable message naming the relative ledger path and record index, never a raw SyntaxError', async () => {
    await writeRawLedger(['{ this is not valid JSON']);
    let message = '';
    try {
      await readDeriveVerdicts(dir);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('rulebook/.derive-recheck/DERIVE-VERDICTS.md');
    expect(message).toContain('record 1');
    expect(message).not.toContain('SyntaxError');
  });

  it('verdictCounts from verifyDeriveRecheckCommand never gains a key outside DERIVE_VERDICTS (previously reachable per CR-02)', async () => {
    await fs.writeFile(
      join(dir, 'rulebook', '01-x.md'),
      'p.1, X:\n"A quoted sentence."\n\nDerived (p.1): x',
    );
    await writeRawLedger([
      JSON.stringify({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 4,
        originalLine: 'Derived (p.1): x',
        verdict: 'TOTALLY-BOGUS',
        reasoning: 'hand-edited',
        rederivedValue: 'x',
        sourceQuotes: [],
      }),
    ]);
    await expect(verifyDeriveRecheckCommand({ project: dir })).rejects.toThrow(/Invalid verdict/);
  });

  it('grep-count: no "as DeriveVerdictRecord" cast remains anywhere in the module', () => {
    const src = readFileSync(join(__dirname, 'verify-derive-recheck.ts'), 'utf-8');
    expect((src.match(/as DeriveVerdictRecord/g) ?? []).length).toBe(0);
  });

  it('returns an empty array (never throws) when no ledger file exists', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-cr02-empty-'));
    try {
      await expect(readDeriveVerdicts(empty)).resolves.toEqual([]);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('a valid ledger round-trips byte-identically through write -> read -> write', async () => {
    const records = [sampleUnderivableRecord(), sampleDisagreesRecord()];
    await replaceDeriveVerdicts(dir, records);
    const firstRead = await readDeriveVerdicts(dir);
    await replaceDeriveVerdicts(dir, firstRead);
    const secondRead = await readDeriveVerdicts(dir);
    expect(secondRead).toEqual(records);
  });
});

// ===========================================================================================
// Task 2 — the report command and its CLI registration
// ===========================================================================================

describe('verifyDeriveRecheckCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-cmd-'));
    await fs.mkdir(join(dir, 'rulebook'), { recursive: true });
    await fs.writeFile(
      join(dir, 'rulebook', '01-x.md'),
      [
        'p.1, Components:',
        '"The box contains 112 cards."',
        '',
        'Derived (p.1): The box contains 112 cards.',
        '',
        'p.1, Distribution:',
        '"Each player has 7 Action Cards."',
        '',
        'Derived (p.1): Each player has 8 Action Cards.',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs project-wide with no --run-id and no staged run present, resolving normally with a disagreement finding present', async () => {
    await recordDeriveVerdict(
      dir,
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 9,
        originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
        verdict: 'disagrees',
        reasoning: 'The quote lines say 7, not 8.',
        rederivedValue: 'Each player has 7 Action Cards.',
        originalReading: 'Each player has 8 Action Cards.',
        rederivedReading: 'Each player has 7 Action Cards.',
        sourceQuotes: ['Each player has 7 Action Cards.'],
      }),
    );

    const result = await verifyDeriveRecheckCommand({ project: dir });
    expect(result.findings.some((f) => f.verdict === 'disagrees')).toBe(true);
  });

  it('a disagreement finding cites both derivations verbatim, and process.exitCode stays unset (exit)', async () => {
    await recordDeriveVerdict(
      dir,
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 9,
        originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
        verdict: 'disagrees',
        reasoning: 'The quote lines say 7, not 8.',
        rederivedValue: 'Each player has 7 Action Cards.',
        originalReading: 'Each player has 8 Action Cards.',
        rederivedReading: 'Each player has 7 Action Cards.',
        sourceQuotes: ['Each player has 7 Action Cards.'],
      }),
    );

    const before = process.exitCode;
    const result = await verifyDeriveRecheckCommand({ project: dir });
    expect(process.exitCode).toBe(before);

    const disagreement = result.findings.find((f) => f.verdict === 'disagrees')!;
    expect(disagreement.originalReading).toBe('Each player has 8 Action Cards.');
    expect(disagreement.rederivedReading).toBe('Each player has 7 Action Cards.');
    // The source-text check formerly here (grepping for a literal "process.exitCode" absence) is
    // now covered behaviorally by "module source guarantees"' exitCode replacement test (177-08,
    // closing WR-11) — this test asserts the runtime behavior only.
  });

  it('throws one actionable line naming --project when rulebook/ is missing, no stack/.ts: leak', async () => {
    const empty = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-empty-'));
    try {
      await expect(verifyDeriveRecheckCommand({ project: empty })).rejects.toThrow(
        /No rulebook\/ directory.*--project/s,
      );
      try {
        await verifyDeriveRecheckCommand({ project: empty });
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toMatch(/\.ts:\d+/);
        expect(message).not.toContain('at ');
      }
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it('--json emits the result and nothing else on stdout (purity)', async () => {
    const logs: string[] = [];
    const spy = (msg?: unknown) => logs.push(String(msg));
    const original = console.log;
    console.log = spy;
    try {
      await verifyDeriveRecheckCommand({ project: dir, json: true });
    } finally {
      console.log = original;
    }
    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0])).not.toThrow();
    const parsed = JSON.parse(logs[0]);
    expect(parsed.findings).toBeDefined();
  });

  it('per-verdict counts include all four verdicts with zeros written explicitly', async () => {
    const result = await verifyDeriveRecheckCommand({ project: dir });
    expect(result.verdictCounts).toEqual({
      agrees: 0,
      disagrees: 0,
      underivable: 0,
      'not-rule-bearing': 0,
    });
  });

  it('a candidate with no recorded verdict reports pending, not a manufactured default', async () => {
    const result = await verifyDeriveRecheckCommand({ project: dir });
    expect(result.findings.every((f) => f.verdict === 'pending')).toBe(true);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  // 177-10, closing CR-03: the join is on LOCATION + TEXT, never location alone.
  it('a ledger record recorded for line 4, then the line text rewritten, reports pending and lists a staleRecords entry (CR-03 executed proof — fails against the pre-fix line-number-only join)', async () => {
    await recordDeriveVerdict(
      dir,
      createDeriveVerdictRecord({
        slicePath: 'rulebook/01-x.md',
        lineNumber: 4,
        originalLine: 'Derived (p.1): The box contains 112 cards.',
        verdict: 'agrees',
        reasoning: 'Matches the quoted component count.',
        rederivedValue: 'The box contains 112 cards.',
        sourceQuotes: ['The box contains 112 cards.'],
      }),
    );

    // Rewrite line 4 in place — same location, different text, exactly the CR-03 proof shape.
    await fs.writeFile(
      join(dir, 'rulebook', '01-x.md'),
      [
        'p.1, Components:',
        '"The box contains 112 cards."',
        '',
        'Derived (p.1): A COMPLETELY DIFFERENT RULE.',
        '',
        'p.1, Distribution:',
        '"Each player has 7 Action Cards."',
        '',
        'Derived (p.1): Each player has 8 Action Cards.',
      ].join('\n'),
    );

    const result = await verifyDeriveRecheckCommand({ project: dir });
    const finding = result.findings.find((f) => f.lineNumber === 4)!;
    expect(finding.verdict).toBe('pending');
    expect(result.staleRecords).toHaveLength(1);
    expect(result.staleRecords[0]).toContain('rulebook/01-x.md:4');
    expect(result.staleRecords[0]).toContain('The box contains 112 cards.');
    // A stale record must never contribute to verdictCounts (it never counted as a live agrees).
    expect(result.verdictCounts.agrees).toBe(0);
  });

  it('a ledger record whose location matches no current candidate is reported in orphanedRecords, never silently absorbed (WR-03)', async () => {
    await recordDeriveVerdict(
      dir,
      createDeriveVerdictRecord({
        slicePath: 'rulebook/deleted-slice.md',
        lineNumber: 7,
        originalLine: 'Derived (p.9): A rule from a slice that no longer exists.',
        verdict: 'agrees',
        reasoning: 'Matched at the time.',
        rederivedValue: 'A rule from a slice that no longer exists.',
        sourceQuotes: ['some quote'],
      }),
    );

    const result = await verifyDeriveRecheckCommand({ project: dir });
    expect(result.orphanedRecords).toHaveLength(1);
    expect(result.orphanedRecords[0]).toContain('rulebook/deleted-slice.md:7');
    // The orphan never manufactures a phantom finding.
    expect(result.findings.some((f) => f.slicePath === 'rulebook/deleted-slice.md')).toBe(false);
  });

  it('formatReading never interpolates the literal "undefined" for a missing reading (WR-06)', () => {
    // `createDeriveVerdictRecord` + the read path's revalidation (CR-02, closed in 177-09)
    // together mean a `disagrees` finding with a missing reading cannot reach the printer through
    // any path this module exposes today (attempting to hand-seed such a ledger record is itself
    // rejected by `readDeriveVerdicts`'s revalidation — proof that CR-02 already closed the
    // "reachable through the unvalidated read path" route WR-06 originally named). The printer's
    // fallback is still exercised directly here, defensively, since a designer-facing report must
    // never trust the type over interpolating a value that could be undefined at runtime.
    expect(formatReading(undefined)).toBe('(missing — re-run the comparison dispatch)');
    expect(formatReading('Each player has 7 Action Cards.')).toBe(
      'Each player has 7 Action Cards.',
    );
  });

  it('hand-seeding a ledger record with a missing disagrees reading is rejected by the read path, proving WR-06\'s original "reachable via CR-02" route is closed', async () => {
    const ledgerDir = join(dir, 'rulebook', '.derive-recheck');
    await fs.mkdir(ledgerDir, { recursive: true });
    const record = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 9,
      originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
      verdict: 'disagrees',
      reasoning: 'Old-format record with a missing reading.',
      rederivedValue: 'Each player has 7 Action Cards.',
      sourceQuotes: ['Each player has 7 Action Cards.'],
      // originalReading / rederivedReading deliberately absent.
    };
    await fs.writeFile(
      join(ledgerDir, 'DERIVE-VERDICTS.md'),
      `# Derive Verdicts (CHECK-04) — project-level, no run-id\n\n` +
        `<!-- boardsmith:derive-verdicts:begin -->\n` +
        `${JSON.stringify(record)}\n` +
        `<!-- boardsmith:derive-verdicts:end -->\n`,
    );

    await expect(verifyDeriveRecheckCommand({ project: dir })).rejects.toThrow(
      /no originalReading quoted verbatim/,
    );
  });

  it('rulebook/ present but unreadable (EACCES) reports the real condition, not "No rulebook/ directory" (WR-02)', async () => {
    const unreadableDir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-recheck-eacces-'));
    const rulebookDir = join(unreadableDir, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.chmod(rulebookDir, 0o000);
    try {
      await expect(verifyDeriveRecheckCommand({ project: unreadableDir })).rejects.toThrow(
        /could not be read/,
      );
      try {
        await verifyDeriveRecheckCommand({ project: unreadableDir });
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toMatch(/No rulebook\/ directory/);
      }
    } finally {
      await fs.chmod(rulebookDir, 0o755);
      await fs.rm(unreadableDir, { recursive: true, force: true });
    }
  });

  it('exactly one "No rulebook/ directory" message exists in the module source (WR-10 — the redundant pre-check is gone)', () => {
    const source = readFileSync(
      join(__dirname, 'verify-derive-recheck.ts'),
      'utf-8',
    ).replace(/^\s*\*.*$/gm, '');
    const matches = source.match(/No rulebook\/ directory/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

// ===========================================================================================
// Task 2 (177-10) — verifyDeriveRecordCommand: the missing write surface (closing CR-05)
// ===========================================================================================

describe('verifyDeriveRecordCommand', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-derive-record-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('records a verdict readable by verify-derive-recheck --json — the observable CR-05 said did not exist', async () => {
    await verifyDeriveRecordCommand({
      project: dir,
      slicePath: 'rulebook/01-x.md',
      lineNumber: 4,
      originalLine: 'Derived (p.1): The box contains 112 cards.',
      verdict: 'agrees',
      reasoning: 'Matches the quoted component count.',
      rederivedValue: 'The box contains 112 cards.',
      sourceQuote: ['The box contains 112 cards.'],
    });

    const recorded = await readDeriveVerdicts(dir);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].verdict).toBe('agrees');
    expect(recorded[0].slicePath).toBe('rulebook/01-x.md');
    expect(recorded[0].lineNumber).toBe(4);
  });

  it('recording a second verdict for a DIFFERENT line preserves the first (the upsert-append from 177-09, exercised through the real command)', async () => {
    await verifyDeriveRecordCommand({
      project: dir,
      slicePath: 'rulebook/01-x.md',
      lineNumber: 4,
      originalLine: 'Derived (p.1): The box contains 112 cards.',
      verdict: 'agrees',
      reasoning: 'Matches the quoted component count.',
      rederivedValue: 'The box contains 112 cards.',
      sourceQuote: ['The box contains 112 cards.'],
    });
    await verifyDeriveRecordCommand({
      project: dir,
      slicePath: 'rulebook/01-x.md',
      lineNumber: 9,
      originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
      verdict: 'disagrees',
      reasoning: 'The quote lines say 7, not 8.',
      rederivedValue: 'Each player has 7 Action Cards.',
      originalReading: 'Each player has 8 Action Cards.',
      rederivedReading: 'Each player has 7 Action Cards.',
      sourceQuote: ['Each player has 7 Action Cards.'],
    });

    const recorded = await readDeriveVerdicts(dir);
    expect(recorded).toHaveLength(2);
    expect(recorded.some((r) => r.lineNumber === 4 && r.verdict === 'agrees')).toBe(true);
    expect(recorded.some((r) => r.lineNumber === 9 && r.verdict === 'disagrees')).toBe(true);
  });

  it('an invalid verdict exits non-zero with createDeriveVerdictRecord\'s own message — validation is delegated, never re-implemented', async () => {
    await expect(
      verifyDeriveRecordCommand({
        project: dir,
        slicePath: 'rulebook/01-x.md',
        lineNumber: 4,
        originalLine: 'Derived (p.1): The box contains 112 cards.',
        verdict: 'probably-agrees',
        reasoning: 'x',
        rederivedValue: 'x',
      }),
    ).rejects.toThrow(/Invalid verdict.*agrees.*disagrees.*underivable.*not-rule-bearing/s);
  });

  it('a disagrees verdict missing originalReading throws createDeriveVerdictRecord\'s own message, not a second validator\'s', async () => {
    await expect(
      verifyDeriveRecordCommand({
        project: dir,
        slicePath: 'rulebook/01-x.md',
        lineNumber: 9,
        originalLine: 'Derived (p.1): Each player has 8 Action Cards.',
        verdict: 'disagrees',
        reasoning: 'The quote lines say 7, not 8.',
        rederivedValue: 'Each player has 7 Action Cards.',
        rederivedReading: 'Each player has 7 Action Cards.',
        sourceQuote: ['Each player has 7 Action Cards.'],
      }),
    ).rejects.toThrow(/no originalReading quoted verbatim/);
  });

  it('--json emits the recorded record and the relative ledger path and nothing else on stdout', async () => {
    const logs: string[] = [];
    const spy = (msg?: unknown) => logs.push(String(msg));
    const original = console.log;
    console.log = spy;
    try {
      await verifyDeriveRecordCommand({
        project: dir,
        slicePath: 'rulebook/01-x.md',
        lineNumber: 4,
        originalLine: 'Derived (p.1): The box contains 112 cards.',
        verdict: 'agrees',
        reasoning: 'Matches the quoted component count.',
        rederivedValue: 'The box contains 112 cards.',
        sourceQuote: ['The box contains 112 cards.'],
        json: true,
      });
    } finally {
      console.log = original;
    }
    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.record.verdict).toBe('agrees');
    expect(parsed.ledgerPath).toBe('rulebook/.derive-recheck/DERIVE-VERDICTS.md');
  });

  it('missing --slice-path throws a clear message naming the flag', async () => {
    await expect(
      verifyDeriveRecordCommand({
        project: dir,
        lineNumber: 4,
        originalLine: 'x',
        verdict: 'agrees',
        reasoning: 'x',
        rederivedValue: 'x',
        sourceQuote: ['x'],
      }),
    ).rejects.toThrow(/--slice-path/);
  });

  it('registers no --force, --skip, --overwrite, or bypass option of any kind (source-level pin)', () => {
    const source = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf-8');
    const block = source.slice(
      source.indexOf("verify-derive-record'"),
      source.indexOf('.action(verifyDeriveRecordCommand)') + 40,
    );
    expect(block).not.toMatch(/force|skip|overwrite/i);
  });
});
