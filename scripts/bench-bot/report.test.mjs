/**
 * The bot benchmark's arithmetic and its baseline file (#630): which plies it
 * searches, how a measurement becomes steps per second and time shares, and
 * that the baseline states where and how it was measured.
 */
import { describe, it, expect } from 'vitest';
import { pickPositions, summarize, formatReport } from './report.mjs';

describe('pickPositions', () => {
  it('takes the plies at a tenth, a half and nine tenths of the game', () => {
    const counts = Array.from({ length: 100 }, () => 5);
    expect(pickPositions(counts)).toEqual([
      { name: 'early', ply: 10 },
      { name: 'middle', ply: 50 },
      { name: 'late', ply: 90 },
    ]);
  });

  it('moves past a ply where the seat to move has only one move, which the bot does not search', () => {
    const counts = Array.from({ length: 20 }, () => 3);
    counts[2] = 1;
    counts[10] = 1;
    counts[11] = 0;
    expect(pickPositions(counts)).toEqual([
      { name: 'early', ply: 3 },
      { name: 'middle', ply: 12 },
      { name: 'late', ply: 18 },
    ]);
  });

  it('refuses a game with no searchable ply after the mark, naming which position', () => {
    const counts = [3, 3, 3, 3, 1, 1, 1, 1, 1, 1];
    expect(() => pickPositions(counts)).toThrow(/middle position/);
  });
});

describe('summarize', () => {
  it('gives steps per second and each part of the search as a share of its time', () => {
    const row = summarize({
      steps: 300,
      ms: 2000,
      parts: { rebuild: 200, legalMoves: 400, apply: 300, reapply: 600, scoring: 100, determinize: 0 },
      lookupMs: 500,
    });
    expect(row.stepsPerSecond).toBe(150);
    expect(row.shares).toEqual({
      rebuild: 10,
      legalMoves: 20,
      apply: 15,
      reapply: 30,
      scoring: 5,
      determinize: 0,
      other: 20,
      lookup: 25,
    });
  });

  it('leaves out shares for a search that was not profiled', () => {
    expect(summarize({ steps: 50, ms: 1000 })).toEqual({ steps: 50, ms: 1000, stepsPerSecond: 50 });
  });
});

describe('formatReport', () => {
  const meta = {
    date: '2026-10-10T12:00:00.000Z',
    commit: 'abc1234',
    dirty: false,
    node: 'v22.23.3',
    devMode: false,
    loadBefore: [3.25, 2.5, 2],
    loadAfter: [4, 3, 2.25],
    cpus: 10,
    cpuModel: 'Test CPU',
  };
  const position = {
    name: 'early',
    ply: 10,
    seat: 1,
    presets: {
      easy: { steps: 100, ms: 500 },
      medium: { steps: 300, ms: 1500 },
      hard: { steps: 480, ms: 2000 },
    },
    fixed: {
      steps: 300,
      ms: 3000,
      move: 'move {"to":4}',
      parts: { rebuild: 300, legalMoves: 300, apply: 300, reapply: 300, scoring: 300, determinize: 0 },
      lookupMs: 600,
    },
  };
  const report = formatReport(meta, [{ name: 'hex-11', commit: 'def5678', playerCount: 2, plies: 100, positions: [position] }]);

  it('states the commit, Node version, production mode and the load average', () => {
    expect(report).toContain('BoardSmith commit: `abc1234`');
    expect(report).toContain('Node: v22.23.3');
    expect(report).toContain('Mode: production');
    expect(report).toContain('Load average (1, 5, 15 min): 3.25, 2.50, 2.00 at the start; 4.00, 3.00, 2.25 at the end');
  });

  it('says so when the checkout had uncommitted changes', () => {
    expect(formatReport({ ...meta, dirty: true }, [])).toContain('`abc1234` with uncommitted changes');
  });

  it('refuses a measurement taken in development mode', () => {
    expect(() => formatReport({ ...meta, devMode: true }, [])).toThrow(/development mode/);
  });

  it('has a row per position for the presets and for the fixed search', () => {
    expect(report).toContain('| hex-11 | early (ply 10, seat 1) | 100 | 500 | 200 | 300 | 1500 | 200 | 480 | 2000 | 240 |');
    expect(report).toContain('| hex-11 | early (ply 10, seat 1) | 300 | 3000 | 100 | 10 | 10 | 10 | 10 | 10 | 0 | 50 | 20 | `move {"to":4}` |');
  });
});
