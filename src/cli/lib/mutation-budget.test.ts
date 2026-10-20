import { describe, expect, it } from 'vitest';
import { mutationBudget, mutationBlockProblems } from './mutation-budget.js';

describe('the "mutation" block of boardsmith.json (#955)', () => {
  it('is optional: with none, mutants run one at a time with no worker limit', () => {
    expect(mutationBlockProblems(undefined)).toEqual([]);
    expect(mutationBudget({})).toBeUndefined();
  });

  it('reads how many trials run at once and the total test workers they share', () => {
    expect(mutationBudget({ mutation: { trials: 3, workers: 8 } })).toEqual({ trials: 3, workers: 8 });
  });

  it('refuses a budget too small to give every trial a worker', () => {
    expect(mutationBlockProblems({ trials: 4, workers: 2 })).toEqual([
      '"mutation.workers" (2) must be at least "mutation.trials" (4), so every trial running at once has a test worker. Raise workers or lower trials.',
    ]);
  });

  it('refuses a missing, fractional or unknown setting, naming what to write', () => {
    expect(mutationBlockProblems({ trials: 2 })).toEqual(['"mutation.workers" must be a whole number of at least 1, e.g. { "trials": 2, "workers": 8 }. Got undefined.']);
    expect(mutationBlockProblems({ trials: 1.5, workers: 4 })).toEqual(['"mutation.trials" must be a whole number of at least 1, e.g. { "trials": 2, "workers": 8 }. Got 1.5.']);
    expect(mutationBlockProblems({ trials: 2, workers: 4, pool: 'forks' })).toEqual(['Unknown key "pool" in "mutation". It takes only "trials" and "workers".']);
    expect(mutationBlockProblems(4)).toEqual(['"mutation" must be an object, e.g. { "trials": 2, "workers": 8 }. Got 4.']);
    expect(() => mutationBudget({ mutation: { trials: 0, workers: 4 } })).toThrow(/^boardsmith\.json has a problem in "mutation": "mutation\.trials" must be a whole number/);
  });
});
