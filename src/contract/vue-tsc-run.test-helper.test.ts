/**
 * A gate that asserts an EMPTY error list must not be handed an empty list by
 * a compiler that never ran (#287). From a git worktree the compiler's path
 * once pointed at a `node_modules` that does not exist there, Node printed
 * "Cannot find module", and the three typecheck gates all passed in 30 ms.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

import { VUE_TSC, vueTscErrorLines } from './vue-tsc-run.test-helper.js';

describe('vueTscErrorLines', () => {
  it('returns the error lines of a run that found errors', () => {
    const run = {
      status: 2,
      stdout: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\nnoise\n",
      stderr: '',
    };
    expect(vueTscErrorLines(run)).toEqual(["src/a.ts(1,1): error TS2304: Cannot find name 'x'."]);
  });

  it('returns nothing for a clean run', () => {
    expect(vueTscErrorLines({ status: 0, stdout: '', stderr: '' })).toEqual([]);
  });

  it('refuses a run that failed without reporting a single type error, instead of calling it clean', () => {
    const run = {
      status: 1,
      stdout: '',
      stderr: "Error: Cannot find module '/checkout/node_modules/vue-tsc/bin/vue-tsc.js'\n",
    };
    expect(() => vueTscErrorLines(run)).toThrow(/vue-tsc did not run[\s\S]*Cannot find module/);
  });

  it('refuses a run that could not be started at all', () => {
    const run = { status: null, stdout: '', stderr: '', error: new Error('spawn ENOENT') };
    expect(() => vueTscErrorLines(run)).toThrow(/vue-tsc did not run[\s\S]*spawn ENOENT/);
  });
});

describe('VUE_TSC', () => {
  it('names a compiler that is installed, wherever this checkout resolves its packages from', () => {
    expect(existsSync(VUE_TSC), `${VUE_TSC} does not exist`).toBe(true);
  });
});
