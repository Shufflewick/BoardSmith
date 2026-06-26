/**
 * CI-verifiable tutorial authoring DSL.
 *
 * Provides `simulateTutorial` — a driver that runs a scripted scenario through a
 * `TestGame`, asserting gate-legality, predicate firing, and non-completion using
 * the SAME engine machinery (`autoAdvanceTutorial`, `getTutorialDisabledActions`,
 * `getActiveStep`) that the server uses at runtime. There is no second evaluator.
 *
 * @module
 */

import type { Game } from '../engine/index.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';
import { autoAdvanceTutorial, initialProgress, validateTutorialDefinition } from '../engine/tutorial/progress.js';
import { getActiveStep } from '../engine/tutorial/gate.js';
import type { TestGame } from './test-game.js';

// ============================================
// Scenario types
// ============================================

/**
 * A single scripted player action in a tutorial scenario.
 */
export interface TutorialScenarioMove {
  /**
   * Seat override for this move.
   *
   * Defaults to the top-level `seat` in `SimulateTutorialOptions`.
   */
  seat?: number;

  /** Action name to perform. */
  action: string;

  /** Arguments for the action. Defaults to `{}`. */
  args?: Record<string, unknown>;

  /**
   * Expected step id AFTER this move completes and auto-advance runs.
   *
   * When set, `simulateTutorial` asserts that the tutorial for the move's seat
   * has advanced to this step. If the `advanceWhen` predicate did not fire,
   * the call throws:
   * `"Tutorial drift (predicate): expected advance to '<x>' did not fire."`
   *
   * This is the "predicate did not fire" drift detection — if the game's rules
   * change so the advance condition no longer holds, the test fails fast.
   */
  expectStep?: string;
}

// ============================================
// Options and result types
// ============================================

/**
 * Options for `simulateTutorial`.
 */
export interface SimulateTutorialOptions {
  /**
   * Default seat number (1-indexed) for the tutorial learner.
   *
   * Individual moves may override this via `TutorialScenarioMove.seat`.
   */
  seat: number;

  /** Ordered list of scripted moves. */
  scenario: TutorialScenarioMove[];

  /**
   * Seed for reproducible runs.
   *
   * **Precedence:** if the `TestGame` was already created with an explicit seed,
   * that seed governs the game's initial RNG state and takes precedence.
   * The `seed` option here is informational — it is recorded in the return
   * value for traceability but does NOT restart the game.
   *
   * **For reproducible runs:** create your `TestGame` with the same seed via
   * `TestGame.create(GameClass, { seed })`. Same seed + same scenario → identical
   * run, regardless of whether you pass `seed` here.
   */
  seed?: string;
}

/**
 * Result returned by `simulateTutorial` after a scenario run.
 */
export interface SimulateTutorialResult {
  /**
   * Whether the tutorial for the primary `seat` reached `status: 'completed'`.
   *
   * `true` only when the last step's `advanceWhen` fired and the engine
   * advanced past it. A tutorial with no `advanceWhen` on the last step
   * will always return `false` here — design your last step with an
   * `advanceWhen` predicate that fires when the learner finishes.
   */
  completed: boolean;

  /**
   * The step id the tutorial rested on for the primary `seat` at the end of the
   * run. `null` only when no tutorial definition is attached (should not happen
   * in normal usage since `simulateTutorial` attaches the definition).
   */
  finalStepId: string | null;

  /**
   * Step ids visited by the primary `seat` during the run, in visit order,
   * deduplicated. Each step appears at most once (tutorials are forward-only).
   */
  stepsVisited: string[];
}

// ============================================
// Driver
// ============================================

/**
 * Run a scripted tutorial scenario through a `TestGame` and assert engine
 * invariants at each step.
 *
 * This function is the CI-verifiable authoring entry point (TUT-04). It reuses
 * the engine's `autoAdvanceTutorial` pump and `getTutorialDisabledActions` gate
 * check — no second evaluator.
 *
 * **Three drift dimensions detected:**
 *
 * 1. **Gate drift** — a scripted action that is excluded by the active step's
 *    gate throws immediately, naming the step id and the gate reason.
 * 2. **Predicate drift** — a move with `expectStep` set throws if
 *    `advanceWhen` did not advance to that step after the action.
 * 3. **Non-completion** — use `assertTutorialCompletes(result)` after the run
 *    to assert `result.completed === true`.
 *
 * **Seed precedence:**
 *
 * Create your `TestGame` with an explicit `seed` option for reproducible runs.
 * The `seed` field in `options` is recorded in the result for traceability but
 * does NOT affect an already-started game's RNG state. Caller-seeded `TestGame`
 * wins.
 *
 * @param testGame - A started `TestGame` instance. The tutorial definition will
 *   be attached to `testGame.game` and tutorial progress initialized for `seat`.
 * @param tutorialDef - The tutorial definition to run.
 * @param options - Seat, scenario moves, and optional seed.
 * @returns `{ completed, finalStepId, stepsVisited }` after the scenario.
 *
 * @throws {Error} on gate drift, predicate drift, or action failure.
 *
 * @example
 * ```typescript
 * const testGame = TestGame.create(CheckersGame, { playerCount: 2, seed: 'pinned' });
 * const result = simulateTutorial(testGame, TUTORIAL_DEF, {
 *   seat: 1,
 *   scenario: [
 *     { action: 'move', args: { from: 'c3', to: 'd4' }, expectStep: 'capture-intro' },
 *     { action: 'move', args: { from: 'd4', to: 'f6' } },
 *   ],
 * });
 * assertTutorialCompletes(result);
 * ```
 */
export function simulateTutorial<G extends Game>(
  testGame: TestGame<G>,
  tutorialDef: TutorialDefinition,
  options: SimulateTutorialOptions,
): SimulateTutorialResult {
  const { seat, scenario } = options;

  // 1. Fail-loud validation (MR-03): surfaces structural problems at call time.
  validateTutorialDefinition(tutorialDef);

  // 2. Attach the tutorial definition to the game instance.
  testGame.game.tutorialDefinition = tutorialDef;

  // 3. Set initial progress for all seats referenced in the scenario so gate-drift
  //    detection works correctly for non-primary seats (WR-02). Without this,
  //    getTutorialDisabledActions() returns {} for uninitialized seats, causing the
  //    gate-legality check to silently pass even when a gate should block the action.
  const scenarioSeats = new Set<number>([seat, ...scenario.map(m => m.seat).filter((s): s is number => s !== undefined)]);
  for (const s of scenarioSeats) {
    if (!testGame.game.tutorialProgress.has(s)) {
      testGame.game.tutorialProgress.set(s, initialProgress(tutorialDef));
    }
  }

  // 4. Track steps visited (deduplicated, visit order).
  const stepsVisited: string[] = [];
  let lastRecordedStep: string | null = null;

  const recordCurrentStep = () => {
    const progress = testGame.game.tutorialProgress.get(seat);
    if (!progress?.stepId) return;
    if (progress.stepId !== lastRecordedStep) {
      lastRecordedStep = progress.stepId;
      stepsVisited.push(progress.stepId);
    }
  };

  // Record the initial step before any auto-advance.
  recordCurrentStep();

  // 5. Run auto-advance once at start — parity with the server's start-time
  //    evaluation (the session post-start hook calls autoAdvanceTutorial before
  //    the first player action).
  autoAdvanceTutorial(testGame.game, seat);
  recordCurrentStep();

  // 6. Execute each scripted move.
  for (const move of scenario) {
    const moveSeat = move.seat ?? seat;

    // Step A: gate-legality check.
    // assert the scripted action is NOT a key of getTutorialDisabledActions(moveSeat).
    const disabledActions = testGame.game.getTutorialDisabledActions(moveSeat);
    if (move.action in disabledActions) {
      const activeStep = getActiveStep(testGame.game, moveSeat);
      throw new Error(
        `Tutorial drift (gate): action '${move.action}' is disabled on step '${activeStep?.id ?? 'unknown'}'. ` +
        `Gate reason: ${disabledActions[move.action]}. ` +
        `Update the scenario to match the step's gate or fix the tutorial definition.`,
      );
    }

    // Step B: perform the action and assert success.
    const result = testGame.doAction(moveSeat, move.action, move.args ?? {});
    if (!result.success) {
      const activeStep = getActiveStep(testGame.game, moveSeat);
      throw new Error(
        `Tutorial scenario: action '${move.action}' by seat ${moveSeat} on step '${activeStep?.id ?? 'unknown'}' failed. ` +
        `Error: ${result.error ?? 'unknown error'}`,
      );
    }

    // Step C: auto-advance for every seat that has a running tutorial.
    // Mirrors the server's post-action hook that calls autoAdvanceTutorial
    // for each participant.
    for (const [s, progress] of testGame.game.tutorialProgress.entries()) {
      if (progress.status === 'running') {
        autoAdvanceTutorial(testGame.game, s);
      }
    }

    // Record step after action + auto-advance.
    recordCurrentStep();

    // Step D: expectStep assertion.
    if (move.expectStep !== undefined) {
      // Use the raw progress stepId so we also catch the completed state where
      // getActiveStep returns null (completed tutorials still have a stepId).
      const currentProgress = testGame.game.tutorialProgress.get(moveSeat);
      const actualStepId = currentProgress?.stepId ?? null;

      if (actualStepId !== move.expectStep) {
        throw new Error(
          `Tutorial drift (predicate): expected advance to '${move.expectStep}' did not fire. ` +
          `Tutorial for seat ${moveSeat} is on step '${actualStepId ?? 'none'}'. ` +
          `Check the advanceWhen predicate for step '${move.expectStep}'.`,
        );
      }
    }
  }

  // 7. Build and return the result.
  const finalProgress = testGame.game.tutorialProgress.get(seat);
  const completed = finalProgress?.status === 'completed';
  const finalStepId = finalProgress?.stepId ?? null;

  return { completed, finalStepId, stepsVisited };
}
