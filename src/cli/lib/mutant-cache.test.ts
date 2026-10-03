import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { BOOKKEEPING_RECORDS, MAX_STORED_OUTCOMES, gameBoardsmithRoot, mutantCachePath, openMutantCache, toolRevision } from './mutant-cache.js';
import { commitAll, git, initRepo, writeFiles as write } from './verify-result.test-helper.js';

// Each test builds real git repositories, one `git` process per step. A hang guard, not a budget:
// on a busy machine vitest's 5 s default fails these with nothing wrong (#360).
vi.setConfig({ testTimeout: 60_000 });

const RULES = 'export const fee = (price: number) => price * 2;\n';
const MUTANT = { file: 'src/rules.ts', source: 'export const fee = (price: number) => price / 2;\n' };

/** An installed BoardSmith of `version`, as npm lays one out under `node_modules`. */
const installedBoardsmith = (version: string) => ({
  'node_modules/boardsmith/package.json': JSON.stringify({ name: 'boardsmith', version }),
});

/** npm's record of what an install put in `node_modules`, keyed by the packages it names. */
const installRecord = (...packages: string[]) => JSON.stringify({ packages: Object.fromEntries(packages.map((p) => [`node_modules/${p}`, {}])) });

/**
 * A committed game project with a rule, its test, the design records the bs- skills keep, an
 * installed BoardSmith, and npm's record of the install. `node_modules` is out of git, as in a game.
 */
async function project(): Promise<string> {
  const tree = tempTree('bs-mutant-cache-');
  const dir = join(tree, 'game');
  await write(dir, {
    '.gitignore': '.boardsmith/\nnode_modules/\n',
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
    'src/rules.ts': RULES,
    'src/other.ts': 'export const other = 1;\n',
    'tests/rules.test.ts': "it('fee', () => {});\n",
    'design/SKETCH.md': 'Session Lock: none\n',
    'design/DESIGN.md': 'the look of the game\n',
    'design/chunks/deal/CHUNK.md': 'Status: built\n',
    'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest'),
    ...installedBoardsmith('1.0.0'),
  });
  initRepo(dir);
  commitAll(dir, 'base');
  return dir;
}

/** Records `outcome` for MUTANT, as a verify run of HEAD would, and saves it. */
async function record(dir: string, outcome: 'killed' | 'survived'): Promise<void> {
  const cache = await openMutantCache(dir);
  cache.set(MUTANT, outcome);
  await cache.save();
}

const lookup = async (dir: string) => (await openMutantCache(dir)).get(MUTANT);

/** Records a killed outcome, applies `change` to `writeTo` (committing when `commit` is set), and returns the lookup. */
async function afterChange(dir: string, writeTo: string, change: Record<string, string>, commit: string | undefined): Promise<unknown> {
  await record(dir, 'killed');
  await write(writeTo, change);
  if (commit !== undefined) commitAll(writeTo, commit);
  return { change: Object.keys(change)[0], outcome: await lookup(dir) };
}

describe('the mutant cache: a mutant outcome is reused only when nothing it could depend on changed', () => {
  it('reuses an outcome for the same mutant, code, tests and BoardSmith, and after a bookkeeping-only commit', async () => {
    const dir = await project();
    await record(dir, 'killed');
    expect(await lookup(dir)).toBe('killed');

    await write(dir, {
      'design/SKETCH.md': 'Session Lock: none\n\n1. deal - verified\n',
      'design/chunks/deal/CHUNK.md': 'Status: verified\n\n## Verified Commit Hash\nabc\n',
      'design/DECISIONS.md': '## Decision 1\n',
      'design/RULINGS.md': '## Ruling 1\n',
      'design/QUESTIONS.md': '## Q1\n',
      'design/FILINGS.md': '## F1\n',
      'design/ASSETS.md': '## Ledger\n',
      'design/RUN.md': 'Run Status: running\n',
      'design/MERGE-SIGNOFFS.md': '# Merge sign-offs\n',
      'design/GATE-TRANSITION.md': '# Gate transition\n',
      'design/run-log/deal.md': '### Dispatch 1\nOutcome: closed\n',
    });
    commitAll(dir, 'chunk-deal/step-close');
    expect(await lookup(dir)).toBe('killed');
  });

  it('runs the mutant again when a test, other code, a non-bookkeeping design file, evidence, or the lockfile changed', async () => {
    const changes: Array<Record<string, string>> = [
      { 'tests/rules.test.ts': "it('fee', () => { expect(1).toBe(1); });\n" },
      { 'tests/new.test.ts': "it('new', () => {});\n" },
      { 'src/other.ts': 'export const other = 2;\n' },
      { 'src/rules.ts': `${RULES}export const tax = 1;\n` },
      { 'design/DESIGN.md': 'a test may read this\n' },
      { 'design/chunks/deal/evidence/probe.mjs': 'export {};\n' },
      { 'package-lock.json': '{ "lockfileVersion": 3, "packages": {} }\n' },
    ];
    for (const change of changes) {
      const dir = await project();
      expect(await afterChange(dir, dir, change, 'change')).toEqual({ change: Object.keys(change)[0], outcome: undefined });
    }
  });

  it('runs the mutant again when what is installed changed, which no commit shows', async () => {
    const dir = await project();
    const change = { 'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest', 'left-pad') };
    expect(await afterChange(dir, dir, change, undefined)).toEqual({ change: 'node_modules/.package-lock.json', outcome: undefined });
  });

  it('runs the mutant again under a different BoardSmith, the one the game loads, or when the mutant itself differs', async () => {
    const dir = await project();
    expect(await afterChange(dir, dir, installedBoardsmith('1.0.1'), undefined)).toEqual({
      change: 'node_modules/boardsmith/package.json',
      outcome: undefined,
    });
    await record(dir, 'killed');
    const cache = await openMutantCache(dir);
    expect(cache.get({ ...MUTANT, source: 'export const fee = (price: number) => price * 3;\n' })).toBeUndefined();
    expect(cache.get({ ...MUTANT, file: 'src/other.ts' })).toBeUndefined();
  });

  it('keeps the outcomes of earlier runs it did not look up, so two checkouts verifying in turn do not evict each other', async () => {
    const dir = await project();
    const other = { file: 'src/other.ts', source: 'export const other = 0;\n' };
    const first = await openMutantCache(dir);
    first.set(MUTANT, 'killed');
    await first.save();

    const second = await openMutantCache(dir);
    second.set(other, 'survived');
    await second.save();

    const third = await openMutantCache(dir);
    expect(third.get(MUTANT)).toBe('killed');
    expect(third.get(other)).toBe('survived');
    // A run that tried no mutant (a red suite, or no code changed) learned nothing, so it keeps what is there.
    await (await openMutantCache(dir)).save();
    expect(await lookup(dir)).toBe('killed');
  });

  it(`holds at most ${MAX_STORED_OUTCOMES} outcomes, dropping those of the run no later run has used`, async () => {
    const mutant = (n: number) => ({ file: 'src/other.ts', source: `export const other = ${n};\n` });
    /** Records MUTANT, then the outcomes that fill the cache, then one more run that may look MUTANT up. */
    async function fillThenOneMore(lookUpFirst: boolean): Promise<{ first: unknown; newest: unknown }> {
      const dir = await project();
      await record(dir, 'killed');
      const fill = await openMutantCache(dir);
      for (let n = 0; n < MAX_STORED_OUTCOMES - 1; n++) fill.set(mutant(n), 'killed');
      await fill.save();
      expect(await lookup(dir)).toBe('killed');

      const next = await openMutantCache(dir);
      if (lookUpFirst) next.get(MUTANT);
      next.set(mutant(-1), 'survived');
      await next.save();
      const after = await openMutantCache(dir);
      return { first: after.get(MUTANT), newest: after.get(mutant(-1)) };
    }

    expect(await fillThenOneMore(false)).toEqual({ first: undefined, newest: 'survived' });
    // Looking an outcome up counts as using it, so the run that does keeps it.
    expect(await fillThenOneMore(true)).toEqual({ first: 'killed', newest: 'survived' });
  });

  it('starts empty, without failing, when the file on disk is unreadable', async () => {
    const dir = await project();
    const path = await mutantCachePath(dir);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, 'not json');
    expect(await lookup(dir)).toBeUndefined();
    await record(dir, 'killed');
    expect(await lookup(dir)).toBe('killed');
  });

  describe('every worktree of a repository shares one cache, so a thread merge reuses what its worktree ran (#477)', () => {
    /**
     * A worktree of `dir`'s repository on a new branch, given the main checkout's packages as
     * `agent-policy thread start` does: its own `node_modules` holding a copy of npm's install
     * record and a link to each of the main checkout's packages.
     */
    async function worktree(dir: string): Promise<string> {
      const path = join(dir, '.worktrees', 'demo');
      git(dir, 'worktree', 'add', '-q', '-b', 'codex/demo', path);
      await fs.mkdir(join(path, 'node_modules'));
      await fs.copyFile(join(dir, 'node_modules', '.package-lock.json'), join(path, 'node_modules', '.package-lock.json'));
      await fs.symlink(join(dir, 'node_modules', 'boardsmith'), join(path, 'node_modules', 'boardsmith'), 'dir');
      return path;
    }

    it('keeps the cache in the git common directory, the same file for the main checkout and every worktree', async () => {
      const dir = await project();
      await write(dir, { '.gitignore': '.boardsmith/\nnode_modules/\n.worktrees/\n' });
      commitAll(dir, 'ignore worktrees');
      const tree = await worktree(dir);
      const common = await fs.realpath(join(dir, '.git'));
      expect(await mutantCachePath(dir)).toBe(join(common, 'boardsmith', 'verify', 'mutants.json'));
      expect(await mutantCachePath(tree)).toBe(join(common, 'boardsmith', 'verify', 'mutants.json'));
    });

    it('reuses in the main checkout an outcome its worktree recorded, once main holds the same files', async () => {
      const dir = await project();
      await write(dir, { '.gitignore': '.boardsmith/\nnode_modules/\n.worktrees/\n' });
      commitAll(dir, 'ignore worktrees');
      const tree = await worktree(dir);
      await write(tree, { 'tests/rules.test.ts': "it('fee', () => { expect(1).toBe(1); });\n" });
      commitAll(tree, 'a test that kills the mutant');
      await record(tree, 'killed');

      // Main has not merged the change yet: its tests differ, so nothing it has may reuse the outcome.
      expect(await lookup(dir)).toBeUndefined();
      git(dir, 'merge', '-q', '--no-ff', '-m', 'merge demo', 'codex/demo');
      expect(await lookup(dir)).toBe('killed');
    });

    it('runs the mutant again in a worktree whose own install differs from the main checkout it would otherwise share with', async () => {
      const dir = await project();
      await write(dir, { '.gitignore': '.boardsmith/\nnode_modules/\n.worktrees/\n' });
      commitAll(dir, 'ignore worktrees');
      await record(dir, 'killed');
      const tree = await worktree(dir);
      expect(await lookup(tree)).toBe('killed');

      // Its own install, linking the same BoardSmith, with one more package in it.
      await write(tree, { 'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest', 'left-pad') });
      expect(await lookup(tree)).toBeUndefined();
    });
  });

  describe('a game in a subfolder of its repository depends on the whole repository', () => {
    /** A repository holding two games, with the packages installed at its root, as a workspace has them. */
    async function repository(): Promise<{ root: string; dir: string }> {
      const tree = tempTree('bs-mutant-cache-');
      const root = join(tree, 'repo');
      await write(root, {
        '.gitignore': '.boardsmith/\nnode_modules/\n',
        'package-lock.json': '{ "lockfileVersion": 3 }\n',
        'tsconfig.base.json': '{ "compilerOptions": { "strict": true } }\n',
        'design/SKETCH.md': 'a file outside the game that happens to share a bookkeeping name\n',
        'games/bid/src/rules.ts': RULES,
        'games/bid/tests/rules.test.ts': "it('fee', () => {});\n",
        'games/bid/design/SKETCH.md': 'Session Lock: none\n',
        'games/other/src/rules.ts': 'export const o = 1;\n',
        'node_modules/.package-lock.json': installRecord('boardsmith'),
        ...installedBoardsmith('1.0.0'),
      });
      initRepo(root);
      commitAll(root, 'base');
      return { root, dir: join(root, 'games', 'bid') };
    }

    it('reuses an outcome after a bookkeeping commit inside the game folder', async () => {
      const { root, dir } = await repository();
      const change = { 'games/bid/design/SKETCH.md': 'Session Lock: none\n\n1. deal - verified\n' };
      expect(await afterChange(dir, root, change, 'chunk-deal/step-close')).toEqual({ change: Object.keys(change)[0], outcome: 'killed' });
    });

    it('runs the mutant again when anything outside the game folder changed: a shared config, the root lockfile, a sibling, or a bookkeeping name outside the game', async () => {
      const changes: Array<Record<string, string>> = [
        { 'tsconfig.base.json': '{ "compilerOptions": { "strict": false } }\n' },
        { 'package-lock.json': '{ "lockfileVersion": 3, "packages": {} }\n' },
        { 'games/other/src/rules.ts': 'export const o = 2;\n' },
        { 'design/SKETCH.md': 'changed outside the game\n' },
      ];
      for (const change of changes) {
        const { root, dir } = await repository();
        expect(await afterChange(dir, root, change, 'outside the game')).toEqual({ change: Object.keys(change)[0], outcome: undefined });
      }
    });

    it('never hands one game an outcome another game in the same repository recorded for a file of the same name', async () => {
      const { root, dir } = await repository();
      // With no bookkeeping record in either game, the two games' keys see the same repository.
      await write(root, { 'games/other/src/rules.ts': RULES });
      await fs.rm(join(root, 'games/bid/design/SKETCH.md'));
      commitAll(root, 'the same rules in both games');
      await record(dir, 'killed');
      expect(await lookup(dir)).toBe('killed');
      expect(await lookup(join(root, 'games', 'other'))).toBeUndefined();
    });

    it('runs the mutant again when the install above the game, or the BoardSmith it resolves to, changed', async () => {
      const installs: Array<Record<string, string>> = [
        { 'node_modules/.package-lock.json': installRecord('boardsmith', 'left-pad') },
        installedBoardsmith('2.0.0'),
      ];
      for (const change of installs) {
        const { root, dir } = await repository();
        expect(await afterChange(dir, root, change, undefined)).toEqual({ change: Object.keys(change)[0], outcome: undefined });
      }
    });
  });

  describe('a package installed as a link to a folder outside the repository is in the key by its content (#484)', () => {
    /**
     * The game from `project()`, depending on `dep` as `"dep": "file:../dep"` installs it: a link in
     * `node_modules` to a sibling folder, which npm's install record names but whose content it does not.
     */
    async function withSibling(sibling: { git: boolean }): Promise<{ dir: string; dep: string }> {
      const dir = await project();
      const dep = join(dirname(dir), 'dep');
      await write(dep, { 'package.json': JSON.stringify({ name: 'dep', version: '1.0.0' }), 'src/fee.ts': 'export const rate = 2;\n' });
      if (sibling.git) {
        initRepo(dep);
        commitAll(dep, 'dep');
      }
      await fs.symlink(dep, join(dir, 'node_modules', 'dep'), 'dir');
      await write(dir, { 'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest', 'dep') });
      return { dir, dep };
    }

    it('reuses an outcome while the linked folder is unchanged', async () => {
      for (const sibling of [{ git: true }, { git: false }]) {
        const { dir } = await withSibling(sibling);
        await record(dir, 'killed');
        expect({ sibling, outcome: await lookup(dir) }).toEqual({ sibling, outcome: 'killed' });
      }
    });

    it('runs the mutant again when a git checkout behind the link has an edit, a new file, or a new commit', async () => {
      const edit = { 'src/fee.ts': 'export const rate = 3;\n' };
      for (const commit of [undefined, 'dep 2']) {
        const { dir, dep } = await withSibling({ git: true });
        expect(await afterChange(dir, dep, edit, commit)).toEqual({ change: 'src/fee.ts', outcome: undefined });
      }
      const { dir, dep } = await withSibling({ git: true });
      expect(await afterChange(dir, dep, { 'src/new.ts': 'export const n = 1;\n' }, undefined)).toEqual({ change: 'src/new.ts', outcome: undefined });
    });

    it('runs the mutant again when a plain folder behind the link changed, whether or not git would see the file', async () => {
      const changes: Array<Record<string, string>> = [{ 'src/fee.ts': 'export const rate = 3;\n' }, { 'dist/fee.js': 'export const rate = 3;\n' }];
      for (const change of changes) {
        const { dir, dep } = await withSibling({ git: false });
        expect(await afterChange(dir, dep, change, undefined)).toEqual({ change: Object.keys(change)[0], outcome: undefined });
      }
    });

    it("runs the mutant again when the linked package's own install, or a package it links to in turn, changed", async () => {
      const install = await withSibling({ git: true });
      await write(install.dep, { 'node_modules/.package-lock.json': installRecord('vue') });
      const change = { 'node_modules/.package-lock.json': installRecord('vue', 'left-pad') };
      expect(await afterChange(install.dir, install.dep, change, undefined)).toEqual({ change: 'node_modules/.package-lock.json', outcome: undefined });

      const nested = await withSibling({ git: true });
      const inner = join(dirname(nested.dep), 'inner');
      await write(inner, { 'index.js': 'export const x = 1;\n' });
      await fs.mkdir(join(nested.dep, 'node_modules', '@scope'), { recursive: true });
      await fs.symlink(inner, join(nested.dep, 'node_modules', '@scope', 'inner'), 'dir');
      expect(await afterChange(nested.dir, inner, { 'index.js': 'export const x = 2;\n' }, undefined)).toEqual({ change: 'index.js', outcome: undefined });
    });

    it('runs the mutant again when the link is repointed or its folder disappears', async () => {
      const { dir, dep } = await withSibling({ git: false });
      await record(dir, 'killed');
      const other = join(dirname(dep), 'dep-copy');
      await fs.cp(dep, other, { recursive: true });
      await fs.rm(join(dir, 'node_modules', 'dep'));
      await fs.symlink(other, join(dir, 'node_modules', 'dep'), 'dir');
      expect(await lookup(dir)).toBeUndefined();

      await record(dir, 'killed');
      await fs.rm(other, { recursive: true });
      expect(await lookup(dir)).toBeUndefined();
    });

    it('shares outcomes with a worktree whose node_modules links to the main checkout\'s link', async () => {
      const { dir } = await withSibling({ git: true });
      await write(dir, { '.gitignore': '.boardsmith/\nnode_modules/\n.worktrees/\n' });
      commitAll(dir, 'ignore worktrees');
      const tree = join(dir, '.worktrees', 'demo');
      git(dir, 'worktree', 'add', '-q', '-b', 'codex/demo', tree);
      await fs.mkdir(join(tree, 'node_modules'));
      await fs.copyFile(join(dir, 'node_modules', '.package-lock.json'), join(tree, 'node_modules', '.package-lock.json'));
      for (const pkg of ['boardsmith', 'dep']) await fs.symlink(join(dir, 'node_modules', pkg), join(tree, 'node_modules', pkg), 'dir');
      await record(dir, 'killed');
      expect(await lookup(tree)).toBe('killed');
    });

    it('does not cache at all, and says why, when a linked folder cannot be read', async () => {
      const { dir, dep } = await withSibling({ git: false });
      await record(dir, 'killed');
      await fs.chmod(join(dep, 'src'), 0o000);
      try {
        const cache = await openMutantCache(dir);
        expect(cache.unavailable).toMatch(/could not read .*dep/);
        expect(cache.get(MUTANT)).toBeUndefined();
        cache.set(MUTANT, 'survived');
        await cache.save();
      } finally {
        await fs.chmod(join(dep, 'src'), 0o755);
      }
      expect(await lookup(dir)).toBe('killed');
    });
  });

  it('leaves out exactly the design records the bs- skills write after the code is verified', () => {
    const left = (path: string) => BOOKKEEPING_RECORDS.some((re) => re.test(path));
    expect(left('design/SKETCH.md')).toBe(true);
    expect(left('design/chunks/deal/CHUNK.md')).toBe(true);
    expect(left('design/run-log/deal.md')).toBe(true);
    expect(left('design/DESIGN.md')).toBe(false);
    expect(left('design/BRIEF.md')).toBe(false);
    expect(left('design/rulebook/01-setup.md')).toBe(false);
    expect(left('design/chunks/deal/evidence/probe.mjs')).toBe(false);
    expect(left('design/chunks/deal/notes/CHUNK.md')).toBe(false);
    expect(left('src/SKETCH.md')).toBe(false);
    expect(left('tests/design/SKETCH.md')).toBe(false);
  });
});

describe('gameBoardsmithRoot: the BoardSmith a game loads', () => {
  it('is resolved from the game folder upwards, the way Node resolves an import, following a link to a checkout', async () => {
    const tree = tempTree('bs-mutant-cache-game-');
    const checkout = join(tree, 'boardsmith');
    await write(checkout, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.0-dev' }) });
    const root = join(tree, 'repo');
    await write(root, { ...installedBoardsmith('1.0.0'), 'games/bid/package.json': '{}\n' });
    const dir = join(root, 'games', 'bid');
    expect(await gameBoardsmithRoot(dir)).toBe(await fs.realpath(join(root, 'node_modules', 'boardsmith')));

    await fs.mkdir(join(dir, 'node_modules'), { recursive: true });
    await fs.symlink(checkout, join(dir, 'node_modules', 'boardsmith'), 'dir');
    expect(await gameBoardsmithRoot(dir)).toBe(await fs.realpath(checkout));
  });

  it('is undefined for a game with no BoardSmith installed anywhere above it', async () => {
    const tree = tempTree('bs-mutant-cache-game-');
    const dir = join(tree, 'game');
    await write(dir, { 'package.json': '{}\n' });
    expect(await gameBoardsmithRoot(dir)).toBeUndefined();
  });
});

describe('toolRevision: which BoardSmith produced an outcome', () => {
  it('names a checkout by its commit and its uncommitted changes, so an edit to BoardSmith is a new revision', async () => {
    const tree = tempTree('bs-mutant-cache-tool-');
    const root = join(tree, 'boardsmith');
    await write(root, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.0-dev' }), 'src/engine.ts': 'export const e = 1;\n' });
    initRepo(root);
    commitAll(root, 'engine');
    const clean = await toolRevision(root);
    expect(clean).toMatch(/^boardsmith@0\.0\.0-dev [0-9a-f]{40} [0-9a-f]{64}$/);
    expect(await toolRevision(root)).toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 2;\n' });
    const edited = await toolRevision(root);
    expect(edited).not.toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 1;\n', 'src/new.ts': 'export const n = 1;\n' });
    const untracked = await toolRevision(root);
    expect(untracked).not.toBe(clean);
    expect(untracked).not.toBe(edited);

    await fs.rm(join(root, 'src/new.ts'));
    expect(await toolRevision(root)).toBe(clean);
    commitAll(root, 'engine 2');
    expect(await toolRevision(root)).not.toBe(clean);
  });

  it('names an installed copy, which has no git of its own, by its version', async () => {
    const tree = tempTree('bs-mutant-cache-tool-');
    const root = join(tree, 'installed');
    await write(root, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '3.1.4' }) });
    expect(await toolRevision(root)).toBe('boardsmith@3.1.4');
  });
});
