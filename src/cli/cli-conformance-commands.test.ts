import { DESIGN_DIR } from './lib/project-paths.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tempTree } from '../testing/temp-tree.test-helper.js';
import { REPO_ROOT, spawnCli } from './spawn-cli.test-helper.js';

/**
 * `cli-conformance-commands.test.ts` — the first test in this repo that exercises a command
 * through the REAL CLI entry point (`node bin/boardsmith.js ...`) as a child process, rather than
 * calling the command function in-process.
 *
 * This is deliberate, not incidental: `cli.ts`'s top-level `try { await program.parseAsync() }
 * catch { process.exitCode = 1 }` block (172-04-PLAN.md's context) is only exercised by a real
 * process exit. `program.parse()`/`parseAsync()` does not await action handlers the way an
 * in-process call to `traceCheckCommand()`/`driftCheckCommand()` would, so asserting on
 * `process.exitCode` after an in-process call tests something weaker than the real contract this
 * plan pins: 172-CONTEXT.md decision 6 — findings exit 0, tool failure exits non-zero.
 *
 * Kept to four spawns (plus two before/after byte-hash spawns reusing the same fixtures) per the
 * plan's explicit budget — each spawn costs a couple of seconds, and the fast feedback loop for
 * the underlying check LOGIC lives in `trace-check.test.ts`/`drift-check.test.ts`.
 */

// A spawn can exceed vitest's 5s default under full-suite parallelism. This is a hang guard,
// not a performance budget; spawn-cli.test-helper.ts says why.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let dir: string;

beforeEach(async () => {
  dir = tempTree('bs-cli-conformance-');
});

/** Whole-project content hash: every file's relative path + bytes, in sorted order. */
async function hashProject(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        await walk(full);
      } else {
        files.push(full);
      }
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.slice(root.length));
    hash.update(await fs.readFile(f));
  }
  return hash.digest('hex');
}

/** A fixture project with real findings: a live claim that no test cites (claim-untested). */
async function makeTraceCheckFixtureWithFindings(): Promise<string> {
  const project = join(dir, 'trace-fixture');
  const chunkDir = join(project, DESIGN_DIR, 'chunks', 'limb');
  await fs.mkdir(chunkDir, { recursive: true });
  const text = [
    '# Chunk: limb',
    '',
    'Status: verified',
    '',
    '## Interpretation',
    '',
    '1. **A limb may move once per turn** — cites rulebook/foo.md',
    '',
    '## Build Manifest',
    '',
    '| File | Status |',
    '|---|---|',
    '',
  ].join('\n');
  await fs.writeFile(join(chunkDir, 'CHUNK.md'), text);
  return project;
}

/** A real git repo whose `limb` chunk's manifest file changed after its recorded verified hash. */
async function makeDriftCheckFixtureWithDrift(): Promise<string> {
  const repoDir = join(dir, 'drift-fixture');
  await fs.mkdir(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir, stdio: 'ignore' });

  await fs.writeFile(join(repoDir, 'src-foo.ts'), 'export const v = 1;\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m first', { cwd: repoDir, stdio: 'ignore' });
  const firstSha = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

  // Drift: src-foo.ts changes after the hash the chunk will record.
  await fs.writeFile(join(repoDir, 'src-foo.ts'), 'export const v = 2;\n');
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m second', { cwd: repoDir, stdio: 'ignore' });

  const chunkDir = join(repoDir, DESIGN_DIR, 'chunks', 'limb');
  await fs.mkdir(chunkDir, { recursive: true });
  const text = [
    '# Chunk: limb',
    '',
    'Status: verified',
    '',
    '## Build Manifest',
    '',
    '| File | Status |',
    '|---|---|',
    '| src-foo.ts | NEW |',
    '',
    '## Verified Commit Hash',
    '',
    firstSha,
    '',
  ].join('\n');
  await fs.writeFile(join(chunkDir, 'CHUNK.md'), text);
  execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
  execSync('git -c user.email=t@t -c user.name=t commit -m chunk', { cwd: repoDir, stdio: 'ignore' });

  return repoDir;
}

describe('trace-check — real CLI entry point', () => {
  it('exits 0 against a project with findings, and reports them as JSON', async () => {
    const project = await makeTraceCheckFixtureWithFindings();
    const before = await hashProject(project);

    const result = await spawnCli(['trace-check', '--project', project, '--json']);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.findings.some((f: { kind: string }) => f.kind === 'claim-untested')).toBe(true);

    const after = await hashProject(project);
    expect(after).toBe(before);
  });

  it('exits 1 with a single clean actionable line against a directory that is not a bs- project', async () => {
    const notBsProject = join(dir, 'not-a-bs-project');
    await fs.mkdir(notBsProject, { recursive: true });

    const result = await spawnCli(['trace-check', '--project', notBsProject, '--json']);

    expect(result.code).toBe(1);
    const stderrLines = result.stderr.trim().split('\n').filter(Boolean);
    expect(stderrLines.length).toBeGreaterThan(0);
    expect(result.stderr).toContain(notBsProject);
    expect(result.stderr).toContain('--project');
    expect(result.stderr).not.toMatch(/\bat .*\(/);
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
    expect(result.stderr).not.toContain(join(REPO_ROOT, 'src'));
  });
});

describe('drift-check — real CLI entry point', () => {
  it('exits 0 against a git project with drift, and reports chunk-code-drifted as JSON', async () => {
    const repoDir = await makeDriftCheckFixtureWithDrift();
    const before = await hashProject(repoDir);

    const result = await spawnCli(['drift-check', '--project', repoDir, '--json']);

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.findings.some((f: { kind: string }) => f.kind === 'chunk-code-drifted')).toBe(true);

    const after = await hashProject(repoDir);
    expect(after).toBe(before);
  });

  it('exits 1 with a single clean actionable line against a directory that is not a git repo', async () => {
    const notGitProject = join(dir, 'not-a-git-repo');
    await fs.mkdir(join(notGitProject, DESIGN_DIR, 'chunks'), { recursive: true });

    const result = await spawnCli(['drift-check', '--project', notGitProject, '--json']);

    expect(result.code).toBe(1);
    const stderrLines = result.stderr.trim().split('\n').filter(Boolean);
    expect(stderrLines.length).toBeGreaterThan(0);
    expect(result.stderr).toContain(notGitProject);
    expect(result.stderr).toContain('--project');
    expect(result.stderr).not.toMatch(/\bat .*\(/);
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
    expect(result.stderr).not.toContain(join(REPO_ROOT, 'src'));
  });
});
