/**
 * A run fails when a test's own code reads a repository file the test does not link (#1504).
 *
 * Each case runs a real vitest in a temp git repo wired to the guard the way `vitest.config.ts`
 * wires it, because the guard is only worth anything if such a run actually goes red and names
 * the read.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../src/testing/temp-tree.test-helper.ts';

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const GUARD_DIR = join(PROJECT_ROOT, 'scripts', 'reads-guard');

/** Runs this repo's vitest over `files` in a temp git repo whose tracked `data/` holds `a.txt` and `b.txt`. */
function runGuardedVitest(files) {
  const root = tempTree('bs-reads-guard-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, '.gitignore'), 'node_modules\nout/\n');
  writeFileSync(join(root, 'package.json'), '{ "private": true }\n');
  writeFileSync(join(root, 'data', 'a.txt'), 'a\n');
  writeFileSync(join(root, 'data', 'b.txt'), 'b\n');
  symlinkSync(join(PROJECT_ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { include: ['*.test.mjs'], ` +
      `globalSetup: [${JSON.stringify(join(GUARD_DIR, 'global-setup.mjs'))}], ` +
      `setupFiles: [${JSON.stringify(join(GUARD_DIR, 'record-reads.mjs'))}] } };\n`,
  );
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body.join('\n'));
  execFileSync('git', ['add', '.'], { cwd: root });
  const run = spawnSync(process.execPath, [join(PROJECT_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

/** A check that finds `data/`'s files by walking the folder and reads each, as #236's check did. */
const WALKS_DATA = [
  "import { it, expect } from 'vitest';",
  "import { readdirSync, readFileSync } from 'node:fs';",
  "import { readFile } from 'node:fs/promises';",
  "import { join } from 'node:path';",
  "const dir = join(process.cwd(), 'data');",
  "const [first, second] = readdirSync(dir);",
  "const text = readFileSync(join(dir, first), 'utf8');",
  "it('reads what it found', async () => expect(text + await readFile(join(dir, second), 'utf8')).toBe('a\\nb\\n'));",
];

describe('the reads guard in a real vitest run', () => {
  it('fails a run whose test reads repository files it found by walking a folder, naming each read', () => {
    const run = runGuardedVitest({ 'walks.test.mjs': WALKS_DATA });

    expect(run.status, run.output).not.toBe(0);
    expect(run.output).toContain('walks.test.mjs reads 2 files it does not link: data/a.txt, data/b.txt');
    expect(run.output).toContain('import.meta.glob');
  }, 120_000);

  it('passes the same run once the test links the folder it walks', () => {
    const run = runGuardedVitest({ 'walks.test.mjs': ["import.meta.glob('/data/*.txt');", ...WALKS_DATA] });

    expect(run.status, run.output).toBe(0);
  }, 120_000);

  it('leaves out reads of ignored and outside files, of files whose change reruns every test, and by the code under test', () => {
    const run = runGuardedVitest({
      'reader.mjs': [
        "import { readFileSync } from 'node:fs';",
        "export const readData = () => readFileSync('data/a.txt', 'utf8');",
      ],
      'others.test.mjs': [
        "import { it, expect } from 'vitest';",
        "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { readData } from './reader.mjs';",
        "it('reads', () => {",
        "  mkdirSync('out', { recursive: true });",
        "  writeFileSync('out/x.txt', 'x');",
        `  const outside = readFileSync(${JSON.stringify(join(PROJECT_ROOT, 'package.json'))}, 'utf8');`,
        "  expect(readFileSync('out/x.txt', 'utf8') + readData()).toBe('xa\\n');",
        "  expect(outside).toContain('boardsmith');",
        "  expect(readFileSync('package.json', 'utf8')).toContain('private');",
        '});',
      ],
    });

    expect(run.status, run.output).toBe(0);
  }, 120_000);
});
