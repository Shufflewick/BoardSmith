/**
 * `bash scripts/merge-branch.sh <branch> "<summary>"` is the one way a branch
 * reaches `main` (#312), and it refuses a branch whose merged tree fails
 * `boardsmith test`.
 *
 * In this repository `boardsmith test` type-checks the whole package before it
 * runs a test (src/cli/commands/typecheck.test.ts proves that), so a type error
 * anywhere stops the merge. This file proves the refusal against a throwaway
 * repository whose `bin/boardsmith.js test` passes or fails on demand, so it
 * holds without compiling BoardSmith.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../src/testing/temp-tree.test-helper.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(PROJECT_ROOT, 'scripts/merge-branch.sh');

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Merge Test',
  GIT_AUTHOR_EMAIL: 'merge-test@example.invalid',
  GIT_COMMITTER_NAME: 'Merge Test',
  GIT_COMMITTER_EMAIL: 'merge-test@example.invalid',
};

function run(cwd, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_IDENTITY, ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function git(cwd, ...args) {
  const result = run(cwd, 'git', args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.output}`);
  return result.output.trim();
}

/**
 * A repository on `main` whose `boardsmith test` fails while a file named
 * `broken` exists, with a branch `good` that passes and a branch `bad` that
 * fails, and two more passing branches `alpha` and `beta` that each add their
 * own file.
 *
 * The stub `boardsmith test` also answers to two variables, which is how the
 * lock tests below watch what a run validated:
 * - `MERGE_TEST_LOG`: appends the `.txt` files in the tree it is testing.
 * - `MERGE_TEST_SLEEP`: sleeps that many seconds before passing or failing.
 */
function fixtureRepo() {
  const repo = tempTree('bs-merge-branch-');
  git(repo, 'init', '--quiet', '--initial-branch=main');
  mkdirSync(path.join(repo, 'scripts'));
  copyFileSync(SCRIPT, path.join(repo, 'scripts/merge-branch.sh'));
  mkdirSync(path.join(repo, 'bin'));
  writeFileSync(
    path.join(repo, 'bin/boardsmith.js'),
    "import { appendFileSync, existsSync, readdirSync } from 'node:fs';\n" +
      "if (process.argv[2] !== 'test') { console.error('expected boardsmith test'); process.exit(2); }\n" +
      'const { MERGE_TEST_LOG, MERGE_TEST_SLEEP } = process.env;\n' +
      "if (MERGE_TEST_LOG) appendFileSync(MERGE_TEST_LOG, readdirSync('.').filter((f) => f.endsWith('.txt')).sort().join(',') + '\\n');\n" +
      'if (MERGE_TEST_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(MERGE_TEST_SLEEP) * 1000);\n' +
      "if (existsSync('broken')) { console.error('planted failure'); process.exit(1); }\n",
  );
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'initial');

  git(repo, 'checkout', '--quiet', '-b', 'good');
  writeFileSync(path.join(repo, 'feature.txt'), 'works\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'good change');

  git(repo, 'checkout', '--quiet', '-b', 'bad', 'main');
  writeFileSync(path.join(repo, 'broken'), '\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'bad change');

  for (const name of ['alpha', 'beta']) {
    git(repo, 'checkout', '--quiet', '-b', name, 'main');
    writeFileSync(path.join(repo, `${name}.txt`), `${name}\n`);
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', `${name} change`);
  }

  git(repo, 'checkout', '--quiet', 'main');
  return repo;
}

function merge(repo, ...args) {
  return run(repo, 'bash', ['scripts/merge-branch.sh', ...args]);
}

describe('scripts/merge-branch.sh (#312)', () => {
  it('merges a branch whose merged tree passes boardsmith test, with a merge commit that names it', () => {
    const repo = fixtureRepo();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = merge(repo, 'good', 'adds the feature (#1)');

    expect(result.status, result.output).toBe(0);
    expect(git(repo, 'rev-parse', 'HEAD^1')).toBe(before);
    expect(git(repo, 'rev-parse', 'HEAD^2')).toBe(git(repo, 'rev-parse', 'good'));
    expect(git(repo, 'log', '-1', '--format=%s')).toBe("Merge branch 'good': adds the feature (#1)");
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('refuses a branch whose merged tree fails boardsmith test, and leaves main exactly as it was', () => {
    const repo = fixtureRepo();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = merge(repo, 'bad', 'breaks the build');

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('planted failure');
    expect(result.output).toContain("Refused to merge 'bad'");
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('refuses to run anywhere but a clean main', () => {
    const repo = fixtureRepo();

    git(repo, 'checkout', '--quiet', 'good');
    const offMain = merge(repo, 'bad', 'summary');
    expect(offMain.status).not.toBe(0);
    expect(offMain.output).toContain('Check out main');

    git(repo, 'checkout', '--quiet', 'main');
    writeFileSync(path.join(repo, 'stray.txt'), 'uncommitted\n');
    const dirty = merge(repo, 'good', 'summary');
    expect(dirty.status).not.toBe(0);
    expect(dirty.output).toContain('uncommitted changes');
  }, 30_000);

  it('refuses a missing summary, an unknown branch, and a branch already on main', () => {
    const repo = fixtureRepo();

    const noSummary = merge(repo, 'good');
    expect(noSummary.status).not.toBe(0);
    expect(noSummary.output).toContain('Usage: bash scripts/merge-branch.sh');

    const unknown = merge(repo, 'no-such-branch', 'summary');
    expect(unknown.status).not.toBe(0);
    expect(unknown.output).toContain("No branch named 'no-such-branch'");

    expect(merge(repo, 'good', 'first').status).toBe(0);
    const again = merge(repo, 'good', 'second');
    expect(again.status).not.toBe(0);
    expect(again.output).toContain('already on main');
  }, 30_000);
});

/**
 * Merges are serialised (#333). merge-branch.sh merges in the shared main
 * checkout and tests the merged tree there, so a second merge that started
 * while the first was testing would either find main dirty mid-merge or test a
 * tree that is neither branch's merge result. Both happened on 2026-09-24.
 *
 * What these tests read is what each run's `boardsmith test` actually saw
 * (the stub's MERGE_TEST_LOG), not whether a lock file appears.
 */
describe('scripts/merge-branch.sh serialises merges (#333)', () => {
  /** Every process a test started that could outlive it. */
  const started = [];

  afterEach(() => {
    for (const pid of started.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone, which is the usual case.
      }
    }
  });

  function lockEnv({ wait = 60, poll = 1, log, sleep } = {}) {
    const env = {
      BOARDSMITH_MERGE_LOCK_WAIT_SECONDS: String(wait),
      BOARDSMITH_MERGE_LOCK_POLL_SECONDS: String(poll),
    };
    if (log !== undefined) env.MERGE_TEST_LOG = log;
    if (sleep !== undefined) env.MERGE_TEST_SLEEP = String(sleep);
    return env;
  }

  /** Starts a merge in its own process group and resolves when it exits. */
  function startMerge(repo, branch, summary, options) {
    const child = spawn('bash', ['scripts/merge-branch.sh', branch, summary], {
      cwd: repo,
      detached: true,
      env: { ...process.env, ...GIT_IDENTITY, ...lockEnv(options) },
    });
    started.push(-child.pid);
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const done = new Promise((resolve) => {
      child.on('exit', (status, signal) => resolve({ status, signal, output }));
    });
    return { child, done };
  }

  function mergeWith(repo, branch, summary, options) {
    return run(repo, 'bash', ['scripts/merge-branch.sh', branch, summary], lockEnv(options));
  }

  /** The `.txt` files each `boardsmith test` of one run saw, one entry per call. */
  function testedTrees(log) {
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  }

  async function untilTesting(log) {
    for (let i = 0; i < 200; i += 1) {
      if (testedTrees(log).length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`the merge logging to ${log} never reached boardsmith test`);
  }

  const lockPath = (repo) => path.join(realpathSync(repo), '.git', 'merge-branch.lock');
  const mainSubjects = (repo) => git(repo, 'log', '--first-parent', '--format=%s', 'main').split('\n');

  it('makes a second merge wait for the first, then test and land its OWN merged result', async () => {
    const repo = fixtureRepo();
    const alphaLog = path.join(repo, '.git', 'alpha.log');
    const betaLog = path.join(repo, '.git', 'beta.log');

    const first = startMerge(repo, 'alpha', 'adds alpha (#1)', { log: alphaLog, sleep: 3 });
    await untilTesting(alphaLog);
    const second = startMerge(repo, 'beta', 'adds beta (#2)', { log: betaLog });

    const alpha = await first.done;
    const beta = await second.done;
    expect(alpha.status, alpha.output).toBe(0);
    expect(beta.status, beta.output).toBe(0);

    // Both landed, in lock order.
    expect(mainSubjects(repo)).toEqual([
      "Merge branch 'beta': adds beta (#2)",
      "Merge branch 'alpha': adds alpha (#1)",
      'initial',
    ]);
    // Each run tested its own merge result: alpha's tree cannot hold beta's
    // file, and beta's must hold alpha's, because beta merged after alpha landed.
    expect(testedTrees(alphaLog)).toEqual(['alpha.txt']);
    expect(testedTrees(betaLog)).toEqual(['alpha.txt,beta.txt']);

    // The second run said it was waiting, and for which branch.
    expect(beta.output).toContain('Waiting for the merge lock');
    expect(beta.output).toContain('alpha');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 60_000);

  it('refuses when it will not wait, naming the branch that holds the lock, and touches nothing', async () => {
    const repo = fixtureRepo();
    const alphaLog = path.join(repo, '.git', 'alpha.log');
    const betaLog = path.join(repo, '.git', 'beta.log');

    const first = startMerge(repo, 'alpha', 'adds alpha', { log: alphaLog, sleep: 3 });
    await untilTesting(alphaLog);

    const refused = mergeWith(repo, 'beta', 'adds beta', { wait: 0, log: betaLog });
    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain("Another merge holds the merge lock: 'alpha'");
    expect(refused.output).toContain('run this merge again');
    expect(testedTrees(betaLog)).toEqual([]);

    const alpha = await first.done;
    expect(alpha.status, alpha.output).toBe(0);
    expect(mainSubjects(repo)[0]).toBe("Merge branch 'alpha': adds alpha");
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 60_000);

  it('reports a lock whose recorded holder is dead, with the command that finds what still holds it', () => {
    const repo = fixtureRepo();
    const dead = spawnSync('true').pid;
    // Something holds the lock, but the merge that recorded itself as holder is
    // gone: the shape an orphaned child that inherited the lock leaves behind.
    writeFileSync(`${lockPath(repo)}.holder`, `branch: ghost\npid: ${dead}\nsince: earlier\n`);
    const holder = spawn(
      'perl',
      ['-e', '$| = 1; open(my $f, ">>", $ARGV[0]) or die; flock($f, 2) or die; print "locked\\n"; sleep 60', lockPath(repo)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    started.push(holder.pid);
    return new Promise((resolve) => holder.stdout.once('data', resolve)).then(() => {
      const before = git(repo, 'rev-parse', 'HEAD');
      const result = mergeWith(repo, 'good', 'summary', { wait: 0 });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(`'ghost' (pid ${dead})`);
      expect(result.output).toContain(`pid ${dead} is no longer running`);
      expect(result.output).toContain(`lsof ${lockPath(repo)}`);
      expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
      expect(git(repo, 'status', '--porcelain')).toBe('');
    });
  }, 30_000);

  it('aborts its merge and releases the lock when interrupted', async () => {
    const repo = fixtureRepo();
    const alphaLog = path.join(repo, '.git', 'alpha.log');
    const before = git(repo, 'rev-parse', 'HEAD');

    const first = startMerge(repo, 'alpha', 'adds alpha', { log: alphaLog, sleep: 30 });
    await untilTesting(alphaLog);
    process.kill(-first.child.pid, 'SIGINT');
    const alpha = await first.done;
    expect(alpha.status).not.toBe(0);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    const next = mergeWith(repo, 'beta', 'adds beta', { wait: 0 });
    expect(next.status, next.output).toBe(0);
  }, 60_000);

  it('releases the lock when killed outright, even while its test run lives on, and the next merge names the half-done merge it left', async () => {
    const repo = fixtureRepo();
    const alphaLog = path.join(repo, '.git', 'alpha.log');

    const first = startMerge(repo, 'alpha', 'adds alpha', { log: alphaLog, sleep: 30 });
    await untilTesting(alphaLog);
    // The script alone, not its process group: its `boardsmith test` keeps
    // running, as it would after a closed terminal or a stray kill. It must
    // not be holding the lock.
    first.child.kill('SIGKILL');
    await first.done;

    // A SIGKILLed run cannot abort its merge. The next one must reach that
    // refusal, which it can only do if the lock died with the script.
    const next = mergeWith(repo, 'beta', 'adds beta', { wait: 0 });
    expect(next.status).not.toBe(0);
    expect(next.output).not.toContain('holds the merge lock');
    expect(next.output).toContain('git merge --abort');

    git(repo, 'merge', '--abort');
    const retry = mergeWith(repo, 'beta', 'adds beta', { wait: 0 });
    expect(retry.status, retry.output).toBe(0);
  }, 60_000);

  it('keeps its lock out of the working tree', () => {
    const repo = fixtureRepo();
    expect(mergeWith(repo, 'good', 'summary', { wait: 0 }).status).toBe(0);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(lockPath(repo))).toBe(true);
  }, 30_000);
});
