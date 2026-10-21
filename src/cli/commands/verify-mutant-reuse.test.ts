/**
 * `boardsmith verify`: a re-verify reuses mutant outcomes only while nothing they depend on changed.
 * The `boardsmith verify` tests are split across the verify*.test.ts files so they run side by
 * side (#1319); verify-fixture.test-helper.ts holds the fixtures they share.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { commitAll, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { check } from './verify-cli.test-helper.js';
import { runVerify } from './verify.js';
import { FEE_TEST, gameOnBranch, CHECKS, dirtiesTheTree } from './verify-fixture.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

describe('boardsmith verify: a re-verify reuses mutant outcomes only while nothing they depend on changed', () => {
  const freshRuns = (lines: string[]) => lines.filter((l) => /^mutant \d+\/\d+: /.test(l) && !l.includes('(reused:')).length;

  it('reuses every mutant after a bookkeeping-only commit, and runs them all again once a test changed', async () => {
    const dir = await gameOnBranch(false);
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);

    const first = await runVerify({ projectDir: dir, checks: CHECKS, log });
    expect(check(first.result, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3, reused: 0 });
    expect(freshRuns(lines)).toBe(3);

    const chunk = join(dir, 'design', 'chunks', 'deal', 'CHUNK.md');
    await fs.writeFile(chunk, `${await fs.readFile(chunk, 'utf-8')}\n<!-- close: verified hash recorded -->\n`);
    await write(dir, { 'design/DECISIONS.md': '## Decision 1\n', 'design/run-log/deal.md': '### Dispatch 1\n' });
    commitAll(dir, 'chunk-deal/step-close');
    lines.length = 0;

    const second = await runVerify({ projectDir: dir, checks: CHECKS, log });
    expect(second.result.passed).toBe(true);
    expect(check(second.result, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3, reused: 3 });
    expect(check(second.result, 'mutation').summary).toMatch(/3 reused from an earlier run of this same code and these same tests/);
    expect(freshRuns(lines)).toBe(0);
    expect(check(second.result, 'test').counts).toMatchObject({ tests: 3, passed: 3 });

    await write(dir, { 'tests/fee.test.ts': FEE_TEST.replace('expect(fee(3)).toBe(6)', "expect(typeof fee).toBe('function')") });
    commitAll(dir, 'chunk-deal/weaker test');
    lines.length = 0;

    const third = await runVerify({ projectDir: dir, checks: CHECKS, log });
    expect(check(third.result, 'mutation').counts).toMatchObject({ mutants: 3, survived: 3, reused: 0 });
    expect(freshRuns(lines)).toBe(3);
  });

  it('says why, and runs every mutant, when a package linked from outside the repository cannot be read (#484)', async () => {
    const dir = await gameOnBranch(false);
    const dep = join(dirname(dir), 'dep');
    await write(dep, { 'index.js': 'export const rate = 2;\n', 'secret/x.js': 'export {};\n' });
    await fs.mkdir(join(dirname(dir), 'node_modules'));
    await fs.symlink(dep, join(dirname(dir), 'node_modules', 'dep'), 'dir');
    await fs.chmod(join(dep, 'secret'), 0o000);
    const lines: string[] = [];
    try {
      await runVerify({ projectDir: dir, checks: CHECKS, log: (l) => lines.push(l) });
    } finally {
      await fs.chmod(join(dep, 'secret'), 0o755);
    }
    expect(lines).toContainEqual(expect.stringMatching(/^the mutant cache is off for this run: could not read .*dep.*; every mutant runs\.$/));
  });

  it('keeps the outcome of each mutant that finished when the run is cut short, so a retry runs only the rest (#940)', async () => {
    const dir = await gameOnBranch(false);
    let cutShort!: () => void;
    const stopped = new Promise<void>((resolve) => { cutShort = resolve; });
    const interrupted = {
      ...CHECKS,
      // Stands in for SIGINT at the third mutant's label: nothing of verify after this point ever runs.
      mutation: async (ctx: Parameters<typeof CHECKS.mutation>[0]) => {
        const log = (line: string) => { if (line.startsWith('mutant 3/')) throw new Error('interrupted'); };
        await CHECKS.mutation({ ...ctx, log }).catch(() => {});
        cutShort();
        return new Promise<never>(() => {});
      },
    };
    void runVerify({ projectDir: dir, checks: interrupted, log: () => {} });
    await stopped;

    const lines: string[] = [];
    const retry = await runVerify({ projectDir: dir, checks: CHECKS, log: (l) => lines.push(l) });
    expect(check(retry.result, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3, reused: 2 });
    expect(freshRuns(lines)).toBe(1);
  });

  it('keeps no outcome from a run whose tree changed while it ran', async () => {
    const dir = await gameOnBranch(false);
    const dirtying = dirtiesTheTree(dir, CHECKS);
    const first = await runVerify({ projectDir: dir, checks: dirtying, log: () => {} });
    expect(first.result.cleanTree).toBe(false);
    expect(check(first.result, 'mutation').counts).toMatchObject({ mutants: 3, reused: 0 });

    await fs.rm(join(dir, 'notes.md'));
    const lines: string[] = [];
    const second = await runVerify({ projectDir: dir, checks: CHECKS, log: (l) => lines.push(l) });
    expect(check(second.result, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3, reused: 0 });
    expect(freshRuns(lines)).toBe(3);
  });
});
