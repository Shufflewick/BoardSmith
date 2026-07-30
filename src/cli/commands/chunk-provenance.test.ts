import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  chunkCheckCommand,
  VERIFIED_AGAINST_HEADING,
  VERIFIED_AGAINST_BEGIN,
  VERIFIED_AGAINST_END,
  VERIFIED_AGAINST_LABELS,
  VERIFIED_AGAINST_EMPTY,
  PROVENANCE_UNKNOWN,
  parseVerifiedAgainst,
  renderVerifiedAgainst,
  chunkProvenanceStatusCommand,
  type VerifiedAgainstRecord,
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

/**
 * `chunk-check` — PROV-01/PROV-02's write side. `ingestCheckCommand` is the precedent copied
 * line-for-line (171-04-PLAN.md `<copy_these_mechanisms_exactly>`): a fenced machine-owned block,
 * refusal (never silent re-fencing) when the fences are gone, and repair-then-`process.exitCode`
 * rather than throwing on the terminal path — `program.parse()` does not await action handlers, so
 * a rejection there would surface as an unhandled-rejection stack trace (CLAUDE.md forbids that).
 */
describe('chunk-check', () => {
  let exitCode: number | undefined;
  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = exitCode;
  });

  /**
   * A project with a real archived+hashed source (full scope, when untouched) and two real slice
   * files on disk — resolveCitedSlices resolves against a DIRECTORY LISTING, so the slice content
   * must actually exist for a citation to resolve at all.
   */
  async function makeCheckProject(): Promise<{ project: string; sliceHash: string }> {
    const project = join(dir, 'game-check');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });

    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes for chunk-check testing\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game-check',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(join(project, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);

    const sliceBuf = Buffer.from('# Setup and Round Structure\n\nReal slice content for hashing.\n');
    const sliceHash = createHash('sha256').update(sliceBuf).digest('hex');
    await fs.writeFile(join(rulebookDir, '01-setup-and-round-structure.md'), sliceBuf);
    await fs.writeFile(join(rulebookDir, '02-unrelated-slice.md'), '# Unrelated\n');

    return { project, sliceHash };
  }

  /**
   * Scaffolds `chunks/<slug>/CHUNK.md` from the real template's section order (171-04-PLAN.md
   * Task 1's `<action>`), with a real `## Interpretation` citation line substituted in.
   */
  async function makeChunk(project: string, slug: string, interpretation: string): Promise<string> {
    const template = await fs.readFile(
      new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
      'utf-8',
    );
    const withInterpretation = template.replace(
      '1. <!-- claim text --> — cites <!-- rulebook section / RULINGS.md entry -->',
      interpretation,
    );
    const chunkDir = join(project, 'chunks', slug);
    await fs.mkdir(chunkDir, { recursive: true });
    const chunkPath = join(chunkDir, 'CHUNK.md');
    await fs.writeFile(chunkPath, withInterpretation);
    return chunkPath;
  }

  const JAB_CITES =
    '1. Jab is a basic strike — cites rulebook/01-setup-and-round-structure.md';

  it('finds the section by LINE, not by first substring — a prose mention above it must not truncate citations', async () => {
    // The real 171-06 regression, pinned. CHUNK.template.md:18 names "## Verified Against" inside
    // its required-headings comment, 130 lines above the real section. With a substring indexOf,
    // citableText truncated there — before ## Interpretation — so every citation was silently
    // dropped and each chunk recorded provenance citing NOTHING, while still looking healthy.
    // Silent under-recording is the defect class this phase exists to prevent.
    const { project, sliceHash } = await makeCheckProject();
    const chunkPath = await makeChunk(project, 'prose-mention', JAB_CITES);
    const text = await fs.readFile(chunkPath, 'utf-8');
    // Put the mention ABOVE everything, exactly as the template's comment does.
    await fs.writeFile(
      chunkPath,
      `<!-- required sections: "## Verified Against" must be present -->\n${text}`,
    );

    await chunkCheckCommand('prose-mention', { project, quiet: true }).catch(() => {});

    const after = await fs.readFile(chunkPath, 'utf-8');
    expect(after).toContain(`| rulebook/01-setup-and-round-structure.md | ${sliceHash} |`);
  });

  it('writes the whole fenced section when none exists, and exits non-zero', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    expect(process.exitCode).toBe(1);
    const text = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(text).toContain(VERIFIED_AGAINST_HEADING);
    expect(text).toContain(VERIFIED_AGAINST_BEGIN);
    expect(text).toContain(VERIFIED_AGAINST_END);
  });

  it('running again with nothing changed leaves the file byte-identical, exitCode undefined', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    const after1 = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');

    process.exitCode = undefined;
    await chunkCheckCommand('jab', { project, json: true });
    expect(process.exitCode).toBeUndefined();
    const after2 = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(after2).toBe(after1);
  });

  it('the written body contains Scope/Rulebook edition/Rulebook source hash/BoardSmith version/Skills tree hash lines and a cited-slice hash row', async () => {
    const { project, sliceHash } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    const text = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');

    for (const label of [
      'Scope:',
      'Rulebook edition:',
      'Rulebook source hash:',
      'BoardSmith version:',
      'Skills tree hash:',
    ]) {
      expect(VERIFIED_AGAINST_LABELS).toContain(label);
      expect(text).toContain(label);
    }
    expect(text).toContain(`| rulebook/01-setup-and-round-structure.md | ${sliceHash} |`);
  });

  it('code-conformance-only scope writes a Reason: line carrying an enumerated code; full scope writes no Reason: line', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    const fullText = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(fullText).not.toContain('Reason:');

    await fs.rm(join(project, 'rulebook', 'source', 'rules.pdf'));
    process.exitCode = undefined;
    await chunkCheckCommand('jab', { project, json: true });
    const reducedText = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(reducedText).toContain('Reason: source-missing');
    expect(SCOPE_REASONS).toContain('source-missing');
  });

  it("the recorded slice hash equals the SHA-256 of that slice file's actual bytes, computed independently", async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    const text = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');

    const sliceBytes = await fs.readFile(join(project, 'rulebook', '01-setup-and-round-structure.md'));
    const independentHash = createHash('sha256').update(sliceBytes).digest('hex');
    expect(text).toContain(`| rulebook/01-setup-and-round-structure.md | ${independentHash} |`);
  });

  it("editing a slice file and re-running rewrites that row's hash and exits 1", async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });

    process.exitCode = undefined;
    await fs.appendFile(join(project, 'rulebook', '01-setup-and-round-structure.md'), '\nAn added rule.\n');
    const newBytes = await fs.readFile(join(project, 'rulebook', '01-setup-and-round-structure.md'));
    const newHash = createHash('sha256').update(newBytes).digest('hex');

    await chunkCheckCommand('jab', { project, json: true });
    expect(process.exitCode).toBe(1);
    const text = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(text).toContain(`| rulebook/01-setup-and-round-structure.md | ${newHash} |`);
  });

  it('unresolved citations are recorded verbatim under Unresolved citations:; a chunk with none omits the list', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(
      project,
      'jab',
      '1. Jab is a basic strike — cites rulebook/09-does-not-exist.md',
    );
    await chunkCheckCommand('jab', { project, json: true });
    const text = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(text).toContain('Unresolved citations:');
    expect(text).toContain('rulebook/09-does-not-exist.md');

    await makeChunk(project, 'cross', JAB_CITES);
    process.exitCode = undefined;
    await chunkCheckCommand('cross', { project, json: true });
    const crossText = await fs.readFile(join(project, 'chunks', 'cross', 'CHUNK.md'), 'utf-8');
    expect(crossText).not.toContain('Unresolved citations:');
  });

  it('a fence-less "## Verified Against" section throws an actionable error naming both markers, and does NOT modify the file', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;

    const chunkPath = join(project, 'chunks', 'jab', 'CHUNK.md');
    const withBlock = await fs.readFile(chunkPath, 'utf-8');
    const strippedFences = withBlock
      .replace(VERIFIED_AGAINST_BEGIN, '')
      .replace(VERIFIED_AGAINST_END, '');
    await fs.writeFile(chunkPath, strippedFences);

    await expect(chunkCheckCommand('jab', { project, json: true })).rejects.toThrow(
      /machine-owned fences/i,
    );
    await expect(chunkCheckCommand('jab', { project, json: true })).rejects.toThrow(
      /chunk-check/,
    );
    const after = await fs.readFile(chunkPath, 'utf-8');
    expect(after).toBe(strippedFences);
  });

  it('content OUTSIDE the fences (## Interpretation etc.) is byte-identical before and after a repair run', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    await chunkCheckCommand('jab', { project, json: true }); // first run creates the section
    process.exitCode = undefined;

    const chunkPath = join(project, 'chunks', 'jab', 'CHUNK.md');
    const beforeSecondRun = await fs.readFile(chunkPath, 'utf-8');
    const beforeHeadingIdx = beforeSecondRun.indexOf(VERIFIED_AGAINST_HEADING);
    const outsideBefore = beforeSecondRun.slice(0, beforeHeadingIdx);

    // Force a repair: change the cited slice's bytes, which rewrites its hash row.
    await fs.appendFile(join(project, 'rulebook', '01-setup-and-round-structure.md'), '\nAdditional line.\n');
    await chunkCheckCommand('jab', { project, json: true });
    expect(process.exitCode).toBe(1);

    const after = await fs.readFile(chunkPath, 'utf-8');
    const afterHeadingIdx = after.indexOf(VERIFIED_AGAINST_HEADING);
    expect(after.slice(0, afterHeadingIdx)).toBe(outsideBefore);
  });

  it('an unknown slug throws an error naming the path it looked for', async () => {
    const { project } = await makeCheckProject();
    await expect(chunkCheckCommand('no-such-chunk', { project, json: true })).rejects.toThrow(
      /chunks[\\/]no-such-chunk[\\/]CHUNK\.md/,
    );
  });

  it('--json emits { slug, scope, reason, changed, citedSlices, unresolved } and prints no human decoration', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await chunkCheckCommand('jab', { project, json: true });

    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ slug: 'jab', scope: SCOPE_FULL, changed: true });
    expect(parsed.citedSlices).toEqual(['rulebook/01-setup-and-round-structure.md']);
    expect(parsed.unresolved).toEqual([]);

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('writes the Re-verified (no code change): stamp when --reverified-no-code-change is supplied, and writes nothing without it (175-02)', async () => {
    const { project } = await makeCheckProject();
    await makeChunk(project, 'jab', JAB_CITES);

    await chunkCheckCommand('jab', { project, json: true });
    const withoutFlag = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(withoutFlag).not.toContain('Re-verified');

    process.exitCode = undefined;
    await chunkCheckCommand('jab', {
      project,
      json: true,
      reverifiedNoCodeChange: 'aaa111..bbb222 — 0 manifest files changed',
    });
    const withFlag = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
    expect(withFlag).toContain(
      'Re-verified (no code change): aaa111..bbb222 — 0 manifest files changed',
    );
  });
});

/**
 * `chunk-provenance-status` — PROV-03's read-only aggregation. The three-state contract
 * (171-CONTEXT.md "specifics" item 3): `full`, `code-conformance-only`, and `unknown` — the last
 * one for a chunk verified before this phase existed, NEVER collapsed into
 * `code-conformance-only`. `verifiedWithoutProvenance` is the load-bearing flag (decision 6,
 * second half): a chunk whose Status claims verification but has no valid block, so a skipped
 * `chunk-check` invocation surfaces rather than passing silently.
 */
describe('chunk-provenance-status', () => {
  let exitCode: number | undefined;
  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = exitCode;
  });

  /** A project with a real archived+hashed source and one real slice file — mirrors makeCheckProject above. */
  async function makeStatusProject(): Promise<{ project: string }> {
    const project = join(dir, 'game-status');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });

    const sourceBuf = Buffer.from(
      '%PDF-1.4 fake rulebook bytes for chunk-provenance-status testing\n',
    );
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game-status',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(join(project, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    await fs.writeFile(
      join(rulebookDir, '01-setup-and-round-structure.md'),
      '# Setup and Round Structure\n\nReal slice content for hashing.\n',
    );
    return { project };
  }

  /** Scaffolds chunks/<slug>/CHUNK.md from the real template, with the given Status and citation. */
  async function addChunk(
    project: string,
    slug: string,
    status: string,
    cites = '',
  ): Promise<string> {
    const template = await fs.readFile(
      new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
      'utf-8',
    );
    let text = template.replace(/^Status: proposed$/m, `Status: ${status}`);
    if (cites) {
      text = text.replace(
        '1. <!-- claim text --> — cites <!-- rulebook section / RULINGS.md entry -->',
        `1. A claim — cites ${cites}`,
      );
    }
    const chunkDir = join(project, 'chunks', slug);
    await fs.mkdir(chunkDir, { recursive: true });
    const chunkPath = join(chunkDir, 'CHUNK.md');
    await fs.writeFile(chunkPath, text);
    return chunkPath;
  }

  /** Recursive path -> sha256 map, for the read-only proof. */
  async function hashTree(project: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    async function walk(d: string): Promise<void> {
      const entries = await fs.readdir(d, { withFileTypes: true });
      for (const e of entries) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else map.set(p, createHash('sha256').update(await fs.readFile(p)).digest('hex'));
      }
    }
    await walk(project);
    return map;
  }

  it('a well-formed full block reports state full', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await chunkCheckCommand('jab', { project, json: true });

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(SCOPE_FULL);
  });

  it('a well-formed code-conformance-only block reports that state AND its reason code', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await fs.rm(join(project, 'rulebook', 'source', 'rules.pdf'));
    await chunkCheckCommand('jab', { project, json: true });

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(SCOPE_CODE_ONLY);
    expect(entry.reason).toBe('source-missing');
    expect(SCOPE_REASONS).toContain(entry.reason);
  });

  it('a chunk with no "## Verified Against" heading at all reports unknown — asserted distinct from BOTH other states', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified');

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(PROVENANCE_UNKNOWN);
    expect(entry.state).not.toBe(SCOPE_FULL);
    expect(entry.state).not.toBe(SCOPE_CODE_ONLY);
  });

  it('a chunk whose block body is still VERIFIED_AGAINST_EMPTY reports unknown', async () => {
    const { project } = await makeStatusProject();
    const chunkPath = await addChunk(project, 'jab', 'proposed');
    const text = await fs.readFile(chunkPath, 'utf-8');
    const scaffolded = `${text}\n${VERIFIED_AGAINST_HEADING}\n\n${VERIFIED_AGAINST_BEGIN}\n${VERIFIED_AGAINST_EMPTY}\n${VERIFIED_AGAINST_END}\n`;
    await fs.writeFile(chunkPath, scaffolded);

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(PROVENANCE_UNKNOWN);
  });

  it('a chunk whose block exists but is unparseable (a required label removed) reports unknown with blockMalformed: true', async () => {
    const { project } = await makeStatusProject();
    const chunkPath = await addChunk(
      project,
      'jab',
      'verified',
      'rulebook/01-setup-and-round-structure.md',
    );
    await chunkCheckCommand('jab', { project, json: true });
    const text = await fs.readFile(chunkPath, 'utf-8');
    await fs.writeFile(chunkPath, text.replace(/^BoardSmith version:.*$/m, ''));

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(PROVENANCE_UNKNOWN);
    expect(entry.blockMalformed).toBe(true);
  });

  it('a chunk whose block exists but has a fence deleted reports unknown with blockMalformed: true', async () => {
    const { project } = await makeStatusProject();
    const chunkPath = await addChunk(
      project,
      'jab',
      'verified',
      'rulebook/01-setup-and-round-structure.md',
    );
    await chunkCheckCommand('jab', { project, json: true });
    const text = await fs.readFile(chunkPath, 'utf-8');
    await fs.writeFile(chunkPath, text.replace(VERIFIED_AGAINST_END, ''));

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const entry = result.chunks.find((c) => c.slug === 'jab')!;
    expect(entry.state).toBe(PROVENANCE_UNKNOWN);
    expect(entry.blockMalformed).toBe(true);
  });

  it('Status verified + state unknown appears in verifiedWithoutProvenance', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified');
    const result = await chunkProvenanceStatusCommand({ project, json: false });
    expect(result.verifiedWithoutProvenance).toContain('jab');
  });

  it('Status "verified (user-waived)" + state unknown ALSO appears in verifiedWithoutProvenance — a waived verification is still a claim', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified (user-waived)');
    const result = await chunkProvenanceStatusCommand({ project, json: false });
    expect(result.verifiedWithoutProvenance).toContain('jab');
  });

  it('Status built + state unknown does NOT appear in verifiedWithoutProvenance — it never claimed verification', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'built');
    const result = await chunkProvenanceStatusCommand({ project, json: false });
    expect(result.verifiedWithoutProvenance).not.toContain('jab');
  });

  it('two chunks recorded with different raw edition free text that both normalise to EDITION_UNKNOWN group into ONE edition bucket', async () => {
    const { project } = await makeStatusProject();
    const chunkA = await addChunk(
      project,
      'jab',
      'verified',
      'rulebook/01-setup-and-round-structure.md',
    );
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;
    const chunkB = await addChunk(
      project,
      'cross',
      'verified',
      'rulebook/01-setup-and-round-structure.md',
    );
    await chunkCheckCommand('cross', { project, json: true });

    // Hand-edit each block's "Rulebook edition:" line to different non-canonical free text that
    // both normalise to EDITION_UNKNOWN — reproducing a pre-F-1 or hand-edited block
    // (171-CONTEXT.md decision 5; RESEARCH.md Pitfall 3).
    const textA = await fs.readFile(chunkA, 'utf-8');
    await fs.writeFile(
      chunkA,
      textA.replace(/^Rulebook edition:.*$/m, 'Rulebook edition: not specified anywhere'),
    );
    const textB = await fs.readFile(chunkB, 'utf-8');
    await fs.writeFile(
      chunkB,
      textB.replace(/^Rulebook edition:.*$/m, 'Rulebook edition: none given in this printing'),
    );

    const result = await chunkProvenanceStatusCommand({ project, json: false });
    expect(Object.keys(result.byEdition)).toEqual([EDITION_UNKNOWN]);
    expect(result.byEdition[EDITION_UNKNOWN].sort()).toEqual(['cross', 'jab']);
  });

  it('two chunks recorded against different skills-tree hashes group into two buckets, and the report names the drift', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;
    const chunkB = await addChunk(
      project,
      'cross',
      'verified',
      'rulebook/01-setup-and-round-structure.md',
    );
    await chunkCheckCommand('cross', { project, json: true });

    const textB = await fs.readFile(chunkB, 'utf-8');
    const driftHash = '0'.repeat(64);
    await fs.writeFile(
      chunkB,
      textB.replace(/^Skills tree hash:.*$/m, `Skills tree hash: ${driftHash}`),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await chunkProvenanceStatusCommand({ project, json: false });
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    logSpy.mockRestore();

    expect(Object.keys(result.bySkillsTreeHash).length).toBe(2);
    expect(result.bySkillsTreeHash[driftHash]).toEqual(['cross']);
    expect(output.toLowerCase()).toContain('drift');
    expect(output).toContain(driftHash);
  });

  it('--json emits a stable documented shape', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;
    await addChunk(project, 'legacy', 'verified');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await chunkProvenanceStatusCommand({ project, json: true });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    logSpy.mockRestore();

    expect(parsed).toEqual(result);
    expect(parsed.chunks.map((c: { slug: string }) => c.slug).sort()).toEqual(['jab', 'legacy']);
    expect(parsed.counts).toEqual({ full: 1, codeConformanceOnly: 0, unknown: 1 });
    expect(parsed.verifiedWithoutProvenance).toEqual(['legacy']);
    expect(Array.isArray(parsed.chunks)).toBe(true);
    expect(typeof parsed.byEdition).toBe('object');
    expect(typeof parsed.bySkillsTreeHash).toBe('object');
    expect(typeof parsed.byBoardsmithVersion).toBe('object');
  });

  it('the human output prints one row per chunk plus the group summaries', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;
    await addChunk(project, 'legacy', 'verified');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await chunkProvenanceStatusCommand({ project, json: false });
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    logSpy.mockRestore();

    expect(output).toContain('jab');
    expect(output).toContain('legacy');
    expect(output).toMatch(/full/);
    expect(output).toMatch(/unknown/i);
    expect(output).toMatch(/legacy/); // flagged in verifiedWithoutProvenance section
  });

  it('the command writes nothing: every file byte-identical before and after', async () => {
    const { project } = await makeStatusProject();
    await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
    await chunkCheckCommand('jab', { project, json: true });
    process.exitCode = undefined;
    await addChunk(project, 'legacy', 'verified');

    const before = await hashTree(project);
    await chunkProvenanceStatusCommand({ project, json: true });
    const after = await hashTree(project);
    expect(after).toEqual(before);
  });

  /**
   * `parseVerifiedAgainst` — the `f73153a3` defect class recurring at a SECOND, unfixed call
   * site.
   *
   * `chunk-provenance.ts:394-395`'s write path already fixed the substring-heading bug once
   * (`indexOf(heading)` matches a heading NAME echoed in prose, not just the real section). This
   * read path, `parseVerifiedAgainst`, still used `chunkText.indexOf(VERIFIED_AGAINST_HEADING)`
   * directly — reachable through this tool's OWN documented recovery instruction
   * (`chunkCheckCommand`'s fence-refusal error tells the user to delete the entire
   * "## Verified Against" section and re-run), after which the template's surviving line-18
   * prose mention of "## Verified Against" made `parseVerifiedAgainst` find a heading index
   * that isn't the real section — mislabeling a never-recorded chunk as `blockMalformed: true`
   * (172-CONTEXT.md decision 10's exact state conflation: "older" reporting as "damaged").
   */
  describe('parseVerifiedAgainst — heading location', () => {
    it('the template exactly as shipped (real section present) still returns unknown, not malformed', async () => {
      const template = await fs.readFile(
        new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
        'utf-8',
      );
      const parsed = parseVerifiedAgainst(template);
      expect(parsed.state).toBe(PROVENANCE_UNKNOWN);
      expect(parsed.blockMalformed).toBe(false);
    });

    it('a chunk whose real "## Verified Against" section is deleted, with the template\'s line-18 prose mention of the heading still present, returns unknown/not-malformed — never blockMalformed: true', async () => {
      const template = await fs.readFile(
        new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
        'utf-8',
      );
      const headingIdx = template.indexOf('\n## Verified Against\n');
      expect(headingIdx).toBeGreaterThan(-1); // sanity: the real section exists in the shipped template
      const sectionDeleted = template.slice(0, headingIdx) + '\n';

      // The template's own PARSE CONTRACT comment (line 18) legitimately names "## Verified Against"
      // in prose — confirm the fixture still carries that prose mention after the real section is gone.
      expect(sectionDeleted).toContain('"## Verified Against"');
      expect(sectionDeleted).not.toContain('\n## Verified Against\n');

      const parsed = parseVerifiedAgainst(sectionDeleted);
      expect(parsed.state).toBe(PROVENANCE_UNKNOWN);
      expect(parsed.blockMalformed).toBe(false); // never-recorded, not damaged
    });

    it('a real recorded block still parses to full — unmodified from the pre-existing contract', async () => {
      const { project } = await makeStatusProject();
      await addChunk(project, 'jab', 'verified', 'rulebook/01-setup-and-round-structure.md');
      await chunkCheckCommand('jab', { project, json: true });
      const chunkText = await fs.readFile(join(project, 'chunks', 'jab', 'CHUNK.md'), 'utf-8');
      const parsed = parseVerifiedAgainst(chunkText);
      expect(parsed.state).toBe(SCOPE_FULL);
      expect(parsed.blockMalformed).toBe(false);
    });

    it('genuinely missing fences still report blockMalformed: true', () => {
      const chunkText = '## Verified Against\n\nsome hand-written text, no fences at all\n';
      const parsed = parseVerifiedAgainst(chunkText);
      expect(parsed.state).toBe(PROVENANCE_UNKNOWN);
      expect(parsed.blockMalformed).toBe(true);
    });
  });
});

/**
 * `projectProvenanceState` — what makes `verifiedWithoutProvenance` usable rather than noise.
 *
 * The flag's membership is correct: a chunk claiming `verified` with no backing block IS
 * unbacked, whether the project is old or someone skipped `chunk-check`. But the two cases have
 * opposite severity, and on a pre-provenance project the flag fires on 100% of chunks — verified
 * live against a copy of `one-two-punch`, where all 12 chunks flagged. Rendering that as an alert
 * on every run trains the reader to ignore the flag, and the flag is this phase's ONLY
 * enforcement half that does not depend on a live agent following a skill-text instruction.
 * A check that fires on correct work gets waived rather than fixed.
 */
describe('projectProvenanceState', () => {
  async function projectWithChunks(chunks: Array<{ slug: string; status: string; block?: string }>) {
    const project = join(dir, `proj-${Math.abs(chunks.length * 7 + chunks[0].slug.length)}`);
    for (const c of chunks) {
      const chunkDir = join(project, 'chunks', c.slug);
      await fs.mkdir(chunkDir, { recursive: true });
      await fs.writeFile(
        join(chunkDir, 'CHUNK.md'),
        `# Chunk: ${c.slug}\n\nStatus: ${c.status}\n\n${c.block ?? ''}\n`,
      );
    }
    return project;
  }

  it('classifies a project with no blocks at all as pre-provenance, not partial', async () => {
    // Both reference games are exactly this shape.
    const project = await projectWithChunks([
      { slug: 'a', status: 'verified' },
      { slug: 'b', status: 'verified (user-waived)' },
    ]);
    const r = await chunkProvenanceStatusCommand({ project, json: false, quiet: true });
    expect(r.projectProvenanceState).toBe('pre-provenance');
    // Membership is unchanged — both are still flagged. Only the severity signal differs.
    expect(r.verifiedWithoutProvenance).toEqual(['a', 'b']);
  });

  it('classifies a project that records provenance but has a blockless verified chunk as partial', async () => {
    // THIS is the case that indicates a skipped chunk-check, and the only one worth alarming on.
    const withBlock = await projectWithChunks([{ slug: 'has-block', status: 'verified' }]);
    await chunkCheckCommand('has-block', { project: withBlock, quiet: true }).catch(() => {});
    const chunkDir = join(withBlock, 'chunks', 'skipped');
    await fs.mkdir(chunkDir, { recursive: true });
    await fs.writeFile(join(chunkDir, 'CHUNK.md'), '# Chunk: skipped\n\nStatus: verified\n');

    const r = await chunkProvenanceStatusCommand({ project: withBlock, json: false, quiet: true });
    expect(r.projectProvenanceState).toBe('partial');
    expect(r.verifiedWithoutProvenance).toContain('skipped');
  });

  it('reports empty for a project with no chunks', async () => {
    const project = join(dir, 'no-chunks');
    await fs.mkdir(join(project, 'chunks'), { recursive: true });
    const r = await chunkProvenanceStatusCommand({ project, json: false, quiet: true });
    expect(r.projectProvenanceState).toBe('empty');
  });
});

/**
 * 175-CONTEXT.md decision 11 — the `Re-verified (no code change):` label, APPENDED as the ninth
 * `VERIFIED_AGAINST_LABELS` member. It is a genuinely NEW concept, never a reuse of
 * `SCOPE_REASONS` (which encodes why a verification's scope was reduced, not whether code moved).
 */
describe('VERIFIED_AGAINST_LABELS — Re-verified (no code change) append (175-02)', () => {
  const PRE_CHANGE_EIGHT_LABELS = [
    'Scope:',
    'Reason:',
    'Rulebook edition:',
    'Rulebook source hash:',
    'BoardSmith version:',
    'Skills tree hash:',
    'Cited slices:',
    'Unresolved citations:',
  ] as const;

  function baseRecord(overrides: Partial<VerifiedAgainstRecord> = {}): VerifiedAgainstRecord {
    return {
      scope: SCOPE_FULL,
      edition: 'First Printing 2020',
      sourceHash: 'deadbeef',
      boardsmithVersion: '4.7.0',
      skillsTreeHash: 'cafef00d',
      citedSlices: [],
      unresolved: [],
      ...overrides,
    };
  }

  it('has exactly nine members, with the new one appended last', () => {
    expect(VERIFIED_AGAINST_LABELS).toHaveLength(9);
    expect(VERIFIED_AGAINST_LABELS[8]).toBe('Re-verified (no code change):');
  });

  it('the first eight members deep-equal the pre-change label set, byte-for-byte', () => {
    expect(VERIFIED_AGAINST_LABELS.slice(0, 8)).toEqual(PRE_CHANGE_EIGHT_LABELS);
  });

  it('SCOPE_REASONS is unchanged: 5 members, none mentioning "code change"', () => {
    expect(SCOPE_REASONS).toHaveLength(5);
    expect(SCOPE_REASONS.some((r) => r.includes('code change'))).toBe(false);
  });

  it('renderVerifiedAgainst omits the new label entirely for a record without reverifiedNoCodeChange — byte-identical to the pre-change shape', () => {
    const record = baseRecord();
    const rendered = renderVerifiedAgainst(record);
    expect(rendered).not.toContain('Re-verified');
    // Hard-coded expected block, pinned so a future change cannot silently start emitting the
    // new label for a record that never asked for it.
    expect(rendered).toBe(
      '\nScope: full\n' +
        'Rulebook edition: First Printing 2020\n' +
        'Rulebook source hash: deadbeef\n' +
        'BoardSmith version: 4.7.0\n' +
        'Skills tree hash: cafef00d\n' +
        '\n' +
        'Cited slices:\n' +
        '\n' +
        '_Not yet recorded._\n',
    );
  });

  it('renders the label with its evidence string when the field is present, positioned before Cited slices:', () => {
    const record = baseRecord({
      reverifiedNoCodeChange: 'abc123..def456 — 0 manifest files changed',
    });
    const rendered = renderVerifiedAgainst(record);
    expect(rendered).toContain(
      'Re-verified (no code change): abc123..def456 — 0 manifest files changed',
    );
    expect(rendered.indexOf('Re-verified')).toBeLessThan(rendered.indexOf('Cited slices:'));
  });

  it('round-trips reverifiedNoCodeChange through parseVerifiedAgainst', () => {
    const record = baseRecord({
      reverifiedNoCodeChange: 'abc123..def456 — 0 manifest files changed',
    });
    const rendered = renderVerifiedAgainst(record);
    const chunkText =
      `# Chunk: x\n\n${VERIFIED_AGAINST_HEADING}\n\n${VERIFIED_AGAINST_BEGIN}` +
      `${rendered}${VERIFIED_AGAINST_END}\n`;
    const parsed = parseVerifiedAgainst(chunkText);
    expect(parsed.blockMalformed).toBe(false);
    expect(parsed.reverifiedNoCodeChange).toBe('abc123..def456 — 0 manifest files changed');
  });

  it('an existing eight-label block (no Re-verified line) still parses as valid, not malformed', () => {
    const record = baseRecord();
    const rendered = renderVerifiedAgainst(record);
    expect(rendered).not.toContain('Re-verified');
    const chunkText =
      `# Chunk: x\n\n${VERIFIED_AGAINST_HEADING}\n\n${VERIFIED_AGAINST_BEGIN}` +
      `${rendered}${VERIFIED_AGAINST_END}\n`;
    const parsed = parseVerifiedAgainst(chunkText);
    expect(parsed.blockMalformed).toBe(false);
    expect(parsed.state).toBe(SCOPE_FULL);
    expect(parsed.reverifiedNoCodeChange).toBeUndefined();
  });
});
