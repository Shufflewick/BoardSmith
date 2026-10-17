/**
 * scripts/ingest-harness/run.test.mjs
 *
 * The harness driver must never delete or commit outside its own throwaway tree (#917). Each run
 * happens in a fixture sandbox, so even a regressed driver can write only inside the test's temp tree.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSandbox } from '../../src/testing/fixture-sandbox.test-helper.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');
const CONFORMING = path.join(HERE, '__fixtures__', 'conforming');
const CONFORMING_SOURCE_HASH = '94b836814e8d4849fdff5f5e782a78a7c0a5b8f008808384096cb95359106a89';

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

  it('recreates an existing --work-dir that an earlier stage made', () => {
    const sandbox = fixtureSandbox('bs-harness-restage-');
    const workDir = path.join(sandbox.root, 'run');
    mkdirSync(workDir);
    writeFileSync(path.join(workDir, '.harness-stage-state.json'), '{}');
    writeFileSync(path.join(workDir, 'old.txt'), 'from the last run');

    const res = runHarness(sandbox, ['stage', '--work-dir', workDir, '--source', path.join(sandbox.root, 'missing.pdf')]);

    expect(existsSync(path.join(workDir, 'old.txt'))).toBe(false);
    expect(res.stdout).toContain(`[stage] created throwaway dir: ${workDir}`);
  });

  it('re-stages a --work-dir whose earlier stage failed partway, and drive says that stage did not finish', () => {
    const sandbox = fixtureSandbox('bs-harness-failed-');
    const workDir = path.join(sandbox.root, 'run');
    const args = ['stage', '--work-dir', workDir, '--source', path.join(sandbox.root, 'missing.pdf')];

    const first = runHarness(sandbox, args);
    expect(first.status).toBe(1);
    const drive = runHarness(sandbox, ['drive', '--work-dir', workDir]);
    expect(drive.status).toBe(1);
    expect(drive.stderr).toContain('did not finish');

    const second = runHarness(sandbox, args);
    expect(second.stderr).not.toContain('did not stage it');
    expect(second.stdout).toContain(`[stage] created throwaway dir: ${workDir}`);
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
      JSON.stringify({ sourceFileName: 'rules.pdf', expectHash: 'x', refHead: 'x', stagedAt: 'x' }),
    );

    const res = runHarness(sandbox, ['assert', '--work-dir', workDir, '--reference-repo', reference]);

    const outerCommits = spawnSync('git', ['-C', outer, 'rev-list', '--all'], { env: sandbox.env, encoding: 'utf8' });
    expect(outerCommits.stdout.trim()).toBe('');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('has no .git of its own');
  });
});

// A staged run whose project passes every produced-artifact check, so only the drive outcome decides the verdict.
function assertAfterDrive(drive) {
  const sandbox = fixtureSandbox('bs-harness-verdict-', { tools: ['git'] });
  const workDir = path.join(sandbox.root, 'run');
  const project = path.join(workDir, 'seven');
  const reference = path.join(sandbox.root, 'reference');
  cpSync(CONFORMING, project, { recursive: true });
  git(sandbox, ['init', '-q', project]);
  git(sandbox, ['init', '-q', reference]);
  git(sandbox, ['-C', reference, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'ref']);
  const refHead = git(sandbox, ['-C', reference, 'rev-parse', 'HEAD']).trim();
  writeFileSync(
    path.join(workDir, '.harness-stage-state.json'),
    JSON.stringify({ sourceFileName: 'rules.pdf', expectHash: CONFORMING_SOURCE_HASH, refHead, stagedAt: 'x', ...drive }),
  );
  return runHarness(sandbox, ['assert', '--work-dir', workDir, '--reference-repo', reference]);
}

describe('ingest harness overall verdict (#918)', () => {
  it('passes when every check passes and the session completed', () => {
    const res = assertAfterDrive({ turnsTaken: 6, maxTurns: 12, stoppedReason: 'completed', hitTurnCap: false });
    expect(res.stdout, res.stderr).toContain('OVERALL: PASS');
    expect(res.status).toBe(0);
  });

  it('fails when the session hit the turn cap, even with every check passing', () => {
    const res = assertAfterDrive({ turnsTaken: 12, maxTurns: 12, stoppedReason: 'turn-cap', hitTurnCap: true });
    expect(res.stdout, res.stderr).toContain('SUMMARY: 11/11 checks passing.');
    expect(res.stdout).toContain('OVERALL: FAIL');
    expect(res.status).toBe(1);
  });

  it('fails when the session exited non-zero, even with every check passing', () => {
    const res = assertAfterDrive({ turnsTaken: 3, maxTurns: 12, stoppedReason: 'nonzero-exit', hitTurnCap: false });
    expect(res.stdout, res.stderr).toContain('SUMMARY: 11/11 checks passing.');
    expect(res.stdout).toContain('OVERALL: FAIL');
    expect(res.status).toBe(1);
  });
});
