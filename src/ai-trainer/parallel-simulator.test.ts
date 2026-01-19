import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// Import from dist to ensure worker threads can load .js files
import { runParallelSimulations } from '../../packages/ai-trainer/dist/parallel-simulator.js';
import {
  introspectGame,
  createIntrospectionGame,
} from '../../packages/ai-trainer/dist/introspector.js';
import { generateCandidateFeatures } from '../../packages/ai-trainer/dist/feature-generator.js';
import type { GameStructure, CandidateFeature } from '../../packages/ai-trainer/dist/types.js';
import type { SimulationOptions } from '../../packages/ai-trainer/dist/simulator.js';

// Get the directory containing this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to go-fish rules module (from src/ai-trainer to packages/games/go-fish/rules/dist)
const GOFISH_MODULE_PATH = join(
  __dirname,
  '..',
  '..',
  'packages',
  'games',
  'go-fish',
  'rules',
  'dist',
  'index.js'
);

describe('Parallel Simulator', { timeout: 60000 }, () => {
  let structure: GameStructure;
  let features: CandidateFeature[];

  beforeAll(async () => {
    // Dynamically import go-fish to set up structure and features
    const goFishModule = await import(GOFISH_MODULE_PATH);
    const { gameDefinition } = goFishModule;

    // Create introspection game and generate features
    const introGame = createIntrospectionGame(gameDefinition.gameClass, 2);
    structure = introspectGame(introGame);
    features = generateCandidateFeatures(structure);
  });

  it('should produce deterministic results across different worker counts', async () => {
    // Run 10 games with the same seed but different worker counts
    const testSeed = 'test-determinism-2024';
    const gameCount = 10;

    const baseOptions: SimulationOptions = {
      gameCount,
      playerCount: 2,
      features,
      timeout: 30000,
      maxActions: 100,
      seed: testSeed,
    };

    // Run with 1 worker
    const results1Worker = await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      baseOptions,
      structure,
      { workerCount: 1 }
    );

    // Run with 2 workers
    const results2Workers = await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      baseOptions,
      structure,
      { workerCount: 2 }
    );

    // Aggregate stats should match (order-independent)
    // Note: Due to work-stealing, individual game order may differ,
    // but aggregate statistics MUST match
    expect(results1Worker.games.length).toBe(gameCount);
    expect(results2Workers.games.length).toBe(gameCount);

    // Same number of completed games
    expect(results2Workers.completedGames).toBe(results1Worker.completedGames);

    // Same total states (this verifies determinism at the simulation level)
    expect(results2Workers.totalStates).toBe(results1Worker.totalStates);

    // Same average actions per completed game
    expect(results2Workers.averageActions).toBeCloseTo(
      results1Worker.averageActions,
      2
    );

    // Verify each gameId appears in both result sets
    const gameIds1 = new Set(results1Worker.games.map((g) => g.gameId));
    const gameIds2 = new Set(results2Workers.games.map((g) => g.gameId));
    expect(gameIds1).toEqual(gameIds2);
  });

  it('should correctly aggregate all games', async () => {
    const gameCount = 5;

    const results = await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      {
        gameCount,
        playerCount: 2,
        features,
        timeout: 30000,
        maxActions: 100,
        seed: 'aggregation-test',
      },
      structure,
      { workerCount: 2 }
    );

    // Verify correct number of games
    expect(results.games.length).toBe(gameCount);

    // Verify each game has required fields
    for (const game of results.games) {
      expect(game).toHaveProperty('gameId');
      expect(game).toHaveProperty('playerCount');
      expect(game).toHaveProperty('states');
      expect(game).toHaveProperty('winners');
      expect(game).toHaveProperty('totalActions');
      expect(game).toHaveProperty('completed');

      expect(game.playerCount).toBe(2);
      expect(Array.isArray(game.states)).toBe(true);
      expect(Array.isArray(game.winners)).toBe(true);
      expect(typeof game.totalActions).toBe('number');
      expect(typeof game.completed).toBe('boolean');
    }

    // Verify unique game IDs
    const gameIds = results.games.map((g) => g.gameId);
    const uniqueIds = new Set(gameIds);
    expect(uniqueIds.size).toBe(gameCount);

    // Verify completedGames count matches actual completed games
    const actualCompleted = results.games.filter((g) => g.completed).length;
    expect(results.completedGames).toBe(actualCompleted);
  });

  it('should handle workerCount of 1 (serial via workers)', async () => {
    const results = await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      {
        gameCount: 3,
        playerCount: 2,
        features,
        timeout: 30000,
        maxActions: 100,
        seed: 'single-worker',
      },
      structure,
      { workerCount: 1 }
    );

    expect(results.games.length).toBe(3);
    expect(results.completedGames).toBeGreaterThanOrEqual(0);
  });

  it('should cap workerCount to gameCount when workers > games', async () => {
    const gameCount = 2;

    // Request more workers than games
    const results = await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      {
        gameCount,
        playerCount: 2,
        features,
        timeout: 30000,
        maxActions: 100,
        seed: 'worker-cap-test',
      },
      structure,
      { workerCount: 10 } // Request 10 workers but only 2 games
    );

    // Should still work correctly
    expect(results.games.length).toBe(gameCount);
  });

  it('should report progress correctly', async () => {
    const gameCount = 4;
    const progressReports: number[] = [];

    await runParallelSimulations(
      GOFISH_MODULE_PATH,
      'go-fish',
      {
        gameCount,
        playerCount: 2,
        features,
        timeout: 30000,
        maxActions: 100,
        seed: 'progress-test',
        onProgress: (completed, total) => {
          progressReports.push(completed);
          expect(total).toBe(gameCount);
        },
      },
      structure,
      { workerCount: 2 }
    );

    // Should have received progress reports
    expect(progressReports.length).toBeGreaterThan(0);

    // Last progress report should be equal to gameCount
    expect(progressReports[progressReports.length - 1]).toBe(gameCount);

    // Progress should be monotonically increasing
    for (let i = 1; i < progressReports.length; i++) {
      expect(progressReports[i]).toBeGreaterThanOrEqual(progressReports[i - 1]);
    }
  });
});
