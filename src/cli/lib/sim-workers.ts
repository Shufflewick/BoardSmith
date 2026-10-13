/**
 * Where `boardsmith simulate` plays its games (#556): in this process, or on worker threads.
 *
 * Games are played in production mode, as the published table worker plays them, whatever the
 * worker count, so `--jobs 1` and `--jobs 8` play every game the same way and print the same
 * bytes. Production mode hides a rules error's own text, so the CLI plays each failing game again
 * in dev mode ({@link playInDevMode}) to report the real message.
 */
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { SingleGameResult } from '../../sim/play-game.js';
import type { ShardRequest, SimulationBundle } from './sim-shard.js';

type NodeEnv = 'production' | 'development';

/** Run `play` with `NODE_ENV` set to `mode`, which the engine reads each time it decides. */
async function withNodeEnv<T>(mode: NodeEnv, play: () => Promise<T>): Promise<T> {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  try {
    return await play();
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
}

/** Play the games in this process in dev mode, where a rules error carries its own text. */
export function playInDevMode(bundle: SimulationBundle, request: ShardRequest): Promise<SingleGameResult[]> {
  return withNodeEnv('development', () => bundle.playShard(bundle, request));
}

/** A worker's whole program: import the bundle, play its slice, post the results. */
const WORKER_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads');
import(workerData.bundleUrl)
  .then((bundle) => bundle.playShard(bundle, workerData.request))
  .then((games) => parentPort.postMessage(games));
`;

/** One worker's results, or why it stopped without them. */
function resultsOf(worker: Worker): Promise<SingleGameResult[]> {
  return new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`A simulation worker stopped (exit code ${code}) before it sent its games.`)));
  });
}

/**
 * Play `request.games` in production mode, in game order. With `jobs` above 1 they are split
 * into that many contiguous slices (fewer when there are fewer games), each played by a worker
 * thread that imports the bundle at `bundlePath`.
 *
 * Every worker is terminated before this returns or throws. The workers are threads of this
 * process, so a signal that ends the process (Ctrl-C) ends them too.
 */
export async function playInProductionMode(
  bundle: SimulationBundle,
  request: ShardRequest,
  workers: { bundlePath: string; jobs: number } | undefined,
): Promise<SingleGameResult[]> {
  const total = request.games.length;
  const count = Math.min(workers?.jobs ?? 1, total);
  if (workers === undefined || count <= 1) return withNodeEnv('production', () => bundle.playShard(bundle, request));

  const bundleUrl = pathToFileURL(workers.bundlePath).href;
  const started = Array.from({ length: count }, (_, i) => {
    const games = request.games.slice(Math.floor((i * total) / count), Math.floor(((i + 1) * total) / count));
    return new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { bundleUrl, request: { ...request, games } },
      env: { ...process.env, NODE_ENV: 'production' },
    });
  });
  try {
    return (await Promise.all(started.map(resultsOf))).flat();
  } finally {
    await Promise.all(started.map((worker) => worker.terminate()));
  }
}
