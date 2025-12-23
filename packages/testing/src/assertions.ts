import type { Game, GameElement, Player } from '@boardsmith/engine';
import type { TestGame } from './test-game.js';

/**
 * Expected flow state for assertions
 */
export interface ExpectedFlowState {
  /** Player position who should be acting */
  currentPlayer?: number;
  /** Actions that should be available */
  actions?: string[];
  /** Whether game should be complete */
  complete?: boolean;
  /** Whether game should be awaiting input */
  awaitingInput?: boolean;
  /** Current phase name */
  phase?: string;
}

/**
 * Result of a flow state assertion
 */
export interface FlowStateAssertionResult {
  passed: boolean;
  message: string;
  expected: ExpectedFlowState;
  actual: {
    currentPlayer?: number;
    actions?: string[];
    complete: boolean;
    awaitingInput: boolean;
    phase?: string;
  };
}

/**
 * Assert that the game flow is in the expected state.
 *
 * @example
 * ```typescript
 * assertFlowState(testGame, {
 *   currentPlayer: 0,
 *   actions: ['move', 'attack'],
 *   awaitingInput: true,
 * });
 * ```
 */
export function assertFlowState(
  testGame: TestGame,
  expected: ExpectedFlowState
): FlowStateAssertionResult {
  const flowState = testGame.getFlowState();
  const errors: string[] = [];

  const actual = {
    currentPlayer: flowState?.currentPlayer,
    actions: flowState?.availableActions,
    complete: testGame.isComplete(),
    awaitingInput: testGame.isAwaitingInput(),
    phase: flowState?.currentPhase,
  };

  if (expected.currentPlayer !== undefined && actual.currentPlayer !== expected.currentPlayer) {
    errors.push(`Expected current player ${expected.currentPlayer}, got ${actual.currentPlayer}`);
  }

  if (expected.complete !== undefined && actual.complete !== expected.complete) {
    errors.push(`Expected complete=${expected.complete}, got ${actual.complete}`);
  }

  if (expected.awaitingInput !== undefined && actual.awaitingInput !== expected.awaitingInput) {
    errors.push(`Expected awaitingInput=${expected.awaitingInput}, got ${actual.awaitingInput}`);
  }

  if (expected.phase !== undefined && actual.phase !== expected.phase) {
    errors.push(`Expected phase="${expected.phase}", got "${actual.phase}"`);
  }

  if (expected.actions !== undefined) {
    const missingActions = expected.actions.filter(a => !actual.actions?.includes(a));
    if (missingActions.length > 0) {
      errors.push(`Missing expected actions: ${missingActions.join(', ')}`);
    }
  }

  const passed = errors.length === 0;
  const message = passed ? 'Flow state matches expected' : errors.join('; ');

  if (!passed) {
    throw new Error(`Flow state assertion failed: ${message}`);
  }

  return { passed, message, expected, actual };
}

/**
 * Assert that a player has specific elements in a zone.
 *
 * @example
 * ```typescript
 * assertPlayerHas(testGame, 0, 'hand', Card, 5);  // Player 0 has 5 cards in hand
 * assertPlayerHas(testGame, 1, 'army', Soldier, { min: 2 });  // Player 1 has at least 2 soldiers
 * ```
 */
export function assertPlayerHas<E extends GameElement>(
  testGame: TestGame,
  playerIndex: number,
  zoneName: string,
  elementClass: new (...args: any[]) => E,
  countOrOptions: number | { min?: number; max?: number; exact?: number }
): void {
  const player = testGame.getPlayer(playerIndex) as any;
  const zone = player[zoneName];

  if (!zone) {
    throw new Error(`Player ${playerIndex} has no zone named "${zoneName}"`);
  }

  const count = zone.count(elementClass);
  const options = typeof countOrOptions === 'number' ? { exact: countOrOptions } : countOrOptions;

  if (options.exact !== undefined && count !== options.exact) {
    throw new Error(
      `Expected player ${playerIndex} to have exactly ${options.exact} ${elementClass.name}(s) in ${zoneName}, got ${count}`
    );
  }

  if (options.min !== undefined && count < options.min) {
    throw new Error(
      `Expected player ${playerIndex} to have at least ${options.min} ${elementClass.name}(s) in ${zoneName}, got ${count}`
    );
  }

  if (options.max !== undefined && count > options.max) {
    throw new Error(
      `Expected player ${playerIndex} to have at most ${options.max} ${elementClass.name}(s) in ${zoneName}, got ${count}`
    );
  }
}

/**
 * Assert that the game has a specific number of elements of a type.
 *
 * @example
 * ```typescript
 * assertElementCount(testGame, Card, 52);  // Game has 52 cards total
 * assertElementCount(testGame, Piece, { min: 1 });  // At least one piece exists
 * ```
 */
export function assertElementCount<E extends GameElement>(
  testGame: TestGame,
  elementClass: new (...args: any[]) => E,
  countOrOptions: number | { min?: number; max?: number; exact?: number }
): void {
  // Use all() instead of count() to work with basic constructor types
  const count = testGame.game.all(elementClass as any).length;
  const options = typeof countOrOptions === 'number' ? { exact: countOrOptions } : countOrOptions;

  if (options.exact !== undefined && count !== options.exact) {
    throw new Error(
      `Expected exactly ${options.exact} ${elementClass.name}(s) in game, got ${count}`
    );
  }

  if (options.min !== undefined && count < options.min) {
    throw new Error(
      `Expected at least ${options.min} ${elementClass.name}(s) in game, got ${count}`
    );
  }

  if (options.max !== undefined && count > options.max) {
    throw new Error(
      `Expected at most ${options.max} ${elementClass.name}(s) in game, got ${count}`
    );
  }
}

/**
 * Assert that the game is finished with expected winner(s).
 *
 * @example
 * ```typescript
 * assertGameFinished(testGame, { winner: 0 });  // Player 0 won
 * assertGameFinished(testGame, { winners: [0, 1] });  // Draw between players 0 and 1
 * assertGameFinished(testGame);  // Just assert game is finished
 * ```
 */
export function assertGameFinished(
  testGame: TestGame,
  options?: { winner?: number; winners?: number[] }
): void {
  if (!testGame.isComplete()) {
    throw new Error('Expected game to be finished, but it is not complete');
  }

  if (options?.winner !== undefined) {
    const winners = testGame.getWinners();
    if (winners.length !== 1 || winners[0].position !== options.winner) {
      const actualWinners = winners.map(w => w.position).join(', ');
      throw new Error(`Expected player ${options.winner} to win, but winners are: [${actualWinners}]`);
    }
  }

  if (options?.winners !== undefined) {
    const winners = testGame.getWinners();
    const actualPositions = winners.map(w => w.position).sort();
    const expectedPositions = [...options.winners].sort();

    if (actualPositions.length !== expectedPositions.length ||
        !actualPositions.every((p, i) => p === expectedPositions[i])) {
      throw new Error(
        `Expected winners [${expectedPositions.join(', ')}], but got [${actualPositions.join(', ')}]`
      );
    }
  }
}

/**
 * Assert that a specific action is available for a player.
 *
 * @example
 * ```typescript
 * assertActionAvailable(testGame, 0, 'move');
 * assertActionAvailable(testGame, 1, 'attack', { withChoices: true });
 * ```
 */
export function assertActionAvailable(
  testGame: TestGame,
  playerIndex: number,
  actionName: string,
  options?: { withChoices?: boolean }
): void {
  const flowState = testGame.getFlowState();

  if (flowState?.currentPlayer !== playerIndex) {
    throw new Error(
      `Cannot check action availability for player ${playerIndex} - current player is ${flowState?.currentPlayer}`
    );
  }

  const availableActions = flowState?.availableActions ?? [];
  if (!availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" is not available for player ${playerIndex}. Available actions: [${availableActions.join(', ')}]`
    );
  }

  // TODO: Add withChoices validation when action tracing is available
}

/**
 * Assert that a specific action is NOT available for a player.
 *
 * @example
 * ```typescript
 * assertActionNotAvailable(testGame, 0, 'move');  // Player can't move
 * ```
 */
export function assertActionNotAvailable(
  testGame: TestGame,
  playerIndex: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  // If it's not this player's turn, action is definitely not available
  if (flowState?.currentPlayer !== playerIndex) {
    return;
  }

  const availableActions = flowState?.availableActions ?? [];
  if (availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" should NOT be available for player ${playerIndex}, but it is`
    );
  }
}
