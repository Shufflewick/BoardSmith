import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, parse, sep } from 'node:path';
import { readIfExistsSync } from './read-if-exists.js';

/**
 * `boardsmith --version` used to hardcode `.version('0.0.1')` in `src/cli/cli.ts`, so it reported
 * a stale literal no matter what `package.json` actually shipped (171-CONTEXT.md decision 9).
 * `readBoardsmithVersion()` fixes that by reading the real field.
 *
 * Two runtime shapes are both real (see `bin/boardsmith.js`) and have different `__dirname`s for a
 * module living at `src/cli/lib/`:
 *   - dev repo: tsx runs `src/cli/cli.ts` directly, so this module's `import.meta.url` resolves to
 *     `<repo>/src/cli/lib/boardsmith-version.ts`
 *   - published/build: the bundle is `dist/cli.js`, so `__dirname` for the bundle is `<pkg>/dist`
 * A fixed `resolve(__dirname, '../../..')` hop count is wrong in one of those two shapes. Walk up
 * parent directories instead, stopping at the first `package.json` whose `name` is `boardsmith`.
 * `install-claude-command.ts` once hopped and broke in every installed copy (#723).
 *
 * Reads synchronously: this runs once at CLI startup to populate Commander's `.version()` call,
 * which is itself a synchronous call site.
 */

let cachedRoot: { dir: string; version: string } | undefined;

/** The directory holding BoardSmith's own package.json, and the version it states. */
function findPackage(): { dir: string; version: string } {
  if (cachedRoot !== undefined) {
    return cachedRoot;
  }

  const startDir = dirname(fileURLToPath(import.meta.url));
  let dir = startDir;

  for (;;) {
    const raw = readIfExistsSync(join(dir, 'package.json'), (p) => readFileSync(p, 'utf-8'));
    let pkg: { name?: unknown; version?: unknown } | undefined;
    try {
      pkg = raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      // Not JSON, so not BoardSmith's own: keep walking up.
    }
    if (pkg?.name === 'boardsmith') {
      cachedRoot = { dir, version: pkg.version as string };
      return cachedRoot;
    }

    const parent = dirname(dir);
    if (parent === dir || parse(dir).root === dir) {
      // Reached the filesystem root without finding boardsmith's own package.json.
      throw new Error(
        `Could not find BoardSmith's own package.json in any folder above ${startDir}, so this ` +
          `copy of BoardSmith is incomplete. Reinstall BoardSmith and run the command again.`
      );
    }
    dir = parent;
  }
}

export function readBoardsmithVersion(): string {
  return findPackage().version;
}

/** The root of the BoardSmith package this CLI runs from: a checkout, or an installed copy. */
export function boardsmithPackageRoot(): string {
  return findPackage().dir;
}

/**
 * What kind of BoardSmith install `root` is: a source checkout, an installed copy, or npm's `_npx`
 * cache, which npm clears. `boardsmith claude` links only a checkout (#942); init refuses the cache (#1007).
 */
export function boardsmithInstallKind(root: string): 'checkout' | 'installed' | 'npx-cache' {
  const segments = root.split(sep);
  if (segments.includes('_npx')) return 'npx-cache';
  // A source checkout is a git clone or worktree (the published package ships no .git) outside any node_modules folder.
  return !segments.includes('node_modules') && existsSync(join(root, '.git')) ? 'checkout' : 'installed';
}
