/**
 * The balance report (#556): one entry per player count, built from that
 * count's finished games in game-index order, so the same games always give
 * the same report. `boardsmith simulate` prints it as tables, as JSON, or as
 * long CSV rows.
 *
 * @module
 */
import type { GameMetrics, Metric } from '../engine/metrics.js';
import type { SingleGameResult } from './play-game.js';

/** A distribution: its size, mean with a 95% interval, standard deviation, percentiles and range. */
export interface Summary {
  n: number;
  mean: number;
  low: number;
  high: number;
  sd: number;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

/** A share with its 95% (Wilson) interval. */
export interface Share {
  share: number;
  low: number;
  high: number;
}

/**
 * The statistics of one player count. A statistic with nothing to divide by
 * (a ratio whose denominator totals 0, a sample with no values) is Infinity or
 * NaN, which JSON writes as null.
 */
export interface PlayerCountReport {
  players: number;
  games: number;
  /** Seat -> share of games that seat won alone. */
  winShare: Record<number, Share>;
  /** Share of games won by no seat or shared by several. */
  tieRate: Share;
  /** Game length in actions. */
  length: Summary;
  /** Segment -> label -> how many player-games had the label, and the share of those won alone. */
  segments: Record<string, Record<string, Share & { players: number }>>;
  /** Final score -> its distribution over every player of every game, and the mean spread within a game. */
  scores: Record<string, Summary & { spread: number }>;
  /** Count (not by element) -> key ('' when not keyed) -> its total per game. */
  counts: Record<string, Record<string, Summary>>;
  /** Sample -> every value recorded. */
  samples: Record<string, Summary>;
  /** Category -> value -> its share of the records. */
  categories: Record<string, Record<string, Share>>;
  /** Ratio (not by element) -> key ('' when not keyed) -> numerator total over denominator total. */
  ratios: Record<string, Record<string, number>>;
  /** Element name -> each element-keyed count (per game) and ratio (pooled). */
  elements: Record<string, Record<string, number>>;
}

const Z = 1.96;

function summarize(values: number[]): Summary {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const half = (Z * sd) / Math.sqrt(n);
  const at = (q: number) => {
    const i = q * (n - 1);
    const below = sorted[Math.floor(i)] ?? NaN;
    return below + (i - Math.floor(i)) * ((sorted[Math.ceil(i)] ?? NaN) - below);
  };
  return {
    n, mean, low: mean - half, high: mean + half, sd,
    p10: at(0.1), p50: at(0.5), p90: at(0.9), min: sorted[0] ?? NaN, max: sorted[n - 1] ?? NaN,
  };
}

function share(k: number, n: number): Share {
  const p = k / n;
  const z2 = Z * Z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const totalsOf = (game: SingleGameResult, metric: string): Record<string, number> => game.metrics.totals[metric] ?? {};

const sortedKeys = (tables: Array<Record<string, number>>) => [...new Set(tables.flatMap((t) => Object.keys(t)))].sort();

/** What every section of one player count's report is built from, and the report it fills. */
interface Tally {
  metrics: Metric[];
  games: SingleGameResult[];
  report: PlayerCountReport;
  /** The per-element table's columns, in declaration order. */
  elementColumns: Array<[string, (element: string) => number]>;
}

const soleWinner = (g: SingleGameResult) => (g.winners?.length === 1 ? g.winners[0] : undefined);
/** Key -> the metric's total over every game. */
function pooled(tally: Tally, name: string): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const game of tally.games) {
    for (const [key, value] of Object.entries(totalsOf(game, name))) sums[key] = (sums[key] ?? 0) + value;
  }
  return sums;
}
const countedByElement = (metric: Metric | undefined) => metric?.kind === 'count' && metric.by === 'element';

/** How each kind of metric adds its section to the report. */
const SECTIONS: { [K in Metric['kind']]: (metric: Extract<Metric, { kind: K }>, tally: Tally) => void } = {
  count: (metric, tally) => {
    if (countedByElement(metric)) {
      const sums = pooled(tally, metric.name);
      tally.elementColumns.push([metric.name, (key) => (sums[key] ?? 0) / tally.games.length]);
      return;
    }
    const perGame = tally.games.map((g) => totalsOf(g, metric.name));
    // An unkeyed count is always reported, as 0 per game when nothing recorded it.
    const keys = metric.by === undefined ? [''] : sortedKeys(perGame);
    tally.report.counts[metric.name] = Object.fromEntries(
      keys.map((key) => [key, summarize(perGame.map((g) => g[key] ?? 0))]),
    );
  },
  ratio: (metric, tally) => {
    const [top, bottom] = [pooled(tally, metric.numerator), pooled(tally, metric.denominator)];
    const ratio = (key: string) => (top[key] ?? 0) / (bottom[key] ?? 0);
    const numerator = tally.metrics.find((m) => m.name === metric.numerator);
    if (countedByElement(numerator)) {
      tally.elementColumns.push([metric.name, ratio]);
      return;
    }
    const keys = numerator?.kind === 'count' && numerator.by === undefined ? [''] : sortedKeys([top, bottom]);
    tally.report.ratios[metric.name] = Object.fromEntries(keys.map((key) => [key, ratio(key)]));
  },
  sample: (metric, tally) => {
    tally.report.samples[metric.name] = summarize(tally.games.flatMap((g) => g.metrics.values[metric.name] ?? []));
  },
  category: (metric, tally) => {
    const counted = pooled(tally, metric.name);
    const total = Object.values(counted).reduce((sum, v) => sum + v, 0);
    tally.report.categories[metric.name] = Object.fromEntries(metric.values.map((v) => [v, share(counted[v] ?? 0, total)]));
  },
  segment: (metric, tally) => {
    const labels = new Map<string, { players: number; wins: number }>();
    for (const game of tally.games) {
      for (const [i, key] of (game.metrics.labels[metric.name] ?? []).entries()) {
        const label = labels.get(key) ?? { players: 0, wins: 0 };
        labels.set(key, { players: label.players + 1, wins: label.wins + (soleWinner(game) === i + 1 ? 1 : 0) });
      }
    }
    tally.report.segments[metric.name] = Object.fromEntries(
      [...labels.keys()].sort().map((key) => {
        const { players, wins } = labels.get(key)!;
        return [key, { players, ...share(wins, players) }];
      }),
    );
  },
  finalScore: (metric, tally) => {
    const scores = tally.games.map((g) => g.metrics.values[metric.name] ?? []);
    const spread = scores.reduce((sum, s) => sum + Math.max(...s) - Math.min(...s), 0) / tally.games.length;
    tally.report.scores[metric.name] = { ...summarize(scores.flat()), spread };
  },
};

function playerCountReport(metrics: Metric[], players: number, games: SingleGameResult[]): PlayerCountReport {
  const n = games.length;
  const report: PlayerCountReport = {
    players,
    games: n,
    winShare: Object.fromEntries(
      Array.from({ length: players }, (_, i) => [i + 1, share(games.filter((g) => soleWinner(g) === i + 1).length, n)]),
    ),
    tieRate: share(games.filter((g) => soleWinner(g) === undefined).length, n),
    length: summarize(games.map((g) => g.actionCount)),
    segments: {}, scores: {}, counts: {}, samples: {}, categories: {}, ratios: {}, elements: {},
  };
  const tally: Tally = { metrics, games, report, elementColumns: [] };
  for (const metric of metrics) (SECTIONS[metric.kind] as (m: Metric, t: Tally) => void)(metric, tally);

  const elementNames = sortedKeys(metrics.filter(countedByElement).map((m) => pooled(tally, m.name)));
  for (const element of elementNames) {
    report.elements[element] = Object.fromEntries(tally.elementColumns.map(([column, value]) => [column, value(element)]));
  }
  return report;
}

/**
 * The report of each player count in `games`, in the order the counts first
 * appear. Every game must have finished.
 */
export function buildReport(metrics: GameMetrics | undefined, games: SingleGameResult[]): PlayerCountReport[] {
  const counts = [...new Set(games.map((g) => g.playerCount))];
  const declared = Object.values(metrics ?? {});
  return counts.map((players) => playerCountReport(declared, players, games.filter((g) => g.playerCount === players)));
}

/** One cell of the report: a section, the metric it belongs to ('' for built-ins), a key and a statistic. */
interface ReportRow {
  players: number;
  section: string;
  metric: string;
  key: string;
  stat: string;
  value: number;
}

/** The report as long rows, section by section. An element row's `stat` is the column's metric. */
function reportRows(report: PlayerCountReport): ReportRow[] {
  const rows: ReportRow[] = [];
  const add = (section: string, metric: string, key: string, stats: object) => {
    for (const [stat, value] of Object.entries(stats)) rows.push({ players: report.players, section, metric, key, stat, value });
  };
  const each = <T>(table: Record<string, T>, row: (name: string, value: T) => void) => {
    for (const [name, value] of Object.entries(table)) row(name, value);
  };
  add('games', '', '', { count: report.games });
  each(report.winShare, (seat, s) => add('winShare', '', seat, s));
  add('ties', '', '', report.tieRate);
  add('length', '', '', report.length);
  each(report.segments, (metric, labels) => each(labels, (label, s) => add('segment', metric, label, s)));
  each(report.scores, (metric, s) => add('score', metric, '', s));
  each(report.counts, (metric, keys) => each(keys, (key, s) => add('count', metric, key, s)));
  each(report.samples, (metric, s) => add('sample', metric, '', s));
  each(report.categories, (metric, values) => each(values, (value, s) => add('category', metric, value, s)));
  each(report.ratios, (metric, keys) => each(keys, (key, ratio) => add('ratio', metric, key, { ratio })));
  each(report.elements, (element, columns) => add('element', '', element, columns));
  return rows;
}

const csvField = (field: string) => (/[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field);

/** One variant's report, under the label a comparison gives it ('' when the run compares nothing). */
export interface VariantReport {
  variant: string;
  report: PlayerCountReport[];
}

/**
 * The reports as CSV, one statistic per row:
 * `variant,players,section,metric,key,stat,value`. `variant` is the variant's
 * label, empty when the run compares nothing; a value with nothing to divide
 * by is empty.
 */
export function reportCsv(variants: VariantReport[]): string {
  const lines = ['variant,players,section,metric,key,stat,value'];
  for (const { variant, report } of variants) {
    for (const row of report.flatMap(reportRows)) {
      const value = Number.isFinite(row.value) ? String(row.value) : '';
      lines.push([variant, String(row.players), row.section, row.metric, row.key, row.stat, value].map(csvField).join(','));
    }
  }
  return lines.join('\n');
}

/** Each section's table title, and the name of its key column. */
const HEADINGS: Record<string, (metric: string) => { title: string; keyName: string }> = {
  winShare: () => ({ title: 'Win share by seat', keyName: 'seat' }),
  ties: () => ({ title: 'Ties', keyName: '' }),
  length: () => ({ title: 'Game length (actions)', keyName: '' }),
  segment: (metric) => ({ title: `Win share by ${metric}`, keyName: metric }),
  score: (metric) => ({ title: `Score: ${metric}`, keyName: '' }),
  count: (metric) => ({ title: `Count per game: ${metric}`, keyName: 'key' }),
  sample: (metric) => ({ title: `Sample: ${metric}`, keyName: '' }),
  category: (metric) => ({ title: `Category: ${metric}`, keyName: 'value' }),
  ratio: (metric) => ({ title: `Ratio: ${metric}`, keyName: 'key' }),
  element: () => ({ title: 'Per element', keyName: 'element' }),
};

const SHARE_SECTIONS = new Set(['winShare', 'ties', 'segment', 'category']);

const isShare = (row: ReportRow) => SHARE_SECTIONS.has(row.section) && row.stat !== 'players';

function formatValue(row: ReportRow): string {
  if (!Number.isFinite(row.value)) return '-';
  if (isShare(row)) return `${(row.value * 100).toFixed(1)}%`;
  return String(Number(row.value.toFixed(3)));
}

/** `row`'s value with its difference from `base`'s; a share's difference is in percentage points. */
function formatWithDifference(row: ReportRow, base: ReportRow | undefined): string {
  const diff = base === undefined ? NaN : row.value - base.value;
  if (!Number.isFinite(diff)) return formatValue(row);
  const sign = diff > 0 ? '+' : '';
  const shown = isShare(row) ? `${sign}${(diff * 100).toFixed(1)} pts` : `${sign}${Number(diff.toFixed(3))}`;
  return `${formatValue(row)} (${shown})`;
}

/** Pad each column to its widest cell, two spaces between columns. */
function alignColumns(table: string[][]): string[] {
  const widths = table[0].map((_, i) => Math.max(...table.map((line) => line[i].length)));
  return table.map((line) => `  ${line.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()}`);
}

/** One table: a key column (left out when every key is empty) and a column per statistic. */
function formatTable(rows: ReportRow[]): string[] {
  const { title, keyName } = HEADINGS[rows[0].section](rows[0].metric);
  const stats = [...new Set(rows.map((r) => r.stat))];
  const keys = [...new Set(rows.map((r) => r.key))];
  const withKey = keys.some((key) => key !== '');
  const table = [[...(withKey ? [keyName] : []), ...stats]];
  for (const key of keys) {
    const cells = stats.map((stat) => rows.find((r) => r.key === key && r.stat === stat));
    table.push([...(withKey ? [key] : []), ...cells.map((cell) => (cell ? formatValue(cell) : ''))]);
  }
  return [title, ...alignColumns(table)];
}

/** `rows` grouped by section and metric, in order. The game count is the heading, not a table. */
function tablesOf(rows: ReportRow[]): ReportRow[][] {
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows.filter((r) => r.section !== 'games')) {
    const group = `${row.section}\n${row.metric}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(row);
  }
  return [...groups.values()];
}

/** The report as text: per player count, a table per section and metric. */
export function formatReport(reports: PlayerCountReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`${report.players} players: ${report.games} games`);
    for (const rows of tablesOf(reportRows(report))) lines.push(...formatTable(rows), '');
  }
  return lines.join('\n');
}

/**
 * Variants side by side, as text: per player count, a table per section and
 * metric with a row per key and statistic and a column per variant, numbered
 * in order. Each variant after the first shows its difference from the first.
 * Every variant must have reported the same player counts.
 */
export function formatComparison(variants: VariantReport[]): string {
  const lines: string[] = [];
  variants[0].report.forEach((first, i) => {
    lines.push(`${first.players} players: ${first.games} games per variant`);
    const byVariant = variants.map(({ report }) => reportRows(report[i]));
    const rowId = (row: ReportRow) => `${row.section}\n${row.metric}\n${row.key}\n${row.stat}`;
    const cells = byVariant.map((rows) => new Map(rows.map((row) => [rowId(row), row])));
    // Every row any variant has, in the order the variants first give it.
    const union = [...new Map(byVariant.flat().map((row) => [rowId(row), row])).values()];
    for (const rows of tablesOf(union)) {
      const { title, keyName } = HEADINGS[rows[0].section](rows[0].metric);
      const withKey = rows.some((row) => row.key !== '');
      const table = [[...(withKey ? [keyName] : []), '', ...variants.map((_, v) => String(v + 1))]];
      for (const row of rows) {
        const base = cells[0].get(rowId(row));
        const values = cells.map((variant, v) => {
          const cell = variant.get(rowId(row));
          if (cell === undefined) return '';
          return v === 0 ? formatValue(cell) : formatWithDifference(cell, base);
        });
        table.push([...(withKey ? [row.key] : []), row.stat, ...values]);
      }
      lines.push(title, ...alignColumns(table), '');
    }
  });
  return lines.join('\n');
}
