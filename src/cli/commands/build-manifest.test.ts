import { describe, it, expect } from 'vitest';
import {
  FINDING_KINDS,
  findHeadingIndex,
  extractSection,
  parseBuildManifest,
  parseInterpretationClaims,
  extractVerifiedCommitHash,
  parseRulings,
} from './build-manifest.js';

/**
 * `build-manifest.ts` is Phase 172's "one parser, one authority" module (172-CONTEXT.md decision
 * 1): the Build Manifest is the claim-numbering authority for CHECK-03 and the file list for
 * CHECK-05, so both checks share exactly one parse of it. Every heading these parsers read is a
 * heading name that legitimately appears in prose elsewhere in a real CHUNK.md — the same defect
 * class `f73153a3` fixed once already — so `findHeadingIndex` is the ONLY heading-location
 * primitive this module exports, and every other parser here is built on it.
 */

describe('FINDING_KINDS', () => {
  it('is the locked nine-member enum, frozen', () => {
    expect(FINDING_KINDS).toEqual([
      'claim-untested',
      'ruling-untested',
      'test-unlinked',
      'unassociated-test',
      'ambiguous-claim-ref',
      'unresolved-claim-ref',
      'manifest-file-missing',
      'chunk-code-drifted',
      'drift-unknown',
    ]);
    expect(Object.isFrozen(FINDING_KINDS)).toBe(true);
  });
});

describe('findHeadingIndex / extractSection', () => {
  it('resolves the REAL section, not a prose mention of the heading text (f73153a3 defect class)', () => {
    const proseLine = '## Build Manifest';
    const filler = Array.from({ length: 150 }, (_, i) => `filler line ${i}`).join('\n');
    const text = `<!-- see "${proseLine}" below -->\n${filler}\n\n## Build Manifest\n\nreal body\n`;
    const idx = findHeadingIndex(text, '## Build Manifest');
    // The real heading is the ONE at line start; the prose mention is mid-line inside a comment.
    const expectedIdx = text.indexOf('## Build Manifest\n\nreal body');
    expect(idx).toBe(expectedIdx);
    expect(extractSection(text, '## Build Manifest')).toBe('\nreal body\n');
  });

  it('never matches a heading name appearing mid-line', () => {
    const text = 'This chunk mentions ## Build Manifest inside a sentence, not at line start.\n';
    expect(findHeadingIndex(text, '## Build Manifest')).toBe(-1);
    expect(extractSection(text, '## Build Manifest')).toBeUndefined();
  });

  it('section body ends at the next `^## ` line, not the next `^### ` line', () => {
    const text = [
      '## Interpretation',
      '',
      '22. **Claim A**',
      '',
      '### Corrections from Redteam Round 1',
      '',
      '29. **Claim B**',
      '',
      '## Build Manifest',
      '',
      'unrelated',
      '',
    ].join('\n');
    const body = extractSection(text, '## Interpretation');
    expect(body).toContain('22. **Claim A**');
    expect(body).toContain('### Corrections from Redteam Round 1');
    expect(body).toContain('29. **Claim B**');
    expect(body).not.toContain('unrelated');
  });

  it('absent heading returns -1 / undefined, never a partial body', () => {
    const text = '## Something Else\n\nbody\n';
    expect(findHeadingIndex(text, '## Build Manifest')).toBe(-1);
    expect(extractSection(text, '## Build Manifest')).toBeUndefined();
  });
});

describe('parseBuildManifest', () => {
  function tableChunk(rows: string): string {
    return [
      '## Build Manifest',
      '',
      '| File | Status |',
      '|---|---|',
      rows,
      '',
      '## Playtest Test Script',
      '',
      'unrelated',
      '',
    ].join('\n');
  }

  it('extracts multiple paths from a single comma-joined first cell', () => {
    const chunk = tableChunk(
      '| tests/game.test.ts, tests/block.test.ts, tests/punch.test.ts, tests/rest.test.ts, tests/a11y.test.ts | written |',
    );
    const parsed = parseBuildManifest(chunk);
    expect(parsed.tabular).toBe(true);
    expect(parsed.entries.map((e) => e.path)).toEqual([
      'tests/game.test.ts',
      'tests/block.test.ts',
      'tests/punch.test.ts',
      'tests/rest.test.ts',
      'tests/a11y.test.ts',
    ]);
  });

  it('only extracts paths from the first cell, never the prose second cell', () => {
    const chunk = tableChunk('| src/rules/game.ts | see src/rules/other.ts for context |');
    const parsed = parseBuildManifest(chunk);
    expect(parsed.entries.map((e) => e.path)).toEqual(['src/rules/game.ts']);
  });

  it('survives an inline annotation in the first cell', () => {
    const chunk = tableChunk('| src/rules/game.ts (edit) | edited |');
    const parsed = parseBuildManifest(chunk);
    expect(parsed.entries.map((e) => e.path)).toEqual(['src/rules/game.ts']);
  });

  it('records a zero-path row in pathlessRowIndexes and produces no entry', () => {
    const chunk = tableChunk('| (no files) | n/a |');
    const parsed = parseBuildManifest(chunk);
    expect(parsed.entries).toEqual([]);
    expect(parsed.pathlessRowIndexes).toEqual([1]);
  });

  it('a bulleted prose Build Manifest returns tabular: false with zero entries', () => {
    const chunk = [
      '## Build Manifest',
      '',
      '- wrote src/ai/opponent.ts',
      '- wrote tests/ai.test.ts',
      '',
      '## Playtest Test Script',
      '',
    ].join('\n');
    const parsed = parseBuildManifest(chunk);
    expect(parsed.tabular).toBe(false);
    expect(parsed.entries).toEqual([]);
  });

  it('a table whose body is legitimately empty returns tabular: true with zero entries', () => {
    const chunk = [
      '## Build Manifest',
      '',
      '| File | Status |',
      '|---|---|',
      '',
      '## Playtest Test Script',
      '',
    ].join('\n');
    const parsed = parseBuildManifest(chunk);
    expect(parsed.tabular).toBe(true);
    expect(parsed.entries).toEqual([]);
    expect(parsed.pathlessRowIndexes).toEqual([]);
  });

  it('authoring is true for NEW/written, false for editing verbs, and editing wins if both present', () => {
    const chunk = tableChunk(
      [
        '| tests/discard.test.ts | NEW (test step) |',
        '| tests/other.test.ts | written |',
        '| src/rules/game.ts | edited (test step, Decision 55) |',
        '| src/rules/block.ts | extended |',
        '| src/rules/punch.ts | rewritten |',
        '| src/rules/rest.ts | tightened |',
        '| src/rules/mixed.ts | edited, then NEW again |',
      ].join('\n'),
    );
    const parsed = parseBuildManifest(chunk);
    const byPath = Object.fromEntries(parsed.entries.map((e) => [e.path, e.authoring]));
    expect(byPath['tests/discard.test.ts']).toBe(true);
    expect(byPath['tests/other.test.ts']).toBe(true);
    expect(byPath['src/rules/game.ts']).toBe(false);
    expect(byPath['src/rules/block.ts']).toBe(false);
    expect(byPath['src/rules/punch.ts']).toBe(false);
    expect(byPath['src/rules/rest.ts']).toBe(false);
    expect(byPath['src/rules/mixed.ts']).toBe(false); // editing verb wins
  });

  it('authoring reads the LEADING verb only — an authoring word later in prose does not authorize', () => {
    // Found by 172-PROOF.md's hand-walk of the resolution ladder. `/\b(new|written)\b/` matched
    // anywhere in the status prose, so a row whose leading verb is an editing verb OUTSIDE the
    // known list ("updated", "touched") but whose prose happens to say "new" or "written" was
    // classified as authoring. That is the dangerous direction: rung 3 of the decision-3 ladder
    // narrows TO the authoring chunk, so a false authoring silently attributes a claim citation
    // to a chunk that merely touched the file.
    const chunk = tableChunk(
      [
        '| tests/a.test.ts | updated — new coverage added for claim 3 |',
        '| tests/b.test.ts | touched — depends on the new helper written in game.ts |',
        '| tests/c.test.ts | edited — new assertions written for claim 3 |',
        '| tests/d.test.ts | NEW (test step) — net-new coverage |',
        '| tests/e.test.ts | written — added breakGuard() |',
        // The shape that actually fired on live data (seven/game-end-trigger): a leading
        // `unchanged` whose prose mentions a hypothetical test that "would go green" if written.
        '| tests/f.test.ts | unchanged — deliberately; any test written for it would go green |',
      ].join('\n'),
    );
    const byPath = Object.fromEntries(
      parseBuildManifest(chunk).entries.map((e) => [e.path, e.authoring]),
    );
    expect(byPath['tests/a.test.ts']).toBe(false);
    expect(byPath['tests/b.test.ts']).toBe(false);
    expect(byPath['tests/c.test.ts']).toBe(false);
    // The real leading-verb shapes must keep working.
    expect(byPath['tests/d.test.ts']).toBe(true);
    expect(byPath['tests/e.test.ts']).toBe(true);
    expect(byPath['tests/f.test.ts']).toBe(false);
  });
});

describe('parseInterpretationClaims', () => {
  it('scopes strictly to ## Interpretation and ignores a numbered list in another section', () => {
    const chunk = [
      '## Interpretation',
      '',
      '1. **Claim one**',
      '2. **Claim two**',
      '',
      '## Playtest Test Script',
      '',
      '6. **Regression check**',
      '',
      '## Build Manifest',
      '',
    ].join('\n');
    expect(parseInterpretationClaims(chunk)).toEqual([1, 2]);
  });

  it('preserves non-contiguous starts verbatim, never normalising to 1..max', () => {
    const chunk = [
      '## Interpretation',
      '',
      '20. **Claim twenty**',
      '21. **Claim twenty-one**',
      '',
      '## Build Manifest',
      '',
    ].join('\n');
    expect(parseInterpretationClaims(chunk)).toEqual([20, 21]);
  });

  it('returns [] when there is no Interpretation section', () => {
    const chunk = '## Build Manifest\n\n| File | Status |\n|---|---|\n';
    expect(parseInterpretationClaims(chunk)).toEqual([]);
  });

  it('de-duplicates and returns ascending order', () => {
    const chunk = ['## Interpretation', '', '5. **A**', '3. **B**', '5. **A again**', ''].join(
      '\n',
    );
    expect(parseInterpretationClaims(chunk)).toEqual([3, 5]);
  });
});

describe('extractVerifiedCommitHash', () => {
  function hashChunk(body: string): string {
    return `## Verified Commit Hash\n\n${body}\n\n## Verified Against\n\nunrelated\n`;
  }

  it('bare 7-char hash on its own line', () => {
    expect(extractVerifiedCommitHash(hashChunk('abc1234'))).toBe('abc1234');
  });

  it('backtick-wrapped 7-char hash with trailing prose', () => {
    expect(extractVerifiedCommitHash(hashChunk('`abc1234` (verified 2026-07-28)'))).toBe(
      'abc1234',
    );
  });

  it('bare 40-char SHA', () => {
    const sha = 'a'.repeat(40);
    expect(extractVerifiedCommitHash(hashChunk(sha))).toBe(sha);
  });

  it('backtick-wrapped 40-char SHA', () => {
    const sha = 'b'.repeat(40);
    expect(extractVerifiedCommitHash(hashChunk(`\`${sha}\``))).toBe(sha);
  });

  it('prose-prefixed hash — two sentences precede "Verified commit: `hash`"', () => {
    const body =
      'This chunk touched several files across two sessions. ' +
      'The second session finished the work.\n\n' +
      'Verified commit: `fbc573f` on the feature branch.';
    expect(extractVerifiedCommitHash(hashChunk(body))).toBe('fbc573f');
  });

  it('returns the FIRST hash when a section contains two', () => {
    const body = 'Bisect anchor: `1111111`. A later note also mentions `2222222` in passing.';
    expect(extractVerifiedCommitHash(hashChunk(body))).toBe('1111111');
  });

  it('returns undefined when the section is absent', () => {
    expect(extractVerifiedCommitHash('## Build Manifest\n\nno hash section here\n')).toBeUndefined();
  });

  it('returns undefined when the section has no hex token', () => {
    expect(extractVerifiedCommitHash(hashChunk('not recorded yet'))).toBeUndefined();
  });
});

describe('parseRulings', () => {
  function rulingsFixture(): string {
    return [
      '# Rulings',
      '',
      '### Ruling 3',
      '',
      'Decision: the card is face down.',
      '⚠ RATIONALE SUPERSEDED BY RULING 9',
      '',
      '### Ruling 9',
      '',
      'Decision: the card is face up after the errata.',
      '',
      '### Ruling 14',
      '',
      'Decision: the card is shaped like a diamond.',
      '',
      '### Ruling 21',
      '',
      "Decision: supersedes Ruling 14's card-shaped presentation with a square token.",
      '',
      '### Ruling 22',
      '',
      'Decision: Supersedes the RATIONALE of Ruling 3, not its outcome.',
      '',
      '### Ruling 23',
      '',
      'Decision: UPHOLDS Ruling 23... wait, references itself for the fixture; also RESOLVES OQ-1.',
      '',
      '### Ruling 24',
      '',
      'Decision: reconciles Ruling 24 with Ruling 1, and extends Rulings 21/22.',
      '',
      '### Ruling 25',
      '',
      'Decision: overrides DECISIONS.md Decision 23.',
      '',
    ].join('\n');
  }

  it('parses every ### Ruling N entry, line-anchored, body to the next ### line', () => {
    const parsed = parseRulings(rulingsFixture());
    expect(parsed.map((r) => r.number)).toEqual([3, 9, 14, 21, 22, 23, 24, 25]);
  });

  it('"supersedes Ruling M" on entry N sets supersededBy: N on ruling M', () => {
    const parsed = parseRulings(rulingsFixture());
    const ruling14 = parsed.find((r) => r.number === 14)!;
    expect(ruling14.supersededBy).toBe(21);
  });

  it('reversed direction: "SUPERSEDED BY RULING M" sitting on entry N sets supersededBy: M on N', () => {
    const parsed = parseRulings(rulingsFixture());
    const ruling3 = parsed.find((r) => r.number === 3)!;
    expect(ruling3.supersededBy).toBe(9);
  });

  it('a supersede verb whose object is a sub-part (RATIONALE) goes to unparsedSupersession, not a resolved chain', () => {
    const parsed = parseRulings(rulingsFixture());
    const ruling22 = parsed.find((r) => r.number === 22)!;
    expect(ruling22.supersededBy).toBeUndefined();
    expect(ruling22.unparsedSupersession.length).toBeGreaterThan(0);
    expect(ruling22.unparsedSupersession[0]).toMatch(/Supersedes the RATIONALE of Ruling 3/);
  });

  it('non-supersession cross-reference verbs never set supersededBy and never appear in unparsedSupersession', () => {
    const parsed = parseRulings(rulingsFixture());
    for (const num of [23, 24, 25]) {
      const r = parsed.find((rr) => rr.number === num)!;
      expect(r.supersededBy).toBeUndefined();
      expect(r.unparsedSupersession).toEqual([]);
    }
  });

  it('a supersede verb with no resolvable ruling number goes to unparsedSupersession verbatim', () => {
    const text = [
      '### Ruling 1',
      '',
      'Decision: this ruling supersedes an earlier unwritten house rule, no number given.',
      '',
    ].join('\n');
    const parsed = parseRulings(text);
    const ruling1 = parsed.find((r) => r.number === 1)!;
    expect(ruling1.supersededBy).toBeUndefined();
    expect(ruling1.unparsedSupersession.length).toBe(1);
  });
});
