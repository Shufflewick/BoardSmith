/**
 * `boardsmith catalogue` validates each catalogue game against the BoardSmith tree it is given (#591).
 * The fixtures are in `catalogue-fixture.test-helper.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, git, initRepo, writeFiles } from './verify-result.test-helper.js';
import { CATALOGUE_CLONE_COMMAND, catalogueCachePath, checkCatalogue } from './catalogue-check.js';
import { FIXTURE_VITEST, checkoutState, fixture, lockfilePinning, makeGame, makeTree, runningIn, statusOf, workFolders, type Fixture } from './catalogue-fixture.test-helper.js';

const CATALOGUE_CHECK = fileURLToPath(new URL('./catalogue-check.ts', import.meta.url));

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

  it('passes over a link to a folder that is gone, and refuses an entry it cannot look at', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    symlinkSync(join(fx.catalogue, 'gone'), join(fx.catalogue, 'dangling'));
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });

    symlinkSync('loop', join(fx.catalogue, 'loop'));
    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(`Could not read ${join(fx.catalogue, 'loop')} (ELOOP)`);
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

describe('a file the catalogue check cannot read is named, never read as missing (#1174)', () => {
  it("names the tree's package.json when it cannot be read, rather than calling the tree something else", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    rmSync(join(fx.tree, 'package.json'));
    mkdirSync(join(fx.tree, 'package.json'));
    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(/Could not read .*package\.json \(EISDIR\)/);
  });

  it("names the tree's install record when it cannot be read, rather than keying the cache as if there were none", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    mkdirSync(join(fx.tree, 'node_modules', '.package-lock.json'), { recursive: true });
    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(/Could not read .*node_modules\/\.package-lock\.json \(EISDIR\)/);
  });

  it("names a link in a game's install it cannot follow, and still passes over one whose folder is gone", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const hex = await makeGame(fx, 'hex');
    symlinkSync(join(hex, 'gone'), join(hex, 'node_modules', 'dangling'));
    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'passed' });

    symlinkSync('loop', join(hex, 'node_modules', 'loop'));
    await expect(checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })).rejects.toThrow(`Could not read ${join(hex, 'node_modules', 'loop')} (ELOOP)`);
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
    const treeBefore = checkoutState(fx.tree);

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(run.results).toEqual([expect.objectContaining({ slug: 'hex', status: 'passed' })]);
    expect(checkoutState(hex)).toBe(before);
    expect(checkoutState(fx.tree)).toBe(treeBefore);
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

  it('keeps a character whose bytes arrive in two chunks whole (#1691)', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    // Far more than one pipe chunk of three-byte characters, so some chunk ends inside one.
    await makeGame(fx, 'hex', { files: { OUTPUT: '€'.repeat(200000) } });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(run.results[0].output).toBe('€'.repeat(200000));
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

  // Only a disk that ignores letter case finds the fixture's Games/ folder as games/.
  it.skipIf(!existsSync(tmpdir().toUpperCase()))('links a catalogue game when the catalogue is named in other letter case than on disk (#1174)', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'legacy');
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });
    // On a disk that ignores case this names the same folder; links must resolve as the catalogue's keys do.
    const otherCase = join(fx.catalogue, '..', 'games');

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: otherCase });

    expect(statusOf(run)).toEqual({ legacy: 'passed', 'legacy-world': 'passed' });
  });

  it('fails a game that links a catalogue game with no install, saying how to install it', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const legacy = await makeGame(fx, 'legacy', { installed: false });
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, skip: { legacy: 'not installed' } });

    expect(run.results).toEqual([expect.objectContaining({ slug: 'legacy-world', status: 'failed' })]);
    expect(run.results[0].output).toContain(`cd ${legacy} && npm install`);
  });
});

describe("a game's install must hold the vitest its commit's lockfile pins (#1795)", () => {
  it('refuses the run, naming each game whose install does not, before checking any game', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    const hex = await makeGame(fx, 'hex');
    const chess = await makeGame(fx, 'chess');
    const seven = await makeGame(fx, 'seven', { installed: false });
    const go = await makeGame(fx, 'go', { files: { 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' } });
    const torn = await makeGame(fx, 'torn');
    await makeGame(fx, 'fine');
    // An interrupted install can leave a package.json empty.
    await writeFiles(torn, { 'node_modules/vitest/package.json': '' });
    // main moves to a lockfile pinning a newer vitest, and nothing reinstalls.
    await writeFiles(hex, { 'package-lock.json': lockfilePinning('4.0.0') });
    commitAll(hex, 'vitest 4');
    rmSync(join(chess, 'node_modules', '.bin', 'vitest'));
    symlinkSync('../tool/run.js', join(chess, 'node_modules', '.bin', 'vitest'));
    const commit = (dir: string) => git(dir, 'rev-parse', 'main').trim().slice(0, 8);

    const refused = checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    await expect(refused).rejects.toThrow(
      `hex at main (${commit(hex)}) pins vitest 4.0.0 in its package-lock.json, but ${hex}/node_modules holds vitest ${FIXTURE_VITEST}.`,
    );
    await expect(refused).rejects.toThrow(`chess at main (${commit(chess)}): ${chess}/node_modules/.bin/vitest does not lead into ${chess}/node_modules/vitest.`);
    await expect(refused).rejects.toThrow(`seven at main (${commit(seven)}) pins vitest ${FIXTURE_VITEST} in its package-lock.json, but ${seven}/node_modules holds no vitest.`);
    await expect(refused).rejects.toThrow(`go at main (${commit(go)}) pins no vitest in its package-lock.json`);
    await expect(refused).rejects.toThrow(`torn at main (${commit(torn)}): ${torn}/node_modules/vitest/package.json is not valid JSON.`);
    await expect(refused).rejects.toThrow('npm ci');
    await expect(refused).rejects.toThrow('--skip');
    await expect(refused).rejects.not.toThrow(/fine at/);
    expect(existsSync(await catalogueCachePath(fx.tree))).toBe(false);
  });
});

// #1095: four catalogue runs spawn dozens of processes, seconds on a busy machine,
// so they run here, while the file is collected and no test timeout applies.
const [afterUncommittedChange, afterCommit, afterCommitAgain] = await (async () => {
  const fx = fixture();
  await makeTree(fx.tree);
  await makeGame(fx, 'hex');
  await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

  await writeFiles(fx.tree, { 'src/engine.ts': 'export const a = 1;' });
  const uncommitted = statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }));

  commitAll(fx.tree, 'engine change');
  const committed = statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }));
  return [uncommitted, committed, statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))];
})();

// #1088: three catalogue runs of two games each spawn dozens of processes, seconds on a busy
// machine, so they run here, while the file is collected and no test timeout applies.
const [afterLinkedGameMoves, afterTreeInstallChanges] = await (async () => {
  const fx = fixture();
  await makeTree(fx.tree);
  const legacy = await makeGame(fx, 'legacy');
  await makeGame(fx, 'legacy-world', { links: ['legacy'] });
  await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

  await writeFiles(legacy, { 'src/rules.ts': 'export {};' });
  commitAll(legacy, 'legacy moves');
  const moved = statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }));

  await writeFiles(fx.tree, { 'node_modules/.package-lock.json': '{"packages":{"vue":{}}}' });
  return [moved, statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))];
})();

// #1498: two catalogue runs that start the real vitest, seconds on a busy machine, so they run
// here, while the file is collected and no test timeout applies.
const [loadsBefore, loadsAfter] = await (async () => {
  const fx = fixture();
  await makeTree(fx.tree);
  await writeFiles(fx.tree, { 'index.js': 'export const playGame = () => {};\n' });
  commitAll(fx.tree, 'boardsmith exports playGame');
  const game = await makeGame(fx, 'chess', {
    files: {
      'tests/random-sim.test.ts': "import { it } from 'vitest';\nimport { playGame } from 'boardsmith';\nit('plays', () => playGame());\n",
      // Loaded first (vitest loads larger files first), and its mock must not reach another file (#1498 review F6).
      'tests/mocked.test.ts': `import { it, vi } from 'vitest';\nvi.mock('boardsmith', () => ({ playGame: () => {} }));\nit('mocks', () => {});\n${'// padding\n'.repeat(500)}`,
      // A game's test may read its own checkout when it loads, as WindupWarfare's source-names test does.
      'tests/source-names.test.ts': "import { it } from 'vitest';\nimport { execFileSync } from 'node:child_process';\nconst files = execFileSync('git', ['ls-files']);\nit('lists', () => files);\n",
    },
  });
  // The game's own vitest, as an install has it: BoardSmith's copy stands in.
  rmSync(join(game, 'node_modules', 'vitest'), { recursive: true, force: true });
  const vitest = dirname(createRequire(import.meta.url).resolve('vitest/package.json'));
  symlinkSync(vitest, join(game, 'node_modules', 'vitest'));
  await writeFiles(game, { 'package-lock.json': lockfilePinning(JSON.parse(readFileSync(join(vitest, 'package.json'), 'utf-8')).version) });
  commitAll(game, 'lock the vitest it installs');
  const before = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

  // A BoardSmith change that a game's test file fails to load against, as #1494's sim check was.
  await writeFiles(fx.tree, { 'index.js': "throw new Error('rename it to tests/random-sim.sim.test.ts');\n" });
  commitAll(fx.tree, 'boardsmith refuses the test at load');
  return [before, await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue })];
})();

describe("a game's test files are loaded, never run (#1498)", () => {
  it('passes a game whose test files load against the tree', () => {
    // The whole result, so a failure shows what vitest printed.
    expect(loadsBefore.results).toEqual([expect.objectContaining({ slug: 'chess', status: 'passed' })]);
  });

  it('fails a game whose test file no longer loads against the tree, with what vitest said', () => {
    expect(statusOf(loadsAfter)).toEqual({ chess: 'failed' });
    expect(loadsAfter.results[0].output).toContain('rename it to tests/random-sim.sim.test.ts');
    expect(loadsAfter.results[0].output).toContain('tests/random-sim.test.ts');
  });

  it('fails a game when vitest exits 0 without writing what it collected, as it does on an error outside any test file', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex', { files: { TESTS_UNLISTED: '' } });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ hex: 'failed' });
    expect(run.results[0].output).toContain('test files do not load');
  });
});

describe("a game's branch paired with the BoardSmith branch (#1322)", () => {
  const BRANCH = 'i975-notice-boxes';

  /** A game whose main fails and whose branch `BRANCH` fixes it, left checked out on main. */
  async function pairedGame(fx: ReturnType<typeof fixture>, slug: string): Promise<{ dir: string; fixed: string }> {
    const dir = await makeGame(fx, slug, { files: { BROKEN: 'calls applyNoticeWrites the old way' } });
    git(dir, 'switch', '-q', '-c', BRANCH);
    rmSync(join(dir, 'BROKEN'));
    const fixed = commitAll(dir, 'pass declaredNotices');
    git(dir, 'switch', '-q', 'main');
    return { dir, fixed };
  }

  it("checks a game's branch named as the tree's branch instead of its main, and every other game on main", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    git(fx.tree, 'switch', '-q', '-c', BRANCH);
    const mud = await pairedGame(fx, 'example-mud');
    await makeGame(fx, 'hex');

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ 'example-mud': 'passed', hex: 'passed' });
    expect(run.results.find((r) => r.slug === 'example-mud')).toMatchObject({ ref: BRANCH, commit: mud.fixed });
    expect(run.results.find((r) => r.slug === 'hex')).toMatchObject({ ref: 'main' });
  });

  it("links a catalogue game at its paired branch too", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    git(fx.tree, 'switch', '-q', '-c', BRANCH);
    await pairedGame(fx, 'legacy');
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(statusOf(run)).toEqual({ legacy: 'passed', 'legacy-world': 'passed' });
  });

  it("checks the paired branch on the detached merge commit a merge validates, which merges the tree's branch (#1322 review F1)", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    git(fx.tree, 'switch', '-q', '-c', BRANCH);
    await writeFiles(fx.tree, { 'src/engine.ts': 'export const declared = true;' });
    commitAll(fx.tree, 'the BoardSmith change');
    await pairedGame(fx, 'example-mud');
    git(fx.tree, 'switch', '-q', '--detach', 'main');
    git(fx.tree, 'merge', '-q', '--no-ff', '-m', `Merge branch '${BRANCH}'`, BRANCH);

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(run.results).toEqual([expect.objectContaining({ ref: BRANCH, status: 'passed' })]);
  });

  it('lists every repository used at its paired branch, a skipped one a game links to included (#1322 review F3)', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    git(fx.tree, 'switch', '-q', '-c', BRANCH);
    const legacy = await pairedGame(fx, 'legacy');
    await makeGame(fx, 'legacy-world', { links: ['legacy'] });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, skip: { legacy: 'slow (#1)' } });

    expect(statusOf(run)).toEqual({ 'legacy-world': 'passed' });
    expect(run.paired).toEqual([{ slug: 'legacy', dir: legacy.dir, ref: BRANCH, commit: legacy.fixed }]);
  });

  it("checks main when the tree is on another branch or on none", async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await pairedGame(fx, 'example-mud');

    git(fx.tree, 'switch', '-q', '-c', 'i1-unrelated');
    const onOther = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });
    git(fx.tree, 'switch', '-q', '--detach');
    const detached = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    expect(onOther.results).toEqual([expect.objectContaining({ ref: 'main', status: 'failed' })]);
    expect(detached.results).toEqual([expect.objectContaining({ ref: 'main', status: 'failed' })]);
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

  it('runs every game again after the tree changes, committed or not', () => {
    expect(afterUncommittedChange).toEqual({ hex: 'passed' });
    expect(afterCommit).toEqual({ hex: 'passed' });
    expect(afterCommitAgain).toEqual({ hex: 'cached' });
  });

  it('reuses a pass for the same tree content at another commit, as a thread merge of an up-to-date branch has', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue });

    git(fx.tree, 'commit', '-q', '--allow-empty', '-m', 'same tree, new commit');

    expect(statusOf(await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue }))).toEqual({ hex: 'cached' });
  });

  it("runs a game again when a catalogue game it links to moves, and when the tree's install changes", () => {
    expect(afterLinkedGameMoves).toEqual({
      legacy: 'passed',
      'legacy-world': 'passed',
    });

    expect(afterTreeInstallChanges).toEqual({
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

describe('games left out on purpose (#591)', () => {
  it('does not run a skipped game, and lists it under not checked with its reason', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');
    await makeGame(fx, 'WindupWarfare', { files: { HANG: 'never finishes' } });

    const run = await checkCatalogue({
      tree: fx.tree,
      catalogueRoot: fx.catalogue,
      skip: { WindupWarfare: 'validate does not finish (Shufflewick/WindupWarfare#100)' },
    });

    expect(statusOf(run)).toEqual({ hex: 'passed' });
    expect(run.notChecked).toEqual([{ slug: 'WindupWarfare', reason: 'skipped: validate does not finish (Shufflewick/WindupWarfare#100)' }]);
    expect(runningIn(fx)).toEqual([]);
  });

  it('refuses a skip that names no game the catalogue checks, so a stale skip cannot linger', async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'hex');

    await expect(
      checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, skip: { gone: 'was slow' } }),
    ).rejects.toThrow(/--skip names gone, which is not a game this catalogue checks/);
  });
});

describe('the time limit on one game (#591)', () => {
  it('stops a validate that runs past the limit, child processes included, and fails the game by name', async () => {
    const fx = fixture();
    const workRoot = tempTree('bs-catalogue-work-');
    await makeTree(fx.tree);
    await makeGame(fx, 'WindupWarfare', { files: { HANG: 'never finishes' } });

    const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, timeLimitMs: 2_000, workRoot });

    expect(statusOf(run)).toEqual({ WindupWarfare: 'failed' });
    expect(run.results[0].output).toContain('WindupWarfare did not finish boardsmith validate within 2 seconds, so it was stopped');
    await vi.waitFor(() => expect(runningIn(fx)).toEqual([]), { timeout: 30_000 });
    expect(workFolders(workRoot)).toEqual([]);
  });
});

describe('the processes a game\'s steps leave behind (#1657)', () => {
  const stopAll = (fx: Fixture) => {
    for (const pid of runningIn(fx)) process.kill(Number(pid), 'SIGKILL');
  };

  it('stops what a step left running when it exited on its own, as a stopped vitest leaves its workers', { timeout: 60_000 }, async () => {
    const fx = fixture();
    await makeTree(fx.tree);
    await makeGame(fx, 'sotf', { files: { ORPHAN: 'leaves a child running' } });
    try {
      // A hang guard: the child holds the step's pipes open, so a step waiting on them never ends.
      const run = await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, timeLimitMs: 20_000 });

      expect(run.results).toEqual([expect.objectContaining({ slug: 'sotf', status: 'passed' })]);
      expect(runningIn(fx)).toEqual([]);
    } finally {
      stopAll(fx);
    }
  });

  it('takes every step down when the check is killed outright, which no handler sees', { timeout: 60_000 }, async () => {
    const fx = fixture();
    const workRoot = tempTree('bs-catalogue-work-');
    await makeTree(fx.tree);
    await makeGame(fx, 'sotf', { files: { HANG: 'never finishes' } });
    const options = { tree: fx.tree, catalogueRoot: fx.catalogue, workRoot };
    const program = `const { checkCatalogue } = await import(${JSON.stringify(CATALOGUE_CHECK)}); await checkCatalogue(${JSON.stringify(options)});`;
    // Detached, so SIGKILL to its group reaches what a tool's time limit reaches, and not this test.
    const check = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], { detached: true, stdio: 'ignore' });
    try {
      await vi.waitFor(() => expect(runningIn(fx).length).toBeGreaterThan(1), { timeout: 30_000 });
      process.kill(-check.pid!, 'SIGKILL');
      await vi.waitFor(() => expect(runningIn(fx)).toEqual([]), { timeout: 15_000 });
    } finally {
      try {
        process.kill(-check.pid!, 'SIGKILL');
      } catch {
        // Already killed, as the test does.
      }
      stopAll(fx);
    }
  });
});

describe('the work folder (#591)', () => {
  it.each([
    ['a pass', async (fx: Fixture) => void (await makeGame(fx, 'hex'))],
    ['a failed game', async (fx: Fixture) => void (await makeGame(fx, 'hex', { files: { BROKEN: 'broken' } }))],
    ['a game that could not be exported and linked', async (fx: Fixture) => {
      await makeGame(fx, 'legacy', { installed: false });
      await makeGame(fx, 'hex', { links: ['legacy'] });
      return { legacy: 'not installed' };
    }],
  ])('is removed after %s', async (_, makeGames) => {
    const fx = fixture();
    const workRoot = tempTree('bs-catalogue-work-');
    await makeTree(fx.tree);
    const skip = (await makeGames(fx)) ?? {};

    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, workRoot, skip });

    expect(workFolders(workRoot)).toEqual([]);
  });
});
