/**
 * What `boardsmith catalogue` prints and exits with (#591). The run itself is
 * `src/cli/lib/catalogue-check.test.ts`; this is the report a reader holding an
 * unrelated BoardSmith change sees.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { fixture, makeGame, makeTree, runningIn, workFolders } from '../lib/catalogue-fixture.test-helper.js';
import { catalogueReport, parseSkips } from './catalogue.js';

const hex = { slug: 'hex', dir: '/games/hex', commit: '836f3ad0000000000000000000000000000000000', ref: 'main' };
const cribbage = { slug: 'cribbage', dir: '/games/cribbage', commit: 'a06bf140000000000000000000000000000000000', ref: 'main' };

describe('the catalogue report (#591)', () => {
  it('passes when every game validates, naming cached passes and the folders not checked', () => {
    const report = catalogueReport({
      results: [{ ...hex, status: 'cached' }, { ...cribbage, status: 'passed' }],
      notChecked: [{ slug: 'LacunaExpanse', reason: 'pins its own boardsmith (file:./vendor/b.tgz)' }],
      paired: [],
    });
    expect(report.ok).toBe(true);
    expect(report.text).toContain('hex: validates against this tree (passed before on these inputs)');
    expect(report.text).toContain('cribbage: validates against this tree');
    expect(report.text).toContain('LacunaExpanse: pins its own boardsmith (file:./vendor/b.tgz)');
  });

  it("fails on a game that does not validate, with the validator's output, the commit and where to fix it", () => {
    const report = catalogueReport({
      results: [{ ...hex, status: 'passed' }, { ...cribbage, status: 'failed', output: 'TS2322: TableBoardProps\n' }],
      notChecked: [],
      paired: [],
    });
    expect(report.ok).toBe(false);
    expect(report.text).toContain('cribbage FAILED on its main (a06bf140) against this BoardSmith tree');
    expect(report.text).toContain('TS2322: TableBoardProps');
    expect(report.text).toContain('/games/cribbage');
    expect(report.text).toContain(
      'If this change needs a change to cribbage, commit it in /games/cribbage on a branch with the same name as this BoardSmith branch: the check uses that branch instead of main.',
    );
  });
});

describe("the report of a game checked on its paired branch (#1322)", () => {
  const mud = { slug: 'example-mud', dir: '/games/example-mud', commit: '6f246020000000000000000000000000000000000', ref: 'i975-notice-boxes' };

  it('names the branch a game passed on, and says it must land on the game right after this change', () => {
    const legacy = { slug: 'legacy', dir: '/games/legacy', commit: mud.commit, ref: mud.ref };
    const report = catalogueReport({ results: [{ ...hex, status: 'passed' }, { ...mud, status: 'passed' }], notChecked: [], paired: [mud, legacy] });
    expect(report.ok).toBe(true);
    expect(report.text).toContain('example-mud: validates against this tree, on its branch i975-notice-boxes');
    expect(report.text).toContain(
      'example-mud was checked on its branch i975-notice-boxes, not its main. Merge that branch into its main in /games/example-mud right after this BoardSmith change lands.',
    );
    expect(report.text).toContain('legacy was checked on its branch i975-notice-boxes');
    expect(report.text).not.toContain('hex was checked');
  });

  it('names the branch a game failed on, without telling the reader to merge it or to make it (review F2, F3)', () => {
    const report = catalogueReport({ results: [{ ...mud, status: 'failed', output: 'TS2554\n' }], notChecked: [], paired: [mud] });
    expect(report.text).toContain('example-mud FAILED on its i975-notice-boxes (6f246020) against this BoardSmith tree');
    expect(report.text).not.toContain('Merge that branch');
    expect(report.text).not.toContain('on a branch with the same name');
  });
});

describe('--skip (#591)', () => {
  it('reads each skip as a game and the reason it is skipped', () => {
    expect(parseSkips(['WindupWarfare=validate does not finish (Shufflewick/WindupWarfare#100)'])).toEqual({
      WindupWarfare: 'validate does not finish (Shufflewick/WindupWarfare#100)',
    });
  });

  it('refuses a skip without a reason', () => {
    expect(() => parseSkips(['WindupWarfare'])).toThrow(/--skip WindupWarfare has no reason/);
    expect(() => parseSkips(['WindupWarfare=  '])).toThrow(/--skip WindupWarfare has no reason/);
  });
});

describe('stopping a run (#591)', () => {
  vi.setConfig({ testTimeout: 120_000 });

  it('ends the validate it started, and what that started, and removes its work folder, on SIGTERM', async () => {
    const fx = fixture();
    const tmp = tempTree('bs-catalogue-stop-');
    await makeTree(fx.tree);
    await makeGame(fx, 'WindupWarfare', { files: { HANG: 'never finishes' } });

    const cli = spawn(process.execPath, [join(REPO_ROOT, 'bin', 'boardsmith.js'), 'catalogue', '--catalogue', fx.catalogue], {
      cwd: fx.tree,
      env: { ...process.env, TMPDIR: tmp },
      stdio: 'ignore',
    });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => cli.on('exit', (_, signal) => resolve(signal)));
    // The stub and the child it starts are both running before the stop is sent.
    await vi.waitFor(() => expect(runningIn(fx)).toHaveLength(2), { timeout: 90_000, interval: 200 });

    cli.kill('SIGTERM');

    expect(await exited).toBe('SIGTERM');
    await vi.waitFor(() => expect(runningIn(fx)).toEqual([]), { timeout: 30_000 });
    expect(workFolders(tmp)).toEqual([]);
  });
});
