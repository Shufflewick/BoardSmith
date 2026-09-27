/**
 * The environment a test runs a fixture program in, so that program can write
 * only inside its own temp tree (#430).
 *
 * A stub that writes to a path it is handed (an argument, an environment
 * variable) will one day be handed the wrong one. In #430 the merge-branch
 * fixture's fake `boardsmith test` wrote its planted verdict to
 * `argv[indexOf('--verdict-file') + 1]`, the flag was missing, so the target
 * was `argv[0]`: the machine's real `node`, which every agent on it then lost.
 * A check inside each stub is one more thing each author has to remember. This
 * makes the write impossible instead:
 *
 * - Node's permission model, through `NODE_OPTIONS`, lets every node process
 *   the fixture starts read anywhere but write only under the tree. A write
 *   anywhere else throws `ERR_ACCESS_DENIED`, so the stub fails loudly.
 * - `HOME` and `TMPDIR` are inside the tree, so a program that writes to its
 *   home or temp directory, node or not, writes there.
 * - `PATH` is the tree's own `bin/` followed by `/usr/bin:/bin`. The tools a
 *   fixture names (and always `node`) get a small wrapper script in `bin/`
 *   that execs the real one. A wrapper, not a symlink: a write to a symlink's
 *   path lands on the binary it points at.
 *
 * `scripts/fixture-writes-sandboxed.test.mjs` fails on a test whose fixture
 * program writes to a path it is handed and that does not use this.
 *
 * Use: `const sandbox = fixtureSandbox('bs-merge-branch-', { tools: ['git'] })`,
 * build the fixture under `sandbox.root`, and pass `sandbox.env` (plus any
 * variables the test adds) to every process that runs it.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from './temp-tree.test-helper.js';

interface FixtureSandbox {
  /** The tree the fixture lives in and the only place its programs may write. Removed with the test file. */
  root: string;
  /** The environment to run the fixture's programs with. */
  env: NodeJS.ProcessEnv;
}

/** A shell word that is exactly `value`. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Where `tool` resolves on this process's PATH. */
function resolveTool(tool: string): string {
  const found = spawnSync('sh', ['-c', 'command -v "$1"', 'sh', tool], { encoding: 'utf8' });
  const path = found.stdout.trim();
  if (found.status !== 0 || !path.startsWith('/')) {
    throw new Error(`${tool} is not on PATH, and this fixture runs it. Install ${tool}, then run the test again.`);
  }
  return path;
}

export function fixtureSandbox(prefix: string, options: { tools?: string[] } = {}): FixtureSandbox {
  // The real path: the permission model compares resolved paths, and the temp
  // root is a symlink on macOS (/var -> /private/var).
  const root = realpathSync(tempTree(prefix));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const tmp = join(root, 'tmp');
  for (const dir of [bin, home, tmp]) mkdirSync(dir);

  const targets: Record<string, string> = { node: process.execPath };
  for (const tool of options.tools ?? []) targets[tool] = resolveTool(tool);
  for (const [tool, target] of Object.entries(targets)) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec ${shellQuote(target)} "$@"\n`, { mode: 0o755 });
  }

  return {
    root,
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: tmp,
      PATH: `${bin}:/usr/bin:/bin`,
      NODE_OPTIONS: `--permission --allow-fs-read=* --allow-fs-write=${root}`,
    },
  };
}
