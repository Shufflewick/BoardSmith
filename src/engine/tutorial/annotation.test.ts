/**
 * Guard tests for the annotation content model (Phase 105, Plan 01).
 *
 * Verifies:
 *   1. An authored `content` array round-trips through `getActiveTutorialStepView`
 *      with deep equality preserved (all entries, all target kinds).
 *   2. A step with no `content` projects a view where `content` is absent
 *      (`'content' in view === false`).
 *   3. Compile-time: each of the three `AnnotationTarget` kinds is accepted by
 *      the `Annotation[]` type (construction below is the type-level assertion).
 */

import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Space, Action, defineFlow, loop, eachPlayer, actionStep, type FlowContext } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { TutorialController } from '../../session/tutorial-controller.js';
import { getActiveTutorialStepView } from './gate.js';
import type { Annotation, AnnotationTarget, TutorialDefinition } from './types.js';

// ============================================================
// Compile-time type guard: all three AnnotationTarget kinds
// ============================================================

// These constants are only constructed to assert at compile time that each
// discriminant is accepted by `Annotation[]`. They are intentionally unused at
// runtime (no `expect` calls); the TypeScript compiler rejects the file if the
// shapes are wrong.

const _elementAnnotation: Annotation = {
  text: 'Move your piece to d4',
  target: { kind: 'element', ref: { notation: 'd4' } } satisfies AnnotationTarget,
  placement: 'auto',
};

const _actionAnnotation: Annotation = {
  text: 'Click the Move button',
  target: { kind: 'action', actionName: 'move' } satisfies AnnotationTarget,
};

const _panelAnnotation: Annotation = {
  text: 'Look at the action panel',
  target: { kind: 'panel' } satisfies AnnotationTarget,
  placement: 'bottom',
};

// Validate the array type accepts all three kinds
const _allKinds: Annotation[] = [_elementAnnotation, _actionAnnotation, _panelAnnotation];
void _allKinds; // suppress unused-variable lint

// ============================================================
// Minimal test game
// ============================================================

class AnnotationTestGame extends Game<AnnotationTestGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    this.registerElements([AnnotationSpace]);

    const moveAction = Action.create('move')
      .prompt('Move a piece')
      .chooseFrom('piece', { choices: ['a', 'b', 'c'] })
      .execute(() => {});

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(moveAction, passAction);

    const flow = defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 20,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] }),
        }),
      }),
    });
    this.setFlow(flow);
  }
}

class AnnotationSpace extends Space<AnnotationTestGame> {}

// ============================================================
// Tutorial definitions used in the tests
// ============================================================

const CONTENT_ANNOTATIONS: Annotation[] = [
  {
    text: 'Move your piece to d4',
    target: { kind: 'element', ref: { notation: 'd4' } },
  },
  {
    text: 'This is a floating bubble with no target',
  },
];

const ANNOTATION_TUTORIAL: TutorialDefinition = {
  steps: [
    {
      id: 'step-with-content',
      gate: { action: 'move' },
      content: CONTENT_ANNOTATIONS,
    },
    {
      id: 'step-without-content',
      gate: { action: 'pass' },
      // no content — view.content must be absent
    },
  ],
};

// ============================================================
// Tests
// ============================================================

describe('annotation content model — projection round-trip', () => {
  it('content deep-equals the authored array through getActiveTutorialStepView', () => {
    const runner = new GameRunner<AnnotationTestGame>({
      GameClass: AnnotationTestGame,
      gameType: 'annotation-test',
      gameOptions: {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'annotation-test',
        tutorial: ANNOTATION_TUTORIAL,
      },
    });
    runner.start();

    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });
    controller.start(1); // activates 'step-with-content'

    const view = getActiveTutorialStepView(runner.game, 1);

    expect(view).toBeDefined();
    expect(view!.stepId).toBe('step-with-content');
    // Deep equality — both entries present, order preserved, all fields intact
    expect(view!.content).toEqual(CONTENT_ANNOTATIONS);
  });

  it('content is absent from the view when the step has no content', () => {
    const runner = new GameRunner<AnnotationTestGame>({
      GameClass: AnnotationTestGame,
      gameType: 'annotation-test-no-content',
      gameOptions: {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'annotation-test-no-content',
        tutorial: ANNOTATION_TUTORIAL,
      },
    });
    runner.start();

    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });
    controller.start(1); // activates 'step-with-content'

    // Advance to the step that has no content
    controller.advance(1); // moves to 'step-without-content'

    const view = getActiveTutorialStepView(runner.game, 1);

    expect(view).toBeDefined();
    expect(view!.stepId).toBe('step-without-content');
    // 'content' must not be a key on the projected view — not just undefined
    expect('content' in view!).toBe(false);
  });

  it('all three AnnotationTarget kinds survive the projection', () => {
    const allKindsTutorial: TutorialDefinition = {
      steps: [
        {
          id: 'all-kinds',
          gate: { action: 'move' },
          content: [
            {
              text: 'Element annotation',
              target: { kind: 'element', ref: { notation: 'a1' } },
            },
            {
              text: 'Action annotation',
              target: { kind: 'action', actionName: 'move' },
            },
            {
              text: 'Panel annotation',
              target: { kind: 'panel' },
              placement: 'center',
            },
          ],
        },
      ],
    };

    const runner = new GameRunner<AnnotationTestGame>({
      GameClass: AnnotationTestGame,
      gameType: 'annotation-test-all-kinds',
      gameOptions: {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'annotation-test-all-kinds',
        tutorial: allKindsTutorial,
      },
    });
    runner.start();

    const controller = new TutorialController(() => runner, { broadcast: vi.fn() });
    controller.start(1);

    const view = getActiveTutorialStepView(runner.game, 1);

    expect(view).toBeDefined();
    expect(view!.content).toHaveLength(3);

    const [elementAnn, actionAnn, panelAnn] = view!.content!;

    expect(elementAnn.target).toEqual({ kind: 'element', ref: { notation: 'a1' } });
    expect(actionAnn.target).toEqual({ kind: 'action', actionName: 'move' });
    expect(panelAnn.target).toEqual({ kind: 'panel' });
    expect(panelAnn.placement).toBe('center');
  });
});
