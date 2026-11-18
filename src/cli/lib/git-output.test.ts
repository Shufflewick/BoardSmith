/**
 * Every CLI command runs git through `gitOutput` (#531). A second way to start git is how the CLI
 * ended up reading quoted paths in one command and raw paths in another, so this reads the CLI's
 * own source and refuses any other place that starts a git process.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { gitNames, projectGitNames } from './git-output.js';

// Links the files this check reads, so `vitest run --changed` runs it when only one changes; nothing loads (#1504).
import.meta.glob(['/src/cli/**/*.ts', '!**/*.test.ts']);

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_OUTPUT = join(CLI_DIR, 'lib', 'git-output.ts');

/** A child-process call whose command is git, whichever of node's spawners it uses. */
const SPAWNS_GIT = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\(\s*['"`]git\b/;

/** Names git quotes in a newline-separated list even with `core.quotePath=false`. */
const QUOTED = ['a"b.ts', 'c\\d.ts', 'e\tf.ts', 'g\nh.ts'];

function cliSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cliSources(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.includes('test-helper')) return [];
    return [path];
  });
}

describe('gitOutput is the only way the CLI runs git (#531)', () => {
  it('finds no other source file that starts a git process', () => {
    const others = cliSources(CLI_DIR)
      .filter((file) => file !== GIT_OUTPUT && SPAWNS_GIT.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(CLI_DIR, file));
    expect(others).toEqual([]);
  });

  it('recognises each of the ways node starts a process', () => {
    for (const call of ["execSync('git init')", "execFile('git', [])", 'spawn("git", [])', 'spawnSync(`git`, [])']) {
      expect(call).toMatch(SPAWNS_GIT);
    }
  });
});

/** A git call that prints a list of paths: one git quotes unless it is told `-z` (#1692). */
const LISTS_NAMES = /'(?:--name-only|ls-files)'/;

describe('gitNames reads the paths git lists whole (#1692)', () => {
  // Slow one-time setup lives here, where no test timeout applies.
  const repo = tempTree('bs-git-names-');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  for (const name of QUOTED) writeFileSync(join(repo, name), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'quoted');

  it('keeps a quote, a backslash, a tab and a newline in a name', async () => {
    expect((await gitNames(repo, ['diff', '--name-only', 'HEAD~1', 'HEAD'])).sort()).toEqual([...QUOTED].sort());
    expect((await gitNames(repo, ['log', '--no-walk', '--format=', '--name-only', 'HEAD'])).sort()).toEqual([...QUOTED].sort());
    expect((await gitNames(repo, ['--literal-pathspecs', 'ls-files', '--', QUOTED[0]]))).toEqual([QUOTED[0]]);
    expect((await projectGitNames(repo, ['ls-files'])).sort()).toEqual([...QUOTED].sort());
  });

  it('is how every CLI source file reads a list of paths', () => {
    const others = cliSources(CLI_DIR)
      .filter((file) => file !== GIT_OUTPUT)
      .flatMap((file) =>
        readFileSync(file, 'utf-8')
          .split('\n')
          .flatMap((line, i) => (LISTS_NAMES.test(line) && !/Names\(|Succeeds\(/.test(line) ? [`${relative(CLI_DIR, file)}:${i + 1}`] : [])),
      );
    expect(others).toEqual([]);
  });
});
