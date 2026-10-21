import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { constants as fsConstants, promises as fs, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INGEST_PRE_COMMIT_HOOK, ingestHookState, installIngestHook } from './ingest-hook.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * The hook is the fourteenth mechanism tried for ingest synthesis and the first that the model
 * does not choose. Thirteen instruction-shaped attempts were all skipped on live runs. See
 * ingest-hook.ts for the full history.
 *
 * These tests pin the properties that make it safe to install unconditionally: no-op before
 * slices exist, idempotent, never fatal, and never clobbering a designer's own hook.
 */

const BOARDSMITH_BIN = fileURLToPath(new URL('../../../bin/boardsmith.js', import.meta.url));

let dir: string;

beforeEach(async () => {
  dir = tempTree('bs-ingest-hook-');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function gitProject(): Promise<string> {
  const p = join(dir, 'proj');
  await fs.mkdir(p, { recursive: true });
  execSync('git init', { cwd: p, stdio: 'ignore' });
  return p;
}

/** What installIngestHook did: `installed`, or the state of the hook it left alone. */
async function installOutcome(p: string): Promise<string> {
  const outcome = await installIngestHook(p);
  return outcome.result === 'skipped' ? outcome.hook.state : outcome.result;
}

describe('installIngestHook', () => {
  it('installs an executable pre-commit hook', async () => {
    const p = await gitProject();
    expect(await installOutcome(p)).toBe('installed');
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    const stat = await fs.stat(hookPath);
    // Must be executable or git silently ignores it — a hook that never runs is worse than
    // none, because it looks like coverage.
    expect(stat.mode & 0o111).toBeGreaterThan(0);
    expect(await fs.readFile(hookPath, 'utf-8')).toContain('BoardSmith ingest synthesis');
  });

  it('never clobbers a hook it did not write', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\necho mine\n', { mode: 0o755 });
    expect(await installOutcome(p)).toBe('foreign');
    expect(await fs.readFile(hookPath, 'utf-8')).toContain('echo mine');
  });

  it('leaves alone a hook it cannot read, rather than taking it for no hook (#1110)', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\necho mine\n');
    await fs.chmod(hookPath, 0o200);
    try {
      expect(await installOutcome(p)).toBe('unreadable');
    } finally {
      await fs.chmod(hookPath, 0o755);
    }
    expect(await fs.readFile(hookPath, 'utf-8')).toBe('#!/bin/sh\necho mine\n');
  });

  it('is idempotent — reinstalling over its own hook is fine', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    expect(await installOutcome(p)).toBe('installed');
  });

  it.skipIf(process.platform === 'win32')('counts its own hook without the execute bit as not current, since git skips it, and reinstalling restores the bit (#1187)', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await installIngestHook(p);
    await fs.chmod(hookPath, 0o644);
    expect((await ingestHookState(p)).state).toBe('not-executable');
    expect(await installOutcome(p)).toBe('installed');
    expect((await fs.stat(hookPath)).mode & 0o111).toBeGreaterThan(0);
    expect((await ingestHookState(p)).state).toBe('current');
  });

  it('installs where core.hooksPath points when git ignores that folder, the only folder git runs hooks from then (#1186, #1301)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath githooks', { cwd: p });
    await fs.writeFile(join(p, '.gitignore'), 'githooks/\n');
    expect(await installOutcome(p)).toBe('installed');
    expect(await fs.readFile(join(p, 'githooks', 'pre-commit'), 'utf-8')).toBe(INGEST_PRE_COMMIT_HOOK);
    expect(await ingestHookState(p)).toMatchObject({ state: 'current', path: join('githooks', 'pre-commit') });
  });

  it('writes nothing into a hooks folder the project tracks, where the generated hook would be committed (#1301)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath .husky', { cwd: p });
    await fs.mkdir(join(p, '.husky'));
    expect(await ingestHookState(p)).toMatchObject({ state: 'in-project', path: join('.husky', 'pre-commit') });
    expect(await installIngestHook(p)).toMatchObject({ result: 'skipped', hook: { state: 'in-project', path: join('.husky', 'pre-commit') } });
    expect(await fs.readdir(join(p, '.husky'))).toEqual([]);
  });

  it('describes the project\'s own hooks, not those of a repository an inherited GIT_DIR names (#1301)', async () => {
    const p = await gitProject();
    const other = join(dir, 'other');
    await fs.mkdir(other);
    execSync('git init', { cwd: other, stdio: 'ignore' });
    vi.stubEnv('GIT_DIR', join(other, '.git'));
    vi.stubEnv('GIT_WORK_TREE', other);

    expect(await installOutcome(p)).toBe('installed');
    expect(await fs.readFile(join(p, '.git', 'hooks', 'pre-commit'), 'utf-8')).toBe(INGEST_PRE_COMMIT_HOOK);
    await expect(fs.access(join(other, '.git', 'hooks', 'pre-commit'))).rejects.toThrow();
  });

  it('ignores every repository-local variable git itself would, such as a core.hooksPath passed down from a `git -c` (#1301)', async () => {
    const p = await gitProject();
    vi.stubEnv('GIT_CONFIG_PARAMETERS', "'core.hookspath'='elsewhere'");

    expect(await ingestHookState(p)).toMatchObject({ state: 'missing', path: join('.git', 'hooks', 'pre-commit') });
  });

  it('says git failed when it cannot tell whether the hooks folder is ignored, rather than calling it tracked (#1301)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath githooks', { cwd: p });
    await fs.writeFile(join(p, '.git', 'index'), 'not an index');

    const hook = await ingestHookState(p);
    expect(hook.state).toBe('git-failed');
    expect(hook.state === 'git-failed' && hook.reason).toMatch(/index/);
  });

  it('names a worktree\'s shared hook relative to the real folder, when the project is reached through a symlink (#1301)', async () => {
    const p = await gitProject();
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -m base', { cwd: p, stdio: 'ignore' });
    const wt = join(dir, 'wt');
    execSync(`git worktree add "${wt}"`, { cwd: p, stdio: 'ignore' });
    const link = join(dir, 'link');
    await fs.symlink(wt, link);

    expect(await ingestHookState(link)).toMatchObject({ state: 'missing', path: join('..', 'proj', '.git', 'hooks', 'pre-commit') });
  });

  it('says git failed, with git\'s own words, rather than that there is no repository (#1301)', async () => {
    const p = join(dir, 'broken');
    await fs.mkdir(p);
    await fs.writeFile(join(p, '.git'), `gitdir: ${join(dir, 'pruned')}\n`);

    const hook = await ingestHookState(p);
    expect(hook.state).toBe('git-failed');
    // Git's own words, without the command that produced them or a closing full stop the message adds its own after.
    expect(hook.state === 'git-failed' && hook.reason).toMatch(/^fatal: not a git repository.*[^.]$/);
    expect(await installOutcome(p)).toBe('git-failed');
  });

  it.skipIf(process.platform === 'win32')('calls an older hook without the execute bit not executable, as git is skipping it, and reinstalling fixes both (#1301)', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\n# BoardSmith ingest synthesis (an older one)\n', { mode: 0o644 });
    expect((await ingestHookState(p)).state).toBe('not-executable');
    expect(await installOutcome(p)).toBe('installed');
    expect((await ingestHookState(p)).state).toBe('current');
  });

  it.skipIf(process.platform === 'win32')('says the execute bit did not stick, rather than that the hook is installed, on a filesystem that drops it (#1301)', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, INGEST_PRE_COMMIT_HOOK, { mode: 0o644 });
    // A filesystem that keeps no mode bits takes the chmod and changes nothing.
    vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);

    expect(await installIngestHook(p)).toMatchObject({ result: 'skipped', hook: { state: 'not-executable', path: join('.git', 'hooks', 'pre-commit') } });
    vi.restoreAllMocks();
  });

  it('sees the main checkout\'s hook from a linked worktree, whose .git is a file (#1186)', async () => {
    const p = await gitProject();
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -m base', { cwd: p, stdio: 'ignore' });
    const wt = join(dir, 'wt');
    execSync(`git worktree add "${wt}"`, { cwd: p, stdio: 'ignore' });
    expect((await ingestHookState(wt)).state).toBe('missing');
    expect(await installOutcome(wt)).toBe('installed');
    expect(await fs.readFile(join(p, '.git', 'hooks', 'pre-commit'), 'utf-8')).toBe(INGEST_PRE_COMMIT_HOOK);
    expect((await ingestHookState(p)).state).toBe('current');
  });

  it('writes nothing into a hooks folder outside the repository, such as a global core.hooksPath (#1186)', async () => {
    const p = await gitProject();
    const shared = join(dir, 'shared-hooks');
    await fs.mkdir(shared);
    const globalConfig = join(dir, 'gitconfig');
    await fs.writeFile(globalConfig, `[core]\n\thooksPath = ${shared}\n`);
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);

    const path = join(realpathSync(shared), 'pre-commit');
    expect(await ingestHookState(p)).toMatchObject({ state: 'outside', path });
    expect(await installIngestHook(p)).toMatchObject({ result: 'skipped', hook: { state: 'outside', path } });
    expect(await fs.readdir(shared)).toEqual([]);
  });

  it('judges a symlinked hooks folder by where it points, and writes nothing outside the project through it (#1321)', async () => {
    const p = await gitProject();
    const shared = join(dir, 'shared-hooks');
    await fs.mkdir(shared);
    await fs.rm(join(p, '.git', 'hooks'), { recursive: true, force: true });
    await fs.symlink(shared, join(p, '.git', 'hooks'));

    expect(await ingestHookState(p)).toMatchObject({ state: 'outside', path: join(realpathSync(shared), 'pre-commit') });
    expect(await installOutcome(p)).toBe('outside');
    expect(await fs.readdir(shared)).toEqual([]);
  });

  it('judges a symlinked hook file by where it points, and writes nothing into a project file through it (#1321)', async () => {
    const p = await gitProject();
    await fs.mkdir(join(p, 'scripts'));
    await fs.writeFile(join(p, 'scripts', 'pre-commit'), INGEST_PRE_COMMIT_HOOK, { mode: 0o644 });
    await fs.symlink(join('..', '..', 'scripts', 'pre-commit'), join(p, '.git', 'hooks', 'pre-commit'));

    expect(await ingestHookState(p)).toMatchObject({ state: 'in-project', path: join('scripts', 'pre-commit') });
    expect(await installOutcome(p)).toBe('in-project');
    expect((await fs.stat(join(p, 'scripts', 'pre-commit'))).mode & 0o111).toBe(0);
  });

  it('follows a hook symlink whose target does not exist yet, and creates nothing outside the project (#1321)', async () => {
    const p = await gitProject();
    const shared = join(dir, 'shared-hooks');
    await fs.mkdir(shared);
    await fs.symlink(join(shared, 'pre-commit'), join(p, '.git', 'hooks', 'pre-commit'));

    expect(await installOutcome(p)).toBe('outside');
    expect(await fs.readdir(shared)).toEqual([]);
  });

  it('follows a dangling hook symlink from its real folder, as the system does, when the hooks folder is itself a symlink (#1321 review)', async () => {
    const p = await gitProject();
    const shared = join(dir, 'shared', 'hooks');
    await fs.mkdir(shared, { recursive: true });
    await fs.rm(join(p, '.git', 'hooks'), { recursive: true, force: true });
    await fs.symlink(shared, join(p, '.git', 'hooks'));
    await fs.symlink(join('..', 'scripts', 'pre-commit'), join(shared, 'pre-commit'));

    expect(await ingestHookState(p)).toMatchObject({ state: 'outside', path: join(realpathSync(dir), 'shared', 'scripts', 'pre-commit') });
    await expect(fs.access(join(p, '.git', 'scripts'))).rejects.toThrow();
  });

  it('reads a hooks folder name with glob characters literally (#1321 review)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath "hooks[ci]"', { cwd: p });
    await fs.mkdir(join(p, 'hooksc'));
    await fs.writeFile(join(p, 'hooksc', 'pre-commit'), '#!/bin/sh\n');
    execSync('git add hooksc/pre-commit', { cwd: p });
    await fs.writeFile(join(p, '.gitignore'), '/hooks?ci?/\n');

    expect(await ingestHookState(p)).toMatchObject({ state: 'missing', path: join('hooks[ci]', 'pre-commit') });
  });

  it('says a committed hook is tracked, even once its folder is ignored, since ignoring cannot untrack it (#1321)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath .githooks', { cwd: p });
    await fs.mkdir(join(p, '.githooks'));
    await fs.writeFile(join(p, '.githooks', 'pre-commit'), '#!/bin/sh\n', { mode: 0o755 });
    execSync('git add .githooks/pre-commit', { cwd: p });
    await fs.writeFile(join(p, '.gitignore'), '.githooks/\n');

    expect(await ingestHookState(p)).toMatchObject({ state: 'tracked', path: join('.githooks', 'pre-commit') });
    expect(await installOutcome(p)).toBe('tracked');
    expect(await fs.readFile(join(p, '.githooks', 'pre-commit'), 'utf-8')).toBe('#!/bin/sh\n');
  });

  it('calls a hook unreadable, not unexecutable, when checking its execute bit fails for another reason (#1321)', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    const access = fs.access.bind(fs);
    vi.spyOn(fs, 'access').mockImplementation(async (file, mode) => {
      if (mode === fsConstants.X_OK) throw Object.assign(new Error('i/o error'), { code: 'EIO' });
      return access(file, mode);
    });

    expect((await ingestHookState(p)).state).toBe('unreadable');
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform === 'win32')('says the hook belongs to another user when it may not set its execute bit (#1321)', async () => {
    const p = await gitProject();
    await fs.writeFile(join(p, '.git', 'hooks', 'pre-commit'), INGEST_PRE_COMMIT_HOOK, { mode: 0o644 });
    vi.spyOn(fs, 'chmod').mockRejectedValue(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));

    expect(await installOutcome(p)).toBe('not-owner');
    vi.restoreAllMocks();
  });

  it('does not throw when there is no git repository', async () => {
    const p = join(dir, 'nogit');
    await fs.mkdir(p, { recursive: true });
    expect(await installOutcome(p)).toBe('no-git');
  });
});

describe('the hook script itself', () => {
  it('exits 0 before any slices exist, so the scaffold commit is unaffected', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    await fs.writeFile(join(p, 'README.md'), '# x\n');
    execSync('git add -A', { cwd: p, stdio: 'ignore' });
    // No rulebook/ at all: the hook must be a silent no-op, not an error.
    expect(() =>
      execSync('git -c user.email=t@t -c user.name=t commit -m scaffold', {
        cwd: p,
        stdio: 'ignore',
      }),
    ).not.toThrow();
  });

  it('exits 0 when INDEX.md exists but no slices do yet', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    await fs.mkdir(join(p, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(p, DESIGN_DIR, 'rulebook', 'INDEX.md'), '# Index\n\n## Open Rules Gaps\n\n_None._\n');
    execSync('git add -A', { cwd: p, stdio: 'ignore' });
    expect(() =>
      execSync('git -c user.email=t@t -c user.name=t commit -m index', { cwd: p, stdio: 'ignore' }),
    ).not.toThrow();
  });

  it('is not fatal when the boardsmith CLI cannot be resolved', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    await fs.mkdir(join(p, DESIGN_DIR, 'rulebook'), { recursive: true });
    await fs.writeFile(join(p, DESIGN_DIR, 'rulebook', 'INDEX.md'), '# Index\n\n## Open Rules Gaps\n\n_None._\n');
    await fs.writeFile(join(p, DESIGN_DIR, 'rulebook', '01-x.md'), 'Named-but-undefined (p.1): thing\n');
    execSync('git add -A', { cwd: p, stdio: 'ignore' });
    // No node_modules and --no-install means npx cannot resolve boardsmith here. The commit must
    // still succeed: a game project must never become uncommittable because of this hook.
    expect(() =>
      execSync('git -c user.email=t@t -c user.name=t commit -m slices', {
        cwd: p,
        stdio: 'ignore',
      }),
    ).not.toThrow();
  });

  it('excludes INDEX.md and the visual survey when detecting slices', () => {
    // Both are in rulebook/ but neither is a transcription slice. Treating INDEX.md as one would
    // make the hook fire on the scaffold commit; treating 00-visual-survey.md as one would fire
    // it on a project whose transcription never ran.
    expect(INGEST_PRE_COMMIT_HOOK).toContain("grep -v 'INDEX.md$'");
    expect(INGEST_PRE_COMMIT_HOOK).toContain("grep -v '00-visual-survey.md$'");
  });

  describe('staging (#851)', () => {
    const git = (p: string, args: string) => execSync(`git -c user.email=t@t -c user.name=t ${args}`, { cwd: p, encoding: 'utf-8' });
    const indexWith = (body: string) =>
      `# Index\n\n## Open Rules Gaps\n\n<!-- boardsmith:gaps:begin -->\n${body}\n<!-- boardsmith:gaps:end -->\n`;

    /** A project whose `npx --no-install boardsmith` is this checkout, with slices already committed. */
    async function projectWithSlices(): Promise<{ p: string; rulebook: string }> {
      const p = await gitProject();
      await installIngestHook(p);
      await fs.writeFile(join(p, 'package.json'), '{"name":"proj","private":true}\n');
      await fs.mkdir(join(p, 'node_modules', '.bin'), { recursive: true });
      await fs.symlink(BOARDSMITH_BIN, join(p, 'node_modules', '.bin', 'boardsmith'));
      await fs.writeFile(join(p, '.gitignore'), 'node_modules\n');
      const rulebook = join(p, DESIGN_DIR, 'rulebook');
      await fs.mkdir(rulebook, { recursive: true });
      await fs.writeFile(join(rulebook, 'INDEX.md'), indexWith('_None._'));
      await fs.writeFile(join(rulebook, '01-setup.md'), 'Setup.\n');
      await fs.writeFile(join(rulebook, '02 combat.md'), 'Combat.\n');
      await fs.writeFile(join(rulebook, '03-scoring.md'), 'Scoring.\n');
      await fs.mkdir(join(p, 'src'));
      git(p, 'add -A');
      git(p, 'commit --no-verify -m base');
      return { p, rulebook };
    }

    const staged = (p: string) => git(p, 'diff --cached --name-only').split('\n').filter(Boolean);
    const unstaged = (p: string) => git(p, 'diff --name-only').split('\n').filter(Boolean);

    it('stages only the files ingest-gaps changed, never a slice it did not touch', async () => {
      const { p, rulebook } = await projectWithSlices();
      // The designer's own unfinished work in a slice ingest-gaps has no reason to rewrite.
      await fs.writeFile(join(rulebook, '03-scoring.md'), 'Scoring.\nWork in progress.\n');
      // A gap marker (rewrites INDEX.md) and a presentation-only Derived line (relabels the slice),
      // in a slice whose name has a space; neither is staged by the designer.
      await fs.writeFile(
        join(rulebook, '02 combat.md'),
        'Combat.\nNamed-but-undefined (p.4): flanking\nDerived (p.4): the heading is set in a serif face\n',
      );
      git(p, 'add -- "' + join(DESIGN_DIR, 'rulebook', '02 combat.md') + '"');
      await fs.writeFile(join(p, 'src', 'game.ts'), 'export {};\n');
      git(p, 'add src/game.ts');

      git(p, 'commit -m src');

      const committed = git(p, 'show --name-only --format= HEAD').split('\n').filter(Boolean);
      expect(committed.sort()).toEqual(
        [`${DESIGN_DIR}/rulebook/02 combat.md`, `${DESIGN_DIR}/rulebook/INDEX.md`, 'src/game.ts'].sort(),
      );
      // The relabel landed in the committed slice, not left dirty beside it.
      expect(git(p, `show "HEAD:${DESIGN_DIR}/rulebook/02 combat.md"`)).toContain('Visual (p.4):');
      expect(unstaged(p)).toEqual([`${DESIGN_DIR}/rulebook/03-scoring.md`]);
      expect(staged(p)).toEqual([]);
    });

    it('stages nothing when ingest-gaps changed nothing', async () => {
      const { p, rulebook } = await projectWithSlices();
      await fs.writeFile(join(rulebook, '03-scoring.md'), 'Scoring.\nWork in progress.\n');
      await fs.writeFile(join(p, 'src', 'game.ts'), 'export {};\n');
      git(p, 'add src/game.ts');

      git(p, 'commit -m src');

      expect(git(p, 'show --name-only --format= HEAD').split('\n').filter(Boolean)).toEqual(['src/game.ts']);
      expect(unstaged(p)).toEqual([`${DESIGN_DIR}/rulebook/03-scoring.md`]);
    });
  });

  it('exits 0 on every path — it fixes, it never blocks a commit', () => {
    // A blocking hook would fight the bs- build protocol, which commits at every step.
    expect(INGEST_PRE_COMMIT_HOOK).not.toMatch(/exit 1/);
  });
});
