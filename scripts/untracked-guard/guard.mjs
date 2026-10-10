/**
 * Finds files a test run wrote into the checkout that git neither tracks nor
 * ignores (#579).
 *
 * Such a file is visible to every other test running at the same moment and to
 * anything keyed on the checkout's untracked files. In #571 a probe file that
 * `scripts/check-no-hex.test.mjs` wrote under `src/ui/` changed the mutant
 * cache key for a test running beside it, which then failed now and then. A
 * test that needs to write files writes them into a `tempTree`
 * (`src/testing/temp-tree.test-helper.ts`); a tool's real output belongs in a
 * path `.gitignore` names.
 *
 * `global-setup.mjs` and `after-each-file.mjs` wire this into the suite; see
 * `vitest.config.ts`.
 */
import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';

/**
 * Every file under `root` that git neither tracks nor ignores, relative to
 * `root` and sorted. This is the `??` set of `git status --porcelain
 * --untracked-files=all`, read without having to parse status codes.
 */
export function untrackedUnignored(root) {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((path) => path !== '').sort();
}

/** The untracked, unignored files under `root` now that were not in `baseline`. */
export function newStrays(root, baseline) {
  const before = new Set(baseline);
  return untrackedUnignored(root).filter((path) => !before.has(path));
}

/**
 * The error a run with strays fails with. Each stray is `{ path, file }`:
 * `file` is the test file after which it was first seen, or undefined when it
 * was first seen as the run ended.
 */
export function strayMessage(strays, root) {
  const lines = strays.map(({ path, file }) =>
    file === undefined
      ? `  ${path} (found when the run ended)`
      : `  ${path} (first seen when ${relative(root, file)} finished)`,
  );
  return [
    `The test run left ${strays.length === 1 ? 'a file' : `${strays.length} files`} in the checkout that git neither tracks nor ignores:`,
    ...lines,
    'A test file is named when the file was there as soon as it finished. Test files run in',
    'parallel, so check that one first, then any running beside it.',
    'Point the test at a temp directory (`tempTree` in src/testing/temp-tree.test-helper.ts),',
    'or, if the file is real build output, add its path to .gitignore. Then remove the file.',
  ].join('\n');
}
