/**
 * Random game simulation for BoardSmith games.
 *
 * Run many random games to verify game completeness, find bugs,
 * and check for edge cases.
 *
 * @module
 */

import type { Game, GameOptions } from '../engine/index.js';
import { playGame, gameSeed, type IsResting, type SingleGameResult } from '../sim/play-game.js';
import { random, type Policy, type SelectionChoicesObservation } from '../sim/policies.js';

/**
 * Options for {@link simulateRandomGames}.
 */
export interface SimulateRandomGamesOptions<G extends Game = Game> {
  /** Number of games to simulate */
  count: number;
  /** Player counts to test. Games are shared evenly across them, so `count` must be at least their number. */
  playerCounts: number[];
  /**
   * Base seed for the whole run. Per-game seeds are derived deterministically
   * from it, so re-running with the same base seed reproduces the same games.
   * When omitted, a random base seed is generated and returned on
   * {@link SimulationResults.seed} so a run can still be replayed.
   */
  seed?: string;
  /** Timeout per game in milliseconds */
  timeout?: number;
  /** Maximum actions per game before considering it hung */
  maxActions?: number;
  /** Called after each game completes (for progress reporting) */
  onGameComplete?: (result: SingleGameResult, progress: { completed: number; total: number }) => void;
  /**
   * Game-specific options forwarded to every simulated game's constructor —
   * the same values a preset or a `--game-option` flag would supply.
   *
   * Without these the harness can only ever measure a game's DEFAULT
   * configuration, so a game whose longest or heaviest mode sits behind an
   * option gets a green result that says nothing about that mode.
   *
   * The harness owns `playerCount`, `playerNames`, `seed` and `autoStart`;
   * naming one of them here throws rather than being silently overridden.
   */
  gameOptions?: Record<string, unknown>;
  /**
   * Called for every choice / element / elements selection the simulator
   * enumerates, with the count of candidates it found. An action with a
   * repeating selection is not reported: its moves are found on a scratch copy
   * of the game, where each pick's `onEach` has run. Purely observational —
   * it cannot affect the run, so a seeded simulation produces the same games
   * with or without it.
   */
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void;
  /**
   * Declares where the game is meant to rest. It is asked after every move the
   * simulator applies, and the first time it returns a reason the game stops
   * as `resting`. A game that never reaches its rest ends as it would without
   * this: `stuck` when no seat has an enabled action, and a crash, a timeout,
   * too many actions, a rejected move or a move the simulator cannot build
   * stays a failure.
   */
  isResting?: IsResting<G>;
}

/**
 * Options for {@link replayRandomGame}.
 */
export interface ReplayRandomGameOptions<G extends Game = Game> {
  /** The exact per-game seed to replay (from {@link SingleGameResult.seed}) */
  seed: string;
  /** Player count the game was run with */
  playerCount: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum actions before considering the game hung */
  maxActions?: number;
  /**
   * The same `gameOptions` the failing run used. A seed alone does NOT
   * reproduce a game-option-gated configuration — the options are part of the
   * repro.
   */
  gameOptions?: Record<string, unknown>;
  /** The same `isResting` the run used, so the replay gives the same verdict. */
  isResting?: IsResting<G>;
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
  /** Number of games that got stuck (no generatable move / a rejected engine-generated move / an undeclared stop) */
  stuck: number;
  /** Number of games that stopped at a rest their `isResting` declared */
  resting: number;
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
  /** Base seed used for this run (re-run with this to reproduce all games) */
  seed: string;
}

/** The random policy at every seat. */
function randomSeats(
  playerCount: number,
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void,
): Policy[] {
  return Array.from({ length: playerCount }, () => random({ onSelectionChoices }));
}

/**
 * Replay a single game by its exact seed.
 *
 * Use this to reproduce a failure found by {@link simulateRandomGames}: pass the
 * `seed` and `playerCount` from the failing {@link SingleGameResult}.
 *
 * @example
 * ```typescript
 * const results = await simulateRandomGames(GoFishGame, { count: 100, playerCounts: [2] });
 * const failure = results.games.find(g => g.crashed || g.stuck);
 * if (failure) {
 *   // Deterministically reproduce the exact game that failed.
 *   const repro = await replayRandomGame(GoFishGame, {
 *     seed: failure.seed,
 *     playerCount: failure.playerCount,
 *   });
 * }
 * ```
 */
export async function replayRandomGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: ReplayRandomGameOptions<G>
): Promise<SingleGameResult> {
  const { seed, playerCount, timeout = 5000, maxActions = 10000, gameOptions, isResting } = options;
  return playGame({ gameClass: GameClass }, {
    playerCount,
    seed,
    policies: randomSeats(playerCount),
    timeout,
    maxActions,
    gameOptions,
    isResting,
  });
}

/**
 * How many of `count` games each player count plays: an even share, the first
 * counts taking the remainder. Refuses a split that would leave a count unplayed.
 */
function gamesPerPlayerCount(count: number, playerCounts: readonly number[]): Array<[number, number]> {
  if (playerCounts.length === 0) {
    throw new Error('simulateRandomGames: playerCounts is empty, so no game would run. List at least one player count, e.g. playerCounts: [2].');
  }
  if (count < playerCounts.length) {
    throw new Error(
      `simulateRandomGames: count ${count} is smaller than the ${playerCounts.length} player counts listed, ` +
        `so some player counts would never be played. Raise count to at least ${playerCounts.length} or list fewer player counts.`,
    );
  }
  const base = Math.floor(count / playerCounts.length);
  return playerCounts.map((playerCount, index) => [playerCount, base + (index < count % playerCounts.length ? 1 : 0)]);
}

/**
 * Simulate multiple random games to verify game completeness.
 *
 * Runs many games with random (but valid) moves to find bugs, verify all games
 * can complete, and check for edge cases across different player counts. Moves
 * and their arguments are generated from each action's own choice introspection,
 * so games whose actions take arguments are exercised correctly.
 *
 * Per-game seeds are derived deterministically from {@link SimulateRandomGamesOptions.seed}
 * (or a generated base seed, surfaced on {@link SimulationResults.seed}). Any failing
 * game can be reproduced with {@link replayRandomGame} using its reported `seed`.
 *
 * @param GameClass - The game class constructor
 * @param options - Simulation configuration
 * @returns Aggregated results including completion rate, errors, and timing
 * @throws Error when `playerCounts` is empty or `count` is smaller than its length
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
 * expect(results.stuck).toBe(0);
 * ```
 */
export async function simulateRandomGames<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: SimulateRandomGamesOptions<G>
): Promise<SimulationResults> {
  const {
    count,
    playerCounts,
    seed: baseSeed = crypto.randomUUID(),
    timeout = 5000,
    maxActions = 10000,
    onGameComplete,
    gameOptions,
  } = options;

  const games: SingleGameResult[] = [];
  const errors = new Set<string>();
  let total = 0;

  for (const [playerCount, share] of gamesPerPlayerCount(count, playerCounts)) {
    for (let i = 0; i < share; i++) {
      // Deterministic per-game seed: re-running with the same base seed
      // reproduces this exact game; the seed is also replayable on its own.
      const seed = gameSeed(baseSeed, playerCount, i);

      const result = await playGame({ gameClass: GameClass }, {
        playerCount,
        seed,
        policies: randomSeats(playerCount, options.onSelectionChoices),
        timeout,
        maxActions,
        gameOptions,
        isResting: options.isResting,
      });

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
  const stuck = games.filter(g => g.stuck).length;
  const resting = games.filter(g => g.resting).length;

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
    stuck,
    resting,
    total,
    games,
    averageActions,
    averageDuration,
    errors: [...errors],
    seed: baseSeed,
  };
}
