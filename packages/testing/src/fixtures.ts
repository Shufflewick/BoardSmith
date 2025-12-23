import type { Game, GameElement, GameOptions, Player } from '@boardsmith/engine';
import { TestGame, type TestGameOptions } from './test-game.js';

/**
 * Builder for creating test scenarios with specific game states.
 *
 * @example
 * ```typescript
 * const scenario = new ScenarioBuilder(MyGame)
 *   .withPlayers(2)
 *   .withSeed('deterministic-seed')
 *   .setupHand(0, [card1, card2, card3])
 *   .setupBoard({ 'A1': piece1, 'B2': piece2 })
 *   .build();
 * ```
 */
export class ScenarioBuilder<G extends Game = Game> {
  private GameClass: new (options: GameOptions) => G;
  private options: TestGameOptions;
  private setupFunctions: Array<(testGame: TestGame<G>) => void> = [];

  constructor(GameClass: new (options: GameOptions) => G) {
    this.GameClass = GameClass;
    this.options = { playerCount: 2 };
  }

  /**
   * Set the number of players
   */
  withPlayers(count: number, names?: string[]): this {
    this.options.playerCount = count;
    if (names) {
      this.options.playerNames = names;
    }
    return this;
  }

  /**
   * Set a deterministic seed for reproducible tests
   */
  withSeed(seed: string): this {
    this.options.seed = seed;
    return this;
  }

  /**
   * Add a custom setup function to run after game creation
   */
  setup(fn: (testGame: TestGame<G>) => void): this {
    this.setupFunctions.push(fn);
    return this;
  }

  /**
   * Build the test game with all configured options and setup
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
   * Build without starting (for setup-only scenarios)
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
 * Helper to quickly create a test game with common options.
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
 * Useful for setting up a game to a specific point.
 *
 * @example
 * ```typescript
 * const testGame = await playSequence(MyGame, { playerCount: 2 }, [
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
 * Useful for getting to mid-game states quickly.
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
 * Useful for parameterized testing.
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
