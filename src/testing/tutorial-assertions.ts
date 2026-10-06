/**
 * Assertion helpers for tutorial DSL tests.
 *
 * Provides `assertTutorialCompletes`, following the same
 * throw-with-actionable-message style as the `assertions.ts` helpers.
 *
 * @module
 */

import type { SimulateTutorialResult } from './simulate-tutorial.js';

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
