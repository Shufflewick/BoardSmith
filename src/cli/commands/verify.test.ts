/**
 * `boardsmith verify`: where a change is measured from, and a claim of green refused while any test fails.
 * The `boardsmith verify` tests are split across the verify*.test.ts files so they run side by
 * side (#1319); verify-fixture.test-helper.ts holds the fixtures they share.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { readVerifyResult, verifiedProblem } from '../lib/verify-result.js';
import { commitAll, git, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { plantOtherRuns } from '../lib/command-build-dirs.test-helper.js';
import { check } from './verify-cli.test-helper.js';
import { VERIFY_CHECKS, changedSince, resolveBase, runVerify } from './verify.js';
import { repo, FEE_TEST, gameOnBranch, CHECKS, signoff } from './verify-fixture.test-helper.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

describe("the test check names vitest's report when it cannot read it (#1174)", () => {
  it('rather than taking the suite for one that wrote no report', async () => {
    const sandbox = fixtureSandbox('bs-verify-report-');
    const dir = join(sandbox.root, 'game');
    await write(dir, {
      'vite.config.ts': GAME_VITE_CONFIG,
      'tests/a.test.ts': "import { it } from 'vitest';\nit('runs', () => {});\n",
      // A vitest that leaves a folder where its JSON report belongs.
      'node_modules/.bin/vitest':
        "#!/usr/bin/env node\nconst flag = '--outputFile.json=';\n" +
        "require('node:fs').mkdirSync(process.argv.find((a) => a.startsWith(flag)).slice(flag.length));\n",
    });
    await fs.chmod(join(dir, 'node_modules/.bin/vitest'), 0o755);
    const report = join(dir, '.boardsmith');
    for (const key of ['HOME', 'TMPDIR', 'PATH', 'NODE_OPTIONS'] as const) vi.stubEnv(key, sandbox.env[key]!);
    try {
      await expect(VERIFY_CHECKS.test({ projectDir: dir, changed: { files: [] } } as unknown as Parameters<typeof VERIFY_CHECKS.test>[0])).rejects.toThrow(
        new RegExp(`Could not read ${report}.*test-report\\.json \\(EISDIR\\)`),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('resolveBase: where the changes are measured from', () => {
  it('defaults to the merge base with main, not main\'s newer commits', async () => {
    const dir = await repo({ 'src/a.ts': 'export const a = 1;\n' });
    const forkPoint = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'work');
    await write(dir, { 'src/a.ts': 'export const a = 2;\n' });
    commitAll(dir, 'work');
    git(dir, 'checkout', '-q', 'main');
    await write(dir, { 'src/b.ts': 'export const b = 1;\n' });
    commitAll(dir, 'main moves on');
    git(dir, 'checkout', '-q', 'work');

    expect(await resolveBase(dir, undefined)).toEqual({ ref: 'main', commit: forkPoint });
    expect(await resolveBase(dir, 'HEAD~1')).toEqual({ ref: 'HEAD~1', commit: forkPoint });
  });

  it('says to pass --base when there is no main branch, and names a --base it cannot find', async () => {
    const dir = await repo({ 'src/a.ts': '' });
    git(dir, 'branch', '-m', 'trunk');
    await expect(resolveBase(dir, undefined)).rejects.toThrow(/no main or master branch.*--base/s);
    await expect(resolveBase(dir, 'no-such-ref')).rejects.toThrow(/--base no-such-ref.*commit/s);
  });
});

describe('changedSince: the files and code lines a change touched', () => {
  it('counts committed, uncommitted and untracked changes, and mutates only code under src/', async () => {
    const dir = await repo({
      'src/rules.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
      'src/gone.ts': 'export const g = 1;\n',
      'tests/rules.test.ts': "it('x', () => {});\n",
    });
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    await write(dir, { 'src/rules.ts': 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\n' });
    commitAll(dir, 'change b');
    await write(dir, {
      'src/rules.ts': 'export const a = 1;\nexport const b = 20;\nexport const c = 30;\nexport const d = 4;\n',
      'src/ui/Board.vue': '<template><p>{{ 1 + 1 }}</p></template>\n',
      'tests/rules.test.ts': "it('y', () => {});\n",
      'README.md': 'notes\n',
    });
    await fs.rm(join(dir, 'src/gone.ts'));

    const changed = await changedSince(dir, base);
    expect(changed.files).toEqual(['README.md', 'src/gone.ts', 'src/rules.ts', 'src/ui/Board.vue', 'tests/rules.test.ts']);
    expect([...changed.code.keys()]).toEqual(['src/rules.ts', 'src/ui/Board.vue']);
    expect([...changed.code.get('src/rules.ts')!]).toEqual([2, 3, 4]);
    expect([...changed.code.get('src/ui/Board.vue')!]).toEqual([1]);
  });

  it('names paths from the game project, not the repository, when the game sits in a subfolder of its repo', async () => {
    const root = await repo({
      'README.md': 'the repository\n',
      'games/bid/src/rules.ts': 'export const a = 1;\n',
      'games/bid/tests/rules.test.ts': "it('x', () => {});\n",
      'games/other/src/rules.ts': 'export const o = 1;\n',
    });
    const dir = join(root, 'games', 'bid');
    const base = git(root, 'rev-parse', 'HEAD').trim();
    await write(root, {
      'games/bid/src/rules.ts': 'export const a = 2;\n',
      'games/other/src/rules.ts': 'export const o = 2;\n',
      'README.md': 'changed outside the game\n',
    });
    commitAll(root, 'change both games');
    await write(dir, { 'src/new.ts': 'export const n = 1;\n', 'tests/new.test.ts': "it('n', () => {});\n" });

    const changed = await changedSince(dir, base);
    expect(changed.files).toEqual(['src/new.ts', 'src/rules.ts', 'tests/new.test.ts']);
    expect([...changed.code.keys()]).toEqual(['src/new.ts', 'src/rules.ts']);
    expect([...changed.code.get('src/rules.ts')!]).toEqual([1]);
  });

  // git ends a name with a space with a tab and C-quotes one with a quote or non-ASCII letter (#834).
  const ODD_NAMES = ['src/a b.ts', 'src/say"hi".ts', 'src/café.ts'];

  it('keeps committed changes to files whose names git would quote', async () => {
    const dir = await repo(Object.fromEntries(ODD_NAMES.map((name) => [name, 'export const a = 1;\nexport const b = 2;\n'])));
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    await write(dir, Object.fromEntries(ODD_NAMES.map((name) => [name, 'export const a = 1;\nexport const b = 3;\n'])));
    commitAll(dir, 'change b');

    const changed = await changedSince(dir, base);
    const sorted = [...ODD_NAMES].sort();
    expect(changed.files).toEqual(sorted);
    expect([...changed.code.keys()]).toEqual([...ODD_NAMES].sort((a, b) => a.localeCompare(b)));
    for (const name of ODD_NAMES) expect([...changed.code.get(name)!]).toEqual([2]);
  });

  it('counts only the edited lines of a renamed file', async () => {
    const dir = await repo({ 'src/old.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n' });
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    git(dir, 'mv', 'src/old.ts', 'src/new name.ts');
    await write(dir, { 'src/new name.ts': 'export const a = 1;\nexport const b = 20;\nexport const c = 3;\n' });
    commitAll(dir, 'rename and edit');

    const changed = await changedSince(dir, base);
    expect(changed.files).toEqual(['src/new name.ts']);
    expect([...changed.code.get('src/new name.ts')!]).toEqual([2]);
  });

  it('keeps untracked files whose names git would quote', async () => {
    const dir = await repo({ 'src/rules.ts': 'export const a = 1;\n' });
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    await write(dir, Object.fromEntries(ODD_NAMES.map((name) => [name, 'export const n = 1;\n'])));

    const changed = await changedSince(dir, base);
    expect(changed.files).toEqual([...ODD_NAMES].sort());
    for (const name of ODD_NAMES) expect([...changed.code.get(name)!]).toEqual([1]);
  });
});

describe('boardsmith verify: a claim of green is refused when a test outside the changed files fails', () => {
  it('fails the full suite, names the file the change did not touch, and every done claim is refused', async () => {
    const dir = await gameOnBranch(true);
    const head = git(dir, 'rev-parse', 'HEAD').trim();

    const { result, path } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    expect(path).toBe(join(dir, '.boardsmith', 'verify', `${head}.json`));
    expect(await readVerifyResult(dir, head)).toEqual(result);
    expect(result.passed).toBe(false);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(result.commit).toBe(head);
    expect(result.cleanTree).toBe(true);
    expect(result.base.ref).toBe('main');
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([
      ['test', false],
      ['typecheck', true],
      ['build', true],
      ['validate', true],
      ['smoke', true],
      ['mutation', false],
    ]);
    const test = check(result, 'test');
    expect(test.summary).toBe('1 test failed in the full suite, in a file you did not change: tests/bid.test.ts.');
    expect(test.next).toBe('Run `boardsmith test` to see it.');
    expect(test.counts).toEqual({ files: 2, tests: 3, passed: 2, failed: 1, skipped: 0 });
    expect(check(result, 'mutation').summary).toMatch(/not run.*full suite/i);

    const problem = await verifiedProblem(dir);
    expect(problem).toContain('test: 1 test failed in the full suite, in a file you did not change: tests/bid.test.ts.');
    expect(problem).toContain('boardsmith verify');
    await expect(signoff(dir)).rejects.toThrow(/boardsmith verify/);
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it('passes once the whole suite is green and every changed line is caught, and the claim is accepted', async () => {
    const dir = await gameOnBranch(false);
    const expectOtherRunsKept = plantOtherRuns(dir);

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    // Its suite and mutation runs each worked in a directory of their own, and removed only that (#544).
    expectOtherRunsKept();
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(check(result, 'test').counts).toEqual({ files: 2, tests: 3, passed: 3, failed: 0, skipped: 0 });
    // `return price * 2`: return undefined, * -> /, 2 -> 3. The fee test catches each one.
    expect(check(result, 'mutation').counts).toEqual({ files: 1, mutants: 3, killed: 3, survived: 0, timedOut: 0, equivalent: 0, unreached: 0, reused: 0 });
    expect(await verifiedProblem(dir)).toBeUndefined();
  });

  it('reports each mutant of a changed line no test catches, by file and line', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'tests/fee.test.ts': FEE_TEST.replace('expect(fee(3)).toBe(6)', 'expect(typeof fee).toBe(\'function\')') });
    commitAll(dir, 'chunk-deal/weaker test');

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    const mutation = check(result, 'mutation');
    expect(mutation.passed).toBe(false);
    expect(mutation.findings).toEqual([
      { file: 'src/rules.ts', line: 5, detail: 'return value replaced with undefined: no test failed', mutantId: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { file: 'src/rules.ts', line: 5, detail: '* -> /: no test failed', mutantId: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { file: 'src/rules.ts', line: 5, detail: '2 -> 3: no test failed', mutantId: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(mutation.next).toMatch(/test.*fails.*boardsmith verify/s);
  });

  it('reports each mutant in a file no test loads, neither killed nor survived (#981)', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'src/unused.ts': 'export function same(n: number): number {\n  return n;\n}\n' });
    commitAll(dir, 'chunk-deal/a module no test loads');

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    const mutation = check(result, 'mutation');
    expect(mutation.passed).toBe(false);
    expect(mutation.counts).toMatchObject({ mutants: 4, killed: 3, survived: 0, unreached: 1 });
    expect(mutation.findings).toEqual([
      { file: 'src/unused.ts', line: 2, detail: 'return value replaced with undefined: no test loads src/unused.ts' },
    ]);
    expect(mutation.summary).toMatch(/1 of 4 mutants .* in a file no test loads/);
    expect(mutation.next).toMatch(/test that imports/);
  });

  it('runs mutants side by side within the budget boardsmith.json sets (#955)', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table', mutation: { trials: 2, workers: 2 } }) });
    commitAll(dir, 'chunk-deal/mutation budget');
    const lines: string[] = [];

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: (l) => lines.push(l) });

    expect(check(result, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3, survived: 0 });
    expect(lines).toContain('Running 2 mutants at a time, each with 1 test worker, of a budget of 2.');
  });

  it('fails the mutation check, saying what to write, when the budget in boardsmith.json is wrong (#955)', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table', mutation: { trials: 3, workers: 1 } }) });
    commitAll(dir, 'chunk-deal/mutation budget');

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    expect(check(result, 'mutation').passed).toBe(false);
    expect(check(result, 'mutation').summary).toMatch(/"mutation.workers" \(1\) must be at least "mutation.trials" \(3\)/);
  });

  it('fails the mutation check on the main branch with no --base, rather than passing with nothing covered', async () => {
    const dir = await gameOnBranch(false);
    const started = git(dir, 'rev-parse', 'main').trim();
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'merge', '-q', '--ff-only', 'chunk/deal');

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    expect(result.passed).toBe(false);
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([
      ['test', true],
      ['typecheck', true],
      ['build', true],
      ['validate', true],
      ['smoke', true],
      ['mutation', false],
    ]);
    const mutation = check(result, 'mutation');
    expect(mutation.summary).toMatch(/merge base with main is the current commit.*nothing/s);
    expect(mutation.next).toMatch(/--base <commit the work started from>/);

    const { result: based } = await runVerify({ projectDir: dir, base: started, checks: CHECKS, log: () => {} });
    expect(based.passed).toBe(true);
    expect(check(based, 'mutation').counts).toMatchObject({ mutants: 3, killed: 3 });
    // Asked for by name, a base at HEAD is a statement that nothing is being changed (the one-time
    // gate transition builds nothing), and the result records it.
    const { result: nothing } = await runVerify({ projectDir: dir, base: 'HEAD', checks: CHECKS, log: () => {} });
    expect(nothing.passed).toBe(true);
    expect(nothing.base.ref).toBe('HEAD');
    expect(check(nothing, 'mutation').summary).toMatch(/^No code under src\/ changed since HEAD/);
  });
});
