import type { Game } from '@boardsmith/engine';
import type { TestGame } from './test-game.js';
import type { ActionExecutionResult } from '@boardsmith/runtime';

/**
 * Result of simulating an action, with additional test utilities
 */
export interface SimulateActionResult extends ActionExecutionResult {
  /** The action that was attempted */
  action: string;
  /** The player who attempted the action */
  playerIndex: number;
  /** The arguments passed to the action */
  args: Record<string, unknown>;
}

/**
 * Simulate a player action and return the result
 *
 * @example
 * ```typescript
 * const result = simulateAction(testGame, 0, 'ask', {
 *   target: 1,
 *   rank: '8',
 * });
 *
 * expect(result.success).toBe(true);
 * ```
 */
export function simulateAction<G extends Game>(
  testGame: TestGame<G>,
  playerIndex: number,
  actionName: string,
  args: Record<string, unknown> = {}
): SimulateActionResult {
  const result = testGame.doAction(playerIndex, actionName, args);

  return {
    ...result,
    action: actionName,
    playerIndex,
    args,
  };
}

/**
 * Simulate multiple actions in sequence
 *
 * @example
 * ```typescript
 * const results = simulateActions(testGame, [
 *   [0, 'ask', { target: 1, rank: '8' }],
 *   [1, 'ask', { target: 0, rank: 'K' }],
 * ]);
 *
 * expect(results.every(r => r.success)).toBe(true);
 * ```
 */
export function simulateActions<G extends Game>(
  testGame: TestGame<G>,
  actions: Array<[playerIndex: number, actionName: string, args?: Record<string, unknown>]>
): SimulateActionResult[] {
  return actions.map(([playerIndex, actionName, args]) =>
    simulateAction(testGame, playerIndex, actionName, args ?? {})
  );
}

/**
 * Assert that an action succeeds
 * Throws an error with details if the action fails
 */
export function assertActionSucceeds<G extends Game>(
  testGame: TestGame<G>,
  playerIndex: number,
  actionName: string,
  args: Record<string, unknown> = {}
): SimulateActionResult {
  const result = simulateAction(testGame, playerIndex, actionName, args);

  if (!result.success) {
    throw new Error(
      `Expected action '${actionName}' by player ${playerIndex} to succeed, but it failed: ${result.error}`
    );
  }

  return result;
}

/**
 * Assert that an action fails
 * Throws an error if the action succeeds
 */
export function assertActionFails<G extends Game>(
  testGame: TestGame<G>,
  playerIndex: number,
  actionName: string,
  args: Record<string, unknown> = {},
  expectedError?: string | RegExp
): SimulateActionResult {
  const result = simulateAction(testGame, playerIndex, actionName, args);

  if (result.success) {
    throw new Error(
      `Expected action '${actionName}' by player ${playerIndex} to fail, but it succeeded`
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
