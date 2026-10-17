/**
 * Tests for simulateTutorial DSL.
 *
 * Covers:
 * - Happy path: scripted tutorial runs to completion.
 * - Drift A (gate): scenario action excluded by the active gate throws.
 * - Drift B (predicate): expectStep not reached after action throws.
 * - Non-completion: assertTutorialCompletes throws when tutorial unfinished.
 *
 * Uses raw labeled advanceWhen predicates (independent of Plan 02 helpers).
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  type FlowDefinition,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { simulateTutorial } from './simulate-tutorial.js';
import { assertTutorialCompletes } from './tutorial-assertions.js';
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
      .execute((_args, ctx) => {
        (ctx.game as TutSimGame).moveCount++;
      });

    const passAction = Action.create('pass')
      .prompt('Pass your turn')
      .execute((_args, ctx) => {
        (ctx.game as TutSimGame).passCount++;
      });

    this.registerActions(moveAction, passAction);

    const flow: FlowDefinition = {
      root: loop({
        while: () => true,
        maxIterations: 50,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] , turnScope: 'restart' }),
        }),
      }),
    };
    this.setFlow(flow);
  }
}

class Token extends Piece<TokenGame> {}
class Bag extends Space<TokenGame> {}

/** One `take` action that picks a token, and a preset that replaces every token. */
class TokenGame extends Game<TokenGame, Player> {
  bag!: Bag;

  constructor(options: GameOptions) {
    super(options);
    this.bag = this.create(Bag, 'bag');
    this.bag.create(Token, 'token');
    this.registerAction(
      Action.create<TokenGame>('take')
        .chooseElement('token', { elementClass: Token, from: (ctx) => ctx.game.bag })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: loop({ while: () => true, maxIterations: 50, do: eachPlayer({ do: actionStep({ actions: ['take'] }) }) }) });
  }

  resetToPreset(): void {
    for (const token of this.bag.all(Token)) token.remove();
    this.bag.create(Token, 'token');
  }
}

// ============================================
// Tutorial definitions
// ============================================

/** Two-step tutorial where both steps complete via advanceWhen predicates. */
const HAPPY_TUTORIAL: TutorialDefinition = {
  learnerSeat: 1,
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
  learnerSeat: 1,
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
      // Single-player: tutorial seat always has the next turn.
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'happy-seed' });
      const result = simulateTutorial(testGame, HAPPY_TUTORIAL, {
        scenario: () => [
          { action: 'move', expectStep: 'step-pass' },
          { action: 'pass' },
        ],
      });

      expect(result.completed).toBe(true);
      expect(result.stepsVisited).toContain('step-move');
      expect(result.stepsVisited).toContain('step-pass');
    });

    it("runs for the tutorial's learnerSeat (#552)", () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'happy-seed' });

      const result = simulateTutorial(testGame, { ...HAPPY_TUTORIAL, learnerSeat: 2 }, { scenario: () => [] });

      expect(testGame.game.tutorialProgress.get(2)).toEqual({ stepId: 'step-move', status: 'running' });
      expect(testGame.game.tutorialProgress.has(1)).toBe(false);
      expect(result.stepsVisited).toEqual(['step-move']);
    });

    it('assertTutorialCompletes does not throw when tutorial completed', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'happy-seed' });
      const result = simulateTutorial(testGame, HAPPY_TUTORIAL, {
        scenario: () => [
          { action: 'move' },
          { action: 'pass' },
        ],
      });

      expect(() => assertTutorialCompletes(result)).not.toThrow();
    });

    it('records the effective game seed in the result (seed traceability)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'happy-seed' });
      const result = simulateTutorial(testGame, HAPPY_TUTORIAL, {
        scenario: () => [{ action: 'move' }, { action: 'pass' }],
      });

      expect(result.seed).toBe('happy-seed');
      expect(result.seed).toBe(testGame.seed);
    });

    it('throws an actionable error when options.seed mismatches the TestGame seed', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'game-seed' });

      expect(() =>
        simulateTutorial(testGame, HAPPY_TUTORIAL, {
          scenario: () => [{ action: 'move' }, { action: 'pass' }],
          seed: 'different-seed',
        }),
      ).toThrow(/does not match/);
    });

    it('seed makes the run reproducible: same seed → same result', () => {
      const run1 = () => {
        const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'pinned' });
        return simulateTutorial(testGame, HAPPY_TUTORIAL, {
          scenario: () => [{ action: 'move' }, { action: 'pass' }],
          seed: 'pinned',
        });
      };

      const run2 = () => {
        const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'pinned' });
        return simulateTutorial(testGame, HAPPY_TUTORIAL, {
          scenario: () => [{ action: 'move' }, { action: 'pass' }],
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
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'drift-a' });
      const def: TutorialDefinition = {
        learnerSeat: 1,
        steps: [
          { id: 'step-1', gate: { action: 'move' } }, // 'pass' is blocked
        ],
      };

      expect(() =>
        simulateTutorial(testGame, def, {
          scenario: () => [{ action: 'pass' }], // 'pass' is blocked on step-1
        })
      ).toThrow(/gate|disabled|step-1|pass/i);
    });

    it('error message names the blocked action and the step id', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'drift-a' });
      const def: TutorialDefinition = {
        learnerSeat: 1,
        steps: [
          { id: 'gated-step', gate: { action: 'move' } },
        ],
      };

      let message = '';
      try {
        simulateTutorial(testGame, def, {
          scenario: () => [{ action: 'pass' }],
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
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'drift-b' });
      const def: TutorialDefinition = {
        learnerSeat: 1,
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
          scenario: () => [
            { action: 'move', expectStep: 'step-2' }, // predicate won't fire after 1 move
          ],
        })
      ).toThrow(/expected advance.*step-2.*did not fire/i);
    });
  });

  describe('non-completion', () => {
    it('result.completed is false when scenario ends before last step', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'non-complete' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        scenario: () => [
          { action: 'move' }, // gate on step-1 allows this, but no advanceWhen to move to step-2
        ],
      });

      expect(result.completed).toBe(false);
    });

    it('assertTutorialCompletes throws when tutorial is not complete', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'non-complete' });
      const result = simulateTutorial(testGame, NO_AUTO_ADVANCE_TUTORIAL, {
        scenario: () => [
          { action: 'move' },
        ],
      });

      expect(() => assertTutorialCompletes(result)).toThrow(/not.*complet|complet.*false/i);
    });
  });

  describe('validateTutorialDefinition surfaces on call', () => {
    it('throws synchronously when tutorial definition has no steps', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'validate' });
      const emptyDef: TutorialDefinition = { learnerSeat: 1, steps: [] };

      expect(() =>
        simulateTutorial(testGame, emptyDef, {
          scenario: () => [],
        })
      ).toThrow(/no steps|empty/i);
    });
  });

  describe('starts the tutorial the way the server does (#914)', () => {
    it('gives the learner the opening turn when the flow would open with another seat', () => {
      // Seat 1 opens TutSimGame; the server restarts the flow with seat 2 to move.
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'learner-2' });

      const result = simulateTutorial(testGame, { ...HAPPY_TUTORIAL, learnerSeat: 2 }, {
        scenario: () => [{ action: 'move', expectStep: 'step-pass' }],
      });

      expect(result.finalStepId).toBe('step-pass');
    });

    it('does not gate opponent moves, since only the learner has a tutorial', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 2, seed: 'opponent' });
      const def: TutorialDefinition = { learnerSeat: 1, steps: [{ id: 'step-1', gate: { action: 'move' } }] };

      simulateTutorial(testGame, def, {
        scenario: () => [
          { action: 'move' },
          { action: 'pass', seat: 2 }, // 'pass' is gated for the learner only
        ],
      });

      expect(testGame.game.tutorialProgress.has(2)).toBe(false);
    });

    it("applies the tutorial's setup before the first step", () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'setup' });

      const result = simulateTutorial(testGame, {
        ...HAPPY_TUTORIAL,
        setup: (game) => { (game as TutSimGame).moveCount = 1; },
      }, { scenario: () => [] });

      expect(result.stepsVisited).toEqual(['step-move', 'step-pass']);
    });

    it('refuses a game that is already over, as the server does', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'over' });
      testGame.game.finish([]);

      expect(() => simulateTutorial(testGame, HAPPY_TUTORIAL, { scenario: () => [] })).toThrow(/game is over/);
    });

    it('builds the scenario from the board setup left, so a setup that replaces elements still passes (#1079)', () => {
      const testGame = TestGame.create(TokenGame, { playerCount: 1, seed: 'post-setup' });
      const def: TutorialDefinition = {
        learnerSeat: 1,
        steps: [{ id: 'take-a-token', gate: { action: 'take' } }],
        setup: (game) => (game as TokenGame).resetToPreset(),
      };

      const result = simulateTutorial(testGame, def, {
        scenario: (game) => [{ action: 'take', args: { token: game.bag.first(Token)! } }],
      });

      expect(result.finalStepId).toBe('take-a-token');
    });

    it('calls the scenario once, after the tutorial has started with setup applied (#1079)', () => {
      const testGame = TestGame.create(TutSimGame, { playerCount: 1, seed: 'scenario-once' });
      const seen: Array<{ passCount: number; started: boolean }> = [];

      simulateTutorial(testGame, {
        ...HAPPY_TUTORIAL,
        setup: (game) => { (game as TutSimGame).passCount = 7; },
      }, {
        scenario: (game) => {
          seen.push({ passCount: game.passCount, started: game.tutorialProgress.has(1) });
          return [{ action: 'move' }];
        },
      });

      expect(seen).toEqual([{ passCount: 7, started: true }]);
      expect(testGame.game.moveCount).toBe(1);
    });
  });
});
