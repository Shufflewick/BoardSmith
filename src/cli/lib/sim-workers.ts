/**
 * Where `boardsmith simulate` plays its games (#556): always on worker threads, each importing
 * the run's rules bundle (game, policies and runner) and playing its share of the games.
 *
 * A worker's `NODE_ENV` is set through its own `env`, so this process's environment is never
 * changed. A run plays in production mode, as the published table worker does, whatever the
 * worker count, so `--jobs 1` and `--jobs 8` play every game the same way and print the same
 * bytes. Production mode hides a rules error's own text, so the CLI plays each failing game again
 * in development mode to report the real message.
 */
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { SingleGameResult } from '../../sim/play-game.js';
import type { ShardRequest } from './sim-shard.js';

/** A worker's whole program: import the bundle, play its games, post the results. */
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
 * Play `request.games` on `jobs` worker threads (fewer when there are fewer games) in `mode`,
 * importing the bundle at `bundlePath`, and return the results in game order. Games are dealt
 * round-robin, game `i` to worker `i % workers`, so a run over several player counts gives every
 * worker some of each.
 *
 * Every worker is terminated before this returns or throws. The workers are threads of this
 * process, so a signal that ends the process (Ctrl-C) ends them too.
 */
export async function playOnWorkers(
  bundlePath: string,
  request: ShardRequest,
  jobs: number,
  mode: 'production' | 'development',
): Promise<SingleGameResult[]> {
  const count = Math.min(jobs, request.games.length);
  const bundleUrl = pathToFileURL(bundlePath).href;
  const started = Array.from({ length: count }, (_, w) => {
    const games = request.games.filter((_game, i) => i % count === w);
    return new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { bundleUrl, request: { ...request, games } },
      env: { ...process.env, NODE_ENV: mode },
    });
  });
  try {
    const shares = await Promise.all(started.map(resultsOf));
    return request.games.map((_, i) => shares[i % count][Math.floor(i / count)]);
  } finally {
    await Promise.all(started.map((worker) => worker.terminate()));
  }
}
