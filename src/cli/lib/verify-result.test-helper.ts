/**
 * Git and verify-result fixtures for the tests of the done gate (#452).
 *
 * `chunk-signoff` and `chunk-gate-transition` refuse a done claim unless `boardsmith verify` passed
 * for HEAD on a clean tree. Their tests are about sign-offs, not about the checks, so they record a
 * passing result with `recordPassingVerify`: it commits the project as it stands and writes a result
 * for that commit through the same `buildVerifyResult` and `writeVerifyResult` the command uses.
 * The `verify*.test.ts` files drive the real command, so the shape written here is the shape it writes.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, promises as fs, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chunkVerifyBase } from './chunk-commits.js';
import { CHUNK_VERIFY_CHECK_NAMES, VERIFY_CHECK_NAMES, type VerifyCheckName, buildVerifyResult, writeVerifyResult } from './verify-result.js';

const IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false'];

/** Writes each file under `dir`, making the directories it needs. */
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(dir, path)), { recursive: true });
    await fs.writeFile(join(dir, path), text);
  }
}

/** Runs git in `dir` and returns its stdout. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Makes `dir` a git repository on branch `main`, unless it already is the top of one (a checkout or
 * a worktree). A directory inside some other repository gets its own, so a fixture never commits
 * into the repository around it.
 */
export function initRepo(dir: string): void {
  let top = '';
  try {
    top = git(dir, 'rev-parse', '--show-toplevel').trim();
  } catch {
    // Not inside a repository.
  }
  if (top !== '' && realpathSync(top) === realpathSync(dir)) return;
  git(dir, 'init', '-q', '-b', 'main');
}

/**
 * Keeps `.boardsmith/` out of git the way a game's `.gitignore` does, through the repository's own
 * exclude file, so a fixture's files stay exactly as the test wrote them.
 */
function ignoreBoardsmithDir(dir: string): void {
  const exclude = resolve(dir, git(dir, 'rev-parse', '--git-path', 'info/exclude').trim());
  const text = existsSync(exclude) ? readFileSync(exclude, 'utf-8') : '';
  if (text.split('\n').includes('.boardsmith/')) return;
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(exclude, `${text === '' || text.endsWith('\n') ? '' : '\n'}.boardsmith/\n`);
}

/** Commits everything in `dir`, even when nothing changed. */
export function commitAll(dir: string, message: string): string {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD').trim();
}

/** Whether `dir`'s repository has a commit yet. */
function hasCommit(dir: string): boolean {
  try {
    git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}');
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits the project as it stands and records a passing `boardsmith verify` result for that
 * commit, the way the run the bs- skills make would:
 *
 * - with `chunk`, as `boardsmith verify --chunk <slug>` does: the chunk's fast checks (tests and
 *   typecheck) for a commit that is one of the chunk's (`chunk-<slug>/step-test` unless `message`
 *   says otherwise, after a first commit for the chunk to start from when the repository has none),
 *   with the chunk's verify base, or `base` when given;
 * - without, as `boardsmith verify --base HEAD` does, the run before a gate transition: every full
 *   check, with the commit itself as the base. It satisfies no chunk's sign-off.
 */
export async function recordPassingVerify(
  dir: string,
  { chunk, message, base }: { chunk?: string; message?: string; base?: string } = {},
): Promise<string> {
  initRepo(dir);
  ignoreBoardsmithDir(dir);
  if (chunk === undefined) {
    const commit = commitAll(dir, message ?? 'fixture: work to verify');
    await writePassing(dir, commit, { ref: 'HEAD', commit: base ?? commit }, null, VERIFY_CHECK_NAMES);
    return commit;
  }
  if (!hasCommit(dir)) commitAll(dir, 'fixture: the project before its chunks');
  const commit = commitAll(dir, message ?? `chunk-${chunk}/step-test`);
  const chunkBase = { ref: `base of chunk-${chunk}`, commit: base ?? (await chunkVerifyBase(dir, chunk)) };
  await writePassing(dir, commit, chunkBase, chunk, CHUNK_VERIFY_CHECK_NAMES);
  return commit;
}

/** Writes a clean, passing result for `commit` holding exactly the checks `names`. */
async function writePassing(
  dir: string,
  commit: string,
  base: { ref: string; commit: string },
  chunk: string | null,
  names: readonly VerifyCheckName[],
): Promise<void> {
  const checks = names.map((name) => ({ name, passed: true, summary: `${name} passed` }));
  await writeVerifyResult(dir, buildVerifyResult({ commit, cleanTree: true, base, chunk, checks }));
}
