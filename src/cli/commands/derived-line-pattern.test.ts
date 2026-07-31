import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANNOTATION_CITATION_RE,
  ANNOTATION_CITATION_SOURCES,
  ANNOTATION_FAMILIES,
  ANNOTATION_VOCABULARY_RE,
  DERIVED_LINE_RE,
  VOCABULARY_KEYED_FAMILIES,
  annotationLineStartRe,
} from './derived-line-pattern.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, '..', '..');

describe('ANNOTATION_FAMILIES', () => {
  it('equals exactly the four citation-keyed families, in order, frozen (178-01 Task 3 adds Example)', () => {
    expect(ANNOTATION_FAMILIES).toEqual(['Derived', 'Visual', 'Named-but-undefined', 'Example']);
    expect(Object.isFrozen(ANNOTATION_FAMILIES)).toBe(true);
  });
});

describe('VOCABULARY_KEYED_FAMILIES (178-01 Task 3 — deliberately excludes Example)', () => {
  it('equals exactly the three original families, in order, frozen', () => {
    expect(VOCABULARY_KEYED_FAMILIES).toEqual(['Derived', 'Visual', 'Named-but-undefined']);
    expect(Object.isFrozen(VOCABULARY_KEYED_FAMILIES)).toBe(true);
  });

  it('does NOT contain Example', () => {
    expect(VOCABULARY_KEYED_FAMILIES).not.toContain('Example');
  });
});

describe('DERIVED_LINE_RE (pre-existing export, unchanged)', () => {
  it('still equals /^Derived \\(p\\.[^)]*\\)/i', () => {
    expect(DERIVED_LINE_RE.source).toBe('^Derived \\(p\\.[^)]*\\)');
    expect(DERIVED_LINE_RE.flags).toBe('i');
  });
});

describe('ANNOTATION_CITATION_RE', () => {
  // Byte-equality with the literal it replaces IS the zero-behavior-change proof for the three
  // pre-existing families; the fourth alternative (Example) is 178-01 Task 3's intended widening,
  // measured safe (178-01-MEASUREMENT/RESULTS.md: zero Example (p. lines in any reference game).
  it('is byte-equal (.source and .flags) to the four-name literal (178-01 Task 3 pin update)', () => {
    expect(ANNOTATION_CITATION_RE.source).toBe(
      'Derived \\(p\\.|Visual \\(p\\.|Named-but-undefined \\(p\\.|Example \\(p\\.',
    );
    expect(ANNOTATION_CITATION_RE.flags).toBe('i');
  });

  it('matches each family citation form anywhere in a string', () => {
    expect(ANNOTATION_CITATION_RE.test('Derived (p.1): the board has 8 spaces')).toBe(true);
    expect(ANNOTATION_CITATION_RE.test('Visual (p.2): a blue border')).toBe(true);
    expect(ANNOTATION_CITATION_RE.test('Named-but-undefined (p.3): "the active player"')).toBe(true);
    expect(ANNOTATION_CITATION_RE.test('Example (p.1): three READY guards become two')).toBe(true);
  });

  it('matches a multi-page citation body, including for Example', () => {
    expect(ANNOTATION_CITATION_RE.test('Derived (p.1, continues on p.2): the turn order')).toBe(true);
    expect(
      ANNOTATION_CITATION_RE.test('Example (p.1, continues on p.2): three READY guards become two'),
    ).toBe(true);
  });

  it('does not match a plain quoted rulebook sentence with no annotation marker', () => {
    expect(ANNOTATION_CITATION_RE.test('p.1, Setup: Deal five cards to each player.')).toBe(false);
  });

  it('does not match seven\'s real quote line — no (p. citation, so citation-keyed check is blind to it (expected)', () => {
    expect(ANNOTATION_CITATION_RE.test('"example: 5, 5, 5"')).toBe(false);
  });
});

describe('ANNOTATION_VOCABULARY_RE (178-01 Task 3 — MUST stay byte-equal, Example excluded)', () => {
  it('is byte-equal (.source and .flags) to the literal it replaces — UNCHANGED by 178-01', () => {
    expect(ANNOTATION_VOCABULARY_RE.source).toBe(
      '^[^A-Za-z0-9]*(?:Derived|Visual|Named-but-undefined)\\b',
    );
    expect(ANNOTATION_VOCABULARY_RE.flags).toBe('im');
  });

  it('matches a bare "Derived:" line with no citation', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('Derived: the board has 8 spaces')).toBe(true);
  });

  it('matches a decorated line, tolerating leading non-alphanumeric decoration', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('> - Visual: a blue border')).toBe(true);
    expect(ANNOTATION_VOCABULARY_RE.test('(Derived: the turn order)')).toBe(true);
  });

  it('does not match the word "derived" used mid-sentence', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('The score is derived from the remaining cards.')).toBe(
      false,
    );
  });

  it('does not match a bare "Example:" line — Example is deliberately excluded from the vocabulary-keyed family list', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('Example: three READY guards become two')).toBe(false);
  });

  // The measured hazard this split exists to avoid (178-01-MEASUREMENT/RESULTS.md): seven's real
  // quote lines must never be swept up by a vocabulary-keyed Example match.
  it('does not match seven\'s real quote line "example: 5, 5, 5"', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('"example: 5, 5, 5"')).toBe(false);
  });

  it('does not match seven\'s real quote line "example: 5, 6, 7"', () => {
    expect(ANNOTATION_VOCABULARY_RE.test('"example: 5, 6, 7"')).toBe(false);
  });
});

describe('annotationLineStartRe', () => {
  it("returns a regex equivalent to today's /^Visual \\(p\\.[^)]*\\)/i", () => {
    const re = annotationLineStartRe('Visual');
    expect(re.source).toBe('^Visual \\(p\\.[^)]*\\)');
    expect(re.flags).toBe('i');
  });

  it("returns a regex equivalent to today's /^Named-but-undefined \\(p\\.[^)]*\\)/i", () => {
    const re = annotationLineStartRe('Named-but-undefined');
    expect(re.source).toBe('^Named-but-undefined \\(p\\.[^)]*\\)');
    expect(re.flags).toBe('i');
  });

  it("returns a regex equivalent to today's /^Derived \\(p\\.[^)]*\\)/i", () => {
    const re = annotationLineStartRe('Derived');
    expect(re.source).toBe('^Derived \\(p\\.[^)]*\\)');
    expect(re.flags).toBe('i');
  });

  it('returns /^Example \\(p\\.[^)]*\\)/i for the new Example family (178-01 Task 3)', () => {
    const re = annotationLineStartRe('Example');
    expect(re.source).toBe('^Example \\(p\\.[^)]*\\)');
    expect(re.flags).toBe('i');
  });

  it('matches Example (p.1): ... and a multi-page Example citation', () => {
    const re = annotationLineStartRe('Example');
    expect(re.test('Example (p.1): three READY guards become two')).toBe(true);
    expect(re.test('Example (p.1, continues on p.2): three READY guards become two')).toBe(true);
  });

  it('does not match seven\'s real quote line "example: 5, 5, 5"', () => {
    const re = annotationLineStartRe('Example');
    expect(re.test('"example: 5, 5, 5"')).toBe(false);
  });
});

describe('ANNOTATION_CITATION_SOURCES', () => {
  it('is frozen and has one entry per family (now four, 178-01 Task 3 adds Example), in bare citation-body shape', () => {
    expect(Object.isFrozen(ANNOTATION_CITATION_SOURCES)).toBe(true);
    expect(ANNOTATION_CITATION_SOURCES).toEqual([
      '^Derived \\(p\\.\\d+\\):',
      '^Visual \\(p\\.\\d+\\):',
      '^Named-but-undefined \\(p\\.\\d+\\):',
      '^Example \\(p\\.\\d+\\):',
    ]);
  });
});

describe('derived-line-pattern.ts leaf-module constraint', () => {
  it('has zero import statements', async () => {
    const source = await fs.readFile(join(HERE, 'derived-line-pattern.ts'), 'utf-8');
    const importLines = source.split('\n').filter((line) => /^import\b/.test(line));
    expect(importLines).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// Single-definition grep gate (177.1-01 Task 2) — fails the build if a sixth hand-spelled copy
// of an annotation-family regex literal is ever introduced anywhere else under src/.
// -------------------------------------------------------------------------------------------

/** Strips `//` line comments and `/* *\/` block comments so a comment NAMING a family (e.g. this
 * very file's own prose) can never trip the gate — only executable regex literals count. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Literal (non-regex, `.includes()`) signature snippets, one per hand-spelled shape this plan
 * eliminated. Deliberately NOT a substring check against `verify-classify.ts`'s
 * `PRESENTATION_EXCLUSION_MARKERS` — that array's citation body is `\d+` (not `[^)]*`) and every
 * entry carries a `(?: \([^:]*\))?` qualifier-group suffix the family-pattern shapes below never
 * have, so none of these three snippets appears in it (verified: 177.1-01 finding, recorded in
 * the plan SUMMARY as an intentional non-consolidation).
 *
 * 1. The joint triple-alternation citation form (`ANY_ANNOTATION_LINE_RE`'s shape, formerly
 *    hand-spelled in both `verify-enumerate.ts` and the retired blind-derivation module).
 * 2. The joint triple-alternation vocabulary form (`ANNOTATION_VOCABULARY_RE`'s shape, formerly
 *    hand-spelled in `verify-enumerate.ts`).
 * 3/4. The single-family anchored citation form with a `[^)]*` body (`VISUAL_LINE_RE` /
 *    `NAMED_BUT_UNDEFINED_LINE_RE`'s shape, formerly hand-spelled in the retired blind-derivation
 *    module, now `verify-derive-check.ts`).
 *    `Derived` is deliberately excluded from this list: `DERIVED_LINE_RE` in
 *    `derived-line-pattern.ts` itself legitimately owns that exact literal, and every consumer
 *    re-exports/imports it rather than re-spelling it, so `Derived \(p\.[^)]*\)` appearing once
 *    (inside `derived-line-pattern.ts`, which this gate already excludes) is correct, not a leak.
 */
const HAND_SPELLED_SNIPPETS = [
  'Derived \\(p\\.|Visual \\(p\\.|Named-but-undefined \\(p\\.',
  '(?:Derived|Visual|Named-but-undefined)',
  'Visual \\(p\\.[^)]*\\)',
  'Named-but-undefined \\(p\\.[^)]*\\)',
];

async function walkTsFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...(await walkTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('single-definition grep gate', () => {
  it('finds zero hand-spelled annotation-family regex literals outside derived-line-pattern.ts', async () => {
    const allFiles = await walkTsFiles(SRC_ROOT);
    const offenders: Array<{ file: string; snippet: string }> = [];
    for (const file of allFiles) {
      const relPath = relative(SRC_ROOT, file);
      if (relPath === join('cli', 'commands', 'derived-line-pattern.ts')) continue;
      const raw = await fs.readFile(file, 'utf-8');
      const stripped = stripComments(raw);
      for (const snippet of HAND_SPELLED_SNIPPETS) {
        if (stripped.includes(snippet)) {
          offenders.push({ file: relPath, snippet });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
