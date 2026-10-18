import { expect, it } from 'vitest';

import { worldBudgets } from '../index.js';
import { ResidentWorld } from './index.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { vaultBundle } from '../../testing/test-world.test-helper.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';

it('refuses a chair somebody else holds before the roster records it (#796)', async () => {
  const budgets = worldBudgets();
  const store = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets);
  const world = new ResidentWorld({
    definition: vaultBundle() as ConstructorParameters<typeof ResidentWorld>[0]['definition'],
    seed: 'seat-conflict',
    budgets,
    store,
    clock: { now: () => 1_700_000_000_000, arm: () => {}, yieldTurn: () => Promise.resolve() },
    presence: () => [],
    mintId: () => 'unused',
  });
  await world.start();

  world.seat('player-a', 1);
  expect(() => world.seat('player-b', 1)).toThrow(expect.objectContaining({ code: 'seat-conflict' }));
  expect(() => world.seat('player-a', 1)).not.toThrow();
  expect(store.seats().map((row) => [row.player, row.seat])).toEqual([['player-a', 1]]);
  await world.close();
});

function openWorld(store: ReturnType<typeof createMemoryWorldStore>, budgets: ReturnType<typeof worldBudgets>) {
  return new ResidentWorld({
    definition: vaultBundle() as ConstructorParameters<typeof ResidentWorld>[0]['definition'],
    seed: 'roster-restore',
    budgets,
    store,
    clock: { now: () => 1_700_000_000_000, arm: () => {}, yieldTurn: () => Promise.resolve() },
    presence: () => [],
    mintId: () => 'unused',
  });
}

it('refuses a stored roster where two players hold one seat, naming both (#980)', () => {
  // Before #796 `seat` let a second player take a held chair, so a store may hold this.
  const budgets = worldBudgets();
  const store = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets);
  store.seat('player-a', 1, 0);
  store.seat('player-b', 1, 0);

  expect(() => openWorld(store, budgets)).toThrow(
    expect.objectContaining({
      code: 'roster-double-holder',
      owner: 'platform',
      message: expect.stringMatching(/seat 1.*"player-a".*"player-b"/s),
    }),
  );
});

it('restores a stored roster where every seat has one holder', async () => {
  const budgets = worldBudgets();
  const store = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets);
  store.seat('player-a', 1, 0);
  store.seat('player-b', 2, 0);
  const world = openWorld(store, budgets);
  await world.start();

  expect(() => world.seat('player-a', 1)).not.toThrow();
  expect(() => world.seat('player-c', 2)).toThrow(expect.objectContaining({ code: 'seat-conflict' }));
  await world.close();
});
