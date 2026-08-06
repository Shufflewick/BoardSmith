/**
 * turnSequence / orderSeatsByTurn — recovering the running order the flow
 * already resolved, and turning it into a list safe to render.
 *
 * The whole point is that this is NOT `Game.nextPlayer()`. That method is a
 * hardcoded seat successor (`sortBy('seat')`, then `idx + 1`), so for any game
 * whose turn order is not seat order it answers confidently and wrongly. The
 * order the flow will actually take is resolved once per round by `eachPlayer`
 * — direction, startingPlayer and filter all applied — and parked in its frame
 * as `eligibleSeats`, which is already serialized to every client. These tests
 * cover reading that back, and the two properties the panel depends on: every
 * seat appears, and no seat appears twice.
 */
import { describe, it, expect } from 'vitest';
import { turnSequence, orderSeatsByTurn } from './seat-activity.js';

const withFrames = (frameData: Record<string, Record<string, unknown>>) => ({
  awaitingInput: true,
  position: { frameData },
});

describe('turnSequence', () => {
  it('reads the running order an eachPlayer frame resolved', () => {
    expect(
      turnSequence(withFrames({ __frame_1: { eligibleSeats: [3, 1, 2], nextIndex: 1 } })),
    ).toEqual([3, 1, 2]);
  });

  it('reports a rotated round in the order it will be played, not seat order', () => {
    // `startingPlayer` rotating the dealer: seats 1..4, round starts at 3.
    const seq = turnSequence(withFrames({ __frame_0: { eligibleSeats: [3, 4, 1, 2] } }));
    expect(seq).toEqual([3, 4, 1, 2]);
    expect(seq).not.toEqual([1, 2, 3, 4]);
  });

  it('reports a backward round backwards', () => {
    expect(turnSequence(withFrames({ __frame_0: { eligibleSeats: [4, 3, 2, 1] } }))).toEqual([
      4, 3, 2, 1,
    ]);
  });

  it('takes the INNERMOST order when eachPlayer frames nest', () => {
    // A round loop outside a bidding loop: bidding is what is being played now.
    expect(
      turnSequence(
        withFrames({
          __frame_0: { eligibleSeats: [1, 2, 3, 4] },
          __frame_2: { eligibleSeats: [3, 4] },
          __frame_3: { moveCount: 0 },
        }),
      ),
    ).toEqual([3, 4]);
  });

  it('returns [] when the flow has no order to report — simultaneous, or hand-rolled', () => {
    // 1-2 Punch's opening step: both seats decide independently, no running order.
    expect(
      turnSequence({
        awaitingInput: true,
        awaitingPlayers: [
          { playerIndex: 1, availableActions: ['submit'], completed: false },
          { playerIndex: 2, availableActions: ['submit'], completed: false },
        ],
        position: { frameData: { __frame_1: { moveCount: 0 } } },
      }),
    ).toEqual([]);

    expect(turnSequence({ awaitingInput: true })).toEqual([]);
    expect(turnSequence(undefined)).toEqual([]);
    expect(turnSequence(null)).toEqual([]);
  });

  it('ignores a malformed eligibleSeats rather than reporting a partial order', () => {
    expect(turnSequence(withFrames({ __frame_0: { eligibleSeats: 'nope' } }))).toEqual([]);
    // Non-numeric entries are dropped; the numeric order that remains is real.
    expect(
      turnSequence(withFrames({ __frame_0: { eligibleSeats: [1, null, 2] } })),
    ).toEqual([1, 2]);
  });
});

describe('orderSeatsByTurn', () => {
  it('follows the sequence', () => {
    expect(orderSeatsByTurn([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('KEEPS a seat the round filtered out — a folded player still has a row', () => {
    // eachPlayer's `filter` legitimately omits seats from the running order.
    // Dropping them from the panel would erase their name, score and presence.
    expect(orderSeatsByTurn([1, 2, 3, 4], [3, 1])).toEqual([3, 1, 2, 4]);
  });

  it('never lets a malformed sequence duplicate or invent a seat', () => {
    expect(orderSeatsByTurn([1, 2, 3], [2, 2, 9, 1])).toEqual([2, 1, 3]);
  });

  it('falls back to seat order when the sequence says nothing', () => {
    expect(orderSeatsByTurn([3, 1, 2], [])).toEqual([1, 2, 3]);
  });

  it('is total for every input: the result is a permutation of the seats', () => {
    const seats = [1, 2, 3, 4, 5];
    for (const seq of [[], [5], [5, 4, 3, 2, 1], [2, 2], [9, 9], [3, 1, 4]]) {
      const out = orderSeatsByTurn(seats, seq);
      expect([...out].sort((a, b) => a - b)).toEqual(seats);
    }
  });
});
