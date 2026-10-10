/**
 * The fake BoardSmith tree and catalogue the `boardsmith catalogue` tests run against (#591).
 *
 * The tree is a git checkout of a package named boardsmith whose `bin/boardsmith.js` stands in for
 * `boardsmith validate`. Each game is a repository on `main` with an "installed" `node_modules`
 * whose `boardsmith` links to some other, wrong checkout, as the real shared checkouts link to the
 * root `~/BoardSmith`. The stub fails unless the game it is run in loads the tree under check, so a
 * run that reached the shared checkouts' engine shows up as a failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, git, initRepo, writeFiles } from './verify-result.test-helper.js';
import type { CatalogueRun } from './catalogue-check.js';

/**
 * The stand-in for `boardsmith validate`. It passes only when, in the folder it runs in:
 * `node_modules/boardsmith` and `node_modules/.bin/boardsmith` are this tree, `node_modules/.bin/tool`
 * is still reachable, every catalogue dependency named in `deps.txt` is a committed copy that loads
 * this tree too, and there is no `BROKEN` file.
 */
const STUB_VALIDATE = `
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const tree = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const fail = (why) => { console.error(why); process.exit(1); };
if (process.argv[2] !== 'validate') fail('expected validate, got ' + process.argv.slice(2).join(' '));
const loads = (dir) => realpathSync(join(dir, 'node_modules', 'boardsmith'));
if (loads('.') !== tree) fail('the game loads boardsmith from ' + loads('.'));
if (realpathSync('node_modules/.bin/boardsmith') !== join(tree, 'bin', 'boardsmith.js')) fail('.bin/boardsmith is not this tree');
if (!existsSync('node_modules/.bin/tool')) fail('.bin/tool is missing');
const deps = existsSync('deps.txt') ? readFileSync('deps.txt', 'utf-8').split('\\n').filter(Boolean) : [];
for (const dep of deps) {
  const dir = join('node_modules', dep);
  if (existsSync(join(dir, 'WORKING_TREE_ONLY'))) fail(dep + ' is its working tree, not its main');
  if (loads(dir) !== tree) fail(dep + ' loads boardsmith from ' + loads(dir));
}
if (existsSync('BROKEN')) fail('BROKEN: ' + readFileSync('BROKEN', 'utf-8'));
if (existsSync('HANG')) {
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', join(tree, 'hanging-grandchild')], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
} else console.log('valid');
`;

export interface Fixture {
  tree: string;
  /** The checkout the shared games' installs link to, standing in for the root `~/BoardSmith`. */
  elsewhere: string;
  catalogue: string;
}

/** A BoardSmith tree to check, a different BoardSmith the installs point at, and an empty catalogue. */
export function fixture(): Fixture {
  const made = tempTree('bs-catalogue-');
  const root = realpathSync(made);
  // Names no one of which starts another, so `runningIn` matches only what runs from the tree.
  const tree = join(root, 'Engine');
  const elsewhere = join(root, 'RootEngine');
  const catalogue = join(root, 'Games');
  for (const dir of [tree, elsewhere, catalogue]) mkdirSync(dir, { recursive: true });
  return { tree, elsewhere, catalogue };
}

export async function makeTree(dir: string): Promise<void> {
  await writeFiles(dir, {
    'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.1', type: 'module' }),
    'bin/boardsmith.js': STUB_VALIDATE,
    '.gitignore': 'node_modules/\n',
  });
  initRepo(dir);
  commitAll(dir, 'tree');
}

export interface GameSpec {
  /** The boardsmith dependency main's package.json declares. */
  boardsmith?: string;
  /** Files committed on main besides package.json. */
  files?: Record<string, string>;
  /** Catalogue games this one's install links to, as `file:../<slug>` dependencies. */
  links?: string[];
  /** Whether the shared checkout has an install at all. */
  installed?: boolean;
}

/** A game repository on `main`, with an install whose `boardsmith` links to `fx.elsewhere`. */
export async function makeGame(fx: Fixture, slug: string, spec: GameSpec = {}): Promise<string> {
  const dir = join(fx.catalogue, slug);
  const deps: Record<string, string> = { boardsmith: spec.boardsmith ?? 'file:../../BoardSmith' };
  for (const link of spec.links ?? []) deps[link] = `file:../${link}`;
  await writeFiles(dir, {
    'package.json': JSON.stringify({ name: slug, type: 'module', dependencies: deps }),
    '.gitignore': 'node_modules/\n.boardsmith/\n',
    ...(spec.links ? { 'deps.txt': spec.links.join('\n') } : {}),
    ...spec.files,
  });
  if (spec.installed !== false) {
    const modules = join(dir, 'node_modules');
    await writeFiles(modules, {
      '.package-lock.json': JSON.stringify({ name: slug, packages: {} }),
      'tool/package.json': JSON.stringify({ name: 'tool', bin: 'run.js' }),
      'tool/run.js': '',
      '.vite/deps/cache.json': '{}',
    });
    symlinkSync(fx.elsewhere, join(modules, 'boardsmith'));
    mkdirSync(join(modules, '.bin'));
    symlinkSync('../boardsmith/bin/boardsmith.js', join(modules, '.bin', 'boardsmith'));
    symlinkSync('../tool/run.js', join(modules, '.bin', 'tool'));
    for (const link of spec.links ?? []) symlinkSync(`../../${link}`, join(modules, link));
  }
  initRepo(dir);
  commitAll(dir, `${slug} main`);
  return dir;
}

/** What a shared checkout looks like to someone using it: status, worktrees and its install. */
export function checkoutState(dir: string): string {
  const modules = join(dir, 'node_modules');
  return JSON.stringify([
    git(dir, 'status', '--porcelain', '--ignored'),
    git(dir, 'worktree', 'list', '--porcelain'),
    git(dir, 'rev-parse', 'HEAD'),
    existsSync(modules) ? readdirSync(modules).sort() : [],
  ]);
}

export function statusOf(run: CatalogueRun): Record<string, string> {
  return Object.fromEntries(run.results.map((r) => [r.slug, r.status]));
}

/** The pids of every process still running a program from `fx.tree`: the stub and any child it started. */
export function runningIn(fx: Fixture): string[] {
  try {
    return execFileSync('pgrep', ['-f', `${fx.tree}/`], { encoding: 'utf-8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** The catalogue work folders left in `dir`. */
export function workFolders(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('boardsmith-catalogue-'));
}
