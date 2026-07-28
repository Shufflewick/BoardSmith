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

describe('init --rulebook — the archive rides on a command that is never skipped', () => {
  it('initCommand accepts a rulebook path and archives it', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-rulebook-'));
    const cwd = process.cwd();
    try {
      process.chdir(parent);
      const { initCommand } = await import('./init.js');
      await initCommand('archived-game', { rulebook: sourcePath });

      const archived = await fs.readFile(
        join(parent, 'archived-game', 'rulebook', 'source', 'src-rules.pdf'),
      );
      expect(archived.equals(SOURCE_BYTES)).toBe(true);

      const index = await fs.readFile(
        join(parent, 'archived-game', 'rulebook', 'INDEX.md'),
        'utf-8',
      );
      expect(index).toContain(`Source hash: ${SOURCE_HASH}`);
      expect(index).toContain('## Open Rules Gaps');
    } finally {
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 120_000);

  it('scaffolds normally when no rulebook is passed', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-norulebook-'));
    const cwd = process.cwd();
    try {
      process.chdir(parent);
      const { initCommand } = await import('./init.js');
      await initCommand('plain-game', { withoutRulebook: true });
      // No rulebook path means no archive and no INDEX.md — the interview path writes those.
      await expect(
        fs.access(join(parent, 'plain-game', 'rulebook', 'INDEX.md')),
      ).rejects.toThrow();
      await expect(fs.access(join(parent, 'plain-game', 'package.json'))).resolves.toBeUndefined();
    } finally {
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('init — an explicit rulebook decision is required', () => {
  // Twelfth mechanism. The eleventh documented --rulebook on the init line in scaffold.md and a
  // live session still ran the bare `npx boardsmith init seven`, reproducing the command from
  // its prior rather than from the file it had just read. An omitted decision is now a hard
  // failure, because failing commands are the one signal these sessions reliably act on.
  it('exits non-zero with an actionable message when neither flag is given', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-required-'));
    const cwd = process.cwd();
    const errors: string[] = [];
    const origError = console.error;
    const origExit = process.exit;
    try {
      process.chdir(parent);
      console.error = (msg?: unknown) => void errors.push(String(msg));
      // @ts-expect-error — test double for a non-returning function
      process.exit = (code?: number) => {
        throw new Error(`EXIT:${code}`);
      };
      const { initCommand } = await import('./init.js');
      await expect(initCommand('undeclared')).rejects.toThrow('EXIT:1');

      const combined = errors.join('\n');
      // The message must name both options and show a usable example — a bare "invalid
      // arguments" would leave a session guessing, which is how this failed for eleven rounds.
      expect(combined).toMatch(/--rulebook <path>/);
      expect(combined).toMatch(/--without-rulebook/);
      expect(combined).toMatch(/npx boardsmith init undeclared --rulebook/);

      // And it must not have scaffolded a half-project before refusing.
      await expect(fs.access(join(parent, 'undeclared'))).rejects.toThrow();
    } finally {
      console.error = origError;
      process.exit = origExit;
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 60_000);
});
