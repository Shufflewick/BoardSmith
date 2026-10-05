/**
 * `boardsmith verify` type-checks the project once (#532). The `typecheck` check and `validate`'s
 * own TypeScript step both compile the project's tsconfig.json; vue-tsc is the slowest step in a
 * run, so verify runs it once and both report that one result.
 *
 * The fixture's `node_modules/.bin/vue-tsc` is a wrapper that records each run in a file beside
 * the project and then runs the real compiler, so every vue-tsc the run starts is counted,
 * whichever process starts it. The run happens while the file is collected, where no test
 * timeout applies (#363); the test asserts what it left behind.
 */
import { promises as fs, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { commitAll, initRepo, writeFiles as write } from '../lib/verify-result.test-helper.js';
import { VERIFY_CHECKS, runVerify } from './verify.js';

/** A `node_modules` that is this checkout's install, except that `vue-tsc` counts its runs. */
async function countingModules(dir: string, callLog: string): Promise<void> {
  const modules = join(dir, 'node_modules');
  const bin = join(modules, '.bin');
  await fs.mkdir(bin, { recursive: true });
  for (const entry of await fs.readdir(INSTALLED_MODULES)) {
    if (entry !== '.bin') await fs.symlink(join(INSTALLED_MODULES, entry), join(modules, entry));
  }
  for (const entry of await fs.readdir(join(INSTALLED_MODULES, '.bin'))) {
    const real = realpathSync(join(INSTALLED_MODULES, '.bin', entry));
    if (entry !== 'vue-tsc') await fs.symlink(real, join(bin, entry));
    else {
      await fs.writeFile(join(bin, entry), `#!/bin/sh\necho run >> '${callLog}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
    }
  }
}

const tree = tempTree('bs-verify-typecheck-once-');
const project = join(tree, 'game');
const callLog = join(tree, 'vue-tsc-runs.log');
await fs.mkdir(project, { recursive: true });
await write(project, {
  '.gitignore': '.boardsmith/\nnode_modules\n.vite/\n',
  'boardsmith.json': JSON.stringify({ name: 'fixture', backend: 'table' }),
  'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0' }),
  'tsconfig.json': JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true },
    include: ['src'],
  }),
  'src/rules.ts': 'export const seats = 2;\n',
});
await countingModules(project, callLog);
initRepo(project);
commitAll(project, 'base');

const standIn = async () => ({ passed: true, summary: 'stood in for by the fixture' });
const log = vi.spyOn(console, 'log').mockImplementation(() => {});
const error = vi.spyOn(console, 'error').mockImplementation(() => {});
const { result } = await runVerify({
  projectDir: project,
  base: 'HEAD',
  // The checks that never type-check stand in; typecheck, build and validate run for real.
  checks: { ...VERIFY_CHECKS, test: standIn, smoke: standIn, mutation: standIn },
  log: () => {},
});
log.mockRestore();
error.mockRestore();
const vueTscRuns = (await fs.readFile(callLog, 'utf-8').catch(() => '')).split('\n').filter(Boolean).length;

describe('boardsmith verify type-checks once (#532)', () => {
  it('starts vue-tsc exactly once for typecheck, build and validate together', () => {
    expect(result.checks.find((c) => c.name === 'typecheck')?.passed).toBe(true);
    expect(vueTscRuns).toBe(1);
  });
});
