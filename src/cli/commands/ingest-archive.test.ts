import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ingestArchiveCommand,
  renderIndex,
  INDEX_HEADINGS,
  HEADER_LABELS,
  EDITION_UNKNOWN,
  GAPS_EMPTY,
} from './ingest-archive.js';

/**
 * `ingest-archive` exists because nine successive attempts to get an ingest session to perform
 * these steps from skill-text instructions failed against live runs — it reads its skill files
 * at the start, then executes from recall. Copying a file, hashing it, and emitting four exact
 * header lines have one correct output, so they belong in code.
 *
 * These tests pin that output. The headings in particular are parsed by downstream tooling and
 * by `scripts/ingest-harness/check.mjs`; a "nicer" heading is the single most repeated failure
 * in this step's history.
 */

let dir: string;
let sourcePath: string;
const SOURCE_BYTES = Buffer.from('%PDF-1.4 fake rulebook bytes for testing\n');
const SOURCE_HASH = createHash('sha256').update(SOURCE_BYTES).digest('hex');

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-ingest-archive-'));
  sourcePath = join(dir, 'src-rules.pdf');
  await fs.writeFile(sourcePath, SOURCE_BYTES);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(opts: Parameters<typeof ingestArchiveCommand>[1] = {}) {
  const project = join(dir, 'game');
  await fs.mkdir(project, { recursive: true });
  await ingestArchiveCommand(sourcePath, { project, json: true, ...opts });
  return project;
}

describe('ingest-archive — archiving', () => {
  it('copies the source into rulebook/source/ preserving the filename', async () => {
    const project = await run();
    const archived = await fs.readFile(join(project, 'rulebook', 'source', 'src-rules.pdf'));
    expect(archived.equals(SOURCE_BYTES)).toBe(true);
  });

  it('leaves the designer original in place — copy, never move', async () => {
    await run();
    const original = await fs.readFile(sourcePath);
    expect(original.equals(SOURCE_BYTES)).toBe(true);
  });

  it('records the archived copy hash, matching the source', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(`Source hash: ${SOURCE_HASH}`);
  });

  it('fails loudly on an unreadable path rather than writing a header for a missing archive', async () => {
    const project = join(dir, 'game2');
    await fs.mkdir(project, { recursive: true });
    await expect(
      ingestArchiveCommand(join(dir, 'nope.pdf'), { project, json: true }),
    ).rejects.toThrow(/not found or unreadable/);
    // Critically: no INDEX.md claiming provenance for a file that was never archived.
    await expect(fs.access(join(project, 'rulebook', 'INDEX.md'))).rejects.toThrow();
  });

  it('refuses to clobber a different archived rulebook', async () => {
    const project = await run();
    await fs.writeFile(join(project, 'rulebook', 'source', 'src-rules.pdf'), 'different bytes');
    await expect(ingestArchiveCommand(sourcePath, { project, json: true })).rejects.toThrow(
      /already exists .* and differs/,
    );
  });

  it('is idempotent when the archived copy is byte-identical', async () => {
    const project = await run();
    await expect(
      ingestArchiveCommand(sourcePath, { project, json: true }),
    ).resolves.toBeUndefined();
  });
});

describe('ingest-archive — INDEX.md contract', () => {
  it('writes all four header labels, in order, with non-empty values', async () => {
    const project = await run({ edition: '2nd edition, 2019 printing' });
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    let cursor = -1;
    for (const label of HEADER_LABELS) {
      const at = index.indexOf(`\n${label}`);
      expect(at, `${label} must be present on its own line`).toBeGreaterThan(cursor);
      cursor = at;
      const value = index.slice(at + label.length + 1).split('\n')[0].trim();
      expect(value, `${label} must have a value`).not.toBe('');
    }
    expect(index).toContain('Edition: 2nd edition, 2019 printing');
  });

  it('writes the explicit not-stated token rather than a blank edition', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(`Edition: ${EDITION_UNKNOWN}`);
  });

  it('never emits the interview-path wording on the rulebook path', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).not.toContain('unpublished — designer statement');
  });

  it('writes the three exact headings downstream tooling parses', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    for (const heading of INDEX_HEADINGS) {
      expect(index, `must contain exactly "${heading}"`).toContain(`\n${heading}\n`);
    }
  });

  it('always emits the gaps section, with the empty token when unfilled', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(GAPS_EMPTY);
  });

  it('instructs against deduplicating gap entries', async () => {
    // The reconciliation check compares section entries to slice markers; dedup would make
    // a working transport look like a dropping one.
    const rendered = renderIndex({
      gameName: 'X',
      edition: undefined,
      archivedPath: 'rulebook/source/x.pdf',
      sourceHash: 'a'.repeat(64),
      transcribed: '2026-07-27',
    });
    expect(rendered).toMatch(/Do NOT deduplicate/i);
  });

  it('refreshes only the provenance header when INDEX.md already has filled sections', async () => {
    const project = await run();
    const indexPath = join(project, 'rulebook', 'INDEX.md');
    const filled = (await fs.readFile(indexPath, 'utf-8')).replace(
      GAPS_EMPTY,
      'Named-but-undefined (p.1): Ways to Score',
    );
    await fs.writeFile(indexPath, filled);

    await ingestArchiveCommand(sourcePath, { project, json: true, edition: 'later edition' });

    const after = await fs.readFile(indexPath, 'utf-8');
    expect(after).toContain('Named-but-undefined (p.1): Ways to Score');
    expect(after).toContain('Edition: later edition');
    expect(after).toContain(`Source hash: ${SOURCE_HASH}`);
  });
});
