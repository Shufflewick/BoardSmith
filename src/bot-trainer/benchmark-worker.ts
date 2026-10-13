/**
 * Worker thread script for parallel benchmark evaluation.
 * Receives a benchmark request, runs the `benchmarkBot` built into the game's
 * training bundle, and posts the result back. It imports no engine of its own,
 * so the bot plays on the engine the game is built with (#697).
 */
import { parentPort } from 'worker_threads';
import type { ObjectiveWeight } from './types.js';
import type { BenchmarkConfig } from './benchmark.js';
import { loadTrainingBundle } from './training-bundle.js';

if (!parentPort) {
  throw new Error('benchmark-worker.ts must be run as a worker thread');
}

/**
 * Message format for benchmark requests
 */
export interface BenchmarkRequest {
  /** Index of this individual in the population (for tracking) */
  individualIndex: number;
  /** Path to the game's training bundle (see `TrainingBundle`) */
  gameModulePath: string;
  /** Game type identifier */
  gameType: string;
  /** The weights to give the game's own objectives, by id */
  weights: ObjectiveWeight[];
  /** Benchmark configuration */
  config: BenchmarkConfig;
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
  /**
   * Games that reached no outcome (#37). Always 0 in practice, because
   * benchmarkBot throws rather than returning a rate built around a hole and
   * the throw arrives as a BenchmarkErrorResponse — carried so a future caller
   * that opts into `allowIncomplete` still sees it rather than inferring it.
   */
  incomplete: number;
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
  const { individualIndex, gameModulePath, gameType, weights, config } = request;

  try {
    const bundle = await loadTrainingBundle(gameModulePath);

    // The game's own bot, so its own objective checkers are what is scored.
    const result = await bundle.benchmarkBot(
      bundle.gameDefinition.gameClass,
      gameType,
      bundle.gameDefinition.bot,
      weights,
      config,
    );

    // Post result back to parent
    const response: BenchmarkResponse = {
      individualIndex,
      winRate: result.winRate,
      wins: result.wins,
      losses: result.losses,
      draws: result.draws,
      incomplete: result.incomplete,
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
