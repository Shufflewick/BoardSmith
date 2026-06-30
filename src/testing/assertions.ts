/**
 * Assertion helpers for testing BoardSmith games.
 *
 * Provides test assertions for checking game state, player elements,
 * action availability, and game completion.
 *
 * @module
 */

import type { TestGame } from './test-game.js';
import { canSeatAct, availableActionsForSeat } from '../engine/index.js';

/**
 * Expected flow state for assertions.
 */
export interface ExpectedFlowState {
  /** Player position who should be acting */
  currentPlayer?: number;
  /**
   * Actions that should be available.
   *
   * Use `actionsMode` to control whether this must be an exact set or a subset:
   * - `'exact'` (default) — both missing AND extra actions fail the assertion.
   * - `'contains'` — only missing actions fail; extra available actions are allowed.
   */
  actions?: string[];
  /**
   * How to compare the `actions` list against available actions.
   *
   * - `'exact'` (default) — the available actions must match `actions` exactly;
   *   both missing and extra actions are assertion failures.
   *   This is backward-compatible with the pre-actionsMode behavior (D-06).
   * - `'contains'` — only checks that every action in `actions` is available;
   *   extra available actions are permitted. Opt into this for tests that only
   *   care about a subset of actions being present.
   */
  actionsMode?: 'exact' | 'contains';
  /** Whether game should be complete */
  complete?: boolean;
  /** Whether game should be awaiting input */
  awaitingInput?: boolean;
  /** Current phase name */
  phase?: string;
}

/**
 * Result of a flow state assertion.
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
 * Checks any combination of: current player, available actions,
 * completion status, awaiting input status, and phase.
 *
 * @param testGame - The test game instance
 * @param expected - The expected flow state properties
 * @returns The assertion result with actual vs expected values
 * @throws Error if any expected property doesn't match
 *
 * @example
 * ```typescript
 * assertFlowState(testGame, {
 *   currentPlayer: 1,
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
    const actualActions = actual.actions ?? [];
    const missingActions = expected.actions.filter(a => !actualActions.includes(a));
    if (missingActions.length > 0) {
      errors.push(`Missing expected actions: ${missingActions.join(', ')}`);
    }
    // Extra-actions check: only runs in 'exact' mode (default).
    // Use actionsMode:'contains' to allow extra available actions.
    const mode = expected.actionsMode ?? 'exact';
    if (mode === 'exact') {
      const extraActions = actualActions.filter(a => !expected.actions!.includes(a));
      if (extraActions.length > 0) {
        errors.push(`Unexpected available actions: ${extraActions.join(', ')}`);
      }
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
 * Assert that the game is finished with expected winner(s).
 *
 * Verifies the game is complete and optionally checks the winning player(s).
 *
 * @param testGame - The test game instance
 * @param options - Optional winner constraints: { winner } for single winner, { winners } for multiple
 * @throws Error if game is not complete or winners don't match
 *
 * @example
 * ```typescript
 * assertGameFinished(testGame, { winner: 1 });  // Player 1 won
 * assertGameFinished(testGame, { winners: [1, 2] });  // Draw between players 1 and 2
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
    if (winners.length !== 1 || winners[0].seat !== options.winner) {
      const actualWinners = winners.map(w => w.seat).join(', ');
      throw new Error(`Expected player ${options.winner} to win, but winners are: [${actualWinners}]`);
    }
  }

  if (options?.winners !== undefined) {
    const winners = testGame.getWinners();
    const actualPositions = winners.map(w => w.seat).sort();
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
 * Verifies that it's the player's turn and the action is in their available actions.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat to check (1-indexed)
 * @param actionName - The action that should be available
 * @throws Error if it's not the player's turn or action is not available
 *
 * @example
 * ```typescript
 * assertActionAvailable(testGame, 1, 'move');
 * ```
 */
export function assertActionAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  if (!canSeatAct(flowState, playerSeat)) {
    throw new Error(
      `Cannot check action availability for player ${playerSeat} — seat is not active. ` +
      `currentPlayer=${flowState?.currentPlayer}, ` +
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}`
    );
  }

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    // Resolve the player object and call debugActionAvailability to produce an
    // actionable trace — called ONLY on the failure path (no perf regression).
    const player = testGame.getPlayer(playerSeat);
    const debugInfo = testGame.game.debugActionAvailability(actionName, player);
    const selLines = debugInfo.details.selections
      .map(s =>
        `  ${s.passed ? '✓' : '✗'} '${s.name}': ${s.choices} choices${s.note ? ` — ${s.note}` : ''}`
      )
      .join('\n');
    throw new Error(
      `Action "${actionName}" is not available for player ${playerSeat}.\n` +
      `Available actions: [${availableActions.join(', ')}]\n` +
      `Why: ${debugInfo.reason}` +
      (selLines ? `\nSelections:\n${selLines}` : '')
    );
  }
}

/**
 * Assert that a specific action is NOT available for a player.
 *
 * Passes if it's not the player's turn or if the action is not in their available actions.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat to check (1-indexed)
 * @param actionName - The action that should not be available
 * @throws Error if the action is available for this player
 *
 * @example
 * ```typescript
 * assertActionNotAvailable(testGame, 1, 'move');  // Player can't move
 * ```
 */
export function assertActionNotAvailable(
  testGame: TestGame,
  playerSeat: number,
  actionName: string
): void {
  const flowState = testGame.getFlowState();

  // If it's not this player's turn, action is definitely not available
  if (flowState?.currentPlayer !== playerSeat) {
    return;
  }

  const availableActions = flowState?.availableActions ?? [];
  if (availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" should NOT be available for player ${playerSeat}, but it is`
    );
  }
}
