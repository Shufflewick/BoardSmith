/**
 * Every `.ts` file under `src/` is imported at run time by a test (#1414, #1415).
 *
 * `agent-policy verify` runs the tests `vitest run --changed` picks, and vitest picks a test by the
 * files it imports at run time, so a change to only a file no test imports ran no test and could not
 * pass verify. Two kinds of file slip past an ordinary import:
 *
 * - A file that holds only types: `import type` is erased. A test that checks those types also imports
 *   the file for real (`import './types.js';`), as #1413 did.
 * - A file a test runs by its path (a worker, a bundled entry, a fixture, a page a browser loads): each
 *   test that runs it links it with `import.meta.glob('./file.ts')`, which loads nothing.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Links this guard to the code and tests it checks, so `--changed` runs it when one changes; nothing loads.
import.meta.glob(['/src/**/*.ts', '/docs/**/*.test.ts', '/scripts/**/*.test.mjs']);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = fileURLToPath(import.meta.url);

// Untracked files too, so a new file is checked before its first commit.
const source = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src/*.ts'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\0')
  .filter((file) => file && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'));

// Walks every test's imports the way `--changed` does, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false, related: source.map((file) => join(ROOT, file)) }, { root: ROOT });
const tests = new Set((await vitest.getRelevantTestSpecifications()).map((spec) => spec.moduleId));
const { moduleGraph } = vitest.projects[0].vite;
// Follows importers up from the file to a test, leaving out this guard's own link to every file.
const linkedToATest = (file) => {
  const queue = [...(moduleGraph.getModulesByFile(join(ROOT, file)) ?? [])];
  const seen = new Set(queue);
  for (const mod of queue) {
    if (tests.has(mod.file)) return true;
    for (const importer of mod.importers) {
      if (importer.file !== GUARD && !seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return false;
};
const unlinked = source.filter((file) => !linkedToATest(file));
await vitest.close();

describe('src/ files and the tests that check them (#1414, #1415)', () => {
  it('has every .ts file under src/ imported at run time by a test', () => {
    expect(
      unlinked,
      'No test imports these at run time, so a change to one alone runs no test and cannot pass verify. ' +
        "For a file that holds only types, add `import './<file>.js';` beside the `import type` in a test " +
        "that checks them. For a file tests run by its path, add `import.meta.glob('./<file>.ts');` to " +
        'each test that runs it. Otherwise import it from the test that checks it.',
    ).toEqual([]);
  });
});
