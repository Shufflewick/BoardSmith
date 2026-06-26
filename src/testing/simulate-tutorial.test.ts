/**
 * Tests for simulateTutorial DSL.
 *
 * Covers:
 * - Happy path: scripted tutorial runs to completion.
 * - Drift A (gate): scenario action excluded by the active gate throws.
 * - Drift B (predicate): expectStep not reached after action throws.
 * - Non-completion: assertTutorialCompletes throws when tutorial unfinished.
 * - assertTutorialStep: throws/passes based on current step.
 *
 * Uses raw labeled advanceWhen predicates (independent of Plan 02 helpers).
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
import { simulateTutorial } from './simulate-tutorial.js';
import { assertTutorialStep, assertTutorialCompletes } from './tutorial-assertions.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';

// ============================================
// In-test game classes
// ============================================

/**
 * Minimal two-action game used for tutorial DSL tests.
 *
 * Tracks `moveCount` and `passCount` so advanceWhen predicates can observe
 * state change without requiring board elements.
 */
class TutSimGame extends Game<TutSimGame, Player> {
  moveCount = 0;
  passCount = 0;

  constructor(options: GameOptions) {
    super(options);

    const moveAction = Action.create('move')
      .prompt('Move a piece')
      .execute((ctx) => {
        (ctx.game as TutSimGame).moveCount++;
      });

    const passAction = Action.create('pass')
      .prompt('Pass your turn')
      .execute((ctx) => {
        (ctx.game as TutSimGame).passCount++;
      });

    this.registerActions(moveAction, passAction);

    const flow = defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 50,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] }),
        }),
      }),
    });
    this.setFlow(flow);
  }
}

// ============================================
// Tutorial definitions
// ============================================

/** Two-step tutorial where both steps complete via advanceWhen predicates. */
const HAPPY_TUTORIAL: TutorialDefinition = {
  steps: [
    {
      id: 'step-move',
      gate: { action: 'move' },
      advanceWhen: {
        'player has moved once': (ctx) => (ctx.game as TutSimGame).moveCount >= 1,
      },
    },
    {
      id: 'step-pass',
      gate: { action: 'pass' },
      advanceWhen: {
        'player has passed once': (ctx) => (ctx.game as TutSimGame).passCount >= 1,
      },
    },
  ],
};

/** Two-step tutorial with no advanceWhen — used for non-completion tests. */
const NO_AUTO_ADVANCE_TUTORIAL: TutorialDefinition = {
  steps: [
    { id: 'step-1', gate: { action: 'move' } },
    { id: 'step-2', gate: { action: 'pass' } },
  ],
};

// ============================================
// Tests
// ============================================

describe('simulateTutorial', () => {
  describe('happy path', () => {
    it('runs a two-step scripted tutorial to completion', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'happy-seed' });
      const result = simulateTutorial(testGame, HAPPY_TUTORIAL, {
        seat: 1,
        scenario: [
          { action: 'move', expectStep: 'step-pass' },
          { action: 'pass' },
        ],
      });

      expect(result.completed).toBe(true);
      expect(result.stepsVisited).toContain('step-move');
      expect(result.stepsVisited).toContain('step-pass');
    });

    it('assertTutorialCompletes does not throw when tutorial completed', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'happy-seed' });
      const result = simulateTutorial(testGame, HAPPY_TUTORIAL, {
        seat: 1,
        scenario: [
          { action: 'move' },
          { action: 'pass' },
        ],
      });

      expect(() => assertTutorialCompletes(result)).not.toThrow();
    });

    it('seed makes the run reproducible: same seed → same result', () => {
      const run1 = () => {
        const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'pinned' });
        return simulateTutorial(testGame, HAPPY_TUTORIAL, {
          seat: 1,
          scenario: [{ action: 'move' }, { action: 'pass' }],
          seed: 'pinned',
        });
      };

      const run2 = () => {
        const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'pinned' });
        return simulateTutorial(testGame, HAPPY_TUTORIAL, {
          seat: 1,
          scenario: [{ action: 'move' }, { action: 'pass' }],
          seed: 'pinned',
        });
      };

      const r1 = run1();
      const r2 = run2();
      expect(r1.completed).toBe(r2.completed);
      expect(r1.finalStepId).toBe(r2.finalStepId);
      expect(r1.stepsVisited).toEqual(r2.stepsVisited);
    });
  });

  describe('Drift A (gate): scripted action excluded by active gate', () => {
    it('throws when scenario action is blocked by the current step gate', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'drift-a' });
      const def: TutorialDefinition = {
        steps: [
          { id: 'step-1', gate: { action: 'move' } }, // 'pass' is blocked
        ],
      };

      expect(() =>
        simulateTutorial(testGame, def, {
          seat: 1,
          scenario: [{ action: 'pass' }], // 'pass' is blocked on step-1
        })
      ).toThrow(/gate|disabled|step-1|pass/i);
    });

    it('error message names the blocked action and the step id', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'drift-a' });
      const def: TutorialDefinition = {
        steps: [
          { id: 'gated-step', gate: { action: 'move' } },
        ],
      };

      let message = '';
      try {
        simulateTutorial(testGame, def, {
          seat: 1,
          scenario: [{ action: 'pass' }],
        });
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain('pass');
      expect(message).toContain('gated-step');
    });
  });

  describe('Drift B (predicate): advanceWhen does not fire when expected', () => {
    it('throws when expectStep is set but predicate does not fire', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'drift-b' });
      const def: TutorialDefinition = {
        steps: [
          {
            id: 'step-1',
            gate: { action: 'move' },
            // Predicate requires 2 moves, but scenario only does 1.
            advanceWhen: {
              'needs two moves': (ctx) => (ctx.game as TutSimGame).moveCount >= 2,
            },
          },
          { id: 'step-2', gate: { action: 'pass' } },
        ],
      };

      expect(() =>
        simulateTutorial(testGame, def, {
          seat: 1,
          scenario: [
            { action: 'move', expectStep: 'step-2' }, // predicate won't fire after 1 move
          ],
        })
      ).toThrow(/expected advance.*step-2.*did not fire/i);
    });
  });

  describe('non-completion', () => {
    it('result.completed is false when scenario ends before last step', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'non-complete' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [
          { action: 'move' }, // gate on step-1 allows this, but no advanceWhen to move to step-2
        ],
      });

      expect(result.completed).toBe(false);
    });

    it('assertTutorialCompletes throws when tutorial is not complete', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'non-complete' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [
          { action: 'move' },
        ],
      });

      expect(() => assertTutorialCompletes(result)).toThrow(/not.*complet|complet.*false/i);
    });
  });

  describe('assertTutorialStep', () => {
    it('throws when step does not match expected (TestGame overload)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'assert-step' });
      simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [], // no moves — still on step-1
      });

      expect(() => assertTutorialStep(testGame, 1, 'step-2'))
        .toThrow(/step-2|step-1/i);
    });

    it('passes without throwing when step matches expected (TestGame overload)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'assert-step' });
      simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [], // no moves — still on step-1
      });

      expect(() => assertTutorialStep(testGame, 1, 'step-1')).not.toThrow();
    });

    it('throws when finalStepId does not match expected (result overload)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'assert-step-result' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [],
      });

      expect(() => assertTutorialStep(result, 1, 'step-2'))
        .toThrow(/step-2|step-1/i);
    });

    it('passes when finalStepId matches expected (result overload)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'assert-step-result' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        seat: 1,
        scenario: [],
      });

      expect(() => assertTutorialStep(result, 1, 'step-1')).not.toThrow();
    });
  });

  describe('validateTutorialDefinition surfaces on call', () => {
    it('throws synchronously when tutorial definition has no steps', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'validate' });
      const emptyDef: TutorialDefinition = { steps: [] };

      expect(() =>
        simulateTutorial(testGame, emptyDef, {
          seat: 1,
          scenario: [],
        })
      ).toThrow(/no steps|empty/i);
    });
  });
});
