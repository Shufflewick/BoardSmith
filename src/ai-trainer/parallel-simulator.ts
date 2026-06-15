/**
 * Parallel game simulation coordinator.
 * Uses worker threads to run multiple games across CPU cores.
 */
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import type { Game } from '../engine/index.js';
import type {
  GameStructure,
  GameData,
  SerializableSimulationOptions,
} from './types.js';
import {
  serializeGameStructure,
  type SimulationOptions,
  type SimulationResults,
} from './simulator.js';

/**
 * Options for parallel simulation
 */
export interface ParallelSimulatorOptions {
  /** Number of worker threads (default: os.cpus().length - 1) */
  workerCount?: number;
  /** Batch size per worker (default: 10 games) */
  batchSize?: number;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
  pendingSeeds: string[];
  currentSeed: string | null;
}

interface WorkerResult {
  type: 'success';
  data: GameData;
}

interface WorkerError {
  type: 'error';
  error: string;
  seed: string;
}

type WorkerMessage = WorkerResult | WorkerError;

/**
 * Run multiple game simulations in parallel across worker threads.
 *
 * @param gameModulePath - Absolute path to the compiled game module (.js)
 * @param gameType - Game type identifier
 * @param options - Simulation options (gameCount, features, etc.)
 * @param structure - Game structure for feature regeneration
 * @param parallelOptions - Worker pool configuration
 * @returns Aggregated simulation results
 */
export async function runParallelSimulations<G extends Game>(
  gameModulePath: string,
  gameType: string,
  options: SimulationOptions,
  structure: GameStructure,
  parallelOptions?: ParallelSimulatorOptions
): Promise<SimulationResults> {
  const gameCount = options.gameCount;

  // Determine worker count
  const cpuCount = cpus().length;
  let workerCount = parallelOptions?.workerCount ?? Math.max(1, cpuCount - 1);
  workerCount = Math.max(1, Math.min(workerCount, gameCount));

  const batchSize = parallelOptions?.batchSize ?? 10;

  // Serialize game structure once for all workers
  const serializedStructure = serializeGameStructure(structure);

  // Generate all game seeds upfront
  const allSeeds: string[] = [];
  for (let i = 0; i < gameCount; i++) {
    allSeeds.push(`${options.seed}-game-${i}`);
  }

  // Results collection
  const games: GameData[] = [];
  let completedGames = 0;
  let totalStates = 0;
  let totalActions = 0;
  let gamesProcessed = 0;

  // Create worker pool
  const workerPath = new URL('./simulation-worker.js', import.meta.url);
  const workers: WorkerState[] = [];

  // Work queue (remaining seeds to process)
  const workQueue = [...allSeeds];

  // Track in-flight work per worker for crash recovery
  const inFlightWork = new Map<Worker, string>();

  return new Promise((resolve, reject) => {
    // Create workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerPath);
      const workerState: WorkerState = {
        worker,
        busy: false,
        pendingSeeds: [],
        currentSeed: null,
      };
      workers.push(workerState);

      // Handle worker messages
      worker.on('message', (message: GameData | { error: string; seed: string }) => {
        const seed = inFlightWork.get(worker);
        inFlightWork.delete(worker);
        workerState.busy = false;
        workerState.currentSeed = null;

        if ('error' in message) {
          // Game errored - count as incomplete
          gamesProcessed++;
          games.push({
            gameId: message.seed,
            playerCount: options.playerCount,
            states: [],
            winners: [],
            totalActions: 0,
            completed: false,
          });
        } else {
          // Successful game
          const gameData = message;
          games.push(gameData);
          gamesProcessed++;

          if (gameData.completed) {
            completedGames++;
            totalActions += gameData.totalActions;
          }
          totalStates += gameData.states.length;
        }

        // Report progress
        if (options.onProgress) {
          options.onProgress(gamesProcessed, gameCount);
        }

        // Check if all done
        if (gamesProcessed >= gameCount) {
          terminateAllWorkers();
          resolve({
            games,
            completedGames,
            totalStates,
            averageActions: completedGames > 0 ? totalActions / completedGames : 0,
          });
          return;
        }

        // Assign more work if available
        assignWork(workerState);
      });

      // Handle worker errors/crashes
      worker.on('error', (error) => {
        console.error(`Worker crashed: ${error.message}`);

        // Get the seed that was being processed
        const lostSeed = inFlightWork.get(worker);
        inFlightWork.delete(worker);

        if (lostSeed) {
          // Put the lost work back in the queue for another worker
          workQueue.push(lostSeed);
        }

        // Remove crashed worker from pool
        const index = workers.indexOf(workerState);
        if (index !== -1) {
          workers.splice(index, 1);
        }

        // If no workers left, we need to fail or recreate
        if (workers.length === 0) {
          reject(new Error('All workers crashed'));
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
        if (code !== 0 && gamesProcessed < gameCount) {
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

      const seed = workQueue.shift()!;
      workerState.busy = true;
      workerState.currentSeed = seed;
      inFlightWork.set(workerState.worker, seed);

      const message: SerializableSimulationOptions = {
        gameModulePath,
        gameType,
        playerCount: options.playerCount,
        timeout: options.timeout,
        maxActions: options.maxActions,
        seed,
        structure: serializedStructure,
        aiConfig: options.aiConfig,
      };

      workerState.worker.postMessage(message);
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
