/**
 * Vitest `globalSetup` for the reads guard (#1504).
 *
 * `agent-policy verify` runs the tests `vitest run --changed` picks, and vitest picks a test only
 * by what it imports. A check that finds the files it reads by walking a folder imports none of
 * them, so a change to one of them never ran the check, and a merge runs it only when its slice of
 * the suite holds it. That is how #1496 and #1499 broke #236's check and still merged (#1503).
 *
 * `record-reads.mjs` logs each repository file a test's own code reads. After the run, every read
 * of a tracked file that is not among the test's dependencies, as `--changed` computes them, fails
 * the run, naming the test and the files. The test links them with `import.meta.glob`.
 *
 * Watch mode is left alone, as the untracked-file guard leaves it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, matchesGlob, relative } from 'node:path';

// Reads no glob can link: this one reads every tracked file, and vite cannot load every kind (LICENSE, .gitignore,
// *.sha256) as a module, so a glob over them breaks `vitest run --changed`. A change to only those waits for its merge slice.
const UNLINKABLE = new Set(['scripts/check-no-control-bytes.test.mjs']);
// Files vite cannot load as modules, so no glob can link them: tsconfig.json is JSON with comments.
const UNLINKABLE_FILES = new Set(['tsconfig.json']);

/** Whether a change to `file` reruns every test, as `forceRerunTriggers` does; picomatch's `dir/**` also matches `dir`. */
const rerunsAll = (file, triggers) => triggers.some((glob) => matchesGlob(file, glob) || matchesGlob(file, glob.replace(/\/\*\*$/, '')));

export function setup(project) {
  if (project.config.watch) return undefined;

  const root = project.config.root;
  const logDir = mkdtempSync(join(tmpdir(), 'bs-reads-guard-'));
  const log = join(logDir, 'reads.jsonl');
  writeFileSync(log, '');
  project.provide('readsGuard', { root, log });

  return async () => {
    const reads = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    rmSync(logDir, { recursive: true, force: true });
    // Untracked too, so a new file is checked before its first commit.
    const files = new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0'),
    );
    const byTest = Map.groupBy(
      reads.filter(({ test, file }) => files.has(file) && !UNLINKABLE_FILES.has(file) && !UNLINKABLE.has(relative(root, test)) && !rerunsAll(join(root, file), project.config.forceRerunTriggers)),
      ({ test }) => test,
    );
    const unlinked = new Map();
    for (const [test, read] of byTest) {
      // vitest's own walk for `--changed`: it loads modules no test loaded and drops `?raw` and other query imports.
      const deps = await project.vitest.specifications.getTestDependencies(project.createSpecification(test)).catch((error) => {
        throw new Error(
          `${relative(root, test)} links a file vite cannot load as a module, so \`vitest run --changed\` fails for every change ` +
            `(${error.id ? relative(root, error.id) : 'a linked file'}: ${error.message}). Take it out of the test's glob, and if the test ` +
            'reads it, add it to UNLINKABLE_FILES in scripts/reads-guard/global-setup.mjs.',
        );
      });
      const missing = read.map(({ file }) => file).filter((file) => join(root, file) !== test && !deps.has(join(root, file)));
      if (missing.length > 0) unlinked.set(test, missing);
    }
    if (unlinked.size === 0) return;

    const lines = [...unlinked].map(([test, read]) => {
      const sorted = read.sort();
      const shown = sorted.length > 5 ? `${sorted.slice(0, 5).join(', ')} and ${sorted.length - 5} more` : sorted.join(', ');
      return `  ${relative(root, test)} reads ${sorted.length} ${sorted.length === 1 ? 'file' : 'files'} it does not link: ${shown}`;
    });
    throw new Error(
      'These tests read repository files they do not import, so `vitest run --changed` (agent-policy verify) does ' +
        `not run them when only those files change:\n${lines.join('\n')}\n` +
        "Link what each test reads with `import.meta.glob(['/<folder>/**/*.<ext>'])` over the files it scans, " +
        "which loads nothing (a glob with `{ query: '?raw' }` does not link), or import the file.",
    );
  };
}
