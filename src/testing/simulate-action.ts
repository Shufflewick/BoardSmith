/**
 * Action simulation utilities for testing BoardSmith games.
 *
 * Provides functions to simulate player actions and assert on their outcomes.
 *
 * @module
 */

import type { Game } from '../engine/index.js';
import type { TestGame } from './test-game.js';
import type { ActionExecutionResult } from '../runtime/index.js';

/**
 * Result of simulating an action, with additional test context.
 */
export interface SimulateActionResult extends ActionExecutionResult {
  /** The action that was attempted */
  action: string;
  /** The player who attempted the action */
  playerSeat: number;
  /** The arguments passed to the action */
  args: Record<string, unknown>;
}

/**
 * Simulate a player action and return the result.
 *
 * Wraps the action execution with additional context about what was attempted,
 * making test assertions easier to write and debug.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat performing the action (1-indexed)
 * @param actionName - The name of the action to perform
 * @param args - Arguments for the action
 * @returns The action result with additional context
 *
 * @example
 * ```typescript
 * const result = simulateAction(testGame, 1, 'ask', {
 *   target: 2,
 *   rank: '8',
 * });
 *
 * expect(result.success).toBe(true);
 * ```
 */
export function simulateAction<G extends Game>(
  testGame: TestGame<G>,
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {}
): SimulateActionResult {
  const result = testGame.doAction(playerSeat, actionName, args);

  return {
    ...result,
    action: actionName,
    playerSeat,
    args,
  };
}

/**
 * Simulate multiple actions in sequence.
 *
 * Executes each action in order, returning results for all.
 * Useful for setting up a game state by replaying a series of moves.
 *
 * @param testGame - The test game instance
 * @param actions - Array of actions to perform, each as [playerSeat, actionName, args?]
 * @returns Array of action results in order
 *
 * @example
 * ```typescript
 * const results = simulateActions(testGame, [
 *   [1, 'ask', { target: 2, rank: '8' }],
 *   [2, 'ask', { target: 1, rank: 'K' }],
 * ]);
 *
 * expect(results.every(r => r.success)).toBe(true);
 * ```
 */
export function simulateActions<G extends Game>(
  testGame: TestGame<G>,
  actions: Array<[playerSeat: number, actionName: string, args?: Record<string, unknown>]>
): SimulateActionResult[] {
  return actions.map(([playerSeat, actionName, args]) =>
    simulateAction(testGame, playerSeat, actionName, args ?? {})
  );
}

/**
 * Assert that an action succeeds.
 *
 * Performs the action and throws an error with details if it fails.
 * Useful for actions that should always succeed in a valid game state.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat performing the action (1-indexed)
 * @param actionName - The name of the action to perform
 * @param args - Arguments for the action
 * @returns The action result (always successful if no error thrown)
 * @throws Error if the action fails, with details about why
 *
 * @example
 * ```typescript
 * // This will throw if the action fails
 * assertActionSucceeds(testGame, 1, 'drawCard');
 * ```
 */
export function assertActionSucceeds<G extends Game>(
  testGame: TestGame<G>,
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {}
): SimulateActionResult {
  const result = simulateAction(testGame, playerSeat, actionName, args);

  if (!result.success) {
    throw new Error(
      `Expected action '${actionName}' by player ${playerSeat} to succeed, but it failed: ${result.error}`
    );
  }

  return result;
}

/**
 * Assert that an action fails.
 *
 * Performs the action and throws an error if it succeeds.
 * Optionally verifies the error message matches an expected pattern.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat performing the action (1-indexed)
 * @param actionName - The name of the action to perform
 * @param args - Arguments for the action
 * @param expectedError - Optional string or regex that the error should match
 * @returns The action result (always failed if no error thrown)
 * @throws Error if the action succeeds, or if expectedError is provided and doesn't match
 *
 * @example
 * ```typescript
 * // Assert the action fails
 * assertActionFails(testGame, 1, 'playCard', { card: wrongCard });
 *
 * // Assert the action fails with specific error message
 * assertActionFails(testGame, 1, 'playCard', { card: wrongCard }, 'not your turn');
 * ```
 */
export function assertActionFails<G extends Game>(
  testGame: TestGame<G>,
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {},
  expectedError?: string | RegExp
): SimulateActionResult {
  const result = simulateAction(testGame, playerSeat, actionName, args);

  if (result.success) {
    throw new Error(
      `Expected action '${actionName}' by player ${playerSeat} to fail, but it succeeded`
    );
  }

  if (expectedError) {
    const errorMatches = typeof expectedError === 'string'
      ? result.error?.includes(expectedError)
      : expectedError.test(result.error ?? '');

    if (!errorMatches) {
      throw new Error(
        `Expected error to match ${expectedError}, but got: ${result.error}`
      );
    }
  }

  return result;
}
