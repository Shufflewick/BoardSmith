import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Action, eachPlayer, actionStep, defineMetrics, type GameOptions } from './index.js';

const metrics = defineMetrics(({ count, ratio, category, sample }) => ({
  takes: count(),
  held: count({ by: 'element' }),
  built: count({ by: 'element' }),
  buildRate: ratio('built', 'held'),
  size: category(['small', 'big']),
  amount: sample(),
}));

class Gem extends Piece<QuietGame, Player> {}

class QuietGame extends Game<QuietGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Gem]);
    this.create(Gem, 'ruby');
    this.registerAction(Action.create<QuietGame>('pass').execute(() => {}));
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) });
  }
}

describe('defineMetrics (#556)', () => {
  it('names each metric by its key', () => {
    expect(Object.entries(metrics).map(([key, metric]) => [key, metric.name, metric.kind])).toEqual([
      ['takes', 'takes', 'count'],
      ['held', 'held', 'count'],
      ['built', 'built', 'count'],
      ['buildRate', 'buildRate', 'ratio'],
      ['size', 'size', 'category'],
      ['amount', 'amount', 'sample'],
    ]);
  });

  it('refuses a ratio that does not name two counts declared with the same by', () => {
    expect(() => defineMetrics(({ count, ratio }) => ({ held: count({ by: 'element' }), rate: ratio('built', 'held') })))
      .toThrow(/Ratio 'rate' needs two counts.*'built' and 'held'/);
    expect(() => defineMetrics(({ count, ratio }) => ({ a: count(), b: count({ by: 'category' }), rate: ratio('a', 'b') })))
      .toThrow(/Ratio 'rate'/);
  });

  it('refuses one metric listed under two keys', () => {
    expect(() => defineMetrics(({ count }) => {
      const shared = count();
      return { first: shared, second: shared };
    })).toThrow(/Metric 'second' is the metric already named 'first'/);
  });

  it('recording in real play (no simulator) does nothing: the state and its snapshot are unchanged', () => {
    const recorded = new QuietGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'quiet' });
    recorded.startFlow();
    const before = { json: JSON.stringify(recorded.toJSON()), version: recorded._ctx._stateVersion };
    metrics.takes.add(recorded);
    metrics.held.add(recorded, recorded.first(Gem)!);
    metrics.built.add(recorded, recorded.first(Gem)!, 2);
    metrics.size.record(recorded, 'small');
    metrics.amount.add(recorded, 3);
    expect({ json: JSON.stringify(recorded.toJSON()), version: recorded._ctx._stateVersion }).toEqual(before);
    expect(recorded._ctx._metricSink).toBeUndefined();
  });
});
