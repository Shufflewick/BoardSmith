import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { INGEST_PRE_COMMIT_HOOK, installIngestHook } from './ingest-hook.js';

/**
 * The hook is the fourteenth mechanism tried for ingest synthesis and the first that the model
 * does not choose. Thirteen instruction-shaped attempts were all skipped on live runs. See
 * ingest-hook.ts for the full history.
 *
 * These tests pin the properties that make it safe to install unconditionally: no-op before
 * slices exist, idempotent, never fatal, and never clobbering a designer's own hook.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-ingest-hook-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
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
    expect(await installIngestHook(p)).toBe('installed');
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
    expect(await installIngestHook(p)).toBe('skipped-existing');
    expect(await fs.readFile(hookPath, 'utf-8')).toContain('echo mine');
  });

  it('is idempotent — reinstalling over its own hook is fine', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    expect(await installIngestHook(p)).toBe('installed');
  });

  it('does not throw when there is no git repository', async () => {
    const p = join(dir, 'nogit');
    await fs.mkdir(p, { recursive: true });
    expect(await installIngestHook(p)).toBe('skipped-no-git');
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
    await fs.mkdir(join(p, 'rulebook'), { recursive: true });
    await fs.writeFile(join(p, 'rulebook', 'INDEX.md'), '# Index\n\n## Open Rules Gaps\n\n_None._\n');
    execSync('git add -A', { cwd: p, stdio: 'ignore' });
    expect(() =>
      execSync('git -c user.email=t@t -c user.name=t commit -m index', { cwd: p, stdio: 'ignore' }),
    ).not.toThrow();
  });

  it('is not fatal when the boardsmith CLI cannot be resolved', async () => {
    const p = await gitProject();
    await installIngestHook(p);
    await fs.mkdir(join(p, 'rulebook'), { recursive: true });
    await fs.writeFile(join(p, 'rulebook', 'INDEX.md'), '# Index\n\n## Open Rules Gaps\n\n_None._\n');
    await fs.writeFile(join(p, 'rulebook', '01-x.md'), 'Named-but-undefined (p.1): thing\n');
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

  it('stages its corrections so they land in the same commit', () => {
    // Fixing files without staging them would leave the commit wrong and the tree dirty.
    expect(INGEST_PRE_COMMIT_HOOK).toContain('git add rulebook/INDEX.md');
    expect(INGEST_PRE_COMMIT_HOOK).toContain('git add rulebook/*.md');
  });

  it('exits 0 on every path — it fixes, it never blocks a commit', () => {
    // A blocking hook would fight the bs- build protocol, which commits at every step.
    expect(INGEST_PRE_COMMIT_HOOK).not.toMatch(/exit 1/);
  });
});
