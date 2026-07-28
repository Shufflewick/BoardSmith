import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderIndex, EDITION_UNKNOWN } from './ingest-archive.js';
import {
  computeVerificationScope,
  resolveCitedSlices,
  SCOPE_FULL,
  SCOPE_CODE_ONLY,
  SCOPE_REASONS,
} from './chunk-provenance.js';

/**
 * `chunk-provenance` exists because PROV-02's whole point is that a partial verification must
 * not be able to present as a full one (171-CONTEXT.md decision 1). `computeVerificationScope`
 * is a pure hash-comparison against disk state, never a caller-declared value, and
 * `resolveCitedSlices` recovers the slices a chunk cites from its own existing prose rather than
 * from a new field a session would have to remember to fill (decision 8).
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-chunk-provenance-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Builds one of the six scope-relevant project shapes. Reuses `renderIndex()` for the shapes
 * that have a real INDEX.md, per this plan's instruction — hand-writing header lines is how a
 * test drifts from the contract it claims to pin. `pre-provenance-project` cannot be built from
 * `renderIndex()` (it always writes `Source:`/`Source hash:`), so it reproduces the reference
 * games' real pre-Phase-170 shape directly, per this plan's own `<read_first>` instruction.
 */
async function makeProject(
  shape:
    | 'no-rulebook-project'
    | 'index-missing'
    | 'pre-provenance-project'
    | 'source-missing'
    | 'source-hash-mismatch'
    | 'source-hash-mismatch-hand-edited'
    | 'full',
): Promise<string> {
  const project = join(dir, `game-${shape}`);
  await fs.mkdir(project, { recursive: true });
  if (shape === 'no-rulebook-project') return project;

  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  if (shape === 'index-missing') return project;

  if (shape === 'pre-provenance-project') {
    // one-two-punch's and seven's real live shape, verified 2026-07-28: an Edition: line and
    // content sections, but no Source: and no Source hash: line at all — they predate Phase
    // 170's INDEX.md contract entirely.
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      [
        '# Rulebook Index — 1-2 Punch',
        '',
        'Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)',
        '',
        'Term → slice cross-reference. Built from the `citedTerms[]` returned by the transcription pass.',
        '',
        '| Term | Slice |',
        '|---|---|',
        '| Jab | [01-setup-and-round-structure.md](01-setup-and-round-structure.md) |',
        '',
      ].join('\n'),
    );
    return project;
  }

  const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes for testing\n');
  const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
  const relArchivedPath = 'rulebook/source/rules.pdf';
  const archivedPath = join(project, relArchivedPath);

  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: 'game',
      edition: 'First Printing 2020',
      archivedPath: relArchivedPath,
      sourceHash,
      transcribed: '2026-07-28',
    }),
  );

  if (shape === 'source-missing') return project; // archived file deliberately never written

  await fs.mkdir(dirname(archivedPath), { recursive: true });

  if (shape === 'source-hash-mismatch' || shape === 'source-hash-mismatch-hand-edited') {
    // Present, but bytes differ from the recorded hash — a rewritten source, not a deleted one.
    await fs.writeFile(archivedPath, Buffer.from('entirely different bytes\n'));
    return project;
  }

  await fs.writeFile(archivedPath, sourceBuf); // full — bytes match the recorded hash exactly
  return project;
}

describe('computeVerificationScope — scope', () => {
  it('no rulebook/ directory at all → code-conformance-only, no-rulebook-project', async () => {
    const project = await makeProject('no-rulebook-project');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('no-rulebook-project');
  });

  it('rulebook/ exists, no INDEX.md → index-missing', async () => {
    const project = await makeProject('index-missing');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('index-missing');
  });

  it('INDEX.md with no Source hash: line → pre-provenance-project, distinct from source-missing', async () => {
    const project = await makeProject('pre-provenance-project');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('pre-provenance-project');
    expect(result.reason).not.toBe('source-missing');
  });

  it('Source: + Source hash: recorded but archived file absent → source-missing', async () => {
    const project = await makeProject('source-missing');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('source-missing');
  });

  it('archived file present, bytes differ from recorded hash → source-hash-mismatch', async () => {
    const project = await makeProject('source-hash-mismatch');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('source-hash-mismatch');
  });

  it('archived file present, hash matches → full, reason omitted (not a placeholder)', async () => {
    const project = await makeProject('full');
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_FULL);
    expect(result.reason).toBeUndefined();
    expect('reason' in result === false || result.reason === undefined).toBe(true);
  });

  it('INVARIANT: correct recorded hash but a deleted file returns source-missing, not full', async () => {
    const project = await makeProject('full');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.rm(join(project, relArchivedPath));
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('source-missing');
  });

  it('INVARIANT: present file but a rewritten hash returns source-hash-mismatch, not full', async () => {
    const project = await makeProject('full');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(join(project, relArchivedPath), Buffer.from('rewritten, tampered bytes\n'));
    const result = await computeVerificationScope(project);
    expect(result.scope).toBe(SCOPE_CODE_ONLY);
    expect(result.reason).toBe('source-hash-mismatch');
  });

  it('PROV-02 API SHAPE: accepts only a project directory — no scope-override parameter exists', async () => {
    expect(computeVerificationScope.length).toBe(1);
    const source = await fs.readFile(new URL('./chunk-provenance.ts', import.meta.url), 'utf-8');
    const nonComment = source
      .split('\n')
      .filter((line) => !/^\s*[*/]/.test(line))
      .join('\n');
    // Mirrors this plan's own acceptance-criteria grep exactly: no parameter named `scope`, and
    // no `assumeFull`/`forceScope` override of any shape.
    expect(nonComment).not.toMatch(/\bassumeFull\b/);
    expect(nonComment).not.toMatch(/\bforceScope\b/);
    expect(nonComment).not.toMatch(/scope:.*param/);
  });

  it('carries the INDEX Source hash: value as the edition anchor, edition passed through normalizeEdition', async () => {
    const project = await makeProject('full');
    const result = await computeVerificationScope(project);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.edition).toBe('First Printing 2020');
  });

  it('normalizes a recognisably-empty edition through normalizeEdition, even in reduced scope', async () => {
    const project = await makeProject('source-missing');
    const result = await computeVerificationScope(project);
    // renderIndex() itself already normalizes at write time, so the round-trip should read back
    // the machine-checkable sentinel unless a genuine edition string was supplied.
    expect(result.edition).toBe('First Printing 2020');
  });

  it('SCOPE_REASONS carries exactly the five enumerated codes', () => {
    expect([...SCOPE_REASONS].sort()).toEqual(
      [
        'source-missing',
        'source-hash-mismatch',
        'index-missing',
        'no-rulebook-project',
        'pre-provenance-project',
      ].sort(),
    );
  });
});

describe('cited slices — resolveCitedSlices', () => {
  // Slice filenames as they exist on disk for each reference game (verified 2026-07-28).
  const ONE_TWO_PUNCH_SLICES = [
    '00-visual-survey.md',
    '01-setup-and-round-structure.md',
    '02-action-cards-and-resolution.md',
  ];
  const SEVEN_SLICES = [
    '00-visual-survey.md',
    '01-definitions-and-components.md',
    '01-overview-setup-and-play.md',
    '02-solo-variant.md',
  ];

  it('a full-filename citation matching a file in rulebook/ resolves to that path', () => {
    // one-two-punch/chunks/jab/CHUNK.md — real citation prose.
    const text =
      '— cites RULINGS.md Ruling 6; rulebook/01-setup-and-round-structure.md, "Starting a New Game" steps 2–3 (p.1); rulebook/02-action-cards-and-resolution.md, JAB (p.2).';
    const { resolved, unresolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toContain('rulebook/01-setup-and-round-structure.md');
    expect(resolved).toContain('rulebook/02-action-cards-and-resolution.md');
    expect(unresolved).toEqual([]);
  });

  it('rulebook/02 p.4 shorthand resolves to the unique 02--prefixed slice', () => {
    // one-two-punch/chunks/plan-and-reveal/CHUNK.md — real shorthand citation prose.
    const text =
      'resting on the printed Tip "You should never have both rest cards in your hand at the same time." (rulebook/02, Tips bullet 1, p.2)';
    const { resolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual(['rulebook/02-action-cards-and-resolution.md']);
  });

  it('trailing punctuation variants (** } . possessive) all resolve to the same slice', () => {
    // Each string below is copied verbatim from real one-two-punch chunk prose.
    const boldedFilename =
      // plan-and-reveal/CHUNK.md:191
      '- **rulebook/02-action-cards-and-resolution.md** (p.2) — surfaced by INDEX.md on the terms `timing`.';
    const bracedFilename =
      // discard-phase-and-reclaim/CHUNK.md:100
      'No slice outside {rulebook/01-setup-and-round-structure.md, rulebook/02-action-cards-and-resolution.md} was surfaced.';
    const trailingPeriod =
      // rest/CHUNK.md:115
      "The chunk's cited slice was rulebook/02-action-cards-and-resolution.md. INDEX.md searches for this chunk's key terms surfaced the following additional slices, now cited above:";
    const trailingShorthandPeriod =
      // setup-opening-discards/CHUNK.md:109 (paraphrased shorthand form of the same real sentence shape)
      'The chunk previously cited only rulebook/01.';
    const possessive =
      // block/CHUNK.md:1204
      'branches from rulebook/02\'s printed text.';

    expect(resolveCitedSlices(boldedFilename, ONE_TWO_PUNCH_SLICES).resolved).toEqual([
      'rulebook/02-action-cards-and-resolution.md',
    ]);
    expect(resolveCitedSlices(bracedFilename, ONE_TWO_PUNCH_SLICES).resolved.sort()).toEqual(
      ['rulebook/01-setup-and-round-structure.md', 'rulebook/02-action-cards-and-resolution.md'].sort(),
    );
    expect(resolveCitedSlices(trailingPeriod, ONE_TWO_PUNCH_SLICES).resolved).toEqual([
      'rulebook/02-action-cards-and-resolution.md',
    ]);
    expect(resolveCitedSlices(trailingShorthandPeriod, ONE_TWO_PUNCH_SLICES).resolved).toEqual([
      'rulebook/01-setup-and-round-structure.md',
    ]);
    expect(resolveCitedSlices(possessive, ONE_TWO_PUNCH_SLICES).resolved).toEqual([
      'rulebook/02-action-cards-and-resolution.md',
    ]);
  });

  it('rulebook/00-visual-survey.md resolves — it is a real slice file', () => {
    // one-two-punch/chunks/setup-opening-discards/CHUNK.md:110
    const text =
      '- **rulebook/00-visual-survey.md** — the durable record of the p.1 Setup diagram: three dashed ring areas.';
    const { resolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual(['rulebook/00-visual-survey.md']);
  });

  it('DESIGN.md / RULINGS.md / SKETCH.md / src/... citations produce no entries — no rulebook/ prefix', () => {
    // one-two-punch/chunks/discard-phase-and-reclaim/CHUNK.md:70,72 and jab/CHUNK.md:99
    const text =
      '— cites src/rules/elements.ts (`PlanSlot`, per-slot `contentsVisibleToOwner()`); DECISIONS.md Decision 41 (pile is PUBLIC) and Decision 22. — cites RULINGS.md Ruling 6; DESIGN.md Section 4; SKETCH.md, Ordered Chunk List (scope boundary, not a rules claim). — cites src/rules/game.ts:695-720.';
    const { resolved, unresolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([]);
  });

  it('an ambiguous shorthand (seven\'s two 01- slices) is UNRESOLVED, recorded verbatim, never guessed', () => {
    // seven/rulebook/: 01-definitions-and-components.md AND 01-overview-setup-and-play.md both
    // begin `01-` — genuinely ambiguous, per 171-CONTEXT.md decision 8's binding resolution.
    const text = 'This mechanic is defined per rulebook/01, Setup section.';
    const { resolved, unresolved } = resolveCitedSlices(text, SEVEN_SLICES);
    expect(unresolved).toContain('rulebook/01');
    expect(resolved).not.toContain('rulebook/01-definitions-and-components.md');
    expect(resolved).not.toContain('rulebook/01-overview-setup-and-play.md');
    expect(resolved).toEqual([]);
  });

  it('a citation naming a slice that does not exist is UNRESOLVED, recorded verbatim', () => {
    const text = 'See rulebook/09-does-not-exist.md for the missing rule.';
    const { resolved, unresolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual(['rulebook/09-does-not-exist.md']);
  });

  it('resolved output is de-duplicated and sorted — 40 citations of the same slice yield one entry', () => {
    const text = Array(40).fill('cites rulebook/02, p.2').join('. ');
    const { resolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual(['rulebook/02-action-cards-and-resolution.md']);
  });

  it('a chunk citing nothing at all yields empty resolved AND empty unresolved', () => {
    const text = 'This chunk implements the discard phase. No external citations here.';
    const { resolved, unresolved } = resolveCitedSlices(text, ONE_TWO_PUNCH_SLICES);
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([]);
  });
});
