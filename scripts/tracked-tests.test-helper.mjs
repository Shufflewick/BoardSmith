/**
 * The repository's own test files, for the scans that hold one rule across the
 * whole suite: no wall-clock budget (#360), no unexplained in-test module load
 * (#365), no fixture program writing outside a sandbox (#430).
 *
 * `trackedTestFiles(['src', 'scripts'])` is every tracked `*.test.ts` and
 * `*.test.mjs` under those directories, with its text. Tracked, so a scratch
 * file a person has not added yet is not a finding. `trackedFiles` is the path
 * lister under it, which the scans over shipped sources use too.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Links the files this check reads, so `vitest run --changed` runs it when only one changes; nothing loads (#1504).
import.meta.glob('/{src,docs,scripts}/**/*.test.{ts,mjs}');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every tracked path under `dirs`, read with `-z` so git never quotes a name (#834, #1692). */
export function trackedFiles(dirs, cwd = ROOT) {
  return execFileSync('git', ['ls-files', '-z', ...dirs], { cwd, encoding: 'utf-8' }).split('\0').filter(Boolean);
}

export function trackedTestFiles(dirs) {
  return trackedFiles(dirs)
    .filter((path) => /\.test\.(?:ts|mjs)$/.test(path))
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf-8') }));
}
