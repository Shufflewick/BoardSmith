import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';

export const EQUIVALENCE_LEDGER = 'design/MUTATION-EQUIVALENCES.json';
export const CLASSIFIER = `export type Seat = 1 | 2;
export function isFirstSeat(seat: Seat): boolean {
  return seat < 1.5;
}
`;
export const CONTRACT = 'The public typed API accepts exactly seat 1 or seat 2.';
export const PROOF = 'Exhaustive legal domain: both comparisons return true for 1 and false for 2. They differ only at 1.5, which the contract excludes.';

/** Every signer and trust setting belongs to this disposable fixture, never to the checkout. */
export async function equivalenceProject(extra: Record<string, string> = {}) {
  const sandbox = fixtureSandbox('bs-equivalence-', { tools: ['git', 'ssh-keygen'] });
  const env = {
    ...sandbox.env,
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    NODE_OPTIONS: `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`,
  };
  for (const [key, value] of Object.entries(env)) {
    if (['HOME', 'TMPDIR', 'PATH', 'NODE_OPTIONS', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'].includes(key)) vi.stubEnv(key, value);
  }
  const project = join(sandbox.root, 'game');
  await writeFiles(project, {
    '.gitignore': 'node_modules\n.boardsmith/\n',
    'package.json': '{"name":"equivalence-fixture","type":"module","boardsmith":{"players":2}}\n',
    'boardsmith.json': '{"name":"equivalence-fixture"}\n',
    'src/classify.ts': CLASSIFIER,
    'tests/classify.test.ts': `import { it, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { isFirstSeat } from '../src/classify';
it.each([[1, true], [2, false]] as const)('classifies legal seat %i', (seat, expected) => {
  expect(isFirstSeat(seat)).toBe(expected);
  appendFileSync(new URL('../.boardsmith/completed', import.meta.url), String(seat));
});
`,
    'vitest.config.mjs': "import { defineGameViteConfig } from 'boardsmith/vite-config';\nexport default defineGameViteConfig({ test: { pool: 'threads', minWorkers: 1, maxWorkers: 1, cache: false } });\n",
    ...extra,
  });
  linkGameModules(project);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture Reviewer');
  git('config', 'user.email', 'reviewer@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '--allow-empty', '-qm', 'before the classifier');
  const base = git('rev-parse', 'HEAD');
  const key = join(sandbox.root, 'review-key');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'reviewer@example.test', '-f', key], { env, stdio: 'pipe' });
  const allowed = join(sandbox.root, 'allowed-signers');
  await fs.writeFile(allowed, `reviewer@example.test ${await fs.readFile(`${key}.pub`, 'utf8')}`);
  git('config', 'gpg.format', 'ssh');
  git('config', 'user.signingkey', key);
  git('config', 'gpg.ssh.allowedSignersFile', allowed);
  git('add', '.gitignore', 'package.json', 'boardsmith.json', 'src', 'tests', 'vitest.config.mjs');
  git('commit', '-qm', 'classifier and exhaustive behavioral tests');
  return { project, git, allowed, base };
}
