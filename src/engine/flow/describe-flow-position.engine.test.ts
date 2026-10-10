import { describe, it, expect } from 'vitest';
import {
  Game,
  Action,
  sequence,
  actionStep,
  ifThen,
  switchOn,
  type GameOptions,
} from '../index.js';
import { PlayThenAcknowledgeGame } from '../../session/testing/fixtures/play-then-acknowledge-fixture.js';

/**
 * #324: `getFlowDebugInfo()` must name the step the engine is actually
 * awaiting. These tests drive a real engine to each step, so the position
 * they describe is the one the engine produced, not a hand-built path.
 *
 * Every step of the flow below is a named action step taking the one action
 * `go`, so each `go` moves the flow to the next step in declaration order:
 * two plain sequence children, the `else` branch of an `if`, the second case
 * of a `switch`, the `default` of a `switch`, and the last sequence child.
 */
class StepTourGame extends Game<StepTourGame> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<StepTourGame>('go').execute(() => ({ success: true })),
    );
    const step = (name: string) => actionStep<StepTourGame>({ name, actions: ['go'] });
    this.setFlow({
      root: sequence(
        step('first'),
        step('second'),
        ifThen({ condition: () => false, then: step('then-branch'), else: step('else-branch') }),
        switchOn({ on: () => 'b', cases: { a: step('case-a'), b: step('case-b') } }),
        switchOn({ on: () => 'none', cases: { a: step('unused-case') }, default: step('default-branch') }),
        step('last'),
      ),
    });
  }
}

const TOUR = ['first', 'second', 'else-branch', 'case-b', 'default-branch', 'last'];

describe('#324: getFlowDebugInfo names the step the engine is awaiting', () => {
  it('names each step of a sequence, including if and switch branches', () => {
    const game = new StepTourGame({ playerCount: 1, seed: 'tour' });
    game.startFlow();

    for (const [i, name] of TOUR.entries()) {
      const info = game.getFlowDebugInfo();
      expect(info.step, `after ${i} moves`).toBe(name);
      expect(info.describe()).toBe(`step *${name}*, waiting on seat 1`);
      game.continueFlow('go', {}, 1);
    }
  });

  it('names the same step after the position is restored into a fresh game', () => {
    const live = new StepTourGame({ playerCount: 1, seed: 'tour' });
    live.startFlow();

    for (const name of TOUR) {
      const restored = new StepTourGame({ playerCount: 1, seed: 'tour' });
      restored.startFlow();
      restored.restoreFlowState(live.getFlowState()!);
      expect(restored.getFlowDebugInfo().step).toBe(name);
      live.continueFlow('go', {}, 1);
    }
  });

  it('names a simultaneous step that is the last child of a sequence (the issue\'s repro)', () => {
    const game = new PlayThenAcknowledgeGame({ playerCount: 2, seed: 'x' });
    game.startFlow();
    game.continueFlow('playCard', { card: 1 });
    game.continueFlow('playCard', { card: 2 });

    expect(game.getFlowDebugInfo().step).toBe('scoring');
  });
});
