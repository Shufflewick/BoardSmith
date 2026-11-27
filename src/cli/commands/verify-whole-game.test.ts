/**
 * `boardsmith verify` on a whole game, as a user runs it (#453): the table `boardsmith init`
 * scaffolds, through all five real checks.
 *
 * These are the slowest verify runs, each building the game, so they live in their own file: vitest
 * runs it alongside the `verify*.test.ts` files rather than after them.
 */
import { describe, expect, it, vi } from 'vitest';

import { join } from 'node:path';
import { bundleDigest, readDistDir } from '../lib/zip.js';
import { commitAll, git, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { check, verifyAsAUser } from './verify-cli.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

/**
 * The table `boardsmith init` scaffolds, given the bot validate requires and built on a branch that
 * adds `fee`: a whole game every one of the five real checks can run.
 */
async function scaffoldedTableOnBranch(init: { sim?: boolean } = {}): Promise<string> {
  const dir = await smokeProject(false, {}, { ...init, bot: true });
  git(dir, 'checkout', '-q', '-b', 'fee');
  await write(dir, {
    'src/rules/fee.ts': 'export function fee(price: number): number {\n  return price * 2;\n}\n',
    'tests/fee.test.ts':
      "import { it, expect } from 'vitest';\nimport { fee } from '../src/rules/fee.js';\n" +
      "it('the fee is twice the price', () => { expect(fee(3)).toBe(6); });\n",
  });
  commitAll(dir, 'add the fee');
  return dir;
}

describe('boardsmith verify on a whole game, as a user runs it', () => {
  it('passes all five real checks on the scaffolded table, and --check then accepts the commit', async () => {
    const dir = await scaffoldedTableOnBranch();
    const { run, result } = await verifyAsAUser(dir);
    expect(result.checks.map((c) => [c.name, c.passed, c.summary])).toEqual([
      ['test', true, expect.stringMatching(/^\d+ tests passed in \d+ files\.$/)],
      ['typecheck', true, 'No type errors.'],
      ['build', true, '`boardsmith build` passed.'],
      ['validate', true, '`boardsmith validate` passed.'],
      ['verbs', true, 'Every one of the 2 verbs the game defines is dispatched through the engine by a test.'],
    ]);
    // Publish uploads dist/ only while it is this bundle (#1495).
    expect(check(result, 'build').bundle).toBe(bundleDigest(readDistDir(join(dir, 'dist'))));
    expect(result.checks.filter((c) => c.skipped)).toEqual([]);
    expect(run.stdout).toMatch(/Every check passed for /);
    expect(run.code).toBe(0);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect((await spawnCli(['verify', '--check', '--project', dir])).code).toBe(0);
  });

  it('runs test, typecheck, validate and verbs on a game with no UI yet, skipping build and saying so (#556)', async () => {
    const dir = await scaffoldedTableOnBranch({ sim: true });
    const { run, result } = await verifyAsAUser(dir);
    const skip = 'Skipped: this project has no UI yet (no index.html); run `boardsmith add-ui`.';
    expect(result.checks.map((c) => [c.name, c.passed, c.skipped, c.summary])).toEqual([
      ['test', true, undefined, expect.stringMatching(/^\d+ tests passed in \d+ files\.$/)],
      ['typecheck', true, undefined, 'No type errors.'],
      ['build', true, true, skip],
      ['validate', true, undefined, '`boardsmith validate` passed.'],
      ['verbs', true, undefined, 'Every one of the 2 verbs the game defines is dispatched through the engine by a test.'],
    ]);
    expect(result.passed).toBe(true);
    expect(run.stdout).not.toMatch(/Every check passed/);
    expect(run.stdout).toMatch(/Passed for \w+, except build, skipped because this project has no UI yet\./);
    expect(run.code).toBe(0);
    const checked = await spawnCli(['verify', '--check', '--project', dir]);
    expect(checked.stdout).toMatch(/except build, skipped because this project has no UI yet/);
    expect(checked.code).toBe(0);
  });

  it('fails build, never skipping it, on a table that lost index.html but kept its other UI files (#556)', async () => {
    const dir = await scaffoldedTableOnBranch();
    git(dir, 'rm', '-q', 'index.html');
    commitAll(dir, 'lose the page');
    const { run, result } = await verifyAsAUser(dir);
    const broken =
      'index.html is missing, but this project has UI files (src/main.ts, src/ui/index.ts, src/ui/uis.ts, ' +
      'src/ui/App.vue, src/ui/components/GameTable.vue, tests/a11y.example.test.ts, tests/browser/smoke.spec.ts); ' +
      'restore index.html, or remove them and run `boardsmith add-ui`.';
    expect(check(result, 'build')).toMatchObject({ passed: false, summary: broken });
    expect(check(result, 'build').skipped).toBeUndefined();
    expect(result.passed).toBe(false);
    expect(run.stdout).not.toMatch(/skipped because this project has no UI yet/);
    expect(run.code).toBe(1);
  });

  it('stops a verify run whose checks stall, with what it started, and names the checks that had not reported (#1779)', async () => {
    const dir = await smokeProject(false, {
      'tests/hang.test.ts': "import { it } from 'vitest';\nit('never settles', () => new Promise<void>(() => {}), 0);\n",
    }, { sim: true });
    await expect(verifyAsAUser(dir, [], { stallAfterMs: 1_000 })).rejects.toThrow(/was still running its checks .*Checks that had not reported: [^\n]*\btest\b/s);
  });
});
