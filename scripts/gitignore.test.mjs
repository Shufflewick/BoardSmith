/**
 * Files a tool writes into the checkout for a moment must be ignored, because
 * `bash scripts/merge-branch.sh` refuses to start on a dirty main and runs
 * `boardsmith test` there.
 *
 * Vite writes `<config>.timestamp-<n>-<hash>.mjs` beside a config file while it
 * loads it and deletes it afterwards. A test run killed at that moment leaves
 * the file behind, and until #335 that left main dirty and blocked every later
 * merge until someone removed it by hand.
 */

import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

/** The repository root, whose .gitignore is under test. */
const REPO = new URL('..', import.meta.url);

/** Whether git ignores `file`, which need not exist. */
function ignored(file) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', file], { cwd: REPO });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${file}: ${result.stderr}`);
  }
  return result.status === 0;
}

describe('.gitignore', () => {
  it("ignores the temp file Vite writes while loading a config, so a killed test run cannot dirty main (#335)", () => {
    expect(ignored('vitest.config.ts.timestamp-1790232803621-7fab5e17214e4.mjs')).toBe(true);
    expect(ignored('vite.config.ts.timestamp-1790232803621-7fab5e17214e4.mjs')).toBe(true);
    expect(ignored('src/cli/fixture/vite.config.mts.timestamp-1-abc.mjs')).toBe(true);
  });

  it('still tracks the config files themselves', () => {
    expect(ignored('vitest.config.ts')).toBe(false);
  });
});
