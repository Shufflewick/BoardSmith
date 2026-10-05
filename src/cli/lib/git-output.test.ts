/**
 * Every CLI command runs git through `gitOutput` (#531). A second way to start git is how the CLI
 * ended up reading quoted paths in one command and raw paths in another, so this reads the CLI's
 * own source and refuses any other place that starts a git process.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const GIT_OUTPUT = join(CLI_DIR, 'lib', 'git-output.ts');

/** A child-process call whose command is git, whichever of node's spawners it uses. */
const SPAWNS_GIT = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\(\s*['"`]git\b/;

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
