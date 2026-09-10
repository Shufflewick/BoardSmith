/**
 * The reproduction for #236, kept as a runnable test file.
 *
 * This is deliberately the exact shape that leaked: a temp tree made inside a
 * test body, in a file with no `afterEach` and no `rmSync` anywhere in it. Under
 * the old hand-rolled `mkdtempSync` that shape abandoned one directory per case
 * on every run, forever.
 *
 * It cannot assert its own cleanup -- the removal happens in an `afterAll` that
 * runs after the last test here. So `temp-tree.test-helper.test.ts` runs this
 * file in a child Vitest process, reads the path off the marker line below, and
 * asserts the tree is gone once the process has exited. The path is printed
 * unconditionally so that the child run and an ordinary suite run execute the
 * same code.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from './temp-tree.test-helper.js';

/** Read by the owning test to find the tree this run made. */
export const PROBE_MARKER = 'temp-tree-probe-made:';

describe('#236 probe: a temp tree in a bare test body', () => {
  it('gets a real directory it can write into, and never removes it itself', () => {
    const dir = tempTree('bs-temp-tree-probe-');
    writeFileSync(join(dir, 'fixture.txt'), 'a fixture tree, as a real one would be');

    expect(existsSync(join(dir, 'fixture.txt'))).toBe(true);
    console.log(`${PROBE_MARKER}${dir}`);
  });
});
