import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { boardsmithPackageRoot } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';

/**
 * The outcomes of `boardsmith verify`'s mutants, kept so a re-verify runs only the mutants whose
 * outcome could have changed (#452).
 *
 * The bs- skills verify a chunk several times: at the end of `test`, before the designer's
 * sign-off, and as the last step of `close`. Between those runs they commit only design records
 * (the sign-off, the verified hash, the ledgers, the run log). Each run still does the full suite,
 * typecheck, build and validate for the commit it is on; this cache spares only the mutants.
 *
 * An outcome is stored under a key made of everything the whole-suite run under that mutant could
 * depend on:
 *
 * - the mutant: its file and the file's whole mutated text;
 * - every file of the REPOSITORY in the commit, by content, except the game's `BOOKKEEPING_RECORDS`.
 *   The whole repository, not the game folder: a game in a subfolder can depend on the root
 *   lockfile, a shared tsconfig or vitest config, or a sibling module, so a change to any of those
 *   is a change to what the tests run. The bookkeeping exclusions apply only to paths inside the
 *   game folder; a file of the same name elsewhere in the repository stays in the key;
 * - what is installed: npm's record of each install (`node_modules/.package-lock.json`) in the game
 *   folder and every folder above it, the folders Node resolves the tests' imports from. The
 *   committed lockfile says what should be installed; this says what is;
 * - the BoardSmith the game's tests load, resolved from the game folder as Node resolves
 *   `boardsmith` (`gameBoardsmithRoot`), and the BoardSmith running this command, which generates
 *   and runs the mutants; each named by `toolRevision`. Plus the Node version.
 *
 * So a commit that changes nothing but the game's bookkeeping reuses every outcome, and any other
 * change, however small, runs every mutant again. A mutant that ran past its time limit is never
 * stored: on a busy machine that can be the load, not the mutant, so it is tried again next time.
 *
 * What the key cannot see is a test that fails on its own now and then. A mutant that such a test
 * killed once stays `killed` for as long as the key holds, so a survivor hidden by a flaky test
 * comes to light only when the code, the tests, or the install next change. Fix the flaky test;
 * the cache is not where that shows.
 *
 * The cache is `.boardsmith/verify/mutants.json`, out of git like the results. `save` writes only
 * the outcomes the run looked up or recorded, so the file holds one run's worth and never grows;
 * a run that tried no mutant leaves it as it was.
 * `boardsmith verify` saves only when the tree stayed clean for the whole run, since the key is
 * computed from the commit and would not describe files edited mid-run.
 */

const CACHE_FORMAT = 2;

type CachedOutcome = 'killed' | 'survived';

/** A mutant as the cache sees it: which project file, and that file's whole mutated text. */
interface MutantText {
  file: string;
  source: string;
}

/**
 * The design records the bs- skills commit after a chunk's code and tests have been verified: the
 * sign-off and close bookkeeping in CHUNK.md, SKETCH.md and the ledgers, and the orchestrator's
 * run journal and run logs. Paths are relative to the game folder. Everything else in `design/`
 * stays in the key: a test may read `DESIGN.md` or a rulebook slice, and evidence can be a script.
 */
export const BOOKKEEPING_RECORDS: readonly RegExp[] = Object.freeze([
  /^design\/(SKETCH|DECISIONS|RULINGS|QUESTIONS|FILINGS|ASSETS|RUN|MERGE-SIGNOFFS|GATE-TRANSITION)\.md$/,
  /^design\/chunks\/[^/]+\/CHUNK\.md$/,
  /^design\/run-log\/[^/]+\.md$/,
]);

const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** `dir` and each of its parents, up to the filesystem root: the folders Node resolves packages from. */
function ancestors(dir: string): string[] {
  const dirs = [dir];
  for (let parent = dirname(dir); parent !== dirs[dirs.length - 1]; parent = dirname(parent)) dirs.push(parent);
  return dirs;
}

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(path);
  } catch {
    return undefined;
  }
}

/**
 * The BoardSmith package a game's tests load: the first `node_modules/boardsmith` in the game
 * folder or a folder above it, as Node resolves the import, with links followed. Undefined when
 * none is installed, as for a game whose tests import no BoardSmith.
 */
export async function gameBoardsmithRoot(projectDir: string): Promise<string | undefined> {
  for (const dir of ancestors(await fs.realpath(projectDir))) {
    const candidate = join(dir, 'node_modules', 'boardsmith');
    if ((await readIfPresent(join(candidate, 'package.json'))) !== undefined) return fs.realpath(candidate);
  }
  return undefined;
}

/**
 * The BoardSmith package at `root`, by name and version. A git checkout (as a game linked to a
 * local BoardSmith has) is also named by its commit and by the content of its uncommitted and
 * untracked changes, so editing BoardSmith is a new revision. An installed copy has no git of its
 * own, and a published version is immutable, so the version names it.
 */
export async function toolRevision(root: string): Promise<string> {
  const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf-8')) as { name: string; version: string };
  const release = `${pkg.name}@${pkg.version}`;
  let top: string;
  try {
    top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return release;
  }
  const [realTop, realRoot] = await Promise.all([fs.realpath(top), fs.realpath(root)]);
  if (realTop !== realRoot) return release;

  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const hash = createHash('sha256');
  hash.update(await git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']));
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    hash.update(await fs.readFile(join(root, path)));
  }
  return `${release} ${commit} ${hash.digest('hex')}`;
}

/** The BoardSmith running this command and the one the game loads, each named once. */
async function toolRevisions(projectDir: string): Promise<string> {
  const cli = await fs.realpath(boardsmithPackageRoot());
  const game = await gameBoardsmithRoot(projectDir);
  const revisions = await Promise.all([...new Set([cli, ...(game === undefined ? [] : [game])])].map(toolRevision));
  return `${revisions.join(' + ')}; game loads ${game === undefined ? 'no boardsmith' : game}`;
}

/**
 * The content of every file in the repository at HEAD, except the game folder's bookkeeping
 * records. The game folder is `git rev-parse --show-prefix`: empty when the game is the repository.
 */
async function repositoryTreeHash(projectDir: string): Promise<string> {
  const prefix = (await git(projectDir, ['rev-parse', '--show-prefix'])).trim();
  const isBookkeeping = (path: string) => path.startsWith(prefix) && BOOKKEEPING_RECORDS.some((re) => re.test(path.slice(prefix.length)));
  const listing = await git(projectDir, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  const entries = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { object: line.slice(0, tab), path: line.slice(tab + 1) };
    })
    .filter(({ path }) => !isBookkeeping(path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(entries.map(({ object, path }) => `${object}\t${path}`).join('\0'));
}

/**
 * npm's record of what each install put in place, for the game folder and every folder above it,
 * the folders Node resolves the tests' imports from. A folder with no install, or one made by a
 * tool that keeps no such record, contributes its absence.
 */
async function installedPackagesHash(projectDir: string): Promise<string> {
  const real = await fs.realpath(projectDir);
  const hash = createHash('sha256');
  for (const dir of ancestors(real)) {
    const record = await readIfPresent(join(dir, 'node_modules', '.package-lock.json'));
    hash.update(`\0${relative(real, dir)}\0`);
    hash.update(record ?? 'no install record');
  }
  return hash.digest('hex');
}

export function mutantCachePath(projectDir: string): string {
  return join(projectDir, '.boardsmith', 'verify', 'mutants.json');
}

async function readEntries(path: string): Promise<Map<string, CachedOutcome>> {
  try {
    const file = JSON.parse(await fs.readFile(path, 'utf-8')) as { format?: number; outcomes?: Record<string, CachedOutcome> };
    if (file.format !== CACHE_FORMAT || typeof file.outcomes !== 'object' || file.outcomes === null) return new Map();
    return new Map(Object.entries(file.outcomes).filter(([, o]) => o === 'killed' || o === 'survived'));
  } catch {
    return new Map();
  }
}

export interface MutantCache {
  /** The stored outcome of `mutant` for the project's HEAD, or undefined when it must run. */
  get(mutant: MutantText): CachedOutcome | undefined;
  set(mutant: MutantText, outcome: CachedOutcome): void;
  /**
   * Writes the outcomes this run looked up or recorded, and only those. A run that tried no mutant
   * (a red suite, or no code changed) learned nothing and leaves the file as it was.
   */
  save(): Promise<void>;
}

/** The cache for the commit checked out in `projectDir`, as its tests run with what is installed now. */
export async function openMutantCache(projectDir: string): Promise<MutantCache> {
  const path = mutantCachePath(projectDir);
  const [stored, tree, installed, tools] = await Promise.all([
    readEntries(path),
    repositoryTreeHash(projectDir),
    installedPackagesHash(projectDir),
    toolRevisions(projectDir),
  ]);
  const used = new Map<string, CachedOutcome>();
  const keyOf = (m: MutantText) =>
    sha256(JSON.stringify([CACHE_FORMAT, tools, process.version, tree, installed, m.file, sha256(m.source)]));

  return {
    get(mutant) {
      const key = keyOf(mutant);
      const outcome = stored.get(key);
      if (outcome !== undefined) used.set(key, outcome);
      return outcome;
    },
    set(mutant, outcome) {
      used.set(keyOf(mutant), outcome);
    },
    async save() {
      if (used.size === 0) return;
      await fs.mkdir(join(path, '..'), { recursive: true });
      const partial = `${path}.${process.pid}.tmp`;
      await fs.writeFile(partial, `${JSON.stringify({ format: CACHE_FORMAT, outcomes: Object.fromEntries(used) })}\n`);
      await fs.rename(partial, path);
    },
  };
}
