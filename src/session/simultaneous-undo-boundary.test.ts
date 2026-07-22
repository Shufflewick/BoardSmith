import { describe, it, expect } from 'vitest';
import { simultaneousUndoBoundary } from './utils.js';

// F-05 (v4.8, SIM-02): the undo boundary for a seat inside a simultaneous step
// must anchor on the START OF THE TRAILING RUN of that seat's OWN actions, not
// on its FIRST action in the window. With multi-action interleavings like
// [A, B, A] the old code anchored on the first A, saw B after it, and refused —
// leaving NOBODY able to undo.
function hist(...players: number[]): Array<{ player: number }> {
  return players.map((player) => ({ player }));
}

describe('simultaneousUndoBoundary (F-05 / SIM-02)', () => {
  it('lets the LAST actor undo its trailing own action in an [A,B,A] interleave', () => {
    // seat A: trailing run is just the final A (index 2).
    const r = simultaneousUndoBoundary(hist(1, 2, 1), 3, 1);
    expect(r).toEqual({ turnStartActionIndex: 2, actionsThisTurn: 1 });
  });

  it('refuses a seat that is NOT the last actor (a co-decider acted after it)', () => {
    // seat B (2): its action at index 1 has A's action after it -> refuse.
    expect(simultaneousUndoBoundary(hist(1, 2, 1), 3, 2)).toBeUndefined();
  });

  it('rewinds the whole trailing run of a seat\'s own contiguous actions', () => {
    // [A, A] seat A: both are the seat's own trailing run.
    expect(simultaneousUndoBoundary(hist(1, 1), 2, 1)).toEqual({
      turnStartActionIndex: 0,
      actionsThisTurn: 2,
    });
  });

  it('refuses when the seat never acted in the window', () => {
    expect(simultaneousUndoBoundary(hist(2, 2), 2, 1)).toBeUndefined();
  });

  it('lets the last actor undo in a simple [A,B] case', () => {
    expect(simultaneousUndoBoundary(hist(1, 2), 2, 2)).toEqual({
      turnStartActionIndex: 1,
      actionsThisTurn: 1,
    });
  });

  it('does not reach past the moveCount window into a prior step', () => {
    // moveCount 1 -> window is only the last action. Seat A's trailing run is
    // bounded to the window even though A also acted earlier.
    expect(simultaneousUndoBoundary(hist(1, 1, 1), 1, 1)).toEqual({
      turnStartActionIndex: 2,
      actionsThisTurn: 1,
    });
  });

  it('returns undefined when moveCount is undefined or history empty', () => {
    expect(simultaneousUndoBoundary(hist(1), undefined, 1)).toBeUndefined();
    expect(simultaneousUndoBoundary([], 3, 1)).toBeUndefined();
  });
});
