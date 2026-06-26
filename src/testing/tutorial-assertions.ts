/**
 * Assertion helpers for tutorial DSL tests.
 *
 * Provides `assertTutorialStep` and `assertTutorialCompletes`, following the
 * same throw-with-actionable-message style as the existing `assertions.ts`
 * helpers.
 *
 * @module
 */

import type { TestGame } from './test-game.js';
import type { SimulateTutorialResult } from './simulate-tutorial.js';

// ============================================
// assertTutorialStep
// ============================================

/**
 * Assert that the tutorial for a given seat is currently on the expected step.
 *
 * Accepts either a live `TestGame` (for mid-run assertions) or a
 * `SimulateTutorialResult` (for post-run assertions).
 *
 * - **TestGame overload:** reads `game.tutorialProgress.get(seat).stepId`
 *   directly — useful for assertions inside a test after specific moves.
 * - **Result overload:** checks `result.finalStepId`. The `seat` parameter is
 *   accepted for API consistency but is ignored when a result is passed, since
 *   `finalStepId` tracks only the primary seat from `SimulateTutorialOptions.seat`.
 *
 * @param testGameOrResult - A live TestGame or a completed SimulateTutorialResult.
 * @param seat - The player seat (1-indexed). Used for TestGame; ignored for result.
 * @param expectedStepId - The step id the tutorial should be on.
 * @throws {Error} with an actionable message when the step does not match.
 *
 * @example
 * ```typescript
 * // After two moves, the tutorial should be on 'capture-intro'.
 * simulateTutorial(testGame, def, { seat: 1, scenario: [move1, move2] });
 * assertTutorialStep(testGame, 1, 'capture-intro');
 *
 * // Or assert on the returned result.
 * const result = simulateTutorial(testGame, def, { seat: 1, scenario });
 * assertTutorialStep(result, 1, 'capture-intro');
 * ```
 */
export function assertTutorialStep(
  testGameOrResult: TestGame | SimulateTutorialResult,
  seat: number,
  expectedStepId: string,
): void {
  let actualStepId: string | null | undefined;

  if (isSimulateTutorialResult(testGameOrResult)) {
    // Result overload: use finalStepId regardless of the seat argument.
    actualStepId = testGameOrResult.finalStepId;
  } else {
    // TestGame overload: read live progress from the game.
    actualStepId = testGameOrResult.game.tutorialProgress.get(seat)?.stepId;
  }

  if (actualStepId !== expectedStepId) {
    throw new Error(
      `Tutorial step assertion failed for seat ${seat}: ` +
      `expected '${expectedStepId}', got '${actualStepId ?? 'none'}'. ` +
      `Check your scenario or advanceWhen predicate.`,
    );
  }
}

// ============================================
// assertTutorialCompletes
// ============================================

/**
 * Assert that a tutorial run ended in the completed state.
 *
 * Use this after `simulateTutorial` to verify the tutorial was not left
 * incomplete (e.g., the scenario ended before the last step, or the last
 * step's `advanceWhen` predicate never fired).
 *
 * @param result - The result returned by `simulateTutorial`.
 * @throws {Error} with an actionable message when `result.completed` is false.
 *
 * @example
 * ```typescript
 * const result = simulateTutorial(testGame, TUTORIAL_DEF, {
 *   seat: 1,
 *   scenario: FULL_WALKTHROUGH,
 * });
 * assertTutorialCompletes(result);  // throws if the scenario fell short
 * ```
 */
export function assertTutorialCompletes(result: SimulateTutorialResult): void {
  if (!result.completed) {
    throw new Error(
      `Tutorial did not complete. ` +
      `Final step: '${result.finalStepId ?? 'none'}', ` +
      `steps visited: [${result.stepsVisited.join(', ')}]. ` +
      `Ensure the scenario covers all steps and each step's advanceWhen predicate fires.`,
    );
  }
}

// ============================================
// Internal helpers
// ============================================

/**
 * Type guard: discriminate between a `SimulateTutorialResult` and a `TestGame`.
 *
 * A `SimulateTutorialResult` has a `completed` boolean field; `TestGame` does not.
 */
function isSimulateTutorialResult(
  value: TestGame | SimulateTutorialResult,
): value is SimulateTutorialResult {
  return typeof (value as SimulateTutorialResult).completed === 'boolean';
}
