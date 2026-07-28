import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, parse } from 'node:path';

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
 * parent directories instead, stopping at the first `package.json` whose `name` is `boardsmith` —
 * the same "walk, don't hop" precedent as `install-claude-command.ts`'s root resolution.
 *
 * Reads synchronously: this runs once at CLI startup to populate Commander's `.version()` call,
 * which is itself a synchronous call site.
 */

let cachedVersion: string | undefined;

export function readBoardsmithVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion;
  }

  const startDir = dirname(fileURLToPath(import.meta.url));
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, 'package.json');
    try {
      const raw = readFileSync(candidate, 'utf-8');
      const pkg = JSON.parse(raw);
      if (pkg.name === 'boardsmith') {
        cachedVersion = pkg.version;
        return cachedVersion as string;
      }
    } catch {
      // Not found or not parseable at this level — keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir || parse(dir).root === dir) {
      // Reached the filesystem root without finding boardsmith's own package.json.
      throw new Error(
        `readBoardsmithVersion: could not locate the boardsmith package.json walking up from ` +
          `${startDir}. No fallback version is used — a fabricated version stamped into a ` +
          `provenance block would be worse than this loud failure.`
      );
    }
    dir = parent;
  }
}
