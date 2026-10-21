/**
 * Parallel benchmark coordinator.
 * Uses worker threads to evaluate multiple objective sets (population) across CPU cores.
 */
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import type { ObjectiveWeight } from './types.js';
import type { BenchmarkConfig } from './benchmark.js';
import type {
  BenchmarkRequest,
  BenchmarkResponse,
  BenchmarkErrorResponse,
} from './benchmark-worker.js';

/**
 * Options for parallel benchmark evaluation
 */
export interface ParallelBenchmarkOptions {
  /** Number of worker threads (default: os.cpus().length - 1) */
  workerCount?: number;
}

/**
 * How to start a benchmark worker (#401): its entry file is `benchmark-worker`
 * beside this module, with this module's own extension.
 *
 * In an install this module is part of the CLI bundle `dist/cli.js`, and the
 * CLI build emits `dist/benchmark-worker.js` beside it (`WORKER_ENTRIES` in
 * `src/cli/lib/build-cli.ts`).
 *
 * Run from source, as `bin/boardsmith.js` runs this checkout, the entry is
 * `benchmark-worker.ts`. tsx registers its hooks on the main thread only, and
 * without them the worker's `./x.js` imports of `.ts` files do not resolve, so
 * the worker registers tsx itself before it loads its entry.
 */
function benchmarkWorker(): { url: URL; execArgv: string[] | undefined } {
  const extension = extname(fileURLToPath(import.meta.url));
  const url = new URL(`./benchmark-worker${extension}`, import.meta.url);
  if (extension !== '.ts') return { url, execArgv: undefined };
  const registerTsx = `import { register } from ${JSON.stringify(tsxApiUrl())}; register();`;
  return {
    url,
    execArgv: [...process.execArgv, '--import', `data:text/javascript,${encodeURIComponent(registerTsx)}`],
  };
}

/** tsx's registration API, from the packages this module was installed with. */
function tsxApiUrl(): string {
  try {
    return pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href;
  } catch (error) {
    throw new Error(
      "Benchmark workers were asked to run from BoardSmith's TypeScript sources, which need tsx to load, " +
        'and tsx is not installed beside them. Run the benchmark through the `boardsmith` command ' +
        '(for example `boardsmith evolve-bot-weights`), which runs the built workers in an install.',
      { cause: error },
    );
  }
}

/** One benchmark to run: a weight set and the games it plays. */
export interface BenchmarkJob {
  weights: ObjectiveWeight[];
  config: BenchmarkConfig & { gameCount: number };
}

/**
 * Progress callback for parallel benchmarks: games played so far, of every job's games.
 */
export type BenchmarkProgressCallback = (completed: number, total: number) => void;

/**
 * Run benchmark jobs in parallel. Every game of every job is its own piece of
 * work (#1307), so even one job's games spread across the whole pool, and a
 * reproducible job plays the same games however the pool shares them out.
 *
 * @param gameModulePath - Absolute path to the compiled game module (.js)
 * @param gameType - Game type identifier
 * @param jobs - Each weight set to benchmark, with its own benchmark configuration
 * @param options - Worker pool configuration
 * @param onProgress - Optional progress callback, once per game played
 * @returns Each job's win rate, over the games that finished as `benchmarkBot` scores it, in the order of `jobs`
 * @throws When a benchmark game fails or a worker stops unexpectedly; the
 *   remaining workers are terminated, so a failure is never scored as fitness 0.
 */
export async function runParallelBenchmarks(
  gameModulePath: string,
  gameType: string,
  jobs: BenchmarkJob[],
  options?: ParallelBenchmarkOptions,
  onProgress?: BenchmarkProgressCallback
): Promise<number[]> {
  // An empty weight set is scored 0 and plays no game.
  const pieces = jobs.flatMap((job, jobIndex) =>
    job.weights.length === 0 ? [] : Array.from({ length: job.config.gameCount }, (_, game) => ({ jobIndex, game })),
  );
  const wins: number[] = new Array(jobs.length).fill(0);
  const finished: number[] = new Array(jobs.length).fill(0);
  const winRates = () => wins.map((won, job) => (finished[job] > 0 ? won / finished[job] : 0));

  if (pieces.length === 0) {
    return winRates();
  }

  const cpuCount = cpus().length;
  const workerCount = Math.max(1, Math.min(options?.workerCount ?? Math.max(1, cpuCount - 1), pieces.length));
  let completedCount = 0;
  const workQueue = pieces.map((_, index) => index);

  // Create worker pool
  const { url: workerUrl, execArgv } = benchmarkWorker();

  interface WorkerState {
    worker: Worker;
    busy: boolean;
  }

  const workers: WorkerState[] = [];
  const inFlightWork = new Map<Worker, number>();

  return new Promise((resolve, reject) => {
    let settled = false;
    const describePiece = (index: number) => {
      const { jobIndex, game } = pieces[index];
      return `game ${game + 1} of ${jobs[jobIndex].config.gameCount} of weight set ${jobIndex + 1} of ${jobs.length}`;
    };

    function fail(message: string): void {
      settled = true;
      terminateAllWorkers();
      reject(new Error(message));
    }

    // Create workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerUrl, { execArgv });
      const workerState: WorkerState = {
        worker,
        busy: false,
      };
      workers.push(workerState);

      // Handle worker messages
      worker.on('message', (message: BenchmarkResponse | BenchmarkErrorResponse) => {
        if (settled) return;
        inFlightWork.delete(worker);
        workerState.busy = false;

        if ('error' in message) {
          fail(`Benchmark ${describePiece(message.piece)} for "${gameType}" failed: ${message.error}`);
          return;
        }
        const { jobIndex } = pieces[message.piece];
        wins[jobIndex] += message.wins;
        finished[jobIndex] += message.wins + message.losses + message.draws;

        completedCount++;
        onProgress?.(completedCount, pieces.length);

        if (completedCount >= pieces.length) {
          settled = true;
          terminateAllWorkers();
          resolve(winRates());
          return;
        }

        // Assign more work if available
        assignWork(workerState);
      });

      // Handle worker errors/crashes
      worker.on('error', (error) => {
        if (settled) return;
        console.error(`Benchmark worker crashed: ${error.message}`);

        // Get the index that was being processed
        const lostIndex = inFlightWork.get(worker);
        inFlightWork.delete(worker);

        if (lostIndex !== undefined) {
          // Put the lost work back in the queue for another worker
          workQueue.push(lostIndex);
        }

        // Remove crashed worker from pool
        const idx = workers.indexOf(workerState);
        if (idx !== -1) {
          workers.splice(idx, 1);
        }

        // If no workers left, we need to fail or recreate
        if (workers.length === 0) {
          reject(new Error('All benchmark workers crashed'));
          return;
        }

        // Try to redistribute work to remaining workers
        for (const ws of workers) {
          if (!ws.busy) {
            assignWork(ws);
          }
        }
      });

      // A crash emits 'error' first and has already left the pool; any other exit
      // before the run settles (game code calling process.exit) is a failure.
      worker.on('exit', (code) => {
        if (settled || !workers.includes(workerState)) return;
        const lostIndex = inFlightWork.get(worker);
        const during = lostIndex === undefined ? '' : ` while playing benchmark ${describePiece(lostIndex)}`;
        fail(`A benchmark worker for "${gameType}" stopped (exit code ${code})${during}.`);
      });
    }

    /**
     * Assign work to a worker
     */
    function assignWork(workerState: WorkerState): void {
      if (workerState.busy || workQueue.length === 0) {
        return;
      }

      const index = workQueue.shift()!;
      workerState.busy = true;
      inFlightWork.set(workerState.worker, index);

      const { jobIndex, game } = pieces[index];
      const request: BenchmarkRequest = {
        piece: index,
        gameModulePath,
        gameType,
        weights: jobs[jobIndex].weights,
        config: { ...jobs[jobIndex].config, game },
      };

      workerState.worker.postMessage(request);
    }

    /**
     * Terminate all workers
     */
    function terminateAllWorkers(): void {
      for (const ws of workers) {
        ws.worker.terminate().catch(() => {
          // Ignore termination errors
        });
      }
    }

    // Start assigning work to all workers
    for (const ws of workers) {
      assignWork(ws);
    }
  });
}
