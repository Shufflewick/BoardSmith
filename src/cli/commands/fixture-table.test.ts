/**
 * #703: THE BROWSER REGRESSIONS' TABLE FIXTURE STARTS, SERVES AND STOPS.
 *
 * `withFixtureTable` serves `boardsmith init`'s table sample through a spawned
 * `boardsmith dev --no-open` for `scripts/*-browser.mjs`, which need a browser
 * and so run only under `boardsmith test --browser`. This runs the lifetime in
 * the ordinary suite with no browser: the host answers while the body runs,
 * and afterwards it no longer answers and the project is gone -- also when the
 * process running it is sent SIGTERM, which is how the browser suite's hang
 * guard stops a script.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { withFixtureTable } from './fixture-table.test-helper.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';

/** A hang guard for one case, not a budget. */
const CASE_GUARD_MS = 240_000;

/** How long a stopped fixture's processes get to end. A hang guard, not a budget. */
const EXIT_GUARD_MS = 30_000;

/** Every process descended from `root`, by parent pid. */
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout;
  const rows = table.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const found: number[] = [];
  for (let frontier = [root]; frontier.length > 0; ) {
    frontier = rows.filter(([, ppid]) => frontier.includes(ppid)).map(([pid]) => pid);
    found.push(...frontier);
  }
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The pids in `pids` still running once all have ended or the guard has passed. Vite's esbuild
 * service, a child of `boardsmith dev`, exits by itself only once its parent's pipe closes, a
 * moment after dev has, so it is waited for rather than read at one instant.
 */
async function stillAlive(pids: number[]): Promise<number[]> {
  const guard = Date.now() + EXIT_GUARD_MS;
  while (pids.some(alive) && Date.now() < guard) await new Promise((settle) => setTimeout(settle, 100));
  return pids.filter(alive);
}

/** A process that serves the fixture, prints its directory, and waits until it is stopped. */
const SERVE_UNTIL_STOPPED = `
const { withFixtureTable } = await import(${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'src/cli/commands/fixture-table.test-helper.ts')).href)});
await withFixtureTable(async ({ fixture }) => {
  console.log('SERVING ' + fixture);
  await new Promise(() => {});
});
`;

describe('withFixtureTable (#703)', () => {
  it('serves the table sample through boardsmith dev, then stops it and removes the project', async () => {
    const seen = await withFixtureTable(async ({ hostUrl, fixture }) => ({
      hostUrl,
      fixture,
      status: (await fetch(hostUrl)).status,
    }));
    expect(seen.status).toBe(200);
    await expect(fetch(seen.hostUrl), 'the dev host outlived its fixture').rejects.toThrow();
    expect(existsSync(seen.fixture), 'the fixture outlived its host').toBe(false);
  }, CASE_GUARD_MS);

  it('writes the files it is given over the sample before it serves it (#1318)', async () => {
    const files = { 'src/ui/components/Edges.vue': '<template><div /></template>\n' };
    const written = await withFixtureTable(async ({ fixture }) => Object.keys(files).map((path) => readFileSync(join(fixture, path), 'utf8')), files);
    expect(written).toEqual(Object.values(files));
  }, CASE_GUARD_MS);

  it('stops boardsmith dev and removes the project when its process is sent SIGTERM', async () => {
    const run = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', SERVE_UNTIL_STOPPED], { cwd: REPO_ROOT });
    let output = '';
    run.stderr.on('data', (chunk) => (output += chunk));
    const fixture = await new Promise<string>((resolve, reject) => {
      run.stdout.on('data', (chunk) => {
        output += chunk;
        const serving = /SERVING (\S+)/.exec(output);
        if (serving) resolve(serving[1]);
      });
      run.on('exit', () => reject(new Error(`the fixture process stopped before it served:\n${output}`)));
    });
    const started = descendants(run.pid!);
    expect(started.length, 'the fixture process started no boardsmith dev').toBeGreaterThan(0);

    const exited = once(run, 'exit');
    run.kill('SIGTERM');
    await exited;

    expect(await stillAlive(started), 'a process the fixture started outlived it').toEqual([]);
    expect(existsSync(fixture), 'the fixture outlived its process').toBe(false);
  }, CASE_GUARD_MS);
});
