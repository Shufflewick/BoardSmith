/**
 * Author metrics (#556): what a game measures for the balance simulator.
 *
 * A game declares its metrics once and wires them as `gameDefinition.metrics`:
 *
 * ```typescript
 * export const metrics = defineMetrics(({ count, ratio, category, sample, segment, finalScore }) => ({
 *   held: count({ by: 'element' }),
 *   built: count({ by: 'element' }),
 *   buildRate: ratio('built', 'held'),
 *   draftChoice: category(['neither', 'one', 'both']),
 *   buildsPerRound: sample(),
 *   startingTool: segment((game: MyGame, player) => player.tool.name),
 *   score: finalScore((game: MyGame, player) => player.score),
 * }));
 * ```
 *
 * and records from game code that builds or changes the game (its
 * constructor, an action's `execute`, a pick's `onSelect` or `onEach`, a flow
 * step): `metrics.built.add(game, card)`,
 * `metrics.draftChoice.record(game, 'both')`, `metrics.buildsPerRound.add(game, 2)`.
 *
 * Recording does nothing in real play. Only the simulator attaches a sink, to
 * the one game it is playing (through `GameOptions.metricSink`, so the
 * constructor's records count too), and keeps an action's records only when
 * the action commits. In a simulation a record made anywhere else (a `choices`
 * callback, a condition, a policy) is refused. `sample({ atEnd })`, `segment`
 * and `finalScore` are not recorded: the simulator reads them once per player
 * when the game ends.
 *
 * @module
 */
import type { Game, PlayerOf } from './element/game.js';
import type { GameElement } from './element/game-element.js';

/** One kept record: the metric's name, its key (an element's name, a category, or '') and a number. */
export interface MetricRecord {
  metric: string;
  key: string;
  value: number;
}

/**
 * Where a simulated game's records go. Internal: only the simulator makes one,
 * and puts it on its own game's context.
 */
export interface MetricSink {
  /** The game definition's metrics; a record of any other metric is refused. */
  readonly declared: GameMetrics;
  /** Records of the step under way, kept by the simulator when it commits. */
  pending: MetricRecord[];
  /** The first refused record, which ends the game even if game code caught the throw. */
  refused?: Error;
}

/** A count: `add` adds `amount` (default 1), keyed by an element's name or a category when declared `by` one. */
export interface CountMetric {
  readonly kind: 'count';
  readonly name: string;
  readonly by?: undefined;
  add(game: Game, amount?: number): void;
}
export interface ElementCountMetric {
  readonly kind: 'count';
  readonly name: string;
  readonly by: 'element';
  add(game: Game, element: GameElement, amount?: number): void;
}
export interface CategoryCountMetric {
  readonly kind: 'count';
  readonly name: string;
  readonly by: 'category';
  add(game: Game, category: string, amount?: number): void;
}
/** The pooled ratio of two counts of the same metrics, keyed alike. */
export interface RatioMetric {
  readonly kind: 'ratio';
  readonly name: string;
  readonly numerator: string;
  readonly denominator: string;
}
/** A distribution of numbers the game adds. */
export interface SampleMetric {
  readonly kind: 'sample';
  readonly name: string;
  add(game: Game, value: number): void;
}
/** A distribution of one number per player, read when the game ends. */
export interface EndSampleMetric<G extends Game = Game> {
  readonly kind: 'sample';
  readonly name: string;
  readonly atEnd: (game: G, player: PlayerOf<G>) => number;
}
/** How often each of a fixed set of values is recorded. */
export interface CategoryMetric<V extends string = string> {
  readonly kind: 'category';
  readonly name: string;
  readonly values: readonly V[];
  record(game: Game, value: V): void;
}
/** A label per player, read when the game ends; the report gives the win share of each label. */
export interface SegmentMetric<G extends Game = Game> {
  readonly kind: 'segment';
  readonly name: string;
  readonly read: (game: G, player: PlayerOf<G>) => string;
}
/** A score per player, read when the game ends. */
export interface FinalScoreMetric<G extends Game = Game> {
  readonly kind: 'finalScore';
  readonly name: string;
  readonly read: (game: G, player: PlayerOf<G>) => number;
}

export type Metric =
  | CountMetric
  | ElementCountMetric
  | CategoryCountMetric
  | RatioMetric
  | SampleMetric
  | EndSampleMetric<any>
  | CategoryMetric
  | SegmentMetric<any>
  | FinalScoreMetric<any>;

/** What `gameDefinition.metrics` holds: the object {@link defineMetrics} returns. */
export type GameMetrics = Readonly<Record<string, Metric>>;

/** The metric kinds {@link defineMetrics} hands its callback. */
export interface MetricKinds {
  count(): CountMetric;
  count(options: { by: 'element' }): ElementCountMetric;
  count(options: { by: 'category' }): CategoryCountMetric;
  /** Keys of two counts in the same `defineMetrics`, declared with the same `by`. */
  ratio(numerator: string, denominator: string): RatioMetric;
  sample(): SampleMetric;
  sample<G extends Game>(options: { atEnd: (game: G, player: PlayerOf<G>) => number }): EndSampleMetric<G>;
  category<const V extends string>(values: readonly V[]): CategoryMetric<V>;
  segment<G extends Game>(read: (game: G, player: PlayerOf<G>) => string): SegmentMetric<G>;
  finalScore<G extends Game>(read: (game: G, player: PlayerOf<G>) => number): FinalScoreMetric<G>;
}

/** Why the simulator refuses this record, or undefined when it keeps it. */
function refusalOf(game: Game, sink: MetricSink, metric: Metric, value: number, problem?: string): string | undefined {
  if (sink.declared[metric.name] !== metric) {
    return 'it is not in gameDefinition.metrics. Declare it in the defineMetrics that gameDefinition.metrics holds.';
  }
  if (game._ctx._setupComplete === true && game._ctx._changingDepth === 0) {
    return 'it was recorded outside game code that changes the game. Record in the game\'s constructor, an ' +
      'action\'s execute, a pick\'s onSelect or onEach, or a flow step; never in choices, a condition, a ' +
      'filter or a policy.';
  }
  return problem ?? (Number.isFinite(value) ? undefined : `it was given ${value}, which is not a finite number.`);
}

/** Hand a record to the game's sink, or refuse it; without a sink (real play) do nothing. */
function record(game: Game, metric: Metric, key: string, value: number, problem?: string): void {
  const sink = game._ctx._metricSink;
  if (sink === undefined) return;
  const refusal = refusalOf(game, sink, metric, value, problem);
  if (refusal !== undefined) {
    const error = new Error(`Metric '${metric.name || '(not named by defineMetrics)'}' was refused: ${refusal}`);
    sink.refused ??= error;
    throw error;
  }
  sink.pending.push({ metric: metric.name, key, value });
}

function count(options?: { by: 'element' | 'category' }): CountMetric | ElementCountMetric | CategoryCountMetric {
  const by = options?.by;
  const metric = {
    kind: 'count' as const,
    name: '',
    by,
    add(game: Game, keyOrAmount?: GameElement | string | number, amount = 1) {
      if (by === undefined) return record(game, metric as Metric, '', (keyOrAmount as number | undefined) ?? 1);
      const key = by === 'element' ? (keyOrAmount as GameElement | undefined)?.name : keyOrAmount;
      const problem = typeof key === 'string' && key !== ''
        ? undefined
        : `it is counted by ${by}, so name ${by === 'element' ? 'an element that has a name' : 'a category'}.`;
      record(game, metric as Metric, String(key), amount, problem);
    },
  };
  return metric as CountMetric | ElementCountMetric | CategoryCountMetric;
}

const kinds: MetricKinds = {
  count: count as MetricKinds['count'],
  ratio: (numerator, denominator) => ({ kind: 'ratio', name: '', numerator, denominator }),
  sample: ((options?: { atEnd: EndSampleMetric['atEnd'] }) => {
    if (options) return { kind: 'sample', name: '', atEnd: options.atEnd };
    const metric: SampleMetric = { kind: 'sample', name: '', add: (game, value) => record(game, metric, '', value) };
    return metric;
  }) as MetricKinds['sample'],
  category: (values) => {
    const metric: CategoryMetric<(typeof values)[number]> = {
      kind: 'category',
      name: '',
      values,
      record: (game, value) =>
        record(game, metric as Metric, value, 1,
          values.includes(value) ? undefined : `'${value}' is not one of its values (${values.join(', ')}).`),
    };
    return metric;
  },
  segment: (read) => ({ kind: 'segment', name: '', read }),
  finalScore: (read) => ({ kind: 'finalScore', name: '', read }),
};

/**
 * Declare a game's metrics. Each metric is named by its key; a ratio must name
 * two counts declared here with the same `by`. Throws on a ratio that does not,
 * and on one metric object listed under two keys.
 */
export function defineMetrics<T extends Record<string, Metric>>(define: (metricKinds: MetricKinds) => T): T {
  const metrics = define(kinds);
  for (const [name, metric] of Object.entries(metrics)) {
    if (metric.name !== '') throw new Error(`Metric '${name}' is the metric already named '${metric.name}'. Declare each metric once.`);
    (metric as { name: string }).name = name;
  }
  for (const metric of Object.values(metrics)) if (metric.kind === 'ratio') checkRatio(metrics, metric);
  return Object.freeze(metrics);
}

/** Refuse a ratio that does not name two counts of `metrics` declared with the same `by`. */
function checkRatio(metrics: Record<string, Metric>, ratio: RatioMetric): void {
  const [top, bottom] = [metrics[ratio.numerator], metrics[ratio.denominator]];
  if (top?.kind === 'count' && bottom?.kind === 'count' && top.by === bottom.by) return;
  throw new Error(
    `Ratio '${ratio.name}' needs two counts declared with the same 'by', got '${ratio.numerator}' and ` +
      `'${ratio.denominator}'. Name two count metrics of this defineMetrics.`,
  );
}

type EndRead = (game: Game, player: PlayerOf<Game>) => MetricRecord;

/** How a metric read when the game ends makes one player's record; undefined for a metric that is recorded. */
function endRead(metric: Metric): EndRead | undefined {
  const finite = (value: number, seat: number) => {
    if (Number.isFinite(value)) return value;
    throw new Error(`Metric '${metric.name}' gave ${value} for seat ${seat}. Return a finite number.`);
  };
  if (metric.kind === 'segment') {
    return (game, player) => {
      const label = metric.read(game, player);
      if (typeof label === 'string' && label !== '') return { metric: metric.name, key: label, value: player.seat };
      throw new Error(`Segment '${metric.name}' gave ${JSON.stringify(label)} for seat ${player.seat}. Return a non-empty label.`);
    };
  }
  if (metric.kind === 'finalScore') {
    return (game, player) => ({ metric: metric.name, key: String(player.seat), value: finite(metric.read(game, player), player.seat) });
  }
  if (metric.kind === 'sample' && 'atEnd' in metric) {
    return (game, player) => ({ metric: metric.name, key: '', value: finite(metric.atEnd(game, player), player.seat) });
  }
  return undefined;
}

/**
 * The records a finished game gives: each `sample({ atEnd })` value, `segment`
 * label (keyed by the label, valued by the seat) and `finalScore` (keyed by the
 * seat), once per player in seat order. Throws, naming the metric, on a label
 * that is not a non-empty string or a number that is not finite.
 */
export function endOfGameRecords(metrics: GameMetrics, game: Game): MetricRecord[] {
  const reads = Object.values(metrics).map(endRead).filter((read) => read !== undefined);
  return reads.flatMap((read) => game.players.map((player) => read(game, player)));
}
