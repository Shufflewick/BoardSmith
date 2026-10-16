import { describe, it, expect } from 'vitest';
import { Game, Action, sequence, actionStep, ifThen, switchOn, type GameOptions, type FlowNode } from '../index.js';

/**
 * #777: a save made inside a branch the current rules no longer have must be
 * refused on restore. Before the fix the restored stack kept the `switch`/`if`
 * frame on top, `resume` skipped its allow-list check, and any action ran.
 */
type Rules = 'old' | 'new';

class BranchGame extends Game<BranchGame> {
  static rules: Rules = 'old';
  static shape: 'switch' | 'if' = 'switch';

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<BranchGame>('a').execute(() => ({ success: true })),
      Action.create<BranchGame>('b').execute(() => ({ success: true })),
    );
    const step = (name: string) => actionStep<BranchGame>({ name, actions: ['a'] });
    const old = BranchGame.rules === 'old';
    const branch: FlowNode<BranchGame> = BranchGame.shape === 'switch'
      ? switchOn({
          name: 'pick',
          on: () => 'old',
          cases: old ? { keep: step('keep'), old: step('old-case') } : { keep: step('keep') },
        })
      : ifThen({
          name: 'check',
          condition: () => false,
          then: step('then-branch'),
          ...(old ? { else: step('else-branch') } : {}),
        });
    this.setFlow({ root: sequence(step('first'), branch, step('last')) });
  }
}

function saveInsideRemovedBranch(shape: 'switch' | 'if') {
  BranchGame.shape = shape;
  BranchGame.rules = 'old';
  const live = new BranchGame({ playerCount: 1, seed: 's' });
  live.startFlow();
  live.continueFlow('a', {}, 1);
  const saved = live.getFlowState()!;
  expect(live.getFlowDebugInfo().step).toBe(shape === 'switch' ? 'old-case' : 'else-branch');

  BranchGame.rules = 'new';
  const restored = new BranchGame({ playerCount: 1, seed: 's' });
  restored.startFlow();
  return { restored, saved };
}

describe('#777: restoring a save inside a removed branch is refused', () => {
  it('refuses a save inside a switchOn case the rules removed, naming the switch', () => {
    const { restored, saved } = saveInsideRemovedBranch('switch');
    expect(() => restored.restoreFlowState(saved)).toThrow(
      /Flow position invalid: .*"pick".*no longer have/,
    );
  });

  it('refuses a save inside an if else-branch the rules removed, naming the if', () => {
    const { restored, saved } = saveInsideRemovedBranch('if');
    expect(() => restored.restoreFlowState(saved)).toThrow(
      /Flow position invalid: .*"check".*no longer have/,
    );
  });
});
