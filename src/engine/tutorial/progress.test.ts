/**
 * Tests for tutorial progress helpers (Phase 106, Plan 01).
 *
 * Covers:
 *   1. initialProgress — returns first step as running.
 *   2. nextProgress — transitions correctly, completes at end.
 *   3. evaluateAdvanceWhen — fired vs not-fired.
 *   4. autoAdvanceTutorial — chains through consecutive always-true steps,
 *      stops on false predicate, terminates on completion, bounded.
 *   5. validateTutorialDefinition — throws on empty steps and non-function advanceWhen.
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
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import {
  initialProgress,
  nextProgress,
  evaluateAdvanceWhen,
  autoAdvanceTutorial,
  validateTutorialDefinition,
} from './progress.js';
import type { TutorialDefinition } from './types.js';

// ============================================================
// Minimal test game
// ============================================================

class ProgressTestGame extends Game<ProgressTestGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(passAction);

    const flow = defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 50,
        do: eachPlayer({
          do: actionStep({ actions: ['pass'] }),
        }),
      }),
    });
    this.setFlow(flow);
  }
}

function makeRunner(seed = 'progress-test') {
  const runner = new GameRunner<ProgressTestGame>({
    GameClass: ProgressTestGame,
    gameType: 'progress-test',
    gameOptions: {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed,
    },
  });
  runner.start();
  return runner;
}

// ============================================================
// Tutorial definitions shared across tests
// ============================================================

const THREE_STEP_DEF: TutorialDefinition = {
  steps: [
    { id: 'step-1', gate: { action: 'pass' } },
    { id: 'step-2', gate: { action: 'pass' } },
    { id: 'step-3', gate: { action: 'pass' } },
  ],
};

const SINGLE_STEP_DEF: TutorialDefinition = {
  steps: [
    { id: 'only', gate: { action: 'pass' } },
  ],
};

// ============================================================
// initialProgress
// ============================================================

describe('initialProgress', () => {
  it('returns the first step as running', () => {
    const progress = initialProgress(THREE_STEP_DEF);
    expect(progress.stepId).toBe('step-1');
    expect(progress.status).toBe('running');
  });

  it('throws an actionable error when steps is empty', () => {
    expect(() => initialProgress({ steps: [] })).toThrow(/no steps/i);
  });
});

// ============================================================
// nextProgress
// ============================================================

describe('nextProgress', () => {
  it('advances from step-1 to step-2', () => {
    const next = nextProgress(THREE_STEP_DEF, 'step-1');
    expect(next.stepId).toBe('step-2');
    expect(next.status).toBe('running');
  });

  it('advances from step-2 to step-3', () => {
    const next = nextProgress(THREE_STEP_DEF, 'step-2');
    expect(next.stepId).toBe('step-3');
    expect(next.status).toBe('running');
  });

  it('completes when advancing past the last step', () => {
    const next = nextProgress(THREE_STEP_DEF, 'step-3');
    expect(next.status).toBe('completed');
    expect(next.stepId).toBe('step-3');
  });

  it('completes when advancing past the only step', () => {
    const next = nextProgress(SINGLE_STEP_DEF, 'only');
    expect(next.status).toBe('completed');
    expect(next.stepId).toBe('only');
  });

  it('is pure — does not mutate the definition', () => {
    const def: TutorialDefinition = {
      steps: [
        { id: 'a', gate: { action: 'pass' } },
        { id: 'b', gate: { action: 'pass' } },
      ],
    };
    nextProgress(def, 'a');
    expect(def.steps).toHaveLength(2); // unchanged
  });
});

// ============================================================
// evaluateAdvanceWhen
// ============================================================

describe('evaluateAdvanceWhen', () => {
  it('returns fired=false when step has no advanceWhen', () => {
    const runner = makeRunner('aw-no-cond');
    runner.game.tutorialDefinition = {
      steps: [{ id: 'step-1', gate: { action: 'pass' } }],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { fired } = evaluateAdvanceWhen(runner.game, 1);
    expect(fired).toBe(false);
  });

  it('returns fired=true when advanceWhen predicates all return true', () => {
    const runner = makeRunner('aw-true');
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: { 'always fire': (_ctx) => true },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { fired } = evaluateAdvanceWhen(runner.game, 1);
    expect(fired).toBe(true);
  });

  it('returns fired=false when any advanceWhen predicate returns false', () => {
    const runner = makeRunner('aw-false');
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: {
            'always true': (_ctx) => true,
            'always false': (_ctx) => false,
          },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { fired } = evaluateAdvanceWhen(runner.game, 1);
    expect(fired).toBe(false);
  });

  it('returns fired=false when no tutorial is running', () => {
    const runner = makeRunner('aw-no-tutorial');
    const { fired } = evaluateAdvanceWhen(runner.game, 1);
    expect(fired).toBe(false);
  });

  it('returns details with label info', () => {
    const runner = makeRunner('aw-details');
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: { 'custom label': (_ctx) => false },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { fired, details } = evaluateAdvanceWhen(runner.game, 1);
    expect(fired).toBe(false);
    expect(details[0]?.label).toBe('custom label');
    expect(details[0]?.passed).toBe(false);
  });
});

// ============================================================
// autoAdvanceTutorial
// ============================================================

describe('autoAdvanceTutorial', () => {
  it('advances through two consecutive always-true steps and stops on a false predicate', () => {
    // 3-step tutorial:
    //   step-1: advanceWhen always true → auto-advances to step-2
    //   step-2: advanceWhen always true → auto-advances to step-3
    //   step-3: no advanceWhen → pump stops here
    const runner = makeRunner('pump-chain');
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: { 'always': (_ctx) => true },
        },
        {
          id: 'step-2',
          gate: { action: 'pass' },
          advanceWhen: { 'always': (_ctx) => true },
        },
        {
          id: 'step-3',
          gate: { action: 'pass' },
          // no advanceWhen — pump stops here
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { advanced, finalStepId } = autoAdvanceTutorial(runner.game, 1);

    expect(advanced).toBe(true);
    // Must land on step-3, NOT complete past it
    expect(finalStepId).toBe('step-3');
    expect(runner.game.tutorialProgress.get(1)?.status).toBe('running');
  });

  it('does not advance when the current step has no advanceWhen', () => {
    const runner = makeRunner('pump-no-advance');
    runner.game.tutorialDefinition = THREE_STEP_DEF;
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { advanced, finalStepId } = autoAdvanceTutorial(runner.game, 1);

    expect(advanced).toBe(false);
    expect(finalStepId).toBe('step-1');
  });

  it('terminates when the tutorial completes (all steps have always-true advanceWhen)', () => {
    const runner = makeRunner('pump-complete');
    runner.game.tutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: { 'always': (_ctx) => true },
        },
        {
          id: 'step-2',
          gate: { action: 'pass' },
          advanceWhen: { 'always': (_ctx) => true },
        },
      ],
    };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { advanced } = autoAdvanceTutorial(runner.game, 1);

    expect(advanced).toBe(true);
    expect(runner.game.tutorialProgress.get(1)?.status).toBe('completed');
  });

  it('returns advanced=false when no tutorial definition is set', () => {
    const runner = makeRunner('pump-no-def');
    const { advanced, finalStepId } = autoAdvanceTutorial(runner.game, 1);
    expect(advanced).toBe(false);
    expect(finalStepId).toBeNull();
  });

  it('returns advanced=false when tutorial is already completed', () => {
    const runner = makeRunner('pump-already-done');
    runner.game.tutorialDefinition = THREE_STEP_DEF;
    runner.game.tutorialProgress.set(1, { stepId: 'step-3', status: 'completed' });

    const { advanced } = autoAdvanceTutorial(runner.game, 1);
    expect(advanced).toBe(false);
  });

  it('is bounded and cannot runaway past the last step', () => {
    // All steps have always-true advanceWhen — pump must stop at completion,
    // not loop infinitely or advance beyond the last step.
    const runner = makeRunner('pump-bounded');
    const steps = Array.from({ length: 5 }, (_, i) => ({
      id: `step-${i + 1}`,
      gate: { action: 'pass' as const },
      advanceWhen: { 'always': (_ctx: unknown) => true } as Record<string, () => boolean>,
    }));
    runner.game.tutorialDefinition = { steps };
    runner.game.tutorialProgress.set(1, { stepId: 'step-1', status: 'running' });

    const { advanced } = autoAdvanceTutorial(runner.game, 1);

    expect(advanced).toBe(true);
    // Must have completed, not looped beyond
    expect(runner.game.tutorialProgress.get(1)?.status).toBe('completed');
    // stepId must still be the last real step
    expect(runner.game.tutorialProgress.get(1)?.stepId).toBe('step-5');
  });
});

// ============================================================
// validateTutorialDefinition (MR-03)
// ============================================================

describe('validateTutorialDefinition', () => {
  it('passes for a valid single-step definition', () => {
    expect(() => validateTutorialDefinition(SINGLE_STEP_DEF)).not.toThrow();
  });

  it('passes for a valid multi-step definition with advanceWhen', () => {
    expect(() => validateTutorialDefinition({
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: { 'always': () => true },
        },
      ],
    })).not.toThrow();
  });

  it('throws an actionable error when steps is empty', () => {
    expect(() => validateTutorialDefinition({ steps: [] }))
      .toThrow(/no steps|empty/i);
  });

  it('throws and names the step when advanceWhen is a bare function (not a record)', () => {
    expect(() => validateTutorialDefinition({
      steps: [
        {
          id: 'capture-tip',
          gate: { action: 'pass' },
          // @ts-expect-error intentional: testing runtime validation of wrong type
          advanceWhen: () => true,
        },
      ],
    })).toThrow(/capture-tip.*advanceWhen|advanceWhen.*capture-tip/i);
  });

  it('throws and names the step when advanceWhen is a string (non-function value)', () => {
    expect(() => validateTutorialDefinition({
      steps: [
        {
          id: 'intro',
          gate: { action: 'pass' },
          // @ts-expect-error intentional: testing runtime validation of wrong type
          advanceWhen: 'on-capture',
        },
      ],
    })).toThrow(/intro.*advanceWhen|advanceWhen.*intro/i);
  });

  it('throws when a labeled-condition gate value is not a function', () => {
    expect(() => validateTutorialDefinition({
      steps: [
        {
          id: 'bad-gate-step',
          // @ts-expect-error intentional: testing runtime validation of wrong type
          gate: { 'some label': 'not a function' },
        },
      ],
    })).toThrow(/bad-gate-step/i);
  });
});
