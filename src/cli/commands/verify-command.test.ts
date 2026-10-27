/**
 * The `boardsmith verify` command, as a user runs it.
 * The `boardsmith verify` tests are split across the verify*.test.ts files so they run side by
 * side (#1319); verify-fixture.test-helper.ts holds the fixtures they share.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { commitAll, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { check, verifyAsAUser } from './verify-cli.test-helper.js';
import { runVerify } from './verify.js';
import { repo, gameOnBranch, CHECKS } from './verify-fixture.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

describe('the boardsmith verify command, as a user runs it', () => {
  it('--check exits non-zero and says to run boardsmith verify when HEAD has no result, and 0 once it passed', async () => {
    const dir = await gameOnBranch(false);
    const before = await spawnCli(['verify', '--check', '--project', dir]);
    expect(before.code).toBe(1);
    expect(before.stderr).toMatch(/No `boardsmith verify` result for the current commit.*Run `boardsmith verify`/s);

    await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });
    const after = await spawnCli(['verify', '--check', '--project', dir]);
    expect(after.stderr).toBe('');
    expect(after.code).toBe(0);
    expect(after.stdout).toMatch(/passed `boardsmith verify` on a clean tree/);
  });

  it('runs all six real checks, writes the result and exits non-zero when one fails', async () => {
    // The fixture has a page but no app, rules entry or smoke test, so the real build, validate and
    // smoke fail; the run still goes on through every check rather than stopping at the first
    // failure. (With none of the UI files, build and smoke would be skipped instead, #556.)
    const dir = await gameOnBranch(false);
    await write(dir, { 'index.html': '<div id="app"></div>\n' });
    commitAll(dir, 'a page');
    const { run, result } = await verifyAsAUser(dir);
    expect(run.code).toBe(1);
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([
      ['test', true],
      ['typecheck', true],
      ['build', false],
      ['validate', false],
      ['smoke', false],
      ['verbs', true],
    ]);
    expect(check(result, 'build').next).toBe('Run `boardsmith build` to see why.');
    expect(check(result, 'smoke').summary).toBe('This project has no tests/browser/smoke.spec.ts, so nothing opens the game in a browser.');
    expect(run.stdout).toContain('build');
    expect(run.stdout).toContain('Run `boardsmith build` to see why.');
  });

  it('runs the checks side by side, validate once build is done, and reports them in the usual order (#1495)', async () => {
    const dir = await gameOnBranch(false);
    const events: string[] = [];
    const stub = (name: string) => async () => {
      events.push(`start ${name}`);
      await new Promise(setImmediate);
      events.push(`end ${name}`);
      return { passed: true, summary: `${name} stood in for` };
    };
    const checks = { test: stub('test'), typecheck: stub('typecheck'), build: stub('build'), validate: stub('validate'), smoke: stub('smoke'), verbs: stub('verbs') };
    const { result } = await runVerify({ projectDir: dir, checks, log: () => {} });
    const firstEnd = events.findIndex((e) => e.startsWith('end '));
    expect(events.slice(0, firstEnd).sort()).toEqual(['start build', 'start smoke', 'start test', 'start typecheck', 'start verbs']);
    expect(events.indexOf('start validate')).toBeGreaterThan(events.indexOf('end build'));
    expect(result.checks.map((c) => c.name)).toEqual(['test', 'typecheck', 'build', 'validate', 'smoke', 'verbs']);
  });

  it('refuses a project whose .gitignore does not leave .boardsmith/ out, since its own result would dirty the tree', async () => {
    const tree = tempTree('bs-verify-');
    const dir = join(tree, 'game');
    await write(dir, { 'boardsmith.json': '{}', 'src/a.ts': '' });
    initRepo(dir);
    commitAll(dir, 'base');
    await expect(runVerify({ projectDir: dir, log: () => {} })).rejects.toThrow(/\.gitignore.*\.boardsmith\/.*boardsmith verify/s);
  });

  it('refuses a directory that is not a game project, and --check with --base, saying what to do', async () => {
    const dir = await repo({ 'src/a.ts': '' });
    const run = await spawnCli(['verify', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`${dir} has no boardsmith.json, so it is not a BoardSmith game project.`);
    const both = await spawnCli(['verify', '--check', '--base', 'main', '--project', dir]);
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(/--base does not apply/);
  });
});
