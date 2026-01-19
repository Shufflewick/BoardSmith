/**
 * Random game simulation for BoardSmith games.
 *
 * Run many random games to verify game completeness, find bugs,
 * and check for edge cases.
 *
 * @module
 */

import type { Game, GameOptions, FlowState } from '../engine/index.js';
import { createTestGame, type TestGame, type TestGameOptions } from './test-game.js';

/**
 * Options for {@link simulateRandomGames}.
 */
export interface SimulateRandomGamesOptions {
  /** Number of games to simulate */
  count: number;
  /** Player counts to test (will run games with each count) */
  playerCounts: number[];
  /** Timeout per game in milliseconds */
  timeout?: number;
  /** Maximum actions per game before considering it hung */
  maxActions?: number;
  /** Called after each game completes (for progress reporting) */
  onGameComplete?: (result: SingleGameResult, progress: { completed: number; total: number }) => void;
}

/**
 * Result of a single simulated game.
 */
export interface SingleGameResult {
  /** Whether the game completed successfully */
  completed: boolean;
  /** Whether the game crashed with an error */
  crashed: boolean;
  /** Whether the game timed out */
  timedOut: boolean;
  /** Whether the game exceeded max actions */
  exceededMaxActions: boolean;
  /** Error message if crashed */
  error?: string;
  /** Number of actions taken */
  actionCount: number;
  /** Time taken in milliseconds */
  duration: number;
  /** Player count for this game */
  playerCount: number;
  /** Seed used for this game */
  seed: string;
  /** Winner indices (if completed) */
  winners?: number[];
}

/**
 * Aggregated results from random game simulation.
 */
export interface SimulationResults {
  /** Number of games that completed successfully */
  completed: number;
  /** Number of games that crashed */
  crashed: number;
  /** Number of games that timed out */
  timedOut: number;
  /** Number of games that exceeded max actions */
  exceededMaxActions: number;
  /** Total games run */
  total: number;
  /** Individual game results */
  games: SingleGameResult[];
  /** Average actions per completed game */
  averageActions: number;
  /** Average duration per completed game */
  averageDuration: number;
  /** Errors encountered (deduplicated) */
  errors: string[];
}

/**
 * Simple random number generator for reproducible simulations.
 * @internal
 */
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    // Simple hash function
    this.seed = 0;
    for (let i = 0; i < seed.length; i++) {
      this.seed = ((this.seed << 5) - this.seed + seed.charCodeAt(i)) | 0;
    }
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(array: T[]): T {
    return array[this.nextInt(array.length)];
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

/**
 * Run a single random game simulation.
 * @internal
 */
async function simulateSingleGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  playerCount: number,
  seed: string,
  timeout: number,
  maxActions: number
): Promise<SingleGameResult> {
  const startTime = Date.now();
  const rng = new SeededRandom(seed);

  let testGame: TestGame<G>;
  let actionCount = 0;
  let timedOut = false;
  let exceededMaxActions = false;

  try {
    testGame = createTestGame(GameClass, {
      playerCount,
      seed,
      autoStart: true,
    });

    // Run game until complete or limits reached
    while (!testGame.isComplete()) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        timedOut = true;
        break;
      }

      // Check max actions
      if (actionCount >= maxActions) {
        exceededMaxActions = true;
        break;
      }

      // Check if awaiting input
      if (!testGame.isAwaitingInput()) {
        // Game is not complete but not awaiting input - might be stuck
        break;
      }

      // Get available actions and pick one randomly
      const flowState = testGame.getFlowState();
      if (!flowState) break;

      // Determine which player should act
      const currentPlayer = flowState.currentPlayer;
      if (currentPlayer === undefined) break;

      // Get available actions for this player
      // This is a simplified version - real implementation would introspect the game
      const player = testGame.getPlayer(currentPlayer);

      // Try to perform a random valid action
      // In a real implementation, we'd enumerate valid actions
      // For now, we'll try common action patterns
      const possibleActions = getAvailableActions(testGame, currentPlayer);

      if (possibleActions.length === 0) {
        // No actions available - might be stuck
        break;
      }

      const action = rng.pick(possibleActions);
      const result = testGame.doAction(currentPlayer, action.name, action.args);

      if (result.success) {
        actionCount++;
      } else {
        // Failed action - try another or give up after too many failures
        // This is simplified; real impl would track failures better
      }
    }

    const duration = Date.now() - startTime;

    return {
      completed: testGame.isComplete(),
      crashed: false,
      timedOut,
      exceededMaxActions,
      actionCount,
      duration,
      playerCount,
      seed,
      winners: testGame.isComplete()
        ? testGame.getWinners().map(p => p.position)
        : undefined,
    };

  } catch (error) {
    return {
      completed: false,
      crashed: true,
      timedOut: false,
      exceededMaxActions: false,
      error: error instanceof Error ? error.message : String(error),
      actionCount,
      duration: Date.now() - startTime,
      playerCount,
      seed,
    };
  }
}

/**
 * Get available actions for a player.
 * This is a simplified heuristic - games should provide this introspection.
 * @internal
 */
function getAvailableActions<G extends Game>(
  testGame: TestGame<G>,
  playerIndex: number
): Array<{ name: string; args: Record<string, unknown> }> {
  const flowState = testGame.getFlowState();
  if (!flowState) return [];

  // Look at the awaiting actions if available
  const awaitingPlayers = flowState.awaitingPlayers;
  if (awaitingPlayers) {
    const playerState = awaitingPlayers[playerIndex];
    if (playerState?.availableActions) {
      // Return actions with empty args - real impl would generate valid args
      return playerState.availableActions.map((name: string) => ({ name, args: {} }));
    }
  }

  return [];
}

/**
 * Simulate multiple random games to verify game completeness.
 *
 * Runs many games with random moves to find bugs, verify all games
 * can complete, and check for edge cases across different player counts.
 *
 * @param GameClass - The game class constructor
 * @param options - Simulation configuration
 * @returns Aggregated results including completion rate, errors, and timing
 *
 * @example
 * ```typescript
 * const results = await simulateRandomGames(GoFishGame, {
 *   count: 100,
 *   playerCounts: [2, 3, 4],
 *   timeout: 5000,
 * });
 *
 * expect(results.completed).toBe(100);
 * expect(results.crashed).toBe(0);
 * ```
 */
export async function simulateRandomGames<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: SimulateRandomGamesOptions
): Promise<SimulationResults> {
  const {
    count,
    playerCounts,
    timeout = 5000,
    maxActions = 10000,
    onGameComplete,
  } = options;

  const games: SingleGameResult[] = [];
  const errors = new Set<string>();
  let total = 0;

  // Distribute games across player counts
  const gamesPerPlayerCount = Math.ceil(count / playerCounts.length);

  for (const playerCount of playerCounts) {
    for (let i = 0; i < gamesPerPlayerCount && total < count; i++) {
      const seed = `sim-${playerCount}-${i}-${Date.now()}`;

      const result = await simulateSingleGame(
        GameClass,
        playerCount,
        seed,
        timeout,
        maxActions
      );

      games.push(result);
      total++;

      if (result.error) {
        errors.add(result.error);
      }

      if (onGameComplete) {
        onGameComplete(result, { completed: total, total: count });
      }
    }
  }

  // Calculate aggregates
  const completed = games.filter(g => g.completed).length;
  const crashed = games.filter(g => g.crashed).length;
  const timedOut = games.filter(g => g.timedOut).length;
  const exceededMaxActions = games.filter(g => g.exceededMaxActions).length;

  const completedGames = games.filter(g => g.completed);
  const averageActions = completedGames.length > 0
    ? completedGames.reduce((sum, g) => sum + g.actionCount, 0) / completedGames.length
    : 0;
  const averageDuration = completedGames.length > 0
    ? completedGames.reduce((sum, g) => sum + g.duration, 0) / completedGames.length
    : 0;

  return {
    completed,
    crashed,
    timedOut,
    exceededMaxActions,
    total,
    games,
    averageActions,
    averageDuration,
    errors: [...errors],
  };
}
