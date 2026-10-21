import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
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
  stagingSlicesDir,
  parseLedgerBody,
  resolveLedgerState,
  type ClassificationRecord,
  type AdjudicationRecord,
  atomicWriteFile,
} from './verify-run.js';
import {
  verifyClassifyPairsCommand,
  verifyClassifyRecordCommand,
  verifyClassifyStatusCommand,
  type ChunkVerdict,
} from './verify-classify.js';
import { verifyRepairGateCommand, verifyRepairRoundCommand, verifyRepairStatusCommand } from './verify-repair.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

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

  it('says no slices are attributed, not that the chunk is not stale, when Attributed slices is empty (#998)', () => {
    const record = baseRecord({ marker: RULES_STALE_MARKER, attributedSlices: [] });
    const body = renderRulesStaleness(record);
    expect(body).toContain('_No slices attributed._');
    expect(body).not.toContain(RULES_STALENESS_EMPTY);
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

  it('round-trips a real rendered section: state rules-stale, with no attributed slices (#998)', () => {
    const record = baseRecord({ marker: RULES_STALE_MARKER, attributedSlices: [] });
    const text = `# Chunk: test\n\nStatus: verified\n\n${renderRulesStalenessSection(record)}`;
    const parsed = parseRulesStaleness(text);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.attributedSlices).toEqual([]);
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
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(codeLines.join('\n')).not.toContain('indexOf(RULES_STALENESS_HEADING)');
  });

  it('the module ships its own distinct fence pair, never reusing VERIFIED_AGAINST_BEGIN in code', async () => {
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(source).toContain('boardsmith:rules-staleness:begin');
    expect(codeLines.join('\n')).not.toContain('VERIFIED_AGAINST_BEGIN');
  });

  it('never calls fs.writeFile directly (atomicWriteFile is the one write path)', async () => {
    const source = readFileSync(fileURLToPath(new URL('./verify-impact.ts', import.meta.url)), 'utf-8');
    const codeLines = source.split('\n').filter((line) => !/^\s*[*/]/.test(line));
    expect(codeLines.join('\n')).not.toContain('fs.writeFile(');
  });

  it("writeRulesStalenessMarker's own body never mentions RULES_STALENESS_CLEAR or the word clear", async () => {
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

// The mock above is FILE-wide, but only the write-order describe used to put its
// throwing override back. Any test that ran after it in a different describe
// inherited "simulated SKETCH.md write failure" — invisible in declaration order,
// a failure under --sequence.shuffle. Restoring here covers every block, and
// `vi.clearAllMocks()` is not enough: it clears call records, not implementations.
afterEach(async () => {
  const actual = await vi.importActual<typeof import('./verify-run.js')>('./verify-run.js');
  vi.mocked(atomicWriteFile).mockImplementation(actual.atomicWriteFile);
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
    dir = tempTree('bs-verify-impact-');
    await fs.mkdir(join(dir, DESIGN_DIR, 'chunks', SLUG), { recursive: true });
    await fs.writeFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), fixtureChunkText());
    await fs.writeFile(join(dir, DESIGN_DIR, 'SKETCH.md'), fixtureSketchText());

    // Reset the mocked atomicWriteFile back to a plain call-through before every test, so a
    // prior test's mockImplementation override (the simulated SKETCH.md write failure) never
    // leaks into the next test.
    const actualModule = await vi.importActual<typeof import('./verify-run.js')>('./verify-run.js');
    vi.mocked(atomicWriteFile).mockImplementation(actualModule.atomicWriteFile);
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('marker — inserts the section immediately after "## Verified Against" when absent', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    expect(chunkText).toContain(RULES_STALENESS_HEADING);
    const vaIdx = chunkText.indexOf(VERIFIED_AGAINST_HEADING);
    const rsIdx = chunkText.indexOf(RULES_STALENESS_HEADING);
    expect(rsIdx).toBeGreaterThan(vaIdx);
  });

  it('marker — writes the marker as RULES_STALE_MARKER only, never RULES_STALENESS_CLEAR', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.marker).toBe(RULES_STALE_MARKER);
  });

  it('write-order — the written CHUNK.md fenced body\'s LAST non-empty line starts with Marker:', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkText = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const beginIdx = chunkText.indexOf(RULES_STALENESS_BEGIN);
    const endIdx = chunkText.indexOf(RULES_STALENESS_END);
    const body = chunkText.slice(beginIdx + RULES_STALENESS_BEGIN.length, endIdx).trim();
    const lastLine = body.split('\n').filter(Boolean).pop();
    expect(lastLine?.startsWith('Marker:')).toBe(true);
  });

  it('write-order — inserts the SKETCH.md derived pointer immediately after the Status line', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const sketchText = await fs.readFile(join(dir, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
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
    const sketchText = await fs.readFile(join(dir, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
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

    const chunkText = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
  });

  it('marker — SKETCH.md is repaired to match CHUNK.md when its pointer disagrees; CHUNK.md bytes are unchanged', async () => {
    await writeRulesStalenessMarker(dir, fixtureRecord());
    const chunkAfterFirst = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');

    // Seed SKETCH.md's derived pointer with the WRONG value.
    let sketchText = await fs.readFile(join(dir, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
    sketchText = sketchText.replace(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALE_MARKER}`,
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALENESS_CLEAR}`,
    );
    await fs.writeFile(join(dir, DESIGN_DIR, 'SKETCH.md'), sketchText);

    const result = await writeRulesStalenessMarker(dir, fixtureRecord());
    expect(result.sketchRepaired).toBe(true);
    expect(result.chunkWritten).toBe(false);

    const chunkAfterSecond = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), 'utf-8');
    expect(chunkAfterSecond).toBe(chunkAfterFirst);

    const repairedSketch = await fs.readFile(join(dir, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
    expect(repairedSketch).toContain(
      `- Rules Staleness (derived from chunks/${SLUG}/CHUNK.md): ${RULES_STALE_MARKER}`,
    );
  });

  it('marker — a CHUNK.md missing RULES_STALENESS_END rejects, names both sentinels, and leaves the file untouched', async () => {
    const brokenText =
      fixtureChunkText() +
      `\n${RULES_STALENESS_HEADING}\n\n${RULES_STALENESS_BEGIN}\nbroken, no end fence\n`;
    await fs.writeFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'), brokenText);
    const before = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'));
    const beforeHash = createHash('sha256').update(before).digest('hex');

    await expect(writeRulesStalenessMarker(dir, fixtureRecord())).rejects.toThrow(
      /boardsmith:rules-staleness:begin[\s\S]*boardsmith:rules-staleness:end/,
    );

    const after = await fs.readFile(join(dir, DESIGN_DIR, 'chunks', SLUG, 'CHUNK.md'));
    const afterHash = createHash('sha256').update(after).digest('hex');
    expect(afterHash).toBe(beforeHash);
  });

  it('marker — a sketch-level tail entry (no chunks/<slug>/ directory reflected in SKETCH.md) is skipped, never written', async () => {
    const tailSketch =
      `# Sketch: Test Game\n\nSketch Version: 1\n\nSession Lock: none\n\n## Ordered Chunk List\n\n` +
      `## Mandated Chunks\n`;
    await fs.writeFile(join(dir, DESIGN_DIR, 'SKETCH.md'), tailSketch);

    const result = await writeRulesStalenessMarker(dir, fixtureRecord());
    expect(result.sketchWritten).toBe(false);
    expect(result.sketchRepaired).toBe(false);

    const sketchAfter = await fs.readFile(join(dir, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
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

/** Everything a run printed to stdout through console.log, joined as the terminal would see it. */
async function captureStdout(run: () => Promise<unknown>): Promise<string> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await run();
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    logSpy.mockRestore();
  }
}

async function singleContradictoryPairProject(
  projectRoot: string,
): Promise<{ project: string; runId: string; pairId: string }> {
  const project = join(projectRoot, 'gate-project');
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
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
    gateDir = tempTree('bs-verify-impact-gate-');
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

  it('--json: stdout is exactly one parseable JSON object, with no inner report printed ahead of it (#832)', async () => {
    const { project, runId, pairId } = await singleContradictoryPairProject(gateDir);

    const stdout = await captureStdout(() => verifyImpactGateCommand({ project, runId, json: true }));

    expect(JSON.parse(stdout).pending).toContain(pairId);
  });

  it('contradictory: verifyImpactGateCommand is read-only — a whole-project sha256 map is byte-identical before and after', async () => {
    const { project, runId } = await singleContradictoryPairProject(gateDir);
    const before = await sha256OfDir(project);

    await verifyImpactGateCommand({ project, runId, json: true });

    const after = await sha256OfDir(project);
    expect(after).toEqual(before);
  });

  it('no-bypass: verifyImpactGateCommand has exactly project/runId/json options — no force/skip/yes/assumeResolved/bypass/autoAdjudicate anywhere in this module', async () => {
    const moduleSource = await fs.readFile(
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
 * How many entries `rulingsCorpus()` builds. Every expectation below is DERIVED from this — never
 * a second hardcoded literal — so changing the corpus size cannot leave a stale expectation
 * behind.
 */
const CORPUS_ENTRY_COUNT = 26;

/**
 * A self-contained corpus mirroring a real shipped `RULINGS.md` shape exactly (three fields, no
 * supersede verb). Built here rather than read from a sibling game repo: a test that reaches into
 * `~/BoardSmithGames/...` depends on content this repo does not own and cannot hold still — the
 * earlier version of these tests read `one-two-punch`'s live file and went red the moment that
 * game recorded its 27th ruling, which said nothing about this repo's code.
 */
function rulingsCorpus(entryCount: number = CORPUS_ENTRY_COUNT): string {
  const header =
    '# Rulings\n\n' +
    '<!-- This is an append-only ledger of designer decisions. -->\n\n';
  const blocks: string[] = [];
  for (let i = 1; i <= entryCount; i++) {
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

/** The number `appendRuling`/`nextRulingNumber` must produce for a corpus of `entryCount`. */
const nextNumberFor = (entryCount: number = CORPUS_ENTRY_COUNT): number => entryCount + 1;

describe('contradictory — nextRulingNumber / appendRuling — over a self-contained multi-entry RULINGS.md corpus', () => {
  it('refuses a provisional ruling, which only a chunk branch holds before chunk-merge (#436)', () => {
    expect(() => nextRulingNumber('### Ruling 4\n- Decision: a\n### Ruling @demo.1\n- Decision: b\n')).toThrow(
      /Ruling @demo\.1 is a provisional id.*chunk-merge/s,
    );
  });

  let dir: string;

  beforeEach(async () => {
    dir = tempTree('bs-verify-impact-rulings-');
    await fs.mkdir(join(dir, DESIGN_DIR), { recursive: true });
  });

  it('keeps every ruling, each with its own number, when several appendRuling calls run in parallel (#999)', async () => {
    await fs.writeFile(join(dir, DESIGN_DIR, 'RULINGS.md'), rulingsCorpus());
    const decisions = ['one', 'two', 'three', 'four', 'five'];

    const appended = await Promise.all(
      decisions.map((d) => appendRuling(dir, { decision: `Decision ${d}.`, citation: 'rulebook/a.md, p.1', rationale: 'Parallel.' })),
    );

    const text = await fs.readFile(join(dir, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    for (const d of decisions) expect(text).toContain(`Decision ${d}.`);
    expect(new Set(appended.map((a) => a.number)).size).toBe(decisions.length);
  });

  it('contradictory: nextRulingNumber returns one past the corpus\'s last entry', async () => {
    const text = rulingsCorpus();
    expect(nextRulingNumber(text)).toBe(nextNumberFor());
  });

  it('contradictory: renderRuling emits exactly the three real field labels, never a supersession field', () => {
    // A pure renderer test: it builds no corpus, so its number is its own input echoed back —
    // deliberately a plain literal on both sides, not `nextNumberFor()`.
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
    const text = rulingsCorpus();
    await fs.writeFile(join(dir, DESIGN_DIR, 'RULINGS.md'), text);

    const result = await appendRuling(dir, {
      decision: 'A test decision.',
      citation: 'rulebook/test.md, p.1 — "test citation".',
      rationale: 'A test rationale.',
    });
    expect(result.number).toBe(nextNumberFor());

    const newText = await fs.readFile(join(dir, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    expect(newText.startsWith(text)).toBe(true);
  });

  it('contradictory: the appended block matches the corpus\'s own three-field ### Ruling N shape', async () => {
    const text = rulingsCorpus();
    await fs.writeFile(join(dir, DESIGN_DIR, 'RULINGS.md'), text);

    await appendRuling(dir, {
      decision: 'A test decision.',
      citation: 'rulebook/test.md, p.1 — "test citation".',
      rationale: 'A test rationale.',
    });

    const newText = await fs.readFile(join(dir, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    expect(newText).toMatch(
      new RegExp(`^### Ruling ${nextNumberFor()}\\n- Decision: .+\\n- Citation interpreted or overridden: .+\\n- Rationale: .+$`, 'm'),
    );
  });

  it('contradictory: the appended entry contains both real quotedPass1 and quotedPass2 verbatim, and does NOT match /supersede[sd]?/i', async () => {
    const text = rulingsCorpus();
    await fs.writeFile(join(dir, DESIGN_DIR, 'RULINGS.md'), text);
    const record = await readRealContradictoryClassification();

    await appendRuling(dir, {
      decision: 'The higher-timing reading applies going forward.',
      citation: `Reading as built: "${record.quotedPass1}" — Reading in the fresh transcription: "${record.quotedPass2}"`,
      rationale: 'Designer confirmed at the adjudication gate.',
    });

    const newText = await fs.readFile(join(dir, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    const appendedBlock = newText.slice(newText.indexOf(`### Ruling ${nextNumberFor()}`));
    expect(appendedBlock).toContain(record.quotedPass1);
    expect(appendedBlock).toContain(record.quotedPass2);
    expect(appendedBlock).not.toMatch(/supersede[sd]?/i);
  });

  it('appendRuling reuses an identical ruling on file, but never one a later ruling superseded (#839)', async () => {
    const entry = { decision: 'Ties go to the dealer.', citation: 'rulebook/a.md, p.1', rationale: 'Asked.' };
    await fs.writeFile(join(dir, DESIGN_DIR, 'RULINGS.md'), `# Rulings\n\n${renderRuling({ number: 1, ...entry })}`);
    expect((await appendRuling(dir, entry)).number).toBe(1);

    await fs.writeFile(
      join(dir, DESIGN_DIR, 'RULINGS.md'),
      `# Rulings\n\n${renderRuling({ number: 1, ...entry })}\n` +
        renderRuling({ number: 2, decision: 'This supersedes Ruling 1.', citation: 'rulebook/a.md, p.1', rationale: 'Changed.' }),
    );
    expect((await appendRuling(dir, entry)).number).toBe(3);
  });

  it('appendRuling throws an actionable error when RULINGS.md does not exist, and never creates one', async () => {
    await expect(
      appendRuling(dir, { decision: 'x', citation: 'y', rationale: 'z' }),
    ).rejects.toThrow(/No design\/RULINGS\.md found/);
    await expect(fs.access(join(dir, DESIGN_DIR, 'RULINGS.md'))).rejects.toThrow();
  });

  it('appendRuling gives the same actionable error when --project has no design directory at all (#999)', async () => {
    const elsewhere = tempTree('bs-verify-impact-no-design-');
    await expect(
      appendRuling(elsewhere, { decision: 'x', citation: 'y', rationale: 'z' }),
    ).rejects.toThrow(/No design\/RULINGS\.md found/);
  });
});

/** Every JSON record in a run's RUN.md ledger, in order. */
async function runLedgerRecords(project: string, runId: string): Promise<Array<Record<string, unknown>>> {
  const ledgerText = await fs.readFile(join(project, DESIGN_DIR, 'rulebook', '.verify', runId, 'RUN.md'), 'utf-8');
  return parseLedgerBody(ledgerText, 'RUN.md').lines.map((line) => line.record as unknown as Record<string, unknown>);
}

describe('unadjudicated — verifyImpactAdjudicateCommand: resolved requires human prose, UNADJUDICATED writes no ruling, idempotent per pair', () => {
  let adjDir: string;

  beforeEach(async () => {
    adjDir = tempTree('bs-verify-impact-adjudicate-');
  });

  async function contradictoryProjectWithRulings(): Promise<{
    project: string;
    runId: string;
    pairId: string;
  }> {
    const { project, runId, pairId } = await singleContradictoryPairProject(adjDir);
    const text = rulingsCorpus();
    await fs.writeFile(join(project, DESIGN_DIR, 'RULINGS.md'), text);
    return { project, runId, pairId };
  }

  it('keeps every record when an adjudication and classify record calls run in parallel (#999)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const evidence = ['one', 'two', 'three', 'four', 'five'];

    // Quoted, so each re-classification stays "contradictory" and the adjudication may land in any order (#1172).
    await Promise.all([
      verifyImpactAdjudicateCommand({ project, runId, pairId, outcome: 'UNADJUDICATED', json: true }),
      ...evidence.map((e) =>
        verifyClassifyRecordCommand({
          project, runId, pairId, label: 'contradictory', evidence: e, quotedPass1: 'Lower.', quotedPass2: 'Higher.', json: true,
        }),
      ),
    ]);

    const records = await runLedgerRecords(project, runId);
    expect(records.filter((r) => r.kind === 'adjudication').map((r) => r.outcome)).toEqual(['UNADJUDICATED']);
    expect(records.map((r) => String(r.evidence).split(' | ')[0])).toEqual(expect.arrayContaining(evidence));
  });

  it('writes one RULINGS.md entry when two resolved adjudications of the same pair run in parallel (#1164)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const resolve = (decision: string) =>
      verifyImpactAdjudicateCommand({
        project, runId, pairId, outcome: 'resolved', decision, citation: 'rulebook/a.md, p.1', rationale: 'Parallel.', json: true,
      });

    const [first, second] = await Promise.all([resolve('Decision one.'), resolve('Decision two.')]);

    expect(second.rulingNumber).toBe(first.rulingNumber);
    const rulingsText = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    expect(rulingsText.match(new RegExp(`^### Ruling ${nextNumberFor()}$`, 'gm'))).toHaveLength(1);
    expect(rulingsText.match(/^### Ruling /gm)).toHaveLength(rulingsCorpus().match(/^### Ruling /gm)!.length + 1);
    // Each call records its adjudication line (last write wins per pair), both naming the one ruling.
    const adjudications = (await runLedgerRecords(project, runId)).filter((r) => r.kind === 'adjudication');
    expect(adjudications.map((r) => r.rulingNumber)).toEqual([first.rulingNumber, first.rulingNumber]);
  });

  it('refuses, writing no ruling, when the pair is re-classified while adjudicate waits for the ledger lock (#1164)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const rulingsBefore = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    const realOpen = fs.open.bind(fs);
    let reclassified = false;
    // Lands the re-classification just before adjudicate's first try at the RUN.md lock.
    const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (!reclassified && String(args[0]).endsWith('RUN.md.lock')) {
        reclassified = true;
        await verifyClassifyRecordCommand({ project, runId, pairId, label: 'sharper', evidence: 'reread', json: true });
      }
      return realOpen(...args);
    });
    try {
      await expect(
        verifyImpactAdjudicateCommand({
          project, runId, pairId, outcome: 'resolved', decision: 'Too late.', citation: 'rulebook/a.md, p.1', rationale: 'Raced.', json: true,
        }),
      ).rejects.toThrow(/has no recorded "contradictory" classification/);
    } finally {
      openSpy.mockRestore();
    }
    expect(reclassified).toBe(true);
    expect(await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8')).toBe(rulingsBefore);
    expect((await runLedgerRecords(project, runId)).filter((r) => r.kind === 'adjudication')).toEqual([]);
  });

  it('refuses a run that does not exist with its own message, not a bare ENOENT on the lock (#1164)', async () => {
    const { project, pairId } = await contradictoryProjectWithRulings();
    // A well-formed id, so the run lookup (not the id format check) is what refuses it.
    const runId = '2099-01-01T00-00-00Z';
    const attempt = verifyImpactAdjudicateCommand({ project, runId, pairId, outcome: 'UNADJUDICATED', json: true });
    await expect(attempt).rejects.toThrow(runId);
    await expect(attempt).rejects.not.toThrow(/Invalid --run-id/);
    await expect(attempt).rejects.not.toThrow(/ENOENT/);
  });

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

  it('--json: stdout is exactly one parseable JSON object, with no inner report printed ahead of it (#832)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();

    const stdout = await captureStdout(() =>
      verifyImpactAdjudicateCommand({ project, runId, pairId, outcome: 'UNADJUDICATED', json: true }),
    );

    expect(JSON.parse(stdout).outcome).toBe('UNADJUDICATED');
  });

  it('unadjudicated: outcome "UNADJUDICATED" writes NO RULINGS.md entry (sha256 unchanged) and records an AdjudicationRecord with that outcome', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const before = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'));
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

    const after = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'));
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
    expect(result.rulingNumber).toBe(nextNumberFor());

    const rulingsText = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    expect(rulingsText).toContain(`### Ruling ${nextNumberFor()}`);

    const gateResult = await verifyImpactGateCommand({ project, runId, json: true });
    const entry = gateResult.contradictions.find((c) => c.pairId === pairId);
    expect(entry?.adjudication).toBe('resolved');
    expect(gateResult.pending).not.toContain(pairId);
  });

  it('a retry after a crash between the RULINGS.md write and the ledger write appends no second ruling (#839)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    const ledgerPath = join(project, DESIGN_DIR, 'rulebook', '.verify', runId, 'RUN.md');
    const ledgerBefore = await fs.readFile(ledgerPath, 'utf-8');
    const resolution = {
      project,
      runId,
      pairId,
      outcome: 'resolved' as const,
      decision: 'The higher-timing reading applies.',
      citation: 'rulebook/a.md, p.1',
      rationale: 'Designer confirmed.',
      json: true,
    };

    const first = await verifyImpactAdjudicateCommand(resolution);
    // The crash: the ruling is written but the ledger record never was.
    await fs.writeFile(ledgerPath, ledgerBefore);
    const retry = await verifyImpactAdjudicateCommand(resolution);

    expect(retry.rulingNumber).toBe(first.rulingNumber);
    const rulingsText = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    expect(rulingsText.match(/^### Ruling \d+$/gm)).toHaveLength(nextNumberFor());
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

    const rulingsText = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');
    const occurrences = rulingsText.match(new RegExp(`^### Ruling ${nextNumberFor()}$`, 'gm')) ?? [];
    expect(occurrences).toHaveLength(1);

    // A second ledger line IS appended (last-write-wins per pairId), even though RULINGS.md
    // gains no second entry.
    const ledgerText = await fs.readFile(
      join(project, DESIGN_DIR, 'rulebook', '.verify', runId, 'RUN.md'),
      'utf-8',
    );
    const { lines } = parseLedgerBody(ledgerText, 'RUN.md');
    const adjudicationLines = lines.filter(
      (l) => l.type === 'adjudication' && l.record.pairId === pairId,
    );
    expect(adjudicationLines.length).toBe(2);
  });

  it('asks for the pair to be classified again when its staged slices changed after it was classified (#837)', async () => {
    const { project, runId, pairId } = await contradictoryProjectWithRulings();
    await fs.writeFile(join(stagingSlicesDir(project, runId), 'ua2.md'), 'p.1, A:\n"A later staged line."\n');
    await verifyRunRecordCommand({ project, runId, unit: 'ua2', slice: 'ua2.md', json: true });

    await expect(
      verifyImpactAdjudicateCommand({ project, runId, pairId, outcome: 'UNADJUDICATED', json: true }),
    ).rejects.toThrow(/out of date.*verify-classify-record/s);
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
    });
  });

  it('no-code-change: verified + stale + clean -> close-without-replaytest, nextStatus verified', () => {
    const gate = computeRepairGate({ status: 'verified', stale: true, driftState: 'clean' });
    expect(gate).toMatchObject({
      disposition: 'close-without-replaytest',
      nextStatus: 'verified',
      clearMarker: true,
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

  // Phase 176 Plan 02 (Pitfall 1 / Assumption A3) — `computeRepairGate` must be safe to invoke a
  // SECOND time post-repair (`verify-repair-gate` asks for it again after repair). This proves
  // the assumption RESEARCH.md flagged as unverified: two calls with identical input are deeply
  // equal, and the function performs no I/O (it takes no path/handle and awaits nothing).
  it('idempotence (176-02 Pitfall 1 / Assumption A3): two computeRepairGate calls with equal input are deeply equal, and the function is synchronous (no I/O)', () => {
    const input = { status: 'verified', stale: true, driftState: 'clean' as const };
    const first = computeRepairGate(input);
    const second = computeRepairGate(input);
    expect(second).toEqual(first);
    expect(computeRepairGate.constructor.name).not.toBe('AsyncFunction');
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
  opts: { ruleDelta?: 'sharper' | 'contradictory'; drift?: 'clean' | 'drifted'; leaveXUnclassified?: boolean } = {},
): Promise<{ project: string; runId: string; pairId: string; firstSha: string }> {
  const project = join(root, `impact-project-${Math.random().toString(36).slice(2)}`);
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
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

  const movementChunkDir = join(project, DESIGN_DIR, 'chunks', 'movement');
  await fs.mkdir(movementChunkDir, { recursive: true });
  await fs.writeFile(
    join(movementChunkDir, 'CHUNK.md'),
    `# Chunk: movement\n\n` +
      `Status: verified\n` +
      `<!-- Valid values (exact, case-sensitive): proposed | approved | built | verified | verified (user-waived) | stale — re-derive before build -->\n\n` +
      `Cites rulebook/x.md.\n\n` +
      `## Interpretation\n1. **Movement resolves by timing.** "${IMPACT_QUOTED_PASS1}" (p.1)\n\n` +
      `## Verified Against\n\n${VERIFIED_AGAINST_BEGIN}\n_Not yet recorded._\n${VERIFIED_AGAINST_END}\n\n` +
      `## Findings Ledger\n\n` +
      `## Build Manifest\n\n| File | Status |\n|---|---|\n| src/movement.ts | NEW |\n\n` +
      `## Verified Commit Hash\n\n${firstSha}\n`,
  );

  const scoringChunkDir = join(project, DESIGN_DIR, 'chunks', 'scoring');
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
    join(project, DESIGN_DIR, 'SKETCH.md'),
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

  if (!opts.leaveXUnclassified) {
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: xPair.pairId,
      label: opts.ruleDelta ?? 'sharper',
      quotedPass1: IMPACT_QUOTED_PASS1,
      quotedPass2: changedLine,
      json: true,
    });
  }
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
    root = tempTree('bs-verify-impact-status-');
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

  /** The `movement` chunk's classify verdict and its impact-map entry, from one project. */
  async function movementVerdictAndEntry() {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const classifyStatus = await verifyClassifyStatusCommand({ project, runId, json: true });
    const result = await verifyImpactStatusCommand({ project, runId, json: true });
    return {
      sourceVerdict: classifyStatus.chunkVerdicts.find((v) => v.slug === 'movement')!,
      entry: result.entries.find((e) => e.slug === 'movement')!,
    };
  }

  it('line-level-handoff: ImpactMapEntry.attributions deep-equals the source ChunkVerdict.attributions verbatim', async () => {
    const { sourceVerdict, entry } = await movementVerdictAndEntry();
    expect(entry.attributions).toEqual(sourceVerdict.attributions);
    expect(entry.attributions.some((a) => a.attributed && a.rung === 'quoted-fragment')).toBe(true);
  });

  it('line-level-handoff: ImpactMapEntry.pairIds deep-equals the source ChunkVerdict.pairIds verbatim (176-06-discovered bug fix — the field was previously dropped, making verify-repair.ts\'s resolveStagedSlicePaths throw "entry.pairIds is not iterable" on any real stale entry)', async () => {
    const { sourceVerdict, entry } = await movementVerdictAndEntry();
    expect(Array.isArray(entry.pairIds)).toBe(true);
    expect(entry.pairIds).toEqual(sourceVerdict.pairIds);
    expect(entry.pairIds.length).toBeGreaterThan(0);
  });

  it('quiet:true suppresses ALL of this command\'s own console output, regardless of json (176-06-discovered bug fix — a composing caller\'s own --json stdout was previously contaminated by this command\'s human report)', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await verifyImpactStatusCommand({ project, runId, json: false, quiet: true });

    expect(logSpy).not.toHaveBeenCalled();
    expect(result.entries.length).toBeGreaterThan(0);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('end-to-end through verifyRepairStatusCommand: a real stale ImpactMapEntry resolves staged slice paths without throwing (176-06-discovered regression — previously threw "entry.pairIds is not iterable" on every real stale chunk), and --json-style output is clean JSON with no human-report contamination', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await verifyRepairStatusCommand({ project, runId, json: true });

    // The one real stale chunk this fixture produces ("movement") must resolve cleanly, never
    // throw, and never report scope-limited (its staged slices genuinely exist).
    const movementRow = result.rows.find((r) => r.slug === 'movement');
    expect(movementRow).toBeDefined();
    expect(movementRow!.scopeLimited).toBe(false);
    expect(movementRow!.slicePaths!.length).toBeGreaterThan(0);

    // json:true must print EXACTLY one JSON object to stdout — no concatenated human report
    // from any internally-composed command (verifyImpactStatusCommand and everything it in turn
    // composes) ahead of it.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const printed = logSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(printed)).not.toThrow();

    logSpy.mockRestore();
  });

  it('end-to-end through verifyRepairGateCommand: re-derives the stale chunk\'s gate from post-repair code state, and --json prints exactly one JSON object', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const gate = await verifyRepairGateCommand({ project, runId, chunk: 'movement', json: true });
    expect(gate.disposition).toBe('close-without-replaytest');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(gate);

    await expect(verifyRepairGateCommand({ project, runId, chunk: 'no-such-chunk' })).rejects.toThrow(
      /no-such-chunk/,
    );
    logSpy.mockRestore();
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

describe('verify-repair-round and verify-repair-gate, keyed to their verify run (#1302)', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = tempTree('bs-verify-repair-run-');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  const movementMd = (project: string) => join(project, DESIGN_DIR, 'chunks', 'movement', 'CHUNK.md');

  /** The fixture's stale chunk, without the Findings Ledger every built chunk has. */
  async function withoutFindingsLedger(project: string): Promise<void> {
    const text = await fs.readFile(movementMd(project), 'utf-8');
    await fs.writeFile(movementMd(project), text.replace('## Findings Ledger\n\n', ''));
  }

  it("opens the run's first round under the Findings Ledger, and reports it again, writing nothing, while it is empty", async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    const first = await verifyRepairRoundCommand({ project, runId, chunk: 'movement' });
    if (first.disposition !== 'round') throw new Error('expected a round');
    expect(first.heading).toBe(`### Audit Round 1 (verify-repair run ${runId}, round 1 of 3)`);
    const written = await fs.readFile(movementMd(project), 'utf-8');
    expect(written.indexOf(first.heading)).toBeLessThan(written.indexOf('## Build Manifest'));

    const again = await verifyRepairRoundCommand({ project, runId, chunk: 'movement' });
    expect(again).toEqual({ ...first, alreadyOpen: true });
    expect(await fs.readFile(movementMd(project), 'utf-8')).toBe(written);
  });

  it('reports the same round plan as verify-repair, which reads the run the same way', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    const status = await verifyRepairStatusCommand({ project, runId });
    const round = await verifyRepairRoundCommand({ project, runId, chunk: 'movement' });
    expect(status.rows.find((r) => r.slug === 'movement')!.roundPlan).toEqual(round);
  });

  it('refuses a chunk this run did not mark stale, and one it does not cover, writing nothing', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const scoring = join(project, DESIGN_DIR, 'chunks', 'scoring', 'CHUNK.md');
    const before = await fs.readFile(scoring, 'utf-8');

    await expect(verifyRepairRoundCommand({ project, runId, chunk: 'scoring' })).rejects.toThrow(
      `Chunk "scoring" is not stale in run ${runId}`,
    );
    await expect(verifyRepairRoundCommand({ project, runId, chunk: 'no-such-chunk' })).rejects.toThrow(
      `Chunk "no-such-chunk" is not in run ${runId}'s impact map`,
    );
    expect(await fs.readFile(scoring, 'utf-8')).toBe(before);
  });

  it('refuses a stale chunk with no ## Findings Ledger, naming the file, rather than putting the round at its end', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    await withoutFindingsLedger(project);
    const before = await fs.readFile(movementMd(project), 'utf-8');

    await expect(verifyRepairRoundCommand({ project, runId, chunk: 'movement' })).rejects.toThrow(
      /chunks\/movement\/CHUNK\.md has no "## Findings Ledger" section/,
    );
    expect(await fs.readFile(movementMd(project), 'utf-8')).toBe(before);
  });

  it('verify-repair reports no round for a stale chunk with no ## Findings Ledger, warning why, as verify-repair-round would refuse it', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    await withoutFindingsLedger(project);

    const status = await verifyRepairStatusCommand({ project, runId });
    expect(status.rows.find((r) => r.slug === 'movement')).toBeUndefined();
    expect(status.warnings.join('\n')).toMatch(/chunks\/movement\/CHUNK\.md has no "## Findings Ledger" section/);
  });

  it("the gate reads the chunk's code as it is after repair, not as it was when the run was mapped", async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    expect((await verifyRepairGateCommand({ project, runId, chunk: 'movement' })).disposition).toBe('close-without-replaytest');

    await fs.writeFile(join(project, 'src', 'movement.ts'), 'export const movement = 3;\n');
    execSync('git add -A', { cwd: project, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m repair', { cwd: project, stdio: 'ignore' });

    expect((await verifyRepairGateCommand({ project, runId, chunk: 'movement' })).disposition).toBe('reopen-playtest');
  });

  it('the gate refuses a chunk this run did not mark stale', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    await expect(verifyRepairGateCommand({ project, runId, chunk: 'scoring' })).rejects.toThrow(
      `Chunk "scoring" is not stale in run ${runId}`,
    );
  });

  it('the gate prints a warning, not a tick, when it cannot say whether the code moved', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const text = await fs.readFile(movementMd(project), 'utf-8');
    await fs.writeFile(movementMd(project), text.replace(/## Verified Commit Hash\n\n\S+/, '## Verified Commit Hash\n\nnot-a-hash'));

    const gate = await verifyRepairGateCommand({ project, runId, chunk: 'movement' });
    expect(gate.disposition).toBe('unknown-drift');
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('⚠ movement: unknown-drift');
    expect(printed).not.toContain('✓');
  });
});

/**
 * Task 2 — `verifyImpactApplyCommand`. Test names carry `contradictory`, `unadjudicated`,
 * `marker`, and `no-bypass` per the plan's `-t` convention.
 */

describe('contradictory / marker — verifyImpactApplyCommand', () => {
  let root: string;

  beforeEach(async () => {
    root = tempTree('bs-verify-impact-apply-');
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

  it('keeps every record when apply and classify record calls run in parallel (#999)', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const evidence = Array.from({ length: 12 }, (_, i) => `record ${i}`);
    // One record after another, so the ledger is being written for the whole of apply's run.
    async function recordInTurn(): Promise<void> {
      for (const e of evidence) {
        // Quoted, so each re-classification stays "sharper" and apply's verdict does not depend on order (#1172).
        await verifyClassifyRecordCommand({
          project, runId, pairId, label: 'sharper', evidence: e, quotedPass1: 'Lower.', quotedPass2: 'Higher.', json: true,
        });
      }
    }

    await Promise.all([verifyImpactApplyCommand({ project, runId, json: true }), recordInTurn()]);

    const records = await runLedgerRecords(project, runId);
    expect(records.filter((r) => r.kind === 'impact').map((r) => [r.slug, r.ruleDelta])).toEqual([['movement', 'sharper']]);
    expect(records.map((r) => String(r.evidence).split(' | ')[0])).toEqual(expect.arrayContaining(evidence));
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

    const chunkText = await fs.readFile(join(project, DESIGN_DIR, 'chunks', 'movement', 'CHUNK.md'), 'utf-8');
    const parsed = parseRulesStaleness(chunkText);
    expect(parsed.state).toBe('rules-stale');
    expect(parsed.record?.adjudication).toBe('UNADJUDICATED');
  });

  it('--json: stdout is exactly one parseable JSON object, with no inner report printed ahead of it (#832)', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    const stdout = await captureStdout(() => verifyImpactApplyCommand({ project, runId, json: true }));

    expect(JSON.parse(stdout).marked.some((m: { slug: string }) => m.slug === 'movement')).toBe(true);
  });

  it('--json: a refusal for an unclassified pair is exactly one parseable JSON object too (#832, #830)', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, { drift: 'clean', leaveXUnclassified: true });

    const stdout = await captureStdout(() => verifyImpactApplyCommand({ project, runId, json: true }));

    const parsed = JSON.parse(stdout);
    expect(parsed.blocked).toBe(true);
    expect(parsed.pendingPairs).toEqual([pairId]);
  });

  it('unclassified: a pair still pending classification blocks the write entirely, naming the pair and verify-classify-record (#830)', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, { drift: 'clean', leaveXUnclassified: true });
    const before = await sha256OfProject(project);

    const result = await verifyImpactApplyCommand({ project, runId, json: true });
    expect(result.blocked).toBe(true);
    expect(result.pendingPairs).toEqual([pairId]);
    expect(result.marked).toEqual([]);
    expect(await sha256OfProject(project)).toEqual(before);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await verifyImpactApplyCommand({ project, runId });
    const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    logSpy.mockRestore();
    expect(printed).toContain(`boardsmith verify-classify-record --run-id ${runId} --pair-id ${pairId}`);
  });

  it('unclassified: resuming an interrupted classification as cosmetic leaves no stale marker (#830)', async () => {
    const { project, runId, pairId } = await buildImpactTestProject(root, { drift: 'clean', leaveXUnclassified: true });
    expect((await verifyImpactApplyCommand({ project, runId, json: true })).blocked).toBe(true);

    await verifyClassifyRecordCommand({ project, runId, pairId, label: 'cosmetic', json: true });
    const result = await verifyImpactApplyCommand({ project, runId, json: true });
    expect(result.blocked).toBe(false);
    expect(result.marked).toEqual([]);

    const chunkText = await fs.readFile(join(project, DESIGN_DIR, 'chunks', 'movement', 'CHUNK.md'), 'utf-8');
    expect(parseRulesStaleness(chunkText).state).not.toBe('rules-stale');
  });

  it('marker: a chunk whose ChunkVerdict.stale is false is left byte-identical after the run', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });
    const before = await fs.readFile(join(project, DESIGN_DIR, 'chunks', 'scoring', 'CHUNK.md'));
    const beforeHash = createHash('sha256').update(before).digest('hex');

    await verifyImpactApplyCommand({ project, runId, json: true });

    const after = await fs.readFile(join(project, DESIGN_DIR, 'chunks', 'scoring', 'CHUNK.md'));
    const afterHash = createHash('sha256').update(after).digest('hex');
    expect(afterHash).toBe(beforeHash);
  });

  it('marker: running verifyImpactApplyCommand twice leaves exactly one "## Rules Staleness" heading and one begin sentinel', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    await verifyImpactApplyCommand({ project, runId, json: true });
    await verifyImpactApplyCommand({ project, runId, json: true });

    const chunkText = await fs.readFile(join(project, DESIGN_DIR, 'chunks', 'movement', 'CHUNK.md'), 'utf-8');
    const headingOccurrences = chunkText.match(/^## Rules Staleness$/gm) ?? [];
    const beginOccurrences = chunkText.match(/boardsmith:rules-staleness:begin/g) ?? [];
    expect(headingOccurrences).toHaveLength(1);
    expect(beginOccurrences).toHaveLength(1);
  });

  it('marker: one ImpactRecord is appended to the run ledger per marked chunk', async () => {
    const { project, runId } = await buildImpactTestProject(root, { ruleDelta: 'sharper', drift: 'clean' });

    await verifyImpactApplyCommand({ project, runId, json: true });

    const ledgerText = await fs.readFile(join(project, DESIGN_DIR, 'rulebook', '.verify', runId, 'RUN.md'), 'utf-8');
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
  it('registers all four verify-impact-* commands, chunk-check takes no --reverified-no-code-change (#827), and no command declares a bypass option', async () => {
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
    expect(cliSource).not.toContain('--reverified-no-code-change');

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

describe('appendRuling: an unreadable RULINGS.md (#1110)', () => {
  it('names the file rather than calling it missing', async () => {
    const project = tempTree('bs-verify-impact-unreadable-');
    const rulings = join(project, DESIGN_DIR, 'RULINGS.md');
    await fs.mkdir(rulings, { recursive: true });
    await expect(appendRuling(project, { decision: 'd', citation: 'c', rationale: 'r' })).rejects.toThrow(
      `Could not read ${rulings} (EISDIR)`,
    );
  });
});
