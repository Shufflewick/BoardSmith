import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DERIVE_VERDICTS, createDeriveVerdictRecord } from './verify-derive-recheck.js';

/**
 * `verify-derive-recheck.ts` is CHECK-04's mechanical core (177-CONTEXT.md decision 2/5). Every
 * fixture here is either a real filesystem temp dir (`fs.mkdtemp`, no mocks) or the REAL archived
 * live slices Phase 174 committed and Phase 177's context/research directly measured — never
 * invented slice bodies for the corpus-wide leak-proof assertions this plan pins.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

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
