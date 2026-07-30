import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { selectStaleChunks, resolveStagedSlicePaths } from './verify-repair.js';
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
