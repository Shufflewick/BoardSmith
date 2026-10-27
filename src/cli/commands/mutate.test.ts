/**
 * #1496: `boardsmith mutate --base <ref>`, as a user (or a merge) runs it: a sample of 3 mutants of
 * the code lines changed since the merge base with <ref>, against the unit tests only.
 */
import { describe, it, expect, onTestFinished, vi } from 'vitest';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { commitAll, git, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';

vi.setConfig({ testTimeout: 180_000 });

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
`;

const FEE = `export function fee(price: number): number {
  return price * 2;
}
`;

/** A game on `main` with `bid` and its test, and a branch `work` that adds `fee` with `feeTest` and `extra`. */
async function gameWithBranch(feeTest: string, extra: Record<string, string> = {}): Promise<string> {
  const tree = tempTree('bs-mutate-');
  const dir = join(tree, 'game');
  await write(dir, {
    '.gitignore': '.boardsmith/\nnode_modules\n',
    'package.json': '{ "type": "module" }\n',
    'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table' }),
    'vite.config.ts': GAME_VITE_CONFIG,
    'src/rules.ts': RULES,
    'tests/bid.test.ts': `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
`,
  });
  linkGameModules(dir);
  initRepo(dir);
  commitAll(dir, 'base');
  git(dir, 'checkout', '-q', '-b', 'work');
  await write(dir, { 'src/fee.ts': FEE, 'tests/fee.test.ts': feeTest, ...extra });
  commitAll(dir, 'add fee');
  return dir;
}

/** A test of `fee` that catches each of its mutants. */
const KILLS_FEE = "import { it, expect } from 'vitest';\nimport { fee } from '../src/fee';\nit('the fee is twice the price', () => { expect(fee(3)).toBe(6); });\n";

describe('boardsmith mutate', () => {
  it('passes when a test catches each of the 3 sampled mutants of the change, and never runs a sim', async () => {
    const dir = await gameWithBranch(
      KILLS_FEE,
      // A sim that imports the changed file and fails: it would make the run red if it ran.
      { 'tests/fee.sim.test.ts': "import { it, expect } from 'vitest';\nimport { fee } from '../src/fee';\nit('never runs here', () => { expect(fee(3)).toBe(0); });\n" },
    );
    const run = await spawnCli(['mutate', '--base', 'main', '--project', dir]);
    expect(run.stdout).toContain('3 mutants of the lines changed since main');
    expect(run.stdout).toContain('3 killed by tests');
    expect(run.code).toBe(0);
  });

  it('fails, naming each mutant no test caught by file and line, and what to do', async () => {
    const dir = await gameWithBranch("import { it, expect } from 'vitest';\nimport { fee } from '../src/fee';\nit('a fee exists', () => { expect(typeof fee).toBe('function'); });\n");
    const run = await spawnCli(['mutate', '--base', 'main', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('3 of 3 mutants of the lines changed since main');
    expect(run.stdout).toContain('src/fee.ts:2 return value replaced with undefined: no test failed');
    expect(run.stdout).toContain('add or tighten a test so it fails when that line is changed that way');
  });

  it('tries the same sample on the branch tip and on the merge commit that lands it, since the change is the same (#1500)', async () => {
    // Fixed dates make every commit sha, and so a sample seeded by one, the same on each run.
    vi.stubEnv('GIT_AUTHOR_DATE', '2026-01-01T00:00:00Z');
    vi.stubEnv('GIT_COMMITTER_DATE', '2026-01-01T00:00:00Z');
    onTestFinished(() => { vi.unstubAllEnvs(); });
    const dir = await gameWithBranch("import { it, expect } from 'vitest';\nimport { fee } from '../src/fee';\nit('a fee exists', () => { expect(typeof fee).toBe('function'); });\n", {
      'src/fee.ts': 'export function fee(price: number, rush: boolean): number {\n  if (price > 100) return price * 2;\n  if (rush) return price + 5;\n  return price - 1;\n}\n',
    });
    const survivors = (stdout: string) => stdout.split('\n').filter((line) => line.includes('src/fee.ts:'));
    const onBranch = await spawnCli(['mutate', '--base', 'main', '--project', dir]);
    git(dir, 'checkout', '-q', 'main');
    await write(dir, { 'README.md': 'main moved on\n' });
    commitAll(dir, 'docs on main');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge work', 'work');
    const onMerge = await spawnCli(['mutate', '--base', 'HEAD^1', '--project', dir]);
    expect(survivors(onBranch.stdout)).toHaveLength(3);
    expect(survivors(onMerge.stdout)).toEqual(survivors(onBranch.stdout));
  });

  it('fails when every mutant ran past its time limit and none was killed, since no test was shown to notice a change (#1499)', async () => {
    const spin = (step: string) => `export function spin(n: number): number {\n  let i = 0;\n  while (i < n) {\n    ${step}\n  }\n  return i;\n}\n`;
    const dir = await gameWithBranch(KILLS_FEE, {
      'src/spin.ts': spin('i = i + 1;'),
      'tests/spin.test.ts': "import { it, expect } from 'vitest';\nimport { spin } from '../src/spin';\nit('counts up to n', () => { expect(spin(3)).toBe(3); });\n",
    });
    // The one mutant of the changed line removes the step, so the loop never ends.
    await write(dir, { 'src/spin.ts': spin('i++;') });
    commitAll(dir, 'step with ++');
    const run = await spawnCli(['mutate', '--base', 'HEAD~1', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('1 of 1 mutant of the lines changed since HEAD~1');
    expect(run.stdout).toContain('none was killed');
    expect(run.stdout).toContain('src/spin.ts:4 statement removed: its tests ran past the time limit');
    expect(run.stdout).toContain('Run `boardsmith mutate` again when the machine is less busy');
  });

  it('says a file loaded only by a setup file counts as imported by no test (#1499)', async () => {
    const dir = await gameWithBranch(KILLS_FEE, {
      'vite.config.ts': "import { defineGameViteConfig } from 'boardsmith/vite-config';\n\nexport default defineGameViteConfig({ test: { setupFiles: ['./setup.ts'] } });\n",
      'setup.ts': "import { fee } from './src/fee';\n(globalThis as { fee?: typeof fee }).fee = fee;\n",
      'tests/fee.test.ts': "import { it, expect } from 'vitest';\nit('the fee is twice the price', () => { expect((globalThis as { fee?: (p: number) => number }).fee!(3)).toBe(6); });\n",
    });
    const run = await spawnCli(['mutate', '--base', 'main', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('src/fee.ts:2');
    expect(run.stdout).toContain('A file a test reaches only through a setup file counts as imported by none');
  });

  it('refuses a boardsmith.json that is not valid JSON, naming it, before any git work (#1499)', async () => {
    const tree = tempTree('bs-mutate-');
    const dir = join(tree, 'game');
    // No git repository: reading the base first would fail on git, not on the file.
    await write(dir, { 'package.json': '{ "type": "module" }\n', 'boardsmith.json': '{ "name": "fixture", }\n', 'vite.config.ts': GAME_VITE_CONFIG, 'tests/a.test.ts': '' });
    linkGameModules(dir);
    const run = await spawnCli(['mutate', '--base', 'main', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(`boardsmith.json in ${dir} is not valid JSON`);
  });

  it('refuses a base whose merge base is the current commit, since it measures no change', async () => {
    const dir = await gameWithBranch("import { it } from 'vitest';\nit('holds', () => {});\n");
    git(dir, 'checkout', '-q', 'main');
    const run = await spawnCli(['mutate', '--base', 'work', '--project', dir]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('The merge base with work is the current commit');
  });

  it('passes with nothing to mutate when no code under src/ changed', async () => {
    const dir = await gameWithBranch("import { it } from 'vitest';\nit('holds', () => {});\n");
    await write(dir, { 'README.md': 'docs only\n' });
    commitAll(dir, 'docs');
    const run = await spawnCli(['mutate', '--base', 'HEAD~1', '--project', dir]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('No code under src/ changed since HEAD~1');
  });
});
