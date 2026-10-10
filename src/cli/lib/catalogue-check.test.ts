/**
 * `boardsmith catalogue` validates each catalogue game against the BoardSmith tree it is given (#591).
 * The fixtures are in `catalogue-fixture.test-helper.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commitAll, git, initRepo, writeFiles } from './verify-result.test-helper.js';
import { CATALOGUE_CLONE_COMMAND, catalogueCachePath, checkCatalogue } from './catalogue-check.js';
import { checkoutState, fixture, makeGame, makeTree, runningIn, statusOf, workFolders } from './catalogue-fixture.test-helper.js';

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

describe('the work folder (#591)', () => {
  it.each([
    ['a pass', {}],
    ['a failed game', { files: { BROKEN: 'broken' } }],
    ['a game that could not be exported and linked', { installed: false }],
  ])('is removed after %s', async (_, spec) => {
    const fx = fixture();
    const workRoot = tempTree('bs-catalogue-work-');
    await makeTree(fx.tree);
    await makeGame(fx, 'hex', spec);

    await checkCatalogue({ tree: fx.tree, catalogueRoot: fx.catalogue, workRoot });

    expect(workFolders(workRoot)).toEqual([]);
  });
});
