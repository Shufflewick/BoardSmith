/**
 * A GAME `boardsmith verify` CAN RUN WHOLE, smoke check included (#453): a table or a world as
 * `boardsmith init` scaffolds it, installed the way a real game is (`devProject`), with the tools
 * the test, typecheck and mutation checks run through linked from this checkout's install.
 *
 * The scaffold's `tests/a11y.example.test.ts` is left out: it runs axe-core, which this checkout
 * does not install. So is a world's `tests/world.test.ts`, which fails and does not type-check on
 * main (#456). Everything else is the scaffold as a designer receives it, so the smoke test a
 * fixture runs is the one `init` writes.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { commitAll, writeFiles } from '../lib/verify-result.test-helper.js';
import { devProject } from './dev-project.test-helper.js';

/**
 * Scaffolds a table (or a world when `world` is true), writes `files` over it, and commits it all
 * on `main`, ready for `boardsmith verify` or `runSmoke`.
 *
 * @returns the project directory
 */
export async function smokeProject(world: boolean, files: Record<string, string> = {}): Promise<string> {
  const dir = await devProject(world);
  const modules = join(dir, 'node_modules');
  await fs.mkdir(join(modules, '.bin'), { recursive: true });
  await fs.mkdir(join(modules, '@vue'), { recursive: true });
  for (const name of ['typescript', 'vue-tsc', 'vitest', 'jsdom', '@vue/test-utils']) {
    await fs.symlink(join(INSTALLED_MODULES, name), join(modules, name), 'dir');
  }
  await fs.symlink('../vue-tsc/bin/vue-tsc.js', join(modules, '.bin', 'vue-tsc'));
  await fs.symlink('../vitest/vitest.mjs', join(modules, '.bin', 'vitest'));
  await fs.rm(join(dir, 'tests', 'a11y.example.test.ts'));
  if (world) await fs.rm(join(dir, 'tests', 'world.test.ts'));
  await writeFiles(dir, files);
  commitAll(dir, 'fixture: the scaffolded game');
  return dir;
}

/** Whether a process is still running. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
