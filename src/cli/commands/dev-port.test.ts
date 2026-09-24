/**
 * `boardsmith dev` ON A PORT SOMETHING ELSE HOLDS (#345).
 *
 * A second `boardsmith dev` in a world project used to open the world store and
 * start the world before Vite tried the port, so a refused run had already
 * written to a world another process owns. It also never exited: Vite's refusal
 * reached the CLI's error handler with the Vite server it had built still
 * holding the process open. A table project hung the same way.
 *
 * Both roads are spawned through the real CLI in a real `boardsmith init`
 * project with the port already taken, because what is under test is that the
 * PROCESS ends, which no in-process call can observe. The last test takes the
 * world host's own listen failure in-process: that is the port being taken in
 * the moment after `devCommand` checked it.
 */
import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';

import { initCommand } from './init.js';
import { loadWorldRuntime, startWorldDevServer } from './dev-world.js';
import { worldStoreDir, worldStorePath } from '../dev-host/world-store.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

// Each run bundles the project's rules first, which under full-suite
// parallelism can exceed Vitest's default. A hang guard, not a budget.
vi.setConfig({ testTimeout: 90_000 });

/** How long a refused run gets to end by itself before it counts as stuck. */
const EXIT_WITHIN_MS = 60_000;

/** A port held open by this test, on the interface `boardsmith dev` binds by default. */
async function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    release: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A project scaffolded by `boardsmith init`, installed the way a real game is. */
async function project(world: boolean): Promise<string> {
  const parent = tempTree('bs-dev-port-');
  const cwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(parent);
  try {
    await initCommand('port-game', { withoutRulebook: true, world });
  } finally {
    process.chdir(cwd);
    log.mockRestore();
  }
  const dir = join(parent, 'port-game');
  // `"boardsmith": "file:..."` installs as a symlink to the checkout, and the
  // project's own vite.config.ts needs its build-time packages beside it.
  mkdirSync(join(dir, 'node_modules', '@vitejs'), { recursive: true });
  symlinkSync(REPO_ROOT, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const name of ['vue', 'vite', '@vitejs/plugin-vue']) {
    symlinkSync(join(INSTALLED_MODULES, name), join(dir, 'node_modules', name), 'dir');
  }
  return dir;
}

/** Run `boardsmith dev` and report how it ended, or that it did not. */
function runDev(cwd: string, port: number) {
  return new Promise<{ code: number | null; output: string; stuck: boolean }>((resolve) => {
    const child = spawn(
      process.execPath,
      [join(REPO_ROOT, 'bin', 'boardsmith.js'), 'dev', '--port', String(port), '--no-open'],
      { cwd },
    );
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, output, stuck: true });
    }, EXIT_WITHIN_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output, stuck: false });
    });
  });
}

/** Spawn `boardsmith dev` in `cwd` on a taken port, and assert the refusal. */
async function expectRefused(cwd: string): Promise<void> {
  const held = await holdPort();
  try {
    const run = await runDev(cwd, held.port);
    expect(run.stuck, `boardsmith dev was still running after ${EXIT_WITHIN_MS}ms:\n${run.output}`).toBe(false);
    expect(run.code).not.toBe(0);
    expect(run.output).toContain(`Port ${held.port} is already in use`);
    expect(run.output).toContain('--port <number>');
  } finally {
    await held.release();
  }
}

describe('boardsmith dev on a taken port (#345)', () => {
  it('a world project: refuses, exits, and never opens the world', async () => {
    const cwd = await project(true);
    await expectRefused(cwd);
    expect(existsSync(worldStoreDir(cwd)), 'the refused run opened the world store').toBe(false);
  });

  it('a table project: refuses and exits', async () => {
    await expectRefused(await project(false));
  });

  it('a world host whose own listen fails closes the world it opened', async () => {
    const cwd = await project(true);
    const tempDir = join(cwd, '.boardsmith');
    mkdirSync(tempDir, { recursive: true });
    const rulesPath = join(cwd, 'src', 'rules');
    const runtime = await loadWorldRuntime(rulesPath, tempDir, 'standalone');
    const held = await holdPort();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        startWorldDevServer({
          cwd,
          uiPath: cwd,
          runtime,
          displayName: 'Port Game',
          context: 'standalone',
          port: held.port,
          host: '127.0.0.1',
          tempDir,
          openBrowser: false,
          reloadRules: () => loadWorldRuntime(rulesPath, tempDir, 'standalone'),
        }),
      ).rejects.toThrow(`Port ${held.port} is already in use`);
    } finally {
      log.mockRestore();
      await held.release();
    }
    // The store is in WAL mode, and SQLite folds the log back into the database
    // and removes it when the last connection closes. A log left behind is a
    // store this process still holds.
    expect(existsSync(worldStorePath(cwd)), 'the world was never opened').toBe(true);
    expect(existsSync(`${worldStorePath(cwd)}-wal`), 'the world store was left open').toBe(false);
  });
});
