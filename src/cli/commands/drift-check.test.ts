import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync, execFile as execFileImport } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diffedFilesSince, UNRESOLVABLE } from './drift-check.js';

/**
 * `drift-check.ts` is CHECK-05: the code-drift check. This file covers, in task order: the git
 * plumbing / hash validation / cwd discipline (Task 1), and `driftCheckCommand`'s three-state
 * sweep, findings, report, and read-only invariant (Task 2).
 *
 * Every git fixture here is a REAL temp git repo built with `git init` + two commits, per
 * `ingest-hook.test.ts`'s `gitProject()` convention, extended to two commits so a diff exists.
 * This plan reads and writes nothing under `~/BoardSmithGames/` — see 172-03-PLAN.md's context.
 */

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

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-drift-check-'));
});

afterEach(async () => {
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

  it('runs git with cwd = the passed project directory — a real temp repo distinct from BoardSmith proves the diff did not run against BoardSmith', async () => {
    const { repoDir, firstSha, secondSha } = await twoCommitRepo();

    // If cwd were wrong (e.g. defaulting to BoardSmith's own repo, or to `dir` itself, which is
    // not a repo), this call would either throw or return something that is not this repo's
    // real diff.
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
