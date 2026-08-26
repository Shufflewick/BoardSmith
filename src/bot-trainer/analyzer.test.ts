/**
 * The trainer's statistics layer: what turns simulated games into the feature
 * correlations and action preferences the generated bot is built from.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  analyzeFeatures,
  analyzeActions,
  selectTopFeatures,
  correlationToWeight,
  printAnalysisSummary,
} from './analyzer.js';
import type { CandidateFeature, FeatureStats, ActionStats, GameData, StateSnapshot } from './types.js';

const feature = (id: string): CandidateFeature => ({
  id,
  description: id,
  category: 'boolean',
  evaluate: () => true,
  templateId: 'test',
});

const state = (
  decidingPlayer: number,
  featureValues: Record<string, boolean>,
  extra: Partial<StateSnapshot> = {},
): StateSnapshot => ({
  actionNumber: 1,
  decidingPlayer,
  featureValues: new Map(Object.entries(featureValues)),
  availableActions: [],
  ...extra,
});

const game = (overrides: Partial<GameData>): GameData => ({
  gameId: 'g1',
  playerCount: 2,
  states: [],
  winners: [0],
  totalActions: 1,
  completed: true,
  ...overrides,
});

const statOf = (stats: FeatureStats[], id: string) => stats.find((s) => s.featureId === id)!;

describe('analyzeFeatures', () => {
  it('returns one stat row per candidate feature, even with no games', () => {
    const stats = analyzeFeatures([], [feature('a'), feature('b')]);
    expect(stats.map((s) => s.featureId)).toEqual(['a', 'b']);
  });

  it('starts an unobserved feature at a neutral 0.5 win rate and no correlation', () => {
    const [stat] = analyzeFeatures([], [feature('a')]);
    expect(stat).toMatchObject({
      trueAndWon: 0,
      trueAndLost: 0,
      falseAndWon: 0,
      falseAndLost: 0,
      winRateWhenTrue: 0.5,
      winRateWhenFalse: 0.5,
      correlation: 0,
      pValue: 1,
    });
  });

  it('credits a feature that was true for the eventual winner', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a')).toMatchObject({ trueAndWon: 1, trueAndLost: 0 });
  });

  it('charges a feature that was true for the eventual loser', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(1, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a')).toMatchObject({ trueAndWon: 0, trueAndLost: 1 });
  });

  it('tracks the false side of the table too', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: false }), state(1, { a: false })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a')).toMatchObject({ falseAndWon: 1, falseAndLost: 1 });
  });

  it('splits a drawn game half to each side rather than dropping it', () => {
    const stats = analyzeFeatures(
      [game({ winners: [], states: [state(0, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a')).toMatchObject({ trueAndWon: 0.5, trueAndLost: 0.5 });
  });

  it('treats an all-players-win result as a draw', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0, 1], playerCount: 2, states: [state(0, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').trueAndWon).toBe(0.5);
  });

  it('ignores games that did not complete', () => {
    const stats = analyzeFeatures(
      [game({ completed: false, states: [state(0, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').trueAndWon).toBe(0);
  });

  it('ignores feature values that were not asked for', () => {
    const stats = analyzeFeatures(
      [game({ states: [state(0, { a: true, unknown: true })] })],
      [feature('a')],
    );
    expect(stats.map((s) => s.featureId)).toEqual(['a']);
  });

  it('computes the win rate on each side of the split', () => {
    const stats = analyzeFeatures(
      [game({
        winners: [0],
        states: [
          state(0, { a: true }), state(0, { a: true }), state(1, { a: true }),
          state(1, { a: false }),
        ],
      })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').winRateWhenTrue).toBeCloseTo(2 / 3, 10);
    expect(statOf(stats, 'a').winRateWhenFalse).toBe(0);
  });

  it('scores a perfectly predictive feature at correlation +1', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: true }), state(1, { a: false })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').correlation).toBeCloseTo(1, 10);
  });

  it('scores a perfectly anti-predictive feature at correlation -1', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: false }), state(1, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').correlation).toBeCloseTo(-1, 10);
  });

  it('scores an uninformative feature near zero correlation', () => {
    const stats = analyzeFeatures(
      [game({
        winners: [0],
        states: [
          state(0, { a: true }), state(0, { a: false }),
          state(1, { a: true }), state(1, { a: false }),
        ],
      })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').correlation).toBeCloseTo(0, 10);
  });

  it('gives a constant feature zero correlation rather than dividing by zero', () => {
    const stats = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: true }), state(1, { a: true })] })],
      [feature('a')],
    );
    expect(statOf(stats, 'a').correlation).toBe(0);
    expect(Number.isNaN(statOf(stats, 'a').correlation)).toBe(false);
  });

  it('reports a p-value in [0, 1], smaller for stronger evidence', () => {
    const weak = analyzeFeatures(
      [game({ winners: [0], states: [state(0, { a: true }), state(1, { a: false })] })],
      [feature('a')],
    );
    const manyStates = Array.from({ length: 40 }, (_, i) =>
      state(i % 2, { a: i % 2 === 0 }));
    const strong = analyzeFeatures(
      [game({ winners: [0], states: manyStates })],
      [feature('a')],
    );
    for (const stats of [weak, strong]) {
      expect(statOf(stats, 'a').pValue).toBeGreaterThanOrEqual(0);
      expect(statOf(stats, 'a').pValue).toBeLessThanOrEqual(1);
    }
    expect(statOf(strong, 'a').pValue).toBeLessThan(statOf(weak, 'a').pValue);
  });

  it('aggregates across several games', () => {
    const stats = analyzeFeatures(
      [
        game({ gameId: 'g1', winners: [0], states: [state(0, { a: true })] }),
        game({ gameId: 'g2', winners: [1], states: [state(1, { a: true })] }),
      ],
      [feature('a')],
    );
    expect(statOf(stats, 'a').trueAndWon).toBe(2);
  });
});

describe('analyzeActions', () => {
  it('returns nothing when no actions were seen', () => {
    expect(analyzeActions([])).toEqual([]);
  });

  it('credits the action a winner took', () => {
    const [stat] = analyzeActions([
      game({ winners: [0], states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack'] })] }),
    ]);
    expect(stat).toMatchObject({ actionName: 'attack', takenAndWon: 1, takenAndLost: 0 });
  });

  it('charges the action a loser took', () => {
    const [stat] = analyzeActions([
      game({ winners: [0], states: [state(1, {}, { actionTaken: 'attack', availableActions: ['attack'] })] }),
    ]);
    expect(stat).toMatchObject({ takenAndWon: 0, takenAndLost: 1 });
  });

  it('records an available-but-declined action on the not-taken side', () => {
    const stats = analyzeActions([
      game({
        winners: [0],
        states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack', 'defend'] })],
      }),
    ]);
    const defend = stats.find((s) => s.actionName === 'defend')!;
    expect(defend).toMatchObject({ takenAndWon: 0, notTakenAndWon: 1 });
  });

  it('never counts the taken action as also not taken', () => {
    const stats = analyzeActions([
      game({
        winners: [0],
        states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack', 'defend'] })],
      }),
    ]);
    const attack = stats.find((s) => s.actionName === 'attack')!;
    expect(attack.notTakenAndWon).toBe(0);
    expect(attack.notTakenAndLost).toBe(0);
  });

  it('splits a draw across both sides', () => {
    const [stat] = analyzeActions([
      game({ winners: [], states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack'] })] }),
    ]);
    expect(stat).toMatchObject({ takenAndWon: 0.5, takenAndLost: 0.5 });
  });

  it('computes the win rate taken vs not taken', () => {
    const stats = analyzeActions([
      game({
        winners: [0],
        states: [
          state(0, {}, { actionTaken: 'attack', availableActions: ['attack', 'defend'] }),
          state(1, {}, { actionTaken: 'defend', availableActions: ['attack', 'defend'] }),
        ],
      }),
    ]);
    const attack = stats.find((s) => s.actionName === 'attack')!;
    expect(attack.winRateWhenTaken).toBe(1);
    expect(attack.winRateWhenNotTaken).toBe(0);
  });

  it('falls back to a neutral 0.5 for a side that was never observed', () => {
    const [stat] = analyzeActions([
      game({ winners: [0], states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack'] })] }),
    ]);
    expect(stat.winRateWhenNotTaken).toBe(0.5);
  });

  it('ignores incomplete games', () => {
    expect(analyzeActions([
      game({ completed: false, states: [state(0, {}, { actionTaken: 'attack', availableActions: ['attack'] })] }),
    ])).toEqual([]);
  });

  it('ignores states where no action was recorded', () => {
    expect(analyzeActions([game({ states: [state(0, {}, { availableActions: [] })] })])).toEqual([]);
  });
});

describe('selectTopFeatures', () => {
  const stats = (correlations: number[]): FeatureStats[] =>
    correlations.map((correlation, i) => ({
      featureId: `f${i}`,
      trueAndWon: 0, trueAndLost: 0, falseAndWon: 0, falseAndLost: 0,
      winRateWhenTrue: 0.5, winRateWhenFalse: 0.5,
      correlation,
      pValue: 0,
    }));

  it('orders by strength of correlation, strongest first', () => {
    expect(selectTopFeatures(stats([0.1, 0.9, 0.5]), 3, 0).map((s) => s.featureId))
      .toEqual(['f1', 'f2', 'f0']);
  });

  it('ranks a strong negative correlation as highly as a strong positive one', () => {
    expect(selectTopFeatures(stats([0.4, -0.9]), 2, 0).map((s) => s.featureId))
      .toEqual(['f1', 'f0']);
  });

  it('drops features below the minimum correlation', () => {
    expect(selectTopFeatures(stats([0.05, 0.5]), 10, 0.1).map((s) => s.featureId))
      .toEqual(['f1']);
  });

  it('keeps a feature exactly at the minimum', () => {
    expect(selectTopFeatures(stats([0.1]), 10, 0.1)).toHaveLength(1);
  });

  it('caps the result at maxFeatures', () => {
    expect(selectTopFeatures(stats([0.9, 0.8, 0.7]), 2, 0)).toHaveLength(2);
  });

  it('returns nothing when nothing clears the bar', () => {
    expect(selectTopFeatures(stats([0.01, 0.02]), 10, 0.5)).toEqual([]);
  });

  it('returns nothing for maxFeatures 0', () => {
    expect(selectTopFeatures(stats([0.9]), 0, 0)).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(selectTopFeatures([], 5, 0)).toEqual([]);
  });
});

describe('correlationToWeight', () => {
  it('scales the correlation by the default factor of 10', () => {
    expect(correlationToWeight(0.5)).toBe(5);
    expect(correlationToWeight(-0.3)).toBeCloseTo(-3, 10);
  });

  it('honours an explicit scale', () => {
    expect(correlationToWeight(0.5, 4)).toBe(2);
  });

  it('keeps the sign of the correlation', () => {
    expect(correlationToWeight(0.2)).toBeGreaterThan(0);
    expect(correlationToWeight(-0.2)).toBeLessThan(0);
  });

  it('maps no correlation to no weight', () => {
    expect(correlationToWeight(0)).toBe(0);
  });

  it('clamps the weight to ±20 so one feature cannot dominate', () => {
    expect(correlationToWeight(1, 100)).toBe(20);
    expect(correlationToWeight(-1, 100)).toBe(-20);
  });

  it('is monotonic in the correlation', () => {
    const weights = [-1, -0.5, 0, 0.5, 1].map((c) => correlationToWeight(c));
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });
});

describe('printAnalysisSummary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const featureStats = (n: number): FeatureStats[] =>
    Array.from({ length: n }, (_, i) => ({
      featureId: `f${i}`,
      trueAndWon: 1, trueAndLost: 0, falseAndWon: 0, falseAndLost: 1,
      winRateWhenTrue: 1, winRateWhenFalse: 0,
      correlation: (i + 1) / (n + 1),
      pValue: 0.01,
    }));

  const actionStats = (n: number): ActionStats[] =>
    Array.from({ length: n }, (_, i) => ({
      actionName: `a${i}`,
      takenAndWon: 1, takenAndLost: 0, notTakenAndWon: 0, notTakenAndLost: 1,
      winRateWhenTaken: (i + 1) / (n + 1),
      winRateWhenNotTaken: 0.5,
    }));

  const capture = (features: FeatureStats[], actions: ActionStats[]): string => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printAnalysisSummary(features, actions);
    return log.mock.calls.map((call) => call.join(' ')).join('\n');
  };

  it('prints both a feature and an action section', () => {
    const output = capture(featureStats(2), actionStats(2));
    expect(output).toContain('Feature Analysis');
    expect(output).toContain('Action Analysis');
  });

  it('lists at most the top 10 features, strongest first', () => {
    const output = capture(featureStats(12), []);
    expect(output).toContain('f11');
    expect(output).not.toContain('f0:');
    expect(output.indexOf('f11')).toBeLessThan(output.indexOf('f10'));
  });

  it('lists at most the top 5 actions', () => {
    const output = capture([], actionStats(8));
    expect(output).toContain('a7');
    expect(output).not.toContain('a0:');
  });

  it('signs a positive correlation explicitly', () => {
    expect(capture(featureStats(1), [])).toMatch(/\+0\.500/);
  });

  it('does not mutate the arrays it was given', () => {
    const features = featureStats(3);
    const order = features.map((f) => f.featureId);
    capture(features, []);
    expect(features.map((f) => f.featureId)).toEqual(order);
  });

  it('handles empty inputs without throwing', () => {
    expect(() => capture([], [])).not.toThrow();
  });
});
