import {
  Game,
  type GameOptions,
  type FlowState,
  type Player,
} from '@boardsmith/engine';
import { GameRunner, type ActionExecutionResult } from '@boardsmith/runtime';

/**
 * Options for creating a test game
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
 * A test game wrapper that provides convenient testing utilities
 */
export class TestGame<G extends Game = Game> {
  readonly runner: GameRunner<G>;
  readonly game: G;

  private constructor(runner: GameRunner<G>) {
    this.runner = runner;
    this.game = runner.game;
  }

  /**
   * Create a new test game instance
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
   * Start the game flow
   */
  start(): FlowState {
    return this.runner.start();
  }

  /**
   * Get current flow state
   */
  getFlowState(): FlowState | undefined {
    return this.runner.getFlowState();
  }

  /**
   * Check if game is complete
   */
  isComplete(): boolean {
    return this.runner.isComplete();
  }

  /**
   * Check if game is awaiting player input
   */
  isAwaitingInput(): boolean {
    return this.game.isAwaitingInput();
  }

  /**
   * Get the current player (if any)
   */
  getCurrentPlayer(): Player | undefined {
    const flowState = this.getFlowState();
    if (flowState?.currentPlayer !== undefined) {
      return this.game.players[flowState.currentPlayer];
    }
    return undefined;
  }

  /**
   * Get all players
   */
  getPlayers(): Player[] {
    return [...this.game.players];
  }

  /**
   * Get a player by index
   */
  getPlayer(index: number): Player {
    const player = this.game.players[index];
    if (!player) {
      throw new Error(`Player ${index} not found`);
    }
    return player;
  }

  /**
   * Perform an action
   */
  doAction(
    playerIndex: number,
    actionName: string,
    args: Record<string, unknown> = {}
  ): ActionExecutionResult {
    return this.runner.performAction(actionName, playerIndex, args);
  }

  /**
   * Get the winners (if game is complete)
   */
  getWinners(): Player[] {
    return this.runner.getWinners();
  }

  /**
   * Get action history
   */
  getActionHistory() {
    return [...this.runner.actionHistory];
  }

  /**
   * Get a snapshot of the current game state
   */
  getSnapshot() {
    return this.runner.getSnapshot();
  }

  /**
   * Get a player's view of the game
   */
  getPlayerView(playerIndex: number) {
    return this.runner.getPlayerView(playerIndex);
  }
}

/**
 * Create a test game with the given configuration
 * Convenience function that wraps TestGame.create
 */
export function createTestGame<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  options: TestGameOptions
): TestGame<G> {
  return TestGame.create(GameClass, options);
}
