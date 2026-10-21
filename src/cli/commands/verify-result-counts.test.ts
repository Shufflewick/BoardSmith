/**
 * `boardsmith verify`: a result counts only for a clean tree, and only when what the tests ran with stayed the same.
 * The `boardsmith verify` tests are split across the verify*.test.ts files so they run side by
 * side (#1319); verify-fixture.test-helper.ts holds the fixtures they share.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { mutantCachePath } from '../lib/mutant-cache.js';
import { readVerifyResult, verifiedProblem } from '../lib/verify-result.js';
import { commitAll, git, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { check } from './verify-cli.test-helper.js';
import { runVerify } from './verify.js';
import { gameOnBranch, CHECKS, dirtiesTheTree, countingChecks } from './verify-fixture.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

describe('boardsmith verify: a result counts only for a commit on a clean tree', () => {
  it('refuses a dirty tree before running any check, and keeps the passing result already on file', async () => {
    const dir = await gameOnBranch(false);
    const { ran, checks } = countingChecks();
    const { result: earlier } = await runVerify({ projectDir: dir, checks, log: () => {} });
    expect(earlier.passed).toBe(true);
    expect(ran).toHaveLength(6);

    await write(dir, { 'notes.md': 'uncommitted\n' });
    await expect(runVerify({ projectDir: dir, checks, log: () => {} })).rejects.toThrow(
      /uncommitted changes.*Commit.*then run `boardsmith verify`/s,
    );
    expect(ran).toHaveLength(6);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    expect(await readVerifyResult(dir, head)).toEqual(earlier);
  });

  it('says to commit first, and exits non-zero, when the command is run on a dirty tree', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'notes.md': 'uncommitted\n' });
    const run = await spawnCli(['verify', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/uncommitted changes.*Commit/s);
    expect(run.stdout).not.toContain('boardsmith verify: test');
  });

  it('records a run the tree changed during as not clean, without replacing a clean passing result', async () => {
    const dir = await gameOnBranch(false);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const { checks } = countingChecks();
    const dirtying = dirtiesTheTree(dir, checks);

    const first = await runVerify({ projectDir: dir, checks: dirtying, log: () => {} });
    expect(first.result).toMatchObject({ cleanTree: false, passed: true });
    expect(first.path).toBe(join(dir, '.boardsmith', 'verify', `${head}.json`));
    expect(await readVerifyResult(dir, head)).toEqual(first.result);
    expect(await verifiedProblem(dir)).toMatch(/uncommitted changes/);

    await fs.rm(join(dir, 'notes.md'));
    const { result: clean } = await runVerify({ projectDir: dir, checks, log: () => {} });
    expect(clean.cleanTree).toBe(true);

    const again = await runVerify({ projectDir: dir, checks: dirtying, log: () => {} });
    expect(again.result.cleanTree).toBe(false);
    expect(again.path).toBeUndefined();
    expect(await readVerifyResult(dir, head)).toEqual(clean);
  });

  it('lets a failing clean re-run replace a passing result for the same commit, so the latest clean run governs', async () => {
    const dir = await gameOnBranch(false);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const { checks } = countingChecks();
    const { result: passing } = await runVerify({ projectDir: dir, checks, log: () => {} });
    expect(passing).toMatchObject({ cleanTree: true, passed: true });
    expect(await verifiedProblem(dir)).toBeUndefined();

    const failing = { ...checks, test: async () => ({ passed: false, summary: '1 failed' }) };
    const again = await runVerify({ projectDir: dir, checks: failing, log: () => {} });
    expect(again.result).toMatchObject({ cleanTree: true, passed: false });
    expect(again.path).toBe(join(dir, '.boardsmith', 'verify', `${head}.json`));
    expect(await readVerifyResult(dir, head)).toEqual(again.result);
    expect(await verifiedProblem(dir)).toMatch(/fail/i);
  });
});

describe('boardsmith verify: a run counts only when what the tests run with stayed the same (#932)', () => {
  /** A BoardSmith checkout outside the game's repository, linked in as the one the game loads. */
  async function linkedBoardsmith(dir: string): Promise<string> {
    const bs = join(tempTree('bs-verify-linked-'), 'BoardSmith');
    await write(bs, { 'package.json': '{ "name": "boardsmith", "version": "0.0.0" }\n', 'index.js': 'export {};\n' });
    initRepo(bs);
    commitAll(bs, 'start');
    await fs.rm(join(dir, 'node_modules', 'boardsmith'));
    await fs.symlink(bs, join(dir, 'node_modules', 'boardsmith'), 'dir');
    return bs;
  }

  it('refuses the run, writes no result, and names both commits when the linked BoardSmith moves mid-run', async () => {
    const dir = await gameOnBranch(false);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const bs = await linkedBoardsmith(dir);
    const started = git(bs, 'rev-parse', 'HEAD').trim();
    const { checks } = countingChecks();
    const moving = {
      ...checks,
      build: async () => {
        await write(bs, { 'index.js': 'export const changed = true;\n' });
        commitAll(bs, 'advance');
        return { passed: true, summary: 'stood in for by the fixture' };
      },
    };
    const refusal = runVerify({ projectDir: dir, checks: moving, log: () => {} });
    await expect(refusal).rejects.toThrow(/changed while `boardsmith verify` ran/);
    await expect(refusal).rejects.toThrow(new RegExp(`${started}.*${git(bs, 'rev-parse', 'HEAD').trim()}`, 's'));
    await expect(refusal).rejects.toThrow(/no result was recorded.*Run `boardsmith verify` again/s);
    expect(await readVerifyResult(dir, head)).toBeUndefined();
  });

  /** A game on its branch with a package `dep` linked from outside the repository, at `rate = 2`. */
  async function gameWithLinkedDep(): Promise<{ dir: string; dep: string }> {
    const dir = await gameOnBranch(false);
    const dep = join(dirname(dir), 'dep');
    await write(dep, { 'index.js': 'export const rate = 2;\n' });
    await fs.mkdir(join(dirname(dir), 'node_modules'));
    await fs.symlink(dep, join(dirname(dir), 'node_modules', 'dep'), 'dir');
    return { dir, dep };
  }

  const savedOutcomes = async (dir: string) =>
    (JSON.parse(await fs.readFile(await mutantCachePath(dir), 'utf-8')) as { outcomes: unknown[] }).outcomes;

  it('stops before the next mutant once a linked package changes, keeping only the outcome found before the change (#940)', async () => {
    const { dir, dep } = await gameWithLinkedDep();
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
      if (line.startsWith('mutant 2/')) writeFileSync(join(dep, 'index.js'), 'export const rate = 3;\n');
    };
    await expect(runVerify({ projectDir: dir, checks: CHECKS, log })).rejects.toThrow(/the packages linked from outside the repository/);
    expect(lines.filter((l) => /^mutant \d+\/\d+: /.test(l))).toHaveLength(2);
    expect(await readVerifyResult(dir, head)).toBeUndefined();
    expect(await savedOutcomes(dir)).toHaveLength(1);
  });

  for (const changesBack of [false, true]) {
    it(`keeps no outcome of a mutant during whose run a linked package changed${changesBack ? ', even once it changes back' : ''} (#940)`, async () => {
      const { dir, dep } = await gameWithLinkedDep();
      const head = git(dir, 'rev-parse', 'HEAD').trim();
      let step: 'before' | 'labelled' | 'changed' | 'done' = 'before';
      const log = (line: string) => { if (line.startsWith('mutant 2/')) step = 'labelled'; };
      const checks = {
        ...CHECKS,
        // The package changes just after mutant 2's own check found it unchanged, so it changes while mutant 2 runs.
        mutation: (ctx: Parameters<typeof CHECKS.mutation>[0]) => CHECKS.mutation({ ...ctx, contextChange: async () => {
          const change = await ctx.contextChange();
          if (step === 'labelled') {
            writeFileSync(join(dep, 'index.js'), 'export const rate = 3;\n');
            step = 'changed';
          } else if (step === 'changed' && changesBack) {
            writeFileSync(join(dep, 'index.js'), 'export const rate = 2;\n');
            step = 'done';
          }
          return change;
        } }),
      };
      const run = runVerify({ projectDir: dir, checks, log });
      if (changesBack) {
        const { result } = await run;
        expect(check(result, 'mutation').passed).toBe(false);
      } else {
        await expect(run).rejects.toThrow(/the packages linked from outside the repository/);
        expect(await readVerifyResult(dir, head)).toBeUndefined();
      }
      expect(await savedOutcomes(dir)).toHaveLength(1);
    });
  }
});
