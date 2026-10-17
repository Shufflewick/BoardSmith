/**
 * CI-verifiable tutorial authoring DSL.
 *
 * Provides `simulateTutorial` — a driver that runs a scripted scenario through a
 * `TestGame`, asserting gate-legality, predicate firing, and non-completion using
 * the SAME engine machinery (`autoAdvanceTutorial`, `getDisabledActions`,
 * `getActiveStep`) that the server uses at runtime. There is no second evaluator.
 *
 * @module
 */

import type { Game } from '../engine/index.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';
import { autoAdvanceTutorial, initialProgress, validateTutorialDefinition } from '../engine/tutorial/progress.js';
import { startTutorial } from '../engine/tutorial/start.js';
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
   * Defaults to the tutorial's `learnerSeat`.
   */
  seat?: number;

  /** Action name to perform. */
  action: string;

  /** Arguments for the action. Defaults to `{}`. */
  args?: Record<string, unknown>;

  /**
   * Expected step id AFTER this move completes and auto-advance runs.
   *
   * When set, `simulateTutorial` asserts that the learner's tutorial has
   * advanced to this step, whichever seat made the move: only the learner
   * has a tutorial (#914). If the `advanceWhen` predicate did not fire,
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
export interface SimulateTutorialOptions<G extends Game> {
  /**
   * Builds the ordered list of scripted moves from the game. It is called once,
   * after the tutorial has started and its `setup` has run, so the moves can
   * name the elements `setup` created (#1079).
   */
  scenario: (game: G) => TutorialScenarioMove[];

  /**
   * Declared expectation of the seed governing this run.
   *
   * The game's RNG is seeded once, at `TestGame.create(GameClass, { seed })` —
   * an already-started game cannot be reseeded here. If you pass `seed` and it
   * does not match `testGame.seed`, `simulateTutorial` throws immediately
   * (fail-loud: the run would NOT be governed by the seed you named).
   *
   * Omit this option in new code — the effective seed is always recorded on
   * `SimulateTutorialResult.seed` (taken from `testGame.seed`).
   */
  seed?: string;
}

/**
 * Result returned by `simulateTutorial` after a scenario run.
 */
export interface SimulateTutorialResult {
  /**
   * Whether the tutorial for the learner seat reached `status: 'completed'`.
   *
   * `true` only when the last step's `advanceWhen` fired and the engine
   * advanced past it. A tutorial with no `advanceWhen` on the last step
   * will always return `false` here — design your last step with an
   * `advanceWhen` predicate that fires when the learner finishes.
   */
  completed: boolean;

  /**
   * The step id the tutorial rested on for the learner seat at the end of the
   * run. `null` only when no tutorial definition is attached (should not happen
   * in normal usage since `simulateTutorial` attaches the definition).
   */
  finalStepId: string | null;

  /**
   * Step ids visited by the learner seat during the run, in visit order,
   * deduplicated. Each step appears at most once (tutorials are forward-only).
   */
  stepsVisited: string[];

  /**
   * The effective seed governing the run (`testGame.seed`): the seed the
   * `TestGame` was created with, or the fixed literal default (`'test-seed'`)
   * when none was supplied. Recorded for traceability — recreate the
   * `TestGame` with this seed and replay the same scenario to reproduce
   * the run exactly.
   */
  seed: string;
}

// ============================================
// Driver
// ============================================

/**
 * Run a scripted tutorial scenario through a `TestGame` and assert engine
 * invariants at each step.
 *
 * This function is the CI-verifiable authoring entry point (TUT-04). It reuses
 * the engine's `autoAdvanceTutorial` pump and `getDisabledActions` gate
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
 * **Seeding:**
 *
 * Create your `TestGame` with an explicit `seed` option for reproducible runs —
 * an already-started game cannot be reseeded here. The effective seed
 * (`testGame.seed`) is recorded on the result for traceability. Passing
 * `options.seed` declares an expectation: if it does not match `testGame.seed`,
 * `simulateTutorial` throws immediately rather than silently running under a
 * different seed than the one you named.
 *
 * @param testGame - A started `TestGame` instance. The tutorial definition will
 *   be attached to `testGame.game` and the tutorial started for its `learnerSeat`
 *   exactly as the server starts it: setup applied, the flow restarted with the
 *   learner to move, and progress for the learner alone (#914).
 * @param tutorialDef - The tutorial definition to run.
 * @param options - A function that builds the scenario moves from the started
 *   game, and an optional declared seed.
 * @returns `{ completed, finalStepId, stepsVisited, seed }` after the scenario.
 *
 * @throws {Error} on gate drift, predicate drift, action failure, or a
 *   `seed` option that mismatches `testGame.seed`.
 *
 * @example
 * ```typescript
 * const testGame = TestGame.create(CheckersGame, { playerCount: 2, seed: 'pinned' });
 * const result = simulateTutorial(testGame, TUTORIAL_DEF, {
 *   // Called after the tutorial's setup, so it names the pieces setup placed.
 *   scenario: (game) => [
 *     { action: 'move', args: { piece: game.first(Checker, 'red-1')!, to: 'd4' }, expectStep: 'capture-intro' },
 *     { action: 'move', args: { piece: game.first(Checker, 'red-1')!, to: 'f6' } },
 *   ],
 * });
 * assertTutorialCompletes(result);
 * ```
 */
export function simulateTutorial<G extends Game>(
  testGame: TestGame<G>,
  tutorialDef: TutorialDefinition,
  options: SimulateTutorialOptions<G>,
): SimulateTutorialResult {
  // 0. Seed-expectation check (fail-loud): an already-started game cannot be
  //    reseeded, so a mismatched options.seed means the run would NOT be
  //    governed by the seed the caller named. Throw before touching the game.
  if (options.seed !== undefined && options.seed !== testGame.seed) {
    throw new Error(
      `simulateTutorial: options.seed ('${options.seed}') does not match the TestGame's seed ('${testGame.seed}'). ` +
      `The game's RNG is seeded once, at TestGame.create — pass the seed there ` +
      `(TestGame.create(GameClass, { seed: '${options.seed}' })) and either drop options.seed or pass the same value.`,
    );
  }

  // 1. Fail-loud validation (MR-03): surfaces structural problems at call time.
  validateTutorialDefinition(tutorialDef);
  const seat = tutorialDef.learnerSeat;

  // 2. Attach the tutorial definition to the game instance.
  testGame.game.tutorialDefinition = tutorialDef;

  // 3. Track steps visited (deduplicated, visit order). The first step is
  //    visited even when the start's auto-advance pump moves straight past it.
  const stepsVisited: string[] = [];
  let lastRecordedStep: string | null = null;

  const recordStep = (stepId: string | null | undefined) => {
    if (!stepId || stepId === lastRecordedStep) return;
    lastRecordedStep = stepId;
    stepsVisited.push(stepId);
  };
  const recordCurrentStep = () => recordStep(testGame.game.tutorialProgress.get(seat)?.stepId);
  recordStep(initialProgress(tutorialDef).stepId);

  // 4. Start the tutorial exactly as the server's startTutorial op does (#914).
  const refusal = startTutorial(testGame.game, tutorialDef, seat);
  if (refusal) throw new Error(`simulateTutorial: ${refusal}`);
  recordCurrentStep();

  // 5. Execute each scripted move, built from the board setup left.
  for (const move of options.scenario(testGame.game)) {
    const moveSeat = move.seat ?? seat;

    // Step A: gate-legality check.
    // assert the scripted action is NOT a key of getDisabledActions(moveSeat).
    const disabledActions = testGame.game.getDisabledActions(moveSeat);
    if (move.action in disabledActions) {
      const activeStep = getActiveStep(testGame.game, moveSeat);
      throw new Error(
        `Tutorial drift (gate): action '${move.action}' is disabled on step '${activeStep?.id ?? 'unknown'}'. ` +
        `Gate reason: ${disabledActions[move.action]}. ` +
        `Update the scenario to match the step's gate or fix the tutorial definition.`,
      );
    }

    // Step B: perform the action and assert success.
    // Uses tryAction (not doAction) so the tutorial-specific error message
    // below (which names the active step id) replaces the generic throw.
    const result = testGame.tryAction(moveSeat, move.action, move.args ?? {});
    if (!result.success) {
      const activeStep = getActiveStep(testGame.game, seat);
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
      const currentProgress = testGame.game.tutorialProgress.get(seat);
      const actualStepId = currentProgress?.stepId ?? null;

      if (actualStepId !== move.expectStep) {
        throw new Error(
          `Tutorial drift (predicate): expected advance to '${move.expectStep}' did not fire. ` +
          `Tutorial for seat ${seat} is on step '${actualStepId ?? 'none'}'. ` +
          `Check the advanceWhen predicate for step '${move.expectStep}'.`,
        );
      }
    }
  }

  // 6. Build and return the result.
  const finalProgress = testGame.game.tutorialProgress.get(seat);
  const completed = finalProgress?.status === 'completed';
  const finalStepId = finalProgress?.stepId ?? null;

  return { completed, finalStepId, stepsVisited, seed: testGame.seed };
}
