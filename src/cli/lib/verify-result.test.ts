import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import {
  VERIFY_CHECK_NAMES,
  type VerifyCheckResult,
  type VerifyResult,
  buildVerifyResult,
  readVerifyResult,
  resultProblem,
  verifiedProblem,
  verifyResultPath,
  writeVerifyResult,
} from './verify-result.js';
import { commitAll, git, initRepo } from './verify-result.test-helper.js';

const HEAD = 'a'.repeat(40);

function passing(name: VerifyCheckResult['name']): VerifyCheckResult {
  return { name, passed: true, summary: `${name} passed` };
}

function result(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    ...buildVerifyResult({
      commit: HEAD,
      cleanTree: true,
      base: { ref: 'main', commit: 'b'.repeat(40) },
      checks: VERIFY_CHECK_NAMES.map(passing),
    }),
    ...overrides,
  };
}

describe('buildVerifyResult', () => {
  it('passes only when every check passed, and records what the result is tied to', () => {
    const r = result();
    expect(r.passed).toBe(true);
    expect(r.commit).toBe(HEAD);
    expect(r.cleanTree).toBe(true);
    expect(r.base).toEqual({ ref: 'main', commit: 'b'.repeat(40) });
    expect(r.checks.map((c) => c.name)).toEqual([...VERIFY_CHECK_NAMES]);
    expect(r.boardsmith.version).toMatch(/\d+\.\d+/);
    expect(typeof r.boardsmith.engineRevision).toBe('number');

    const failed = buildVerifyResult({
      commit: HEAD,
      cleanTree: true,
      base: { ref: 'main', commit: HEAD },
      checks: VERIFY_CHECK_NAMES.map((n) => (n === 'build' ? { ...passing(n), passed: false } : passing(n))),
    });
    expect(failed.passed).toBe(false);
  });
});

describe('resultProblem: which results vouch for HEAD', () => {
  it('accepts a passing result for this commit made on a clean tree', () => {
    expect(resultProblem(result(), HEAD)).toBeUndefined();
  });

  it('refuses a result for a different commit', () => {
    expect(resultProblem(result({ commit: 'c'.repeat(40) }), HEAD)).toMatch(/different commit.*boardsmith verify/s);
  });

  it('refuses a result made on a working tree with uncommitted changes', () => {
    expect(resultProblem(result({ cleanTree: false }), HEAD)).toMatch(/uncommitted.*boardsmith verify/s);
  });

  it('names each failed check and what to run next', () => {
    const r = result();
    r.checks[0] = { name: 'test', passed: false, summary: '1 test failed in tests/a.test.ts', next: 'Run `boardsmith test` to see it.' };
    r.passed = false;
    const problem = resultProblem(r, HEAD)!;
    expect(problem).toContain('test: 1 test failed in tests/a.test.ts');
    expect(problem).toContain('Run `boardsmith test` to see it.');
    expect(problem).toContain('boardsmith verify');
  });

  it('refuses a result that is missing a check this BoardSmith requires', () => {
    const r = result();
    r.checks = r.checks.filter((c) => c.name !== 'mutation');
    expect(resultProblem(r, HEAD)).toMatch(/mutation.*boardsmith verify/s);
  });

  it('refuses a result in a format this BoardSmith does not read', () => {
    expect(resultProblem({ ...result(), format: 0 } as unknown as VerifyResult, HEAD)).toMatch(/boardsmith verify/);
  });
});

describe('verifiedProblem: the one question every done claim asks', () => {
  async function project(): Promise<string> {
    const tree = tempTree('bs-verify-result-');
    const dir = join(tree, 'game');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, '.gitignore'), '.boardsmith/\n');
    await fs.writeFile(join(dir, 'rules.ts'), 'export const x = 1;\n');
    initRepo(dir);
    commitAll(dir, 'base');
    return dir;
  }

  /** A project whose HEAD has a passing result. */
  async function verifiedProject(): Promise<{ dir: string; head: string }> {
    const dir = await project();
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    await writeVerifyResult(dir, result({ commit: head }));
    return { dir, head };
  }

  it('says to run boardsmith verify when HEAD has no result', async () => {
    const dir = await project();
    const problem = await verifiedProblem(dir);
    expect(problem).toMatch(/No `boardsmith verify` result/);
    expect(problem).toContain('Run `boardsmith verify`');
  });

  it('accepts a passing result for HEAD on a clean tree, written where the result belongs', async () => {
    const { dir, head } = await verifiedProject();
    expect(verifyResultPath(dir, head)).toBe(join(dir, '.boardsmith', 'verify', `${head}.json`));
    expect(await readVerifyResult(dir, head)).toMatchObject({ commit: head, passed: true });
    expect(await verifiedProblem(dir)).toBeUndefined();
  });

  it('refuses once the tree has uncommitted changes, even with a passing result for HEAD', async () => {
    const { dir } = await verifiedProject();
    await fs.writeFile(join(dir, 'rules.ts'), 'export const x = 2;\n');
    expect(await verifiedProblem(dir)).toMatch(/uncommitted changes.*Commit your work.*boardsmith verify/s);
    await fs.writeFile(join(dir, 'rules.ts'), 'export const x = 1;\n');
    await fs.writeFile(join(dir, 'new.ts'), '');
    expect(await verifiedProblem(dir)).toMatch(/uncommitted changes/);
  });

  it('refuses a passing result once a new commit is made', async () => {
    const { dir } = await verifiedProject();
    await fs.writeFile(join(dir, 'rules.ts'), 'export const x = 2;\n');
    commitAll(dir, 'more');
    expect(await verifiedProblem(dir)).toMatch(/No `boardsmith verify` result for the current commit/);
  });

  it('says what to do in a directory that is not a git repository', async () => {
    const tree = tempTree('bs-verify-result-');
    const dir = join(tree, 'loose');
    await fs.mkdir(dir, { recursive: true });
    expect(await verifiedProblem(dir)).toMatch(/not a git repository.*boardsmith verify/s);
  });

  it('says a result file it cannot read must be made again', async () => {
    const dir = await project();
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    await fs.mkdir(join(dir, '.boardsmith', 'verify'), { recursive: true });
    await fs.writeFile(verifyResultPath(dir, head), '{ not json');
    expect(await verifiedProblem(dir)).toMatch(/could not be read.*boardsmith verify/s);
  });
});
