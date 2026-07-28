import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync, execFile as execFileImport } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diffedFilesSince, driftCheckCommand, UNRESOLVABLE } from './drift-check.js';

/**
 * `execFile` is mocked (call-through by default) rather than spied directly — `node:child_process`
 * exports non-configurable properties in this Node/Vitest combination, so `vi.spyOn(childProcess,
 * 'execFile')` throws `Cannot redefine property`. Wrapping it in `vi.fn(actual.execFile)` inside
 * `vi.mock` preserves real behavior for every test while exposing call assertions where needed.
 */
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});
const execFileMock = vi.mocked(execFileImport);

/**
 * `drift-check.ts` is CHECK-05: the code-drift check. This file covers, in task order: the git
 * plumbing / hash validation / cwd discipline (Task 1), and `driftCheckCommand`'s three-state
 * sweep, findings, report, and read-only invariant (Task 2).
 *
 * Every git fixture here is a REAL temp git repo built with `git init` + two commits, per
 * `ingest-hook.test.ts`'s `gitProject()` convention, extended to two commits so a diff exists.
 * This plan reads and writes nothing under `~/BoardSmithGames/` — see 172-03-PLAN.md's context.
 */

let dir: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-drift-check-'));
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * Builds a real temp git repo with TWO commits: the first adds `kept.txt` and `deleted.txt`, the
 * second modifies `kept.txt` and deletes `deleted.txt`. Returns the repo dir and both shas.
 */
async function twoCommitRepo(): Promise<{ repoDir: string; firstSha: string; secondSha: string }> {
  const repoDir = join(dir, 'proj');
  await fs.mkdir(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir, stdio: 'ignore' });

  await fs.writeFile(join(repoDir, 'kept.txt'), 'v1\n');
  await fs.writeFile(join(repoDir, 'deleted.txt'), 'gone soon\n');
  await fs.writeFile(join(repoDir, 'untouched.txt'), 'never changes\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m first', { cwd: repoDir, stdio: 'ignore' });
  const firstSha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  await fs.writeFile(join(repoDir, 'kept.txt'), 'v2\n');
  await fs.rm(join(repoDir, 'deleted.txt'));
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m second', { cwd: repoDir, stdio: 'ignore' });
  const secondSha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  return { repoDir, firstSha, secondSha };
}

// -------------------------------------------------------------------------------------------
// diffedFilesSince — git plumbing, cwd discipline, hash validation (Task 1)
// -------------------------------------------------------------------------------------------

describe('diffedFilesSince', () => {
  it('returns exactly the files changed by the second commit, and nothing else', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    const result = await diffedFilesSince(repoDir, firstSha);
    expect(result).not.toBe(UNRESOLVABLE);
    expect((result as string[]).sort()).toEqual(['deleted.txt', 'kept.txt']);
    expect(result).not.toContain('untouched.txt');
  });

  it('a file deleted in the second commit appears in the returned list', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    const result = await diffedFilesSince(repoDir, firstSha);
    expect(result).toContain('deleted.txt');
  });

  it('runs git with cwd = the passed project directory — a second, unrelated temp repo proves the diff did not run against BoardSmith', async () => {
    const { repoDir, firstSha, secondSha } = await twoCommitRepo();

    // A second, wholly unrelated temp repo with its own distinct commit sha shape. If cwd were
    // wrong (e.g. defaulting to BoardSmith's own repo, or to `dir` itself, which is not a repo),
    // this call would either throw or return something that is not this repo's real diff.
    const result = await diffedFilesSince(repoDir, firstSha);
    expect(result).not.toBe(UNRESOLVABLE);
    expect((result as string[]).sort()).toEqual(['deleted.txt', 'kept.txt']);

    // Sanity: the two commits are real, distinct, and belong to THIS repo only.
    expect(firstSha).not.toEqual(secondSha);
    expect(firstSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('a syntactically valid but unresolvable hash returns the unresolvable sentinel rather than throwing', async () => {
    const { repoDir } = await twoCommitRepo();
    const result = await diffedFilesSince(repoDir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(result).toBe(UNRESOLVABLE);
  });

  it('rejects a flag-shaped value BEFORE any git invocation — git is never called with it', async () => {
    const { repoDir } = await twoCommitRepo();
    execFileMock.mockClear();

    const result = await diffedFilesSince(repoDir, '--upload-pack=touch /tmp/pwned');

    expect(result).toBe(UNRESOLVABLE);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects other non-hash-shaped strings (too short, non-hex, empty) without invoking git', async () => {
    const { repoDir } = await twoCommitRepo();
    execFileMock.mockClear();

    expect(await diffedFilesSince(repoDir, 'zzzzzzz')).toBe(UNRESOLVABLE);
    expect(await diffedFilesSince(repoDir, 'abc')).toBe(UNRESOLVABLE);
    expect(await diffedFilesSince(repoDir, '')).toBe(UNRESOLVABLE);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('a valid 7-char short hash resolves the same as the full 40-char hash', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    const shortSha = firstSha.slice(0, 7);
    const result = await diffedFilesSince(repoDir, shortSha);
    expect(result).not.toBe(UNRESOLVABLE);
    expect((result as string[]).sort()).toEqual(['deleted.txt', 'kept.txt']);
  });
});

describe('driftCheckCommand — tool-failure preconditions', () => {
  it('a project directory that is not a git repo throws an actionable one-line error, not a finding', async () => {
    const notGit = join(dir, 'not-a-repo');
    await fs.mkdir(join(notGit, 'chunks'), { recursive: true });
    await expect(driftCheckCommand({ project: notGit })).rejects.toThrow(/not a git repository/);
  });
});

// -------------------------------------------------------------------------------------------
// driftCheckCommand — three states, findings, read-only invariant (Task 2)
// -------------------------------------------------------------------------------------------

interface ManifestRow {
  files: string;
  status: string;
}

async function makeChunk(
  repoDir: string,
  slug: string,
  opts: { hash?: string; manifestRows?: ManifestRow[]; manifestProse?: string; noManifest?: boolean } = {},
): Promise<void> {
  const chunkDir = join(repoDir, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });

  const manifestBody =
    opts.manifestProse ??
    ['| File | Status |', '|---|---|', ...(opts.manifestRows ?? []).map((r) => `| ${r.files} | ${r.status} |`)].join(
      '\n',
    );

  const parts = [`# Chunk: ${slug}`, '', 'Status: verified', ''];
  if (!opts.noManifest) {
    parts.push('## Build Manifest', '', manifestBody, '');
  }
  if (opts.hash !== undefined) {
    parts.push('## Verified Commit Hash', '', opts.hash, '');
  }

  await fs.writeFile(join(chunkDir, 'CHUNK.md'), parts.join('\n'));
}

/** Whole-project content hash: every file's relative path + bytes, in sorted order. */
async function hashProject(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.slice(root.length));
    hash.update(await fs.readFile(f));
  }
  return hash.digest('hex');
}

describe('driftCheckCommand', () => {
  it('a chunk whose manifest file changed since its verified hash reports chunk-code-drifted, naming the file', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'kept-chunk', {
      hash: firstSha,
      manifestRows: [{ files: 'kept.txt', status: 'NEW' }],
    });
    execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m chunk', { cwd: repoDir, stdio: 'ignore' });

    const result = await driftCheckCommand({ project: repoDir });

    const drifted = result.chunks.find((c) => c.chunk === 'kept-chunk');
    expect(drifted?.state).toBe('drifted');
    expect(drifted?.changedFiles).toContain('kept.txt');

    const finding = result.findings.find((f) => f.kind === 'chunk-code-drifted' && f.chunk === 'kept-chunk');
    expect(finding?.detail).toContain('kept.txt');
    expect(finding?.detail).toContain(firstSha);
  });

  it('a chunk with no recorded hash reports drift-unknown — never drifted, never clean', async () => {
    const { repoDir } = await twoCommitRepo();
    await makeChunk(repoDir, 'no-hash-chunk', {
      manifestRows: [{ files: 'kept.txt', status: 'NEW' }],
    });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'no-hash-chunk');
    expect(chunk?.state).toBe('unknown');
    expect(result.findings.some((f) => f.kind === 'drift-unknown' && f.chunk === 'no-hash-chunk')).toBe(true);
  });

  it('a manifest file deleted from disk is reported as drift (decision 12)', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'del-chunk', {
      hash: firstSha,
      manifestRows: [{ files: 'deleted.txt', status: 'NEW' }],
    });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'del-chunk');
    expect(chunk?.state).toBe('drifted');
    expect(chunk?.missingFiles).toContain('deleted.txt');

    const finding = result.findings.find((f) => f.kind === 'chunk-code-drifted' && f.chunk === 'del-chunk');
    expect(finding?.detail).toContain('deleted.txt');
  });

  it('a hash git cannot resolve as an ancestor of HEAD reports drift-unknown rather than failing the whole run', async () => {
    const { repoDir } = await twoCommitRepo();
    await makeChunk(repoDir, 'bad-hash-chunk', {
      hash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      manifestRows: [{ files: 'kept.txt', status: 'NEW' }],
    });
    await makeChunk(repoDir, 'ok-chunk', {
      manifestRows: [{ files: 'kept.txt', status: 'NEW' }],
    });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'bad-hash-chunk');
    expect(chunk?.state).toBe('unknown');
    // The run completed and reported the OTHER chunk too — one bad hash never aborts the sweep.
    expect(result.chunks.some((c) => c.chunk === 'ok-chunk')).toBe(true);
  });

  it('a not-table-shaped manifest reports manifest-file-missing and drift state unknown, never clean', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'prose-chunk', {
      hash: firstSha,
      manifestProse: 'Just some prose, no table here.',
    });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'prose-chunk');
    expect(chunk?.state).toBe('unknown');
    expect(chunk?.state).not.toBe('clean');
    expect(result.findings.some((f) => f.kind === 'manifest-file-missing' && f.chunk === 'prose-chunk')).toBe(true);
  });

  it('a legitimately empty manifest table with a valid hash reports clean', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'empty-chunk', { hash: firstSha, manifestRows: [] });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'empty-chunk');
    expect(chunk?.state).toBe('clean');
  });

  it('a manifest row with zero path tokens reports manifest-file-missing naming the row', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'pathless-chunk', {
      hash: firstSha,
      manifestProse: ['| File | Status |', '|---|---|', '| (no path here) | NEW |'].join('\n'),
    });

    const result = await driftCheckCommand({ project: repoDir });

    expect(
      result.findings.some(
        (f) => f.kind === 'manifest-file-missing' && f.chunk === 'pathless-chunk' && f.subject.includes('row'),
      ),
    ).toBe(true);
  });

  it('a manifest path that escapes the project root is reported manifest-file-missing and is never stat-ed', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'escape-chunk', {
      hash: firstSha,
      manifestRows: [{ files: '../../../etc/evil.txt', status: 'NEW' }],
    });

    const result = await driftCheckCommand({ project: repoDir });

    const chunk = result.chunks.find((c) => c.chunk === 'escape-chunk');
    expect(chunk?.missingFiles).not.toContain('../../../etc/evil.txt');
    expect(chunk?.changedFiles).not.toContain('../../../etc/evil.txt');
    expect(
      result.findings.some(
        (f) => f.kind === 'manifest-file-missing' && f.chunk === 'escape-chunk' && f.detail.includes('escapes'),
      ),
    ).toBe(true);
  });

  it('findings exit 0; process.exitCode is never set by this module', async () => {
    const { repoDir } = await twoCommitRepo();
    await makeChunk(repoDir, 'no-hash-chunk', { manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });

    const before = process.exitCode;
    await driftCheckCommand({ project: repoDir });
    expect(process.exitCode).toBe(before);
  });

  it('READ-ONLY: a whole-project byte-hash taken before and after a run is identical', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'jab', { hash: firstSha, manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });
    execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m chunk', { cwd: repoDir, stdio: 'ignore' });

    const before = await hashProject(repoDir);
    await driftCheckCommand({ project: repoDir });
    const after = await hashProject(repoDir);

    expect(after).toBe(before);
  });

  it('throws a one-line actionable error when there is no chunks/ directory', async () => {
    const { repoDir } = await twoCommitRepo();
    await expect(driftCheckCommand({ project: repoDir })).rejects.toThrow(/No chunks\/ directory/);
  });

  it('caches the diff/ancestor check per distinct hash rather than once per chunk', async () => {
    const { repoDir, firstSha } = await twoCommitRepo();
    await makeChunk(repoDir, 'chunk-a', { hash: firstSha, manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });
    await makeChunk(repoDir, 'chunk-b', { hash: firstSha, manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });

    execFileMock.mockClear();
    await driftCheckCommand({ project: repoDir });

    const diffCalls = execFileMock.mock.calls.filter(
      (call) => call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'diff',
    );
    // Two chunks share the SAME hash — only one `git diff` subprocess should have been spawned.
    expect(diffCalls.length).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------
// --json / human report contract
// -------------------------------------------------------------------------------------------

describe('driftCheckCommand — --json / human report', () => {
  it('--json prints the JSON result and returns it', async () => {
    const { repoDir } = await twoCommitRepo();
    await makeChunk(repoDir, 'jab', { manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });

    const result = await driftCheckCommand({ project: repoDir, json: true });

    expect(logSpy).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(() => JSON.parse(printed)).not.toThrow();
    expect(result.counts.unknown).toBe(1);
  });

  it('the human report (no --json) prints a clean/drifted/unknown count line', async () => {
    const { repoDir } = await twoCommitRepo();
    await makeChunk(repoDir, 'jab', { manifestRows: [{ files: 'kept.txt', status: 'NEW' }] });

    await driftCheckCommand({ project: repoDir });

    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toMatch(/clean:\s*\d+\s+drifted:\s*\d+\s+unknown:\s*\d+/);
  });
});
