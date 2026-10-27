/**
 * #1496: `boardsmith mutate --base <ref>`, as a user (or a merge) runs it: a sample of 3 mutants of
 * the code lines changed since the merge base with <ref>, against the unit tests only.
 */
import { describe, it, expect, vi } from 'vitest';
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
  const dir = join(tempTree('bs-mutate-'), 'game');
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

describe('boardsmith mutate', () => {
  it('passes when a test catches each of the 3 sampled mutants of the change, and never runs a sim', async () => {
    const dir = await gameWithBranch(
      "import { it, expect } from 'vitest';\nimport { fee } from '../src/fee';\nit('the fee is twice the price', () => { expect(fee(3)).toBe(6); });\n",
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
