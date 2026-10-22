import { gitOutput as git } from './git-output.js';
import { DESIGN_DIR } from './project-paths.js';

/**
 * A chunk's own commits, and the commit it started from.
 *
 * Every step of a chunk is committed with a message starting `chunk-<slug>/` (state-machine.md
 * "Git Protocol"), so those commits are the chunk's, whichever branch they were made on and
 * however they reached this one. `test-step-check` reads the lines they wrote.
 *
 * THE CHUNK'S HISTORY is its base commit (the first parent of the oldest of its commits: the code
 * as it stood before the chunk changed anything) and its own commits. A claim written at
 * investigate quotes code the chunk may then replace, and there is no honest new location for
 * such a quote, so it cites the file as it was in one of those commits, `path@<commit>:N-M`
 * (line-location.ts, #426). Only the chunk's history is accepted: the pin says "as this chunk
 * found it", not "somewhere in the project's past". `claim-quote-check` reads the quote there, and
 * `ledger-check` holds a verified chunk's citation to the file and lines being there.
 *
 * WHERE THE COMMITS ARE READ FROM is the history of the tree in the checkout: HEAD, and, while a
 * merge is in progress, the commits being merged (MERGE_HEAD) too. `chunk-merge` runs every check
 * on the combined tree before it commits the merge, when a branch's chunk commits are reachable
 * only from MERGE_HEAD (#435). Every check that asks which commits are a chunk's asks here.
 */

/** One commit of a chunk's history, and how a message names it. */
export interface ChunkCommit {
  hash: string;
  /** Its subject, or `base of chunk-<slug>` for the base commit. */
  label: string;
}

/** A commit of a chunk's history, as messages name it. */
export function commitName({ hash, label }: ChunkCommit): string {
  return `${hash.slice(0, 10)} (${label})`;
}

/** The tips of the checked-out tree's history: HEAD, and MERGE_HEAD while a merge is in progress. */
async function checkoutTips(projectDir: string): Promise<string[]> {
  const merging = await git(projectDir, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD^{commit}']).catch(() => '');
  return merging.trim() === '' ? ['HEAD'] : ['HEAD', 'MERGE_HEAD'];
}

/** The chunk's commits, newest first, each with its parents and subject; with `unpushed`, only those on no remote-tracking branch. */
async function readChunkLog(projectDir: string, slug: string, unpushed = false): Promise<{ hash: string; parents: string[]; subject: string }[]> {
  let log: string;
  try {
    log = await git(projectDir, ['log', '--topo-order', '--format=%H%x09%P%x09%s', ...(await checkoutTips(projectDir)), ...(unpushed ? ['--not', '--remotes'] : []), '--']);
  } catch {
    throw new Error(
      `${projectDir} is not a git repository with commits.\n` +
        'The build skill commits every step (state-machine.md "Git Protocol"); initialise git and commit first.',
    );
  }
  const prefix = `chunk-${slug}/`;
  return log
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([, , subject]) => subject?.startsWith(prefix))
    .map(([hash, parents, subject]) => ({ hash, parents: parents.split(' ').filter(Boolean), subject }));
}

/** The chunk's commits, newest first, each with its parents and subject. Throws when there is none. */
async function chunkLog(projectDir: string, slug: string): Promise<{ hash: string; parents: string[]; subject: string }[]> {
  const commits = await readChunkLog(projectDir, slug);
  if (commits.length === 0) {
    throw new Error(
      `No commit for chunk "${slug}" yet: none of its commit messages starts with "chunk-${slug}/".\n` +
        `Commit each finished step as "chunk-${slug}/step-<name>" (state-machine.md "Git Protocol"), then run this again.`,
    );
  }
  return commits;
}

/** Every commit whose message starts with `chunk-<slug>/`. Throws when there is none. */
export async function findChunkCommits(projectDir: string, slug: string): Promise<Set<string>> {
  return new Set((await chunkLog(projectDir, slug)).map((c) => c.hash));
}

/** The full-ceremony steps before `spec`, the step that writes a chunk's tests (state-machine.md "Step Names"). */
const BEFORE_SPEC = new Set(['step-investigate', 'step-redteam', 'step-ask']);

/**
 * Whether every commit of the chunk is a step before `spec`, so it has no tests of its own yet
 * (#995). Read from its `chunk-<slug>/step-<name>` commits, the record of which steps it finished.
 */
export async function chunkBeforeSpec(projectDir: string, slug: string): Promise<boolean> {
  return (await chunkLog(projectDir, slug)).every((c) => isBeforeSpec(slug, c.subject));
}

const isBeforeSpec = (slug: string, subject: string) => BEFORE_SPEC.has(subject.slice(`chunk-${slug}/`.length).split(/[\s:]/)[0]);

/**
 * The chunk's commits named for a step before spec that changed files outside `design/`, oldest
 * first, each with those files (project-relative). Those steps write only design files, so game
 * code cannot arrive under their name and skip the tests spec writes (#1201). Only commits on no
 * remote-tracking branch are read, since pushed ones cannot be rewritten; a repository with no
 * remote has pushed nothing, so every commit is read.
 */
export async function preSpecCodeChanges(projectDir: string, slug: string): Promise<{ commit: ChunkCommit; files: string[] }[]> {
  const found: { commit: ChunkCommit; files: string[] }[] = [];
  for (const c of (await readChunkLog(projectDir, slug, true)).reverse()) {
    if (!isBeforeSpec(slug, c.subject)) continue;
    // --cc: a merge commit's own changes, the files it left unlike every parent.
    const changed = await git(projectDir, ['diff-tree', '--root', '--cc', '--no-commit-id', '--name-only', '-r', '-z', '--relative', c.hash]);
    const files = changed.split('\0').filter((f) => f !== '' && !f.startsWith(`${DESIGN_DIR}/`));
    if (files.length > 0) found.push({ commit: { hash: c.hash, label: c.subject }, files });
  }
  return found;
}

/** The first parent of the oldest of `commits` (newest first): the code as it stood before the chunk. */
const baseOf = (commits: Awaited<ReturnType<typeof chunkLog>>) => commits[commits.length - 1].parents[0];

/**
 * The chunk's history: its own commits, newest first, then its base commit when it has one (its
 * first commit may be the repository's first). Throws when the chunk has no commit yet.
 */
export async function chunkHistory(projectDir: string, slug: string): Promise<ChunkCommit[]> {
  const commits = await chunkLog(projectDir, slug);
  const history: ChunkCommit[] = commits.map((c) => ({ hash: c.hash, label: c.subject }));
  const base = baseOf(commits);
  return base === undefined ? history : [...history, { hash: base, label: `base of chunk-${slug}` }];
}

/**
 * The chunk's verify base: its base commit, where its work started. `boardsmith verify --chunk`
 * measures the change from here, and a chunk's sign-off accepts only a result whose base is this
 * commit or one before it (#452). Throws, saying what to do, when the chunk has no commit yet or
 * its first commit is the repository's first.
 */
export async function chunkVerifyBase(projectDir: string, slug: string): Promise<string> {
  const commits = await chunkLog(projectDir, slug);
  const base = baseOf(commits);
  if (base === undefined) {
    throw new Error(
      `Chunk "${slug}"'s first commit (${commits[commits.length - 1].hash.slice(0, 12)}) is the repository's first commit, ` +
        'so there is no commit before it to measure the chunk\'s change from. Commit the project as it stood before the ' +
        `chunk (its scaffold) first, then the chunk's work as "chunk-${slug}/step-<name>" commits.`,
    );
  }
  return base;
}

/** The commit of a chunk's history a pin names, or why it names none. */
export type PinnedCommit = { ok: true; commit: ChunkCommit } | { ok: false; problem: string };

/**
 * Resolves pins (`@<commit>`, a hash full or abbreviated) against chunk `slug`'s history, which is
 * read from git once, on the first pin.
 */
export function chunkPins(projectDir: string, slug: string): (ref: string) => Promise<PinnedCommit> {
  let history: Promise<ChunkCommit[]> | undefined;
  return async (ref) => {
    history ??= chunkHistory(projectDir, slug);
    try {
      return pinnedCommit(await history, slug, ref);
    } catch (error) {
      return { ok: false, problem: (error as Error).message.replace(/\n/g, ' ') };
    }
  };
}

function pinnedCommit(history: ChunkCommit[], slug: string, ref: string): PinnedCommit {
  const found = history.find((c) => c.hash.startsWith(ref.toLowerCase()));
  if (found) return { ok: true, commit: found };
  const listed = history.map((c) => `${c.hash.slice(0, 10)} (${c.label})`).join(', ');
  return {
    ok: false,
    problem: `${ref} is not a commit of chunk "${slug}". Pin a quote to the chunk's base commit or one of its own commits: ${listed}.`,
  };
}

/** The text of `rel` (project-relative) in `commit`, or `undefined` when that commit has no such file. */
export async function fileAtCommit(projectDir: string, commit: string, rel: string): Promise<string | undefined> {
  try {
    return await git(projectDir, ['show', `${commit}:./${rel}`]);
  } catch {
    return undefined;
  }
}
