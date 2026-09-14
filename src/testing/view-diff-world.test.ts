/**
 * `diffPlayerViews`, AIMED AT A PERSISTENT WORLD (#267).
 *
 * A table's two seats hold the SAME tree with different things redacted out of
 * it, so pairing the two trees by position said something true. A world's do
 * not: a seat's frame is PRUNED to the partitions its own `world.view` named,
 * so seat 1's frame holds seat 1's vault and seat 2's holds seat 2's -- one
 * node each, at the same position, and entirely unrelated to each other.
 *
 * Walked positionally, that reads as ONE room whose keeper and codeword differ,
 * and the diff reports every field of two different survivors as an attribute
 * difference with both `onlyIn` buckets empty. The guarantee a world actually
 * needs is the opposite one: the other seat's vault is ABSENT, which a
 * positional pairing has no way to say.
 *
 * So the walk pairs by ELEMENT IDENTITY, and falls back to position only where
 * the engine anonymized an id (a hidden zone's fungible children), which is the
 * one place identity is deliberately not on offer.
 */
import { describe, it, expect } from 'vitest';

import { createTestWorld } from './test-world.js';
import { diffPlayerViews, type ViewDiffResult } from './view-diff.js';
import { codewordOf, keeperOf, vaultBundle } from './test-world.test-helper.js';

/**
 * THE GUARANTEE THAT MATTERS IN A WORLD: each seat's room is absent from the
 * other's frame -- and NOT the answer a positional walk gave, which was one
 * room whose every field disagreed.
 */
function expectEachRoomAbsentFromTheOtherFrame(result: ViewDiffResult): void {
  expect(result.onlyInA).toContain('VaultWorld[0].vault-1');
  expect(result.onlyInB).toContain('VaultWorld[0].vault-2');
  expect(result.attributeDiffs).toEqual([]);
}

describe('diffPlayerViews across two seats of a world', () => {
  it('reports the other seat’s vault as absent rather than as a field that differs', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    await world.take(1, 'stash');

    expectEachRoomAbsentFromTheOtherFrame(await diffPlayerViews(world, 1, 2));

    await world.close();
  });

  it('never names either seat’s secret in the diff it reports', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });

    const described = (await diffPlayerViews(world, 1, 2)).describe();

    // A diff that printed the codewords would be the leak it exists to find.
    expect(described).not.toContain(codewordOf(1));
    expect(described).not.toContain(codewordOf(2));
    expect(described).not.toContain(keeperOf(1));

    await world.close();
  });

  it('says nothing about the room both seats can see, because they see it alike', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    await world.take(3, 'post');

    const result = await diffPlayerViews(world, 1, 2);

    expect(result.onlyInA).not.toContain('VaultWorld[0].commons');
    expect(result.onlyInB).not.toContain('VaultWorld[0].commons');
    expect(result.attributeDiffs.map((diff) => diff.path)).toEqual([]);

    await world.close();
  });

  it('answers the same for a pair of frames a caller captured itself', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });
    const a = await world.getPlayerView(1);
    const b = await world.getPlayerView(2);

    expectEachRoomAbsentFromTheOtherFrame(
      diffPlayerViews({ player: 1, state: a.state }, { player: 2, state: b.state }),
    );

    await world.close();
  });
});

describe('a subject whose frames have not arrived yet', () => {
  it('is refused with a sentence rather than diffed as two empty trees', async () => {
    const world = await createTestWorld({ definition: vaultBundle() });

    // The world's frames are a read of its store, so they arrive as promises. A
    // caller who forgets the `await` used to get a clean diff of two `undefined`
    // trees -- a result that cannot fail, which is the whole subject of #267.
    const unawaited = {
      getPlayerView: (seat: number) => world.getPlayerView(seat),
    };

    expect(() =>
      diffPlayerViews(unawaited as never, 1, 2),
    ).toThrow(/has not arrived yet|await/);

    await world.close();
  });
});
