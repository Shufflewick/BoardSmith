import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  selectStaleChunks,
  resolveStagedSlicePaths,
  parseAuditRounds,
  planVerifyEpisodeRound,
  resolveVerifyEpisodeNumber,
  appendAuditRoundHeading,
  writeAppendedAuditRound,
  recomputeRepairGatePostRepair,
  VERIFY_EPISODE_ROUND_BUDGET,
} from './verify-repair.js';
import {
  readLedgerOrThrow,
  parseLedgerBody,
  resolveLedgerState,
  ledgerFilePath,
  stagingSlicesDir,
  type ClassificationRecord,
} from './verify-run.js';
import type { ImpactMapEntry } from './verify-impact.js';

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

async function fixtureSha256Tree(dir: string): Promise<Record<string, string>> {
  const { createHash } = await import('node:crypto');
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
    attributions: overrides.attributions ?? [],
    gate: overrides.gate ?? {
      disposition: 'close-without-replaytest',
      nextStatus: 'verified',
      clearMarker: true,
      reverifyStamp: true,
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
    root = await fs.mkdtemp(join(tmpdir(), 'bs-verify-repair-'));
    project = join(root, 'game-project');
    await fs.mkdir(project, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function copyFixture(game: 'seven' | 'one-two-punch'): Promise<void> {
    const src = join(FIXTURE_ROOT, game);
    const dest = join(project, 'rulebook', '.verify', runId);
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

describe('episode — planVerifyEpisodeRound', () => {
  it("a 3-build-round chunk's first verify round is absolute 4, episode 1, round 1", () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyEpisodeRound(md, 1);
    expect(plan.disposition).toBe('round');
    if (plan.disposition !== 'round') throw new Error('unreachable');
    expect(plan.absoluteRound).toBe(4);
    expect(plan.episode).toBe(1);
    expect(plan.episodeRound).toBe(1);
    expect(plan.heading).toMatch(/^### Audit Round 4 \(verify-repair episode 1, round 1 of 3\)$/m);
  });

  it('the 4th episode-round request returns the triage disposition and produces no heading', () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    for (let i = 0; i < VERIFY_EPISODE_ROUND_BUDGET; i++) {
      const plan = planVerifyEpisodeRound(md, 1);
      expect(plan.disposition).toBe('round');
      if (plan.disposition !== 'round') throw new Error('unreachable');
      md = appendAuditRoundHeading(md, plan.heading);
    }
    const fourth = planVerifyEpisodeRound(md, 1);
    expect(fourth.disposition).toBe('triage');
    expect((fourth as { heading?: string }).heading).toBeUndefined();
  });

  it('a zero-round chunk gets absolute round 1, episode 1, round 1', () => {
    const md = '# Chunk: fresh\n\nStatus: built\n\n## Findings Ledger\n\n_No rounds yet._\n';
    const plan = planVerifyEpisodeRound(md, 1);
    expect(plan.disposition).toBe('round');
    if (plan.disposition !== 'round') throw new Error('unreachable');
    expect(plan.absoluteRound).toBe(1);
    expect(plan.episodeRound).toBe(1);
  });

  it('append-only: output.startsWith(input.trimEnd()), and every original heading string survives exactly once', () => {
    const md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyEpisodeRound(md, 1);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    const output = appendAuditRoundHeading(md, plan.heading);

    expect(output.startsWith(md.trimEnd())).toBe(true);
    for (const original of ['### Audit Round 1', '### Audit Round 2', TABLE_AND_DRAW_ROUND_3]) {
      const count = output.split(original).length - 1;
      expect(count).toBe(1);
    }
    expect(output).toContain(plan.heading);
  });

  it('resolveVerifyEpisodeNumber: a zero-round chunk resolves to episode 1', () => {
    const md = '# Chunk: fresh\n\nStatus: built\n\n## Findings Ledger\n\n_No rounds yet._\n';
    expect(resolveVerifyEpisodeNumber(md)).toBe(1);
  });

  it('resolveVerifyEpisodeNumber: an in-progress episode 1 (1 of 3 rounds used) resumes as episode 1', () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    const plan = planVerifyEpisodeRound(md, 1);
    if (plan.disposition !== 'round') throw new Error('unreachable');
    md = appendAuditRoundHeading(md, plan.heading);
    expect(resolveVerifyEpisodeNumber(md)).toBe(1);
  });

  it('resolveVerifyEpisodeNumber: an exhausted episode 1 (3 of 3 rounds used) opens episode 2', () => {
    let md = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    for (let i = 0; i < VERIFY_EPISODE_ROUND_BUDGET; i++) {
      const plan = planVerifyEpisodeRound(md, 1);
      if (plan.disposition !== 'round') throw new Error('unreachable');
      md = appendAuditRoundHeading(md, plan.heading);
    }
    expect(resolveVerifyEpisodeNumber(md)).toBe(2);
  });
});

describe('episode — writeAppendedAuditRound routes through atomicWriteFile only', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bs-verify-repair-write-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes the appended heading to disk and returns the same content it wrote', async () => {
    const chunkMdPath = join(root, 'CHUNK.md');
    const original = threeBuildRoundChunkMd(TABLE_AND_DRAW_ROUND_3);
    await fs.writeFile(chunkMdPath, original, 'utf-8');

    const plan = planVerifyEpisodeRound(original, 1);
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
// Task 3 — recomputeRepairGatePostRepair
// -------------------------------------------------------------------------------------------

async function buildRepairGateTestProject(
  root: string,
  opts: { validHash?: boolean } = {},
): Promise<{ project: string; slug: string; firstSha: string }> {
  const project = join(root, `repair-gate-project-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(join(project, 'src'), { recursive: true });
  await fs.writeFile(join(project, 'src', 'thing.ts'), 'export const thing = 1;\n');

  execSync('git init', { cwd: project, stdio: 'ignore' });
  execSync('git add -A', { cwd: project, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m first', { cwd: project, stdio: 'ignore' });
  const firstSha = execSync('git rev-parse HEAD', { cwd: project }).toString().trim();

  const slug = 'movement';
  const chunkDir = join(project, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });
  const hash = opts.validHash === false ? 'not-a-hash' : firstSha;
  await fs.writeFile(
    join(chunkDir, 'CHUNK.md'),
    `# Chunk: ${slug}\n\nStatus: verified\n\n` +
      `## Build Manifest\n\n| File | Status |\n|---|---|\n| src/thing.ts | NEW |\n\n` +
      `## Verified Commit Hash\n\n${hash}\n`,
  );

  return { project, slug, firstSha };
}

describe('post-repair gate — recomputeRepairGatePostRepair, over a real git fixture', () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'bs-verify-repair-gate-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('clean → drifted flip: first reading close-without-replaytest, second (after a real file modification) reopen-playtest', async () => {
    const { project, slug } = await buildRepairGateTestProject(root);

    const first = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });
    expect(first.disposition).toBe('close-without-replaytest');

    await fs.writeFile(join(project, 'src', 'thing.ts'), 'export const thing = 2;\n');
    execSync('git add -A', { cwd: project, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m second', { cwd: project, stdio: 'ignore' });

    const second = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });
    expect(second.disposition).toBe('reopen-playtest');
    expect(second.nextStatus).toBe('built');
  });

  it('unchanged case preserves disposition across two invocations (not gratuitously destabilising)', async () => {
    const { project, slug } = await buildRepairGateTestProject(root);

    const first = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });
    const second = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });

    expect(first.disposition).toBe(second.disposition);
    expect(first.disposition).toBe('close-without-replaytest');
  });

  it("driftState === 'unknown' still short-circuits first on the second invocation", async () => {
    const { project, slug } = await buildRepairGateTestProject(root, { validHash: false });

    const first = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });
    const second = await recomputeRepairGatePostRepair({ projectDir: project, slug, stale: true, status: 'verified' });

    expect(first.disposition).toBe('unknown-drift');
    expect(second.disposition).toBe('unknown-drift');
  });

  it(
    "structural guard: recomputeRepairGatePostRepair's parameter object has no driftState/gate member " +
      '— the pre-repair snapshot is unpassable',
    async () => {
      const source = await fs.readFile(join(__dirname, 'verify-repair.ts'), 'utf-8');
      const match = source.match(
        /export async function recomputeRepairGatePostRepair\(input: \{([\s\S]*?)\}\): Promise<RepairGate>/,
      );
      expect(match).not.toBeNull();
      const paramBlock = match![1];
      expect(paramBlock).not.toMatch(/driftState/);
      expect(paramBlock).not.toMatch(/\bgate\b/);
    },
  );
});
