/**
 * THE HARNESS AND THE DEV HOST ANSWER THE SAME FRAME (#262).
 *
 * `boardsmith/testing`'s `TestWorld` exists so a game can scan the board its
 * players actually look at for hidden-information leaks. That is only worth
 * anything if what it hands the board is what a host SENDS -- a harness with
 * its own projection would go green while production leaked, which is the exact
 * failure the utility exists to prevent.
 *
 * So this drives ONE bundle two ways: through `LocalWorldHost` over a real
 * SQLite store with a socket attached, and through `TestWorld` over a Map, and
 * holds the two frames equal byte for byte -- the `world_state` body and the
 * `world_offers` list.
 *
 * IT IS THE TEST THAT FAILS IF THE TWO EVER SEPARATE. They cannot drift while
 * both go through `ResidentWorld`, and if somebody ever gives one of them a
 * projection of its own, this is what says so.
 */
import { describe, it, expect } from 'vitest';

import { worldBudgets } from '../../world/index.js';
import type { WorldHostClock } from '../../world/host/index.js';
import { createTestWorld, TEST_WORLD_EPOCH } from '../../testing/test-world.js';
import { vaultBundle, codewordOf } from '../../testing/test-world.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { LocalWorldHost } from './world-host.js';
import { openWorldStore, worldStorePath } from './world-store.js';

/** The same instant on both sides, so `now` cannot be what makes them differ:
 *  a verb that opens at dawn is a different offer at a different hour. */
function pinnedClock(): WorldHostClock {
  return {
    now: () => TEST_WORLD_EPOCH,
    arm: () => {},
    yieldTurn: () => Promise.resolve(),
  };
}

/** Drive the dev host to the same place, and read the last frame it sent the
 *  one attached socket. */
async function hostFrame(
  seat: number,
): Promise<{ view: unknown; actions: unknown; elementIdKey: string }> {
  const budgets = worldBudgets();
  // NAMED, because `temp-tree.test-helper` owns the removal and asserts that
  // every caller keeps the path it was given rather than losing it inline.
  const dir = tempTree('bs-world-parity-');
  const store = openWorldStore(worldStorePath(dir), budgets);
  const sent: Array<Record<string, unknown>> = [];
  const host = new LocalWorldHost({
    definition: vaultBundle(),
    worldName: 'Vault World',
    seed: 'test-world',
    budgets,
    store,
    clock: pinnedClock(),
    send: (_clientId, message) => sent.push(message as Record<string, unknown>),
    // No page in this file ever closes its socket.
    isOpen: () => true,
  });
  await host.start();
  await host.handleMessage('c1', { type: 'hello' });
  await host.handleMessage('c1', { type: 'attach', seat });
  await host.handleMessage('c1', {
    type: 'action',
    requestId: 'r1',
    order: { id: 'order-1', at: TEST_WORLD_EPOCH },
    action: 'stash',
    args: {},
  });
  const elementIdKey = store.elementIdKey();
  await host.close();
  const last = (type: string): Record<string, unknown> | undefined =>
    [...sent].reverse().find((message) => message['type'] === type);
  return {
    view: last('world_state')?.['view'],
    actions: last('world_offers')?.['actions'],
    elementIdKey,
  };
}

describe('TestWorld projects exactly what the dev host sends', () => {
  it('answers the same state body and the same offers for the same world', async () => {
    const seat = 2;
    const host = await hostFrame(seat);

    const world = await createTestWorld({
      definition: vaultBundle(),
      seed: 'test-world',
      // The SAME world means the same element id key (#482): the ids in both
      // frames are minted under it.
      elementIdKey: host.elementIdKey,
      now: TEST_WORLD_EPOCH,
      // The dev host has ONE socket open on this seat, so that is who is
      // present. Presence is an input to an offer, so a harness watching every
      // seat would be answering a different question.
      watching: [seat],
    });
    await world.take(seat, 'stash');
    const harness = await world.getPlayerView(seat);

    expect(harness.view).toEqual(host.view);
    expect(harness.offers).toEqual(host.actions);

    // AND THE FRAME IS A REAL ONE, not two copies of nothing: it carries this
    // seat's own secret and none of anybody else's.
    expect(JSON.stringify(harness.state)).toContain(codewordOf(seat));
    expect(JSON.stringify(harness.state)).not.toContain(codewordOf(1));

    await world.close();
  });
});
