/**
 * #165: THE BUDGETS ARE THE LIBRARY'S AND THE HOST'S, NOT A PLATFORM'S.
 *
 * These numbers lived in ShufflewickPub -- the seat ceiling in its manifest
 * schema, the partition byte cap in a file about Cloudflare storage walls. A
 * laptop host that could not configure them would run a different world from
 * production, which is the one thing phase 1's gate forbids.
 */
import { describe, expect, it } from 'vitest';
import { worldBudgets } from './budgets.js';

describe('world budgets', () => {
  it('gives every host the same numbers unless it says otherwise', () => {
    const budgets = worldBudgets();
    expect(budgets.maxPlayers).toBe(500);
    expect(budgets.partitionMaxBytes).toBe(512 * 1024);
    expect(budgets.maxUnkeyedPendingPerPlayer).toBe(32);
    expect(budgets.maxKeyedPendingPerPlayer).toBe(64);
    expect(budgets.maxCandidatesPerSelection).toBe(200);
  });

  it("lets a host widen or narrow what one selection may offer", () => {
    // #169 enumerates a world action's selections, and an unbounded enumeration
    // is the O(world) read the partitioned model exists to delete. A host that
    // keeps its worlds small may allow a wider choice than one running 500-seat
    // worlds; what neither may do is discover the other's number silently.
    expect(worldBudgets({ maxCandidatesPerSelection: 20 }).maxCandidatesPerSelection).toBe(20);
    expect(() => worldBudgets({ maxCandidatesPerSelection: 0 })).toThrow(
      /maxCandidatesPerSelection/,
    );
  });

  it('derives the batch cap as everything one owner may hold at once', () => {
    // The invariant: the holding caps bound the queue, the batch cap bounds the
    // asking, and an asking bound below a holding bound refuses batches the
    // queue would have admitted whole.
    const budgets = worldBudgets();
    expect(budgets.maxSchedulesPerCommand).toBe(
      budgets.maxUnkeyedPendingPerPlayer + budgets.maxKeyedPendingPerPlayer,
    );
  });

  it('re-derives the batch cap when a holding cap is raised', () => {
    const budgets = worldBudgets({ maxKeyedPendingPerPlayer: 128 });
    expect(budgets.maxSchedulesPerCommand).toBe(32 + 128);
  });

  it('re-derives the world queue ceiling when the seat ceiling moves', () => {
    // A laptop host runs a four-seat world; its queue ceiling must not stay
    // sized for a 500-seat one.
    const budgets = worldBudgets({ maxPlayers: 4 });
    expect(budgets.maxPendingEvents).toBe(4 * 32);
  });

  it('lets a host name a derived budget outright', () => {
    const budgets = worldBudgets({ maxPlayers: 4, maxPendingEvents: 1000 });
    expect(budgets.maxPendingEvents).toBe(1000);
  });

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as a budget, naming the field',
    (bad) => {
      expect(() => worldBudgets({ maxPlayers: bad })).toThrow(/maxPlayers/);
    },
  );
});
