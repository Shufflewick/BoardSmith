/**
 * #236: A TEST CANNOT MAKE A TEMP TREE IT DOES NOT ALSO REMOVE.
 *
 * `scripts/ingest-harness/check.test.mjs` copied a fixture tree into the temp
 * root twice per case and removed neither, so an ordinary `npx vitest run` left
 * eight directories behind for good -- 848 of them measured on one machine, and
 * their real cost was hiding #231's leaked world until they were filtered out by
 * hand. Forty-four other files did the same thing correctly. That ratio is the
 * argument: the removal was 46 separate obligations to remember, and two of them
 * had been forgotten in one file.
 *
 * So `temp-tree.test-helper.ts` owns the lifetime, exactly as
 * `browser-harness.mjs` came to own the fixture world's in #231, and this holds
 * two claims about that:
 *
 *   1. The owner actually removes what it made. Proved by running the #236
 *      reproduction (`temp-tree.probe.test.ts`) in a child Vitest process and
 *      looking for the tree afterwards, because no file can observe its own
 *      `afterAll`.
 *   2. No test file can opt back out. The list of test files is derived from
 *      Vitest's own `include` globs rather than written down, so a file added
 *      tomorrow is held to this without anyone remembering to add it.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROBE_MARKER } from './temp-tree.probe.test.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** This file, the probe and the owner: the three that talk about `mkdtemp`. */
const OWN_FILES = [
  'src/testing/temp-tree.test-helper.test.ts',
  'src/testing/temp-tree.probe.test.ts',
];

/** The roots and suffixes of `vitest.config.ts`'s `include`, read from it. */
const includeGlobs = (): { root: string; suffix: string }[] => {
  const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf-8');
  const block = config.slice(config.indexOf('include: ['), config.indexOf(']', config.indexOf('include: [')));
  const globs = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (globs.length === 0) {
    throw new Error(
      "no include globs found in vitest.config.ts. The `include: [...]` array moved or changed "
      + 'quoting, and this gate went quiet rather than failing.',
    );
  }
  return globs.map((glob) => {
    const [root, suffix] = glob.split('/**/*');
    return { root, suffix };
  });
};

const walk = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
};

/** Every file Vitest would collect, found rather than listed. */
const testFiles = (): string[] =>
  includeGlobs()
    .flatMap(({ root, suffix }) => walk(join(REPO, root)).filter((f) => f.endsWith(suffix)))
    .map((f) => relative(REPO, f))
    .filter((f) => !OWN_FILES.includes(f))
    .sort();

const read = (file: string) => readFileSync(join(REPO, file), 'utf-8');

/** Only the files that need a temp tree, so the per-file assertion stays readable. */
const filesUsingTempTrees = () =>
  testFiles().filter((file) => /mkdtemp|tempTree/.test(read(file)));

describe('#236: the temp tree has one owner', () => {
  it('removes the tree a bare test body made', () => {
    // The probe is the #236 shape: a tree made in a test body, in a file with
    // no cleanup of its own. Its removal happens after its last test, so the
    // only place the result is observable is outside the process.
    const output = execFileSync(
      'npx',
      ['vitest', 'run', 'src/testing/temp-tree.probe.test.ts'],
      { cwd: REPO, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const marked = output.split('\n').find((line) => line.includes(PROBE_MARKER));
    expect(
      marked,
      `the probe run printed no "${PROBE_MARKER}" line, so it did not reach its `
      + `assertion and this test proved nothing. Its output was:\n${output}`,
    ).toBeDefined();

    const tree = (marked as string).slice((marked as string).indexOf(PROBE_MARKER) + PROBE_MARKER.length).trim();
    expect(tree).toContain('bs-temp-tree-probe-');
    expect(
      existsSync(tree),
      `${tree} outlived the run that made it. tempTree() recorded it but the `
      + 'afterAll in temp-tree.test-helper.ts did not remove it, which is #236 '
      + 'reopened.',
    ).toBe(false);
  });

  it('finds the test files to check', () => {
    // A derived list. If this ever reads implausibly low, the include globs or
    // the walk changed and every assertion below went quiet.
    expect(testFiles().length).toBeGreaterThanOrEqual(400);
    expect(filesUsingTempTrees().length).toBeGreaterThanOrEqual(40);
  });

  it.each(filesUsingTempTrees())('%s makes its temp trees through tempTree()', (file) => {
    expect(
      read(file),
      `${file} must get its temp directory from tempTree() in `
      + 'src/testing/temp-tree.test-helper.ts, which removes it when the file '
      + 'finishes. A hand-rolled mkdtemp makes the removal this file\'s job to '
      + 'remember, and that is what #236 was: two of 46 files had forgotten.',
    ).not.toMatch(/\bmkdtemp(Sync)?\s*\(/);
  });

  it.each(filesUsingTempTrees())('%s does not remove a temp tree itself', (file) => {
    // Removing subpaths INSIDE a tree is ordinary test work -- a test proving
    // what happens when a file is missing has to delete the file. Removing the
    // tree ITSELF is the thing that was 46 separate obligations, and leaving a
    // stale one behind is how a file ends up half-owning its own lifetime: the
    // hand-written removal is what a reader would then trust, and it is the
    // half that gets forgotten. Those are told apart by what is being removed,
    // so only a bare `rm(tree)` fails here; `rm(join(tree, 'x'))` does not.
    const source = read(file);
    const trees = [...source.matchAll(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*tempTree\(/g)]
      .map((m) => m[1]);
    expect(trees.length, `${file} calls tempTree() without naming the result`).toBeGreaterThan(0);
    for (const tree of new Set(trees)) {
      expect(
        source,
        `${file} removes ${tree} itself. tempTree() already owns it; a second `
        + 'removal is the half-ownership #236 was made of.',
      ).not.toMatch(new RegExp(String.raw`\brm(Sync|dir)?\(\s*${tree}\s*[,)]`));
    }
  });

  it('runs each test file in its own module registry', () => {
    // The owner registers one afterAll when it is first imported, which binds
    // it to the importing test file. Sharing the module across files would
    // register that hook for the first importer only, and every later file's
    // trees would go unowned in silence.
    expect(
      readFileSync(join(REPO, 'vitest.config.ts'), 'utf-8'),
      'temp-tree.test-helper.ts owns a temp tree per test FILE, which relies on '
      + "Vitest's default per-file module registry. Turning isolation off would "
      + 'leave every file after the first one leaking again.',
    ).not.toMatch(/isolate:\s*false/);
  });
});
