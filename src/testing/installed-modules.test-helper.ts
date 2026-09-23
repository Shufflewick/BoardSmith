/**
 * WHERE THIS CHECKOUT'S PACKAGES ARE INSTALLED, found the way Node finds them (#287).
 *
 * Tests that hand a real tool to a child process (vue-tsc, vitest) or build a
 * sandbox `node_modules` out of our own install need that install's directory.
 * It is NOT always `<checkout>/node_modules`: a git worktree under
 * `.worktrees/<name>` has no install of its own, and Node resolves its packages
 * by walking up to the main checkout's. Six tests that joined the checkout root
 * with `node_modules` failed there, and three typecheck gates passed without
 * running a compiler at all.
 *
 * So the directory is taken from Node's own resolution of a package this repo
 * installs, which is the same answer every import in the suite already gets.
 */
import { createRequire } from 'node:module';
import { sep } from 'node:path';

const MARKER = `${sep}node_modules${sep}`;

function installedModules(): string {
  let entry: string;
  try {
    entry = createRequire(import.meta.url).resolve('typescript');
  } catch {
    throw new Error(
      'BoardSmith\'s packages are not installed where Node can find them from this checkout. ' +
        'Run `npm install` in the BoardSmith checkout (for a worktree, in the main checkout it was made from).',
    );
  }
  return entry.slice(0, entry.lastIndexOf(MARKER) + MARKER.length - 1);
}

/** The `node_modules` directory Node resolves this checkout's packages from. */
export const INSTALLED_MODULES = installedModules();
