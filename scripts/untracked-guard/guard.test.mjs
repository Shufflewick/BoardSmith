/**
 * The suite fails when a test leaves a file in the checkout that git neither
 * tracks nor ignores (#579).
 *
 * The unit tests below pin what counts as such a file. The last block runs a
 * real vitest, with this repo's `vitest.config.ts` wiring copied into a temp
 * git repo, because the guard is only worth anything if a run that strays
 * actually goes red and says where.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../src/testing/temp-tree.test-helper.ts';
import { newStrays, strayMessage, untrackedUnignored } from './guard.mjs';

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const GUARD_DIR = join(PROJECT_ROOT, 'scripts', 'untracked-guard');

/**
 * A temp git repo with one tracked file and `.gitignore` ignoring `out/` and `*.log`. It has a
 * `package.json`, as this repo does, so vitest keeps its own cache in the ignored `node_modules/`.
 */
function gitRepo() {
  const root = tempTree('bs-untracked-guard-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), 'out/\n*.log\nnode_modules\n');
  writeFileSync(join(root, 'package.json'), '{ "private": true }\n');
  writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
  execFileSync('git', ['add', '.gitignore', 'package.json', 'tracked.txt'], { cwd: root });
  return root;
}

describe('untrackedUnignored', () => {
  it('lists an untracked file, including one in a new directory, and no tracked or ignored file', () => {
    const root = gitRepo();
    mkdirSync(join(root, 'new', 'deep'), { recursive: true });
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'new', 'deep', 'a.txt'), 'a');
    writeFileSync(join(root, 'out', 'build.js'), 'b');
    writeFileSync(join(root, 'run.log'), 'c');
    writeFileSync(join(root, 'tracked.txt'), 'changed\n');

    expect(untrackedUnignored(root)).toEqual(['new/deep/a.txt']);
  });

  it('names a path with non-ASCII characters as written', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'café.txt'), 'x');
    expect(untrackedUnignored(root)).toEqual(['café.txt']);
  });
});

describe('newStrays', () => {
  it('leaves out files that were already untracked when the run started', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'mine.txt'), 'the developer was already working on this');
    const baseline = untrackedUnignored(root);
    writeFileSync(join(root, 'stray.txt'), 'a test wrote this');

    expect(newStrays(root, baseline)).toEqual(['stray.txt']);
  });
});

describe('strayMessage', () => {
  it('names each file, the test file it was first seen after, and what to do', () => {
    const message = strayMessage([
      { path: 'src/ui/__probe__/probe.vue', file: '/repo/scripts/check.test.mjs' },
      { path: 'left.txt', file: undefined },
    ], '/repo');

    expect(message).toContain('src/ui/__probe__/probe.vue (first seen when scripts/check.test.mjs finished)');
    expect(message).toContain('left.txt (found when the run ended)');
    expect(message).toMatch(/tempTree/);
    expect(message).toMatch(/\.gitignore/);
  });
});

/**
 * Runs this repo's vitest in `root`, wired to the guard the way `vitest.config.ts` wires it.
 * `settings` are added to the run's `test` config, such as a worker count.
 */
function runGuardedVitest(root, testFiles, settings = {}) {
  symlinkSync(join(PROJECT_ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { include: ['*.test.mjs'], ` +
      `globalSetup: [${JSON.stringify(join(GUARD_DIR, 'global-setup.mjs'))}], ` +
      `setupFiles: [${JSON.stringify(join(GUARD_DIR, 'after-each-file.mjs'))}], ` +
      `...${JSON.stringify(settings)} } };\n`,
  );
  for (const [name, body] of Object.entries(testFiles)) writeFileSync(join(root, name), body);
  execFileSync('git', ['add', 'vitest.config.mjs', ...Object.keys(testFiles)], { cwd: root });
  return spawnSync(process.execPath, [join(PROJECT_ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('the guard in a real vitest run', () => {
  it('fails a run whose test leaves an untracked file, naming the file and the test file', () => {
    const root = gitRepo();
    const run = runGuardedVitest(root, {
      'strays.test.mjs': [
        "import { it } from 'vitest';",
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "it('writes into the checkout', () => {",
        "  mkdirSync('probe', { recursive: true });",
        "  writeFileSync('probe/left.vue', 'x');",
        '});',
      ].join('\n'),
    });
    const output = run.stdout + run.stderr;

    expect(run.status).not.toBe(0);
    expect(output).toContain('probe/left.vue (first seen when strays.test.mjs finished)');
  }, 120_000);

  it('passes a run whose test writes only to ignored paths, or cleans up what it wrote', () => {
    // One test file only: with a second file running beside it, that file's guard could see
    // scratch.txt before this file's afterAll removes it, and the run rightly fails (#611).
    const root = gitRepo();
    const run = runGuardedVitest(root, {
      'tidy.test.mjs': [
        "import { afterAll, it } from 'vitest';",
        "import { mkdirSync, rmSync, writeFileSync } from 'node:fs';",
        "afterAll(() => rmSync('scratch.txt'));",
        "it('writes build output', () => {",
        "  mkdirSync('out', { recursive: true });",
        "  writeFileSync('out/bundle.js', 'x');",
        "  writeFileSync('debug.log', 'x');",
        '});',
        "it('writes a file its own afterAll removes', () => writeFileSync('scratch.txt', 'x'));",
      ].join('\n'),
    });

    expect(run.stdout + run.stderr).not.toContain('git neither tracks nor ignores');
    expect(run.status, run.stdout + run.stderr).toBe(0);
  }, 120_000);

  it('names the test file that saw a file another test file had not yet removed', () => {
    // Forces the interleaving: lingers.test.mjs keeps scratch.txt until the guard has logged it
    // after brief.test.mjs, so the sighting is certain rather than down to timing. Each waits on
    // the other, so the run needs two workers whatever the machine's CPU count, and each inner
    // test gets a timeout long enough for a loaded machine.
    const root = gitRepo();
    const run = runGuardedVitest(root, {
      'brief.test.mjs': [
        "import { it } from 'vitest';",
        "import { existsSync } from 'node:fs';",
        "it('finishes once scratch.txt exists', async () => {",
        "  while (!existsSync('scratch.txt')) await new Promise((r) => setTimeout(r, 10));",
        '}, 60_000);',
      ].join('\n'),
      'lingers.test.mjs': [
        "import { afterAll, inject, it } from 'vitest';",
        "import { readFileSync, rmSync, writeFileSync } from 'node:fs';",
        "afterAll(() => rmSync('scratch.txt'));",
        "it('keeps scratch.txt until the guard has seen it', async () => {",
        "  writeFileSync('scratch.txt', 'x');",
        "  const { log } = inject('untrackedGuard');",
        "  while (!readFileSync(log, 'utf8').includes('scratch.txt')) await new Promise((r) => setTimeout(r, 10));",
        '}, 60_000);',
      ].join('\n'),
    }, { minWorkers: 2, maxWorkers: 2 });
    const output = run.stdout + run.stderr;

    expect(run.status, output).not.toBe(0);
    expect(output).toContain('scratch.txt (first seen when brief.test.mjs finished)');
  }, 120_000);

  it('passes a run in a checkout that already had untracked files before it started', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'work-in-progress.txt'), 'the developer was already working on this');
    const run = runGuardedVitest(root, {
      'quiet.test.mjs': "import { it, expect } from 'vitest';\nit('does nothing', () => expect(1).toBe(1));\n",
    });

    expect(run.status, run.stdout + run.stderr).toBe(0);
  }, 120_000);
});
