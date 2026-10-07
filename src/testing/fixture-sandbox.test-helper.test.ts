import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fixtureSandbox } from './fixture-sandbox.test-helper.js';
import { tempTree } from './temp-tree.test-helper.js';

/**
 * #430: a merge gate fixture's stub wrote its planted verdict over the
 * machine's real `node`, because it took its write target from an argument
 * that was missing (`argv[indexOf('--verdict-file') + 1]` is `argv[0]`, the
 * node binary). These prove a program run in a fixture sandbox cannot write
 * outside the sandbox's tree, whatever path it is handed.
 */

/**
 * A runnable copy of this process's node at `<dir>/bin/node`.
 *
 * An official build is one file, but a macOS build that links its libraries
 * through `@rpath` (Homebrew's: `@rpath/libnode.*.dylib`, found through
 * `@loader_path/../lib`) dies in dyld when copied alone (#542). Each `@rpath`
 * library is copied to the same place relative to the copy as it sits
 * relative to the real binary, so the copy resolves it the same way.
 */
function runnableNodeCopy(dir: string): string {
  const realNode = realpathSync(process.execPath);
  const copy = join(dir, 'bin', 'node');
  mkdirSync(dirname(copy));
  copyFileSync(realNode, copy, constants.COPYFILE_FICLONE);
  if (process.platform !== 'darwin') return copy;

  const otool = (flag: string) => {
    const run = spawnSync('otool', [flag, realNode], { encoding: 'utf8' });
    if (run.status !== 0) {
      const why = run.error?.message ?? run.stderr;
      throw new Error(`otool ${flag} ${realNode} failed: ${why}. Install the Xcode command line tools.`);
    }
    return run.stdout;
  };
  const rpaths = [...otool('-l').matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (\S+)/g)].map((m) => m[1]!);
  const libraries = [...otool('-L').matchAll(/^\s+@rpath\/(\S+)/gm)].map((m) => m[1]!);
  for (const library of libraries) {
    const rpath = rpaths.find((r) => existsSync(join(r.replace('@loader_path', dirname(realNode)), library)));
    if (!rpath) throw new Error(`${realNode} links @rpath/${library}, which none of its rpaths (${rpaths.join(', ')}) holds.`);
    const target = join(rpath.replace('@loader_path', dirname(copy)), library);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(rpath.replace('@loader_path', dirname(realNode)), library), target, constants.COPYFILE_FICLONE);
  }
  return copy;
}

/** A copy of node outside every sandbox, so the #430 reproduction can only ever damage a copy. */
const nodeCopyDir = tempTree('bs-sandbox-node-copy-');
const nodeCopy = runnableNodeCopy(nodeCopyDir);

function inside(root: string, path: string): boolean {
  const rel = relative(realpathSync(root), path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function runNode(node: string, env: NodeJS.ProcessEnv, source: string, args: string[] = []) {
  return spawnSync(node, ['--input-type=module', '-e', source, ...args], { encoding: 'utf8', env });
}

describe('fixtureSandbox (#430)', () => {
  it('gives a program a HOME and a TMPDIR inside its own tree, where it can write', () => {
    const sandbox = fixtureSandbox('bs-sandbox-');
    const run = runNode(
      process.execPath,
      sandbox.env,
      "import { writeFileSync } from 'node:fs'; import { homedir, tmpdir } from 'node:os';" +
        "writeFileSync(homedir() + '/h.txt', 'h'); writeFileSync(tmpdir() + '/t.txt', 't');" +
        'console.log(JSON.stringify([homedir(), tmpdir()]));',
    );
    expect(run.status, run.stderr).toBe(0);
    const [home, tmp] = JSON.parse(run.stdout) as [string, string];
    expect(inside(sandbox.root, realpathSync(home))).toBe(true);
    expect(inside(sandbox.root, realpathSync(tmp))).toBe(true);
    expect(readFileSync(join(home, 'h.txt'), 'utf8')).toBe('h');
  });

  it('refuses a write outside its tree and leaves the target untouched', () => {
    const sandbox = fixtureSandbox('bs-sandbox-');
    const canary = join(tempTree('bs-sandbox-canary-'), 'canary.txt');
    writeFileSync(canary, 'untouched');

    const run = runNode(
      process.execPath,
      sandbox.env,
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], 'overwritten');",
      [canary],
    );

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('ERR_ACCESS_DENIED');
    expect(readFileSync(canary, 'utf8')).toBe('untouched');
  });

  it('cannot write its own node binary, which is what the #430 stub did', () => {
    const sandbox = fixtureSandbox('bs-sandbox-');
    const before = readFileSync(nodeCopy);

    // The #430 stub as it was: no check that --verdict-file was passed.
    const run = runNode(
      nodeCopy,
      sandbox.env,
      "import { writeFileSync } from 'node:fs';" +
        "writeFileSync(process.argv[process.argv.indexOf('--verdict-file') + 1], 'Tests failed in 1 file:\\n');",
      ['test'],
    );

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('ERR_ACCESS_DENIED');
    expect(readFileSync(nodeCopy).equals(before)).toBe(true);
  });

  it('puts nothing writable on PATH outside its tree, and runs the real node through a wrapper, not a link', () => {
    const sandbox = fixtureSandbox('bs-sandbox-', { tools: ['git'] });
    for (const dir of sandbox.env.PATH!.split(':')) {
      if (inside(sandbox.root, realpathSync(dir))) continue;
      expect(() => accessSync(dir, constants.W_OK), `${dir} is on the sandbox PATH and writable`).toThrow();
    }
    for (const tool of ['node', 'git']) {
      const wrapper = join(sandbox.root, 'bin', tool);
      // A symlink would hand a write to the wrapper's path straight through to the real binary.
      expect(lstatSync(wrapper).isSymbolicLink()).toBe(false);
    }
    const run = spawnSync('sh', ['-c', 'command -v node && node -e "console.log(process.version)" && git --version'], {
      encoding: 'utf8',
      env: sandbox.env,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(join(sandbox.root, 'bin', 'node'));
    expect(run.stdout).toContain(process.version);
    expect(run.stdout).toContain('git version');
  });

  it('says which tool it could not find, rather than leaving it off PATH', () => {
    expect(() => fixtureSandbox('bs-sandbox-', { tools: ['no-such-tool-430'] })).toThrow(
      /no-such-tool-430 is not on PATH/,
    );
  });
});
