import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderIndex } from './ingest-archive.js';
import { computeTouchedChunks, verifyCloseRecordCommand } from './verify-close-record.js';
import { VERIFIED_AGAINST_BEGIN, VERIFIED_AGAINST_END } from './chunk-provenance.js';
import { computeSourceFreeReport } from './verify-source-free.js';

/**
 * `verify-close-record — the durable Close write (SC-3, PROV-02)`
 *
 * `verify-close-record` is the fix for 179-CONTEXT.md's CORRECTED measured_reality #2: before
 * 179-03, the ONLY function that ever wrote `## Verified Against` was `chunk-check`, and every
 * call site lived in the BUILD pipeline — a verify pass never reached it. Every test in this file
 * asserts through DISK, never through the returned object alone (179-03-PLAN.md task 3's own
 * instruction) — a command that computes correctly and writes nothing would still pass a
 * returned-object-only assertion, which is precisely the defect this plan exists to repair.
 *
 * Fixtures are real git repos (`git init` + one commit) since `driftCheckCommand` — the source of
 * `computeTouchedChunks`'s evaluated set — requires real git history.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-close-record-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function gitCommitAll(repoDir: string, message: string): Promise<string> {
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync(`git -c user.email=t@t -c user.name=t commit --allow-empty -m "${message}"`, {
    cwd: repoDir,
    stdio: 'ignore',
  });
  return execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
}

/**
 * A real git-backed project with a `rulebook/` (source-free when `kind === 'source-free'` — the
 * archived file is deliberately never written, matching `computeVerificationScope`'s
 * `source-missing` reason; `full` when `kind === 'full'`) and one real slice file on disk.
 */
async function makeRulebookProject(
  name: string,
  kind: 'source-free' | 'full',
): Promise<{ project: string; headSha: string }> {
  const project = join(dir, name);
  await fs.mkdir(project, { recursive: true });
  execSync('git init', { cwd: project, stdio: 'ignore' });

  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  const sourceBuf = Buffer.from(`%PDF-1.4 fake rulebook bytes for ${name}\n`);
  const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
  const relArchivedPath = 'rulebook/source/rules.pdf';
  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: name,
      edition: 'First Printing 2020',
      archivedPath: relArchivedPath,
      sourceHash,
      transcribed: '2026-08-01',
    }),
  );
  if (kind === 'full') {
    await fs.mkdir(join(project, 'rulebook', 'source'), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
  }

  await fs.writeFile(join(rulebookDir, '01-setup.md'), '# Setup\n\nReal slice content.\n');

  const headSha = await gitCommitAll(project, 'rulebook');
  return { project, headSha };
}

/**
 * Scaffolds `chunks/<slug>/CHUNK.md` from the real template (171-04-PLAN.md precedent, reused
 * verbatim per this plan's own `<read_first>` instruction): fills the Interpretation citation, the
 * Build Manifest table (one real row citing `rulebook/01-setup.md`), and the Verified Commit Hash
 * — leaving the template's own already-fenced, not-yet-recorded `## Verified Against` section
 * exactly as shipped, so the writer's REPAIR path (not the from-scratch creation path) is what
 * every test here exercises, matching a real project's shape.
 */
async function makeChunk(
  project: string,
  slug: string,
  opts: { headSha: string; cite?: string; designerProse?: boolean } = { headSha: '' },
): Promise<string> {
  const template = await fs.readFile(
    new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
    'utf-8',
  );
  let text = template;
  if (opts.cite) {
    text = text.replace(
      '1. <!-- claim text --> — cites <!-- rulebook section / RULINGS.md entry -->',
      `1. A claim — cites ${opts.cite}`,
    );
  }
  text = text.replace(
    '| File | Status |\n|------|--------|\n<!-- | src/... | written / pending | -->',
    '| File | Status |\n|------|--------|\n| rulebook/01-setup.md | NEW |',
  );
  if (opts.headSha) {
    text = text.replace('<!-- <commit-hash> -->', opts.headSha);
  }
  if (opts.designerProse) {
    text =
      `# Designer prose above the chunk heading\n\nHand-authored notes about this chunk.\n\n${text}` +
      `\n<!-- Designer prose below, after everything -->\n`;
  }

  const chunkDir = join(project, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });
  const chunkPath = join(chunkDir, 'CHUNK.md');
  await fs.writeFile(chunkPath, text);
  return chunkPath;
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(path)).digest('hex');
}

describe('verify-close-record — the durable Close write (SC-3, PROV-02)', () => {
  it('source-free fixture: each written CHUNK.md carries Scope: code-conformance-only and a Reason: line, read FROM DISK', async () => {
    const { project, headSha } = await makeRulebookProject('game-source-free', 'source-free');
    const pathA = await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    const pathB = await makeChunk(project, 'cross', { headSha, cite: 'rulebook/01-setup.md' });
    await gitCommitAll(project, 'chunks');

    const result = await verifyCloseRecordCommand({ project });
    expect(result.scope).toBe('code-conformance-only');
    expect(result.reason).toBe('source-missing');

    for (const chunkPath of [pathA, pathB]) {
      const text = await fs.readFile(chunkPath, 'utf-8');
      const begin = text.indexOf(VERIFIED_AGAINST_BEGIN);
      const end = text.indexOf(VERIFIED_AGAINST_END);
      expect(begin).toBeGreaterThan(-1);
      const body = text.slice(begin, end);
      expect(body).toContain('code-conformance-only');
      expect(body).toMatch(/^Reason: source-missing$/m);
    }
  });

  it('full-scope fixture: each written block carries Scope: full and NO Reason: line', async () => {
    const { project, headSha } = await makeRulebookProject('game-full-scope', 'full');
    const pathA = await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    await gitCommitAll(project, 'chunks');

    const result = await verifyCloseRecordCommand({ project });
    expect(result.scope).toBe('full');
    expect(result.reason).toBeUndefined();

    const text = await fs.readFile(pathA, 'utf-8');
    const begin = text.indexOf(VERIFIED_AGAINST_BEGIN);
    const end = text.indexOf(VERIFIED_AGAINST_END);
    const body = text.slice(begin, end);
    expect(body).toMatch(/^Scope: full$/m);
    expect(body).not.toMatch(/^Reason:/m);
  });

  it('two consecutive invocations: the second returns every changed: false, and each CHUNK.md SHA-256 is identical across both calls', async () => {
    const { project, headSha } = await makeRulebookProject('game-idempotent', 'full');
    const pathA = await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    const pathB = await makeChunk(project, 'cross', { headSha, cite: 'rulebook/01-setup.md' });
    await gitCommitAll(project, 'chunks');

    const first = await verifyCloseRecordCommand({ project });
    expect(first.recorded.some((r) => r.changed)).toBe(true);
    const hashesAfterFirst = new Map([
      ['jab', await sha256File(pathA)],
      ['cross', await sha256File(pathB)],
    ]);

    const second = await verifyCloseRecordCommand({ project });
    for (const r of second.recorded) {
      expect(r.changed).toBe(false);
    }
    expect(await sha256File(pathA)).toBe(hashesAfterFirst.get('jab'));
    expect(await sha256File(pathB)).toBe(hashesAfterFirst.get('cross'));
  });

  it('designer prose outside the fences is byte-identical after the write', async () => {
    const { project, headSha } = await makeRulebookProject('game-designer-prose', 'full');
    const chunkPath = await makeChunk(project, 'jab', {
      headSha,
      cite: 'rulebook/01-setup.md',
      designerProse: true,
    });
    await gitCommitAll(project, 'chunks');

    await verifyCloseRecordCommand({ project });

    const after = await fs.readFile(chunkPath, 'utf-8');
    expect(after).toContain('# Designer prose above the chunk heading');
    expect(after).toContain('Hand-authored notes about this chunk.');
    expect(after).toContain('<!-- Designer prose below, after everything -->');
  });

  it('a chunk directory with no CHUNK.md is absent from recorded[] and no file is written for it', async () => {
    const { project, headSha } = await makeRulebookProject('game-missing-chunk-md', 'full');
    await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    await makeChunk(project, 'cross', { headSha, cite: 'rulebook/01-setup.md' });
    await fs.mkdir(join(project, 'chunks', 'no-chunk-md'), { recursive: true });
    await gitCommitAll(project, 'chunks');

    const touched = await computeTouchedChunks(project);
    expect(touched.sort()).toEqual(['cross', 'jab']);

    const result = await verifyCloseRecordCommand({ project });
    const recordedSlugs = result.recorded.map((r) => r.slug).sort();
    expect(recordedSlugs).toEqual(['cross', 'jab']);
    expect(recordedSlugs).not.toContain('no-chunk-md');
    expect(
      await fs
        .access(join(project, 'chunks', 'no-chunk-md', 'CHUNK.md'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it('a fence-stripped CHUNK.md lands in errors[] naming its slug; the healthy chunks are still recorded; no non-zero exit code is set', async () => {
    const { project, headSha } = await makeRulebookProject('game-fence-stripped', 'full');
    const healthyPath = await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    const brokenPath = await makeChunk(project, 'broken', { headSha, cite: 'rulebook/01-setup.md' });
    const brokenText = await fs.readFile(brokenPath, 'utf-8');
    await fs.writeFile(
      brokenPath,
      brokenText.replace(VERIFIED_AGAINST_BEGIN, '').replace(VERIFIED_AGAINST_END, ''),
    );
    await gitCommitAll(project, 'chunks');

    const before = process.exitCode;
    const result = await verifyCloseRecordCommand({ project });
    expect(process.exitCode).toBe(before);
    expect(process.exitCode).not.toBe(1);

    expect(result.recorded.map((r) => r.slug)).toContain('jab');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].slug).toBe('broken');
    expect(result.errors[0].message).toMatch(/machine-owned fences/i);

    // The healthy chunk was still written; the broken one was left untouched (no fences to write
    // between — recordVerifiedAgainst never touches the file on this throw path).
    const healthyText = await fs.readFile(healthyPath, 'utf-8');
    expect(healthyText).toContain(VERIFIED_AGAINST_BEGIN);
  });

  it('cross-surface: the scope/reason written into the block equal computeSourceFreeReport for the same fixture', async () => {
    const { project, headSha } = await makeRulebookProject('game-cross-surface', 'source-free');
    const chunkPath = await makeChunk(project, 'jab', { headSha, cite: 'rulebook/01-setup.md' });
    await gitCommitAll(project, 'chunks');

    const report = await computeSourceFreeReport(project);
    const result = await verifyCloseRecordCommand({ project });
    expect(result.scope).toBe(report.scope);
    expect(result.reason).toBe(report.reason);

    const text = await fs.readFile(chunkPath, 'utf-8');
    expect(text).toContain(`Scope: ${report.scope}`);
    if (report.reason) {
      expect(text).toContain(`Reason: ${report.reason}`);
    }
  });

  it('computeTouchedChunks unions the drift-check set with a run ledger\'s impact-record slugs when --run is supplied', async () => {
    const { project, headSha } = await makeRulebookProject('game-touched-with-run', 'full');
    await makeChunk(project, 'drift-seen', { headSha, cite: 'rulebook/01-setup.md' });
    await gitCommitAll(project, 'chunks');

    const { verifyRunInitCommand } = await import('./verify-run.js');
    const initResult = await verifyRunInitCommand({ project, json: true });
    const runId = initResult.runId;

    const { ledgerFilePath, appendLedgerLine, atomicWriteFile } = await import('./verify-run.js');
    const ledgerFile = ledgerFilePath(project, runId);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const impactLine = JSON.stringify({
      kind: 'impact',
      slug: 'ledger-only-chunk',
      ruleDelta: 'none',
      stale: false,
      attributions: [],
      chunkStatus: 'verified',
      driftState: 'clean',
      markerWritten: false,
      recordedAt: new Date().toISOString(),
    });
    const updated = appendLedgerLine(ledgerText, ledgerFile, impactLine);
    await atomicWriteFile(ledgerFile, updated);

    const touched = await computeTouchedChunks(project, { runId });
    expect(touched).toContain('drift-seen');
    expect(touched).toContain('ledger-only-chunk');
  });
});
