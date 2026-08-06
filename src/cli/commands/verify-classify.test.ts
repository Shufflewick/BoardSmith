import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  PROVENANCE_KINDS,
  RULE_DELTA_KINDS,
  PRESENTATION_EXCLUSION_MARKERS,
  PAIR_KINDS,
  RULE_DELTA_SEVERITY,
  CITATION_ANCHOR_RUNGS,
  CHUNK_ATTRIBUTION_WARNING_KINDS,
  MIN_FRAGMENT_CHARS,
  isPresentationLine,
  ruleBearingLines,
  deriveStale,
  livePageSpan,
  pairSlices,
  resolveProvenance,
  parseClaimCitationAnchors,
  matchedLiveLine,
  citedPageForLine,
  resolveCitationAttribution,
  verifyClassifyPairsCommand,
  verifyClassifyRecordCommand,
  verifyClassifyStatusCommand,
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
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  ledgerFilePath,
  parseLedgerBody,
  resolveLedgerState,
  RUN_LEDGER_BEGIN,
  RUN_LEDGER_END,
} from './verify-run.js';

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
          /^Derived \(p\.\d+\) — diagram description(?: \([^)]+\))?:/i.test(l) ||
          /^Derived \(p\.\d+\) — art(?: \([^)]+\))?:/i.test(l),
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
      '^Visual \\(p\\.\\d+\\)(?: \\([^:]*\\))?:',
      '^Derived \\(p\\.\\d+\\) — diagram description(?: \\([^:]*\\))?:',
      '^Derived \\(p\\.\\d+\\) — art(?: \\([^:]*\\))?:',
    ]);
  });

  // 177-08 (closing WR-09): the qualifier group was applied to the two Derived markers but not
  // to Visual, and `[^)]+` could never match a qualifier with its own nested parens. Both fixed
  // symmetrically, pinned together with the 4 real decision-13 lines so neither fix regresses
  // the other.
  it('presentation-7: Visual (p.N) with a parenthetical qualifier is now recognized as presentation — the Visual/Derived asymmetry WR-09 named', () => {
    expect(isPresentationLine('Visual (p.1) (Plan phase): A diagram of the play area.')).toBe(
      true,
    );
  });

  it('presentation-8: a Derived — art qualifier containing its own nested parentheses is recognized as presentation — [^:]* is nesting-tolerant where [^)]+ was not', () => {
    expect(
      isPresentationLine(
        'Derived (p.1) — art (see fig. (a)): A stylized illustration of the box.',
      ),
    ).toBe(true);
  });

  it('presentation-9: the 4 real decision-13 one-two-punch lines still match after the symmetry/nesting fix', async () => {
    const setupText = await readFixture('one-two-punch/live/01-setup-and-round-structure.md');
    const actionText = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    const qualifiedLines = [...setupText.split('\n'), ...actionText.split('\n')]
      .map((l) => l.trim())
      .filter((l) => /^Derived \(p\.\d+\) — (?:diagram description|art) \([^)]+\):/.test(l));
    expect(qualifiedLines).toHaveLength(4);
    for (const line of qualifiedLines) {
      expect(isPresentationLine(line)).toBe(true);
    }
  });

  it('presentation-10: a genuinely rule-bearing Derived line is still not presentation after the fix', () => {
    expect(
      isPresentationLine(
        'Derived (p.1): The box contains 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, and 1 Rules Sheet.',
      ),
    ).toBe(false);
  });

  it('presentation-5: the 4 real one-two-punch lines carrying a parenthetical qualifier are recognized as presentation, read from the fixture not retyped', async () => {
    const setupText = await readFixture('one-two-punch/live/01-setup-and-round-structure.md');
    const actionText = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    const qualifiedLines = [...setupText.split('\n'), ...actionText.split('\n')]
      .map((l) => l.trim())
      .filter(
        (l) =>
          /^Derived \(p\.\d+\) — (?:diagram description|art) \([^)]+\):/.test(l),
      );
    // 177-RESEARCH.md / 177-CONTEXT.md decision 13: exactly 4 real lines carry a parenthetical
    // qualifier — (Plan phase), (Fight phase), (first Punch example), (second Punch example).
    expect(qualifiedLines).toHaveLength(4);
    for (const line of qualifiedLines) {
      expect(isPresentationLine(line)).toBe(true);
    }
  });

  it('presentation-6 (negative, no-over-exclusion): the widened constant newly excludes exactly the 4 real parenthetical-qualified lines and nothing else, across every Derived (p. line in both games\' live fixtures', async () => {
    const OLD_MARKERS = [
      '^Visual \\(p\\.\\d+\\):',
      '^Derived \\(p\\.\\d+\\) — diagram description:',
      '^Derived \\(p\\.\\d+\\) — art:',
    ];
    const oldIsPresentationLine = (line: string): boolean =>
      OLD_MARKERS.some((source) => new RegExp(source, 'i').test(line));

    const gameFiles: Record<string, string[]> = {
      seven: await listFixtureFiles('seven/live'),
      'one-two-punch': await listFixtureFiles('one-two-punch/live'),
    };

    const newlyExcluded: string[] = [];
    let sevenDerivedCount = 0;
    let sevenDerivedRemainNonPresentation = true;

    for (const [game, files] of Object.entries(gameFiles)) {
      for (const file of files) {
        const text = await readFixture(`${game}/live/${file}`);
        const derivedLines = text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /^Derived \(p\.\d+\)/.test(l));
        for (const line of derivedLines) {
          if (game === 'seven') {
            sevenDerivedCount++;
            if (isPresentationLine(line)) sevenDerivedRemainNonPresentation = false;
          }
          const wasExcluded = oldIsPresentationLine(line);
          const nowExcluded = isPresentationLine(line);
          if (nowExcluded && !wasExcluded) newlyExcluded.push(line);
        }
      }
    }

    expect(newlyExcluded).toHaveLength(4);
    for (const line of newlyExcluded) {
      expect(
        /^Derived \(p\.\d+\) — (?:diagram description|art) \([^)]+\):/.test(line),
      ).toBe(true);
    }
    // seven has zero dash-qualified lines (177-CONTEXT.md Measured Reality) — all 10 of its
    // Derived lines remain non-presentation.
    expect(sevenDerivedCount).toBe(10);
    expect(sevenDerivedRemainNonPresentation).toBe(true);
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
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
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
  const chunkDir = join(project, DESIGN_DIR, 'chunks', slug);
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
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook'), { recursive: true });
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

// -------------------------------------------------------------------------------------------
// verify-classify-pairs (Task 1) — a real recorded run against the real `seven` fixture
// -------------------------------------------------------------------------------------------

const SEVEN_LIVE_FILES = [
  '00-visual-survey.md',
  '01-definitions-and-components.md',
  '01-overview-setup-and-play.md',
  '02-solo-variant.md',
];
const SEVEN_STAGED_FILES = [
  '01-about-and-setup.md',
  '01-definitions.md',
  '01-distribution-of-cards.md',
  '01-game-end-and-match.md',
  '01-round.md',
  '02-solo-variant.md',
];

/**
 * A real project — real `rulebook/*.md` live tree from the archived `seven` fixture, and a real
 * recorded `verify-run` (init + record, the actual commands, never hand-written ledger JSON) whose
 * staged units are the real archived `seven` staged fixture files. Returns the project dir, the
 * run-id, and the absolute staging dir so a test can additionally corrupt/omit a staged file.
 */
async function recordedSevenRun(opts?: {
  /** Recorded normally, then the staged file is DELETED afterward (crash/tamper simulation). */
  deleteAfterRecording?: string[];
  skipRecordingUnits?: string[];
}): Promise<{ project: string; runId: string; stagingDirAbs: string }> {
  const project = join(dir, 'game');
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  for (const name of SEVEN_LIVE_FILES) {
    const text = await readFixture(`seven/live/${name}`);
    await fs.writeFile(join(rulebookDir, name), text);
  }

  const initResult = await verifyRunInitCommand({ project, json: true });
  const runId = initResult.runId;
  const stagingDirAbs = join(project, initResult.stagingDir);

  const deleteAfter = new Set(opts?.deleteAfterRecording ?? []);
  const skipRecord = new Set(opts?.skipRecordingUnits ?? []);
  for (const name of SEVEN_STAGED_FILES) {
    const text = await readFixture(`seven/staged/${name}`);
    await fs.writeFile(join(stagingDirAbs, name), text);
    const unit = name.replace(/\.md$/, '');
    if (skipRecord.has(name)) continue;
    await verifyRunRecordCommand({ project, runId, unit, slice: name, range: '1-2', json: true });
    if (deleteAfter.has(name)) {
      await fs.rm(join(stagingDirAbs, name));
    }
  }

  return { project, runId, stagingDirAbs };
}

describe('verifyClassifyPairsCommand — enumerate pairs with provenance, over a real recorded run', () => {
  it('pairs-1: every pair carries live/staged arrays and rule-bearing counts; provenance is a sibling map keyed identically', async () => {
    const { project, runId } = await recordedSevenRun();
    const result = await verifyClassifyPairsCommand({ project, runId, json: true });

    expect(result.pairs.length).toBeGreaterThan(0);
    for (const pair of result.pairs) {
      expect(pair).toHaveProperty('pairId');
      expect(pair).toHaveProperty('kind');
      expect(Array.isArray(pair.liveSlices)).toBe(true);
      expect(Array.isArray(pair.stagedSlices)).toBe(true);
      expect(Array.isArray(pair.stagedUnits)).toBe(true);
      expect(typeof pair.liveRuleBearingLines).toBe('number');
      expect(typeof pair.stagedRuleBearingLines).toBe('number');
      // Provenance is NOT a field on the pair object itself.
      expect(pair).not.toHaveProperty('provenance');
    }

    expect(Object.keys(result.provenance).sort()).toEqual(result.pairs.map((p) => p.pairId).sort());
    for (const p of result.pairs) {
      expect(result.provenance[p.pairId]).toHaveProperty('provenance');
      expect(result.provenance[p.pairId]).toHaveProperty('recordedHashes');
    }

    // The real seven fixture collapses to one paired group (174-03-SUMMARY.md's corrective
    // follow-up) carrying all 3 rule-bearing live slices and all 6 staged units.
    const paired = result.pairs.filter((p) => p.kind === 'paired');
    expect(paired).toHaveLength(1);
    expect(paired[0].liveSlices.sort()).toEqual(
      [
        'rulebook/01-definitions-and-components.md',
        'rulebook/01-overview-setup-and-play.md',
        'rulebook/02-solo-variant.md',
      ].sort(),
    );
    expect(paired[0].stagedUnits).toHaveLength(6);
  });

  it('pairs-2: a staged file present on disk but NOT recorded in the ledger never appears in any pair; a recorded unit whose file is missing is reported as a warning, never silently dropped', async () => {
    const { project, runId } = await recordedSevenRun({ skipRecordingUnits: ['02-solo-variant.md'] });
    const result = await verifyClassifyPairsCommand({ project, runId, json: true });

    const allStagedUnitsSeen = result.pairs.flatMap((p) => p.stagedUnits);
    expect(allStagedUnitsSeen).not.toContain('02-solo-variant');

    const { runId: runId2, project: project2 } = await recordedSevenRun({
      deleteAfterRecording: ['01-round.md'],
    });
    const result2 = await verifyClassifyPairsCommand({ project: project2, runId: runId2, json: true });
    expect(result2.warnings.some((w) => w.includes('01-round') && w.includes('not found'))).toBe(true);
    // Reported, not dropped: the recorded-but-missing unit still surfaces somewhere in the pair set.
    const allUnitsSeen2 = result2.pairs.flatMap((p) => p.stagedUnits);
    expect(allUnitsSeen2).toContain('01-round');
  });

  it('pairs-3: unpaired-slice and presentation-only groups carry kind/missingSide and roll up into summary', async () => {
    const project = join(dir, 'edge');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(join(rulebookDir, '03-only-live.md'), 'p.3, Something:\n"A live-only rule."\n');
    await fs.writeFile(
      join(rulebookDir, '04-visual-only.md'),
      'p.4, Cover:\nDerived (p.4) — diagram description: A purely decorative note.\n',
    );

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, '09-only-staged.md'),
      'p.9, Something else:\n"A staged-only rule."\n',
    );
    await verifyRunRecordCommand({
      project,
      runId,
      unit: '09-only-staged',
      slice: '09-only-staged.md',
      json: true,
    });
    await fs.writeFile(
      join(stagingDirAbs, '04-visual-only-staged.md'),
      'p.4, Cover:\nVisual (p.4): The same decorative layout, restated.\n',
    );
    await verifyRunRecordCommand({
      project,
      runId,
      unit: '04-visual-only-staged',
      slice: '04-visual-only-staged.md',
      json: true,
    });

    const result = await verifyClassifyPairsCommand({ project, runId, json: true });
    const unpaired = result.pairs.filter((p) => p.kind === 'unpaired-slice');
    const presentationOnly = result.pairs.filter((p) => p.kind === 'presentation-only');
    expect(unpaired.length).toBeGreaterThan(0);
    expect(presentationOnly.length).toBeGreaterThan(0);
    for (const p of unpaired) expect(p.missingSide).toBeDefined();
    expect(result.summary.unpaired).toBe(unpaired.length);
    expect(result.summary.presentationOnly).toBe(presentationOnly.length);
  });

  it('pairs-4: a --live-slice path escaping rulebook/ is refused with an actionable error naming the offending value', async () => {
    const { project, runId } = await recordedSevenRun();
    await expect(
      verifyClassifyPairsCommand({ project, runId, liveSlice: '../../etc/passwd', json: true }),
    ).rejects.toThrow(/\.\.\/\.\.\/etc\/passwd/);
  });

  it('pairs-5: an unknown --run-id is an actionable tool failure listing the runs that DO exist; a normal call with findings resolves without throwing', async () => {
    const { project, runId } = await recordedSevenRun();
    await expect(
      verifyClassifyPairsCommand({ project, runId: '2020-01-01T00-00-00Z', json: true }),
    ).rejects.toThrow(/No verify run/);

    // A run with findings (unpaired-slice/presentation-only groups) still resolves — decision 7:
    // findings exit 0, never a thrown tool failure.
    await expect(verifyClassifyPairsCommand({ project, runId, json: true })).resolves.toBeTruthy();
  });
});

// -------------------------------------------------------------------------------------------
// verify-classify-record (Task 2) — one verdict, atomically appended, stale/provenance derived
// -------------------------------------------------------------------------------------------

async function ledgerBody(project: string, runId: string): Promise<string> {
  const ledgerFile = ledgerFilePath(project, runId);
  const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
  return ledgerText.slice(
    ledgerText.indexOf(RUN_LEDGER_BEGIN) + RUN_LEDGER_BEGIN.length,
    ledgerText.indexOf(RUN_LEDGER_END),
  );
}

describe('verifyClassifyRecordCommand — one verdict, atomically appended, stale/provenance derived', () => {
  it('ledger-1: recording cosmetic appends exactly one classification line inside the fences, stale:false, provenance derived', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'cosmetic',
      evidence: 'every consequence identical',
      json: true,
    });
    expect(result.record.kind).toBe('classification');
    expect(result.record.pairId).toBe(pairId);
    expect(result.record.ruleDelta).toBe('cosmetic');
    expect(result.record.stale).toBe(false);
    expect(typeof result.record.provenance).toBe('string');

    const body = await ledgerBody(project, runId);
    const classificationLines = body
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .filter((l) => JSON.parse(l).kind === 'classification');
    expect(classificationLines).toHaveLength(1);
  });

  it('ledger-2: sharper and contradictory both record stale:true', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const sharper = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'Live text one.',
      quotedPass2: 'Staged text one.',
      json: true,
    });
    expect(sharper.record.ruleDelta).toBe('sharper');
    expect(sharper.record.stale).toBe(true);

    const contradictory = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'contradictory',
      quotedPass1: 'Live text two.',
      quotedPass2: 'Staged text two.',
      json: true,
    });
    expect(contradictory.record.ruleDelta).toBe('contradictory');
    expect(contradictory.record.stale).toBe(true);
  });

  it('unclassified-1: an out-of-enum --label records unclassified/stale, warns naming the received value verbatim, never throws', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'maybe-cosmetic?',
      json: true,
    });
    expect(result.record.ruleDelta).toBe('unclassified');
    expect(result.record.stale).toBe(true);
    expect(result.warnings.some((w) => w.includes('maybe-cosmetic?'))).toBe(true);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('maybe-cosmetic?'))).toBe(true);
    errSpy.mockRestore();
  });

  it('unclassified-2: a missing --label behaves identically to an out-of-enum label, never defaulting to cosmetic', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({ project, runId, pairId, json: true });
    expect(result.record.ruleDelta).toBe('unclassified');
    expect(result.record.stale).toBe(true);
  });

  it('unclassified-3: sharper with an empty --quoted-pass1 demotes to unclassified, naming quotedPass1', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: '   ',
      quotedPass2: 'Staged text.',
      json: true,
    });
    expect(result.record.ruleDelta).toBe('unclassified');
    expect(result.record.stale).toBe(true);
    expect(result.warnings.some((w) => w.includes('quotedPass1'))).toBe(true);
  });

  it('unclassified-4: contradictory with a non-empty pass1 but empty --quoted-pass2 demotes to unclassified, naming quotedPass2', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'contradictory',
      quotedPass1: 'Live text.',
      json: true,
    });
    expect(result.record.ruleDelta).toBe('unclassified');
    expect(result.record.stale).toBe(true);
    expect(result.warnings.some((w) => w.includes('quotedPass2'))).toBe(true);
  });

  it('unclassified-5: cosmetic with both quotes empty stays cosmetic — the quote requirement is scoped to sharper/contradictory only', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({ project, runId, pairId, label: 'cosmetic', json: true });
    expect(result.record.ruleDelta).toBe('cosmetic');
    expect(result.record.stale).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('ledger-3: pre-existing ledger content is byte-identical before/after, except for the one added line', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;
    const bodyBefore = await ledgerBody(project, runId);

    await verifyClassifyRecordCommand({ project, runId, pairId, label: 'cosmetic', json: true });

    const bodyAfter = await ledgerBody(project, runId);
    expect(bodyAfter.startsWith(bodyBefore)).toBe(true);
    const added = bodyAfter.slice(bodyBefore.length);
    expect(added.trim().length).toBeGreaterThan(0);
    expect(JSON.parse(added.trim()).kind).toBe('classification');
  });

  it('ledger-4: re-recording the same pairId appends a second line; resolveLedgerState reports only the newer verdict', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    await verifyClassifyRecordCommand({ project, runId, pairId, label: 'cosmetic', json: true });
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'Live text.',
      quotedPass2: 'Staged text.',
      json: true,
    });

    const body = await ledgerBody(project, runId);
    const classificationLines = body
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .filter((l) => JSON.parse(l).kind === 'classification');
    expect(classificationLines).toHaveLength(2);

    const ledgerFile = ledgerFilePath(project, runId);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const relLedgerPath = ledgerFile;
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { classifications } = resolveLedgerState(lines);
    const resolved = classifications.find((c) => c.pairId === pairId);
    expect(resolved?.ruleDelta).toBe('sharper');
  });

  it('ledger-5: an unknown --pair-id is a tool failure with an actionable error listing valid pair ids', async () => {
    const { project, runId } = await recordedSevenRun();
    await expect(
      verifyClassifyRecordCommand({ project, runId, pairId: 'pages-99-99', label: 'cosmetic', json: true }),
    ).rejects.toThrow(/pages-99-99/);
  });

  it('ledger-6: there is no CLI option through which stale or provenance can be supplied — passing them has no effect on the derived values', async () => {
    const { project, runId } = await recordedSevenRun();
    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    const result = await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'cosmetic',
      json: true,
      // @ts-expect-error — stale/provenance are not part of the options interface.
      stale: true,
      // @ts-expect-error — stale/provenance are not part of the options interface.
      provenance: 'source-changed',
    });
    // A forced stale:true was ignored — cosmetic still derives to stale:false.
    expect(result.record.stale).toBe(false);

    const src = await fs.readFile(join(__dirname, 'verify-classify.ts'), 'utf-8');
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/options\.stale\b/);
    expect(code).not.toMatch(/options\.provenance\b/);
  });
});

// -------------------------------------------------------------------------------------------
// verify-classify-status + per-chunk verdict roll-up (Task 3, decisions 11 and 18)
// -------------------------------------------------------------------------------------------

/**
 * A hand-built project with THREE independent, non-bridging single-page paired groups
 * (pages-1-1/2-2/3-3), one presentation-only group (pages-4-4), and one unpaired-slice live-only
 * group (pages-5-5) — deliberately NOT the real `seven`/`one-two-punch` fixtures, which collapse
 * to one group each (174-03-SUMMARY.md's corrective follow-up) and so cannot exercise a
 * multi-group `status`/`pendingPairs` scenario. Returns the project, run-id, and each group's
 * `pairId` for direct classification in a test.
 */
async function threeGroupProject(): Promise<{
  project: string;
  runId: string;
  pairIdA: string;
  pairIdB: string;
  pairIdC: string;
  pairIdPresentation: string;
  pairIdUnpaired: string;
}> {
  const project = join(dir, 'edge3');
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  await fs.writeFile(join(rulebookDir, 'a.md'), 'p.1, A:\n"Rule A live text."\n');
  await fs.writeFile(join(rulebookDir, 'b.md'), 'p.2, B:\n"Rule B live text."\n');
  await fs.writeFile(join(rulebookDir, 'c.md'), 'p.3, C:\n"Rule C live text."\n');
  await fs.writeFile(
    join(rulebookDir, 'd.md'),
    'p.4, D:\nDerived (p.4) — diagram description: A purely decorative note.\n',
  );
  await fs.writeFile(join(rulebookDir, 'e.md'), 'p.5, E:\n"Rule E live text, unpaired."\n');

  const initResult = await verifyRunInitCommand({ project, json: true });
  const runId = initResult.runId;
  const stagingDirAbs = join(project, initResult.stagingDir);

  async function recordStaged(unit: string, file: string, text: string): Promise<void> {
    await fs.writeFile(join(stagingDirAbs, file), text);
    await verifyRunRecordCommand({ project, runId, unit, slice: file, json: true });
  }
  await recordStaged('ua', 'ua.md', 'p.1, A:\n"Rule A staged text."\n');
  await recordStaged('ub', 'ub.md', 'p.2, B:\n"Rule B staged text."\n');
  await recordStaged('uc', 'uc.md', 'p.3, C:\n"Rule C staged text."\n');
  await recordStaged('ud', 'ud.md', 'p.4, D:\nVisual (p.4): The same decorative layout, restated.\n');

  const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
  const byLive = (name: string) =>
    pairsResult.pairs.find((p) => p.liveSlices.includes(`rulebook/${name}`))!.pairId;

  return {
    project,
    runId,
    pairIdA: byLive('a.md'),
    pairIdB: byLive('b.md'),
    pairIdC: byLive('c.md'),
    pairIdPresentation: byLive('d.md'),
    pairIdUnpaired: byLive('e.md'),
  };
}

/** Writes `chunks/<slug>/CHUNK.md` with plain prose citing every `rulebook/<name>` in `citedNames`. */
async function writeChunkCiting(project: string, slug: string, citedNames: string[]): Promise<void> {
  const chunkDir = join(project, DESIGN_DIR, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });
  const citations = citedNames.map((n) => `Cites rulebook/${n}.`).join('\n');
  await fs.writeFile(join(chunkDir, 'CHUNK.md'), `# ${slug}\n\n${citations}\n`);
}

/**
 * Writes `chunks/<slug>/CHUNK.md` with a top-level citation line (for the main
 * `resolveCitedSlices` pass) AND a real `## Interpretation` section body (decision 19's
 * claim-level anchors) — for tests that need per-citation attribution, not just slice-level.
 */
async function writeChunkCitingWithInterpretation(
  project: string,
  slug: string,
  citedNames: string[],
  interpretationBody: string,
): Promise<void> {
  const chunkDir = join(project, DESIGN_DIR, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });
  const citations = citedNames.map((n) => `Cites rulebook/${n}.`).join('\n');
  await fs.writeFile(
    join(chunkDir, 'CHUNK.md'),
    `# ${slug}\n\n${citations}\n\n## Interpretation\n${interpretationBody}\n\n## Visibility Declaration\nnone\n`,
  );
}

describe('verifyClassifyStatusCommand — pending pairs, summary counts, resume-safety', () => {
  it('status-1: three pairs, one recorded — pendingPairs holds the two unrecorded ids, classified holds the one recorded verdict', async () => {
    const { project, runId, pairIdA } = await threeGroupProject();
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdA, label: 'cosmetic', json: true });

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    expect(result.pendingPairs).toHaveLength(2);
    expect(result.classified).toHaveLength(1);
    expect(result.classified[0].pairId).toBe(pairIdA);
  });

  it('status-2: presentation-only and unpaired-slice groups are excluded from pendingPairs but reported in summary', async () => {
    const { project, runId, pairIdPresentation, pairIdUnpaired } = await threeGroupProject();
    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    expect(result.pendingPairs).not.toContain(pairIdPresentation);
    expect(result.pendingPairs).not.toContain(pairIdUnpaired);
    expect(result.summary.presentationOnly).toBe(1);
    expect(result.summary.unpaired).toBe(1);
  });

  it('status-3: cosmeticPct is computed over classified verdicts on paired, rule-bearing pairs only — presentation-only never enters numerator or denominator', async () => {
    const { project, runId, pairIdA, pairIdB, pairIdC } = await threeGroupProject();
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdA, label: 'cosmetic', json: true });
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdB, label: 'cosmetic', json: true });
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: pairIdC,
      label: 'contradictory',
      quotedPass1: 'Rule C live text.',
      quotedPass2: 'Rule C staged text.',
      json: true,
    });

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    // 2 cosmetic out of 3 classified paired-rule-bearing pairs = 66.7%. The presentation-only
    // group (pages-4-4) was never classified nor counted here.
    expect(result.summary.cosmeticPct).toBeCloseTo(66.7, 1);
    expect(result.summary.contradictory).toBe(1);
  });

  it('status-4: a run with findings (unpaired slices, unclassified, non-zero contradictory) resolves without throwing — only a tool failure is non-zero', async () => {
    const { project, runId, pairIdC } = await threeGroupProject();
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: pairIdC,
      label: 'contradictory',
      quotedPass1: 'Rule C live text.',
      quotedPass2: 'Rule C staged text.',
      json: true,
    });
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdC, label: 'bogus-label', json: true });
    await expect(verifyClassifyStatusCommand({ project, runId, json: true })).resolves.toBeTruthy();

    await expect(
      verifyClassifyStatusCommand({ project, runId: '2020-01-01T00-00-00Z', json: true }),
    ).rejects.toThrow();
  });

  it('status-5: two successive calls over an unchanged ledger return identical results', async () => {
    const { project, runId, pairIdA } = await threeGroupProject();
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdA, label: 'cosmetic', json: true });
    const first = await verifyClassifyStatusCommand({ project, runId, json: true });
    const second = await verifyClassifyStatusCommand({ project, runId, json: true });
    expect(second).toEqual(first);
  });
});

describe('per-chunk verdict roll-up (VERIFY-01) — decision 18: line-level attribution, not group verdict', () => {
  it('chunk-1: chunk A cites a live slice in a sharper pair and is stale; chunk B cites only a cosmetic pair and is not stale', async () => {
    const { project, runId, pairIdA, pairIdB } = await threeGroupProject();
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: pairIdA,
      label: 'sharper',
      quotedPass1: 'Rule A live text.',
      quotedPass2: 'Rule A staged text.',
      json: true,
    });
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdB, label: 'cosmetic', json: true });

    await writeChunkCiting(project, 'chunk-a', ['a.md']);
    await writeChunkCiting(project, 'chunk-b', ['b.md']);

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const a = result.chunkVerdicts.find((c) => c.slug === 'chunk-a')!;
    const b = result.chunkVerdicts.find((c) => c.slug === 'chunk-b')!;
    expect(a.stale).toBe(true);
    expect(a.ruleDelta).toBe('sharper');
    expect(a.pairIds).toContain(pairIdA);
    expect(b.stale).toBe(false);
    expect(b.ruleDelta).toBe('cosmetic');
  });

  it('chunk-1b: a chunk citing several pairs rolls up to MAX severity — contradictory > sharper > cosmetic, unclassified beats cosmetic', async () => {
    const { project, runId, pairIdA, pairIdB, pairIdC } = await threeGroupProject();

    // Escalating case: sharper, then adding contradictory — both cited by the SAME chunk from the
    // start, so the roll-up is re-measured as more of what it cites gets classified.
    await writeChunkCiting(project, 'escalate', ['a.md', 'b.md', 'c.md']);

    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdA, label: 'cosmetic', json: true });
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: pairIdB,
      label: 'sharper',
      quotedPass1: 'Rule B live text.',
      quotedPass2: 'Rule B staged text.',
      json: true,
    });
    const afterSharper = await verifyClassifyStatusCommand({ project, runId, json: true });
    const escalateAfterSharper = afterSharper.chunkVerdicts.find((c) => c.slug === 'escalate')!;
    expect(escalateAfterSharper.ruleDelta).toBe('sharper');
    expect(escalateAfterSharper.stale).toBe(true);
    expect(new Set(escalateAfterSharper.pairIds)).toEqual(new Set([pairIdA, pairIdB]));

    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId: pairIdC,
      label: 'contradictory',
      quotedPass1: 'Rule C live text.',
      quotedPass2: 'Rule C staged text.',
      json: true,
    });
    const afterContradictory = await verifyClassifyStatusCommand({ project, runId, json: true });
    const escalateAfterContradictory = afterContradictory.chunkVerdicts.find(
      (c) => c.slug === 'escalate',
    )!;
    expect(escalateAfterContradictory.ruleDelta).toBe('contradictory');
    expect(new Set(escalateAfterContradictory.pairIds)).toEqual(new Set([pairIdA, pairIdB, pairIdC]));

    // Independent mix: cosmetic + unclassified — decision 8: unclassified always beats cosmetic,
    // since a malformed/blind verdict can never be reported clean.
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.writeFile(join(rulebookDir, 'g.md'), 'p.7, G:\n"Rule G live text."\n');
    const stagingDirAbs = join(
      project,
      (await verifyRunInitCommand({ project, runId, json: true })).stagingDir,
    );
    await fs.writeFile(join(stagingDirAbs, 'ug.md'), 'p.7, G:\n"Rule G staged text."\n');
    await verifyRunRecordCommand({ project, runId, unit: 'ug', slice: 'ug.md', json: true });
    const pairsAfterG = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairIdG = pairsAfterG.pairs.find((p) => p.liveSlices.includes('rulebook/g.md'))!.pairId;
    // No --label at all — normalizes to unclassified (decision 8), never guessed as cosmetic.
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdG, json: true });

    await writeChunkCiting(project, 'mixed', ['a.md', 'g.md']);
    const finalStatus = await verifyClassifyStatusCommand({ project, runId, json: true });
    const mixed = finalStatus.chunkVerdicts.find((c) => c.slug === 'mixed')!;
    expect(mixed.ruleDelta).toBe('unclassified');
    expect(mixed.stale).toBe(true);
    expect(RULE_DELTA_SEVERITY.unclassified).toBeGreaterThan(RULE_DELTA_SEVERITY.cosmetic);
  });

  it('chunk-2: a chunk citing a live slice in an unpaired-slice group is reported unclassified — nothing was ever compared for it', async () => {
    const { project, runId, pairIdUnpaired } = await threeGroupProject();
    await writeChunkCiting(project, 'chunk-e', ['e.md']);
    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const e = result.chunkVerdicts.find((c) => c.slug === 'chunk-e')!;
    expect(e.ruleDelta).toBe('unclassified');
    expect(e.stale).toBe(true);
    expect(e.pairIds).toContain(pairIdUnpaired);
  });

  it('chunk-3: no CHUNK.md/SKETCH.md file is written or modified by verify-classify-status or verify-classify-record', async () => {
    const { project, runId, pairIdA } = await threeGroupProject();
    await writeChunkCiting(project, 'chunk-a', ['a.md']);

    async function hashAll(): Promise<Map<string, string>> {
      const map = new Map<string, string>();
      async function walk(current: string): Promise<void> {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            map.set(full, createHash('sha256').update(await fs.readFile(full)).digest('hex'));
          }
        }
      }
      await walk(project);
      return map;
    }

    const before = await hashAll();
    await verifyClassifyStatusCommand({ project, runId, json: true });
    await verifyClassifyRecordCommand({ project, runId, pairId: pairIdA, label: 'cosmetic', json: true });
    await verifyClassifyStatusCommand({ project, runId, json: true });
    const after = await hashAll();

    for (const [path, hash] of before) {
      if (path.includes('CHUNK.md') || path.includes('SKETCH.md')) {
        expect(after.get(path)).toBe(hash);
      }
    }
    // The ledger IS expected to change (that's the record write); assert no CHUNK.md/SKETCH.md
    // file appeared that did not exist before, either.
    for (const path of after.keys()) {
      if (path.includes('CHUNK.md') || path.includes('SKETCH.md')) {
        expect(before.has(path)).toBe(true);
      }
    }
  });

  it('decision-18: two chunks citing the SAME pair group, where a sharper delta intersects only the first chunk\'s cited live slice — the first chunk is stale, the second is NOT (the phase goal in miniature)', async () => {
    const project = join(dir, 'bridge');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(join(rulebookDir, 'x.md'), 'p.8, X:\n"X original text."\n');
    await fs.writeFile(join(rulebookDir, 'y.md'), 'p.8, Y:\n"Y original text."\n');

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, 'uxy.md'),
      'p.8, XY:\n"X changed text."\n"Y original text restated."\n',
    );
    await verifyRunRecordCommand({ project, runId, unit: 'uxy', slice: 'uxy.md', json: true });

    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    expect(pairsResult.pairs).toHaveLength(1);
    const pairId = pairsResult.pairs[0].pairId;
    expect(pairsResult.pairs[0].liveSlices.sort()).toEqual(['rulebook/x.md', 'rulebook/y.md']);

    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'X original text.',
      quotedPass2: 'X changed text.',
      json: true,
    });

    await writeChunkCiting(project, 'chunk-x', ['x.md']);
    await writeChunkCiting(project, 'chunk-y', ['y.md']);

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const chunkX = result.chunkVerdicts.find((c) => c.slug === 'chunk-x')!;
    const chunkY = result.chunkVerdicts.find((c) => c.slug === 'chunk-y')!;
    expect(chunkX.stale).toBe(true);
    expect(chunkX.ruleDelta).toBe('sharper');
    expect(chunkX.pairIds).toContain(pairId);
    expect(chunkY.stale).toBe(false);
    expect(chunkY.ruleDelta).toBe('cosmetic');
    expect(chunkY.pairIds).not.toContain(pairId);
    // Case (a) narrowing is proven correct, not just "not over-broadened" — no unattributable
    // warning fires here, since the quote DID land on a live slice in the pair (just not chunk-y's).
    expect(result.warnings.some((w) => w.includes('unattributable') || w.includes('does not match verbatim'))).toBe(
      false,
    );
  });

  it('decision-18-corrective-a: quote matches NO live slice in the pair at all — every citing chunk is stale AND the unattributable condition is reported (FALSE-CLEAN closed)', async () => {
    const project = join(dir, 'bridge-unattributable');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(join(rulebookDir, 'x.md'), 'p.8, X:\n"X original text."\n');
    await fs.writeFile(join(rulebookDir, 'y.md'), 'p.8, Y:\n"Y original text."\n');

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, 'uxy.md'),
      'p.8, XY:\n"X changed text."\n"Y original text restated."\n',
    );
    await verifyRunRecordCommand({ project, runId, unit: 'uxy', slice: 'uxy.md', json: true });

    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    // A paraphrased "quote" that matches neither x.md nor y.md verbatim — the subagent summarized
    // instead of quoting, which the code cannot tell apart from a genuinely blind attribution
    // without checking the whole pair first.
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'The rule about X was tightened somewhat.',
      quotedPass2: 'X changed text.',
      json: true,
    });

    await writeChunkCiting(project, 'chunk-x', ['x.md']);
    await writeChunkCiting(project, 'chunk-y', ['y.md']);

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const chunkX = result.chunkVerdicts.find((c) => c.slug === 'chunk-x')!;
    const chunkY = result.chunkVerdicts.find((c) => c.slug === 'chunk-y')!;
    // Unattributable — broadened conservatively, NOT silently absorbed. Both citing chunks go stale.
    expect(chunkX.stale).toBe(true);
    expect(chunkX.ruleDelta).toBe('sharper');
    expect(chunkY.stale).toBe(true);
    expect(chunkY.ruleDelta).toBe('sharper');
    expect(
      result.warnings.some(
        (w) => w.includes(pairId) && w.includes('does not match verbatim') && w.includes('sharper'),
      ),
    ).toBe(true);
  });

  it('decision-18-corrective-b: a cited live slice that cannot be read is surfaced and treated conservatively, never silently reported clean', async () => {
    const project = join(dir, 'bridge-unreadable');
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(join(rulebookDir, 'x.md'), 'p.8, X:\n"X original text."\n');
    await fs.writeFile(join(rulebookDir, 'y.md'), 'p.8, Y:\n"Y original text."\n');

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, 'uxy.md'),
      'p.8, XY:\n"X changed text."\n"Y original text restated."\n',
    );
    await verifyRunRecordCommand({ project, runId, unit: 'uxy', slice: 'uxy.md', json: true });

    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    // Quote matches x.md verbatim — under normal narrowing chunk-y (citing only y.md) would NOT be
    // affected (case a). Simulate y.md becoming unreadable at the moment computeChunkVerdicts
    // re-reads it: it must never be silently treated as "read fine, matched nothing".
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'X original text.',
      quotedPass2: 'X changed text.',
      json: true,
    });

    await writeChunkCiting(project, 'chunk-y', ['y.md']);

    const yPath = join(rulebookDir, 'y.md');
    const originalReadFile = fs.readFile;
    let yReadCount = 0;
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
        const [target] = args;
        if (target === yPath) {
          yReadCount += 1;
          // Let the FIRST read (computeRunPairs building the pair/page-span set) succeed so
          // pairing itself is unaffected; fail every subsequent read (computeChunkVerdicts'
          // independent re-read) to simulate the slice going unreadable in between.
          if (yReadCount === 1) return originalReadFile(...args);
          throw new Error(`EACCES: permission denied, open '${yPath}' (simulated)`);
        }
        return originalReadFile(...args);
      }) as typeof fs.readFile);

    try {
      const result = await verifyClassifyStatusCommand({ project, runId, json: true });
      const chunkY = result.chunkVerdicts.find((c) => c.slug === 'chunk-y')!;
      expect(chunkY.stale).toBe(true);
      expect(chunkY.ruleDelta).toBe('sharper');
      expect(
        result.warnings.some((w) => w.includes(pairId) && w.includes('could not be read')),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('decision-19 — claim-level citation anchors (parseClaimCitationAnchors)', () => {
  // Transcribed verbatim 2026-07-30 from the REAL
  // ~/BoardSmithGames/one-two-punch/chunks/second-action-resolution/CHUNK.md `## Interpretation`
  // section (claims 1-4 plus the file's own carried-citations guidance comment) — never invented.
  const SECOND_ACTION_RESOLUTION_INTERPRETATION = `<!-- Numbered list of factual claims this chunk's design rests on, each with a citation into
     the rulebook (via INDEX.md) or RULINGS.md. Every agent that reads a rulebook slice
     (investigate, redteam, audit) also reads RULINGS.md — the rulebook plus RULINGS.md together
     form the composite source of truth. Append new claims as investigate discovers them; never
     renumber existing claims.

     Cited slices carried from the SKETCH.md tail entry when this chunk was detailed (investigate
     confirms and expands these):
       - rulebook/01-setup-and-round-structure.md — "2) Fight" (timing comparison / resolution order)
       - rulebook/02-action-cards-and-resolution.md — second-action resolution procedure
         ("When you are done comparing and resolving the first action cards, DO NOT discard them
         yet. Leave them in place and flip the second action cards face up. Then, compare and
         resolve the second action cards just like you did with the first action cards.") and the
         Tips bullet "the first set of action cards are always completely resolved before the
         second set of action cards." -->

1. **A round's Fight phase resolves TWO sets of action cards — first, then second — and the second set only reveals and resolves after the first set is fully resolved.** This chunk builds the SECOND set's reveal and resolution; the first set's reveal/resolution machinery already exists. — cites rulebook/02-action-cards-and-resolution.md, Fight-phase continuation under REST (p.2): "When you are done comparing and resolving the first action cards, DO NOT discard them yet. Leave them in place and flip the second action cards face up. Then, compare and resolve the second action cards just like you did with the first action cards."

2. **The boundary between the two sets is exact and printed:** once the first action cards are done resolving, they are (a) NOT discarded, (b) left in place, and (c) the second action cards are flipped face up — and only then compared and resolved. — cites rulebook/02, Fight-phase continuation under REST (p.2), quoted in full at claim 1.

3. **The first set of action cards is ALWAYS completely resolved before the second set** — the two sets are strictly sequential, never interleaved by timing. — cites rulebook/02, Tips bullet 5 (p.2): "In the fight phase, the first set of action cards are always completely resolved before the second set of action cards. For example, a Block from the first action will not stop a Punch from the second action."

4. **The second set is resolved by the SAME procedure as the first**: both players flip their second action cards face up together, timings are compared, the lower timing resolves first, and equal timings resolve simultaneously. — cites rulebook/02, Fight-phase continuation under REST (p.2): "compare and resolve the second action cards just like you did with the first action cards"; and rulebook/01-setup-and-round-structure.md, "2) Fight" (p.1): "You and your opponent must flip your first action card face up at the same time and compare their timings to determine the order they are resolved." / "The player with the lower timing on their card must resolve their action first. If the timing is the same on both cards, they are resolved at the same time."`;

  const SLICE_FILENAMES = [
    '01-setup-and-round-structure.md',
    '02-action-cards-and-resolution.md',
  ];

  it('decision-19-anchors-1: claim 4 of the REAL second-action-resolution chunk resolves both cited slices, pages 1 and 2, and the verbatim "lower timing" fragment', () => {
    const chunkText = `# Chunk: second-action-resolution\n\n## Interpretation\n${SECOND_ACTION_RESOLUTION_INTERPRETATION}\n`;
    const anchors = parseClaimCitationAnchors(chunkText, SLICE_FILENAMES);
    expect(anchors.slices).toEqual(
      ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'].map(
        (n) => `rulebook/${n}`,
      ),
    );
    expect(anchors.pages).toEqual([1, 2]);
    expect(anchors.fragments.some((f) => f.includes('lower timing'))).toBe(true);
  });

  it('decision-19-anchors-2: a rulebook/ token, a (p.N), and a "quoted" fragment placed in Redteam Rounds / Findings Ledger / an HTML comment above the claim list contribute nothing', () => {
    const chunkText = [
      '# Chunk: noise-test',
      '',
      '## Interpretation',
      '<!-- example anchor that must NOT be parsed: rulebook/noise.md (p.99): "this is inside an HTML comment and must be ignored entirely" -->',
      '',
      '1. **A real claim with no anchor at all.** Nothing cited here.',
      '',
      '## Redteam Rounds',
      'Discusses rulebook/noise.md (p.99): "this text is outside Interpretation and must be ignored".',
      '',
      '## Findings Ledger',
      'References rulebook/noise.md (p.99) again: "also outside Interpretation, also ignored".',
      '',
    ].join('\n');
    const anchors = parseClaimCitationAnchors(chunkText, ['noise.md']);
    expect(anchors.slices).toEqual([]);
    expect(anchors.pages).toEqual([]);
    expect(anchors.fragments).toEqual([]);
  });

  it('decision-19-anchors-3: a claim that quotes verbatim rulebook text but names no rulebook/ token still yields that fragment (the `seven` shape) — fragments are not gated on a co-located slice token', () => {
    const chunkText = [
      '# Chunk: seven-shape',
      '',
      '## Interpretation',
      '1. **Bonus point cards score at Game End.** "the text does not define its scoring effect beyond Game End instruction to add bonus point cards to your score" (p.1)',
      '',
    ].join('\n');
    const anchors = parseClaimCitationAnchors(chunkText, ['01-definitions-and-components.md']);
    expect(anchors.slices).toEqual([]);
    expect(anchors.pages).toEqual([1]);
    expect(
      anchors.fragments.some((f) =>
        f.includes('the text does not define its scoring effect'),
      ),
    ).toBe(true);
  });

  it('decision-19-anchors-4: short scraps are rejected — a "+1"-length quoted token never becomes an anchor', () => {
    const chunkText = [
      '# Chunk: short-scrap',
      '',
      '## Interpretation',
      '1. **Bonus cards show a "+1" marker.** cites rulebook/x.md (p.1): a black "+1" card.',
      '',
    ].join('\n');
    const anchors = parseClaimCitationAnchors(chunkText, ['x.md']);
    expect(anchors.fragments).toEqual([]);
    expect(MIN_FRAGMENT_CHARS).toBeGreaterThan('+1'.length);
  });
});

describe('decision-19 — matchedLiveLine / citedPageForLine', () => {
  it('decision-19-line-1: matchedLiveLine finds the single line containing a quote (incl. mid-line substring), citedPageForLine reads an inline page or the nearest preceding header', () => {
    const sliceText = [
      'p.3, Round Structure:',
      '"The player with the lower timing on their card must resolve their action first."',
      'Derived (p.4): a later, unrelated line.',
    ].join('\n');

    expect(matchedLiveLine(sliceText, 'lower timing on their card must resolve')).toBe(
      '"The player with the lower timing on their card must resolve their action first."',
    );
    expect(matchedLiveLine(sliceText, 'a phrase that appears nowhere')).toBeUndefined();

    const quotedLine = matchedLiveLine(sliceText, 'lower timing on their card must resolve')!;
    expect(citedPageForLine(sliceText, quotedLine)).toBe(3);

    const derivedLine = 'Derived (p.4): a later, unrelated line.';
    expect(citedPageForLine(sliceText, derivedLine)).toBe(4);
  });
});

describe('decision-19 — resolveCitationAttribution (the deterministic 3-rung ladder)', () => {
  it('decision-19-rung-1: a fragment overlapping the delta line attributes; fragments present for the slice but none overlapping do not attribute, with a reason naming the non-overlap', () => {
    const liveSliceText = '"The lower timing resolves first."\n"An unrelated sentence."';
    const overlapping = resolveCitationAttribution({
      liveSlice: 'rulebook/x.md',
      liveSliceText,
      deltaLine: '"The lower timing resolves first."',
      deltaLinePage: 1,
      anchors: { slices: [], pages: [], fragments: ['The lower timing resolves first.'] },
    });
    expect(overlapping).toEqual({
      attributed: true,
      rung: 'quoted-fragment',
      reason: expect.stringContaining('overlaps'),
    });

    const nonOverlapping = resolveCitationAttribution({
      liveSlice: 'rulebook/x.md',
      liveSliceText,
      deltaLine: '"The lower timing resolves first."',
      deltaLinePage: 1,
      anchors: { slices: [], pages: [], fragments: ['An unrelated sentence.'] },
    });
    expect(nonOverlapping.attributed).toBe(false);
    expect(nonOverlapping.rung).toBe('quoted-fragment');
    expect(nonOverlapping.reason).toEqual(expect.stringContaining('none overlaps'));
  });

  it('decision-19-rung-2: no fragments for the slice but cited pages present — attributed iff the delta line\'s page is in the cited page set, reason names both pages', () => {
    const liveSliceText = '"Some sentence with no matching fragment anywhere."';
    const attributed = resolveCitationAttribution({
      liveSlice: 'rulebook/x.md',
      liveSliceText,
      deltaLine: '"Some sentence with no matching fragment anywhere."',
      deltaLinePage: 1,
      anchors: { slices: [], pages: [1, 2], fragments: [] },
    });
    expect(attributed).toEqual({
      attributed: true,
      rung: 'cited-page',
      reason: expect.stringContaining('1'),
    });

    const notAttributed = resolveCitationAttribution({
      liveSlice: 'rulebook/x.md',
      liveSliceText,
      deltaLine: '"Some sentence with no matching fragment anywhere."',
      deltaLinePage: 3,
      anchors: { slices: [], pages: [1, 2], fragments: [] },
    });
    expect(notAttributed.attributed).toBe(false);
    expect(notAttributed.rung).toBe('cited-page');
    expect(notAttributed.reason).toEqual(expect.stringContaining('1, 2'));
    expect(notAttributed.reason).toEqual(expect.stringContaining('3'));
  });

  it('decision-19-rung-3: neither fragments nor pages for that slice — slice-fallback, always attributed, reason names the unresolved anchor', () => {
    const result = resolveCitationAttribution({
      liveSlice: 'rulebook/x.md',
      liveSliceText: '"Some sentence."',
      deltaLine: '"Some sentence."',
      deltaLinePage: undefined,
      anchors: { slices: [], pages: [], fragments: [] },
    });
    expect(result).toEqual({
      attributed: true,
      rung: 'slice-fallback',
      reason: expect.stringContaining('could be resolved'),
    });
  });
});

describe('decision-19-enum-1 (pin): CITATION_ANCHOR_RUNGS and CHUNK_ATTRIBUTION_WARNING_KINDS are frozen arrays, asserted member-for-member', () => {
  it('is frozen and exactly the three deterministic rungs, in order', () => {
    expect(Object.isFrozen(CITATION_ANCHOR_RUNGS)).toBe(true);
    expect([...CITATION_ANCHOR_RUNGS]).toEqual(['quoted-fragment', 'cited-page', 'slice-fallback']);
  });

  it('is frozen and exactly the three enumerated warning kinds', () => {
    expect(Object.isFrozen(CHUNK_ATTRIBUTION_WARNING_KINDS)).toBe(true);
    expect([...CHUNK_ATTRIBUTION_WARNING_KINDS]).toEqual([
      'unattributable-quote',
      'unreadable-live-slice',
      'unresolved-citation',
    ]);
  });
});

describe('decision-19 — wiring into computeChunkVerdicts: per-citation narrowing + both guardrails outrank it', () => {
  async function onePairTwoSliceProject(): Promise<{
    project: string;
    runId: string;
    pairId: string;
  }> {
    const project = join(dir, `decision19-${Math.random().toString(36).slice(2)}`);
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(
      join(rulebookDir, 'x.md'),
      'p.1, X:\n"The lower timing on their card resolves first."\n"A second, unrelated live line."\n',
    );
    await fs.writeFile(
      join(rulebookDir, 'y.md'),
      'p.1, Y:\n"A second, unrelated live line." (restated on the y side)\n',
    );

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, 'uxy.md'),
      'p.1, XY:\n"The lower timing on their card resolves first, staged." "A second, unrelated live line, staged."\n',
    );
    await verifyRunRecordCommand({ project, runId, unit: 'uxy', slice: 'uxy.md', json: true });

    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;

    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'The lower timing on their card resolves first.',
      quotedPass2: 'The lower timing on their card resolves first, staged.',
      json: true,
    });

    return { project, runId, pairId };
  }

  it('decision-19-narrow-1: two chunks citing the SAME live slice land on DIFFERENT staleness — chunk A quotes the changed line, chunk B quotes a different line of the same slice (impossible under decision 18 alone)', async () => {
    const { project, runId, pairId } = await onePairTwoSliceProject();

    await writeChunkCitingWithInterpretation(
      project,
      'chunk-a',
      ['x.md'],
      '1. **A quotes the exact changed line.** "The lower timing on their card resolves first." (p.1)',
    );
    await writeChunkCitingWithInterpretation(
      project,
      'chunk-b',
      ['x.md'],
      '1. **B quotes a different line of the same slice.** "A second, unrelated live line." (p.1)',
    );

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const a = result.chunkVerdicts.find((c) => c.slug === 'chunk-a')!;
    const b = result.chunkVerdicts.find((c) => c.slug === 'chunk-b')!;

    expect(a.stale).toBe(true);
    const aAttr = a.attributions.find((att) => att.pairId === pairId && att.liveSlice === 'rulebook/x.md')!;
    expect(aAttr.rung).toBe('quoted-fragment');
    expect(aAttr.attributed).toBe(true);

    expect(b.stale).toBe(false);
    const bAttr = b.attributions.find((att) => att.pairId === pairId && att.liveSlice === 'rulebook/x.md')!;
    expect(bAttr.rung).toBe('quoted-fragment');
    expect(bAttr.attributed).toBe(false);
    expect(bAttr.reason.length).toBeGreaterThan(0);
  });

  it('decision-19-narrow-2: page-anchored — chunk A cites (p.1), chunk B cites only (p.2), neither quotes anything; the delta line is on p.1 — A stale via cited-page, B clean via cited-page', async () => {
    const project = join(dir, `decision19-page-${Math.random().toString(36).slice(2)}`);
    const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(join(rulebookDir, 'x.md'), 'p.1, X:\nDerived (p.1): x original derived line.\n');

    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;
    const stagingDirAbs = join(project, initResult.stagingDir);
    await fs.writeFile(
      join(stagingDirAbs, 'ux.md'),
      'p.1, X:\nDerived (p.1): x changed derived line.\n',
    );
    await verifyRunRecordCommand({ project, runId, unit: 'ux', slice: 'ux.md', json: true });

    const pairsResult = await verifyClassifyPairsCommand({ project, runId, json: true });
    const pairId = pairsResult.pairs[0].pairId;
    await verifyClassifyRecordCommand({
      project,
      runId,
      pairId,
      label: 'sharper',
      quotedPass1: 'Derived (p.1): x original derived line.',
      quotedPass2: 'Derived (p.1): x changed derived line.',
      json: true,
    });

    await writeChunkCitingWithInterpretation(
      project,
      'chunk-a',
      ['x.md'],
      '1. **A cites page 1, no quote.** general reference (p.1)',
    );
    await writeChunkCitingWithInterpretation(
      project,
      'chunk-b',
      ['x.md'],
      '1. **B cites only page 2, no quote.** general reference (p.2)',
    );

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const a = result.chunkVerdicts.find((c) => c.slug === 'chunk-a')!;
    const b = result.chunkVerdicts.find((c) => c.slug === 'chunk-b')!;

    expect(a.stale).toBe(true);
    expect(a.attributions.find((att) => att.pairId === pairId)?.rung).toBe('cited-page');
    expect(b.stale).toBe(false);
    expect(b.attributions.find((att) => att.pairId === pairId)?.rung).toBe('cited-page');
  });

  it('decision-19-guard-1: a chunk with an Interpretation section carrying NO usable anchor still goes stale via slice-fallback, AND an [unresolved-citation] warning names the chunk and slice', async () => {
    const { project, runId, pairId } = await onePairTwoSliceProject();

    await writeChunkCitingWithInterpretation(
      project,
      'chunk-no-anchor',
      ['x.md'],
      '1. **A claim with no page and no quoted fragment at all.**',
    );

    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const chunk = result.chunkVerdicts.find((c) => c.slug === 'chunk-no-anchor')!;
    expect(chunk.stale).toBe(true);
    const attribution = chunk.attributions.find(
      (att) => att.pairId === pairId && att.liveSlice === 'rulebook/x.md',
    )!;
    expect(attribution.rung).toBe('slice-fallback');
    expect(attribution.attributed).toBe(true);
    expect(
      result.warnings.some(
        (w) => w.includes('[unresolved-citation]') && w.includes('chunk-no-anchor') && w.includes('x.md'),
      ),
    ).toBe(true);
  });

  it('decision-19-guard-2: the pair-level blindness checks (unattributable quote, unreadable slice) still broaden to stale and still warn even with claim-level anchors present and non-overlapping — they outrank the ladder', async () => {
    // Unattributable quote shape (174-04 corrective-a), with a chunk carrying an Interpretation
    // section whose claim anchors do NOT overlap — rung 1 would say "not attributed" if the ladder
    // ran, but it must never run here: the pair-level check fires first.
    const projectA = join(dir, `decision19-guard2a-${Math.random().toString(36).slice(2)}`);
    const rulebookDirA = join(projectA, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDirA, { recursive: true });
    await fs.writeFile(join(rulebookDirA, 'x.md'), 'p.8, X:\n"X original text."\n');
    await fs.writeFile(join(rulebookDirA, 'y.md'), 'p.8, Y:\n"Y original text."\n');
    const initA = await verifyRunInitCommand({ project: projectA, json: true });
    const runIdA = initA.runId;
    await fs.writeFile(
      join(projectA, initA.stagingDir, 'uxy.md'),
      'p.8, XY:\n"X changed text."\n"Y original text restated."\n',
    );
    await verifyRunRecordCommand({ project: projectA, runId: runIdA, unit: 'uxy', slice: 'uxy.md', json: true });
    const pairsA = await verifyClassifyPairsCommand({ project: projectA, runId: runIdA, json: true });
    const pairIdA = pairsA.pairs[0].pairId;
    await verifyClassifyRecordCommand({
      project: projectA,
      runId: runIdA,
      pairId: pairIdA,
      label: 'sharper',
      // Paraphrased — matches neither x.md nor y.md verbatim (case (b), unattributable).
      quotedPass1: 'The rule about X was tightened somewhat.',
      quotedPass2: 'X changed text.',
      json: true,
    });
    await writeChunkCitingWithInterpretation(
      projectA,
      'chunk-x',
      ['x.md'],
      '1. **A claim whose anchor cannot possibly overlap the never-matched quote.** "Something entirely different and unrelated to X." (p.1)',
    );
    const resultA = await verifyClassifyStatusCommand({ project: projectA, runId: runIdA, json: true });
    const chunkX = resultA.chunkVerdicts.find((c) => c.slug === 'chunk-x')!;
    expect(chunkX.stale).toBe(true);
    expect(
      resultA.warnings.some((w) => w.includes('[unattributable-quote]') && w.includes(pairIdA)),
    ).toBe(true);
    // The ladder never ran for this pair on this chunk — no attribution entry was pushed at all.
    expect(chunkX.attributions.filter((att) => att.pairId === pairIdA)).toHaveLength(0);

    // Unreadable-slice shape (174-04 corrective-b).
    const projectB = join(dir, `decision19-guard2b-${Math.random().toString(36).slice(2)}`);
    const rulebookDirB = join(projectB, DESIGN_DIR, 'rulebook');
    await fs.mkdir(rulebookDirB, { recursive: true });
    await fs.writeFile(join(rulebookDirB, 'x.md'), 'p.8, X:\n"X original text."\n');
    await fs.writeFile(join(rulebookDirB, 'y.md'), 'p.8, Y:\n"Y original text."\n');
    const initB = await verifyRunInitCommand({ project: projectB, json: true });
    const runIdB = initB.runId;
    await fs.writeFile(
      join(projectB, initB.stagingDir, 'uxy.md'),
      'p.8, XY:\n"X changed text."\n"Y original text restated."\n',
    );
    await verifyRunRecordCommand({ project: projectB, runId: runIdB, unit: 'uxy', slice: 'uxy.md', json: true });
    const pairsB = await verifyClassifyPairsCommand({ project: projectB, runId: runIdB, json: true });
    const pairIdB = pairsB.pairs[0].pairId;
    await verifyClassifyRecordCommand({
      project: projectB,
      runId: runIdB,
      pairId: pairIdB,
      label: 'sharper',
      quotedPass1: 'X original text.',
      quotedPass2: 'X changed text.',
      json: true,
    });
    await writeChunkCitingWithInterpretation(
      projectB,
      'chunk-y',
      ['y.md'],
      '1. **A claim citing y.md with an anchor that would not overlap x.md\'s quote anyway.** "Something entirely unrelated." (p.1)',
    );
    const yPath = join(rulebookDirB, 'y.md');
    const originalReadFile = fs.readFile;
    let yReadCount = 0;
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
        const [target] = args;
        if (target === yPath) {
          yReadCount += 1;
          if (yReadCount === 1) return originalReadFile(...args);
          throw new Error(`EACCES: permission denied, open '${yPath}' (simulated)`);
        }
        return originalReadFile(...args);
      }) as typeof fs.readFile);
    try {
      const resultB = await verifyClassifyStatusCommand({ project: projectB, runId: runIdB, json: true });
      const chunkY = resultB.chunkVerdicts.find((c) => c.slug === 'chunk-y')!;
      expect(chunkY.stale).toBe(true);
      expect(
        resultB.warnings.some((w) => w.includes('[unreadable-live-slice]') && w.includes(pairIdB)),
      ).toBe(true);
      expect(chunkY.attributions.filter((att) => att.pairId === pairIdB)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('decision-19-attrib-1: chunkVerdicts[].attributions[] carries one entry per (pairId, cited live slice) evaluated, each with a rung, attributed, and a non-empty reason', async () => {
    const { project, runId, pairId } = await onePairTwoSliceProject();
    await writeChunkCiting(project, 'chunk-a', ['x.md']); // no Interpretation section — fallback rung
    const result = await verifyClassifyStatusCommand({ project, runId, json: true });
    const a = result.chunkVerdicts.find((c) => c.slug === 'chunk-a')!;
    expect(a.attributions.length).toBeGreaterThan(0);
    for (const attribution of a.attributions) {
      expect(attribution.pairId).toBe(pairId);
      expect(CITATION_ANCHOR_RUNGS as readonly string[]).toContain(attribution.rung);
      expect(typeof attribution.attributed).toBe('boolean');
      expect(attribution.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('CLI registration — real entry point', () => {
  const execFileAsync = promisify(execFile);
  const __filename2 = fileURLToPath(import.meta.url);
  const REPO_ROOT = join(dirname(__filename2), '..', '..', '..');
  const CLI_BIN = join(REPO_ROOT, 'bin', 'boardsmith.js');

  async function spawnCli(
    args: string[],
    cwd: string = REPO_ROOT,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], { cwd });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  it('cli-1: all three commands\' --help exits 0 through the real entry point and names their documented options', async () => {
    const pairs = await spawnCli(['verify-classify-pairs', '--help']);
    expect(pairs.code).toBe(0);
    expect(pairs.stdout).toMatch(/--run-id/);
    expect(pairs.stdout).toMatch(/--json/);

    const record = await spawnCli(['verify-classify-record', '--help']);
    expect(record.code).toBe(0);
    expect(record.stdout).toMatch(/--pair-id/);
    expect(record.stdout).toMatch(/--label/);
    expect(record.stdout).toMatch(/--quoted-pass1/);
    expect(record.stdout).toMatch(/--quoted-pass2/);

    const status = await spawnCli(['verify-classify-status', '--help']);
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/--run-id/);
  }, 30000);

  it('cli-2: verify-classify-status --json run as a real child process prints parseable JSON and exits 0', async () => {
    const { project, runId } = await threeGroupProject();
    const result = await spawnCli(['verify-classify-status', '--project', project, '--run-id', runId, '--json']);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.runId).toBe(runId);
    expect(Array.isArray(parsed.pendingPairs)).toBe(true);
  }, 30000);
});
