import { describe, it, expect } from 'vitest';
import { Game, Action, sequence, phase, eachPlayer, loop, actionStep, type GameOptions } from '../index.js';

/**
 * #971: restore stamped `iteration: 0` on every frame whose saved data had
 * none, so a restored position reported counters for phase, sequence and
 * eachPlayer frames that the live game never had.
 */
class NestedGame extends Game<NestedGame> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(Action.create<NestedGame>('a').execute(() => ({ success: true })));
    this.setFlow({
      root: phase('main', {
        do: sequence(
          actionStep<NestedGame>({ name: 'setup', actions: ['a'] }),
          loop<NestedGame>({
            name: 'rounds',
            maxIterations: 10,
            do: eachPlayer<NestedGame>({
              do: sequence(
                actionStep<NestedGame>({ name: 'first', actions: ['a'] }),
                actionStep<NestedGame>({ name: 'second', actions: ['a'] }),
              ),
            }),
          }),
        ),
      }),
    });
  }
}

describe('#971: restore keeps only the iteration counters it saved', () => {
  it('a restored position reports the same iterations as the live one', () => {
    const live = new NestedGame({ playerCount: 2, seed: 's' });
    live.startFlow();
    live.continueFlow('a', {}, 1);
    live.continueFlow('a', {}, 1);
    const saved = live.getFlowState()!;
    expect(live.getFlowDebugInfo().step).toBe('second');

    const restored = new NestedGame({ playerCount: 2, seed: 's' });
    restored.startFlow();
    restored.restoreFlowState(saved);

    expect(restored.getFlowState()!.position.iterations).toEqual(saved.position.iterations);
    expect(Object.keys(saved.position.iterations)).toHaveLength(1);
  });

  it('a restored loop keeps counting into its next pass', () => {
    const live = new NestedGame({ playerCount: 2, seed: 's' });
    live.startFlow();
    live.continueFlow('a', {}, 1);
    live.continueFlow('a', {}, 1);

    const restored = new NestedGame({ playerCount: 2, seed: 's' });
    restored.startFlow();
    restored.restoreFlowState(live.getFlowState()!);
    restored.continueFlow('a', {}, 1);
    restored.continueFlow('a', {}, 2);
    restored.continueFlow('a', {}, 2);

    expect(Object.values(restored.getFlowState()!.position.iterations)).toEqual([2]);
  });
});
