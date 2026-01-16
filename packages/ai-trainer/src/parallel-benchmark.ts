/**
 * Parallel benchmark coordinator.
 * Uses worker threads to evaluate multiple objective sets (population) across CPU cores.
 */
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import type { LearnedObjective, SerializableGameStructure } from './types.js';
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
 * Result for a single individual in the population
 */
export interface IndividualFitness {
  /** Index of this individual in the population */
  index: number;
  /** Win rate achieved (0 if errored) */
  winRate: number;
  /** Whether evaluation succeeded */
  success: boolean;
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
 * @param population - Array of objective sets (each represents one individual)
 * @param structure - Serialized game structure for feature regeneration in workers
 * @param config - Benchmark configuration (game count, MCTS iterations, etc.)
 * @param options - Worker pool configuration
 * @param onProgress - Optional progress callback
 * @returns Array of fitness values in same order as population
 */
export async function runParallelBenchmarks(
  gameModulePath: string,
  gameType: string,
  population: LearnedObjective[][],
  structure: SerializableGameStructure,
  config: Omit<BenchmarkConfig, 'features'>,
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
  const workerPath = new URL('./benchmark-worker.js', import.meta.url);

  interface WorkerState {
    worker: Worker;
    busy: boolean;
    currentIndex: number | null;
  }

  const workers: WorkerState[] = [];
  const inFlightWork = new Map<Worker, number>();

  return new Promise((resolve, reject) => {
    // Create workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerPath);
      const workerState: WorkerState = {
        worker,
        busy: false,
        currentIndex: null,
      };
      workers.push(workerState);

      // Handle worker messages
      worker.on('message', (message: BenchmarkResponse | BenchmarkErrorResponse) => {
        const index = inFlightWork.get(worker);
        inFlightWork.delete(worker);
        workerState.busy = false;
        workerState.currentIndex = null;

        if ('error' in message) {
          // Benchmark errored - use 0 fitness
          fitnesses[message.individualIndex] = 0;
        } else {
          // Successful benchmark
          fitnesses[message.individualIndex] = message.winRate;
        }

        completedCount++;

        // Report progress
        if (onProgress) {
          onProgress(completedCount, populationSize);
        }

        // Check if all done
        if (completedCount >= populationSize) {
          terminateAllWorkers();
          resolve(fitnesses);
          return;
        }

        // Assign more work if available
        assignWork(workerState);
      });

      // Handle worker errors/crashes
      worker.on('error', (error) => {
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

      worker.on('exit', (code) => {
        if (code !== 0 && completedCount < populationSize) {
          // Unexpected exit, handled by error event
        }
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
      workerState.currentIndex = index;
      inFlightWork.set(workerState.worker, index);

      const request: BenchmarkRequest = {
        individualIndex: index,
        gameModulePath,
        gameType,
        objectives: population[index],
        config,
        structure,
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
