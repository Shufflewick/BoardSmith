/**
 * Vitest setup file for the untracked-file guard (#579, see `guard.mjs` and
 * `global-setup.mjs`).
 *
 * Its `afterAll` is registered before the test file's own hooks, and vitest
 * runs `afterAll` hooks last-registered first, so this one runs after the file
 * has cleaned up after itself, `tempTree`'s removal included. Whatever new
 * untracked, unignored file is still in the checkout then is reported with
 * this test file's path. It never fails the file itself: files run in
 * parallel, so the file that saw a stray first is a lead, not proof.
 */
import { afterAll, inject } from 'vitest';
import { appendFileSync } from 'node:fs';
import { newStrays } from './guard.mjs';

const guard = inject('untrackedGuard');

if (guard !== undefined) {
  afterAll((file) => {
    const lines = newStrays(guard.root, guard.baseline).map((path) => JSON.stringify({ path, file: file.filepath }));
    if (lines.length > 0) appendFileSync(guard.log, `${lines.join('\n')}\n`);
  });
}
