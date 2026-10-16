/**
 * #747: A RESIDENT WORLD LETS GO OF ITS COLDEST ROOMS AFTER EACH CHECKPOINT.
 *
 * Every partition anyone touched used to stay loaded until "wake", so each view
 * push in a long `boardsmith dev` or `TestWorld` session serialized everything
 * ever touched. The platform evicts the least recently used clean partitions
 * past `maxResidentPartitions` after every checkpoint; this host now does too.
 */
import { describe, expect, it } from 'vitest';

import { planEviction, worldBudgets } from './index.js';
import { ResidentWorld, worldSeatPlayer } from './host/index.js';
import { createMemoryWorldStore } from '../testing/memory-world-store.js';
import { vaultBundle } from '../testing/test-world.test-helper.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../engine/element/world-element-id-key.test-helper.js';

describe('planEviction', () => {
  it('picks the least recently used past the budget, skipping a dirty one', () => {
    const resident = [
      { name: 'a', lastUsed: 1 },
      { name: 'b', lastUsed: 2 },
      { name: 'c', lastUsed: 3 },
      { name: 'd', lastUsed: 4 },
    ];
    expect(planEviction(resident, new Set(['a']), 2)).toEqual({ evict: ['b', 'c'], blocked: [] });
    expect(planEviction(resident, new Set(['a', 'b', 'c']), 2)).toEqual({ evict: ['d'], blocked: ['a'] });
    expect(planEviction(resident, new Set(), 4)).toEqual({ evict: [], blocked: [] });
  });

  it('is 256 by default, the platform limit', () => {
    expect(worldBudgets().maxResidentPartitions).toBe(256);
  });
});

describe('ResidentWorld eviction (#747)', () => {
  it('keeps at most the budget resident after a checkpoint, and reloads evicted rooms on demand', async () => {
    const budgets = worldBudgets({ maxResidentPartitions: 2 });
    let orders = 0;
    const world = new ResidentWorld({
      definition: vaultBundle() as ConstructorParameters<typeof ResidentWorld>[0]['definition'],
      seed: 'eviction',
      budgets,
      store: createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets),
      clock: { now: () => 1_700_000_000_000, arm: () => {}, yieldTurn: () => Promise.resolve() },
      presence: () => [],
      mintId: () => 'unused',
    });
    await world.start();
    for (const seat of [1, 2, 3]) world.seat(worldSeatPlayer(seat), seat);
    const take = (seat: number, action: string) =>
      world.run(() =>
        world.command({
          player: worldSeatPlayer(seat),
          order: { id: `order-${++orders}`, at: world.now() },
          action,
          args: {},
        }),
      );
    const resident = () => world.residency().map((p) => p.name).sort();

    await take(1, 'stash');
    await take(2, 'stash');
    await take(3, 'stash');
    expect(resident()).toEqual(['vault:2', 'vault:3']);
    await take(1, 'post');
    expect(resident()).toEqual(['commons', 'vault:3']);

    // vault:1 was evicted after its stash landed; the stash survived and the
    // room comes back for a view and for the next command.
    const views = await world.run(() => world.viewsFor([worldSeatPlayer(1)]));
    expect(JSON.stringify(views.bodyFor(worldSeatPlayer(1)))).toContain('"tally":"*"');
    await take(1, 'stash');
    const again = await world.run(() => world.viewsFor([worldSeatPlayer(1)]));
    expect(JSON.stringify(again.bodyFor(worldSeatPlayer(1)))).toContain('"tally":"**"');
    expect(world.residency().length).toBeLessThanOrEqual(2);
    await world.close();
  });
});
