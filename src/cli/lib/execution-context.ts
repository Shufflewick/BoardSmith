/**
 * What a game's tests run with besides the repository's own files (#932): the BoardSmith running
 * this command and the one the game loads, what is installed, and every package installed as a link
 * to a folder outside the repository. `boardsmith verify` captures it when it starts and refuses to
 * record a result when it changed by the end, since checks after the change ran against different code.
 *
 * - what is installed: npm's record of each install (`node_modules/.package-lock.json`) in the game
 *   folder and every folder above it, the folders Node resolves the tests' imports from, in the
 *   order Node tries them. A folder with no install, or one whose record repeats an earlier one in
 *   that order, changes nothing Node resolves, so it is left out: a worktree whose `node_modules`
 *   links to the main checkout's resolves exactly what the main checkout does;
 * - every package installed as a link to a folder outside the repository (`"dep": "file:../dep"`),
 *   by that folder's content (`linkedPackagesHash`): npm's install record names the link, not what
 *   is behind it (#484). When a linked folder cannot be read, the context names why instead;
 * - the BoardSmith the game's tests load, resolved from the game folder as Node resolves
 *   `boardsmith` (`gameBoardsmithRoot`), and the BoardSmith running this command; each named by
 *   `toolRevision`.
 */
import { createHash } from 'node:crypto';
import { sha256Hex } from './hash.js';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { isSameOrInside } from './path-inside.js';
import { boardsmithPackageRoot } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';
import { readIfExists } from './read-if-exists.js';

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
async function gameBoardsmithRoot(projectDir: string): Promise<string | undefined> {
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
async function toolRevision(root: string): Promise<string> {
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
 * What names the linked folder `target` in the context: `checkoutRevision` and the ignored files its
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
 * left out, since its files are the repository's own, and so is a link into a `node_modules`
 * folder, as an install record names that package. A linked folder is named by its path and, when
 * it is the top of a git checkout, by `checkoutRevision` plus the ignored files its package
 * exposes (`ignoredEntryPointsHash`), otherwise by every file in it (`folderContentHash`); a link whose folder is missing is named by where it points. Nothing names
 * the link's own location, so a worktree whose `node_modules` links to the main checkout's resolves
 * to the same context as the main checkout. A folder that cannot be read throws.
 */
async function linkedPackagesHash(projectDir: string): Promise<string> {
  const repository = await fs.realpath((await git(projectDir, ['rev-parse', '--show-toplevel'])).trim());
  const game = await fs.realpath(projectDir);
  // The install records here are in the context already (`installedPackagesHash`).
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

/**
 * What the tests run with besides the repository's own files: the BoardSmith running this command
 * and the one the game loads (`toolRevisions`), what is installed, and every package linked from
 * outside the repository. Each is named in words, so `executionContextChange` can say which moved.
 */
export interface ExecutionContext {
  readonly parts: Readonly<Record<'boardsmith' | 'installed' | 'linked', string>>;
}

const PART_NAMES: Readonly<Record<keyof ExecutionContext['parts'], string>> = {
  boardsmith: 'the BoardSmith this command runs and the game loads',
  installed: "the installed packages (npm's install records)",
  linked: 'the packages linked from outside the repository',
};

/** Reads the execution context of the game in `projectDir` as it stands now. */
export async function captureExecutionContext(projectDir: string): Promise<ExecutionContext> {
  const linked = await linkedPackagesHash(projectDir).catch((error: unknown) => `unreadable: ${error instanceof Error ? error.message : String(error)}`);
  const [installed, boardsmith] = await Promise.all([installedPackagesHash(projectDir), toolRevisions(projectDir)]);
  return { parts: { boardsmith, installed, linked } };
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
