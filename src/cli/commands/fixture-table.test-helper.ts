/**
 * A THROWAWAY TABLE GAME, SERVED BY `boardsmith dev --no-open`, AND GONE
 * AFTERWARDS -- the ordinary-game fixture a browser regression in
 * `scripts/*-browser.mjs` asks for with `table: true` (#703), through
 * `runBrowserRegression` in `scripts/browser-harness.mjs`.
 *
 * The world fixture (`fixture-world.test-helper.ts`) serves a hand-written
 * project in-process. The table road is `boardsmith init`'s own sample run by
 * the real CLI, because the join lobby, Table setup and the GameShell iframe
 * are what an author's project gets, and a hand-written copy would drift.
 *
 * `withFixtureTable` is the only export, for the same reason as the world's
 * (#231): the host must be stopped before its project is removed.
 *
 * @module
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { collectOutput } from '../lib/child-output.js';
import { freePort } from '../lib/free-port.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';

const CLI = join(REPO_ROOT, 'bin', 'boardsmith.js');

/** How long `boardsmith dev` gets to say it is ready, and to stop once asked. Hang guards, not budgets. */
const READY_WITHIN_MS = 180_000;
const STOP_WITHIN_MS = 15_000;

/** What a fixture's body is handed while its host is serving. */
interface ServedTable {
  /** Where the dev host is served. */
  readonly hostUrl: string;
  /** The project directory. */
  readonly fixture: string;
}

/** Scaffold `boardsmith init`'s table sample in `parent` and install it the way a real game is. */
function writeTableFixture(parent: string): string {
  const init = spawnSync(process.execPath, [CLI, 'init', 'table-fixture', '--without-rulebook'], {
    cwd: parent,
    encoding: 'utf8',
  });
  if (init.status !== 0) throw new Error(`boardsmith init failed:\n${init.stdout}${init.stderr}`);
  const dir = join(parent, 'table-fixture');
  linkGameModules(dir);
  return dir;
}

/** Resolve once `dev` prints that it is ready; reject, with what it said, if it exits or hangs first. */
function readyOrThrow(dev: ChildProcess, output: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (why: string) => reject(new Error(`boardsmith dev ${why}:\n${output()}`));
    const guard = setTimeout(() => fail('did not say it was ready'), READY_WITHIN_MS);
    dev.stdout?.on('data', () => {
      if (!output().includes('Ready!')) return;
      clearTimeout(guard);
      resolve();
    });
    dev.on('exit', () => {
      clearTimeout(guard);
      fail('stopped before it was ready');
    });
  });
}

/** Stop `dev` by its own pid, the orderly way (SIGINT), killing it only if it does not go. */
async function stopDev(dev: ChildProcess): Promise<void> {
  if (dev.exitCode !== null || dev.signalCode !== null) return;
  const exited = once(dev, 'exit');
  dev.kill('SIGINT');
  const killer = setTimeout(() => dev.kill('SIGKILL'), STOP_WITHIN_MS);
  await exited;
  clearTimeout(killer);
}

/**
 * A TABLE GAME, SERVED, AND GONE AFTERWARDS -- IN THAT ORDER (#231).
 *
 * The host is stopped in the inner guard and the project removed in the outer
 * one, so a body that throws is cleaned up exactly like one that passes.
 *
 * @param body called with the served fixture; its return value is passed on
 */
export async function withFixtureTable<T>(body: (served: ServedTable) => Promise<T>): Promise<T> {
  // `realpathSync`: on macOS the temp root is a symlink, and Vite resolves the project by its real path.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'bs-table-fixture-')));
  try {
    const fixture = writeTableFixture(parent);
    const port = await freePort();
    const dev = spawn(process.execPath, [CLI, 'dev', '--port', String(port), '--no-open'], {
      cwd: fixture,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    try {
      await readyOrThrow(dev, collectOutput(dev));
      return await body({ hostUrl: `http://127.0.0.1:${port}/`, fixture });
    } finally {
      await stopDev(dev);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
