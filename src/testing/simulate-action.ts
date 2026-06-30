/**
 * Action simulation utilities for testing BoardSmith games.
 *
 * Provides functions to simulate player actions and assert on their outcomes.
 *
 * @module
 */

import type { Game, FlowState } from '../engine/index.js';
import { enumerateLegalMoves } from '../engine/index.js';
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

// ─── playUntilComplete + GameStuckError (TEST-02) ────────────────────────────

/**
 * Thrown by `playUntilComplete` when the game cannot progress:
 * either all active seats have zero legal moves (dead-end) or the iteration
 * cap `maxMoves` was reached before the game completed.
 *
 * The structured fields make it easy to diagnose *why* the game got stuck —
 * check `availableActions` for what the engine thinks is callable, and
 * `flowState` for the full flow snapshot at the moment of failure.
 */
export class GameStuckError extends Error {
  /** Always `'GameStuckError'` — safe for `error.name` switch/comparisons. */
  readonly name = 'GameStuckError' as const;
  /** The iteration index at which the loop stopped (0-based for dead-end; equals maxMoves for cap). */
  readonly iteration: number;
  /**
   * Action names that the engine considered available for the stuck seat(s)
   * at the time of failure. Non-empty means the action exists in the flow but
   * all its selections had no valid choices (e.g. text inputs, filtered elements).
   */
  readonly availableActions: string[];
  /** Full FlowState snapshot at the moment playUntilComplete gave up. */
  readonly flowState: FlowState | undefined;

  constructor(
    message: string,
    iteration: number,
    availableActions: string[],
    flowState: FlowState | undefined,
  ) {
    super(message);
    this.iteration = iteration;
    this.availableActions = availableActions;
    this.flowState = flowState;
    // Required for correct instanceof checks when extending built-in classes in TS.
    Object.setPrototypeOf(this, GameStuckError.prototype);
  }
}

/**
 * Options for `playUntilComplete`.
 */
export interface PlayUntilCompleteOptions {
  /**
   * Maximum number of move-selection iterations before giving up.
   * Defaults to 1000. Increase for games that legitimately take many moves.
   */
  maxMoves?: number;
  /**
   * Move-selection strategy.
   * - `'random'` (default): picks a random legal move via `rng`.
   * - `'first'`: always picks `moves[0]` — deterministic, reproducible.
   */
  strategy?: 'random' | 'first';
  /**
   * Random number generator to use when `strategy` is `'random'`.
   * Defaults to `Math.random`. Inject a seeded/stub rng for reproducible runs.
   *
   * @example
   * ```typescript
   * // Reproducible run with a stub rng:
   * playUntilComplete(testGame, { rng: () => 0 });
   * ```
   */
  rng?: () => number;
}

/**
 * Drive a game to completion by automatically selecting legal moves.
 *
 * Calls `enumerateLegalMoves` for each active seat on every iteration and
 * executes a chosen move via `testGame.doAction`. Handles both sequential
 * turns (`flowState.currentPlayer`) and simultaneous turns
 * (`flowState.awaitingPlayers`) — never hangs on either.
 *
 * Throws `GameStuckError` instead of hanging when:
 * - All active seats have zero enumerable legal moves (dead-end).
 * - `maxMoves` iterations are exhausted without the game completing.
 *
 * @param testGame - The test game instance to drive.
 * @param options - Optional configuration (maxMoves, strategy, rng).
 *
 * @throws {GameStuckError} When the game cannot progress or the move cap is reached.
 *
 * @example
 * ```typescript
 * const testGame = TestGame.create(MyGame, { playerCount: 2 });
 * playUntilComplete(testGame);
 * expect(testGame.isComplete()).toBe(true);
 *
 * // Reproducible run:
 * playUntilComplete(testGame, { strategy: 'first' });
 * ```
 */
export function playUntilComplete<G extends Game>(
  testGame: TestGame<G>,
  options?: PlayUntilCompleteOptions,
): void {
  const maxMoves = options?.maxMoves ?? 1000;
  const strategy = options?.strategy ?? 'random';
  const rng = options?.rng ?? Math.random;

  for (let i = 0; i < maxMoves; i++) {
    if (testGame.isComplete()) return;

    const flowState = testGame.getFlowState();

    // Flow is auto-advancing (no player input needed this tick) — keep iterating.
    if (!flowState?.awaitingInput) continue;

    // ── Determine active seats ─────────────────────────────────────────────
    // Simultaneous turns: flowState.awaitingPlayers is non-empty — check it FIRST.
    //   Each incomplete entry is an active seat.
    // Sequential turns: fallback to flowState.currentPlayer when awaitingPlayers is absent.
    //
    // CRITICAL: awaitingPlayers must be checked before currentPlayer. In a
    // simultaneousActionStep, currentPlayer may still be set in the flowState
    // (from engine initialization) even though it is NOT the canonical "who acts"
    // signal. Checking currentPlayer first causes the loop to act only on seat 1
    // on every iteration — ignoring seat 2 and hanging indefinitely.
    // This mirrors the canonical seat-activity.ts dueSeats() logic: awaitingPlayers
    // takes precedence over currentPlayer.
    const activeSeats: number[] = [];
    if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
      for (const p of flowState.awaitingPlayers) {
        if (!p.completed) activeSeats.push(p.playerIndex);
      }
    } else if (flowState.currentPlayer !== undefined) {
      activeSeats.push(flowState.currentPlayer);
    }

    // ── Enumerate and pick a move for each active seat ─────────────────────
    let anyMoveMade = false;
    const moveFailures: string[] = [];
    for (const seat of activeSeats) {
      const moves = enumerateLegalMoves(testGame.game, seat);
      if (moves.length === 0) continue; // this seat has no enumerable moves
      const move =
        strategy === 'first'
          ? moves[0]
          : moves[Math.floor(rng() * moves.length)];
      const result = testGame.doAction(seat, move.action, move.args);
      if (result.success) {
        anyMoveMade = true;
      } else {
        // Action returned by enumerateLegalMoves failed on execution.
        // Record the failure; the dead-end check below will surface it if
        // no seat succeeded, rather than looping to the maxMoves cap.
        moveFailures.push(
          `seat ${seat}: action "${move.action}" failed — ${result.error ?? 'no error detail'}`
        );
      }
    }

    // ── Dead-end check ─────────────────────────────────────────────────────
    // Active seats exist but none had enumerable moves AND game is not complete.
    // This is a genuine dead-end, not auto-advancing flow — throw immediately.
    if (!anyMoveMade && activeSeats.length > 0 && !testGame.isComplete()) {
      const availableActions = _collectAvailableActions(flowState);
      const seatDesc = _describeSeat(activeSeats);

      if (moveFailures.length > 0) {
        // Enumerable moves existed but all failed on execution — surface the
        // failures immediately rather than looping to the maxMoves cap.
        throw new GameStuckError(
          `Game stuck at iteration ${i}: every attempted move by ${seatDesc} failed during execution. ` +
          `Failures:\n${moveFailures.map(f => `  ${f}`).join('\n')}\n` +
          `This means enumerateLegalMoves returned moves that the action's validation rejects. ` +
          `Verify the action's validate() / chooseFrom() conditions match its execute() preconditions.`,
          i,
          availableActions,
          flowState,
        );
      }

      throw new GameStuckError(
        `Game stuck at iteration ${i}: ${seatDesc} has no enumerable legal moves. ` +
        `Available actions: [${availableActions.join(', ')}]. ` +
        `If these actions require text/number input they cannot be auto-enumerated — use doAction() directly. ` +
        `Check that all required selections have valid choices for the current game state.`,
        i,
        availableActions,
        flowState,
      );
    }
  }

  // ── maxMoves cap ───────────────────────────────────────────────────────────
  if (!testGame.isComplete()) {
    const flowState = testGame.getFlowState();
    const availableActions = flowState ? _collectAvailableActions(flowState) : [];
    const activeSeats: number[] = [];
    if (flowState?.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
      for (const p of flowState.awaitingPlayers) {
        if (!p.completed) activeSeats.push(p.playerIndex);
      }
    } else if (flowState?.currentPlayer !== undefined) {
      activeSeats.push(flowState.currentPlayer);
    }
    const seatDesc = activeSeats.length > 0 ? _describeSeat(activeSeats) : 'unknown seat';
    throw new GameStuckError(
      `Game did not complete after ${maxMoves} moves (${seatDesc} still active). ` +
      `Available actions: [${availableActions.join(', ')}]. ` +
      `Increase maxMoves or verify the game can reach a terminal state.`,
      maxMoves,
      availableActions,
      flowState,
    );
  }
}

/**
 * Collect the union of available action names from a flow state.
 *
 * Works for both sequential turns (`availableActions`) and simultaneous
 * turns (`awaitingPlayers[*].availableActions`). This is the canonical
 * single source of truth for "what actions can currently be taken?"
 * and is shared by `playUntilComplete` and `assertFlowState`.
 *
 * @internal Exported for use by assertion helpers; not part of the public API.
 */
export function _collectAvailableActions(flowState: FlowState): string[] {
  if (flowState.availableActions && flowState.availableActions.length > 0) {
    return flowState.availableActions;
  }
  if (flowState.awaitingPlayers) {
    const seen = new Set<string>();
    for (const p of flowState.awaitingPlayers) {
      if (!p.completed) {
        for (const a of p.availableActions) seen.add(a);
      }
    }
    return [...seen];
  }
  return [];
}

/** Human-readable seat description for error messages. */
function _describeSeat(seats: number[]): string {
  return seats.length === 1 ? `seat ${seats[0]}` : `seats [${seats.join(', ')}]`;
}
