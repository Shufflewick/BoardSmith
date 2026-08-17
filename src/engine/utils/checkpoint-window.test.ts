/**
 * `checkpointAt` is the ONLY sanctioned reader of an `ActionCheckpointWindow`,
 * and the whole point of it is that the two absences are distinguishable:
 * 'pruned' (dropped by the game's checkpoints.max policy — the author can raise
 * it) versus 'uncaptured' (never taken — a bug, or checkpointing is off).
 * Callers turn those into different, actionable undo errors.
 */
import { describe, it, expect } from 'vitest';
import {
  checkpointAt,
  checkpointCount,
  type ActionCheckpoint,
  type ActionCheckpointWindow,
} from './snapshot.js';

const entry = (actionIndex: number): ActionCheckpoint =>
  ({ actionIndex } as unknown as ActionCheckpoint);

/** A window retaining checkpoints for action counts 5..8. */
const window: ActionCheckpointWindow = {
  baseIndex: 5,
  entries: [entry(5), entry(6), entry(7), entry(8)],
};

describe('checkpointAt', () => {
  it('returns the checkpoint for every retained index', () => {
    for (let index = 5; index <= 8; index++) {
      expect(checkpointAt(window, index)).toEqual({ checkpoint: entry(index) });
    }
  });

  it('resolves the index through baseIndex, not raw array position', () => {
    expect(checkpointAt(window, 5).checkpoint).toBe(window.entries[0]);
    expect(checkpointAt(window, 8).checkpoint).toBe(window.entries[3]);
  });

  it("reports 'pruned' for an index older than the retained window", () => {
    expect(checkpointAt(window, 4)).toEqual({ checkpoint: null, absence: 'pruned' });
    expect(checkpointAt(window, 0)).toEqual({ checkpoint: null, absence: 'pruned' });
  });

  it("reports 'uncaptured' for an index ahead of the window", () => {
    expect(checkpointAt(window, 9)).toEqual({ checkpoint: null, absence: 'uncaptured' });
    expect(checkpointAt(window, 100)).toEqual({ checkpoint: null, absence: 'uncaptured' });
  });

  it("reports 'uncaptured' when there is no window at all", () => {
    expect(checkpointAt(undefined, 0)).toEqual({ checkpoint: null, absence: 'uncaptured' });
  });

  it("reports 'uncaptured' — never 'pruned' — for an empty window", () => {
    // An empty window has no retained range, so nothing was dropped by policy;
    // calling it 'pruned' would send the author to raise a limit that is not
    // the problem.
    const empty: ActionCheckpointWindow = { baseIndex: 3, entries: [] };
    expect(checkpointAt(empty, 0).absence).toBe('uncaptured');
    expect(checkpointAt(empty, 3).absence).toBe('uncaptured');
    expect(checkpointAt(empty, 9).absence).toBe('uncaptured');
  });

  it('distinguishes the two absences at the boundaries of the window', () => {
    expect(checkpointAt(window, 4).absence).toBe('pruned');
    expect(checkpointAt(window, 5).checkpoint).not.toBeNull();
    expect(checkpointAt(window, 8).checkpoint).not.toBeNull();
    expect(checkpointAt(window, 9).absence).toBe('uncaptured');
  });

  it('handles a window that starts at action 0', () => {
    const fromStart: ActionCheckpointWindow = { baseIndex: 0, entries: [entry(0), entry(1)] };
    expect(checkpointAt(fromStart, 0).checkpoint).toBe(fromStart.entries[0]);
    expect(checkpointAt(fromStart, 2).absence).toBe('uncaptured');
  });

  it('does not mutate the window it reads', () => {
    const snapshot = JSON.parse(JSON.stringify(window));
    checkpointAt(window, 6);
    checkpointAt(window, 99);
    expect(JSON.parse(JSON.stringify(window))).toEqual(snapshot);
  });
});

describe('checkpointCount', () => {
  it('counts the retained entries', () => {
    expect(checkpointCount(window)).toBe(4);
  });

  it('is 0 for an absent window', () => {
    expect(checkpointCount(undefined)).toBe(0);
  });

  it('is 0 for an empty window', () => {
    expect(checkpointCount({ baseIndex: 7, entries: [] })).toBe(0);
  });

  it('counts only what is retained, not the actions the window skipped past', () => {
    // baseIndex 5 means actions 0..4 were pruned; they must not be counted.
    expect(checkpointCount(window)).toBe(window.entries.length);
  });
});
