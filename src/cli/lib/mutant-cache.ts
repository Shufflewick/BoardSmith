import { createHash } from 'node:crypto';
import { sha256Hex } from './hash.js';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
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
 * new outcomes, which costs only running those mutants again.
 * `boardsmith verify` saves only when the tree stayed clean for the whole run, since the key is
 * computed from the commit and would not describe files edited mid-run.
 */

const CACHE_FORMAT = 4;

/** How many outcomes the shared cache keeps: many runs' worth, at about 80 bytes each. */
export const MAX_STORED_OUTCOMES = 20_000;

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
  return `${commit} ${hash.digest('hex')}`;
}

/** True when git ignores `path` (relative to `root`, the top of a checkout), whether or not it exists. */
async function ignoredByGit(root: string, path: string): Promise<boolean> {
  try {
    await git(root, ['check-ignore', '-q', '--', path]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
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
  const manifest = await readIfPresent(join(root, 'package.json'));
  const pkg = (manifest === undefined ? {} : JSON.parse(manifest.toString('utf-8'))) as Record<string, unknown>;
  const targets = entryTargets([pkg.main, pkg.module, pkg.exports]);
  if (targets.length === 0) targets.push('index.js');

  const hashed = new Map<string, string>();
  const hashPath = async (path: string) => {
    if (hashed.has(path)) return;
    const full = join(root, path);
    const stat = await fs.stat(full).catch(() => undefined);
    hashed.set(path, stat === undefined ? 'absent' : stat.isDirectory() ? await folderContentHash(full) : sha256Hex(await fs.readFile(full)));
  };
  for (const target of targets) {
    const star = target.indexOf('*');
    const fixed = star === -1 ? target : target.slice(0, star);
    const scope = relative(root, join(root, star === -1 || fixed.endsWith('/') ? fixed : dirname(fixed)));
    if (scope === '') throw new Error(`the package in ${root} exports "${target}", which reaches every file in it, so the files git ignores cannot be bounded`);
    if (scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) {
      throw new Error(`the package in ${root} names "${target}", which is outside the package`);
    }
    const parts = scope.split(sep);
    let ignored: string | undefined;
    for (let n = 1; n <= parts.length && ignored === undefined; n++) {
      const prefix = parts.slice(0, n).join('/');
      if (await ignoredByGit(root, prefix)) ignored = prefix;
    }
    if (ignored !== undefined) await hashPath(ignored);
    else if (star !== -1) {
      const listing = await git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--', `${parts.join('/')}/`]);
      for (const entry of listing.split('\0').filter(Boolean)) {
        const path = entry.replace(/\/$/, '');
        if (!path.split('/').includes('node_modules')) await hashPath(path);
      }
    }
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
    const record = await readIfPresent(join(dir, 'node_modules', '.package-lock.json'));
    if (record === undefined) continue;
    const digest = sha256Hex(record);
    if (!records.includes(digest)) records.push(digest);
  }
  return sha256Hex(records.join('\0'));
}

/** True when `path` is `dir` or lies inside it. */
function within(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
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
  let entries;
  try {
    entries = await fs.readdir(nodeModules, { withFileTypes: true });
  } catch {
    return links;
  }
  for (const entry of entries) {
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
export async function linkedPackagesHash(projectDir: string): Promise<string> {
  const repository = await fs.realpath((await git(projectDir, ['rev-parse', '--show-toplevel'])).trim());
  const game = await fs.realpath(projectDir);
  // The install records here are in the key already (`installedPackagesHash`).
  const gameFolders = new Set(ancestors(game));
  const named = new Map<string, string>();
  const scanned = new Set<string>();

  async function scan(from: string): Promise<void> {
    for (const dir of ancestors(from)) {
      if (scanned.has(dir)) continue;
      scanned.add(dir);
      const record = await readIfPresent(join(dir, 'node_modules', '.package-lock.json'));
      if (record !== undefined && !gameFolders.has(dir)) named.set(`record ${dir}`, sha256Hex(record));
      for (const link of await installedLinks(join(dir, 'node_modules'))) {
        let target: string;
        try {
          target = await fs.realpath(link);
        } catch {
          const points = await fs.readlink(link);
          named.set(`missing ${link}`, points);
          continue;
        }
        if (named.has(target) || within(repository, target) || target.split(sep).includes('node_modules')) continue;
        named.set(target, '');
        try {
          const checkout = await checkoutRevision(target);
          named.set(target, checkout === undefined ? `content ${await folderContentHash(target)}` : `${checkout} ${await ignoredEntryPointsHash(target)}`);
        } catch (error) {
          throw new Error(`could not read ${target}, linked from ${link}: ${error instanceof Error ? error.message : String(error)}`);
        }
        await scan(target);
      }
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

/** The outcomes on file, the most recently used first. */
async function readEntries(path: string): Promise<Map<string, CachedOutcome>> {
  try {
    const file = JSON.parse(await fs.readFile(path, 'utf-8')) as { format?: number; outcomes?: unknown };
    if (file.format !== CACHE_FORMAT || !Array.isArray(file.outcomes)) return new Map();
    return new Map(
      (file.outcomes as unknown[]).filter(
        (e): e is [string, CachedOutcome] => Array.isArray(e) && typeof e[0] === 'string' && (e[1] === 'killed' || e[1] === 'survived'),
      ),
    );
  } catch {
    return new Map();
  }
}

export interface MutantCache {
  /**
   * Why this run keeps no outcomes, when it does not: something the tests load could not be
   * fingerprinted, so no outcome may be trusted or stored. Undefined when the cache works.
   */
  readonly unavailable?: string;
  /** The stored outcome of `mutant` for the project's HEAD, or undefined when it must run. */
  get(mutant: MutantText): CachedOutcome | undefined;
  set(mutant: MutantText, outcome: CachedOutcome): void;
  /**
   * Puts the outcomes this run looked up or recorded in front of those on file now, keeping up to
   * `MAX_STORED_OUTCOMES`. A run that tried no mutant (a red suite, or no code changed) learned
   * nothing and leaves the file as it was.
   */
  save(): Promise<void>;
}

/** The cache for the commit checked out in `projectDir`, as its tests run with what is installed now. */
export async function openMutantCache(projectDir: string): Promise<MutantCache> {
  const path = await mutantCachePath(projectDir);
  let linked: string;
  try {
    linked = await linkedPackagesHash(projectDir);
  } catch (error) {
    return uncached(`the mutant cache is off for this run: ${error instanceof Error ? error.message : String(error)}`);
  }
  const [stored, prefix, tree, installed, tools] = await Promise.all([
    readEntries(path),
    git(projectDir, ['rev-parse', '--show-prefix']).then((p) => p.trim()),
    repositoryTreeHash(projectDir),
    installedPackagesHash(projectDir),
    toolRevisions(projectDir),
  ]);
  const used = new Map<string, CachedOutcome>();
  const keyOf = (m: MutantText) =>
    sha256Hex(JSON.stringify([CACHE_FORMAT, tools, process.version, tree, installed, linked, prefix, m.file, sha256Hex(m.source)]));

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
      // Read again: another checkout may have saved since this run opened the cache.
      const onFile = await readEntries(path);
      const outcomes = [...used, ...[...onFile].filter(([key]) => !used.has(key))].slice(0, MAX_STORED_OUTCOMES);
      await fs.mkdir(dirname(path), { recursive: true });
      const partial = `${path}.${process.pid}.tmp`;
      await fs.writeFile(partial, `${JSON.stringify({ format: CACHE_FORMAT, outcomes })}\n`);
      await fs.rename(partial, path);
    },
  };
}

/** A cache that holds nothing and stores nothing, for a run whose key could not be computed. */
function uncached(reason: string): MutantCache {
  return {
    unavailable: reason,
    get: () => undefined,
    set: () => {},
    save: async () => {},
  };
}
