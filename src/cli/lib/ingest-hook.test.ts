import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
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

describe('installIngestHook', () => {
  it('installs an executable pre-commit hook', async () => {
    const p = await gitProject();
    expect((await installIngestHook(p)).result).toBe('installed');
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
    expect((await installIngestHook(p)).result).toBe('skipped-existing');
    expect(await fs.readFile(hookPath, 'utf-8')).toContain('echo mine');
  });

  it('leaves alone a hook it cannot read, rather than taking it for no hook (#1110)', async () => {
    const p = await gitProject();
    const hookPath = join(p, '.git', 'hooks', 'pre-commit');
    await fs.writeFile(hookPath, '#!/bin/sh\necho mine\n');
    await fs.chmod(hookPath, 0o200);
    try {
      expect((await installIngestHook(p)).result).toBe('skipped-unreadable');
    } finally {
      await fs.chmod(hookPath, 0o755);
    }
    expect(await fs.readFile(hookPath, 'utf-8')).toBe('#!/bin/sh\necho mine\n');
  });

  it('is idempotent — reinstalling over its own hook is fine', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    expect((await installIngestHook(p)).result).toBe('installed');
  });

  it('installs where core.hooksPath points, the only folder git runs hooks from then (#1186)', async () => {
    const p = await gitProject();
    execSync('git config core.hooksPath githooks', { cwd: p });
    expect((await installIngestHook(p)).result).toBe('installed');
    expect(await fs.readFile(join(p, 'githooks', 'pre-commit'), 'utf-8')).toBe(INGEST_PRE_COMMIT_HOOK);
    expect(await ingestHookState(p)).toEqual({ state: 'current', path: join('githooks', 'pre-commit') });
  });

  it('sees the main checkout\'s hook from a linked worktree, whose .git is a file (#1186)', async () => {
    const p = await gitProject();
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -m base', { cwd: p, stdio: 'ignore' });
    const wt = join(dir, 'wt');
    execSync(`git worktree add "${wt}"`, { cwd: p, stdio: 'ignore' });
    expect((await ingestHookState(wt)).state).toBe('missing');
    expect((await installIngestHook(wt)).result).toBe('installed');
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

    expect(await ingestHookState(p)).toEqual({ state: 'outside', path: join(shared, 'pre-commit') });
    expect(await installIngestHook(p)).toEqual({ result: 'skipped-outside', path: join(shared, 'pre-commit') });
    expect(await fs.readdir(shared)).toEqual([]);
  });

  it('does not throw when there is no git repository', async () => {
    const p = join(dir, 'nogit');
    await fs.mkdir(p, { recursive: true });
    expect((await installIngestHook(p)).result).toBe('skipped-no-git');
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
