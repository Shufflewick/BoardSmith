import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PROVENANCE_KINDS,
  RULE_DELTA_KINDS,
  PRESENTATION_EXCLUSION_MARKERS,
  PAIR_KINDS,
  isPresentationLine,
  ruleBearingLines,
  deriveStale,
  livePageSpan,
  pairSlices,
  resolveProvenance,
  type RuleDelta,
} from './verify-classify.js';
import { renderIndex } from './ingest-archive.js';
import {
  VERIFIED_AGAINST_HEADING,
  VERIFIED_AGAINST_BEGIN,
  VERIFIED_AGAINST_END,
  renderVerifiedAgainst,
  SCOPE_FULL,
} from './chunk-provenance.js';

/**
 * `verify-classify.ts` is the mechanical core of VERIFY-03. Every fixture here is either a real
 * filesystem temp dir (`fs.mkdtemp`, no mocks) or the REAL archived pass-1-vs-pass-2 slices plan
 * 174-01 produced and committed under `174-FIXTURES/` — never invented slice bodies for the
 * presentation/pairing behavior this plan pins.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(
  __dirname,
  '../../../.planning/phases/174-verify-classifier/174-FIXTURES',
);

async function readFixture(relPath: string): Promise<string> {
  return fs.readFile(join(FIXTURES_ROOT, relPath), 'utf-8');
}

async function listFixtureFiles(relDir: string): Promise<string[]> {
  const entries = await fs.readdir(join(FIXTURES_ROOT, relDir), { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'INDEX.md')
    .map((e) => e.name)
    .sort();
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-classify-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// -------------------------------------------------------------------------------------------
// presentation (Task 1)
// -------------------------------------------------------------------------------------------

describe('presentation — dual-schema exclusion filter, over REAL archived fixtures', () => {
  it('presentation-1: one-two-punch live rule slices — ruleBearingLines() equals total content lines minus citation headers minus legacy-qualified Derived lines', async () => {
    const files = ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'];
    for (const file of files) {
      const text = await readFixture(`one-two-punch/live/${file}`);
      const rawLines = text.split('\n').map((l) => l.trim());
      const contentLines = rawLines.filter((l) => l.length > 0 && !l.startsWith('#'));
      const headerLines = contentLines.filter((l) => /^p\.\d+,.*:$/.test(l));
      const legacyLines = contentLines.filter(
        (l) =>
          /^Derived \(p\.\d+\) — diagram description:/i.test(l) ||
          /^Derived \(p\.\d+\) — art:/i.test(l),
      );
      const expectedCount = contentLines.length - headerLines.length - legacyLines.length;

      const result = ruleBearingLines(text);
      expect(result.length).toBe(expectedCount);
      // Neither citation headers nor legacy-qualified lines survive into the rule-bearing set.
      for (const excluded of [...headerLines, ...legacyLines]) {
        expect(result).not.toContain(excluded);
      }
    }
  });

  it('presentation-1b: the measured legacy-qualifier counts match 174-PROOF.md section 1 exactly (5 diagram description + 1 art, 12 total Derived, one-two-punch live)', async () => {
    const files = ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'];
    let totalDerived = 0;
    let diagramCount = 0;
    let artCount = 0;
    let visualCount = 0;
    for (const file of files) {
      const text = await readFixture(`one-two-punch/live/${file}`);
      const lines = text.split('\n');
      totalDerived += lines.filter((l) => /^Derived \(p\.\d+\)/.test(l.trim())).length;
      diagramCount += lines.filter((l) =>
        /^Derived \(p\.\d+\) — diagram description/.test(l.trim()),
      ).length;
      artCount += lines.filter((l) => /^Derived \(p\.\d+\) — art/.test(l.trim())).length;
      visualCount += lines.filter((l) => /^Visual \(p\.\d+\):/.test(l.trim())).length;
    }
    expect(totalDerived).toBe(12);
    expect(diagramCount).toBe(5);
    expect(artCount).toBe(1);
    expect(visualCount).toBe(0);
  });

  it('presentation-2: seven staged units — Visual (p.N): lines are classified as presentation and excluded from ruleBearingLines()', async () => {
    const files = await listFixtureFiles('seven/staged');
    let sawAtLeastOneVisualLine = false;
    for (const file of files) {
      const text = await readFixture(`seven/staged/${file}`);
      const visualLines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^Visual \(p\.\d+\):/.test(l));
      if (visualLines.length > 0) sawAtLeastOneVisualLine = true;
      for (const line of visualLines) {
        expect(isPresentationLine(line)).toBe(true);
      }
      const result = ruleBearingLines(text);
      for (const line of visualLines) {
        expect(result).not.toContain(line);
      }
      expect(result.some((l) => l.startsWith('Visual (p.'))).toBe(false);
    }
    expect(sawAtLeastOneVisualLine).toBe(true);
  });

  it('presentation-3: a Derived line with no presentation qualifier is rule-bearing and IS returned', () => {
    const line = 'Derived (p.1): Rounds are simultaneous — every player acts before any reveal.';
    expect(isPresentationLine(line)).toBe(false);
    const result = ruleBearingLines(`# Heading\n\n${line}\n`);
    expect(result).toContain(line);
  });

  it('presentation-4 (pin): PRESENTATION_EXCLUSION_MARKERS is exactly the measured set, frozen', () => {
    expect(Object.isFrozen(PRESENTATION_EXCLUSION_MARKERS)).toBe(true);
    expect([...PRESENTATION_EXCLUSION_MARKERS]).toEqual([
      '^Visual \\(p\\.\\d+\\):',
      '^Derived \\(p\\.\\d+\\) — diagram description:',
      '^Derived \\(p\\.\\d+\\) — art:',
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// staleness (Task 1)
// -------------------------------------------------------------------------------------------

describe('staleness — single-input derivation from the rule delta alone', () => {
  it('staleness-1: table-driven over RULE_DELTA_KINDS — cosmetic is not stale, every other code is stale', () => {
    const expected: Record<RuleDelta, boolean> = {
      cosmetic: false,
      sharper: true,
      contradictory: true,
      unclassified: true,
    };
    for (const code of RULE_DELTA_KINDS) {
      expect(deriveStale(code)).toBe(expected[code]);
    }
  });

  it('staleness-2 (SC-4 structural): deriveStale takes exactly one parameter, and provenance never appears in its source region', async () => {
    expect(deriveStale.length).toBe(1);
    const src = await fs.readFile(join(__dirname, 'verify-classify.ts'), 'utf-8');
    const start = src.indexOf('STALE_BY_RULE_DELTA');
    const pairIdx = src.indexOf('export function pairSlices');
    const end = pairIdx === -1 ? src.length : pairIdx;
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = src
      .slice(start, end)
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(region).not.toMatch(/PROVENANCE_KINDS/);
    expect(region.replace(/^.*deriveStale\(ruleDelta: RuleDelta\).*$/m, '')).not.toMatch(
      /deriveStale\(.*provenance/i,
    );
  });
});

// -------------------------------------------------------------------------------------------
// pairing (Task 2)
// -------------------------------------------------------------------------------------------

describe('pairing — m:n page-overlap group join, over REAL archived fixtures', () => {
  it('pairing-1: livePageSpan() over real seven live slices derives spans from their own p.N, citation lines, no INDEX.md read', async () => {
    const definitions = await readFixture('seven/live/01-definitions-and-components.md');
    const overview = await readFixture('seven/live/01-overview-setup-and-play.md');
    const solo = await readFixture('seven/live/02-solo-variant.md');

    expect(livePageSpan(definitions)).toEqual({ first: 1, last: 1 });
    expect(livePageSpan(overview)).toEqual({ first: 1, last: 1 });
    expect(livePageSpan(solo)).toEqual({ first: 2, last: 2 });
  });

  it('pairing-2: livePageSpan() works identically on one-two-punch live slices, which has NO INDEX.md Slices table', async () => {
    const index = await readFixture('one-two-punch/live/INDEX.md');
    expect(index).not.toMatch(/## Slices/);

    const setup = await readFixture('one-two-punch/live/01-setup-and-round-structure.md');
    const action = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    expect(livePageSpan(setup)).toEqual({ first: 1, last: 1 });
    expect(livePageSpan(action)).toEqual({ first: 2, last: 2 });
  });

  it('pairing-3 (corrective, symmetric span derivation): each seven staged unit\'s OWN content yields its own span — most single-page, one genuinely cross-page, never the ledger rangeId', async () => {
    const stagedNames = await listFixtureFiles('seven/staged');
    expect(stagedNames.length).toBe(6);

    // Measured directly against the real archived files (174-CONTEXT.md decision 4's second
    // amendment): five staged units carry only a p.1 citation, one only p.2, and
    // 01-about-and-setup.md's own "Derived (p.1): ... the Solo Variant (p.2)." line makes it
    // genuinely span both pages — a real content fact, not a rangeId artifact.
    const expectedSpans: Record<string, { first: number; last: number }> = {
      '01-about-and-setup.md': { first: 1, last: 2 },
      '01-definitions.md': { first: 1, last: 1 },
      '01-distribution-of-cards.md': { first: 1, last: 1 },
      '01-game-end-and-match.md': { first: 1, last: 1 },
      '01-round.md': { first: 1, last: 1 },
      '02-solo-variant.md': { first: 2, last: 2 },
    };
    for (const name of stagedNames) {
      const text = await readFixture(`seven/staged/${name}`);
      expect(livePageSpan(text)).toEqual(expectedSpans[name]);
    }
  });

  it('pairing-3b (corrective, real fixture, both games): pairSlices() over the real seven and one-two-punch fixtures produces exactly ONE paired group per game — genuine cross-page staged content bridges the p.1/p.2 split, not a collapsed rangeId artifact', async () => {
    async function pairGame(
      game: string,
      liveNames: string[],
    ): Promise<{ liveCount: number; stagedNames: string[] }> {
      const stagedNames = await listFixtureFiles(`${game}/staged`);
      const liveSlices = await Promise.all(
        liveNames.map(async (name) => ({
          path: `rulebook/${name}`,
          text: await readFixture(`${game}/live/${name}`),
        })),
      );
      // Deliberately WRONG/absent rangeId values on every staged unit: if pairing were still
      // keyed off rangeId, this would scramble or collapse the result differently. The point of
      // this fix is that pairSlices() no longer reads rangeId for spans at all, so the grouping
      // below must be identical regardless of what rangeId says.
      const stagedUnits = await Promise.all(
        stagedNames.map(async (name, i) => ({
          unit: name.replace(/\.md$/, ''),
          slicePath: name,
          rangeId: i % 2 === 0 ? undefined : '999-999',
          text: await readFixture(`${game}/staged/${name}`),
        })),
      );
      const pairs = pairSlices({ liveSlices, stagedUnits });
      const paired = pairs.filter((p) => p.kind === 'paired');
      expect(paired).toHaveLength(1);
      expect(paired[0].liveSlices).toHaveLength(liveNames.length);
      expect(paired[0].stagedUnits).toHaveLength(stagedNames.length);
      return { liveCount: liveNames.length, stagedNames };
    }

    // seven: 3 live rule slices, 6 staged units — one bridging staged file (01-about-and-setup.md,
    // p.1-2) unions the p.1 live/staged cluster with the p.2 live/staged cluster into one group.
    const seven = await pairGame('seven', [
      '01-definitions-and-components.md',
      '01-overview-setup-and-play.md',
      '02-solo-variant.md',
    ]);
    expect(seven.stagedNames.length).toBe(6);

    // one-two-punch: 2 live rule slices, 6 staged units — TWO bridging staged files
    // (01-round-structure.md and 02-punch-examples-discard.md both explicitly say "continues on
    // p.2" / "begun on p.1" in their own prose) union the split into one group here too.
    const otp = await pairGame('one-two-punch', [
      '01-setup-and-round-structure.md',
      '02-action-cards-and-resolution.md',
    ]);
    expect(otp.stagedNames.length).toBe(6);
  });

  it('pairing-3c (corrective): the mechanism itself CAN produce finer per-page groups — it is the real fixtures\' genuine cross-page prose, not a pairSlices() limitation, that collapses seven/one-two-punch to one group', () => {
    // No bridging unit here (unlike the real fixtures): every span is confined to a single page,
    // so the same union-find algorithm correctly reports TWO groups, proving the collapse above is
    // a fact about the real archived content, not something pairSlices() cannot avoid.
    const liveSlices = [
      { path: 'rulebook/a.md', text: 'p.1, A:\n"one"\n' },
      { path: 'rulebook/b.md', text: 'p.2, B:\n"two"\n' },
    ];
    const stagedUnits = [
      { unit: 'u1', slicePath: 'u1.md', text: 'p.1, A:\n"one restated"\n' },
      { unit: 'u2', slicePath: 'u2.md', text: 'p.2, B:\n"two restated"\n' },
    ];
    const pairs = pairSlices({ liveSlices, stagedUnits });
    const paired = pairs.filter((p) => p.kind === 'paired');
    expect(paired).toHaveLength(2);
    expect(paired.map((p) => p.span).sort((a, b) => a.first - b.first)).toEqual([
      { first: 1, last: 1 },
      { first: 2, last: 2 },
    ]);
  });

  it('pairing-4: a live slice whose span overlaps nothing staged, and a staged range overlapping nothing live, are both reported as unpaired-slice — never dropped', () => {
    const liveSlices = [
      { path: 'rulebook/03-only-live.md', text: 'p.3, Something:\n"A live-only rule."\n' },
    ];
    const stagedUnits = [
      { unit: '09-only-staged', slicePath: '09-only-staged.md', rangeId: '9-9', text: 'p.9, Something else:\n"A staged-only rule."\n' },
    ];
    const pairs = pairSlices({ liveSlices, stagedUnits });
    expect(pairs).toHaveLength(2);
    const staleFinding = pairs.find((p) => p.liveSlices.length > 0);
    const liveMissing = pairs.find((p) => p.stagedUnits.length > 0);
    expect(staleFinding).toMatchObject({ kind: 'unpaired-slice', missingSide: 'staged-missing' });
    expect(liveMissing).toMatchObject({ kind: 'unpaired-slice', missingSide: 'live-missing' });
  });

  it('pairing-5: pairId is stable across repeated calls and shuffled input order', () => {
    const liveSlices = [
      { path: 'rulebook/a.md', text: 'p.1, A:\n"one"\n' },
      { path: 'rulebook/b.md', text: 'p.2, B:\n"two"\n' },
    ];
    const stagedUnits = [
      { unit: 'u1', slicePath: 'u1.md', rangeId: '1-1', text: 'p.1, A:\n"one restated"\n' },
      { unit: 'u2', slicePath: 'u2.md', rangeId: '2-2', text: 'p.2, B:\n"two restated"\n' },
    ];

    const first = pairSlices({ liveSlices, stagedUnits });
    const second = pairSlices({ liveSlices, stagedUnits });
    expect(first.map((p) => p.pairId).sort()).toEqual(second.map((p) => p.pairId).sort());

    const shuffled = pairSlices({
      liveSlices: [liveSlices[1], liveSlices[0]],
      stagedUnits: [stagedUnits[1], stagedUnits[0]],
    });
    expect(shuffled.map((p) => p.pairId).sort()).toEqual(first.map((p) => p.pairId).sort());

    for (const pairId of first.map((p) => p.pairId)) {
      const groupA = first.find((p) => p.pairId === pairId)!;
      const groupB = shuffled.find((p) => p.pairId === pairId)!;
      expect(new Set(groupA.liveSlices)).toEqual(new Set(groupB.liveSlices));
      expect(new Set(groupA.stagedUnits)).toEqual(new Set(groupB.stagedUnits));
    }
  });

  it('pairing-6: a group whose every side is presentation-only is reported with kind presentation-only, never silently skipped', () => {
    const liveSlices = [
      {
        path: 'rulebook/00-visual-only.md',
        text:
          'p.4, Cover:\n' +
          'Derived (p.4) — diagram description: A purely decorative layout note.\n',
      },
    ];
    const stagedUnits = [
      {
        unit: '00-visual-only-staged',
        slicePath: '00-visual-only-staged.md',
        rangeId: '4-4',
        text: 'p.4, Cover:\nVisual (p.4): The same purely decorative layout, restated.\n',
      },
    ];
    const pairs = pairSlices({ liveSlices, stagedUnits });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      kind: 'presentation-only',
      liveRuleBearingLines: 0,
      stagedRuleBearingLines: 0,
    });
  });

  it('pairing-7: a staged unit with no derivable p.N page span (rangeId is irrelevant post-fix) is reported as its own unpaired-slice group, never dropped', () => {
    const liveSlices = [{ path: 'rulebook/a.md', text: 'p.1, A:\n"one"\n' }];
    const stagedUnits = [
      { unit: 'u1', slicePath: 'u1.md', rangeId: '1-1', text: 'p.1, A:\n"one restated"\n' },
      { unit: 'orphan', slicePath: 'orphan.md', rangeId: '1-1', text: 'Some content with no p.N citation at all.\n' },
    ];
    const pairs = pairSlices({ liveSlices, stagedUnits });
    const orphanGroup = pairs.find((p) => p.stagedUnits.includes('orphan'));
    expect(orphanGroup).toMatchObject({ kind: 'unpaired-slice', missingSide: 'live-missing' });
    expect(orphanGroup!.stagedUnits).toEqual(['orphan']);
  });

  it('PAIR_KINDS is the frozen three-member enum', () => {
    expect(Object.isFrozen(PAIR_KINDS)).toBe(true);
    expect([...PAIR_KINDS]).toEqual(['paired', 'presentation-only', 'unpaired-slice']);
  });
});

// -------------------------------------------------------------------------------------------
// provenance (Task 3)
// -------------------------------------------------------------------------------------------

/** A fixture project with an archived source, INDEX.md, and one real live slice, in a temp dir. */
async function provenanceProject(): Promise<{ project: string; liveSliceRel: string; sourceHash: string }> {
  const project = join(dir, 'game');
  const rulebookDir = join(project, 'rulebook');
  const sourceDir = join(rulebookDir, 'source');
  await fs.mkdir(sourceDir, { recursive: true });

  const sourceBytes = Buffer.from('a fake but stable archived rulebook source\n');
  const sourceHash = sha256(sourceBytes);
  await fs.writeFile(join(sourceDir, 'rules.pdf'), sourceBytes);

  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: 'game',
      edition: undefined,
      archivedPath: 'rulebook/source/rules.pdf',
      sourceHash,
      transcribed: '2026-07-29',
    }),
  );

  const liveSliceName = '01-setup-and-round-structure.md';
  const liveText = await readFixture(`one-two-punch/live/${liveSliceName}`);
  await fs.writeFile(join(rulebookDir, liveSliceName), liveText);

  return { project, liveSliceRel: `rulebook/${liveSliceName}`, sourceHash };
}

/** Writes `chunks/<slug>/CHUNK.md` citing `citedSlice` and recording `recordedSourceHash` (or none). */
async function writeCitingChunk(
  project: string,
  slug: string,
  citedSlice: string,
  recordedSourceHash: string | undefined,
): Promise<void> {
  const chunkDir = join(project, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });
  const body = renderVerifiedAgainst({
    scope: SCOPE_FULL,
    edition: 'none recorded',
    sourceHash: recordedSourceHash,
    boardsmithVersion: '9.9.9',
    skillsTreeHash: 'deadbeef',
    citedSlices: [],
    unresolved: [],
  });
  const chunkText =
    `# ${slug}\n\nCites ${citedSlice}.\n\n` +
    `${VERIFIED_AGAINST_HEADING}\n\n${VERIFIED_AGAINST_BEGIN}${body}${VERIFIED_AGAINST_END}\n`;
  await fs.writeFile(join(chunkDir, 'CHUNK.md'), chunkText);
}


describe('provenance — three states, hash-only, never the subagent\'s opinion', () => {
  it('provenance-1: a chunk recording the CURRENT hash resolves to source-unchanged', async () => {
    const { project, liveSliceRel, sourceHash } = await provenanceProject();
    await writeCitingChunk(project, 'setup', liveSliceRel, sourceHash);

    const result = await resolveProvenance(project, [liveSliceRel]);
    expect(result.provenance).toBe('source-unchanged');
    expect(result.recordedHashes).toEqual([sourceHash]);
  });

  it('provenance-2: a chunk recording a DIFFERING hash resolves to source-changed', async () => {
    const { project, liveSliceRel } = await provenanceProject();
    await writeCitingChunk(project, 'setup', liveSliceRel, 'deadbeefdeadbeef');

    const result = await resolveProvenance(project, [liveSliceRel]);
    expect(result.provenance).toBe('source-changed');
    expect(result.recordedHashes).toEqual(['deadbeefdeadbeef']);
  });

  it('provenance-3: no citing chunk records a source hash — resolves to unknown, never source-unchanged by default', async () => {
    const { project, liveSliceRel } = await provenanceProject();
    // A chunk exists but cites nothing and records no hash — the actual current state of both
    // reference games (174-RESEARCH.md: neither has a recorded Source hash: line anywhere).
    await writeCitingChunk(project, 'unrelated', 'rulebook/some-other-slice.md', undefined);

    const result = await resolveProvenance(project, [liveSliceRel]);
    expect(result.provenance).toBe('unknown');
    expect(result.recordedHashes).toEqual([]);
  });

  it('provenance-4: two citing chunks recording different hashes, at least one differing from current, resolves to source-changed and names every recorded hash', async () => {
    const { project, liveSliceRel, sourceHash } = await provenanceProject();
    await writeCitingChunk(project, 'setup-a', liveSliceRel, sourceHash);
    await writeCitingChunk(project, 'setup-b', liveSliceRel, 'stalehash0000000');

    const result = await resolveProvenance(project, [liveSliceRel]);
    expect(result.provenance).toBe('source-changed');
    expect(result.recordedHashes.sort()).toEqual([sourceHash, 'stalehash0000000'].sort());
  });

  it('provenance-5: a project with no archived source at all resolves to unknown with a reason, and does not throw', async () => {
    const project = join(dir, 'bare');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    // No INDEX.md at all.
    const result = await resolveProvenance(project, ['rulebook/whatever.md']);
    expect(result.provenance).toBe('unknown');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('provenance-6 (SC-4 structural): the provenance result cannot be passed to deriveStale, and the staleness call site passes only a rule delta', async () => {
    const { project, liveSliceRel, sourceHash } = await provenanceProject();
    await writeCitingChunk(project, 'setup', liveSliceRel, sourceHash);
    const result = await resolveProvenance(project, [liveSliceRel]);
    expect(deriveStale.length).toBe(1);
    // @ts-expect-error — a ProvenanceResult is not a RuleDelta; this must not typecheck.
    expect(() => deriveStale(result)).not.toThrow();

    const src = await fs.readFile(join(__dirname, 'verify-classify.ts'), 'utf-8');
    expect(src).not.toMatch(/deriveStale\([^)]*provenance/i);
  });

  it('PROVENANCE_KINDS is the frozen three-state enum', () => {
    expect(Object.isFrozen(PROVENANCE_KINDS)).toBe(true);
    expect([...PROVENANCE_KINDS]).toEqual(['source-changed', 'source-unchanged', 'unknown']);
  });
});
