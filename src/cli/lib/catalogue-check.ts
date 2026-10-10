/**
 * DOES THIS BOARDSMITH TREE BREAK A CATALOGUE GAME? (#591)
 *
 * On 2026-10-09 a BoardSmith merge made a slot prop optional and cribbage stopped type-checking.
 * BoardSmith's own verify passed; the break surfaced only in ShufflewickPub's games suite, which
 * reads the catalogue against whatever `~/BoardSmith` holds at that moment (ShufflewickPub #619).
 * This check asks the question where the cause is, in BoardSmith's own verify.
 *
 * For each game in the catalogue (`~/BoardSmithGames`, a plain folder of separate game
 * repositories) whose committed `main` links `boardsmith` to a checkout, it runs
 * `boardsmith validate` (the publish bar, which includes the vue-tsc type check) on that game's
 * `main`, against the tree it is given:
 *
 * - The game is exported from its `main` commit with `git archive` into a temporary folder. The
 *   shared checkout is only read: no worktree is registered in it, nothing is written to it, and its
 *   uncommitted work is not what is checked.
 * - The export gets a `node_modules` of links into the shared checkout's install, so nothing is
 *   reinstalled, except `boardsmith`, which links to the tree under check, and any catalogue game
 *   the install links to (example-legacy-world's `example-legacy`), which links to that game's own
 *   export at its `main`. `.bin` entries are copied as the links npm wrote, so `.bin/boardsmith`
 *   reaches the tree too. Dot folders such as `.vite` are left out, so a tool's cache is written in
 *   the export, never in the shared install.
 * - The tree is the one passed in, never `~/BoardSmith` by path: a thread merge validates its
 *   candidate in the root checkout while that checkout's HEAD is detached at the candidate, and a
 *   worktree's verify checks the worktree.
 *
 * A pass is cached (`catalogueCachePath`) under the game's `main` commit and install record, those
 * of each catalogue game it links to, and the tree's content and install record. The tree is named
 * by its git TREE, not its commit, so a thread merge of a branch whose tree it just verified finds
 * every game already passed. A failure is never cached.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, promises as fs, realpathSync } from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitOutput as git, gitSucceeds } from './git-output.js';
import { sha256Hex } from './hash.js';
import { uncommittedContentHash } from './mutant-cache.js';
import { withDirRemovedAfter } from './command-build-dir.js';

/** Where the catalogue is on a machine set up the usual way. */
export const DEFAULT_CATALOGUE_ROOT = join(homedir(), 'BoardSmithGames');

/** The command that clones every catalogue game, each its own repository, onto a machine without them. */
export const CATALOGUE_CLONE_COMMAND = 'bash ~/ShufflewickPub/scripts/clone-game-catalogue.sh';

const CACHE_FORMAT = 1;

/** How many passes the cache keeps: many runs' worth for every game, at about 70 bytes each. */
const MAX_STORED_PASSES = 5_000;

/** A catalogue repository with a `main` branch. */
interface CatalogueRepo {
  slug: string;
  /** The shared checkout, by real path. */
  dir: string;
  /** The commit `main` names. */
  commit: string;
}

export interface CatalogueGameResult {
  slug: string;
  /** The shared checkout, where a failure is fixed. */
  dir: string;
  /** The `main` commit that was checked. */
  commit: string;
  /** `cached` is a pass recorded earlier for exactly these inputs. */
  status: 'passed' | 'cached' | 'failed';
  /** What the validator printed, or why it could not run, for a failed game. */
  output?: string;
}

export interface CatalogueRun {
  results: CatalogueGameResult[];
  /** The folders in the catalogue that are not checked, and why each is not. */
  notChecked: { slug: string; reason: string }[];
}

export interface CatalogueOptions {
  /** The BoardSmith checkout to check the games against: the top of a git checkout of boardsmith. */
  tree: string;
  /** The folder holding one checkout per game. */
  catalogueRoot: string;
  /** How many games validate at once. */
  concurrency?: number;
}

/** A catalogue run cannot answer at all; the message says what to do. */
function catalogueMissing(root: string, problem: string): Error {
  return new Error(
    `${problem}, so no catalogue game can be checked against this BoardSmith tree.\n`
      + `Clone the catalogue with: ${CATALOGUE_CLONE_COMMAND}\n`
      + `(it needs the gh CLI, signed in). A catalogue somewhere else: boardsmith catalogue --catalogue <folder>. Looked in: ${root}`,
  );
}

/** Whether a `boardsmith` dependency links to a checkout rather than pinning a packed copy. */
function linksToCheckout(spec: string): boolean {
  return /^(file|link):/.test(spec) && !/\.(tgz|tar\.gz|tar)$/.test(spec);
}

/** Why `repo`'s main is not a game to check, or undefined when its main links boardsmith to a checkout. */
async function whyNotLinked(repo: CatalogueRepo): Promise<string | undefined> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await git(repo.dir, ['show', 'main:package.json']));
  } catch {
    return 'main has no readable package.json';
  }
  const spec = pkg.dependencies?.boardsmith ?? pkg.devDependencies?.boardsmith;
  if (spec === undefined) return 'does not depend on boardsmith';
  return linksToCheckout(spec) ? undefined : `pins its own boardsmith (${spec})`;
}

/** One catalogue folder: the repository it is, if it has a main, and why it is not checked, if it is not. */
async function readFolder(slug: string, dir: string): Promise<{ repo?: CatalogueRepo; notChecked?: string }> {
  if (!existsSync(join(dir, '.git'))) return { notChecked: 'not a git repository' };
  if (!(await gitSucceeds(dir, ['rev-parse', '--verify', '--quiet', 'main^{commit}']))) return { notChecked: 'has no main branch' };
  const repo = { slug, dir, commit: (await git(dir, ['rev-parse', 'main^{commit}'])).trim() };
  return { repo, notChecked: await whyNotLinked(repo) };
}

/** The catalogue's repositories, the games among them to check, and every other folder with the reason. */
async function readCatalogue(root: string): Promise<{ repos: CatalogueRepo[]; games: CatalogueRepo[]; notChecked: CatalogueRun['notChecked'] }> {
  if (!existsSync(root)) throw catalogueMissing(root, `There is no catalogue folder at ${root}`);
  const repos: CatalogueRepo[] = [];
  const games: CatalogueRepo[] = [];
  const notChecked: CatalogueRun['notChecked'] = [];
  for (const slug of (await fs.readdir(root)).sort()) {
    // stat, not the directory entry: a game the catalogue holds as a link to a checkout is a game too.
    if (!(await fs.stat(join(root, slug)).catch(() => undefined))?.isDirectory()) continue;
    const folder = await readFolder(slug, realpathSync(join(root, slug)));
    if (folder.repo !== undefined) repos.push(folder.repo);
    if (folder.notChecked !== undefined) notChecked.push({ slug, reason: folder.notChecked });
    else if (folder.repo !== undefined) games.push(folder.repo);
  }
  if (games.length === 0) throw catalogueMissing(root, `The catalogue at ${root} holds no game whose main links boardsmith to a checkout`);
  return { repos, games, notChecked };
}

/** Every package folder name in `modules`, scoped packages as `@scope/name`, with dot entries left out. */
async function packageNames(modules: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const scoped of await fs.readdir(join(modules, entry.name))) names.push(`${entry.name}/${scoped}`);
    } else names.push(entry.name);
  }
  return names.sort();
}

/** What the install record of the checkout at `dir` says, by content, or `absent`. */
async function installRecord(dir: string): Promise<string> {
  try {
    return sha256Hex(await fs.readFile(join(dir, 'node_modules', '.package-lock.json')));
  } catch {
    return 'absent';
  }
}

/** The catalogue repositories `repo`'s install links a package to, by package name. */
async function catalogueLinks(repo: CatalogueRepo, byDir: Map<string, CatalogueRepo>): Promise<Map<string, CatalogueRepo>> {
  const modules = join(repo.dir, 'node_modules');
  const links = new Map<string, CatalogueRepo>();
  if (!existsSync(modules)) return links;
  for (const name of await packageNames(modules)) {
    if (name === 'boardsmith') continue;
    let target: string;
    try {
      target = realpathSync(join(modules, name));
    } catch {
      continue;
    }
    const linked = byDir.get(target);
    if (linked !== undefined) links.set(name, linked);
  }
  return links;
}

/** `repo` and every catalogue repository its install reaches through links, `repo` first. */
async function linkClosure(repo: CatalogueRepo, linksOf: (r: CatalogueRepo) => Promise<Map<string, CatalogueRepo>>): Promise<CatalogueRepo[]> {
  const seen = new Map<string, CatalogueRepo>([[repo.slug, repo]]);
  const queue = [repo];
  while (queue.length > 0) {
    for (const next of (await linksOf(queue.shift() as CatalogueRepo)).values()) {
      if (!seen.has(next.slug)) {
        seen.set(next.slug, next);
        queue.push(next);
      }
    }
  }
  const [first, ...rest] = [...seen.values()];
  return [first, ...rest.sort((a, b) => (a.slug < b.slug ? -1 : 1))];
}

/** The tree under check: its git tree, its uncommitted content and its install. */
async function treeIdentity(tree: string): Promise<string> {
  const [gitTree, uncommitted, installed] = await Promise.all([
    git(tree, ['rev-parse', 'HEAD^{tree}']).then((t) => t.trim()),
    uncommittedContentHash(tree),
    installRecord(tree),
  ]);
  return JSON.stringify([gitTree, uncommitted, installed]);
}

/** Refuses a `tree` that is not the top of a git checkout of boardsmith. */
async function requireBoardsmithTree(tree: string): Promise<string> {
  const real = realpathSync(tree);
  let top = '';
  try {
    top = realpathSync((await git(real, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    // Not a git checkout; refused below.
  }
  let name: unknown;
  try {
    name = (JSON.parse(await fs.readFile(join(real, 'package.json'), 'utf-8')) as { name?: unknown }).name;
  } catch {
    name = undefined;
  }
  if (top !== real || name !== 'boardsmith') {
    throw new Error(`${tree} is not a BoardSmith checkout. Run boardsmith catalogue from the top of a BoardSmith git checkout.`);
  }
  return real;
}

/** The cache file, in the git common directory every checkout of the tree's repository shares. */
export async function catalogueCachePath(tree: string): Promise<string> {
  const common = (await git(tree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return join(realpathSync(common), 'boardsmith', 'verify', 'catalogue.json');
}

async function readPasses(path: string): Promise<string[]> {
  try {
    const file = JSON.parse(await fs.readFile(path, 'utf-8')) as { format?: number; passes?: unknown };
    if (file.format !== CACHE_FORMAT || !Array.isArray(file.passes)) return [];
    return file.passes.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

/** Puts `passed` in front of the passes on file now, keeping up to `MAX_STORED_PASSES`. */
async function savePasses(path: string, passed: string[]): Promise<void> {
  if (passed.length === 0) return;
  // Read again: another checkout may have saved since this run read the file.
  const onFile = await readPasses(path);
  const passes = [...new Set([...passed, ...onFile])].slice(0, MAX_STORED_PASSES);
  await fs.mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify({ format: CACHE_FORMAT, passes })}\n`);
  await fs.rename(partial, path);
}

/** Runs `command` in `cwd`, resolving with its exit code and everything it printed. */
function run(command: string, args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ code: 1, output: `${output}${error.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Writes the files of `repo` at its `main` commit into the empty folder `dest`, by way of a tar
 * file beside it: git writes the archive itself, so its bytes never pass through a string.
 */
async function exportMain(repo: CatalogueRepo, dest: string): Promise<void> {
  const archive = `${dest}.tar`;
  await git(repo.dir, ['archive', '--format=tar', '-o', archive, repo.commit]);
  const untar = await run('tar', ['-x', '-f', archive, '-C', dest], dest);
  await fs.rm(archive);
  if (untar.code !== 0) throw new Error(`could not unpack ${repo.slug} at ${repo.commit}: ${untar.output.trim()}`);
}

/**
 * Gives the export at `dest` a `node_modules` of links into `repo`'s install, with `boardsmith`
 * linked to `tree` and each catalogue package linked to that game's export beside `dest`.
 */
async function linkInstall(repo: CatalogueRepo, dest: string, tree: string, links: Map<string, CatalogueRepo>): Promise<void> {
  const shared = join(repo.dir, 'node_modules');
  if (!existsSync(shared)) {
    throw new Error(`${repo.dir} has no node_modules, so it cannot be checked. Install its dependencies: cd ${repo.dir} && npm install`);
  }
  const modules = join(dest, 'node_modules');
  await fs.mkdir(modules, { recursive: true });
  for (const name of await packageNames(shared)) {
    const target = name === 'boardsmith' ? tree : links.has(name) ? join(dirname(dest), (links.get(name) as CatalogueRepo).slug) : join(shared, name);
    await fs.mkdir(dirname(join(modules, name)), { recursive: true });
    await fs.symlink(target, join(modules, name));
  }
  const bin = join(shared, '.bin');
  if (existsSync(bin)) {
    await fs.mkdir(join(modules, '.bin'));
    for (const entry of await fs.readdir(bin)) {
      // The link npm wrote, unchanged: relative, so it now resolves through this node_modules.
      await fs.symlink(await fs.readlink(join(bin, entry)), join(modules, '.bin', entry));
    }
  }
}

/** Runs `work` on each item, at most `limit` at once, and returns the results in item order. */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const named = ({ slug, dir, commit }: CatalogueRepo) => ({ slug, dir, commit });

/** Each catalogue game validated against `tree`, from the cache where these inputs passed before. */
export async function checkCatalogue(options: CatalogueOptions): Promise<CatalogueRun> {
  const tree = await requireBoardsmithTree(options.tree);
  const { repos, games, notChecked } = await readCatalogue(options.catalogueRoot);
  const byDir = new Map(repos.map((r) => [r.dir, r]));
  const linkCache = new Map<string, Promise<Map<string, CatalogueRepo>>>();
  const linksOf = (r: CatalogueRepo) => {
    if (!linkCache.has(r.slug)) linkCache.set(r.slug, catalogueLinks(r, byDir));
    return linkCache.get(r.slug) as Promise<Map<string, CatalogueRepo>>;
  };

  const cachePath = await catalogueCachePath(tree);
  const [stored, treeId] = await Promise.all([readPasses(cachePath).then((p) => new Set(p)), treeIdentity(tree)]);
  const keyOf = async (game: CatalogueRepo): Promise<string> => {
    const closure = await linkClosure(game, linksOf);
    const repos = await Promise.all(closure.map(async (r) => [r.slug, r.commit, await installRecord(r.dir)]));
    return sha256Hex(JSON.stringify([CACHE_FORMAT, process.version, treeId, repos]));
  };
  const keys = await Promise.all(games.map(keyOf));
  const toRun = games.filter((_, i) => !stored.has(keys[i]));

  const ran = new Map<string, CatalogueGameResult>();
  if (toRun.length > 0) {
    await withDirRemovedAfter(realpathSync(mkdtempSync(join(tmpdir(), 'boardsmith-catalogue-'))), async (work) => {
      // Each repository is exported once, whether it is checked, linked to, or both.
      const exports = new Map<string, Promise<string>>();
      const exported = (r: CatalogueRepo): Promise<string> => {
        if (!exports.has(r.slug)) {
          exports.set(r.slug, (async () => {
            const dest = join(work, r.slug);
            await fs.mkdir(dest);
            await exportMain(r, dest);
            await linkInstall(r, dest, tree, await linksOf(r));
            return dest;
          })());
        }
        return exports.get(r.slug) as Promise<string>;
      };
      const concurrency = options.concurrency ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
      await pooled(toRun, concurrency, async (game) => {
        let dir: string;
        try {
          const closure = await linkClosure(game, linksOf);
          [dir] = await Promise.all(closure.map(exported));
        } catch (error) {
          ran.set(game.slug, { ...named(game), status: 'failed', output: error instanceof Error ? error.message : String(error) });
          return;
        }
        const validate = await run(process.execPath, [join(tree, 'bin', 'boardsmith.js'), 'validate'], dir);
        ran.set(game.slug, validate.code === 0 ? { ...named(game), status: 'passed' } : { ...named(game), status: 'failed', output: validate.output });
      });
    });
  }

  const results = games.map((game): CatalogueGameResult => ran.get(game.slug) ?? { ...named(game), status: 'cached' });
  // A cached pass is saved again too, so the passes in use stay at the front of the file.
  await savePasses(cachePath, keys.filter((_, i) => results[i].status !== 'failed'));
  return { results, notChecked };
}
