/**
 * `boardsmith dev` STOPPED WHILE VITE IS STILL OPTIMISING ITS DEPENDENCIES (#366).
 *
 * The first page a fresh project serves starts Vite's dependency optimiser, and
 * the page's own imports are pre-transformed against it. Vite's `close()` shuts
 * the optimiser down and then waits for every transform in flight, and a
 * transform of an optimised dependency waits for the optimiser run that
 * `close()` has just abandoned. So a quick "start, look, Ctrl+C" printed
 * `Shutting down...` and then never finished: the process either hung until it
 * was killed, or ran out of work and exited with the build directory still on
 * disk, because the teardown never got past Vite.
 *
 * Both roads are spawned through the real CLI in a real `boardsmith init`
 * project, because what is under test is that the PROCESS finishes its own
 * teardown and ends, which no in-process call can observe.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, EXIT_WITHIN_MS, spawnDev, type DevRunEnding } from './dev-project.test-helper.js';
import { freePort } from './free-port.test-helper.js';
import { worldStorePath } from '../dev-host/world-store.js';

// Each run bundles the project's rules and starts Vite, which under full-suite
// parallelism can take a while. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

/**
 * Start `boardsmith dev` in `cwd`, open its first page the way a browser does,
 * and press Ctrl+C the moment the page's module has been served.
 *
 * The page's module imports Vue, which Vite pre-bundles, so the optimiser's
 * first run is in flight when the signal arrives: it cannot have committed
 * before its crawl of the page's static imports has been idle for a while.
 */
async function stopWhileOptimising(cwd: string): Promise<DevRunEnding> {
  const port = await freePort();
  const run = spawnDev(cwd, port);
  const ready = new Promise<boolean>((resolve) => {
    run.child.stdout.on('data', () => {
      if (run.output().includes('Ready!')) resolve(true);
    });
    run.child.on('exit', () => resolve(false));
  });
  if (!(await ready)) return run.ended;

  const base = `http://127.0.0.1:${port}`;
  const page = await (await fetch(`${base}/`)).text();
  const entry = [...page.matchAll(/<script type="module" src="([^"]+)"/g)].at(-1)?.[1];
  expect(entry, `the dev chrome has no module script:\n${page}`).toBeDefined();
  const module = await (await fetch(`${base}${entry}`)).text();
  // The page really does start the optimiser: its module imports a
  // pre-bundled dependency.
  expect(module).toContain('/node_modules/.vite/deps/');
  run.child.kill('SIGINT');
  return run.ended;
}

/** Stop a fresh project's first run mid-optimisation, and assert it stopped whole. */
async function expectStoppedWhole(cwd: string): Promise<void> {
  const run = await stopWhileOptimising(cwd);
  expect(run.stuck, `boardsmith dev was still running ${EXIT_WITHIN_MS}ms after it started:\n${run.output}`).toBe(false);
  expect(run.output).toContain('Shutting down...');
  expect(run.output, 'the teardown reported something it could not close').not.toContain('Still open');
  expect(run.code, run.output).toBe(0);
  // The build directory is the teardown's last step, so it is gone only if
  // everything before it, Vite included, finished closing.
  expect(existsSync(join(cwd, '.boardsmith')), `the teardown never finished:\n${run.output}`).toBe(false);
}

describe('boardsmith dev stopped while Vite optimises its dependencies (#366)', () => {
  it('a world project: closes the world and Vite, removes its build directory, and exits', async () => {
    const cwd = await devProject(true);
    await expectStoppedWhole(cwd);
    // The store is in WAL mode, and SQLite folds the log back into the
    // database and removes it when the last connection closes.
    expect(existsSync(worldStorePath(cwd)), 'the world was never opened').toBe(true);
    expect(existsSync(`${worldStorePath(cwd)}-wal`), 'the world store was left open').toBe(false);
  });

  it('a table project: closes Vite, removes its build directory, and exits', async () => {
    await expectStoppedWhole(await devProject(false));
  });
});
