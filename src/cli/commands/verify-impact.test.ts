import { describe, it, expect } from 'vitest';
import {
  RULES_STALENESS_HEADING,
  RULES_STALENESS_BEGIN,
  RULES_STALENESS_END,
  RULES_STALENESS_EMPTY,
  RULES_STALENESS_VALUES,
  RULES_STALENESS_CLEAR,
  RULES_STALE_MARKER,
  RULES_STALENESS_LABELS,
  SKETCH_RULES_STALENESS_GRAMMAR,
  renderRulesStaleness,
  renderRulesStalenessSection,
  parseRulesStaleness,
  type RulesStalenessRecord,
} from './verify-impact.js';

/**
 * `verify-impact.test.ts` — Task 1: the rules-staleness marker's constants, renderer, and
 * strict parser. Test names below carry the token `marker` per `175-VALIDATION.md`'s
 * `-t "marker"` selection convention.
 */

function baseRecord(overrides: Partial<RulesStalenessRecord> = {}): RulesStalenessRecord {
  return {
    marker: RULES_STALE_MARKER,
    runId: 'run-2026-07-30',
    ruleDelta: 'sharper',
    attributedSlices: [],
    adjudication: 'Designer confirmed the new reading applies.',
    ...overrides,
  };
}

describe('marker — enumerated values', () => {
  it('RULES_STALENESS_VALUES has exactly two members: clear and the rules-stale marker', () => {
    expect(RULES_STALENESS_VALUES).toHaveLength(2);
    expect(RULES_STALENESS_VALUES[0]).toBe('clear');
    expect(RULES_STALENESS_VALUES[1]).toBe(
      'rules-stale — rulebook moved since this chunk was verified',
    );
    expect(RULES_STALENESS_CLEAR).toBe('clear');
  });

  it('marker — RULES_STALE_MARKER is frozen and cannot be mutated at the array level', () => {
    expect(Object.isFrozen(RULES_STALENESS_VALUES)).toBe(true);
    expect(Object.isFrozen(RULES_STALENESS_LABELS)).toBe(true);
  });

  it('marker — the em-dash in RULES_STALE_MARKER is U+2014, not a hyphen', () => {
    const dash = [...RULES_STALE_MARKER].find((ch) => ch.codePointAt(0)! >= 0x2010);
    expect(dash).toBeDefined();
    expect(dash!.codePointAt(0)).toBe(0x2014);
  });

  it('marker — RULES_STALE_MARKER is unmistakably distinct from the insert-chunk stale marker', () => {
    const INSERT_CHUNK_STALE_MARKER = 'stale — re-derive before build';
    expect(RULES_STALE_MARKER).not.toBe(INSERT_CHUNK_STALE_MARKER);
    expect(RULES_STALE_MARKER.includes(INSERT_CHUNK_STALE_MARKER)).toBe(false);
    expect(INSERT_CHUNK_STALE_MARKER.includes(RULES_STALE_MARKER)).toBe(false);
  });

  it('SKETCH_RULES_STALENESS_GRAMMAR names the derived-pointer qualifier', () => {
    expect(SKETCH_RULES_STALENESS_GRAMMAR).toBe(
      'Rules Staleness (derived from chunks/<slug>/CHUNK.md):',
    );
  });
});

describe('marker — renderRulesStaleness', () => {
  it('renders every label in RULES_STALENESS_LABELS order', () => {
    const record = baseRecord({
      attributedSlices: ['rulebook/02-play.md'],
      priorReading: 'Ties are broken by seat order.',
      changedReading: 'Ties are broken by score margin.',
    });
    const body = renderRulesStaleness(record);
    let cursor = -1;
    for (const label of RULES_STALENESS_LABELS) {
      const idx = body.indexOf(label, cursor + 1);
      expect(idx, `expected ${label} after position ${cursor}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('renders Marker: as the LAST line of the body', () => {
    const record = baseRecord();
    const body = renderRulesStaleness(record).trim();
    const lastLine = body.split('\n').filter(Boolean).pop();
    expect(lastLine).toBe(`Marker: ${RULES_STALE_MARKER}`);
  });

  it('renders Attributed slices: as a markdown table when non-empty', () => {
    const record = baseRecord({ attributedSlices: ['rulebook/02-play.md', 'rulebook/03-scoring.md'] });
    const body = renderRulesStaleness(record);
    expect(body).toContain('| slice |');
    expect(body).toContain('| rulebook/02-play.md |');
    expect(body).toContain('| rulebook/03-scoring.md |');
  });

  it('renders RULES_STALENESS_EMPTY when Attributed slices is empty', () => {
    const record = baseRecord({ attributedSlices: [] });
    const body = renderRulesStaleness(record);
    expect(body).toContain(RULES_STALENESS_EMPTY);
  });

  it('omits Prior reading:/Changed reading: when absent', () => {
    const record = baseRecord();
    const body = renderRulesStaleness(record);
    expect(body).not.toContain('Prior reading:');
    expect(body).not.toContain('Changed reading:');
  });

  it('renders Prior reading:/Changed reading: verbatim when present', () => {
    const record = baseRecord({
      priorReading: 'Ties are broken by seat order.',
      changedReading: 'Ties are broken by score margin.',
    });
    const body = renderRulesStaleness(record);
    expect(body).toContain('Prior reading: Ties are broken by seat order.');
    expect(body).toContain('Changed reading: Ties are broken by score margin.');
  });
});

describe('marker — renderRulesStalenessSection', () => {
  it('emits the heading, a MACHINE-OWNED comment naming verify-impact-apply, and both fences', () => {
    const section = renderRulesStalenessSection(baseRecord());
    expect(section).toContain(RULES_STALENESS_HEADING);
    expect(section).toContain('MACHINE-OWNED');
    expect(section).toContain('boardsmith verify-impact-apply');
    expect(section).toContain(RULES_STALENESS_BEGIN);
    expect(section).toContain(RULES_STALENESS_END);
  });
});

describe('marker — parseRulesStaleness (strict)', () => {
  it('returns state unknown when the heading is absent entirely', () => {
    expect(parseRulesStaleness('# Chunk: test\n\nStatus: verified\n').state).toBe('unknown');
  });

  it('returns state unknown when a fence is missing', () => {
    const text = `# Chunk: test\n\n${RULES_STALENESS_HEADING}\n\nno fences here\n`;
    expect(parseRulesStaleness(text).state).toBe('unknown');
  });

  it('returns state unknown when the body is exactly RULES_STALENESS_EMPTY', () => {
    const text =
      `# Chunk: test\n\n${RULES_STALENESS_HEADING}\n\n${RULES_STALENESS_BEGIN}\n` +
      `${RULES_STALENESS_EMPTY}\n${RULES_STALENESS_END}\n`;
    expect(parseRulesStaleness(text).state).toBe('unknown');
  });

  it('returns state unknown when Marker: is not a member of RULES_STALENESS_VALUES', () => {
    const record = baseRecord();
    const body = renderRulesStaleness(record).replace(
      `Marker: ${RULES_STALE_MARKER}`,
      'Marker: totally-made-up',
    );
    const text = `# Chunk: test\n\n${RULES_STALENESS_HEADING}\n\n${RULES_STALENESS_BEGIN}${body}${RULES_STALENESS_END}\n`;
    expect(parseRulesStaleness(text).state).toBe('unknown');
  });

  it('returns state unknown when a required label is missing', () => {
    const record = baseRecord();
    const body = renderRulesStaleness(record).replace(/Adjudication:.*\n/, '');
    const text = `# Chunk: test\n\n${RULES_STALENESS_HEADING}\n\n${RULES_STALENESS_BEGIN}${body}${RULES_STALENESS_END}\n`;
    expect(parseRulesStaleness(text).state).toBe('unknown');
  });

  it('round-trips a real rendered section: state clear', () => {
    const record = baseRecord({ marker: RULES_STALENESS_CLEAR });
    const section = renderRulesStalenessSection(record);
    const text = `# Chunk: test\n\nStatus: verified\n\n${section}`;
    const parsed = parseRulesStaleness(text);
    expect(parsed.state).toBe('clear');
    expect(parsed.record?.marker).toBe(RULES_STALENESS_CLEAR);
    expect(parsed.record?.runId).toBe(record.runId);
    expect(parsed.record?.ruleDelta).toBe(record.ruleDelta);
    expect(parsed.record?.adjudication).toBe(record.adjudication);
  });

  it('round-trips a real rendered section: state rules-stale, with attributed slices', () => {
    const record = baseRecord({ attributedSlices: ['rulebook/02-play.md', 'rulebook/03-scoring.md'] });
    const section = renderRulesStalenessSection(record);
    const text = `# Chunk: test\n\nStatus: verified\n\n${section}`;
    const parsed = parseRulesStaleness(text);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.attributedSlices).toEqual([
      'rulebook/02-play.md',
      'rulebook/03-scoring.md',
    ]);
  });

  it('round-trips prior/changed readings verbatim', () => {
    const record = baseRecord({
      priorReading: 'Ties are broken by seat order.',
      changedReading: 'Ties are broken by score margin.',
    });
    const section = renderRulesStalenessSection(record);
    const text = `# Chunk: test\n\nStatus: verified\n\n${section}`;
    const parsed = parseRulesStaleness(text);
    expect(parsed.record?.priorReading).toBe('Ties are broken by seat order.');
    expect(parsed.record?.changedReading).toBe('Ties are broken by score margin.');
  });

  it('marker — a line-anchored heading match is required: a prose mention inside an HTML comment does not match', () => {
    // The literal "## Rules Staleness" text appears ONLY inside a PARSE CONTRACT-style comment,
    // embedded in surrounding prose on the same line — never alone on its own line — mirroring
    // the real f73153a3 defect class this parser must not repeat.
    const text =
      `# Chunk: test\n\n` +
      `<!-- PARSE CONTRACT: this file must contain "## Rules Staleness" among its headings. -->\n\n` +
      `Status: verified\n`;
    expect(text).toContain('## Rules Staleness');
    expect(parseRulesStaleness(text).state).toBe('unknown');
  });
});

describe('marker — no bare indexOf on the heading (structural guard)', () => {
  it('the module never calls indexOf(RULES_STALENESS_HEADING) outside comments', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(codeLines.join('\n')).not.toContain('indexOf(RULES_STALENESS_HEADING)');
  });

  it('the module ships its own distinct fence pair, never reusing VERIFIED_AGAINST_BEGIN in code', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(source).toContain('boardsmith:rules-staleness:begin');
    expect(codeLines.join('\n')).not.toContain('VERIFIED_AGAINST_BEGIN');
  });
});
