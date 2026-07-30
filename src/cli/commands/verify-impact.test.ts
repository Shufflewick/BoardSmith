import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
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
  writeRulesStalenessMarker,
  collectContradictions,
  formatBothReadings,
  verifyImpactGateCommand,
  nextRulingNumber,
  renderRuling,
  appendRuling,
  verifyImpactAdjudicateCommand,
  REPAIR_GATE_DISPOSITIONS,
  computeRepairGate,
  verifyImpactStatusCommand,
  verifyImpactApplyCommand,
  type RulesStalenessRecord,
  type Contradiction,
  type RepairGateDisposition,
} from './verify-impact.js';
import {
  VERIFIED_AGAINST_HEADING,
  VERIFIED_AGAINST_BEGIN,
  VERIFIED_AGAINST_END,
} from './chunk-provenance.js';
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  parseLedgerBody,
  resolveLedgerState,
  type ClassificationRecord,
  type AdjudicationRecord,
} from './verify-run.js';
import {
  verifyClassifyPairsCommand,
  verifyClassifyRecordCommand,
  type ChunkVerdict,
} from './verify-classify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRADICTORY_FIXTURE_ROOT = join(
  __dirname,
  '../../../.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory',
);

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

  it('never calls fs.writeFile directly (atomicWriteFile is the one write path)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(codeLines.join('\n')).not.toContain('fs.writeFile(');
  });

  it("writeRulesStalenessMarker's own body never mentions RULES_STALENESS_CLEAR or the word clear", async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const start = source.indexOf('export async function writeRulesStalenessMarker');
    expect(start).toBeGreaterThan(-1);
    // Bounded to the end of THIS function only (the next `// ---` section divider) — plan
    // 175-04 added unrelated later functions (e.g. `computeRepairGate`'s `clearMarker` field)
    // after this one in the same file, so slicing to EOF would false-positive on their names.
    const nextDividerIdx = source.indexOf('\n// ---', start + 1);
    const body = nextDividerIdx === -1 ? source.slice(start) : source.slice(start, nextDividerIdx);
    const codeLines = body.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(codeLines.join('\n').toLowerCase()).not.toContain('clear');
  });
});

/**
 * Task 2 — the CHUNK-first / SKETCH-second marker writer, over REAL temp-directory project
 * fixtures (real CHUNK.md/SKETCH.md pairs). Test names below carry the tokens `marker` and
 * `write-order` per `175-VALIDATION.md`'s `-t` selection convention.
 */

vi.mock('./verify-run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verify-run.js')>();
  return { ...actual, atomicWriteFile: vi.fn(actual.atomicWriteFile) };
});

const SLUG = 'movement';

function fixtureChunkText(): string {
  return (
    `# Chunk: ${SLUG}\n\n` +
    `Status: verified\n` +
    `<!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->\n\n` +
    `## Verified Against\n\n` +
    `${VERIFIED_AGAINST_BEGIN}\n_Not yet recorded._\n${VERIFIED_AGAINST_END}\n`
  );
}

function fixtureSketchText(): string {
  return (
    `# Sketch: Test Game\n\n` +
    `Sketch Version: 1\n\n` +
    `Session Lock: none\n\n` +
    `## Ordered Chunk List\n\n` +
    `### ${SLUG}\n` +
    `- What it builds: test\n` +
    `- Citations: none\n` +
    `- ui: none\n` +
    `- Milestone: none\n` +
    `- Status (derived from chunks/${SLUG}/CHUNK.md): verified\n` +
    `- Test script (outcome-based): n/a\n\n` +
    `## Mandated Chunks\n`
  );
}

function fixtureRecord(): Omit<RulesStalenessRecord, 'marker'> & { slug: string } {
  return {
    slug: SLUG,
    runId: 'run-2026-07-30',
    ruleDelta: 'sharper',
    attributedSlices: ['rulebook/02-play.md'],
    adjudication: 'Designer confirmed the new reading applies.',
  };
}

describe('marker write-order — writeRulesStalenessMarker', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-'));
    await fs.mkdir(join(dir, 'chunks', SLUG), { recursive: true });
    await fs.writeFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), fixtureChunkText());
    await fs.writeFile(join(dir, 'SKETCH.md'), fixtureSketchText());

    // Reset the mocked atomicWriteFile back to a plain call-through before every test, so a
    // prior test's mockImplementation override (the simulated SKETCH.md write failure) never
    // leaks into the next test.
    const { atomicWriteFile } = await import('./verify-run.js');
    const actualModule = await vi.importActual<typeof import('./verify-run.js')>('./verify-run.js');
    vi.mocked(atomicWriteFile).mockImplementation(actualModule.atomicWriteFile);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('marker — inserts the section immediately after "## Verified Against" when absent', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    expect(chunkText).toContain(RULES_STALENESS_HEADING);
    const vaIdx = chunkText.indexOf(VERIFIED_AGAINST_HEADING);
    const rsIdx = chunkText.indexOf(RULES_STALENESS_HEADING);
    expect(rsIdx).toBeGreaterThan(vaIdx);
  });

  it('marker — writes the marker as RULES_STALE_MARKER only, never RULES_STALENESS_CLEAR', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.marker).toBe(RULES_STALE_MARKER);
  });

  it('write-order — the written CHUNK.md fenced body\'s LAST non-empty line starts with Marker:', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const beginIdx = chunkText.indexOf(RULES_STALENESS_BEGIN);
    const endIdx = chunkText.indexOf(RULES_STALENESS_END);
    const body = chunkText.slice(beginIdx + RULES_STALENESS_BEGIN.length, endIdx).trim();
    const lastLine = body.split('\n').filter(Boolean).pop();
    expect(lastLine?.startsWith('Marker:')).toBe(true);
  });

  it('write-order — inserts the SKETCH.md derived pointer immediately after the Status line', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const sketchText = await fs.readFile(join(dir, 'SKETCH.md'), 'utf-8');
    const statusIdx = sketchText.indexOf(`- Status (derived from chunks/${SLUG}/CHUNK.md):`);
    const pointerIdx = sketchText.indexOf(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md):`,
    );
    expect(pointerIdx).toBeGreaterThan(statusIdx);
    const nextLine = sketchText.slice(statusIdx).split('\n')[1];
    expect(nextLine.startsWith('- Rules Staleness (derived from')).toBe(true);
  });

  it('write-order — the pointer line is on ITS OWN line: the very next bullet is neither swallowed nor fused onto it (175-08 live regression — a real SKETCH.md entry with a bullet immediately after Status, no blank-line separator)', async () => {
    // fixtureSketchText() already places "- Test script (outcome-based): n/a" directly after the
    // Status line with no blank line between them — matching one-two-punch's real "block"/
    // "movement-advance-retreat" entry shape exactly (175-08-PLAN.md §4). A prior version of
    // writeRulesStalenessMarker fused this line onto the end of the pointer line with no newline
    // between them; only checking `startsWith` (the test above) did not catch it because the fused
    // string still legitimately started with the expected prefix.
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const sketchText = await fs.readFile(join(dir, 'SKETCH.md'), 'utf-8');
    const lines = sketchText.split('\n');
    const pointerLineIdx = lines.findIndex((l) =>
      l.startsWith(`- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md):`),
    );
    expect(pointerLineIdx).toBeGreaterThan(-1);
    // The pointer line's OWN text ends exactly at the marker value — it must not contain any
    // other bullet's text fused onto its end.
    expect(lines[pointerLineIdx]).toBe(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALE_MARKER}`,
    );
    // The very next line is the untouched original bullet, on its own line, byte-for-byte intact.
    expect(lines[pointerLineIdx + 1]).toBe('- Test script (outcome-based): n/a');
  });

  it('write-order — CHUNK.md is written BEFORE SKETCH.md; a failed SKETCH.md write still leaves CHUNK.md written', async () => {
    const { atomicWriteFile } = await import('./verify-run.js');
    const mocked = vi.mocked(atomicWriteFile);
    mocked.mockImplementation(async (filePath: string, content: string) => {
      if (filePath.endsWith('SKETCH.md')) {
        throw new Error('simulated SKETCH.md write failure');
      }
      const actualModule = await vi.importActual<typeof import('./verify-run.js')>('./verify-run.js');
      await actualModule.atomicWriteFile(filePath, content);
    });

    await expect(writeRulesStalenessMarker(dir, fixtureRecord())).rejects.toThrow(
      'simulated SKETCH.md write failure',
    );

    const chunkText = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
  });

  it('marker — SKETCH.md is repaired to match CHUNK.md when its pointer disagrees; CHUNK.md bytes are unchanged', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkAfterFirst = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');

    // Seed SKETCH.md's derived pointer with the WRONG value.
    let sketchText = await fs.readFile(join(dir, 'SKETCH.md'), 'utf-8');
    sketchText = sketchText.replace(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALE_MARKER}`,
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALENESS_CLEAR}`,
    );
    await fs.writeFile(join(dir, 'SKETCH.md'), sketchText);

    const result = await writeRulesStalenessMarker(dir, fixtureRecord());
    expect(result.sketchRepaired).toBe(true);
    expect(result.chunkWritten).toBe(false);

    const chunkAfterSecond = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    expect(chunkAfterSecond).toBe(chunkAfterFirst);

    const repairedSketch = await fs.readFile(join(dir, 'SKETCH.md'), 'utf-8');
    expect(repairedSketch).toContain(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALE_MARKER}`,
    );
  });

  it('marker — a CHUNK.md missing RULES_STALENESS_END rejects, names both sentinels, and leaves the file untouched', async () => {
    const brokenText =
      fixtureChunkText() +
      `\n${RULES_STALENESS_HEADING}\n\n${RULES_STALENESS_BEGIN}\nbroken, no end fence\n`;
    await fs.writeFile(join(dir, 'chunks', SLUG, 'CHUNK.md'), brokenText);
    const before = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'));
    const beforeHash = createHash('sha256').update(before).digest('hex');

    await expect(writeRulesStalenessMarker(dir, fixtureRecord())).rejects.toThrow(
      /boardsmith:rules-staleness:begin[\s\S]*boardsmith:rules-staleness:end/,
    );

    const after = await fs.readFile(join(dir, 'chunks', SLUG, 'CHUNK.md'));
    const afterHash = createHash('sha256').update(after).digest('hex');
    expect(afterHash).toBe(beforeHash);
  });

  it('marker — a sketch-level tail entry (no chunks/<slug>/ directory reflected in SKETCH.md) is skipped, never written', async () => {
    const tailSketch =
      `# Sketch: Test Game\n\nSketch Version: 1\n\nSession Lock: none\n\n## Ordered Chunk List\n\n` +
      `## Mandated Chunks\n`;
    await fs.writeFile(join(dir, 'SKETCH.md'), tailSketch);

    const result = await writeRulesStalenessMarker(dir, fixtureRecord());
    expect(result.sketchWritten).toBe(false);
    expect(result.sketchRepaired).toBe(false);

    const sketchAfter = await fs.readFile(join(dir, 'SKETCH.md'), 'utf-8');
    expect(sketchAfter).toBe(tailSketch);
  });
});

/**
 * Task 1 — VERIFY-04's read side: contradiction collection and both-readings formatting. Test
 * names below carry the tokens `contradictory` and `no-bypass` per the plan's `-t` selection
 * convention.
 */

async function readRealContradictoryClassification(): Promise<ClassificationRecord> {
  const runMdText = await fs.readFile(
    join(CONTRADICTORY_FIXTURE_ROOT, 'staged/one-two-punch/RUN.md'),
    'utf-8',
  );
  const { lines } = parseLedgerBody(runMdText, 'RUN.md');
  const { classifications } = resolveLedgerState(lines);
  const contradictory = classifications.find((c) => c.ruleDelta === 'contradictory');
  if (!contradictory) {
    throw new Error('fixture RUN.md has no contradictory classification record');
  }
  return contradictory;
}

describe('contradictory — collectContradictions, over the REAL 174-07 contradictory verdict', () => {
  it('contradictory: the real fixture ledger line yields exactly one entry with both verbatim readings', async () => {
    const record = await readRealContradictoryClassification();
    const contradictions = collectContradictions({
      classifications: [record],
      adjudications: [],
      chunkVerdicts: [],
    });
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].quotedPass1).toContain('lower timing');
    expect(contradictions[0].quotedPass2).toContain('higher timing');
    expect(contradictions[0].adjudication).toBe('pending');
  });

  it('contradictory: one entry per FINDING, never per affected chunk — 6 synthetic ChunkVerdicts collapse to one Contradiction carrying all 6 slugs', async () => {
    const record = await readRealContradictoryClassification();
    const chunkVerdicts: ChunkVerdict[] = Array.from({ length: 6 }, (_, i) => ({
      slug: `chunk-${i}`,
      citedLiveSlices: record.liveSlices,
      pairIds: [record.pairId],
      ruleDelta: 'contradictory',
      stale: true,
      attributions: [],
    }));
    const contradictions = collectContradictions({
      classifications: [record],
      adjudications: [],
      chunkVerdicts,
    });
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].affectedSlugs).toHaveLength(6);
    expect(new Set(contradictions[0].affectedSlugs).size).toBe(6);
  });

  it('contradictory: a pair recorded UNADJUDICATED stays pending; a pair recorded resolved does not', async () => {
    const record = await readRealContradictoryClassification();
    const otherRecord: ClassificationRecord = { ...record, pairId: 'pages-9-9' };
    const adjudications: AdjudicationRecord[] = [
      {
        kind: 'adjudication',
        pairId: record.pairId,
        outcome: 'UNADJUDICATED',
        quotedPass1: record.quotedPass1!,
        quotedPass2: record.quotedPass2!,
        recordedAt: new Date().toISOString(),
      },
      {
        kind: 'adjudication',
        pairId: otherRecord.pairId,
        outcome: 'resolved',
        rulingNumber: 27,
        quotedPass1: otherRecord.quotedPass1!,
        quotedPass2: otherRecord.quotedPass2!,
        recordedAt: new Date().toISOString(),
      },
    ];
    const contradictions = collectContradictions({
      classifications: [record, otherRecord],
      adjudications,
      chunkVerdicts: [],
    });
    const pending = contradictions
      .filter((c) => c.adjudication !== 'resolved')
      .map((c) => c.pairId);
    expect(pending).toContain(record.pairId);
    expect(pending).not.toContain(otherRecord.pairId);
    const resolvedEntry = contradictions.find((c) => c.pairId === otherRecord.pairId);
    expect(resolvedEntry?.adjudication).toBe('resolved');
    expect(resolvedEntry?.rulingNumber).toBe(27);
  });

  it('contradictory: formatBothReadings lists every affected chunk uncapped — no ellipsis, no "and N more"', async () => {
    const record = await readRealContradictoryClassification();
    const contradiction: Contradiction = {
      pairId: record.pairId,
      liveSlices: record.liveSlices,
      stagedSlices: record.stagedSlices,
      provenance: record.provenance,
      quotedPass1: record.quotedPass1!,
      quotedPass2: record.quotedPass2!,
      evidence: record.evidence,
      affectedSlugs: Array.from({ length: 9 }, (_, i) => `chunk-${i}`),
      adjudication: 'pending',
    };
    const formatted = formatBothReadings(contradiction);
    expect(formatted).toContain('Affected chunks (9):');
    for (let i = 0; i < 9; i++) expect(formatted).toContain(`chunk-${i}`);
    expect(formatted).not.toMatch(/and \d+ more/i);
    expect(formatted).not.toContain('…');
    expect(formatted).toContain(record.quotedPass1!);
    expect(formatted).toContain(record.quotedPass2!);
  });
});

async function sha256OfDir(root: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const buf = await fs.readFile(abs);
        map[relative(root, abs)] = createHash('sha256').update(buf).digest('hex');
      }
    }
  }
  await walk(root);
  return map;
}

async function singleContradictoryPairProject(
  projectRoot: string,
): Promise<{ project: string; runId: string; pairId: string }> {
  const project = join(projectRoot, 'gate-project');
  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  await fs.writeFile(
    join(rulebookDir, 'a.md'),
    'p.1, A:\n"The player with the lower timing on their card must resolve their action first."\n',
  );

  const initResult = await verifyRunInitCommand({ project, json: true });
  const runId = initResult.runId;
  const stagingDirAbs = join(project, initResult.stagingDir);
  await fs.writeFile(
    join(stagingDirAbs, 'ua.md'),
    'p.1, A:\n"The player with the higher timing on their card must resolve their action first."\n',
  );
  await verifyRunRecordCommand({ project, runId, unit: 'ua', slice: 'ua.md', json: true });

  const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
  const pairId = pairsResult.pairs[0].pairId;

  await verifyClassifyRecordCommand({
    project,
    runId,
    pairId,
    label: 'contradictory',
    quotedPass1: 'The player with the lower timing on their card must resolve their action first.',
    quotedPass2: 'The player with the higher timing on their card must resolve their action first.',
    json: true,
  });

  return { project, runId, pairId };
}

describe('contradictory — verifyImpactGateCommand: read-only, exit-0, no-bypass', () => {
  let gateDir: string;

  beforeEach(async () => {
    gateDir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-gate-'));
  });

  afterEach(async () => {
    await fs.rm(gateDir, { recursive: true, force: true });
  });

  it('contradictory: verifyImpactGateCommand surfaces the recorded contradictory pair, pending, exit 0', async () => {
    const { project, runId, pairId } = await singleContradictoryPairProject(gateDir);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    const result = await verifyImpactGateCommand({ project, runId, json: true });

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].pairId).toBe(pairId);
    expect(result.pending).toContain(pairId);
    expect(result.summary.contradictory).toBe(1);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);

    process.exitCode = previousExitCode;
  });

  it('contradictory: verifyImpactGateCommand is read-only — a whole-project sha256 map is byte-identical before and after', async () => {
    const { project, runId } = await singleContradictoryPairProject(gateDir);
    const before = await sha256OfDir(project);

    await verifyImpactGateCommand({ project, runId, json: true });

    const after = await sha256OfDir(project);
    expect(after).toEqual(before);
  });

  it('no-bypass: verifyImpactGateCommand has exactly project/runId/json options — no force/skip/yes/assumeResolved/bypass/autoAdjudicate anywhere in this module', async () => {
    const fs2 = await import('node:fs/promises');
    const moduleSource = await fs2.readFile(
      join(__dirname, 'verify-impact.ts'),
      'utf-8',
    );
    const nonCommentLines = moduleSource
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
    expect(
      (nonCommentLines.match(/process\.env|force|bypass|--yes|assumeResolved|autoAdjudicate/gi) ?? [])
        .length,
    ).toBe(0);
  });
});

/**
 * Task 2 — the RULINGS.md append and the UNADJUDICATED record. Test names below carry the
 * tokens `contradictory`, `unadjudicated`, and `no-bypass` per the plan's `-t` selection
 * convention.
 */

/**
 * A hand-built 26-entry corpus mirroring the real `~/BoardSmithGames/one-two-punch/RULINGS.md`
 * shape exactly (three fields, no supersede verb) — used when the sibling game repo is not
 * reachable in this environment. Tests below prefer the REAL file when present.
 */
function syntheticRulingsCorpus(): string {
  const header =
    '# Rulings\n\n' +
    '<!-- This is an append-only ledger of designer decisions. -->\n\n';
  const blocks: string[] = [];
  for (let i = 1; i <= 26; i++) {
    blocks.push(
      `### Ruling ${i}\n` +
        `- Decision: **Synthetic decision ${i}.**\n` +
        `- Citation interpreted or overridden: rulebook/section-${i}.md, p.${i} — ` +
        `"Synthetic citation text ${i}."\n` +
        `- Rationale: Synthetic rationale ${i}.\n`,
    );
  }
  return header + blocks.join('\n');
}

async function realOrSyntheticRulingsCorpus(): Promise<{ text: string; real: boolean }> {
  const realPath = join(homedir(), 'BoardSmithGames', 'one-two-punch', 'RULINGS.md');
  try {
    const text = await fs.readFile(realPath, 'utf-8');
    return { text, real: true };
  } catch {
    return { text: syntheticRulingsCorpus(), real: false };
  }
}

describe('contradictory — nextRulingNumber / appendRuling — over a real 26-entry RULINGS.md (or a hand-built 26-entry stand-in, named per test)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-rulings-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('contradictory: nextRulingNumber returns 27 on a 26-entry corpus (real one-two-punch RULINGS.md when reachable, else a hand-built 26-entry stand-in)', async () => {
    const { text } = await realOrSyntheticRulingsCorpus();
    expect(nextRulingNumber(text)).toBe(27);
  });

  it('contradictory: renderRuling emits exactly the three real field labels, never a supersession field', () => {
    const block = renderRuling({
      number: 27,
      decision: 'A test decision.',
      citation: 'rulebook/test.md, p.1 — "test citation".',
      rationale: 'A test rationale.',
    });
    expect(block).toMatch(
      /^### Ruling 27\n- Decision: .+\n- Citation interpreted or overridden: .+\n- Rationale: .+$/m,
    );
    expect(block).not.toMatch(/supersede[sd]?/i);
  });

  it('contradictory: nextRulingNumber returns 1 for a corpus with no entries', () => {
    expect(nextRulingNumber('# Rulings\n\nNo rulings yet.\n')).toBe(1);
  });

  it('contradictory: appendRuling is append-only — the new file content startsWith the original byte-for-byte', async () => {
    const { text } = await realOrSyntheticRulingsCorpus();
    await fs.writeFile(join(dir, 'RULINGS.md'), text);

    const result = await appendRuling(dir, {
      decision: 'A test decision.',
      citation: 'rulebook/test.md, p.1 — "test citation".',
      rationale: 'A test rationale.',
    });
    expect(result.number).toBe(27);

    const newText = await fs.readFile(join(dir, 'RULINGS.md'), 'utf-8');
    expect(newText.startsWith(text)).toBe(true);
  });

  it('contradictory: the appended block matches the corpus\'s own three-field ### Ruling N shape', async () => {
    const { text } = await realOrSyntheticRulingsCorpus();
    await fs.writeFile(join(dir, 'RULINGS.md'), text);

    await appendRuling(dir, {
      decision: 'A test decision.',
      citation: 'rulebook/test.md, p.1 — "test citation".',
      rationale: 'A test rationale.',
    });

    const newText = await fs.readFile(join(dir, 'RULINGS.md'), 'utf-8');
    expect(newText).toMatch(
      /^### Ruling 27\n- Decision: .+\n- Citation interpreted or overridden: .+\n- Rationale: .+$/m,
    );
  });

  it('contradictory: the appended entry contains both real quotedPass1 and quotedPass2 verbatim, and does NOT match /supersede[sd]?/i', async () => {
    const { text } = await realOrSyntheticRulingsCorpus();
    await fs.writeFile(join(dir, 'RULINGS.md'), text);
    const record = await readRealContradictoryClassification();

    await appendRuling(dir, {
      decision: 'The higher-timing reading applies going forward.',
      citation: `Reading as built: "${record.quotedPass1}" — Reading in the fresh transcription: "${record.quotedPass2}"`,
      rationale: 'Designer confirmed at the adjudication gate.',
    });

    const newText = await fs.readFile(join(dir, 'RULINGS.md'), 'utf-8');
    const appendedBlock = newText.slice(newText.indexOf('### Ruling 27'));
    expect(appendedBlock).toContain(record.quotedPass1);
    expect(appendedBlock).toContain(record.quotedPass2);
    expect(appendedBlock).not.toMatch(/supersede[sd]?/i);
  });

  it('appendRuling throws an actionable error when RULINGS.md does not exist, and never creates one', async () => {
    await expect(
      appendRuling(dir, { decision: 'x', citation: 'y', rationale: 'z' }),
    ).rejects.toThrow(/No RULINGS\.md found/);
    await expect(fs.access(join(dir, 'RULINGS.md'))).rejects.toThrow();
  });
});

describe('unadjudicated — verifyImpactAdjudicateCommand: resolved requires human prose, UNADJUDICATED writes no ruling, idempotent per pair', () => {
  let adjDir: string;

  beforeEach(async () => {
    adjDir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-adjudicate-'));
  });

  afterEach(async () => {
    await fs.rm(adjDir, { recursive: true, force: true });
  });

  async function contradictoryProjectWithRulings(): Promise<{
    project: string;
    runId: string;
    pairId: string;
  }> {
    const { project, runId, pairId } = await singleContradictoryPairProject(adjDir);
    const { text } = await realOrSyntheticRulingsCorpus();
    await fs.writeFile(join(project, 'RULINGS.md'), text);
    return { project, runId, pairId };
  }

  it('unadjudicated: outcome "resolved" with no --decision rejects with a message naming the missing field', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    await expect(
      verifyImpactAdjudicateCommand({
        project,
        runId,
        pairId,
        outcome: 'resolved',
        citation: 'some citation',
        rationale: 'some rationale',
        json: true,
      }),
    ).rejects.toThrow(/decision/);
  });

  it('unadjudicated: outcome "UNADJUDICATED" writes NO RULINGS.md entry (sha256 unchanged) and records an AdjudicationRecord with that outcome', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const before = await fs.readFile(join(project, 'RULINGS.md'));
    const beforeHash = createHash('sha256').update(before).digest('hex');

    const result = await verifyImpactAdjudicateCommand({
      project,
      runId,
      pairId,
      outcome: 'UNADJUDICATED',
      json: true,
    });
    expect(result.outcome).toBe('UNADJUDICATED');
    expect(result.rulingNumber).toBeUndefined();

    const after = await fs.readFile(join(project, 'RULINGS.md'));
    const afterHash = createHash('sha256').update(after).digest('hex');
    expect(afterHash).toBe(beforeHash);

    const gateResult = await verifyImpactGateCommand({ project, runId, json: true });
    const entry = gateResult.contradictions.find((c) => c.pairId === pairId);
    expect(entry?.adjudication).toBe('UNADJUDICATED');
    expect(gateResult.pending).toContain(pairId);
  });

  it('unadjudicated: outcome "resolved" appends a Ruling N entry and marks the pair resolved (not pending)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();

    const result = await verifyImpactAdjudicateCommand({
      project,
      runId,
      pairId,
      outcome: 'resolved',
      decision: 'The higher-timing reading applies going forward.',
      citation: 'rulebook/a.md, p.1',
      rationale: 'Designer confirmed at the adjudication gate.',
      json: true,
    });
    expect(result.outcome).toBe('resolved');
    expect(result.rulingNumber).toBe(27);

    const rulingsText = await fs.readFile(join(project, 'RULINGS.md'), 'utf-8');
    expect(rulingsText).toContain('### Ruling 27');

    const gateResult = await verifyImpactGateCommand({ project, runId, json: true });
    const entry = gateResult.contradictions.find((c) => c.pairId === pairId);
    expect(entry?.adjudication).toBe('resolved');
    expect(gateResult.pending).not.toContain(pairId);
  });

  it('unadjudicated: a second "resolved" call for the same pair reuses the same ruling number and does NOT append a second RULINGS.md entry', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();

    const first = await verifyImpactAdjudicateCommand({
      project,
      runId,
      pairId,
      outcome: 'resolved',
      decision: 'First resolution text.',
      citation: 'rulebook/a.md, p.1',
      rationale: 'First rationale.',
      json: true,
    });

    const second = await verifyImpactAdjudicateCommand({
      project,
      runId,
      pairId,
      outcome: 'resolved',
      decision: 'Second resolution text (idempotent re-run).',
      citation: 'rulebook/a.md, p.1',
      rationale: 'Second rationale.',
      json: true,
    });

    expect(second.rulingNumber).toBe(first.rulingNumber);

    const rulingsText = await fs.readFile(join(project, 'RULINGS.md'), 'utf-8');
    const occurrences = rulingsText.match(/^### Ruling 27$/gm) ?? [];
    expect(occurrences).toHaveLength(1);

    // A second ledger line IS appended (last-write-wins per pairId), even though RULINGS.md
    // gains no second entry.
    const ledgerText = await fs.readFile(
      join(project, 'rulebook', '.verify', runId, 'RUN.md'),
      'utf-8',
    );
    const { lines } = parseLedgerBody(ledgerText, 'RUN.md');
    const adjudicationLines = lines.filter(
      (l) => l.type === 'adjudication' && l.record.pairId === pairId,
    );
    expect(adjudicationLines.length).toBe(2);
  });

  it('no-bypass: verifyImpactAdjudicateCommand rejects an --outcome value other than "resolved"/"UNADJUDICATED"', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    await expect(
      verifyImpactAdjudicateCommand({
        project,
        runId,
        pairId,
        // @ts-expect-error — intentionally passing a non-representable outcome to prove no
        // bypass value is accepted at runtime either.
        outcome: 'skip',
        json: true,
      }),
    ).rejects.toThrow(/resolved.*UNADJUDICATED|UNADJUDICATED.*resolved/s);
  });
});

/**
 * Task 1 (second half) — `computeRepairGate`, pure and total, table-driven across every
 * status × driftState × stale combination. Test names carry the token `repair-gate`.
 */

describe('repair-gate — computeRepairGate (pure, total)', () => {
  const STATUSES = ['verified', 'verified (user-waived)', 'built'] as const;
  const DRIFT_STATES = ['clean', 'drifted', 'unknown'] as const;
  const STALE_VALUES = [true, false] as const;

  it('repair-gate: driftState unknown never yields nextStatus and never yields clearMarker: true, for every status and stale value', () => {
    for (const status of STATUSES) {
      for (const stale of STALE_VALUES) {
        const gate = computeRepairGate({ status, stale, driftState: 'unknown' });
        expect(gate.disposition).toBe('unknown-drift');
        expect(gate.nextStatus).toBeUndefined();
        expect(gate.clearMarker).toBe(false);
      }
    }
  });

  it('repair-gate: a non-stale chunk is not-applicable regardless of status or driftState (except unknown, which still wins)', () => {
    for (const status of STATUSES) {
      for (const driftState of DRIFT_STATES) {
        const gate = computeRepairGate({ status, stale: false, driftState });
        if (driftState === 'unknown') {
          expect(gate.disposition).toBe('unknown-drift');
        } else {
          expect(gate.disposition).toBe('not-applicable');
        }
      }
    }
  });

  it('repair-gate: a non-verified* status (built) is not-applicable when stale and driftState is resolved (clean/drifted)', () => {
    for (const driftState of ['clean', 'drifted'] as const) {
      const gate = computeRepairGate({ status: 'built', stale: true, driftState });
      expect(gate.disposition).toBe('not-applicable');
      expect(gate.nextStatus).toBeUndefined();
      expect(gate.clearMarker).toBe(false);
    }
  });

  it('repair-gate: verified + stale + drifted -> reopen-playtest, nextStatus built, clearMarker true', () => {
    const gate = computeRepairGate({ status: 'verified', stale: true, driftState: 'drifted' });
    expect(gate).toMatchObject({
      disposition: 'reopen-playtest',
      nextStatus: 'built',
      clearMarker: true,
      reverifyStamp: false,
    });
  });

  it('no-code-change: verified + stale + clean -> close-without-replaytest, nextStatus verified, reverifyStamp true', () => {
    const gate = computeRepairGate({ status: 'verified', stale: true, driftState: 'clean' });
    expect(gate).toMatchObject({
      disposition: 'close-without-replaytest',
      nextStatus: 'verified',
      clearMarker: true,
      reverifyStamp: true,
    });
  });

  it('waived-reopen: verified (user-waived) + stale + drifted -> reopen-playtest, nextStatus built — the waiver is NOT renewed', () => {
    const gate = computeRepairGate({
      status: 'verified (user-waived)',
      stale: true,
      driftState: 'drifted',
    });
    expect(gate.disposition).toBe('reopen-playtest');
    expect(gate.nextStatus).toBe('built');
  });

  it('waived-reopen: verified (user-waived) + stale + clean -> close-without-replaytest, nextStatus preserves the waiver verbatim', () => {
    const gate = computeRepairGate({
      status: 'verified (user-waived)',
      stale: true,
      driftState: 'clean',
    });
    expect(gate.disposition).toBe('close-without-replaytest');
    expect(gate.nextStatus).toBe('verified (user-waived)');
  });

  it('repair-gate: REPAIR_GATE_DISPOSITIONS is frozen with exactly the four documented members', () => {
    expect(Object.isFrozen(REPAIR_GATE_DISPOSITIONS)).toBe(true);
    expect(REPAIR_GATE_DISPOSITIONS).toEqual([
      'reopen-playtest',
      'close-without-replaytest',
      'unknown-drift',
      'not-applicable',
    ]);
  });

  it('repair-gate: full 3x3x2 table — every combination resolves to one of the four dispositions with a non-empty reason', () => {
    for (const status of STATUSES) {
      for (const driftState of DRIFT_STATES) {
        for (const stale of STALE_VALUES) {
          const gate = computeRepairGate({ status, stale, driftState });
          expect(REPAIR_GATE_DISPOSITIONS as readonly RepairGateDisposition[]).toContain(
            gate.disposition,
          );
          expect(gate.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

/**
 * Task 1/2 — `verifyImpactStatusCommand`/`verifyImpactApplyCommand` over a real project fixture:
 * a real git repo, a real verify-run/verify-classify pipeline, a real `chunks/movement/CHUNK.md`
 * citing the changed rulebook slice with a quoted-fragment `## Interpretation` anchor (so the
 * chunk verdict is genuinely `stale: true`), a real `## Build Manifest`/`## Verified Commit Hash`
 * pair drift-check reads. Test names carry `repair-gate`, `no-code-change`, `waived-reopen`,
 * `line-level-handoff`, `contradictory`, `marker`, and `no-bypass` per the plan's `-t` convention.
 */

const IMPACT_QUOTED_PASS1 = 'The lower timing on their card resolves first.';

async function buildImpactTestProject(
  root: string,
  opts: { ruleDelta?: 'sharper' | 'contradictory'; drift?: 'clean' | 'drifted' } = {},
): Promise<{ project: string; runId: string; pairId: string; firstSha: string }> {
  const project = join(root, `impact-project-${Math.random().toString(36).slice(2)}`);
  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  await fs.writeFile(join(rulebookDir, 'x.md'), `p.1, X:\n"${IMPACT_QUOTED_PASS1}"\n`);
  // A second, unrelated live slice + cosmetic pair, cited by a SECOND chunk that must stay
  // untouched by `verify-impact-apply` (its `ChunkVerdict.stale` is `false`).
  await fs.writeFile(join(rulebookDir, 'y.md'), 'p.2, Y:\n"Scoring is unaffected by this change."\n');

  execSync('git init', { cwd: project, stdio: 'ignore' });
  await fs.mkdir(join(project, 'src'), { recursive: true });
  await fs.writeFile(join(project, 'src', 'movement.ts'), 'export const movement = 1;\n');
  execSync('git add -A', { cwd: project, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m first', { cwd: project, stdio: 'ignore' });
  const firstSha = execSync('git rev-parse HEAD', { cwd: project }).toString().trim();

  if (opts.drift === 'drifted') {
    await fs.writeFile(join(project, 'src', 'movement.ts'), 'export const movement = 2;\n');
    execSync('git add -A', { cwd: project, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m second', { cwd: project, stdio: 'ignore' });
  }

  const movementChunkDir = join(project, 'chunks', 'movement');
  await fs.mkdir(movementChunkDir, { recursive: true });
  await fs.writeFile(
    join(movementChunkDir, 'CHUNK.md'),
    `# Chunk: movement\n\n` +
      `Status: verified\n` +
      `<!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->\n\n` +
      `Cites rulebook/x.md.\n\n` +
      `## Interpretation\n1. **Movement resolves by timing.** "${IMPACT_QUOTED_PASS1}" (p.1)\n\n` +
      `## Verified Against\n\n${VERIFIED_AGAINST_BEGIN}\n_Not yet recorded._\n${VERIFIED_AGAINST_END}\n\n` +
      `## Build Manifest\n\n| File | Status |\n|---|---|\n| src/movement.ts | NEW |\n\n` +
      `## Verified Commit Hash\n\n${firstSha}\n`,
  );

  const scoringChunkDir = join(project, 'chunks', 'scoring');
  await fs.mkdir(scoringChunkDir, { recursive: true });
  await fs.writeFile(
    join(scoringChunkDir, 'CHUNK.md'),
    `# Chunk: scoring\n\n` +
      `Status: verified\n` +
      `<!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->\n\n` +
      `Cites rulebook/y.md.\n\n` +
      `## Verified Against\n\n${VERIFIED_AGAINST_BEGIN}\n_Not yet recorded._\n${VERIFIED_AGAINST_END}\n\n` +
      `## Build Manifest\n\n| File | Status |\n|---|---|\n| src/movement.ts | NEW |\n\n` +
      `## Verified Commit Hash\n\n${firstSha}\n`,
  );

  await fs.writeFile(
    join(project, 'SKETCH.md'),
    `# Sketch: Test Game\n\nSketch Version: 1\n\nSession Lock: none\n\n## Ordered Chunk List\n\n` +
      `### movement\n- What it builds: test\n- Citations: none\n- ui: none\n- Milestone: none\n` +
      `- Status (derived from chunks/movement/CHUNK.md): verified\n- Test script (outcome-based): n/a\n\n` +
      `### scoring\n- What it builds: test\n- Citations: none\n- ui: none\n- Milestone: none\n` +
      `- Status (derived from chunks/scoring/CHUNK.md): verified\n- Test script (outcome-based): n/a\n\n` +
      `## Mandated Chunks\n`,
  );

  const initResult = await verifyRunInitCommand({ project, json: true });
  const runId = initResult.runId;
  const stagingDirAbs = join(project, initResult.stagingDir);

  const changedLine =
    opts.ruleDelta === 'contradictory'
      ? 'The higher timing on their card resolves first.'
      : 'The lower timing on their card resolves first, and ties favor the active player.';
  await fs.writeFile(join(stagingDirAbs, 'ux.md'), `p.1, X:\n"${changedLine}"\n`);
  await fs.writeFile(join(stagingDirAbs, 'uy.md'), 'p.2, Y:\n"Scoring is unaffected by this change."\n');
  await verifyRunRecordCommand({ project, runId, unit: 'ux', slice: 'ux.md', json: true });
  await verifyRunRecordCommand({ project, runId, unit: 'uy', slice: 'uy.md', json: true });

  const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
  const xPair = pairsResult.pairs.find((p) => p.liveSlices.some((s) => s.includes('x.md')));
  const yPair = pairsResult.pairs.find((p) => p.liveSlices.some((s) => s.includes('y.md')));
  if (!xPair || !yPair) {
    throw new Error('fixture bug: expected one pair each for x.md and y.md');
  }

  await verifyClassifyRecordCommand({
    project,
    runId,
    pairId: xPair.pairId,
    label: opts.ruleDelta ?? 'sharper',
    quotedPass1: IMPACT_QUOTED_PASS1,
    quotedPass2: changedLine,
    json: true,
  });
  await verifyClassifyRecordCommand({
    project,
    runId,
    pairId: yPair.pairId,
    label: 'cosmetic',
    json: true,
  });

  return { project, runId, pairId: xPair.pairId, firstSha };
}

async function sha256OfProject(root: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        const buf = await fs.readFile(abs);
        map[relative(root, abs)] = createHash('sha256').update(buf).digest('hex');
      }
    }
  }
  await walk(root);
  return map;
}

describe('line-level-handoff / repair-gate — verifyImpactStatusCommand over a real project', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-status-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('no-code-change: a verified chunk whose code did not change reports close-without-replaytest, nextStatus verified, and 1-of-2 staleFraction', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    const result = await verifyImpactStatusCommand({ project, runId, json: true });

    expect(result.staleFraction).toEqual({ stale: 1, total: 2 });
    expect(result.staleSlugs).toEqual(['movement']);

    const movement = result.entries.find((e) => e.slug === 'movement')!;
    expect(movement.driftState).toBe('clean');
    expect(movement.gate.disposition).toBe('close-without-replaytest');
    expect(movement.gate.nextStatus).toBe('verified');

    const scoring = result.entries.find((e) => e.slug === 'scoring')!;
    expect(scoring.stale).toBe(false);
    expect(scoring.gate.disposition).toBe('not-applicable');
  });

  it('repair-gate: a verified chunk whose code DID change reports reopen-playtest, nextStatus built', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'drifted' });

    const result = await verifyImpactStatusCommand({ project, runId, json: true });

    const movement = result.entries.find((e) => e.slug === 'movement')!;
    expect(movement.driftState).toBe('drifted');
    expect(movement.changedFiles).toContain('src/movement.ts');
    expect(movement.gate.disposition).toBe('reopen-playtest');
    expect(movement.gate.nextStatus).toBe('built');
  });

  it('line-level-handoff: ImpactMapEntry.attributions deep-equals the source ChunkVerdict.attributions verbatim', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    const classifyStatus = await import('./verify-classify.js').then((m) =>
      m.verifyClassifyStatusCommand({ project, runId, json: true }),
    );
    const result = await verifyImpactStatusCommand({ project, runId, json: true });

    const sourceVerdict = classifyStatus.chunkVerdicts.find((v) => v.slug === 'movement')!;
    const entry = result.entries.find((e) => e.slug === 'movement')!;
    expect(entry.attributions).toEqual(sourceVerdict.attributions);
    expect(entry.attributions.some((a) => a.attributed && a.rung === 'quoted-fragment')).toBe(true);
  });

  it('repair-gate: the human report string contains "1 of 2" and the stale slug, uncapped', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await verifyImpactStatusCommand({ project, runId });

    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('1 of 2');
    expect(printed).toContain('movement');
    logSpy.mockRestore();
  });

  it('verifyImpactStatusCommand is read-only — a whole-project sha256 map is byte-identical before and after', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const before = await sha256OfProject(project);

    await verifyImpactStatusCommand({ project, runId, json: true });

    const after = await sha256OfProject(project);
    expect(after).toEqual(before);
  });

  it('no-bypass: the module never re-derives code movement with a second hash scheme (no createHash/git diff/rev-parse call sites outside drift-check.ts)', async () => {
    const source = await fs.readFile(join(__dirname, 'verify-impact.ts'), 'utf-8');
    const nonCommentLines = source.split('\n').filter((l) => !/^\s*[*/]/.test(l)).join('\n');
    expect((nonCommentLines.match(/createHash|git diff|revParse/gi) ?? []).length).toBe(0);
  });
});

/**
 * Task 2 — `verifyImpactApplyCommand`. Test names carry `contradictory`, `unadjudicated`,
 * `marker`, and `no-bypass` per the plan's `-t` convention.
 */

describe('contradictory / marker — verifyImpactApplyCommand', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bs-verify-impact-apply-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('contradictory: a pending contradiction blocks the write entirely — byte-identical project, message names verify-impact-adjudicate', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, {
      ruleDelta: 'contradictory',
      drift: 'clean',
    });
    const before = await sha256OfProject(project);

    const result = await verifyImpactApplyCommand({ project, runId, json: true });

    expect(result.blocked).toBe(true);
    expect(result.pendingPairs).toContain(pairId);
    expect(result.marked).toEqual([]);

    const after = await sha256OfProject(project);
    expect(after).toEqual(before);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await verifyImpactApplyCommand({ project, runId });
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(printed).toContain('verify-impact-adjudicate');
    logSpy.mockRestore();
  });

  it('unadjudicated: a contradiction recorded UNADJUDICATED does not block — the chunk is marked stale with Adjudication: UNADJUDICATED', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, {
      ruleDelta: 'contradictory',
      drift: 'clean',
    });

    await verifyImpactAdjudicateCommand({ project, runId, pairId, outcome: 'UNADJUDICATED', json: true });

    const result = await verifyImpactApplyCommand({ project, runId, json: true });
    expect(result.blocked).toBe(false);
    expect(result.marked.some((m) => m.slug === 'movement')).toBe(true);

    const chunkText = await fs.readFile(join(project, 'chunks', 'movement', 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.adjudication).toBe('UNADJUDICATED');
  });

  it('marker: a chunk whose ChunkVerdict.stale is false is left byte-identical after the run', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const before = await fs.readFile(join(project, 'chunks', 'scoring', 'CHUNK.md'));
    const beforeHash = createHash('sha256').update(before).digest('hex');

    await verifyImpactApplyCommand({ project, runId, json: true });

    const after = await fs.readFile(join(project, 'chunks', 'scoring', 'CHUNK.md'));
    const afterHash = createHash('sha256').update(after).digest('hex');
    expect(afterHash).toBe(beforeHash);
  });

  it('marker: running verifyImpactApplyCommand twice leaves exactly one "## Rules Staleness" heading and one begin sentinel', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    await verifyImpactApplyCommand({ project, runId, json: true });
    await verifyImpactApplyCommand({ project, runId, json: true });

    const chunkText = await fs.readFile(join(project, 'chunks', 'movement', 'CHUNK.md'), 'utf-8');
    const headingOccurrences = chunkText.match(/^## Rules Staleness$/gm) ?? [];
    const beginOccurrences = chunkText.match(/boardsmith:rules-staleness:begin/g) ?? [];
    expect(headingOccurrences).toHaveLength(1);
    expect(beginOccurrences).toHaveLength(1);
  });

  it('marker: one ImpactRecord is appended to the run ledger per marked chunk', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    await verifyImpactApplyCommand({ project, runId, json: true });

    const ledgerText = await fs.readFile(join(project, 'rulebook', '.verify', runId, 'RUN.md'), 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, 'RUN.md');
    const impactLines = lines.filter((l) => l.type === 'impact');
    expect(impactLines.some((l: any) => l.record.slug === 'movement')).toBe(true);
  });

  it('no-bypass: the module registers no --clear/--force/--skip-gate/--yes option and reads no process.env', async () => {
    const source = await fs.readFile(join(__dirname, 'verify-impact.ts'), 'utf-8');
    const nonCommentLines = source.split('\n').filter((l) => !/^\s*[*/]/.test(l)).join('\n');
    expect(
      (nonCommentLines.match(/--clear|skipGate|--force|--yes|process\.env/gi) ?? []).length,
    ).toBe(0);
  });

  it('no-bypass: the module never sets process.exitCode', async () => {
    const source = await fs.readFile(join(__dirname, 'verify-impact.ts'), 'utf-8');
    const nonCommentLines = source.split('\n').filter((l) => !/^\s*[*/]/.test(l)).join('\n');
    expect((nonCommentLines.match(/process\.exitCode/g) ?? []).length).toBe(0);
  });
});

/**
 * Task 3 — CLI registration (`cli.ts`). Greps the real entry-point source rather than importing
 * it, since `cli.ts` calls `program.parse()` at module scope (a side-effecting import).
 */

describe('cli.ts — verify-impact-* registration', () => {
  it('registers all four verify-impact-* commands, chunk-check gains --reverified-no-code-change, and no command declares a bypass option', async () => {
    const cliSource = await fs.readFile(join(__dirname, '..', 'cli.ts'), 'utf-8');

    for (const name of [
      'verify-impact-gate',
      'verify-impact-adjudicate',
      'verify-impact-apply',
      'verify-impact-status',
    ]) {
      expect(cliSource).toContain(`.command('${name}')`);
    }

    expect((cliSource.match(/verify-impact-/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(cliSource).toContain('--reverified-no-code-change');

    // Scoped to the verify-impact-* registration block only — `--force` legitimately exists
    // elsewhere in cli.ts (the unrelated `claude` command's `--force` to overwrite skills).
    const blockStart = cliSource.indexOf("verify-impact-gate'");
    const blockEnd = cliSource.indexOf('// Claude Code integration');
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = cliSource.slice(blockStart, blockEnd);
    for (const bypass of ['--force', '--yes', '--skip-gate', '--clear']) {
      expect(block).not.toContain(bypass);
    }
  });
});
