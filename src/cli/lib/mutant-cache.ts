import { createHash } from 'node:crypto';
import { sha256Hex } from './hash.js';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { isSameOrInside } from './path-inside.js';
import { boardsmithPackageRoot } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';
import { readIfExists } from './read-if-exists.js';

/**
 * The outcomes of `boardsmith verify`'s mutants, kept so a re-verify runs only the mutants whose
 * outcome could have changed (#452).
 *
 * The bs- skills verify a chunk several times: at the end of `test`, before the designer's
 * sign-off, and as the last step of `close`. Between those runs they commit only design records
 * (the sign-off, the verified hash, the ledgers, the run log). Each run still does the full suite,
 * typecheck, build and validate for the commit it is on; this cache spares only the mutants.
 *
 * An outcome is stored under a key made of everything the run under that mutant could depend on.
 * That run is of the test files that loaded the mutant's file in the unmutated run of the whole
 * suite (#981), and which files those are is decided by the same things the key holds (the
 * repository's files, what is installed, and the BoardSmith that records it), so an outcome is
 * never reused for a different choice of test files. Format 5 marks outcomes from such runs; one
 * from a whole-suite run is not read. The key holds:
 *
 * - the mutant: the game folder within the repository, its file, and the file's whole mutated text;
 * - every file of the REPOSITORY in the commit, by content, except the game's `BOOKKEEPING_RECORDS`.
 *   The whole repository, not the game folder: a game in a subfolder can depend on the root
 *   lockfile, a shared tsconfig or vitest config, or a sibling module, so a change to any of those
 *   is a change to what the tests run. The bookkeeping exclusions apply only to paths inside the
 *   game folder; a file of the same name elsewhere in the repository stays in the key;
 * - what is installed: npm's record of each install (`node_modules/.package-lock.json`) in the game
 *   folder and every folder above it, the folders Node resolves the tests' imports from, in the
 *   order Node tries them. The committed lockfile says what should be installed; this says what is.
 *   A folder with no install, or one whose record repeats an earlier one in that order, changes
 *   nothing Node resolves, so it is left out: a worktree whose `node_modules` links to the main
 *   checkout's resolves exactly what the main checkout does, though the main checkout's own
 *   `node_modules` also sits above it;
 * - every package installed as a link to a folder outside the repository (`"dep": "file:../dep"`),
 *   by that folder's content (`linkedPackagesHash`): npm's install record names the link, not what
 *   is behind it, so without this an edit to the sibling would reuse every outcome (#484). When a
 *   linked folder cannot be read, nothing is cached for the run (`MutantCache.unavailable`), since
 *   an outcome reused across a change the key missed would hide a surviving mutant;
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
 * Nothing in the key names the checkout, so an outcome holds in every checkout of the repository.
 * The cache is therefore `boardsmith/verify/mutants.json` in the git common directory
 * (`git rev-parse --git-common-dir`), the one file the main checkout and all its worktrees share: a
 * thread merge whose tree is the one its worktree verified reuses every outcome the worktree
 * recorded (#477). It holds up to `MAX_STORED_OUTCOMES` outcomes, the most recently used first;
 * `save` puts the ones this run looked up or recorded in front of those already on file and drops
 * the oldest past the limit, so two checkouts verifying in turn do not evict each other. A run that
 * tried no mutant leaves the file as it was. Two runs saving at the same moment can lose one run's
 * new outcomes, which costs only running those mutants again; each save writes all of the run's
 * outcomes again, so the next one puts back what an overlapping save dropped.
 * `boardsmith verify` saves after each mutant it runs, so an interrupted run keeps every finished
 * outcome (#940). A save is about 10ms for a full file (1.6MB), next to a mutant's run of the test
 * files that load its file, which takes seconds. It saves only while the tree is clean, since the key is computed from the commit and
 * would not describe files edited mid-run. It also captures the execution context
 * (`captureExecutionContext`) once when it starts, keys the cache by that capture, and refuses the
 * rest of the run, keeping nothing more, when the context changed before or while a mutant ran, or
 * by its end (#932, #940): outcomes from a mixed run would be stored under a key they do not fit.
 *
 * Beside the outcomes, `killer-hints.json` keeps, for each mutation, the test that last failed on
 * an assertion of its own under it (#954), and drops it when a run finds none. It is keyed by the game
 * folder, the mutant's file, the line it changes and the change alone (#1308), so it outlives the
 * changes that make the outcome run again, edits elsewhere in the file included, and it is kept
 * even when outcomes cannot be. It is only advice on which test to try first:
 * `runDiffMutationCheck` still decides the outcome from a run made now.
 */

const CACHE_FORMAT = 5;

/** The killer hints (#954), beside the outcomes and kept apart from them, since a hint is never an outcome. */
const KILLER_HINTS_NAME = 'killer-hints.json';
const KILLER_HINTS_FORMAT = 1;

/** How many outcomes the shared cache keeps: many runs' worth, at about 80 bytes each. */
export const MAX_STORED_OUTCOMES = 20_000;

type CachedOutcome = 'killed' | 'survived';

/** A mutant as the cache sees it: which project file, and that file's whole mutated text. */
interface MutantText {
  file: string;
  source: string;
}

/** A mutant as its killer hint is keyed: also the change, where `offset` is in the unmutated text and `after` replaced `before`. */
interface MutantChange extends MutantText {
  change: { offset: number; before: string; after: string };
}

/**
 * The design records the bs- skills commit after a chunk's code and tests have been verified: the
 * sign-off and close bookkeeping in CHUNK.md, SKETCH.md and the ledgers, and the orchestrator's
 * run journal and run logs. Paths are relative to the game folder. Everything else in `design/`
 * stays in the key: a test may read `DESIGN.md` or a rulebook slice, and evidence can be a script.
 */
export const BOOKKEEPING_RECORDS: readonly RegExp[] = Object.freeze([
  // The signed ledger is checked separately; its commit cannot invalidate the IDs it approves.
  /^design\/MUTATION-EQUIVALENCES\.json$/,
  /^design\/(SKETCH|DECISIONS|RULINGS|QUESTIONS|FILINGS|ASSETS|RUN|MERGE-SIGNOFFS|GATE-TRANSITION)\.md$/,
  /^design\/chunks\/[^/]+\/CHUNK\.md$/,
  /^design\/run-log\/[^/]+\.md$/,
]);

/** `dir` and each of its parents, up to the filesystem root: the folders Node resolves packages from. */
function ancestors(dir: string): string[] {
  const dirs = [dir];
  for (let parent = dirname(dir); parent !== dirs[dirs.length - 1]; parent = dirname(parent)) dirs.push(parent);
  return dirs;
}

/**
 * The BoardSmith package a game's tests load: the first `node_modules/boardsmith` in the game
 * folder or a folder above it, as Node resolves the import, with links followed. Undefined when
 * none is installed, as for a game whose tests import no BoardSmith.
 */
export async function gameBoardsmithRoot(projectDir: string): Promise<string | undefined> {
  for (const dir of ancestors(await fs.realpath(projectDir))) {
    const candidate = join(dir, 'node_modules', 'boardsmith');
    if ((await readIfExists(join(candidate, 'package.json'), fs.readFile)) !== undefined) return fs.realpath(candidate);
  }
  return undefined;
}

/**
 * A git checkout at `root` named by its commit and by the content of its uncommitted and untracked
 * changes. Undefined when `root` is not the top of a git checkout.
 */
async function checkoutRevision(root: string): Promise<string | undefined> {
  let top: string;
  try {
    top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return undefined;
  }
  const [realTop, realRoot] = await Promise.all([fs.realpath(top), fs.realpath(root)]);
  if (realTop !== realRoot) return undefined;

  const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
  return `${commit} ${await uncommittedContentHash(root)}`;
}

/**
 * The content of the uncommitted and untracked changes in the checkout at `root` (its top), as one
 * hash: equal for two checkouts of the same commit exactly when their working trees hold the same
 * changes. Files git ignores are not in it.
 */
export async function uncommittedContentHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await git(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']));
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  for (const path of untracked) {
    hash.update(`\0${path}\0`);
    try {
      hash.update(await fs.readFile(join(root, path)));
    } catch (error) {
      throw new Error(`could not read untracked ${path} in ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return hash.digest('hex');
}

/** Which of `paths` (relative to `root`, the top of a checkout) git ignores, whether or not they exist, in one git call. */
async function ignoredByGit(root: string, paths: readonly string[]): Promise<Set<string>> {
  try {
    return new Set((await git(root, ['check-ignore', '--', ...paths])).split('\n').filter(Boolean));
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return new Set();
    throw error;
  }
}

/** Every file path a package.json field names: `main`, `module`, and each target in `exports`. */
function entryTargets(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) entryTargets(item, into);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) entryTargets(item, into);
  return into;
}

/**
 * The folder inside the package at `root` that the entry target `target` reaches, as path parts,
 * and whether the target is a `*` pattern. A pattern reaches the folder before its `*`; a plain
 * path, the folder holding it. Throws when that is the whole package or lies outside it.
 */
function entryScope(root: string, target: string): { parts: string[]; star: boolean } {
  const star = target.indexOf('*');
  const fixed = star === -1 ? target : target.slice(0, star);
  const scope = relative(root, join(root, star === -1 || fixed.endsWith('/') ? fixed : dirname(fixed)));
  if (scope === '') throw new Error(`the package in ${root} exports "${target}", which reaches every file in it, so the files git ignores cannot be bounded`);
  if (scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) {
    throw new Error(`the package in ${root} names "${target}", which is outside the package`);
  }
  return { parts: scope.split(sep), star: star !== -1 };
}

/** Each folder `parts` names, from the top down. */
const prefixes = (parts: string[]) => parts.map((_, n) => parts.slice(0, n + 1).join('/'));

/** Every ignored file or folder under the folder `parts` names, except those inside `node_modules`. */
async function ignoredUnder(root: string, parts: string[]): Promise<string[]> {
  const listing = await git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', `${parts.join('/')}/`]);
  return listing
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ''))
    .filter((path) => !path.split('/').includes('node_modules'));
}

/**
 * The git-ignored files a linked checkout's package exposes, by content: `checkoutRevision` sees
 * only what git tracks or would track, and a package often loads build output git ignores.
 *
 * Each target of `main`, `module` and `exports` (or `index.js`, Node's default, when none is
 * given) is looked at as a path. For a plain path, the outermost ignored folder holding it, or the
 * file itself when only it is ignored, is hashed whole, so files the entry point imports beside it
 * count too. A `*` pattern reaches every file under the folder before the `*`, so every ignored
 * file or folder under it counts, except those inside `node_modules`, which install records name.
 * A pattern that reaches the whole package, and a target outside it, cannot be bounded, and throw.
 */
async function ignoredEntryPointsHash(root: string): Promise<string> {
  const manifest = await readIfExists(join(root, 'package.json'), fs.readFile);
  const pkg = (manifest === undefined ? {} : JSON.parse(manifest.toString('utf-8'))) as Record<string, unknown>;
  const targets = entryTargets([pkg.main, pkg.module, pkg.exports]);
  if (targets.length === 0) targets.push('index.js');

  const hashed = new Map<string, string>();
  const hashPath = async (path: string) => {
    if (hashed.has(path)) return;
    const full = join(root, path);
    const stat = await readIfExists(full, fs.stat);
    hashed.set(path, stat === undefined ? 'absent' : stat.isDirectory() ? await folderContentHash(full) : sha256Hex(await fs.readFile(full)));
  };
  const scopes = targets.map((target) => entryScope(root, target));
  const ignoredPaths = await ignoredByGit(root, [...new Set(scopes.flatMap(({ parts }) => prefixes(parts)))]);
  for (const { parts, star } of scopes) {
    const ignored = prefixes(parts).find((prefix) => ignoredPaths.has(prefix));
    if (ignored !== undefined) await hashPath(ignored);
    else if (star) for (const path of await ignoredUnder(root, parts)) await hashPath(path);
  }
  return sha256Hex(JSON.stringify([...hashed].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
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
  const checkout = await checkoutRevision(root);
  return checkout === undefined ? release : `${release} ${checkout}`;
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
const isBookkeeping = (prefix: string, path: string) => path.startsWith(prefix) && BOOKKEEPING_RECORDS.some((re) => re.test(path.slice(prefix.length)));

async function repositoryTreeHash(projectDir: string, treeRef: string): Promise<string> {
  const prefix = (await git(projectDir, ['rev-parse', '--show-prefix'])).trim();
  const listing = await git(projectDir, ['ls-tree', '-r', '-z', '--full-tree', treeRef]);
  const entries = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { object: line.slice(0, tab), path: line.slice(tab + 1) };
    })
    .filter(({ path }) => !isBookkeeping(prefix, path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(entries.map(({ object, path }) => `${object}\t${path}`).join('\0'));
}

/**
 * npm's record of what each install put in place, for the game folder and every folder above it,
 * in the order Node resolves the tests' imports from them. A folder with no install (or one made by
 * a tool that keeps no such record), and a record equal to one nearer the game, are left out: Node
 * finds every package such an install holds in the nearer one first. So the hash says what the
 * tests resolve, not where the checkout is.
 */
async function installedPackagesHash(projectDir: string): Promise<string> {
  const records: string[] = [];
  for (const dir of ancestors(await fs.realpath(projectDir))) {
    const record = await readIfExists(join(dir, 'node_modules', '.package-lock.json'), fs.readFile);
    if (record === undefined) continue;
    const digest = sha256Hex(record);
    if (!records.includes(digest)) records.push(digest);
  }
  return sha256Hex(records.join('\0'));
}

/**
 * Every file under `dir` by path and content, with a link inside it named by where it points, so
 * a folder git does not track is fingerprinted, and so is a build output git ignores. `node_modules`
 * and `.git` are left out: what is installed is named by the install records, and git's own store
 * is not something a test loads.
 */
async function folderContentHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(folder: string): Promise<void> {
    const entries = (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(folder, entry.name);
      const name = relative(dir, path);
      if (entry.isSymbolicLink()) hash.update(`\0link ${name}\0${await fs.readlink(path)}`);
      else if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') await walk(path);
      } else if (entry.isFile()) {
        hash.update(`\0file ${name}\0`);
        hash.update(await fs.readFile(path));
      }
    }
  }
  await walk(dir);
  return hash.digest('hex');
}

/** The links in `dir/node_modules`, scoped packages included, each with the path it is reached by. */
async function installedLinks(nodeModules: string): Promise<string[]> {
  const links: string[] = [];
  const entries = await readIfExists(nodeModules, (p) => fs.readdir(p, { withFileTypes: true }));
  for (const entry of entries ?? []) {
    if (entry.name.startsWith('.')) continue;
    const path = join(nodeModules, entry.name);
    if (entry.isSymbolicLink()) links.push(path);
    else if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const scoped of await fs.readdir(path, { withFileTypes: true })) {
        if (scoped.isSymbolicLink()) links.push(join(path, scoped.name));
      }
    }
  }
  return links;
}

/**
 * What names the linked folder `target` in the key: `checkoutRevision` and the ignored files its
 * package exposes when it is the top of a git checkout, otherwise every file in it. Throws, naming
 * the folder and `link`, when it cannot be read.
 */
async function linkedFolderName(target: string, link: string): Promise<string> {
  try {
    const checkout = await checkoutRevision(target);
    return checkout === undefined ? `content ${await folderContentHash(target)}` : `${checkout} ${await ignoredEntryPointsHash(target)}`;
  } catch (error) {
    throw new Error(`could not read ${target}, linked from ${link}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Every package the tests can load through a link to a folder outside the repository, by that
 * folder's content. npm installs `"dep": "file:../dep"` as such a link, and its install record names
 * the link, not what is behind it.
 *
 * The links looked at are those in `node_modules` of the game folder and every folder above it,
 * then, for each linked folder, those its own imports resolve through (its `node_modules` and the
 * folders above it), with the install records of those folders that are not above the game too. A link into the repository is
 * left out, since its files are in the key already, and so is a link into a `node_modules`
 * folder, as an install record names that package. A linked folder is named by its path and, when
 * it is the top of a git checkout, by `checkoutRevision` plus the ignored files its package
 * exposes (`ignoredEntryPointsHash`), otherwise by every file in it (`folderContentHash`); a link whose folder is missing is named by where it points. Nothing names
 * the link's own location, so a worktree whose `node_modules` links to the main checkout's resolves
 * to the same key as the main checkout. A folder that cannot be read throws.
 */
async function linkedPackagesHash(projectDir: string): Promise<string> {
  const repository = await fs.realpath((await git(projectDir, ['rev-parse', '--show-toplevel'])).trim());
  const game = await fs.realpath(projectDir);
  // The install records here are in the key already (`installedPackagesHash`).
  const gameFolders = new Set(ancestors(game));
  const named = new Map<string, string>();
  const scanned = new Set<string>();

  async function visitLink(link: string): Promise<void> {
    let target: string;
    try {
      target = await fs.realpath(link);
    } catch {
      const points = await fs.readlink(link);
      named.set(`missing ${link}`, points);
      return;
    }
    if (named.has(target) || isSameOrInside(repository, target) || target.split(sep).includes('node_modules')) return;
    named.set(target, await linkedFolderName(target, link));
    await scan(target);
  }

  async function scan(from: string): Promise<void> {
    for (const dir of ancestors(from)) {
      if (scanned.has(dir)) continue;
      scanned.add(dir);
      const record = await readIfExists(join(dir, 'node_modules', '.package-lock.json'), fs.readFile);
      if (record !== undefined && !gameFolders.has(dir)) named.set(`record ${dir}`, sha256Hex(record));
      for (const link of await installedLinks(join(dir, 'node_modules'))) await visitLink(link);
    }
  }
  await scan(game);
  return sha256Hex(JSON.stringify([...named].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

/** The cache file, in the git common directory every checkout of the repository shares. */
export async function mutantCachePath(projectDir: string): Promise<string> {
  const common = (await git(projectDir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return join(await fs.realpath(common), 'boardsmith', 'verify', 'mutants.json');
}

/** The entries of a list kept in the cache directory, the most recently used first; `valid` says which to keep. */
async function readEntries<T>(path: string, format: number, valid: (value: unknown) => value is T): Promise<Map<string, T>> {
  // A cache: any file it cannot read or parse only means every mutant runs again.
  try {
    const file = JSON.parse(await fs.readFile(path, 'utf-8')) as { format?: number; outcomes?: unknown };
    if (file.format !== format || !Array.isArray(file.outcomes)) return new Map();
    return new Map((file.outcomes as unknown[]).filter((e): e is [string, T] => Array.isArray(e) && typeof e[0] === 'string' && valid(e[1])));
  } catch {
    return new Map();
  }
}

/**
 * Puts `used` in front of the entries on file now, keeping up to `MAX_STORED_OUTCOMES`, and drops the keys
 * `used` holds as undefined; leaves the file alone when `used` is empty.
 */
async function saveEntries<T>(path: string, format: number, valid: (value: unknown) => value is T, used: Map<string, T | undefined>): Promise<void> {
  if (used.size === 0) return;
  // Read again: another checkout may have saved since this run opened the cache.
  const onFile = await readEntries(path, format, valid);
  const outcomes = [...used, ...[...onFile].filter(([key]) => !used.has(key))].filter(([, value]) => value !== undefined).slice(0, MAX_STORED_OUTCOMES);
  await fs.mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify({ format, outcomes })}\n`);
  await fs.rename(partial, path);
}

const isOutcome = (value: unknown): value is CachedOutcome => value === 'killed' || value === 'survived';

const isKillerHint = (value: unknown): value is KillerHint =>
  typeof (value as KillerHint | null)?.file === 'string' && typeof (value as KillerHint).test === 'string';

export interface MutationFingerprints {
  /**
   * Why this run keeps no outcomes, when it does not: something the tests load could not be
   * fingerprinted, so no outcome may be trusted or stored. Undefined when the cache works.
   */
  readonly unavailable?: string;
  /** The exact mutant and execution context, unavailable when that context cannot be read. */
  fingerprint(mutant: MutantText | { file: string; sourceHash: string }): string | undefined;
}

/** The test that last failed on an assertion of its own under a mutant: its test file in the project, and its full name. */
export interface KillerHint {
  file: string;
  test: string;
}

export interface MutantCache extends MutationFingerprints {
  /** The stored outcome of `mutant` for the project's HEAD, or undefined when it must run. */
  get(mutant: MutantChange): CachedOutcome | undefined;
  set(mutant: MutantText, outcome: CachedOutcome): void;
  /**
   * The test that killed this mutation in an earlier run, whatever else has changed since (#954).
   * Only advice on which test to try first: it is never evidence of an outcome.
   */
  killerHint(mutant: MutantChange): KillerHint | undefined;
  /** Records the test that killed `mutant` on its own assertion in a run made now; undefined, when none did, drops its hint. */
  setKillerHint(mutant: MutantChange, hint: KillerHint | undefined): void;
  /**
   * Puts the outcomes and hints this run looked up or recorded in front of those on file now, keeping
   * up to `MAX_STORED_OUTCOMES` of each. A run that tried no mutant (a red suite, or no code changed)
   * learned nothing and leaves the files as they were.
   */
  save(): Promise<void>;
}

/**
 * What the tests run with besides the repository's own files: the BoardSmith running this command
 * and the one the game loads (`toolRevisions`), what is installed, and every package linked from
 * outside the repository. Each is named in words, so `executionContextChange` can say which moved.
 */
export interface ExecutionContext {
  readonly parts: Readonly<Record<'boardsmith' | 'installed' | 'linked', string>>;
  /** Why no mutant outcome may be trusted or stored this run, when a linked package cannot be read. */
  readonly unavailable?: string;
}

const PART_NAMES: Readonly<Record<keyof ExecutionContext['parts'], string>> = {
  boardsmith: 'the BoardSmith this command runs and the game loads',
  installed: "the installed packages (npm's install records)",
  linked: 'the packages linked from outside the repository',
};

/** Reads the execution context of the game in `projectDir` as it stands now. */
export async function captureExecutionContext(projectDir: string): Promise<ExecutionContext> {
  let linked: string;
  let unavailable: string | undefined;
  try {
    linked = await linkedPackagesHash(projectDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    linked = `unreadable: ${reason}`;
    unavailable = `the mutant cache is off for this run: ${reason}`;
  }
  const [installed, boardsmith] = await Promise.all([installedPackagesHash(projectDir), toolRevisions(projectDir)]);
  return { parts: { boardsmith, installed, linked }, ...(unavailable === undefined ? {} : { unavailable }) };
}

/**
 * What changed in the execution context since `before` was captured, in words, or undefined when
 * nothing did. The BoardSmith revisions are shown before and after, since a person can read them.
 */
export async function executionContextChange(projectDir: string, before: ExecutionContext): Promise<string | undefined> {
  const now = await captureExecutionContext(projectDir);
  const changed = (Object.keys(PART_NAMES) as (keyof ExecutionContext['parts'])[])
    .filter((part) => now.parts[part] !== before.parts[part])
    .map((part) => (part === 'boardsmith' ? `${PART_NAMES[part]} (was ${before.parts[part]}, now ${now.parts[part]})` : PART_NAMES[part]));
  return changed.length === 0 ? undefined : changed.join('; ');
}

async function mutationFingerprints(projectDir: string, context: ExecutionContext, prefix: string): Promise<MutationFingerprints> {
  if (context.unavailable !== undefined) return { unavailable: context.unavailable, fingerprint: () => undefined };
  const { boardsmith, installed, linked } = context.parts;
  const tree = await repositoryTreeHash(projectDir, 'HEAD');
  return { fingerprint: (m) => sha256Hex(JSON.stringify([CACHE_FORMAT, boardsmith, process.version, tree, installed, linked, prefix, m.file, 'source' in m ? sha256Hex(m.source) : m.sourceHash])) };
}

/**
 * The key of a mutant's killer hint: its game folder, file, the mutated text of the line it changes, which
 * of the file's lines with that unmutated text it is, and the change.
 */
function hintKey(prefix: string, { file, source, change }: MutantChange): string {
  const lineStart = source.lastIndexOf('\n', change.offset - 1) + 1;
  const lineEnd = source.indexOf('\n', change.offset + change.after.length);
  const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const column = change.offset - lineStart;
  const unmutated = line.slice(0, column) + change.before + line.slice(column + change.after.length);
  const copy = source.slice(0, lineStart).split('\n').filter((l) => l === unmutated).length;
  return sha256Hex(JSON.stringify([prefix, file, line, copy, column, change.before, change.after]));
}

/**
 * The cache for the commit checked out in `projectDir`, as its tests run in `context` (by default,
 * what is installed now). `boardsmith verify` hands in the context it captured when it started, so
 * the outcomes it stores are keyed by the context it checks again before saving them. When that
 * context cannot be fingerprinted it holds no outcomes, but still its killer hints.
 */
export async function openMutantCache(projectDir: string, context?: ExecutionContext): Promise<MutantCache> {
  const path = await mutantCachePath(projectDir);
  const prefix = (await git(projectDir, ['rev-parse', '--show-prefix'])).trim();
  const fingerprints = await mutationFingerprints(projectDir, context ?? (await captureExecutionContext(projectDir)), prefix);
  const hintsPath = join(dirname(path), KILLER_HINTS_NAME);
  const stored = fingerprints.unavailable === undefined ? await readEntries(path, CACHE_FORMAT, isOutcome) : new Map<string, CachedOutcome>();
  const storedHints = await readEntries(hintsPath, KILLER_HINTS_FORMAT, isKillerHint);
  const used = new Map<string, CachedOutcome>();
  const usedHints = new Map<string, KillerHint | undefined>();

  return {
    ...fingerprints,
    get(mutant) {
      const key = fingerprints.fingerprint(mutant);
      const outcome = key === undefined ? undefined : stored.get(key);
      if (outcome === undefined) return undefined;
      used.set(key!, outcome);
      // A reused outcome keeps its hint in use too, so the hint is there when the outcome next runs.
      const hint = hintKey(prefix, mutant);
      if (!usedHints.has(hint) && storedHints.has(hint)) usedHints.set(hint, storedHints.get(hint));
      return outcome;
    },
    set(mutant, outcome) {
      const key = fingerprints.fingerprint(mutant);
      if (key !== undefined) used.set(key, outcome);
    },
    killerHint(mutant) {
      const key = hintKey(prefix, mutant);
      return usedHints.has(key) ? usedHints.get(key) : storedHints.get(key);
    },
    setKillerHint(mutant, hint) {
      usedHints.set(hintKey(prefix, mutant), hint);
    },
    async save() {
      if (fingerprints.unavailable === undefined) await saveEntries(path, CACHE_FORMAT, isOutcome, used);
      await saveEntries(hintsPath, KILLER_HINTS_FORMAT, isKillerHint, usedHints);
    },
  };
}
