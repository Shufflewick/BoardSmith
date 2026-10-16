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
