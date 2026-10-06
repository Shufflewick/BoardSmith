/**
 * Assertion helpers for testing BoardSmith games.
 *
 * Provides test assertions for action availability, action failure and
 * per-seat element visibility.
 *
 * @module
 */

import type { TestGame } from './test-game.js';
import { canSeatAct, availableActionsForSeat, type GameElement } from '../engine/index.js';
import { formatSelectionLines } from './debug.js';
import { isElementVisible } from './visibility.js';
import type { ActionExecutionResult } from '../runtime/index.js';

/**
 * Assert that an action fails.
 *
 * Performs the action with `testGame.tryAction` and throws if it succeeds.
 * Optionally checks that the error matches an expected string or pattern. To
 * run an action that should succeed, call `testGame.doAction`, which throws
 * with the full availability trace when it does not.
 *
 * @param testGame - The test game instance
 * @param playerSeat - The player seat performing the action (1-indexed)
 * @param actionName - The name of the action to perform
 * @param args - Arguments for the action
 * @param expectedError - Optional string the error must contain, or regex it must match
 * @returns The failed action result
 * @throws Error if the action succeeds, or if expectedError is given and doesn't match
 *
 * @example
 * ```typescript
 * assertActionFails(testGame, 1, 'playCard', { card: wrongCard });
 * assertActionFails(testGame, 1, 'playCard', { card: wrongCard }, 'not your turn');
 * ```
 */
export function assertActionFails(
  testGame: TestGame,
  playerSeat: number,
  actionName: string,
  args: Record<string, unknown> = {},
  expectedError?: string | RegExp
): ActionExecutionResult {
  const result = testGame.tryAction(playerSeat, actionName, args);

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
      `awaitingPlayers=${JSON.stringify(flowState?.awaitingPlayers ?? [])}\n` +
      `Flow position: ${testGame.game.getFlowDebugInfo().describe()}\n` +
      `Seed: ${testGame.seed}`
    );
  }

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (!availableActions.includes(actionName)) {
    // Resolve the player object and call debugActionAvailability to produce an
    // actionable trace — called ONLY on the failure path (no perf regression).
    const player = testGame.getPlayer(playerSeat);
    const debugInfo = testGame.game.debugActionAvailability(actionName, player);
    const selLines = formatSelectionLines(debugInfo);
    throw new Error(
      `Action "${actionName}" is not available for player ${playerSeat}.\n` +
      `Available actions: [${availableActions.join(', ')}]\n` +
      `Why: ${debugInfo.reason}` +
      (selLines ? `\nSelections:\n${selLines}` : '') +
      `\nFlow position: ${testGame.game.getFlowDebugInfo().describe()}\n` +
      `Seed: ${testGame.seed}`
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

  // If the seat cannot act at all, the action is definitely not available.
  // Uses canSeatAct() to handle both sequential (currentPlayer) and
  // simultaneous (awaitingPlayers) turns correctly.
  if (!canSeatAct(flowState, playerSeat)) {
    return;
  }

  const availableActions = availableActionsForSeat(flowState, playerSeat);
  if (availableActions.includes(actionName)) {
    throw new Error(
      `Action "${actionName}" should NOT be available for player ${playerSeat}, but it is`
    );
  }
}

/**
 * Find the node for a given real element id in a serialized ElementJSON tree
 * (depth-first). Returns `undefined` if absent from the final tree.
 */
function findNodeInFinalTree(
  node: { id: number; attributes?: Record<string, unknown>; children?: unknown[] },
  id: number
): { id: number; attributes?: Record<string, unknown>; children?: unknown[] } | undefined {
  if (node.id === id) return node;
  if (!node.children) return undefined;
  for (const child of node.children as typeof node[]) {
    const found = findNodeInFinalTree(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * The attribute keys that SURVIVE into seat N's FINAL serialized view for
 * `element` — i.e. the keys visible on the wire, not the raw unfiltered
 * `element.toJSON().attributes` (which would misreport keys a `playerView`
 * hook stripped). Returns an empty array if the element is absent from the
 * final tree entirely.
 */
function survivingAttributeKeys(element: GameElement, seat: number): string[] {
  const finalTree = element.game.toJSONForPlayer(seat);
  const node = findNodeInFinalTree(finalTree, element.id);
  if (!node) return [];
  return Object.keys(node.attributes ?? {}).filter((k) => k !== '__hidden');
}

/**
 * Assert that `element` is hidden from `seat` — judged on the exact final
 * per-seat wire output (see {@link isElementVisible}), so this honors any
 * `static playerView` post-transform the game defines, not just the
 * per-element visibility rule.
 *
 * @param element - The live element expected to be hidden
 * @param seat - The seat expected NOT to see `element`
 * @throws Error naming the element, the seat, and the attribute keys that
 *   survive into seat N's final view, if `element` is actually visible
 *
 * @example
 * ```typescript
 * assertHidden(opponentCard, 1); // player 1 must not see this card
 * ```
 */
export function assertHidden(element: GameElement, seat: number): void {
  if (isElementVisible(element, seat)) {
    const keys = survivingAttributeKeys(element, seat);
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is visible to seat ${seat} ` +
      `(expected hidden): serialized attributes [${keys.join(', ')}] present in seat ${seat}'s view`
    );
  }
}

/**
 * Assert that `element` is visible to `seat` — judged on the exact final
 * per-seat wire output (see {@link isElementVisible}).
 *
 * @param element - The live element expected to be visible
 * @param seat - The seat expected to see `element`
 * @throws Error naming the element and the seat, if `element` is actually hidden
 *
 * @example
 * ```typescript
 * assertVisible(myCard, 1); // player 1 must see their own card
 * ```
 */
export function assertVisible(element: GameElement, seat: number): void {
  if (!isElementVisible(element, seat)) {
    throw new Error(
      `Element ${element.constructor.name}#${element.id} is NOT visible to seat ${seat} ` +
      `(expected visible)`
    );
  }
}
