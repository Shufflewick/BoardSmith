/**
 * DOES THIS BOARDSMITH TREE BREAK A CATALOGUE GAME? (#591)
 *
 * On 2026-10-09 a BoardSmith merge made a slot prop optional and cribbage stopped type-checking.
 * BoardSmith's own verify passed; the break surfaced only in ShufflewickPub's games suite, which
 * reads the catalogue against whatever `~/BoardSmith` holds at that moment (ShufflewickPub #619).
 * This check asks the question where the cause is, in BoardSmith's own verify.
 *
 * For each game in the catalogue (`~/BoardSmithGames`, a plain folder of separate game
 * repositories) whose committed `main` (or paired branch, below) links `boardsmith` to a checkout,
 * it runs `boardsmith validate` (the publish bar, which includes the vue-tsc type check) on that
 * commit, against the tree it is given, then has the game's vitest collect its test files (`vitest list`),
 * which loads each one and runs no test, so a change a game's tests no longer load against fails here
 * rather than in the game's next `boardsmith test` (#1498):
 *
 * - The game is exported from that commit into a temporary folder, as a clone that borrows the
 *   shared checkout's objects (`git clone --shared`). The shared checkout is only read: no worktree is
 *   registered in it, nothing is written to it, and its uncommitted work is not what is checked.
 * - The export gets a `node_modules` of links into the shared checkout's install, so nothing is
 *   reinstalled, except `boardsmith`, which links to the tree under check, and any catalogue game
 *   the install links to (example-legacy-world's `example-legacy`), which links to that game's own
 *   export. `.bin` entries are copied as the links npm wrote, so `.bin/boardsmith`
 *   reaches the tree too. Dot folders such as `.vite` are left out, so a tool's cache is written in
 *   the export, never in the shared install.
 * - The tree is the one passed in, never `~/BoardSmith` by path: a thread merge validates its
 *   candidate in the root checkout while that checkout's HEAD is detached at the candidate, and a
 *   worktree's verify checks the worktree.
 *
 * A game that validates for longer than the time limit (`DEFAULT_GAME_TIME_LIMIT_MS`) is stopped,
 * with every process it started, and fails by name; a stop signal ends them the same way. A game
 * that cannot pass for a known reason is left out only by an explicit `skip` naming that reason,
 * which the report lists.
 *
 * A game repository with a branch of the same name as the tree's checked-out branch is checked, and
 * linked, at that branch instead of its `main` (#1322). That is how a BoardSmith change that needs a
 * game change lands: BoardSmith merges first, then the game branch merges onto the game's `main`,
 * which the report reminds the reader to do. A merge validating its detached merge commit pairs the
 * one branch at that commit's second parent; any other detached tree checks every game's `main`.
 * The export still links the shared checkout's install, so a game branch's new dependencies must
 * be installed there. ShufflewickPub is not touched: it checks the commits it
 * pins against the engine it vendors, so it moves both once the game branch is on `main`.
 *
 * A pass is cached (`catalogueCachePath`) under the game's commit and install record, those
 * of each catalogue game it links to, and the tree's content and install record. The tree is named
 * by its git TREE, not its commit, so a thread merge of a branch whose tree it just verified finds
 * every game already passed. A failure is never cached.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, promises as fs, realpathSync } from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitOutput as git, gitSucceeds } from './git-output.js';
import { sha256Hex } from './hash.js';
import { uncommittedContentHash } from './execution-context.js';
import { withDirRemovedAfter } from './command-build-dir.js';
import { readIfExists, readIfExistsSync } from './read-if-exists.js';

/** Where the catalogue is on a machine set up the usual way. */
export const DEFAULT_CATALOGUE_ROOT = join(homedir(), 'BoardSmithGames');

/** The command that clones every catalogue game, each its own repository, onto a machine without them. */
export const CATALOGUE_CLONE_COMMAND = 'bash ~/ShufflewickPub/scripts/clone-game-catalogue.sh';

// 2: a pass also means every test file loaded (#1498).
const CACHE_FORMAT = 2;

/** How many passes the cache keeps: many runs' worth for every game, at about 70 bytes each. */
const MAX_STORED_PASSES = 5_000;

/** A catalogue repository with a `main` branch, at the branch it is checked on. */
interface CatalogueRepo {
  slug: string;
  /** The shared checkout, by real path. */
  dir: string;
  /** `main`, or the branch paired with the tree's branch. */
  ref: string;
  /** The commit `ref` names. */
  commit: string;
}

export interface CatalogueGameResult {
  slug: string;
  /** The shared checkout, where a failure is fixed. */
  dir: string;
  /** The branch that was checked: `main`, or the one paired with the tree's branch. */
  ref: string;
  /** The commit of `ref` that was checked. */
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
  /** Every repository read at its paired branch rather than its main, checked, linked or skipped. */
  paired: Omit<CatalogueGameResult, 'status' | 'output'>[];
}

export interface CatalogueOptions {
  /** The BoardSmith checkout to check the games against: the top of a git checkout of boardsmith. */
  tree: string;
  /** The folder holding one checkout per game. */
  catalogueRoot: string;
  /** How many games validate at once. */
  concurrency?: number;
  /**
   * Games not to run, each with the reason, which the report lists. Each must name a game the
   * catalogue would check, so a skip cannot outlive the game it was for.
   */
  skip?: Record<string, string>;
  /** How long one game's validate may run before it is stopped and the game fails. */
  timeLimitMs?: number;
  /** Where the run's temporary work folder is made: the OS temp folder unless a test says otherwise. */
  workRoot?: string;
}

/**
 * The default for `timeLimitMs`. A game validates in 10 to 40 seconds on a busy machine, so only a
 * validate that will never finish reaches it.
 */
export const DEFAULT_GAME_TIME_LIMIT_MS = 5 * 60_000;

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

/** Why `repo` is not a game to check, or undefined when it links boardsmith to a checkout at its commit. */
async function whyNotLinked(repo: CatalogueRepo): Promise<string | undefined> {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await git(repo.dir, ['show', `${repo.commit}:package.json`]));
  } catch {
    return `${repo.ref} has no readable package.json`;
  }
  const spec = pkg.dependencies?.boardsmith ?? pkg.devDependencies?.boardsmith;
  if (spec === undefined) return 'does not depend on boardsmith';
  return linksToCheckout(spec) ? undefined : `pins its own boardsmith (${spec})`;
}

/**
 * One catalogue folder: the repository it is, if it has a main, at `paired` if it has that branch,
 * and why it is not checked, if it is not.
 */
async function readFolder(slug: string, dir: string, paired: string | undefined): Promise<{ repo?: CatalogueRepo; notChecked?: string }> {
  if (!existsSync(join(dir, '.git'))) return { notChecked: 'not a git repository' };
  if (!(await gitSucceeds(dir, ['rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}']))) return { notChecked: 'has no main branch' };
  const onPaired = paired !== undefined && (await gitSucceeds(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${paired}^{commit}`]));
  const ref = onPaired ? paired : 'main';
  const repo = { slug, dir, ref, commit: (await git(dir, ['rev-parse', `refs/heads/${ref}^{commit}`])).trim() };
  return { repo, notChecked: await whyNotLinked(repo) };
}

/** The catalogue's repositories, the games among them to check, and every other folder with the reason. */
async function readCatalogue(root: string, paired: string | undefined): Promise<{ repos: CatalogueRepo[]; games: CatalogueRepo[]; notChecked: CatalogueRun['notChecked'] }> {
  if (!existsSync(root)) throw catalogueMissing(root, `There is no catalogue folder at ${root}`);
  const repos: CatalogueRepo[] = [];
  const games: CatalogueRepo[] = [];
  const notChecked: CatalogueRun['notChecked'] = [];
  for (const slug of (await fs.readdir(root)).sort()) {
    // stat, not the directory entry: a game the catalogue holds as a link to a checkout is a game too.
    if (!(await readIfExists(join(root, slug), fs.stat))?.isDirectory()) continue;
    const folder = await readFolder(slug, realpathSync(join(root, slug)), paired);
    if (folder.repo !== undefined) repos.push(folder.repo);
    if (folder.notChecked !== undefined) notChecked.push({ slug, reason: folder.notChecked });
    else if (folder.repo !== undefined) games.push(folder.repo);
  }
  if (games.length === 0) throw catalogueMissing(root, `The catalogue at ${root} holds no game whose main or paired branch links boardsmith to a checkout`);
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
  const record = await readIfExists(join(dir, 'node_modules', '.package-lock.json'), fs.readFile);
  return record === undefined ? 'absent' : sha256Hex(record);
}

/** The catalogue repositories `repo`'s install links a package to, by package name. */
async function catalogueLinks(repo: CatalogueRepo, byDir: Map<string, CatalogueRepo>): Promise<Map<string, CatalogueRepo>> {
  const modules = join(repo.dir, 'node_modules');
  const links = new Map<string, CatalogueRepo>();
  if (!existsSync(modules)) return links;
  for (const name of await packageNames(modules)) {
    if (name === 'boardsmith') continue;
    // A link whose folder is gone links nothing.
    // realpathSync, as the catalogue's own keys are made: fs.realpath can spell a folder's case differently.
    const target = readIfExistsSync(join(modules, name), (p) => realpathSync(p));
    const linked = target === undefined ? undefined : byDir.get(target);
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
  const text = await readIfExists(join(real, 'package.json'), (p) => fs.readFile(p, 'utf-8'));
  let name: unknown;
  try {
    name = text === undefined ? undefined : (JSON.parse(text) as { name?: unknown }).name;
  } catch {
    // Not JSON: refused below, as a tree with no package.json is.
  }
  if (top !== real || name !== 'boardsmith') {
    throw new Error(`${tree} is not a BoardSmith checkout. Run boardsmith catalogue from the top of a BoardSmith git checkout.`);
  }
  return real;
}

/**
 * The branch `tree` checks: the one checked out, or, on a detached merge commit, the one branch at
 * its second parent, which is what `agent-policy merge` validates. Undefined for main or none.
 */
async function pairedBranch(tree: string): Promise<string | undefined> {
  let branches: string[] = [];
  if (await gitSucceeds(tree, ['symbolic-ref', '-q', 'HEAD'])) branches = [(await git(tree, ['symbolic-ref', '--short', 'HEAD'])).trim()];
  else if (await gitSucceeds(tree, ['rev-parse', '--verify', '--quiet', 'HEAD^2'])) {
    branches = (await git(tree, ['for-each-ref', '--points-at', 'HEAD^2', '--format=%(refname:short)', 'refs/heads'])).split('\n').filter(Boolean);
  }
  return branches.length === 1 && branches[0] !== 'main' ? branches[0] : undefined;
}

/** The cache file, in the git common directory every checkout of the tree's repository shares. */
export async function catalogueCachePath(tree: string): Promise<string> {
  const common = (await git(tree, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return join(realpathSync(common), 'boardsmith', 'verify', 'catalogue.json');
}

async function readPasses(path: string): Promise<string[]> {
  // A cache: any file it cannot read or parse only means every game runs again.
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

/**
 * The processes this run started, so a time limit or a stop signal can end them. Each is started in
 * its own process group and ended with the whole group, so what it started in turn (vue-tsc, a
 * bundler) ends with it.
 */
class Children {
  private readonly live = new Set<ChildProcess>();

  /**
   * Runs `command` in `cwd`, resolving with its exit code, everything it printed, and whether
   * `timeLimitMs` ran out first and it was stopped.
   */
  run(command: string, args: string[], cwd: string, timeLimitMs = Infinity): Promise<{ code: number; output: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      this.live.add(child);
      let output = '';
      let timedOut = false;
      const timer = Number.isFinite(timeLimitMs)
        ? setTimeout(() => {
            timedOut = true;
            this.end(child);
          }, timeLimitMs)
        : undefined;
      const settle = (code: number, extra = '') => {
        clearTimeout(timer);
        this.live.delete(child);
        resolve({ code, output: `${output}${extra}`, timedOut });
      };
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('error', (error) => settle(1, `${error.message}\n`));
      child.on('close', (code) => settle(code ?? 1));
    });
  }

  /** Ends every process still running, and everything each started. */
  endAll(): void {
    for (const child of this.live) this.end(child);
  }

  private end(child: ChildProcess): void {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // The group has already exited.
    }
  }
}

/**
 * Checks out `repo` at its commit into the empty folder `dest`, as a clone that borrows the shared
 * checkout's objects, so it writes nothing there. A clone, not an archive: a game's test may read
 * its own checkout when it loads, as WindupWarfare's does with `git ls-files` (#1498).
 */
async function exportCommit(repo: CatalogueRepo, dest: string): Promise<void> {
  await git(dest, ['clone', '--quiet', '--shared', '--no-checkout', repo.dir, '.']);
  await git(dest, ['checkout', '--quiet', '--detach', repo.commit]);
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

const named = ({ slug, dir, ref, commit }: CatalogueRepo) => ({ slug, dir, ref, commit });

/** `games` less those `skip` names, which join `notChecked` with their reasons. */
function applySkips(
  games: CatalogueRepo[],
  notChecked: CatalogueRun['notChecked'],
  skip: Record<string, string>,
): { games: CatalogueRepo[]; notChecked: CatalogueRun['notChecked'] } {
  for (const slug of Object.keys(skip)) {
    if (!games.some((g) => g.slug === slug)) {
      throw new Error(
        `--skip names ${slug}, which is not a game this catalogue checks (${games.map((g) => g.slug).join(', ')}). `
          + 'Remove that skip from the command, or from .agent-policy.json if it is there.',
      );
    }
  }
  return {
    games: games.filter((g) => skip[g.slug] === undefined),
    notChecked: [...notChecked, ...Object.entries(skip).map(([slug, reason]) => ({ slug, reason: `skipped: ${reason}` }))],
  };
}

/** How a time limit reads in a report: whole seconds under two minutes, whole minutes from there. */
function describeLimit(ms: number): string {
  return ms < 120_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minutes`;
}

/**
 * Runs `boardsmith validate` in the export of `slug` at `dir`, then has its vitest collect every test
 * file, a plain run's and the sims', which loads each one and runs no test (#1498). Undefined when
 * every step passes; otherwise what the first failing step printed, and why it failed.
 */
async function checkGame(slug: string, tree: string, dir: string, children: Children, timeLimitMs: number): Promise<string | undefined> {
  const stopped = (name: string) => `\n${slug} did not finish ${name} within ${describeLimit(timeLimitMs)}, so it was stopped. `
    + 'Each step takes well under a minute; find what never ends, or skip the game with --skip and an issue.\n';
  const validate = await children.run(process.execPath, [join(tree, 'bin', 'boardsmith.js'), 'validate'], dir, timeLimitMs);
  if (validate.timedOut) return `${validate.output}${stopped('boardsmith validate')}`;
  if (validate.code !== 0) return validate.output;

  const listed = `${dir}.tests.json`;
  for (const mode of [[], ['--mode', 'sims']]) {
    const name = ['vitest list', ...mode].join(' ');
    // --no-isolate reuses each fork for many files: about a quarter of the CPU, and every file still loads.
    const args = ['list', ...mode, '--passWithNoTests', '--pool=forks', '--no-isolate', `--json=${listed}`];
    const run = await children.run(join(dir, 'node_modules', '.bin', 'vitest'), args, dir, timeLimitMs);
    // vitest can exit 0 after an error outside any test file, and then it writes no list.
    const wroteList = existsSync(listed);
    await fs.rm(listed, { force: true });
    if (run.timedOut || run.code !== 0 || !wroteList) {
      return `${slug}'s test files do not load against this tree (${name} loads each one and runs none):\n${run.output}${run.timedOut ? stopped(name) : ''}`;
    }
  }
  return undefined;
}

/**
 * Validates each of `games` in an export of its commit, in a work folder that is removed when the run
 * ends, and ends every process the run started if a signal stops it first.
 */
async function runGames(
  games: CatalogueRepo[],
  tree: string,
  linksOf: (r: CatalogueRepo) => Promise<Map<string, CatalogueRepo>>,
  options: CatalogueOptions,
): Promise<Map<string, CatalogueGameResult>> {
  const ran = new Map<string, CatalogueGameResult>();
  const children = new Children();
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_GAME_TIME_LIMIT_MS;
  const work = realpathSync(mkdtempSync(join(options.workRoot ?? tmpdir(), 'boardsmith-catalogue-')));
  await withDirRemovedAfter(work, async () => {
    // Each repository is exported once, whether it is checked, linked to, or both.
    const exports = new Map<string, Promise<string>>();
    const exported = (r: CatalogueRepo): Promise<string> => {
      if (!exports.has(r.slug)) {
        exports.set(r.slug, (async () => {
          const dest = join(work, r.slug);
          await fs.mkdir(dest);
          await exportCommit(r, dest);
          await linkInstall(r, dest, tree, await linksOf(r));
          return dest;
        })());
      }
      return exports.get(r.slug) as Promise<string>;
    };
    const concurrency = options.concurrency ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
    await pooled(games, concurrency, async (game) => {
      let dir: string;
      try {
        [dir] = await Promise.all((await linkClosure(game, linksOf)).map(exported));
      } catch (error) {
        ran.set(game.slug, { ...named(game), status: 'failed', output: error instanceof Error ? error.message : String(error) });
        return;
      }
      const failed = await checkGame(game.slug, tree, dir, children, timeLimitMs);
      ran.set(game.slug, failed === undefined ? { ...named(game), status: 'passed' } : { ...named(game), status: 'failed', output: failed });
    });
  }, () => children.endAll());
  return ran;
}

/** Each catalogue game validated against `tree`, from the cache where these inputs passed before. */
export async function checkCatalogue(options: CatalogueOptions): Promise<CatalogueRun> {
  const tree = await requireBoardsmithTree(options.tree);
  const catalogue = await readCatalogue(options.catalogueRoot, await pairedBranch(tree));
  const { repos } = catalogue;
  const { games, notChecked } = applySkips(catalogue.games, catalogue.notChecked, options.skip ?? {});
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
    const closureRecords = await Promise.all(closure.map(async (r) => [r.slug, r.commit, await installRecord(r.dir)]));
    return sha256Hex(JSON.stringify([CACHE_FORMAT, process.version, treeId, closureRecords]));
  };
  const keys = await Promise.all(games.map(keyOf));
  const toRun = games.filter((_, i) => !stored.has(keys[i]));

  const ran = toRun.length === 0 ? new Map<string, CatalogueGameResult>() : await runGames(toRun, tree, linksOf, options);
  const results = games.map((game): CatalogueGameResult => ran.get(game.slug) ?? { ...named(game), status: 'cached' });
  // A cached pass is saved again too, so the passes in use stay at the front of the file.
  await savePasses(cachePath, keys.filter((_, i) => results[i].status !== 'failed'));
  return { results, notChecked, paired: repos.filter((r) => r.ref !== 'main').map(named) };
}
