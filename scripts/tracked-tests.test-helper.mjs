/**
 * The repository's own test files, for the scans that hold one rule across the
 * whole suite: no wall-clock budget (#360), no unexplained in-test module load
 * (#365), no fixture program writing outside a sandbox (#430).
 *
 * `trackedTestFiles(['src', 'scripts'])` is every tracked `*.test.ts` and
 * `*.test.mjs` under those directories, with its text. Tracked, so a scratch
 * file a person has not added yet is not a finding.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function trackedTestFiles(dirs) {
  return execFileSync('git', ['ls-files', ...dirs], { cwd: ROOT, encoding: 'utf-8' })
    .split('\n')
    .filter((path) => /\.test\.(?:ts|mjs)$/.test(path))
    .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf-8') }));
}
