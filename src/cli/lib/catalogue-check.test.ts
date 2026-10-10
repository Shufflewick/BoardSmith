/**
 * `boardsmith catalogue` validates each catalogue game against the BoardSmith tree it is given (#591).
 *
 * Every fixture here is a temp tree: a fake BoardSmith checkout whose `bin/boardsmith.js` stands in
 * for `boardsmith validate`, and a fake catalogue of game repositories, each with an "installed"
 * `node_modules` whose `boardsmith` links to some other, wrong checkout, as the real shared
 * checkouts link to the root `~/BoardSmith`. The stub fails unless the game it is run in loads the
 * tree under check, so a run that reached the shared checkouts' engine shows up as a failure.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, git, initRepo, writeFiles } from './verify-result.test-helper.js';
import { CATALOGUE_CLONE_COMMAND, catalogueCachePath, checkCatalogue } from './catalogue-check.js';

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
console.log('valid');
`;

interface Fixture {
  tree: string;
  /** The checkout the shared games' installs link to, standing in for the root `~/BoardSmith`. */
  elsewhere: string;
  catalogue: string;
}

/** A BoardSmith tree to check, a different BoardSmith the installs point at, and an empty catalogue. */
function fixture(): Fixture {
  const made = tempTree('bs-catalogue-');
  const root = realpathSync(made);
  const tree = join(root, 'BoardSmith');
  const elsewhere = join(root, 'RootBoardSmith');
  const catalogue = join(root, 'BoardSmithGames');
  for (const dir of [tree, elsewhere, catalogue]) mkdirSync(dir, { recursive: true });
  return { tree, elsewhere, catalogue };
}

async function makeTree(dir: string): Promise<void> {
  await writeFiles(dir, {
    'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.1', type: 'module' }),
    'bin/boardsmith.js': STUB_VALIDATE,
    '.gitignore': 'node_modules/\n',
  });
  initRepo(dir);
  commitAll(dir, 'tree');
}

interface GameSpec {
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
async function makeGame(fx: Fixture, slug: string, spec: GameSpec = {}): Promise<string> {
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
function checkoutState(dir: string): string {
  const modules = join(dir, 'node_modules');
  return JSON.stringify([
    git(dir, 'status', '--porcelain', '--ignored'),
    git(dir, 'worktree', 'list', '--porcelain'),
    git(dir, 'rev-parse', 'HEAD'),
    existsSync(modules) ? readdirSync(modules).sort() : [],
  ]);
}

function statusOf(run: Awaited<ReturnType<typeof checkCatalogue>>): Record<string, string> {
  return Object.fromEntries(run.results.map((r) => [r.slug, r.status]));
}

describe('which games are checked (#591)', () => {
  it('checks the games whose main links boardsmith to a checkout, and names the ones it does not', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await makeGame(fx, 'pinned', { boardsmith: 'file:./vendor/boardsmith-0.0.1.tgz' });
    await writeFiles(join(fx.catalogue, 'not-a-game'), { 'README.md': 'notes' });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ hex: 'passed' });
    expect(run.notChecked.map((n) => n.slug).sort()).toEqual(['not-a-game', 'pinned']);
  });

  it('checks a game the catalogue holds as a link to a checkout elsewhere', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    const linked = join(fx.catalogue, '..', 'OtherCatalogue');
    mkdirSync(linked);
    symlinkSync(join(fx.catalogue, 'hex'), join(linked, 'hex'));

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: linked }))).toEqual({ hex: 'passed' });
  });

  it('fails with the clone command when the catalogue is not on this machine', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const missing = join(fx.catalogue, 'absent');

    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: missing })).rejects.toThrow(CATALOGUE_CLONE_COMMAND);
    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: missing })).rejects.toThrow(missing);
  });

  it('fails with the clone command when the catalogue holds no game linked to a BoardSmith checkout', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'pinned', { boardsmith: 'file:./vendor/boardsmith-0.0.1.tgz' });

    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(CATALOGUE_CLONE_COMMAND);
  });

  it('refuses a tree that is not a BoardSmith checkout', async () => {
    const fx = fixture();
    await writeFiles(fx.tree, { 'package.json': JSON.stringify({ name: 'something-else' }) });
    initRepo(fx.tree);
    commitAll(fx.tree, 'not boardsmith');
    await makeGame(fx, 'hex');

    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(/not a BoardSmith checkout/);
  });
});

describe('what each game is checked against (#591)', () => {
  it("validates the game's committed main against the tree it is given, leaving the shared checkout as it was", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const hex = await makeGame(fx, 'hex');
    // Uncommitted work in the shared checkout is not main, so it is not what is checked.
    await writeFiles(hex, { BROKEN: 'only in the working tree' });
    const before = checkoutState(hex);

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(run.results).toEqual([expect.objectContaining({ slug: 'hex', status: 'passed' })]);
    expect(checkoutState(hex)).toBe(before);
  });

  it("reports a game that fails, with the validator's own output", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await makeGame(fx, 'cribbage', { files: { BROKEN: 'TableBoardProps is optional now' } });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ cribbage: 'failed', hex: 'passed' });
    const failed = run.results.find((r) => r.slug === 'cribbage');
    expect(failed?.output).toContain('TableBoardProps is optional now');
  });

  it("links a catalogue game the install depends on to that game's committed main, loading the same tree", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const legacy = await makeGame(fx, 'legacy');
    await writeFiles(legacy, { WORKING_TREE_ONLY: 'uncommitted' });
    const world = await makeGame(fx, 'legacy-world', { links: ['legacy'] });
    const before = [checkoutState(legacy), checkoutState(world)];

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ legacy: 'passed', 'legacy-world': 'passed' });
    expect([checkoutState(legacy), checkoutState(world)]).toEqual(before);
  });

  it('fails a game with no install, saying how to install it', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const hex = await makeGame(fx, 'hex', { installed: false });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(run.results).toEqual([expect.objectContaining({ slug: 'hex', status: 'failed' })]);
    expect(run.results[0].output).toContain(`cd ${hex} && npm install`);
  });
});

describe('the cache of passing games (#591)', () => {
  it('keeps passes in the git common directory of the tree', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    expect(await catalogueCachePath(fx.tree)).toBe(join(fx.tree, '.git', 'boardsmith', 'verify', 'catalogue.json'));
  });

  it('does not run a game again for the same game commit and the same tree', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'cached' });
  });

  it('runs a game again after a new commit on its main', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const hex = await makeGame(fx, 'hex');
    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    await writeFiles(hex, { 'src/rules.ts': 'export {};' });
    commitAll(hex, 'more rules');

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });
  });

  it('runs every game again after the tree changes, committed or not', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    await writeFiles(fx.tree, { 'src/engine.ts': 'export const a = 1;' });
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });

    commitAll(fx.tree, 'engine change');
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'cached' });
  });

  it('reuses a pass for the same tree content at another commit, as a thread merge of an up-to-date branch has', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    git(fx.tree, 'commit', '-q', '--allow-empty', '-m', 'same tree, new commit');

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'cached' });
  });

  it("runs a game again when a catalogue game it links to moves, and when the tree's install changes", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const legacy = await makeGame(fx, 'legacy');
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });
    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    await writeFiles(legacy, { 'src/rules.ts': 'export {};' });
    commitAll(legacy, 'legacy moves');
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({
      legacy: 'passed',
      'legacy-world': 'passed',
    });

    await writeFiles(fx.tree, { 'node_modules/.package-lock.json': '{"packages":{"vue":{}}}' });
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({
      legacy: 'passed',
      'legacy-world': 'passed',
    });
  });

  it('never caches a failure', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'cribbage', { files: { BROKEN: 'still broken' } });

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ cribbage: 'failed' });
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ cribbage: 'failed' });
  });
});
