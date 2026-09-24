/**
 * `npm run merge -- <branch> "<summary>"` is the one way a branch reaches
 * `main` (#312), and it refuses a branch whose merged tree fails `npm test`.
 *
 * `npm test` runs `pretest` first, and `pretest` is `npm run typecheck`, so a
 * type error anywhere in the package stops the merge before a single test
 * runs. This file proves the refusal against a throwaway repository whose
 * `npm test` passes or fails on demand, so it holds without compiling
 * BoardSmith; the last test holds the wiring from `npm test` to the type check
 * in this repository's own package.json.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_IDENTITY },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function git(cwd, ...args) {
  const result = run(cwd, 'git', args);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.output}`);
  return result.output.trim();
}

/**
 * A repository on `main` whose `npm test` fails while a file named `broken`
 * exists, with a branch `good` that passes and a branch `bad` that fails.
 */
function fixtureRepo() {
  const repo = tempTree('bs-merge-branch-');
  git(repo, 'init', '--quiet', '--initial-branch=main');
  mkdirSync(path.join(repo, 'scripts'));
  copyFileSync(SCRIPT, path.join(repo, 'scripts/merge-branch.sh'));
  writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node check.mjs' } }),
  );
  writeFileSync(
    path.join(repo, 'check.mjs'),
    "import { existsSync } from 'node:fs';\n" +
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

  git(repo, 'checkout', '--quiet', 'main');
  return repo;
}

function merge(repo, ...args) {
  return run(repo, 'bash', ['scripts/merge-branch.sh', ...args]);
}

describe('npm run merge (#312)', () => {
  it('merges a branch whose merged tree passes npm test, with a merge commit that names it', () => {
    const repo = fixtureRepo();
    const before = git(repo, 'rev-parse', 'HEAD');

    const result = merge(repo, 'good', 'adds the feature (#1)');

    expect(result.status, result.output).toBe(0);
    expect(git(repo, 'rev-parse', 'HEAD^1')).toBe(before);
    expect(git(repo, 'rev-parse', 'HEAD^2')).toBe(git(repo, 'rev-parse', 'good'));
    expect(git(repo, 'log', '-1', '--format=%s')).toBe("Merge branch 'good': adds the feature (#1)");
    expect(git(repo, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('refuses a branch whose merged tree fails npm test, and leaves main exactly as it was', () => {
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
    expect(noSummary.output).toContain('Usage: npm run merge');

    const unknown = merge(repo, 'no-such-branch', 'summary');
    expect(unknown.status).not.toBe(0);
    expect(unknown.output).toContain("No branch named 'no-such-branch'");

    expect(merge(repo, 'good', 'first').status).toBe(0);
    const again = merge(repo, 'good', 'second');
    expect(again.status).not.toBe(0);
    expect(again.output).toContain('already on main');
  }, 30_000);

  it("runs the whole-package type check before this repository's tests", () => {
    const scripts = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).scripts;

    expect(scripts.merge).toBe('bash ./scripts/merge-branch.sh');
    expect(scripts.pretest).toBe('npm run typecheck');
    expect(scripts.typecheck).toBe('vue-tsc --noEmit -p tsconfig.json');
    expect(scripts.test).toBe('vitest run');
  });
});
