/**
 * Worker thread script for parallel benchmark evaluation.
 * Receives benchmark request, runs benchmarkAI, and posts result back.
 */
import { parentPort } from 'worker_threads';
import type { Game } from '../engine/index.js';
import type { GameClass, LearnedObjective, SerializableGameStructure } from './types.js';
import { benchmarkAI, type BenchmarkConfig } from './benchmark.js';
import { deserializeGameStructure } from './simulator.js';
import { generateCandidateFeatures } from './feature-generator.js';

if (!parentPort) {
  throw new Error('benchmark-worker.ts must be run as a worker thread');
}

/**
 * Message format for benchmark requests
 */
export interface BenchmarkRequest {
  /** Index of this individual in the population (for tracking) */
  individualIndex: number;
  /** Path to the compiled game module */
  gameModulePath: string;
  /** Game type identifier */
  gameType: string;
  /** Objectives to benchmark */
  objectives: LearnedObjective[];
  /** Benchmark configuration (without features - worker regenerates them) */
  config: Omit<BenchmarkConfig, 'features'>;
  /** Serialized game structure for feature regeneration */
  structure: SerializableGameStructure;
}

/**
 * Message format for benchmark results
 */
export interface BenchmarkResponse {
  /** Index of this individual in the population */
  individualIndex: number;
  /** Win rate achieved */
  winRate: number;
  /** Number of wins */
  wins: number;
  /** Number of losses */
  losses: number;
  /** Number of draws */
  draws: number;
}

/**
 * Error response format
 */
export interface BenchmarkErrorResponse {
  /** Index of this individual in the population */
  individualIndex: number;
  /** Error message */
  error: string;
}

/**
 * Message handler for incoming benchmark requests.
 */
parentPort.on('message', async (request: BenchmarkRequest) => {
  const { individualIndex, gameModulePath, gameType, objectives, config, structure } = request;

  try {
    // Dynamically import the game module (need file:// URL for local imports in workers)
    const modulePath = gameModulePath.startsWith('file://')
      ? gameModulePath
      : `file://${gameModulePath}`;
    const gameModule = await import(modulePath);

    // Extract the game class from the module's gameDefinition
    const gameDefinition = gameModule.gameDefinition;
    if (!gameDefinition?.gameClass) {
      throw new Error(
        `Game module at ${gameModulePath} does not export a valid gameDefinition with gameClass`
      );
    }

    const GameClassRef = gameDefinition.gameClass as GameClass<Game>;

    // Deserialize structure and regenerate features
    const gameStructure = deserializeGameStructure(structure);
    const features = generateCandidateFeatures(gameStructure);

    // Run the benchmark with regenerated features
    const result = await benchmarkAI(GameClassRef, gameType, objectives, {
      ...config,
      features,
    });

    // Post result back to parent
    const response: BenchmarkResponse = {
      individualIndex,
      winRate: result.winRate,
      wins: result.wins,
      losses: result.losses,
      draws: result.draws,
    };
    parentPort!.postMessage(response);
  } catch (error) {
    // Post error back to parent
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Benchmark worker error for individual ${individualIndex}: ${errorMessage}`);

    const errorResponse: BenchmarkErrorResponse = {
      individualIndex,
      error: errorMessage,
    };
    parentPort!.postMessage(errorResponse);
  }
});
