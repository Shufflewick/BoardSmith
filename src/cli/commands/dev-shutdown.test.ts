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
import { openWorldStore, worldStorePath } from '../dev-host/world-store.js';
import { worldBudgets } from '../../world/index.js';

// Each run bundles the project's rules and starts Vite, which under full-suite
// parallelism can take a while. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

/**
 * Start `boardsmith dev` in `cwd`, open its first page the way a browser does,
 * and send `signal` (Ctrl+C is SIGINT) the moment the page's module has been
 * served.
 *
 * The page's module imports Vue, which Vite pre-bundles, so the optimiser's
 * first run is in flight when the signal arrives: it cannot have committed
 * before its crawl of the page's static imports has been idle for a while.
 */
async function stopWhileOptimising(cwd: string, signal: NodeJS.Signals): Promise<DevRunEnding> {
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
  run.child.kill(signal);
  return run.ended;
}

/** Stop a fresh project's first run mid-optimisation, and assert it stopped whole. */
async function expectStoppedWhole(cwd: string, signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
  const run = await stopWhileOptimising(cwd, signal);
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

/**
 * #382: SIGTERM IS THE SAME ORDERLY STOP.
 *
 * Vite registers its own SIGTERM handler when it owns the HTTP server, and
 * that handler closes Vite and exits the process. It used to win the race
 * against the host's teardown, so a SIGTERM ended `boardsmith dev` with the
 * rest of the teardown never run. Now the host owns the HTTP server and Vite
 * runs in middleware mode, where it registers no process handlers at all.
 */
describe('boardsmith dev stopped with SIGTERM (#382)', () => {
  it('a world project: runs the whole teardown before it exits', async () => {
    const cwd = await devProject(true);
    await expectStoppedWhole(cwd, 'SIGTERM');
    expect(existsSync(`${worldStorePath(cwd)}-wal`), 'the world store was left open').toBe(false);
  });

  it('a table project: runs the whole teardown before it exits', async () => {
    await expectStoppedWhole(await devProject(false), 'SIGTERM');
  });
});

/**
 * #386: A STOP DURING STARTUP IS THE SAME ORDERLY STOP.
 *
 * The shutdown used to be installed only once the host was ready, so a Ctrl+C
 * while the rules were still bundling, the world store was open or Vite was
 * starting got Node's default: the process died at once, leaving the build
 * directory on disk and an opened world store unclosed. Each run below is
 * stopped the moment it prints the line that says which stage it is in.
 */
async function stopDuringStartup(cwd: string, stage: string): Promise<void> {
  const run = spawnDev(cwd, await freePort());
  const reached = await new Promise<boolean>((resolve) => {
    run.child.stdout.on('data', () => {
      if (run.output().includes(stage)) resolve(true);
    });
    run.child.on('exit', () => resolve(false));
  });
  expect(reached, `boardsmith dev ended before it printed "${stage}":\n${run.output()}`).toBe(true);
  run.child.kill('SIGINT');
  const ended = await run.ended;
  expect(ended.stuck, `boardsmith dev was still running ${EXIT_WITHIN_MS}ms after it started:\n${ended.output}`).toBe(false);
  expect(ended.output, 'the stop came after startup, so it tested nothing').not.toContain('Ready!');
  expect(ended.output).toContain('Shutting down...');
  expect(ended.output, 'the teardown reported something it could not close').not.toContain('Still open');
  expect(ended.code, ended.output).toBe(0);
  expect(existsSync(join(cwd, '.boardsmith')), `the build directory was left behind:\n${ended.output}`).toBe(false);
}

/** The world a stopped run leaves behind: closed cleanly, and opened again without complaint. */
function expectWorldOpenable(cwd: string): void {
  expect(existsSync(`${worldStorePath(cwd)}-wal`), 'the world store was left open').toBe(false);
  const store = openWorldStore(worldStorePath(cwd), worldBudgets());
  try {
    expect(store.isLaunched(), 'the world was opened but genesis never finished').toBe(true);
  } finally {
    store.close();
  }
}

describe('boardsmith dev stopped before it is ready (#386)', () => {
  it('a world project, while its rules are bundling', async () => {
    const cwd = await devProject(true);
    await stopDuringStartup(cwd, 'Loading game rules');
    expect(existsSync(`${worldStorePath(cwd)}-wal`), 'the world store was left open').toBe(false);
  });

  it('a world project, once its store is open and before Vite listens', async () => {
    const cwd = await devProject(true);
    await stopDuringStartup(cwd, 'Persistent world:');
    expectWorldOpenable(cwd);
  });

  it('a table project, while its rules are bundling', async () => {
    await stopDuringStartup(await devProject(false), 'Loading game rules');
  });

  it('a table project, once its rules are loaded and before Vite listens', async () => {
    await stopDuringStartup(await devProject(false), 'Loaded game:');
  });
});
