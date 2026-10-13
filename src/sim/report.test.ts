import { describe, it, expect } from 'vitest';
import { defineMetrics } from '../engine/index.js';
import type { MetricRecord } from '../engine/metrics.js';
import type { SingleGameResult } from './play-game.js';
import { buildReport, reportCsv, formatReport } from './report.js';

const metrics = defineMetrics(({ count, ratio, sample, category, segment, finalScore }) => ({
  held: count({ by: 'element' }),
  built: count({ by: 'element' }),
  buildRate: ratio('built', 'held'),
  shortOf: count({ by: 'category' }),
  deadTurns: count(),
  deadRate: ratio('deadTurns', 'deadTurns'),
  choice: category(['neither', 'one', 'both']),
  builds: sample(),
  tool: segment(() => 'unused'),
  score: finalScore(() => 0),
}));

const r = (metric: string, key: string, value = 1): MetricRecord => ({ metric, key, value });

function finished(actionCount: number, winners: number[], records: MetricRecord[]): SingleGameResult {
  return {
    completed: true, crashed: false, timedOut: false, exceededMaxActions: false, stuck: false, resting: false,
    actionCount, duration: 0, playerCount: 2, seed: 's', winners, metrics: records,
  };
}

const games = [
  finished(10, [1], [
    r('held', 'ruby', 2), r('held', 'opal'), r('built', 'ruby'), r('shortOf', 'wood'), r('deadTurns', ''), r('deadTurns', ''),
    r('choice', 'both'), r('choice', 'one'), r('builds', '', 1), r('builds', '', 3),
    r('tool', 'hammer', 1), r('tool', 'saw', 2), r('score', '1', 10), r('score', '2', 6),
  ]),
  finished(20, [1, 2], [
    r('held', 'ruby', 2), r('built', 'ruby'), r('built', 'opal'), r('choice', 'neither'), r('builds', '', 2),
    r('tool', 'saw', 1), r('tool', 'hammer', 2), r('score', '1', 8), r('score', '2', 8),
  ]),
];

/** The 95% Wilson interval of 1 in 2. */
const ONE_IN_TWO = { share: 0.5, low: 0.0945, high: 0.9055 };

describe('the balance report (#556)', () => {
  const [report] = buildReport(metrics, games);

  it('gives win share by seat and the tie rate with a 95% interval, and the game length', () => {
    expect(report.players).toBe(2);
    expect(report.games).toBe(2);
    for (const [key, value] of Object.entries(ONE_IN_TWO)) {
      expect(report.winShare[1][key as keyof typeof ONE_IN_TWO]).toBeCloseTo(value, 3);
      expect(report.tieRate[key as keyof typeof ONE_IN_TWO]).toBeCloseTo(value, 3);
    }
    expect(report.winShare[2].share).toBe(0);
    expect(report.length).toMatchObject({ n: 2, mean: 15, min: 10, max: 20, p50: 15 });
    expect(report.length.sd).toBeCloseTo(7.071, 3);
    expect(report.length.low).toBeCloseTo(5.2, 3);
    expect(report.length.high).toBeCloseTo(24.8, 3);
  });

  it('gives the win share of each segment label among the players who had it', () => {
    expect(Object.keys(report.segments.tool)).toEqual(['hammer', 'saw']);
    expect(report.segments.tool.hammer).toMatchObject({ players: 2, share: 0.5 });
    expect(report.segments.tool.saw).toMatchObject({ players: 2, share: 0 });
  });

  it('gives the score mean, spread, percentiles and mean spread within a game', () => {
    expect(report.scores.score).toMatchObject({ n: 4, mean: 8, p50: 8, min: 6, max: 10, spread: 2 });
    expect(report.scores.score.sd).toBeCloseTo(1.633, 3);
  });

  it('gives counts per game, samples, category shares and pooled ratios', () => {
    expect(report.counts.shortOf.wood).toMatchObject({ n: 2, mean: 0.5 });
    expect(report.counts.deadTurns['']).toMatchObject({ n: 2, mean: 1, min: 0, max: 2 });
    expect(report.samples.builds).toMatchObject({ n: 3, mean: 2, sd: 1, p50: 2 });
    expect(report.samples.builds.p10).toBeCloseTo(1.2, 9);
    expect(report.samples.builds.p90).toBeCloseTo(2.8, 9);
    expect(Object.keys(report.categories.choice)).toEqual(['neither', 'one', 'both']);
    expect(report.categories.choice.both.share).toBeCloseTo(1 / 3, 9);
    expect(report.ratios).toEqual({ deadRate: { '': 1 } });
  });

  it('gives one per-element table with a column per element-keyed count (per game) and ratio', () => {
    expect(report.elements).toEqual({
      opal: { held: 0.5, built: 0.5, buildRate: 1 },
      ruby: { held: 2, built: 1, buildRate: 0.5 },
    });
    expect(report.counts).not.toHaveProperty('held');
    expect(report.ratios).not.toHaveProperty('buildRate');
  });

  it('is the same for the same games, and reports a game with no metrics', () => {
    expect(buildReport(metrics, games)).toEqual(buildReport(metrics, games));
    const [plain] = buildReport(undefined, games);
    expect(plain).toMatchObject({ segments: {}, scores: {}, counts: {}, samples: {}, categories: {}, ratios: {}, elements: {} });
  });

  it('writes long CSV rows: variant,players,section,metric,key,stat,value', () => {
    const lines = reportCsv(buildReport(metrics, games)).trim().split('\n');
    expect(lines[0]).toBe('variant,players,section,metric,key,stat,value');
    expect(lines).toContain(',2,games,,,count,2');
    expect(lines).toContain(',2,winShare,,1,share,0.5');
    expect(lines).toContain(',2,ties,,,share,0.5');
    expect(lines).toContain(',2,length,,,mean,15');
    expect(lines).toContain(',2,segment,tool,hammer,players,2');
    expect(lines).toContain(',2,score,score,,spread,2');
    expect(lines).toContain(',2,count,deadTurns,,mean,1');
    expect(lines).toContain(',2,sample,builds,,n,3');
    expect(lines).toContain(',2,category,choice,neither,share,0.3333333333333333');
    expect(lines).toContain(',2,ratio,deadRate,,ratio,1');
    expect(lines).toContain(',2,element,,ruby,buildRate,0.5');
    expect(lines).toContain(',2,element,,opal,held,0.5');
    expect(lines.every((line) => line.split(',').length === 7)).toBe(true);
  });

  it('prints a table per section, and one per-element table', () => {
    const text = formatReport(buildReport(metrics, games));
    expect(text).toContain('2 players: 2 games');
    expect(text).toMatch(/Win share by seat\n\s+seat\s+share\s+low\s+high\n\s+1\s+50\.0%\s+9\.5%\s+90\.5%/);
    expect(text).toContain('Win share by tool');
    expect(text).toContain('Score: score');
    expect(text).toMatch(/Per element\n\s+element\s+held\s+built\s+buildRate\n\s+opal\s+0\.5\s+0\.5\s+1\n\s+ruby\s+2\s+1\s+0\.5/);
  });
});
