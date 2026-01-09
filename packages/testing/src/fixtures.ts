/**
 * Fixture and scenario helpers for testing BoardSmith games.
 *
 * Provides utilities for creating test games with specific states,
 * running action sequences, and generating multiple test configurations.
 *
 * @module
 */

import type { Game, GameElement, GameOptions, Player } from '@boardsmith/engine';
import { TestGame, type TestGameOptions } from './test-game.js';

/**
 * Builder for creating test scenarios with specific game states.
 *
 * Use method chaining to configure player count, seed, and custom setup
 * functions before building the test game.
 *
 * @typeParam G - The game class type
 *
 * @example
 * ```typescript
 * const scenario = new ScenarioBuilder(MyGame)
 *   .withPlayers(2)
 *   .withSeed('deterministic-seed')
 *   .setup(game => {
 *     // Custom setup logic
 *     game.game.deck.shuffle();
 *   })
 *   .build();
 * ```
 */
export class ScenarioBuilder<G extends Game = Game> {
  private GameClass: new (options: GameOptions) => G;
  private options: TestGameOptions;
  private setupFunctions: Array<(testGame: TestGame<G>) => void> = [];

  /**
   * Create a new ScenarioBuilder for a game class.
   *
   * @param GameClass - The game class constructor
   */
  constructor(GameClass: new (options: GameOptions) => G) {
    this.GameClass = GameClass;
    this.options = { playerCount: 2 };
  }

  /**
   * Set the number of players.
   *
   * @param count - Number of players
   * @param names - Optional player names
   * @returns This builder for chaining
   */
  withPlayers(count: number, names?: string[]): this {
    this.options.playerCount = count;
    if (names) {
      this.options.playerNames = names;
    }
    return this;
  }

  /**
   * Set a deterministic seed for reproducible tests.
   *
   * @param seed - The random seed string
   * @returns This builder for chaining
   */
  withSeed(seed: string): this {
    this.options.seed = seed;
    return this;
  }

  /**
   * Add a custom setup function to run after game creation.
   *
   * Setup functions run before the game starts, allowing you to
   * manipulate the initial game state.
   *
   * @param fn - Function that receives the test game for setup
   * @returns This builder for chaining
   */
  setup(fn: (testGame: TestGame<G>) => void): this {
    this.setupFunctions.push(fn);
    return this;
  }

  /**
   * Build the test game with all configured options and setup.
   *
   * Runs all setup functions, then starts the game.
   *
   * @returns The configured and started test game
   */
  build(): TestGame<G> {
    const testGame = TestGame.create(this.GameClass, {
      ...this.options,
      autoStart: false,  // Don't auto-start so we can set up first
    });

    // Run all setup functions
    for (const setupFn of this.setupFunctions) {
      setupFn(testGame);
    }

    // Now start the game
    testGame.start();

    return testGame;
  }

  /**
   * Build without starting (for setup-only scenarios).
   *
   * Runs all setup functions but does not start the game flow.
   * Useful when you need to inspect or modify the game before starting.
   *
   * @returns The configured but not started test game
   */
  buildWithoutStart(): TestGame<G> {
    const testGame = TestGame.create(this.GameClass, {
      ...this.options,
      autoStart: false,
    });

    // Run all setup functions
    for (const setupFn of this.setupFunctions) {
      setupFn(testGame);
    }

    return testGame;
  }
}

/**
 * Create a scenario builder for a game class.
 *
 * Convenience function that creates a new {@link ScenarioBuilder}.
 *
 * @param GameClass - The game class constructor
 * @returns A new ScenarioBuilder instance
 *
 * @example
 * ```typescript
 * const testGame = scenario(MyGame)
 *   .withPlayers(3)
 *   .withSeed('test-seed')
 *   .setup(game => {
 *     // Custom setup logic
 *   })
 *   .build();
 * ```
 */
export function scenario<G extends Game>(
  GameClass: new (options: GameOptions) => G
): ScenarioBuilder<G> {
  return new ScenarioBuilder(GameClass);
}

/**
 * Quickly create a test game with minimal configuration.
 *
 * A shorthand for creating a test game when you just need player count and optional seed.
 *
 * @param GameClass - The game class constructor
 * @param playerCount - Number of players
 * @param seed - Optional random seed for deterministic tests
 * @returns A started test game
 *
 * @example
 * ```typescript
 * const game = quickGame(MyGame, 2);  // 2 players
 * const game = quickGame(MyGame, 4, 'test-seed');  // 4 players, seeded
 * ```
 */
export function quickGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  playerCount: number,
  seed?: string
): TestGame<G> {
  return TestGame.create(GameClass, {
    playerCount,
    seed,
  });
}

/**
 * Run a sequence of actions and return the final state.
 *
 * Creates a test game, then executes the provided actions in order.
 * Useful for setting up a game to a specific point for testing.
 *
 * @param GameClass - The game class constructor
 * @param options - Test game configuration options
 * @param actions - Array of actions to perform in sequence
 * @returns The test game after all actions have been performed
 * @throws Error if any action in the sequence fails
 *
 * @example
 * ```typescript
 * const testGame = playSequence(MyGame, { playerCount: 2 }, [
 *   { player: 0, action: 'move', args: { to: 'A1' } },
 *   { player: 1, action: 'move', args: { to: 'B2' } },
 *   { player: 0, action: 'attack', args: { target: 'B2' } },
 * ]);
 * ```
 */
export function playSequence<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: TestGameOptions,
  actions: Array<{ player: number; action: string; args?: Record<string, unknown> }>
): TestGame<G> {
  const testGame = TestGame.create(GameClass, options);

  for (const { player, action, args } of actions) {
    const result = testGame.doAction(player, action, args ?? {});
    if (!result.success) {
      throw new Error(
        `Action "${action}" by player ${player} failed: ${result.error ?? 'unknown error'}`
      );
    }
  }

  return testGame;
}

/**
 * Play random moves until a condition is met or max moves reached.
 *
 * Picks random available actions and executes them until the condition
 * returns true, the game completes, or max moves is reached.
 * Useful for getting to mid-game states quickly.
 *
 * @param testGame - The test game to play
 * @param condition - Function that returns true when play should stop
 * @param maxMoves - Maximum number of moves before stopping (default: 1000)
 * @returns The test game after playing
 *
 * @example
 * ```typescript
 * const testGame = playUntil(game, g => g.game.turn >= 5);  // Play until turn 5
 * const testGame = playUntil(game, g => g.isComplete(), 100);  // Play to completion
 * ```
 */
export function playUntil<G extends Game>(
  testGame: TestGame<G>,
  condition: (testGame: TestGame<G>) => boolean,
  maxMoves: number = 1000
): TestGame<G> {
  let moves = 0;

  while (!condition(testGame) && moves < maxMoves && !testGame.isComplete()) {
    const flowState = testGame.getFlowState();
    if (!flowState?.availableActions?.length || flowState.currentPlayer === undefined) {
      break;
    }

    // Pick a random action
    const actionName = flowState.availableActions[
      Math.floor(Math.random() * flowState.availableActions.length)
    ];

    // For now, just try the action with empty args
    // A more sophisticated version would generate valid args
    try {
      testGame.doAction(flowState.currentPlayer, actionName, {});
    } catch {
      // Action failed, try next
    }

    moves++;
  }

  return testGame;
}

/**
 * Create multiple test games with different configurations.
 *
 * Creates one test game for each configuration in the array.
 * Useful for parameterized testing across different player counts or seeds.
 *
 * @param GameClass - The game class constructor
 * @param configurations - Array of test game configurations
 * @returns Array of configured test games
 *
 * @example
 * ```typescript
 * const games = createMultiple(MyGame, [
 *   { playerCount: 2, seed: 'two-player' },
 *   { playerCount: 3, seed: 'three-player' },
 *   { playerCount: 4, seed: 'four-player' },
 * ]);
 *
 * for (const game of games) {
 *   // Test each configuration
 * }
 * ```
 */
export function createMultiple<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  configurations: TestGameOptions[]
): TestGame<G>[] {
  return configurations.map(config => TestGame.create(GameClass, config));
}
