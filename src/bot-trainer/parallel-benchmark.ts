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

/**
 * Progress callback for parallel benchmarks
 */
export type BenchmarkProgressCallback = (completed: number, total: number) => void;

/**
 * Run benchmarks for a population of objective sets in parallel.
 *
 * @param gameModulePath - Absolute path to the compiled game module (.js)
 * @param gameType - Game type identifier
 * @param population - Array of weight sets (each represents one individual)
 * @param config - Benchmark configuration (game count, MCTS iterations, etc.)
 * @param options - Worker pool configuration
 * @param onProgress - Optional progress callback
 * @returns Array of fitness values in same order as population
 * @throws When a candidate's benchmark fails or a worker stops unexpectedly; the
 *   remaining workers are terminated, so a failure is never scored as fitness 0.
 */
export async function runParallelBenchmarks(
  gameModulePath: string,
  gameType: string,
  population: ObjectiveWeight[][],
  config: BenchmarkConfig,
  options?: ParallelBenchmarkOptions,
  onProgress?: BenchmarkProgressCallback
): Promise<number[]> {
  const populationSize = population.length;

  if (populationSize === 0) {
    return [];
  }

  // Determine worker count
  const cpuCount = cpus().length;
  let workerCount = options?.workerCount ?? Math.max(1, cpuCount - 1);
  workerCount = Math.max(1, Math.min(workerCount, populationSize));

  // Results array (indexed by individual index)
  const fitnesses: number[] = new Array(populationSize).fill(0);
  let completedCount = 0;

  // Create work queue (indices of individuals to evaluate)
  const workQueue: number[] = [];
  for (let i = 0; i < populationSize; i++) {
    // Skip empty objective sets (fitness = 0)
    if (population[i].length === 0) {
      fitnesses[i] = 0;
      completedCount++;
    } else {
      workQueue.push(i);
    }
  }

  // If all were empty, return immediately
  if (workQueue.length === 0) {
    return fitnesses;
  }

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
    const candidate = (index: number) => `candidate ${index + 1} of ${populationSize}`;

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
          fail(`Benchmarking ${candidate(message.individualIndex)} for game "${gameType}" failed: ${message.error}`);
          return;
        }
        fitnesses[message.individualIndex] = message.winRate;

        completedCount++;

        // Report progress
        if (onProgress) {
          onProgress(completedCount, populationSize);
        }

        // Check if all done
        if (completedCount >= populationSize) {
          settled = true;
          terminateAllWorkers();
          resolve(fitnesses);
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
        const during = lostIndex === undefined ? '' : ` while benchmarking ${candidate(lostIndex)}`;
        fail(`A benchmark worker for game "${gameType}" stopped (exit code ${code})${during}.`);
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

      const request: BenchmarkRequest = {
        individualIndex: index,
        gameModulePath,
        gameType,
        weights: population[index],
        config,
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
