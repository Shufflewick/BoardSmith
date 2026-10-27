import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { captureExecutionContext, executionContextChange } from './execution-context.js';
import { commitAll, git, initRepo, writeFiles as write } from './verify-result.test-helper.js';

// Each test builds real git repositories, one `git` process per step. A hang guard, not a budget:
// on a busy machine vitest's 5 s default fails these with nothing wrong (#360).
vi.setConfig({ testTimeout: 60_000 });

const INSTALLED = "the installed packages (npm's install records)";
const LINKED = 'the packages linked from outside the repository';

/** An installed BoardSmith of `version`, as npm lays one out under `node_modules`. */
const installedBoardsmith = (version: string) => ({
  'node_modules/boardsmith/package.json': JSON.stringify({ name: 'boardsmith', version }),
});

/** npm's record of what an install put in `node_modules`, keyed by the packages it names. */
const installRecord = (...packages: string[]) => JSON.stringify({ packages: Object.fromEntries(packages.map((p) => [`node_modules/${p}`, {}])) });

/** A committed game project with a rule and its test, an installed BoardSmith, and npm's record of the install. `node_modules` is out of git, as in a game. */
async function project(name = 'game'): Promise<string> {
  const tree = tempTree('bs-context-');
  const dir = join(tree, name);
  await write(dir, {
    '.gitignore': '.boardsmith/\nnode_modules/\n.worktrees/\n',
    'package-lock.json': '{ "lockfileVersion": 3 }\n',
    'src/rules.ts': 'export const fee = (price: number) => price * 2;\n',
    'tests/rules.test.ts': "it('fee', () => {});\n",
    'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest'),
    ...installedBoardsmith('1.0.0'),
  });
  initRepo(dir);
  commitAll(dir, 'base');
  return dir;
}

/** What `executionContextChange` says of the context of `dir` after `change` is written to `writeTo` (and committed there when `commit` is set). */
async function afterChange(dir: string, writeTo: string, change: Record<string, string>, commit?: string): Promise<string | undefined> {
  const before = await captureExecutionContext(dir);
  await write(writeTo, change);
  if (commit !== undefined) commitAll(writeTo, commit);
  return executionContextChange(dir, before);
}

describe('the execution context: what the tests run with besides the repository (#932)', () => {
  it('names no change when only the repository changed, which a commit shows', async () => {
    const dir = await project();
    expect(await afterChange(dir, dir, { 'src/rules.ts': 'export const fee = 1;\n' }, 'change')).toBeUndefined();
  });

  it('names the install when what is installed changed, which no commit shows', async () => {
    const dir = await project();
    expect(await afterChange(dir, dir, { 'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest', 'left-pad') })).toBe(INSTALLED);
  });

  it('names the BoardSmith the game loads, before and after, when it changed', async () => {
    const dir = await project();
    expect(await afterChange(dir, dir, installedBoardsmith('1.0.1'))).toMatch(
      /^the BoardSmith this command runs and the game loads \(was .*boardsmith@1\.0\.0.*, now .*boardsmith@1\.0\.1.*\)$/,
    );
  });

  describe('a worktree (#477)', () => {
    /**
     * A worktree of `dir`'s repository on a new branch, given the main checkout's packages as
     * `agent-policy thread start` does: its own `node_modules` holding a copy of npm's install
     * record and a link to each of the main checkout's packages.
     */
    async function worktree(dir: string, packages = ['boardsmith']): Promise<string> {
      const path = join(dir, '.worktrees', 'demo');
      git(dir, 'worktree', 'add', '-q', '-b', 'codex/demo', path);
      await fs.mkdir(join(path, 'node_modules'));
      await fs.copyFile(join(dir, 'node_modules', '.package-lock.json'), join(path, 'node_modules', '.package-lock.json'));
      for (const pkg of packages) await fs.symlink(join(dir, 'node_modules', pkg), join(path, 'node_modules', pkg), 'dir');
      return path;
    }

    it("runs with what the main checkout runs with, until its own install differs", async () => {
      const dir = await project();
      const tree = await worktree(dir);
      expect((await captureExecutionContext(tree)).parts).toEqual((await captureExecutionContext(dir)).parts);
      // Its own install, linking the same BoardSmith, with one more package in it.
      expect(await afterChange(tree, tree, { 'node_modules/.package-lock.json': installRecord('boardsmith', 'vitest', 'left-pad') })).toBe(INSTALLED);
    });
  });

  describe('a game in a subfolder of its repository', () => {
    /** A repository holding a game, with the packages installed at its root, as a workspace has them. */
    async function repository(): Promise<{ root: string; dir: string }> {
      const root = join(tempTree('bs-context-'), 'repo');
      await write(root, {
        '.gitignore': '.boardsmith/\nnode_modules/\n',
        'games/bid/src/rules.ts': 'export const o = 1;\n',
        'node_modules/.package-lock.json': installRecord('boardsmith'),
        ...installedBoardsmith('1.0.0'),
      });
      initRepo(root);
      commitAll(root, 'base');
      return { root, dir: join(root, 'games', 'bid') };
    }

    it('names the install above the game, or the BoardSmith it resolves to, when it changed', async () => {
      const install = await repository();
      expect(await afterChange(install.dir, install.root, { 'node_modules/.package-lock.json': installRecord('boardsmith', 'left-pad') })).toBe(INSTALLED);
      const boardsmith = await repository();
      expect(await afterChange(boardsmith.dir, boardsmith.root, installedBoardsmith('2.0.0'))).toMatch(/^the BoardSmith this command runs and the game loads/);
    });
  });

  describe('a package installed as a link to a folder outside the repository counts by its content (#484)', () => {
    /**
     * The game from `project()`, depending on `dep` as `"dep": "file:../dep"` installs it: a link in
     * `node_modules` to a sibling folder, which npm's install record names but whose content it does not.
     */
    async function withSibling(sibling: { git: boolean }, name?: string): Promise<{ dir: string; dep: string }> {
      const dir = await project(name);
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

    /** Why the linked packages could not be read, as the context names it, or undefined when they could. */
    const unreadable = async (dir: string) => /^unreadable: (.*)$/s.exec((await captureExecutionContext(dir)).parts.linked)?.[1];

    it('names no change while the linked folder is unchanged', async () => {
      for (const sibling of [{ git: true }, { git: false }]) {
        const { dir } = await withSibling(sibling);
        const before = await captureExecutionContext(dir);
        expect({ sibling, change: await executionContextChange(dir, before) }).toEqual({ sibling, change: undefined });
      }
    });

    it('names the linked packages when a git checkout behind the link has an edit, a new file, or a new commit', async () => {
      const edit = { 'src/fee.ts': 'export const rate = 3;\n' };
      for (const commit of [undefined, 'dep 2']) {
        const { dir, dep } = await withSibling({ git: true });
        expect(await afterChange(dir, dep, edit, commit)).toBe(LINKED);
      }
      const { dir, dep } = await withSibling({ git: true });
      expect(await afterChange(dir, dep, { 'src/new.ts': 'export const n = 1;\n' })).toBe(LINKED);
    });

    it('names the linked packages when a plain folder behind the link changed, whether or not git would see the file', async () => {
      const changes: Array<Record<string, string>> = [{ 'src/fee.ts': 'export const rate = 3;\n' }, { 'dist/fee.js': 'export const rate = 3;\n' }];
      for (const change of changes) {
        const { dir, dep } = await withSibling({ git: false });
        expect({ change, named: await afterChange(dir, dep, change) }).toEqual({ change, named: LINKED });
      }
    });

    it('names the linked packages when a sibling package changed beside a repository whose folder name is not ASCII (#1053)', async () => {
      const { dir, dep } = await withSibling({ git: false }, 'jeux-vidéo');
      expect(await afterChange(dir, dep, { 'src/fee.ts': 'export const rate = 3;\n' })).toBe(LINKED);
    });

    it("names the linked packages when the linked package's own install, or a package it links to in turn, changed", async () => {
      const install = await withSibling({ git: true });
      await write(install.dep, { 'node_modules/.package-lock.json': installRecord('vue') });
      expect(await afterChange(install.dir, install.dep, { 'node_modules/.package-lock.json': installRecord('vue', 'left-pad') })).toBe(LINKED);

      const nested = await withSibling({ git: true });
      // Ignored, as a package's installs are, so the link is read through, not as an untracked file of the checkout.
      await write(nested.dep, { '.gitignore': 'node_modules/\n' });
      commitAll(nested.dep, 'ignore installs');
      const inner = join(dirname(nested.dep), 'inner');
      await write(inner, { 'index.js': 'export const x = 1;\n' });
      await fs.mkdir(join(nested.dep, 'node_modules', '@scope'), { recursive: true });
      await fs.symlink(inner, join(nested.dep, 'node_modules', '@scope', 'inner'), 'dir');
      expect(await afterChange(nested.dir, inner, { 'index.js': 'export const x = 2;\n' })).toBe(LINKED);
    });

    it('names the linked packages when the link is repointed or its folder disappears', async () => {
      const { dir, dep } = await withSibling({ git: false });
      const first = await captureExecutionContext(dir);
      const other = join(dirname(dep), 'dep-copy');
      await fs.cp(dep, other, { recursive: true });
      await fs.rm(join(dir, 'node_modules', 'dep'));
      await fs.symlink(other, join(dir, 'node_modules', 'dep'), 'dir');
      expect(await executionContextChange(dir, first)).toBe(LINKED);

      const repointed = await captureExecutionContext(dir);
      await fs.rm(other, { recursive: true });
      expect(await executionContextChange(dir, repointed)).toBe(LINKED);
    });

    it("runs a worktree whose node_modules links to the main checkout's link with what the main checkout runs with", async () => {
      const { dir } = await withSibling({ git: true });
      const tree = join(dir, '.worktrees', 'demo');
      git(dir, 'worktree', 'add', '-q', '-b', 'codex/demo', tree);
      await fs.mkdir(join(tree, 'node_modules'));
      await fs.copyFile(join(dir, 'node_modules', '.package-lock.json'), join(tree, 'node_modules', '.package-lock.json'));
      for (const pkg of ['boardsmith', 'dep']) await fs.symlink(join(dir, 'node_modules', pkg), join(tree, 'node_modules', pkg), 'dir');
      expect((await captureExecutionContext(tree)).parts).toEqual((await captureExecutionContext(dir)).parts);
    });

    it('names the linked packages when a git-ignored file that the linked package exports changed', async () => {
      const layouts: Array<{ files: Record<string, string>; change: Record<string, string> }> = [
        {
          files: { 'package.json': JSON.stringify({ name: 'dep', exports: { '.': './dist/index.js' } }), '.gitignore': 'dist/\n', 'dist/index.js': "export * from './chunk.js';\n", 'dist/chunk.js': 'export const rate = 2;\n' },
          change: { 'dist/chunk.js': 'export const rate = 3;\n' },
        },
        {
          files: { 'package.json': JSON.stringify({ name: 'dep', main: './build/main.js' }), '.gitignore': 'build/\n', 'build/main.js': 'export const rate = 2;\n' },
          change: { 'build/main.js': 'export const rate = 3;\n' },
        },
        {
          files: { 'package.json': JSON.stringify({ name: 'dep', exports: { './*': { import: './src/*.js' } } }), '.gitignore': 'src/generated/\n', 'src/generated/x.js': 'export const x = 1;\n' },
          change: { 'src/generated/x.js': 'export const x = 2;\n' },
        },
      ];
      for (const { files, change } of layouts) {
        const { dir, dep } = await withSibling({ git: true });
        await write(dep, files);
        commitAll(dep, 'exports');
        expect({ change, named: await afterChange(dir, dep, change) }).toEqual({ change, named: LINKED });
      }
    });

    it('says why, naming the package, when its exports reach every file in it, ignored ones included', async () => {
      const { dir, dep } = await withSibling({ git: true });
      await write(dep, { 'package.json': JSON.stringify({ name: 'dep', exports: { './*': './*' } }) });
      commitAll(dep, 'export everything');
      expect(await unreadable(dir)).toMatch(/the package in .*dep exports "\.\/\*", which reaches every file in it/);
    });

    it('finds a link in a node_modules above the game folder, as Node does', async () => {
      const dir = await project();
      const dep = join(dirname(dir), 'dep');
      await write(dep, { 'index.js': 'export const rate = 2;\n' });
      await fs.mkdir(join(dirname(dir), 'node_modules'));
      await fs.symlink(dep, join(dirname(dir), 'node_modules', 'dep'), 'dir');
      expect(await afterChange(dir, dep, { 'index.js': 'export const rate = 3;\n' })).toBe(LINKED);
    });

    it("leaves out a link from a sibling back into the repository, whose files are the repository's own", async () => {
      const { dir, dep } = await withSibling({ git: true });
      await write(dep, { '.gitignore': 'node_modules/\n' });
      commitAll(dep, 'ignore installs');
      await fs.mkdir(join(dep, 'node_modules'));
      await fs.symlink(dir, join(dep, 'node_modules', 'game'), 'dir');
      // An untracked file in the game would change the game checkout's revision, were it looked at.
      expect(await afterChange(dir, dir, { 'notes.txt': 'not committed\n' })).toBeUndefined();
    });

    it('stops at two siblings that link to each other, and still sees a change in either', async () => {
      const { dir, dep } = await withSibling({ git: false });
      const other = join(dirname(dep), 'other');
      await write(other, { 'index.js': 'export const o = 1;\n' });
      await fs.mkdir(join(dep, 'node_modules'));
      await fs.mkdir(join(other, 'node_modules'));
      await fs.symlink(other, join(dep, 'node_modules', 'other'), 'dir');
      await fs.symlink(dep, join(other, 'node_modules', 'dep'), 'dir');
      expect(await afterChange(dir, other, { 'index.js': 'export const o = 2;\n' })).toBe(LINKED);
    });

    it('says why, naming the file, when a linked checkout has an untracked link it cannot read', async () => {
      for (const target of ['folder', 'nowhere']) {
        const { dir, dep } = await withSibling({ git: true });
        await fs.mkdir(join(dirname(dep), 'folder'), { recursive: true });
        await fs.symlink(join(dirname(dep), target), join(dep, 'escape'));
        expect({ target, reason: await unreadable(dir) }).toEqual({ target, reason: expect.stringMatching(/could not read untracked escape in .*dep/) });
      }
    });

    it('says why, naming the file, when an ignored entry point of a linked package cannot be read', async () => {
      const { dir, dep } = await withSibling({ git: true });
      await write(dep, { 'package.json': JSON.stringify({ name: 'dep', main: './main.js' }), '.gitignore': 'main.js\n' });
      commitAll(dep, 'ignored entry point');
      await fs.symlink('main.js', join(dep, 'main.js'));
      expect(await unreadable(dir)).toMatch(/Could not read .*dep\/main\.js \(ELOOP\)/);
    });

    it("says why, naming the folder, when a linked package's node_modules cannot be read (#1174)", async () => {
      const { dir, dep } = await withSibling({ git: false });
      // Searchable but not listable: its install record reads as absent, its links cannot be listed.
      await fs.mkdir(join(dep, 'node_modules'), { mode: 0o300 });
      try {
        expect(await unreadable(dir)).toMatch(/Could not read .*dep\/node_modules \(EACCES\)/);
      } finally {
        await fs.chmod(join(dep, 'node_modules'), 0o755);
      }
    });

    it('says why when a linked folder cannot be read', async () => {
      const { dir, dep } = await withSibling({ git: false });
      await fs.chmod(join(dep, 'src'), 0o000);
      try {
        expect(await unreadable(dir)).toMatch(/could not read .*dep/);
      } finally {
        await fs.chmod(join(dep, 'src'), 0o755);
      }
    });
  });
});

/** How the execution context of the game in `dir` names the BoardSmith it runs and loads. */
const boardsmithPart = async (dir: string): Promise<string> => (await captureExecutionContext(dir)).parts.boardsmith;

describe('the BoardSmith a game loads', () => {
  it('is resolved from the game folder upwards, the way Node resolves an import, following a link to a checkout', async () => {
    const tree = tempTree('bs-context-game-');
    const checkout = join(tree, 'boardsmith');
    await write(checkout, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.0-dev' }) });
    const root = join(tree, 'repo');
    await write(root, { ...installedBoardsmith('1.0.0'), 'games/bid/package.json': '{}\n' });
    const dir = join(root, 'games', 'bid');
    expect(await boardsmithPart(dir)).toMatch(new RegExp(`; game loads ${await fs.realpath(join(root, 'node_modules', 'boardsmith'))}$`));

    await fs.mkdir(join(dir, 'node_modules'), { recursive: true });
    await fs.symlink(checkout, join(dir, 'node_modules', 'boardsmith'), 'dir');
    expect(await boardsmithPart(dir)).toMatch(new RegExp(`; game loads ${await fs.realpath(checkout)}$`));
  });

  it('is none for a game with no BoardSmith installed anywhere above it', async () => {
    const tree = tempTree('bs-context-game-');
    const dir = join(tree, 'game');
    await write(dir, { 'package.json': '{}\n' });
    expect(await boardsmithPart(dir)).toMatch(/; game loads no boardsmith$/);
  });

  it('refuses a BoardSmith install whose package.json it cannot read, rather than looking past it', async () => {
    const tree = tempTree('bs-context-game-');
    const dir = join(tree, 'game');
    await fs.mkdir(join(dir, 'node_modules', 'boardsmith', 'package.json'), { recursive: true });
    await expect(boardsmithPart(dir)).rejects.toThrow(/Could not read .*node_modules\/boardsmith\/package\.json \(EISDIR\)/);
  });
});

describe('which BoardSmith runs or is loaded', () => {
  /** A game in `tree` whose `node_modules/boardsmith` links to `root`. */
  async function gameLoading(tree: string, root: string): Promise<string> {
    const dir = join(tree, 'game');
    await fs.mkdir(join(dir, 'node_modules'), { recursive: true });
    await fs.symlink(root, join(dir, 'node_modules', 'boardsmith'), 'dir');
    return dir;
  }

  it('names a checkout by its commit and its uncommitted changes, so an edit to BoardSmith is a new revision', async () => {
    const tree = tempTree('bs-context-tool-');
    const root = join(tree, 'boardsmith');
    await write(root, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '0.0.0-dev' }), 'src/engine.ts': 'export const e = 1;\n' });
    initRepo(root);
    commitAll(root, 'engine');
    const dir = await gameLoading(tree, root);
    const clean = await boardsmithPart(dir);
    expect(clean).toMatch(/ \+ boardsmith@0\.0\.0-dev [0-9a-f]{40} [0-9a-f]{64}; game loads /);
    expect(await boardsmithPart(dir)).toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 2;\n' });
    const edited = await boardsmithPart(dir);
    expect(edited).not.toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 1;\n', 'src/new.ts': 'export const n = 1;\n' });
    const untracked = await boardsmithPart(dir);
    expect(untracked).not.toBe(clean);
    expect(untracked).not.toBe(edited);

    await fs.rm(join(root, 'src/new.ts'));
    expect(await boardsmithPart(dir)).toBe(clean);
    commitAll(root, 'engine 2');
    expect(await boardsmithPart(dir)).not.toBe(clean);
  });

  it('names an installed copy, which has no git of its own, by its version', async () => {
    const tree = tempTree('bs-context-tool-');
    const root = join(tree, 'installed');
    await write(root, { 'package.json': JSON.stringify({ name: 'boardsmith', version: '3.1.4' }) });
    expect(await boardsmithPart(await gameLoading(tree, root))).toMatch(/ \+ boardsmith@3\.1\.4; game loads /);
  });
});
