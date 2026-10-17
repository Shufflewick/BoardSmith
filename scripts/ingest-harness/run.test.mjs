/**
 * scripts/ingest-harness/run.test.mjs
 *
 * The harness driver must never delete or commit outside its own throwaway tree (#917). Each run
 * happens in a fixture sandbox, so even a regressed driver can write only inside the test's temp tree.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSandbox } from '../../src/testing/fixture-sandbox.test-helper.ts';

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.mjs');

function runHarness(sandbox, args) {
  // The driver shells out to git and node; any node it starts inherits the same write limit.
  const env = { ...sandbox.env, NODE_OPTIONS: `${sandbox.env.NODE_OPTIONS} --allow-child-process` };
  return spawnSync(process.execPath, [RUN, ...args], { cwd: sandbox.root, env, encoding: 'utf8' });
}

function git(sandbox, args) {
  return execFileSync('git', args, { env: sandbox.env, encoding: 'utf8' });
}

describe('ingest harness work dir', () => {
  it('refuses an existing --work-dir it did not stage, and leaves it untouched', () => {
    const sandbox = fixtureSandbox('bs-harness-refuse-');
    const victim = path.join(sandbox.root, 'victim');
    mkdirSync(victim);
    writeFileSync(path.join(victim, 'keep.txt'), 'mine');

    const res = runHarness(sandbox, ['stage', '--work-dir', victim]);

    expect(existsSync(path.join(victim, 'keep.txt'))).toBe(true);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('.harness-stage-state.json');
  });

  it('stages into a fresh folder under the temp directory when no --work-dir is given', () => {
    const sandbox = fixtureSandbox('bs-harness-default-');

    const res = runHarness(sandbox, ['stage', '--source', path.join(sandbox.root, 'missing.pdf')]);

    const created = /\[stage\] created throwaway dir: (\S+)/.exec(res.stdout)?.[1];
    expect(created, res.stdout + res.stderr).toBeDefined();
    expect(path.dirname(created)).toBe(sandbox.env.TMPDIR);
    expect(path.basename(created)).toMatch(/^bs-ingest-harness-/);
  });

  it('refuses drive and assert without --work-dir, since the default folder is new each stage', () => {
    const sandbox = fixtureSandbox('bs-harness-nodir-');
    for (const sub of ['drive', 'assert']) {
      const res = runHarness(sandbox, [sub]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('--work-dir');
    }
  });

  it('refuses to commit when the project has no .git of its own', () => {
    const sandbox = fixtureSandbox('bs-harness-git-', { tools: ['git'] });
    const outer = path.join(sandbox.root, 'outer');
    const workDir = path.join(outer, 'run');
    const reference = path.join(sandbox.root, 'reference');
    mkdirSync(path.join(workDir, 'seven', 'rulebook'), { recursive: true });
    mkdirSync(reference);
    git(sandbox, ['init', '-q', outer]);
    git(sandbox, ['init', '-q', reference]);
    writeFileSync(
      path.join(workDir, '.harness-stage-state.json'),
      JSON.stringify({ sourceFileName: 'rules.pdf', expectHash: 'x', refHead: 'x' }),
    );

    const res = runHarness(sandbox, ['assert', '--work-dir', workDir, '--reference-repo', reference]);

    const outerCommits = spawnSync('git', ['-C', outer, 'rev-list', '--all'], { env: sandbox.env, encoding: 'utf8' });
    expect(outerCommits.stdout.trim()).toBe('');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('has no .git of its own');
  });
});
