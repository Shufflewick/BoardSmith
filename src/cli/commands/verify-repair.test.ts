import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  selectStaleChunks,
  resolveStagedSlicePaths,
  parseAuditRounds,
  planVerifyRunRound,
  appendAuditRoundHeading,
  writeAppendedAuditRound,
  verifyRepairRoundCommand,
  VERIFY_RUN_ROUND_BUDGET,
} from './verify-repair.js';
import { createProgram } from '../cli.js';
import { DESIGN_DIR, chunkMdPath } from '../lib/project-paths.js';
import {
  readLedgerOrThrow,
  parseLedgerBody,
  resolveLedgerState,
  ledgerFilePath,
  stagingSlicesDir,
  type ClassificationRecord,
} from './verify-run.js';
import type { ImpactMapEntry } from './verify-impact.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const FIXTURE_ROOT = join(
  __dirname,
  '..',
  '..',
  '..',
  '.planning',
  'phases',
  '175-impact-map-repair-gating',
  '175-FIXTURES',
  '174-07-contradictory',
  'staged',
);
// These tests read the fixture from disk; importing it links them to it (#1370).
import.meta.glob('/.planning/phases/175-impact-map-repair-gating/175-FIXTURES/**/*.md', { eager: true });

async function fixtureSha256Tree(dir: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const buf = await fs.readFile(abs);
        map[rel] = createHash('sha256').update(buf).digest('hex');
      }
    }
  }
  await walk(dir, '');
  return map;
}

/** Minimal `ImpactMapEntry` factory — every field required, with sane test defaults. */
function fakeEntry(overrides: Partial<ImpactMapEntry> & { slug: string }): ImpactMapEntry {
  return {
    slug: overrides.slug,
    ruleDelta: overrides.ruleDelta ?? 'sharper',
    stale: overrides.stale ?? true,
    status: overrides.status ?? 'verified',
    driftState: overrides.driftState ?? 'clean',
    changedFiles: overrides.changedFiles ?? [],
    missingFiles: overrides.missingFiles ?? [],
    pairIds: overrides.pairIds ?? [],
    attributions: overrides.attributions ?? [],
    gate: overrides.gate ?? {
      disposition: 'close-without-replaytest',
      nextStatus: 'verified',
      clearMarker: true,
      reason: 'test fixture gate',
    },
    markerState: overrides.markerState ?? 'rules-stale',
  };
}

// -------------------------------------------------------------------------------------------
// Task 1 — selectStaleChunks / resolveStagedSlicePaths
// -------------------------------------------------------------------------------------------

describe('stale-selection — selectStaleChunks', () => {
  it('returns only entries with stale === true from a mixed list', () => {
    const entries = [
      fakeEntry({ slug: 'a', stale: true }),
      fakeEntry({ slug: 'b', stale: false }),
      fakeEntry({ slug: 'c', stale: true }),
      fakeEntry({ slug: 'd', stale: false }),
    ];
    const result = selectStaleChunks(entries);
    expect(result.map((e) => e.slug)).toEqual(['a', 'c']);
  });
});

describe('staged-slice resolution — resolveStagedSlicePaths, over the real committed 174-07-contradictory fixture', () => {
  let root: string;
  let project: string;
  const runId = '2026-07-30T00-00-00Z';

  beforeEach(async () => {
    root = tempTree('bs-verify-repair-');
    project = join(root, 'game-project');
    await fs.mkdir(project, { recursive: true });
  });

  async function copyFixture(game: 'seven' | 'one-two-punch'): Promise<void> {
    const src = join(FIXTURE_ROOT, game);
    const dest = join(project, DESIGN_DIR, 'rulebook', '.verify', runId);
    await fs.mkdir(dest, { recursive: true });
    await fs.cp(src, dest, { recursive: true });
  }

  async function loadClassifications(): Promise<ClassificationRecord[]> {
    const ledgerFile = ledgerFilePath(project, runId);
    const ledgerText = await readLedgerOrThrow(ledgerFile, runId, project);
    const { lines } = parseLedgerBody(ledgerText, 'rulebook/.verify/' + runId + '/RUN.md');
    const { classifications } = resolveLedgerState(lines);
    return classifications;
  }

  it("real m:n fan-out: seven's one pairId (3 live rule slices) resolves to exactly its 6 staged filenames from the fixture", async () => {
    await copyFixture('seven');
    const classifications = await loadClassifications();
    expect(classifications).toHaveLength(1);
    expect(classifications[0].liveSlices).toHaveLength(3);
    expect(classifications[0].stagedSlices).toHaveLength(6);

    const stagedDir = stagingSlicesDir(project, runId);
    const entry = { slug: 'test-chunk', pairIds: [classifications[0].pairId] };
    const result = resolveStagedSlicePaths(entry, classifications, stagedDir);

    expect(result.scopeLimited).toBe(false);
    if (result.scopeLimited) throw new Error('unreachable');

    const fixtureSlices = (await fs.readdir(join(FIXTURE_ROOT, 'seven', 'slices'))).sort();
    expect(result.paths.map((p) => basename(p)).sort()).toEqual(fixtureSlices);
  });

  it('an unmatched pairId yields the scope-limited arm naming that pairId, and the success arm is not returned', async () => {
    await copyFixture('seven');
    const classifications = await loadClassifications();
    const stagedDir = stagingSlicesDir(project, runId);

    const entry = { slug: 'ghost-chunk', pairIds: ['pairId-that-does-not-exist'] };
    const result = resolveStagedSlicePaths(entry, classifications, stagedDir);

    expect(result.scopeLimited).toBe(true);
    if (!result.scopeLimited) throw new Error('unreachable');
    expect(result.unresolvedPairId).toBe('pairId-that-does-not-exist');
    expect(result.reason).toContain('pairId-that-does-not-exist');
    expect((result as unknown as { paths?: unknown }).paths).toBeUndefined();
  });

  it('every resolved path contains /.verify/ and none matches live-slice shape /(^|\\/)rulebook\\/\\d/', async () => {
    await copyFixture('seven');
    const classifications = await loadClassifications();
    const stagedDir = stagingSlicesDir(project, runId);
    const entry = { slug: 'test-chunk', pairIds: [classifications[0].pairId] };
    const result = resolveStagedSlicePaths(entry, classifications, stagedDir);

    expect(result.scopeLimited).toBe(false);
    if (result.scopeLimited) throw new Error('unreachable');
    expect(result.paths.length).toBeGreaterThan(0);
    for (const p of result.paths) {
      expect(p).toContain('/.verify/');
      expect(/(^|\/)rulebook\/\d/.test(p)).toBe(false);
    }
  });

  it("one-two-punch's staged resolution also resolves correctly (second real game, distinct m:n)", async () => {
    await copyFixture('one-two-punch');
    const classifications = await loadClassifications();
    expect(classifications.length).toBeGreaterThan(0);
    const stagedDir = stagingSlicesDir(project, runId);
    const record = classifications[0];
    const entry = { slug: 'otp-chunk', pairIds: [record.pairId] };
    const result = resolveStagedSlicePaths(entry, classifications, stagedDir);

    expect(result.scopeLimited).toBe(false);
    if (result.scopeLimited) throw new Error('unreachable');
    expect(result.paths).toHaveLength(record.stagedSlices.length);
  });

  it('originals byte-identical: the fixture on disk is never mutated by this test suite', async () => {
    const before = await fixtureSha256Tree(FIXTURE_ROOT);
    await copyFixture('seven');
    await loadClassifications();
    const after = await fixtureSha256Tree(FIXTURE_ROOT);
    expect(after).toEqual(before);
  });
});

// -------------------------------------------------------------------------------------------
// Task 2 — verify-episode round bookkeeping
// -------------------------------------------------------------------------------------------

const TABLE_AND_DRAW_ROUND_3 =
  '### Audit Round 3 (final round — `state-machine.md` "Repair Loop Bound": max 3)';
const BLOCK_ROUND_3 = '### Audit Round 3 (FINAL — the round bound is 3; state-machine.md "Repair Loop Bound")';
const JAB_ROUND_3 = '### Audit Round 3 (the last permitted — round bound is 3)';

function threeBuildRoundChunkMd(headingRound3: string): string {
  return (
    `# Chunk: test-chunk\n\nStatus: verified\n\n## Findings Ledger\n\n` +
    `### Audit Round 1\n\n| ID | ... |\n|---|---|\n| F1 | ... |\n\n` +
    `### Repair Round 1\n\nF1 fixed.\n\n` +
    `### Audit Round 2\n\n| ID | ... |\n|---|---|\n| F2 | ... |\n\n` +
    `### Repair Round 2\n\nF2 fixed.\n\n` +
    `${headingRound3}\n\n| ID | ... |\n|---|---|\n| F3 | ... |\n`
  );
}

describe('episode — parseAuditRounds finds all three real heading precedents plus a zero-round chunk', () => {
  it('finds 3 rounds with trailing parentheticals in a table-and-draw-shaped fixture', () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const rounds = parseAuditRounds(md);
    expect(rounds.map((r) => r.absolute)).toEqual([1, 2, 3]);
    expect(rounds[2].parenthetical).toBe('final round — `state-machine.md` "Repair Loop Bound": max 3');
  });

  it('finds 3 rounds in a block-shaped fixture', () => {
    const rounds = parseAuditRounds(threeBuildRoundChunkMd(BLOCK_ROUND_3));
    expect(rounds).toHaveLength(3);
    expect(rounds[2].parenthetical).toBe('FINAL — the round bound is 3; state-machine.md "Repair Loop Bound"');
  });

  it('finds 3 rounds in a jab-shaped fixture', () => {
    const rounds = parseAuditRounds(threeBuildRoundChunkMd(JAB_ROUND_3));
    expect(rounds).toHaveLength(3);
    expect(rounds[2].parenthetical).toBe('the last permitted — round bound is 3');
  });

  it('a zero-round chunk parses to an empty list', () => {
    const md = '# Chunk: fresh\n\nStatus: built\n\n## Findings Ledger\n\n_No rounds yet._\n';
    expect(parseAuditRounds(md)).toEqual([]);
  });
});

const RUN = '2026-10-20T10-00-00-000Z';
const EARLIER_RUN = '2026-10-01T09-00-00-000Z';

/** Open `run`'s next round in `md` and write a finding under it, as a dispatched lens would. */
function roundWithFindings(md: string, run: string): string {
  const plan = planVerifyRunRound(md, run);
  if (plan.disposition !== 'round') throw new Error(`expected a round for ${run}, got triage`);
  return appendAuditRoundHeading(md, plan.heading).replace(plan.heading, `${plan.heading}\n\n| F | a finding |`);
}

describe('round — planVerifyRunRound keys each round to its verify run (#1302)', () => {
  it("a 3-build-round chunk's first verify round is absolute 4, round 1 of 3 of this run", () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyRunRound(md, RUN);
    expect(plan.disposition).toBe('round');
    if (plan.disposition !== 'round') throw new Error('unreachable');
    expect(plan.absoluteRound).toBe(4);
    expect(plan.runId).toBe(RUN);
    expect(plan.runRound).toBe(1);
    expect(plan.alreadyOpen).toBe(false);
    expect(plan.heading).toBe(`### Audit Round 4 (verify-repair run ${RUN}, round 1 of 3)`);
  });

  it('a run that has used its 3 rounds is triaged, however many times it is asked: a resumed session gets no fresh budget', () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    for (let i = 0; i < VERIFY_RUN_ROUND_BUDGET; i++) md = roundWithFindings(md, RUN);
    for (let ask = 0; ask < 2; ask++) {
      const plan = planVerifyRunRound(md, RUN);
      expect(plan.disposition).toBe('triage');
      expect((plan as { heading?: string }).heading).toBeUndefined();
    }
  });

  it('a new run gets its own 3 rounds, whatever an earlier run used, more or fewer', () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    md = roundWithFindings(md, EARLIER_RUN);
    const afterOne = planVerifyRunRound(md, RUN);
    if (afterOne.disposition !== 'round') throw new Error('unreachable');
    expect(afterOne.runRound).toBe(1);

    for (let i = 1; i < VERIFY_RUN_ROUND_BUDGET; i++) md = roundWithFindings(md, EARLIER_RUN);
    const afterThree = planVerifyRunRound(md, RUN);
    if (afterThree.disposition !== 'round') throw new Error('unreachable');
    expect(afterThree.runRound).toBe(1);
  });

  it("reports this run's latest round again, already open, while nothing has been written under it", () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const first = planVerifyRunRound(md, RUN);
    if (first.disposition !== 'round') throw new Error('unreachable');
    const opened = appendAuditRoundHeading(md, first.heading);

    const again = planVerifyRunRound(opened, RUN);
    expect(again).toEqual({ ...first, alreadyOpen: true });
  });

  it("opens the next round once the open one has findings, and does not take another run's empty round for this run's", () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    md = roundWithFindings(md, RUN);
    const second = planVerifyRunRound(md, RUN);
    if (second.disposition !== 'round') throw new Error('unreachable');
    expect(second.runRound).toBe(2);
    expect(second.alreadyOpen).toBe(false);

    const otherRunOpen = appendAuditRoundHeading(md, `### Audit Round 9 (verify-repair run ${EARLIER_RUN}, round 1 of 3)`);
    const still = planVerifyRunRound(otherRunOpen, RUN);
    if (still.disposition !== 'round') throw new Error('unreachable');
    expect(still.alreadyOpen).toBe(false);
    expect(still.absoluteRound).toBe(10);
  });

  it('a zero-round chunk gets absolute round 1, round 1 of this run', () => {
    const md = '# Chunk: fresh\n\nStatus: built\n\n## Findings Ledger\n\n_No rounds yet._\n';
    const plan = planVerifyRunRound(md, RUN);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    expect(plan.absoluteRound).toBe(1);
    expect(plan.runRound).toBe(1);
  });

  it('append-only: output.startsWith(input.trimEnd()), and every original heading string survives exactly once', () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyRunRound(md, RUN);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    const output = appendAuditRoundHeading(md, plan.heading);

    expect(output.startsWith(md.trimEnd())).toBe(true);
    for (const original of ['### Audit Round 1', '### Audit Round 2', TABLE_AND_DRAW_ROUND_3]) {
      const count = output.split(original).length - 1;
      expect(count).toBe(1);
    }
    expect(output).toContain(plan.heading);
  });

  it('inserts BEFORE a trailing section, never after the document end (176-06-discovered bug fix — a real CHUNK.md has sections after ## Findings Ledger; a naive EOF append would detach the new heading from it)', () => {
    // Mirrors the REAL best-seven-selection/block CHUNK.md shape: ## Findings Ledger is followed
    // by ## Revision Rounds, ## Build Manifest, ## Verified Commit Hash — never the last section.
    const md =
      `# Chunk: test-chunk\n\nStatus: verified\n\n## Findings Ledger\n\n` +
      `${TABLE_AND_DRAW_ROUND_3}\n\n| ID | ... |\n|---|---|\n| F1 | ... |\n\n` +
      `## Revision Rounds\n\nSome revision text.\n\n` +
      `## Build Manifest\n\n| File | Status |\n|---|---|\n| a.ts | NEW |\n\n` +
      `## Verified Commit Hash\n\nabc123\n`;

    const plan = planVerifyRunRound(md, RUN);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    const output = appendAuditRoundHeading(md, plan.heading);

    const headingIndex = output.indexOf(plan.heading);
    const revisionRoundsIndex = output.indexOf('## Revision Rounds');
    const verifiedCommitHashIndex = output.indexOf('## Verified Commit Hash');

    expect(headingIndex).toBeGreaterThan(-1);
    expect(revisionRoundsIndex).toBeGreaterThan(-1);
    // The new heading lands BEFORE ## Revision Rounds — not after ## Verified Commit Hash.
    expect(headingIndex).toBeLessThan(revisionRoundsIndex);
    expect(headingIndex).toBeLessThan(verifiedCommitHashIndex);
    // Every trailing section's own text survives, byte-identical, unmoved relative to each other.
    expect(output).toContain('Some revision text.');
    expect(output).toContain('| a.ts | NEW |');
    expect(output.trimEnd().endsWith('abc123')).toBe(true);
    // Pre-existing round headings still survive exactly once.
    expect(output.split(TABLE_AND_DRAW_ROUND_3).length - 1).toBe(1);
    // A round open under a trailing section is still seen as open.
    expect(planVerifyRunRound(output, RUN)).toEqual({ ...plan, alreadyOpen: true });
  });

  it('appends at the end when ## Findings Ledger is the last section', () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyRunRound(md, RUN);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    const output = appendAuditRoundHeading(md, plan.heading);
    expect(output.startsWith(md.trimEnd())).toBe(true);
    expect(output.trimEnd().endsWith(plan.heading)).toBe(true);
  });

  it('refuses a CHUNK.md with no ## Findings Ledger, rather than putting the round somewhere else (#1302)', () => {
    const md = '# Chunk: bare\n\nStatus: verified\n\n## Build Manifest\n';
    expect(() => appendAuditRoundHeading(md, '### Audit Round 1 (x)')).toThrow(/no "## Findings Ledger" section/);
  });
});

describe('episode — writeAppendedAuditRound routes through atomicWriteFile only', () => {
  let root: string;

  beforeEach(async () => {
    root = tempTree('bs-verify-repair-write-');
  });

  it('writes the appended heading to disk and returns the same content it wrote', async () => {
    const chunkMdPath = join(root, 'CHUNK.md');
    const original = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    await fs.writeFile(chunkMdPath, original, 'utf-8');

    const plan = planVerifyRunRound(original, RUN);
    if (plan.disposition !== 'round') throw new Error('unreachable');

    const written = await writeAppendedAuditRound(chunkMdPath, original, plan.heading);
    const onDisk = await fs.readFile(chunkMdPath, 'utf-8');
    expect(onDisk).toBe(written);
    expect(onDisk).toContain(plan.heading);
    expect(onDisk.startsWith(original.trimEnd())).toBe(true);
  });

  it('the module contains no hand-rolled fs.writeFile/writeFileSync and calls atomicWriteFile', async () => {
    const source = await fs.readFile(join(__dirname, 'verify-repair.ts'), 'utf-8');
    const nonCommentLines = source
      .split('\n')
      .filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))
      .join('\n');
    expect(nonCommentLines).not.toMatch(/fs\.writeFile\(/);
    expect(nonCommentLines).not.toMatch(/writeFileSync/);
    expect(nonCommentLines).toMatch(/atomicWriteFile\(/);
  });
});

// -------------------------------------------------------------------------------------------
// #838 — the post-repair helpers as registered commands (their runs: verify-impact.test.ts)
// -------------------------------------------------------------------------------------------

describe('verify-repair-round — refuses a path before it reads anything', () => {
  it('refuses a --chunk that is a path, writing nothing outside design/chunks/', async () => {
    const root = tempTree('bs-verify-repair-round-');
    // `../..` resolves chunkMdPath to <project>/CHUNK.md, so plant one there to catch a write.
    const outside = join(root, 'CHUNK.md');
    await fs.writeFile(outside, threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3), 'utf-8');
    expect(chunkMdPath(root, '../..')).toBe(outside);
    const before = await fs.readFile(outside, 'utf-8');

    await expect(verifyRepairRoundCommand({ project: root, runId: RUN, chunk: '../..' })).rejects.toThrow(
      /--chunk "\.\.\/\.\." is a path, not a name/,
    );
    expect(await fs.readFile(outside, 'utf-8')).toBe(before);
  });
});

describe('cli — the post-repair commands are registered', () => {
  it('registers verify-repair-round and verify-repair-gate, each requiring --chunk and taking --run-id', () => {
    const program = createProgram();
    for (const name of ['verify-repair-round', 'verify-repair-gate']) {
      const command = program.commands.find((c) => c.name() === name);
      expect(command, `${name} is not registered`).toBeDefined();
      const chunk = command!.options.find((o) => o.long === '--chunk');
      expect(chunk?.mandatory).toBe(true);
      expect(command!.helpInformation()).toMatch(/--json/);
    }
    // Both are keyed to the verify run they repair, never to a count kept in the agent's memory (#1302).
    for (const name of ['verify-repair-round', 'verify-repair-gate']) {
      const command = program.commands.find((c) => c.name() === name)!;
      expect(command.helpInformation()).toMatch(/--run-id/);
      expect(command.options.find((o) => o.long === '--episode')).toBeUndefined();
    }
  });
});
