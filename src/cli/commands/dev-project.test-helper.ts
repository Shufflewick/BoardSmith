/**
 * A GAME PROJECT THAT `boardsmith dev` CAN REALLY RUN, for the suites that
 * spawn the CLI against one (#345, #366).
 *
 * It is scaffolded by `boardsmith init` and installed the way a real game is,
 * so what a spawned `boardsmith dev` serves is what an author's own project
 * serves: the standalone road, resolving the library through its package
 * exports.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { vi } from 'vitest';

import { initCommand } from './init.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

/**
 * Scaffold a table project, or a world project when `world` is true, in a temp
 * tree the test file removes when it ends.
 *
 * @returns the project directory
 */
export async function devProject(world: boolean): Promise<string> {
  const parent = tempTree('bs-dev-project-');
  const cwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(parent);
  try {
    await initCommand('dev-game', { withoutRulebook: true, world });
  } finally {
    process.chdir(cwd);
    log.mockRestore();
  }
  const dir = join(parent, 'dev-game');
  // `"boardsmith": "file:..."` installs as a symlink to the checkout, and the
  // project's own vite.config.ts needs its build-time packages beside it.
  mkdirSync(join(dir, 'node_modules', '@vitejs'), { recursive: true });
  symlinkSync(REPO_ROOT, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const name of ['vue', 'vite', '@vitejs/plugin-vue']) {
    symlinkSync(join(INSTALLED_MODULES, name), join(dir, 'node_modules', name), 'dir');
  }
  return dir;
}

/** How long a run gets to end by itself, once it should, before it counts as stuck. A hang guard, not a budget. */
export const EXIT_WITHIN_MS = 60_000;

/** How a spawned `boardsmith dev` ended, or that it did not. */
export interface DevRunEnding {
  readonly code: number | null;
  readonly output: string;
  readonly stuck: boolean;
}

/** A spawned `boardsmith dev`. */
interface DevRun {
  readonly child: ChildProcessWithoutNullStreams;
  /** Everything it has printed so far, stdout and stderr together. */
  output(): string;
  /** How it ended. A run still going `EXIT_WITHIN_MS` after it was spawned is killed and reported stuck. */
  readonly ended: Promise<DevRunEnding>;
}

/** Spawn the real `boardsmith dev` in `cwd` on `port`, without opening a browser. */
export function spawnDev(cwd: string, port: number): DevRun {
  const child = spawn(
    process.execPath,
    [join(REPO_ROOT, 'bin', 'boardsmith.js'), 'dev', '--port', String(port), '--no-open'],
    { cwd },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const ended = new Promise<DevRunEnding>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, output, stuck: true });
    }, EXIT_WITHIN_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output, stuck: false });
    });
  });
  return { child, output: () => output, ended };
}
