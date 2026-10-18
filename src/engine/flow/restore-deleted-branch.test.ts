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

class NestedGame extends Game<NestedGame> {
  static rules: Rules = 'old';

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(Action.create<NestedGame>('a').execute(() => ({ success: true })));
    const step = (name: string) => actionStep<NestedGame>({ name, actions: ['a'] });
    const middle = NestedGame.rules === 'old' ? sequence(step('inner-a'), step('inner-b')) : step('middle');
    this.setFlow({ root: sequence(step('first'), middle, step('last')) });
  }
}

describe('restoring a save deeper than the current rules go is refused', () => {
  it('refuses a save inside a sequence the rules replaced with a single step', () => {
    NestedGame.rules = 'old';
    const live = new NestedGame({ playerCount: 1, seed: 's' });
    live.startFlow();
    live.continueFlow('a', {}, 1);
    live.continueFlow('a', {}, 1);
    expect(live.getFlowDebugInfo().step).toBe('inner-b');
    const saved = live.getFlowState()!;

    NestedGame.rules = 'new';
    const restored = new NestedGame({ playerCount: 1, seed: 's' });
    restored.startFlow();
    expect(() => restored.restoreFlowState(saved)).toThrow(
      /Flow position invalid: .*"middle".*no longer have/,
    );
  });
});

type CaseRules = 'unchanged' | 'reordered' | 'removed-other' | 'removed-own' | 'with-default';

class CaseGame extends Game<CaseGame> {
  static rules: CaseRules = 'unchanged';

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(Action.create<CaseGame>('a').execute(() => ({ success: true })));
    const step = (name: string) => actionStep<CaseGame>({ name, actions: ['a'] });
    const cases: Record<CaseRules, Record<string, FlowNode<CaseGame>>> = {
      unchanged: { one: step('case-one'), two: step('case-two'), three: step('case-three') },
      reordered: { three: step('case-three'), two: step('case-two'), one: step('case-one') },
      'removed-other': { two: step('case-two'), three: step('case-three') },
      'removed-own': { one: step('case-one'), three: step('case-three') },
      'with-default': { one: step('case-one'), three: step('case-three') },
    };
    const fallback = CaseGame.rules === 'with-default' ? { default: step('case-default') } : {};
    this.setFlow({
      root: sequence(
        step('first'),
        switchOn({ name: 'pick', on: () => 'two', cases: cases[CaseGame.rules], ...fallback }),
        step('last'),
      ),
    });
  }
}

/** Saves inside the switch under `savedUnder`, then starts a game under `rules` to restore it into. */
function restoreUnder(rules: CaseRules, savedUnder: CaseRules = 'unchanged') {
  CaseGame.rules = savedUnder;
  const live = new CaseGame({ playerCount: 1, seed: 's' });
  live.startFlow();
  live.continueFlow('a', {}, 1);
  expect(live.getFlowDebugInfo().step).toBe(savedUnder === 'with-default' ? 'case-default' : 'case-two');
  const saved = live.getFlowState()!;
  // What a save from before #966 also held for case "two": its position among the cases, which must never be read.
  saved.position.frameData!.__frame_1.branchIndex = 1;

  CaseGame.rules = rules;
  const restored = new CaseGame({ playerCount: 1, seed: 's' });
  restored.startFlow();
  return { restored, saved };
}

describe('#966: a switchOn case is restored by its key, not its position', () => {
  it('refuses a save inside a case the rules removed, naming the case, even when another case now sits at its position', () => {
    const { restored, saved } = restoreUnder('removed-own');
    expect(() => restored.restoreFlowState(saved)).toThrow(
      /Flow position invalid: .*case "two" of switch "pick".*no longer have/,
    );
  });

  it('refuses a save inside a default branch the rules removed, naming the default case', () => {
    const { restored, saved } = restoreUnder('unchanged', 'with-default');
    expect(() => restored.restoreFlowState(saved)).toThrow(
      /Flow position invalid: .*the default case of switch "pick".*no longer have/,
    );
  });

  it.each(['unchanged', 'reordered', 'removed-other'] as const)(
    'restores a save inside case "two" into case "two" when the rules are %s',
    (rules) => {
      const { restored, saved } = restoreUnder(rules);
      restored.restoreFlowState(saved);
      expect(restored.getFlowDebugInfo().step).toBe('case-two');
      restored.continueFlow('a', {}, 1);
      expect(restored.getFlowDebugInfo().step).toBe('last');
    },
  );
});
