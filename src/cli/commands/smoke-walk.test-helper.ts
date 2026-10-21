/**
 * THE SMOKE CHECK (#453), RUN FOR REAL, for the `smoke*.test.ts` files: `boardsmith dev` serving a
 * scaffolded game, and the game's own `tests/browser/smoke.spec.ts` walking it in Chromium.
 *
 * Each run needs the Chromium this BoardSmith's Playwright drives. Without it these tests fail
 * with the check's own message saying to run `boardsmith install-browser`; they are never skipped.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

import { runSmoke } from './smoke.js';
import { isRunning, smokeProject } from './smoke-project.test-helper.js';

export const quiet = () => {};

/**
 * Runs the smoke check on the fixture `files` make of a scaffold, and holds it to leaving nothing
 * running and no copy behind, whatever its outcome.
 */
export async function smokeOf(world: boolean, files: Record<string, string> = {}) {
  const dir = await smokeProject(world, files);
  const { outcome, pids, steps, said } = await smokeIn(dir);
  return { dir, outcome, pids, steps, said };
}

/**
 * Runs the smoke check on the project in `dir`, holds it to leaving nothing running and no copy
 * behind, and returns what the walk said it did at each step, in order, and every line the run said.
 */
export async function smokeIn(dir: string) {
  const said: string[] = [];
  const { outcome, pids } = await runSmoke({ projectDir: dir, log: (line) => said.push(line) });
  expect(pids.filter(isRunning)).toEqual([]);
  expect(existsSync(join(dir, '.boardsmith', 'smoke'))).toBe(false);
  return { outcome, pids, said, steps: said.filter((line) => /^smoke( step \d+)?: /.test(line)) };
}
