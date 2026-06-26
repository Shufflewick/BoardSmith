/**
 * Criterion #3 proof: CI-verifiable tutorial authoring
 *
 * This file demonstrates that a tutorial authored with the named predicate
 * helpers (`afterTurns`, `whenForced`) is:
 *
 *   GREEN when game rules are intact — `simulateTutorial` completes and
 *   `assertTutorialCompletes` passes.
 *
 *   RED (throws) when a rule is deliberately broken in two distinct ways:
 *     - Break #1 (gate drift):  the taught action is step-gated out → the
 *       gate-legality assertion inside `simulateTutorial` throws.
 *     - Break #2 (predicate drift): the rule that makes `capture` the only
 *       available action is removed → `whenForced('capture')` never fires and
 *       the `expectStep` assertion inside `simulateTutorial` throws.
 *
 * The game is a minimal in-test `Game` subclass with no external package
 * dependency. It models the single mechanic needed to exercise both named
 * helpers: a player who normally `move`s, but after two moves becomes forced
 * to `capture` (the opponent's piece enters an attack position).
 *
 * Phase 109 will author the real checkers tutorial in the cross-repo package;
 * this file proves the in-repo substrate is sound before that work begins.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { simulateTutorial, type TutorialScenarioMove } from './simulate-tutorial.js';
import { assertTutorialCompletes } from './tutorial-assertions.js';
import { afterTurns, whenForced } from '../engine/tutorial/predicates.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';

// ============================================================
// Demo game: move-then-capture mechanic
// ============================================================

/**
 * Minimal in-test game for tutorial CI demonstrations.
 *
 * Each player may `move` freely until they have moved twice. After two moves
 * their position enters an "attacked" state, leaving `capture` as the only
 * available action (the forced-capture rule). Performing `capture` resets
 * the count, returning the player to the free-move phase.
 *
 * This mechanic is sufficient to:
 *   - Exercise the `afterTurns` named helper (advance after N moves).
 *   - Exercise the `whenForced` named helper (advance when capture is forced).
 */
class DemoGame extends Game<DemoGame, Player> {
  /**
   * Per-seat move counter. Seat → number of moves made this cycle.
   * Using `persistentMap` so the counter survives serialization / HMR.
   */
  movesPerSeat = this.persistentMap<number, number>('movesPerSeat');

  constructor(options: GameOptions) {
    super(options);

    // `move` is available until the player has made two moves in this cycle.
    const move = Action.create<DemoGame>('move')
      .prompt('Move your piece')
      .condition({
        'not in forced-capture position': (ctx) => {
          const moves = ctx.game.movesPerSeat.get(ctx.player.seat) ?? 0;
          return moves < 2;
        },
      })
      .execute((_args, ctx) => {
        const seat = ctx.player.seat;
        const count = ctx.game.movesPerSeat.get(seat) ?? 0;
        ctx.game.movesPerSeat.set(seat, count + 1);
      });

    // `capture` is available only when the player is in the forced-capture
    // position (two moves made). Performing it resets the counter.
    const capture = Action.create<DemoGame>('capture')
      .prompt('Capture (forced)')
      .condition({
        'forced capture available': (ctx) => {
          const moves = ctx.game.movesPerSeat.get(ctx.player.seat) ?? 0;
          return moves >= 2;
        },
      })
      .execute((_args, ctx) => {
        ctx.game.movesPerSeat.set(ctx.player.seat, 0);
      });

    this.registerActions(move, capture);

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['move', 'capture'] }),
          }),
        }),
      }),
    );
  }
}

// ============================================================
// Break #2 variant: forced-capture rule removed
// ============================================================

/**
 * Broken game variant for criterion #3 proof (predicate-drift break).
 *
 * The forced-capture rule has been removed: `move` is always available and
 * `capture` is never registered. `whenForced('capture')` will never fire
 * because `getAvailableActions` never returns `capture` as the sole option.
 * Running the same tutorial walkthrough through this game should make the
 * `simulateTutorial` predicate-drift assertion throw.
 */
class DemoGameNoCaptureRule extends Game<DemoGameNoCaptureRule, Player> {
  constructor(options: GameOptions) {
    super(options);

    // Move is unconditionally available — the "forced capture" rule does not
    // exist in this variant, so the player can always move.
    const move = Action.create('move')
      .prompt('Move your piece')
      .execute(() => {});

    this.registerActions(move);

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['move'] }),
          }),
        }),
      }),
    );
  }
}

// ============================================================
// Tutorial definition
// ============================================================

/**
 * Three-step tutorial authored with named predicate helpers.
 *
 * Step 1 — `intro`:
 *   Gate allows `move`. `advanceWhen: afterTurns(1)` — advances off the
 *   intro step after the learner completes their first move.
 *
 * Step 2 — `capture-tip`:
 *   Gate allows `move`. `advanceWhen: whenForced('capture')` — advances once
 *   the learner's position is attacked and `capture` is their only option.
 *   This is the CI-verifiable teaching beat: a rule change that removes the
 *   forced-capture mechanic will prevent this predicate from ever firing and
 *   turn the test RED.
 *
 * Step 3 — `done`:
 *   Gate allows `capture` (the learner must execute the forced capture).
 *   `advanceWhen: afterTurns(3)` — completes the tutorial after the learner's
 *   third turn (the `capture` action counts as a turn).
 */
const DEMO_TUTORIAL: TutorialDefinition = {
  steps: [
    {
      id: 'intro',
      gate: { action: 'move' },
      advanceWhen: { ...afterTurns(1) },
    },
    {
      id: 'capture-tip',
      gate: { action: 'move' },
      advanceWhen: { ...whenForced('capture') },
    },
    {
      id: 'done',
      gate: { action: 'capture' },
      advanceWhen: { ...afterTurns(3) },
    },
  ],
};

// ============================================================
// Walkthrough scenario (intact-rules run)
// ============================================================

/**
 * Five-move walkthrough that drives the tutorial to completion.
 *
 * Turn 1 (seat 1, move):  `afterTurns(1)` fires → advances intro → capture-tip.
 * Turn 1 (seat 2, move):  required to advance the flow to round 2.
 * Turn 2 (seat 1, move):  move count reaches 2 → `whenForced('capture')` fires
 *                         → advances capture-tip → done.
 * Turn 2 (seat 2, move):  required to advance the flow to round 3.
 * Turn 3 (seat 1, capture): `afterTurns(3)` fires → tutorial completes.
 */
const WALKTHROUGH: TutorialScenarioMove[] = [
  // Seat 1, turn 1: first move; advance off intro to capture-tip.
  { action: 'move', expectStep: 'capture-tip' },
  // Seat 2 must act to advance the flow to round 2.
  { seat: 2, action: 'move' },
  // Seat 1, turn 2: second move triggers forced-capture; advance to done.
  { action: 'move', expectStep: 'done' },
  // Seat 2 must act to advance the flow to round 3.
  { seat: 2, action: 'move' },
  // Seat 1, turn 3: perform the forced capture; afterTurns(3) fires, completes.
  { action: 'capture', expectStep: 'done' },
];

// ============================================================
// Tests
// ============================================================

describe('Tutorial CI Demo — criterion #3 proof', () => {
  /**
   * GREEN when rules are intact.
   *
   * The `simulateTutorial` driver walks the full scenario without throwing,
   * visiting all three steps, and `assertTutorialCompletes` confirms the
   * tutorial reached the completed state.
   */
  it('intact rules: tutorial completes and all steps are visited', () => {
    const testGame = TestGame.create(DemoGame, {
      playerCount: 2,
      playerNames: ['Learner', 'Opponent'],
      seed: 'tutorial-ci-demo-intact',
    });

    const result = simulateTutorial(testGame, DEMO_TUTORIAL, {
      seat: 1,
      scenario: WALKTHROUGH,
      seed: 'tutorial-ci-demo-intact',
    });

    // Primary assertion: tutorial reached the completed state.
    assertTutorialCompletes(result);

    // All three steps were visited in order.
    expect(result.stepsVisited).toEqual(['intro', 'capture-tip', 'done']);

    // Final step id is `done` (the last authored step).
    expect(result.finalStepId).toBe('done');
  });

  /**
   * RED — Break #1: taught action gated out (gate drift).
   *
   * The intro step's gate is changed to `{ action: 'capture' }` instead of
   * `{ action: 'move' }`. When the scenario tries to perform `move`, the
   * gate-legality check inside `simulateTutorial` detects that `move` is a
   * tutorial-disabled action on the `intro` step and throws immediately.
   *
   * This exercises `getTutorialDisabledActions` and proves that a tutorial
   * definition change that locks the learner out of the taught action is
   * caught by the CI test.
   */
  it('break #1 (gate drift): taught action gated out → simulateTutorial throws', () => {
    // Broken tutorial: intro step requires `capture` instead of `move`.
    // `move` is now tutorial-disabled on the intro step.
    const brokenGateDef: TutorialDefinition = {
      steps: [
        {
          id: 'intro',
          gate: { action: 'capture' }, // <-- taught action (`move`) is gated out
          advanceWhen: { ...afterTurns(1) },
        },
        {
          id: 'capture-tip',
          gate: { action: 'move' },
          advanceWhen: { ...whenForced('capture') },
        },
        {
          id: 'done',
          gate: { action: 'capture' },
          advanceWhen: { ...afterTurns(3) },
        },
      ],
    };

    const brokenGame = TestGame.create(DemoGame, {
      playerCount: 2,
      playerNames: ['Learner', 'Opponent'],
      seed: 'tutorial-ci-demo-break1',
    });

    // The SAME walkthrough scenario now fails at the very first move because
    // `move` is gated out by the broken tutorial definition.
    expect(() =>
      simulateTutorial(brokenGame, brokenGateDef, {
        seat: 1,
        scenario: WALKTHROUGH,
      }),
    ).toThrow(/Tutorial drift \(gate\)/);
  });

  /**
   * RED — Break #2: forced-capture rule removed (predicate drift).
   *
   * The `DemoGameNoCaptureRule` variant has the forced-capture mechanic
   * removed: `capture` is never registered, so `getAvailableActions` never
   * returns `capture` as the sole available action. `whenForced('capture')`
   * therefore never fires and the tutorial cannot advance from `capture-tip`
   * to `done`.
   *
   * When the scenario's third move sets `expectStep: 'done'`, the step is
   * actually still `capture-tip`, and `simulateTutorial` throws the predicate-
   * drift error, proving the CI test goes RED when the relied-upon rule is gone.
   */
  it('break #2 (predicate drift): forced-capture rule removed → simulateTutorial throws', () => {
    const brokenGame = TestGame.create(DemoGameNoCaptureRule, {
      playerCount: 2,
      playerNames: ['Learner', 'Opponent'],
      seed: 'tutorial-ci-demo-break2',
    });

    // The SAME walkthrough scenario fails on step 3: `expectStep: 'done'` is
    // not reached because `whenForced('capture')` never fires when `capture`
    // has no game rule backing it.
    expect(() =>
      simulateTutorial(brokenGame, DEMO_TUTORIAL, {
        seat: 1,
        scenario: WALKTHROUGH,
      }),
    ).toThrow(/Tutorial drift \(predicate\)/);
  });
});
