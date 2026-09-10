/**
 * The single owner of a test's temp directory lifetime (#236).
 *
 * Before this existed, 46 test files called `mkdtemp` themselves and each was
 * separately responsible for removing what it made. Forty-four of them did.
 * `scripts/ingest-harness/check.test.mjs` did not, in two helpers, and so every
 * ordinary `npx vitest run` abandoned eight fixture trees in the temp root for
 * good: 848 of them had accumulated on the filer's machine by the time #236 was
 * written, and their real cost was that they hid a leak from #231 until they
 * were filtered out by hand.
 *
 * A correct `afterEach` in each of the 46 files is not the fix, for the same
 * reason a `finally` in each browser script was not the fix for #231: it makes
 * the right thing the caller's job to remember, once per file, forever. Here
 * the caller cannot hold half of a temp tree's lifetime, because it never holds
 * any of it -- `tempTree` records what it made, and this module removes it.
 *
 * ## Why the removal is per FILE, not per test
 *
 * Vitest's `onTestFinished` would remove a tree the moment its test ends, which
 * is tidier, but it throws outside a running test ("can only be called inside a
 * test") and twelve of the migrated call sites run in `beforeAll`. A helper that
 * works in a test body and in `beforeEach` but not in `beforeAll` would push
 * exactly those twelve back to hand-written removal, which is the thing being
 * removed.
 *
 * The `afterAll` below is registered when this module is first imported, which
 * happens while Vitest is collecting the importing test file, so it attaches to
 * that file's root suite. That is why one hook drains trees made in module
 * scope, `beforeAll`, `beforeEach` and test bodies alike, without any call site
 * having to say which it is. The cost is that a file's trees live until the file
 * ends rather than until each test does; they are small fixture copies and a
 * file's count is bounded by its own test count.
 *
 * This relies on Vitest giving each test file its own module registry, which is
 * its default and which `temp-tree.test-helper.test.ts` asserts is not turned
 * off -- with `isolate: false` this module would be shared across files and only
 * the first importer would register the hook.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

/** Every tree this file's tests have made, in creation order. */
const owned: string[] = [];

afterAll(() => {
  // Drained rather than iterated, so a second run in the same file cannot try
  // to remove a path that is already gone.
  while (owned.length > 0) {
    rmSync(owned.pop() as string, { recursive: true, force: true });
  }
});

/**
 * A fresh temp directory, removed when the current test file finishes.
 *
 * `prefix` is passed to `mkdtemp` under the OS temp root, so it should name the
 * test that owns the tree (`'bs-zip-'`, `'bs-verify-impact-'`). It is what a
 * leak would be identified by, which is the only reason it is the caller's to
 * choose.
 */
export function tempTree(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  owned.push(dir);
  return dir;
}
