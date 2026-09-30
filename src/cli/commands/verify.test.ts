import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { generateVitestConfig } from '../lib/test-run-scope.js';
import { readVerifyResult, verifiedProblem, type VerifyResult } from '../lib/verify-result.js';
import { commitAll, git, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { makeChunkProject } from './chunk-project.test-helper.js';
import { recordSignoff } from './chunk-signoff.js';
import { VERIFY_CHECKS, changedSince, resolveBase, runVerify } from './verify.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

/** A repository on `main` with one commit, holding `files`. */
async function repo(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-verify-');
  const dir = join(tree, 'game');
  await write(dir, { '.gitignore': '.boardsmith/\nnode_modules\n', ...files });
  initRepo(dir);
  commitAll(dir, 'base');
  return dir;
}

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
});

// -------------------------------------------------------------------------------------------
// The acceptance fixture (#452): a claim of green is refused when one test outside the changed
// files fails, and accepted once the whole suite is green.
// -------------------------------------------------------------------------------------------

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
`;

const BID_TEST = `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
it('an equal offer loses', () => { expect(bid(3, 3)).toBe(false); });
`;

const FEE_TEST = `import { it, expect } from 'vitest';
import { fee } from '../src/rules';
it('the fee is twice the price', () => { expect(fee(3)).toBe(6); });
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true },
  include: ['src', 'tests'],
});

/**
 * A game project with one chunk, built on a branch off `main`: the branch adds `fee` and its test,
 * and (when `breakBid`) also changes `bid`, which breaks `tests/bid.test.ts`, a file the branch
 * never touched.
 */
async function gameOnBranch(breakBid: boolean): Promise<string> {
  const tree = tempTree('bs-verify-game-');
  const dir = await makeChunkProject(tree, [{ slug: 'deal' }]);
  await write(dir, {
    // With no package.json, vitest keeps its cache in .vite/ at the project root.
    '.gitignore': '.boardsmith/\nnode_modules\n.vite/\n',
    'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table' }),
    'vitest.config.ts': generateVitestConfig(undefined),
    'tsconfig.json': TSCONFIG,
    'src/rules.ts': RULES,
    'tests/bid.test.ts': BID_TEST,
  });
  await fs.symlink(INSTALLED_MODULES, join(dir, 'node_modules'), 'dir');
  initRepo(dir);
  commitAll(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'chunk/deal');
  await write(dir, {
    'src/rules.ts':
      (breakBid ? RULES.replace('offer > high', 'offer >= high') : RULES) +
      'export function fee(price: number): number {\n  return price * 2;\n}\n',
    'tests/fee.test.ts': FEE_TEST,
  });
  commitAll(dir, 'chunk-deal/build');
  return dir;
}

/**
 * `build` and `validate` need a whole game (a UI, a bundle); this fixture is the rules of one. They
 * stand in as passing here, so the refusal below can only come from the checks that really ran:
 * the full suite, the type check and the mutation check. The CLI test further down runs the real
 * `boardsmith verify`, all five checks, as a user would.
 */
const CHECKS = {
  ...VERIFY_CHECKS,
  build: async () => ({ passed: true, summary: 'stood in for by the fixture' }),
  validate: async () => ({ passed: true, summary: 'stood in for by the fixture' }),
};

const check = (result: VerifyResult, name: string) => result.checks.find((c) => c.name === name)!;

const signoff = (project: string) =>
  recordSignoff('deal', { project, by: 'Jane Designer', observed: '1,2', now: new Date('2026-09-29T12:00:00Z') });

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

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.passed).toBe(true);
    expect(check(result, 'test').counts).toEqual({ files: 2, tests: 3, passed: 3, failed: 0, skipped: 0 });
    // `return price * 2`: return undefined, * -> /, 2 -> 3. The fee test catches each one.
    expect(check(result, 'mutation').counts).toEqual({ files: 1, mutants: 3, killed: 3, survived: 0, timedOut: 0, reused: 0 });
    expect(await verifiedProblem(dir)).toBeUndefined();
    await expect(signoff(dir)).resolves.toMatchObject({ basis: 'designer' });
  });

  it('reports each mutant of a changed line no test catches, by file and line', async () => {
    const dir = await gameOnBranch(false);
    await write(dir, { 'tests/fee.test.ts': FEE_TEST.replace('expect(fee(3)).toBe(6)', 'expect(typeof fee).toBe(\'function\')') });
    commitAll(dir, 'chunk-deal/weaker test');

    const { result } = await runVerify({ projectDir: dir, checks: CHECKS, log: () => {} });

    const mutation = check(result, 'mutation');
    expect(mutation.passed).toBe(false);
    expect(mutation.findings).toEqual([
      { file: 'src/rules.ts', line: 5, detail: 'return value replaced with undefined: no test failed' },
      { file: 'src/rules.ts', line: 5, detail: '* -> /: no test failed' },
      { file: 'src/rules.ts', line: 5, detail: '2 -> 3: no test failed' },
    ]);
    expect(mutation.next).toMatch(/test.*fails.*boardsmith verify/s);
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

/** `checks` with a build that writes an uncommitted file into the project while verify runs. */
function dirtiesTheTree<T extends object>(dir: string, checks: T): T {
  return {
    ...checks,
    build: async () => {
      await write(dir, { 'notes.md': 'written while verify ran\n' });
      return { passed: true, summary: 'stood in for by the fixture' };
    },
  };
}

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

/** Every check stood in for as passing, counting how many ran: for the tests about when verify runs at all. */
function countingChecks() {
  const ran: string[] = [];
  const stub = (name: string) => async () => {
    ran.push(name);
    return { passed: true, summary: `${name} stood in for by the fixture` };
  };
  const checks = {
    test: stub('test'),
    typecheck: stub('typecheck'),
    build: stub('build'),
    validate: stub('validate'),
    mutation: stub('mutation'),
  };
  return { ran, checks };
}

describe('boardsmith verify: a result counts only for a commit on a clean tree', () => {
  it('refuses a dirty tree before running any check, and keeps the passing result already on file', async () => {
    const dir = await gameOnBranch(false);
    const { ran, checks } = countingChecks();
    const { result: earlier } = await runVerify({ projectDir: dir, checks, log: () => {} });
    expect(earlier.passed).toBe(true);
    expect(ran).toHaveLength(5);

    await write(dir, { 'notes.md': 'uncommitted\n' });
    await expect(runVerify({ projectDir: dir, checks, log: () => {} })).rejects.toThrow(
      /uncommitted changes.*Commit.*then run `boardsmith verify`/s,
    );
    expect(ran).toHaveLength(5);
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
});

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The smallest whole game `boardsmith build` and `boardsmith validate` both accept: rules with one
 * action, a page, a UI entry, the metadata validate asks for, and a test. `node_modules` is a
 * directory of links, `boardsmith` to this checkout and the tools validate runs through npx to
 * this checkout's install, so nothing is fetched. It is built on a branch that adds `fee`.
 */
async function wholeGameOnBranch(): Promise<string> {
  const dir = join(tempTree('bs-verify-whole-game-'), 'game');
  await write(dir, {
    '.gitignore': 'node_modules\ndist/\n.boardsmith/\n',
    'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0', type: 'module' }),
    'boardsmith.json': JSON.stringify({
      name: 'fixture',
      backend: 'table',
      displayName: 'Fixture',
      description: 'A test fixture',
      audience: 'casual',
      tags: ['card-game'],
      playtime: { min: 1, max: 5 },
      cooperative: false,
    }),
    'tsconfig.json': TSCONFIG,
    'vitest.config.ts': generateVitestConfig(undefined),
    'index.html': '<!DOCTYPE html><html><body><div id="app"></div></body></html>\n',
    'src/rules/game.ts': `import { Game, Action, actionStep } from 'boardsmith';

export class FixtureGame extends Game {
  done = false;
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => { this.done = true; return { success: true }; }));
    this.setFlow({ root: actionStep({ actions: ['pass'] }), isComplete: () => this.done });
  }
}
`,
    'src/rules/index.ts': `import { FixtureGame } from './game.js';
export const gameDefinition = { gameClass: FixtureGame, gameType: 'fixture', displayName: 'Fixture', minPlayers: 1, maxPlayers: 1 };
`,
    'src/ui/uis.ts': 'export {};\n',
    'src/ui/App.vue': '<template><div /></template>\n',
    'tests/rules.test.ts': `import { it, expect } from 'vitest';
import { gameDefinition } from '../src/rules/index.js';
it('seats one player', () => { expect(gameDefinition.maxPlayers).toBe(1); });
`,
  });
  const modules = join(dir, 'node_modules');
  await fs.mkdir(join(modules, '.bin'), { recursive: true });
  await fs.symlink(REPO, join(modules, 'boardsmith'), 'dir');
  for (const name of ['typescript', 'vue-tsc', 'vitest']) {
    await fs.symlink(join(INSTALLED_MODULES, name), join(modules, name), 'dir');
  }
  await fs.symlink('../vue-tsc/bin/vue-tsc.js', join(modules, '.bin', 'vue-tsc'));
  await fs.symlink('../vitest/vitest.mjs', join(modules, '.bin', 'vitest'));
  initRepo(dir);
  commitAll(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'fee');
  await write(dir, {
    'src/rules/fee.ts': 'export function fee(price: number): number {\n  return price * 2;\n}\n',
    'tests/fee.test.ts': FEE_TEST.replace("'../src/rules'", "'../src/rules/fee.js'"),
  });
  commitAll(dir, 'add the fee');
  return dir;
}

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

  it('runs all five real checks, writes the result and exits non-zero when one fails', async () => {
    // The fixture has no UI, so the real build and validate fail; the run still goes on through
    // every check rather than stopping at the first failure.
    const dir = await gameOnBranch(false);
    const run = await spawnCli(['verify', '--project', dir]);
    expect(run.code).toBe(1);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const result = (await readVerifyResult(dir, head)) as VerifyResult;
    expect(result.checks.map((c) => [c.name, c.passed])).toEqual([
      ['test', true],
      ['typecheck', true],
      ['build', false],
      ['validate', false],
      ['mutation', true],
    ]);
    expect(check(result, 'build').next).toBe('Run `boardsmith build` to see why.');
    expect(run.stdout).toContain('build');
    expect(run.stdout).toContain('Run `boardsmith build` to see why.');
  });

  it('passes all five real checks on a whole game, and --check then accepts the commit', async () => {
    const dir = await wholeGameOnBranch();
    const run = await spawnCli(['verify', '--project', dir]);
    const head = git(dir, 'rev-parse', 'HEAD').trim();
    const result = (await readVerifyResult(dir, head)) as VerifyResult;
    expect(result.checks.map((c) => [c.name, c.passed, c.summary])).toEqual([
      ['test', true, '2 tests passed in 2 files.'],
      ['typecheck', true, 'No type errors.'],
      ['build', true, '`boardsmith build` passed.'],
      ['validate', true, '`boardsmith validate` passed.'],
      ['mutation', true, expect.stringMatching(/^Every one of 3 mutants of the lines changed since main/)],
    ]);
    expect(run.code).toBe(0);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect((await spawnCli(['verify', '--check', '--project', dir])).code).toBe(0);
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
    expect(run.stderr).toMatch(/no boardsmith\.json.*--project/s);
    const both = await spawnCli(['verify', '--check', '--base', 'main', '--project', dir]);
    expect(both.code).toBe(1);
    expect(both.stderr).toMatch(/--base does not apply/);
  });
});
