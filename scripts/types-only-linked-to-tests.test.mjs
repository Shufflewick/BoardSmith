/**
 * Every types-only file under `src/` is imported at run time by a test (#1414).
 *
 * `agent-policy verify` runs the tests `vitest run --changed` picks, and vitest picks a test by the
 * files it imports at run time. `import type` is erased, so a file that holds only types is linked to
 * no test through it, and a change to only that file ran no test and could not pass verify. A test
 * that checks those types also imports the file for real (`import './types.js';`), as #1413 did.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Links this guard to the code and tests it checks, so `--changed` runs it when one changes; nothing loads.
import.meta.glob(['/src/**/*.ts', '/docs/**/*.test.ts', '/scripts/**/*.test.mjs']);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = fileURLToPath(import.meta.url);

// Untracked files too, so a new types-only file is checked before its first commit.
const source = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src/*.ts'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\0')
  .filter((file) => file && !file.endsWith('.test.ts') && !file.endsWith('.d.ts'));
const compilerOptions = { removeComments: true, verbatimModuleSyntax: true, module: ts.ModuleKind.ESNext };
// A types-only file compiles to nothing but the `export {}` that keeps it a module.
const typesOnly = source.filter(
  (file) => ts.transpileModule(readFileSync(join(ROOT, file), 'utf-8'), { compilerOptions }).outputText.trim() === 'export {};',
);

// Walks every test's imports the way `--changed` does, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false, related: typesOnly.map((file) => join(ROOT, file)) }, { root: ROOT });
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
const unlinked = typesOnly.filter((file) => !linkedToATest(file));
await vitest.close();

describe('types-only files and the tests that check them (#1414)', () => {
  it('has every types-only file under src/ imported at run time by a test', () => {
    expect(
      unlinked,
      'These files hold only types, and no test imports one at run time, so a change to one alone runs no ' +
        'test and cannot pass verify. Beside the `import type` in a test that checks its types, add ' +
        "`import './<file>.js';` so `--changed` links that test to it.",
    ).toEqual([]);
  });
});
