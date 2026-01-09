/**
 * Test game utilities for BoardSmith game development.
 *
 * Provides a convenient wrapper around GameRunner for writing game tests.
 *
 * @module
 */

import {
  Game,
  type GameOptions,
  type FlowState,
  type Player,
} from '@boardsmith/engine';
import { GameRunner, type ActionExecutionResult } from '@boardsmith/runtime';

/**
 * Options for creating a test game.
 */
export interface TestGameOptions {
  /** Number of players */
  playerCount: number;
  /** Player names (optional) */
  playerNames?: string[];
  /** Random seed for deterministic tests */
  seed?: string;
  /** Whether to auto-start the game */
  autoStart?: boolean;
}

/**
 * A test game wrapper that provides convenient testing utilities.
 *
 * Wraps a GameRunner and provides methods for performing actions,
 * checking game state, and inspecting players.
 *
 * @typeParam G - The game class type
 *
 * @example
 * ```typescript
 * const testGame = TestGame.create(GoFishGame, {
 *   playerCount: 2,
 *   seed: 'deterministic',
 * });
 *
 * testGame.doAction(0, 'ask', { target: 1, rank: 'K' });
 * expect(testGame.isComplete()).toBe(false);
 * ```
 */
export class TestGame<G extends Game = Game> {
  /** The underlying GameRunner instance */
  readonly runner: GameRunner<G>;
  /** The game instance */
  readonly game: G;

  private constructor(runner: GameRunner<G>) {
    this.runner = runner;
    this.game = runner.game;
  }

  /**
   * Create a new test game instance.
   *
   * @param GameClass - The game class constructor
   * @param options - Configuration options for the test game
   * @returns A new TestGame instance
   */
  static create<G extends Game>(
    GameClass: new (options: GameOptions) => G,
    options: TestGameOptions
  ): TestGame<G> {
    const seed = options.seed ?? `test-${Date.now()}`;
    const playerNames = options.playerNames ??
      Array.from({ length: options.playerCount }, (_, i) => `Player ${i + 1}`);

    const runner = new GameRunner({
      GameClass,
      gameType: GameClass.name.toLowerCase(),
      gameOptions: {
        playerCount: options.playerCount,
        playerNames,
        seed,
      },
    });

    const testGame = new TestGame(runner);

    if (options.autoStart !== false) {
      testGame.start();
    }

    return testGame;
  }

  /**
   * Start the game flow.
   *
   * @returns The initial flow state
   */
  start(): FlowState {
    return this.runner.start();
  }

  /**
   * Get the current flow state.
   *
   * @returns The current flow state, or undefined if not started
   */
  getFlowState(): FlowState | undefined {
    return this.runner.getFlowState();
  }

  /**
   * Check if the game is complete.
   *
   * @returns True if the game has ended
   */
  isComplete(): boolean {
    return this.runner.isComplete();
  }

  /**
   * Check if the game is awaiting player input.
   *
   * @returns True if the game is waiting for a player to act
   */
  isAwaitingInput(): boolean {
    return this.game.isAwaitingInput();
  }

  /**
   * Get the current player who should act.
   *
   * @returns The current player, or undefined if no player is active
   */
  getCurrentPlayer(): Player | undefined {
    const flowState = this.getFlowState();
    if (flowState?.currentPlayer !== undefined) {
      return this.game.players[flowState.currentPlayer];
    }
    return undefined;
  }

  /**
   * Get all players in the game.
   *
   * @returns Array of all players
   */
  getPlayers(): Player[] {
    return [...this.game.players];
  }

  /**
   * Get a player by index.
   *
   * @param index - The player position (0-indexed)
   * @returns The player at the given index
   * @throws Error if player index is out of bounds
   */
  getPlayer(index: number): Player {
    const player = this.game.players[index];
    if (!player) {
      throw new Error(`Player ${index} not found`);
    }
    return player;
  }

  /**
   * Perform an action as a player.
   *
   * @param playerIndex - The player performing the action (0-indexed)
   * @param actionName - The name of the action to perform
   * @param args - Arguments for the action
   * @returns The result of the action execution
   *
   * @example
   * ```typescript
   * const result = testGame.doAction(0, 'playCard', { card: myCard });
   * if (!result.success) {
   *   console.error(result.error);
   * }
   * ```
   */
  doAction(
    playerIndex: number,
    actionName: string,
    args: Record<string, unknown> = {}
  ): ActionExecutionResult {
    return this.runner.performAction(actionName, playerIndex, args);
  }

  /**
   * Get the winners of the game.
   *
   * @returns Array of winning players (empty if game not complete)
   */
  getWinners(): Player[] {
    return this.runner.getWinners();
  }

  /**
   * Get the history of all actions performed.
   *
   * @returns Array of action history entries
   */
  getActionHistory() {
    return [...this.runner.actionHistory];
  }

  /**
   * Get a snapshot of the current game state.
   *
   * @returns A serializable snapshot of the game
   */
  getSnapshot() {
    return this.runner.getSnapshot();
  }

  /**
   * Get a player's view of the game (with hidden information removed).
   *
   * @param playerIndex - The player whose view to get (0-indexed)
   * @returns The game state as visible to that player
   */
  getPlayerView(playerIndex: number) {
    return this.runner.getPlayerView(playerIndex);
  }
}

/**
 * Create a test game with the given configuration.
 *
 * Convenience function that wraps {@link TestGame.create}.
 *
 * @param GameClass - The game class constructor
 * @param options - Configuration options for the test game
 * @returns A new TestGame instance
 *
 * @example
 * ```typescript
 * import { createTestGame } from '@boardsmith/testing';
 * import { GoFishGame } from '../games/go-fish';
 *
 * test('player can ask for a card', () => {
 *   const game = createTestGame(GoFishGame, {
 *     playerCount: 2,
 *     seed: 'test-seed',
 *   });
 *
 *   const result = game.doAction(0, 'ask', { target: 1, rank: 'K' });
 *   expect(result.success).toBe(true);
 * });
 * ```
 */
export function createTestGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: TestGameOptions
): TestGame<G> {
  return TestGame.create(GameClass, options);
}
