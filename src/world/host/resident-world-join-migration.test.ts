/**
 * #787: A `join` MIGRATION RUN BY THE HOST CORE, IN ONE CALL.
 *
 * `ResidentWorld` (what `boardsmith dev` and `TestWorld` run) migrates by
 * handing the runner every stored root at once and no `sources`, because every
 * original is already in that one call. The runner used to refuse that call as
 * if it were a page that forgot its originals, so no join could ever run there.
 */
import { describe, expect, it } from 'vitest';
import { Game, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, worldMigration, type WorldDefinition } from '../index.js';
import { ResidentWorld, type WorldStore } from './index.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';

class Owner extends Space<Ledger> {
  records: string[] = [];
  rebuilt: string[] = [];
}

class Ledger extends Game<Ledger> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Owner]);
  }
}

const read = worldAction<Ledger>('read')
  .needs(() => ['target'])
  .execute(() => {});

function bundle(world: Partial<WorldDefinition> = {}): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Ledger,
    gameType: 'ledger',
    world: {
      maxPlayers: 1,
      actions: [read],
      genesis: (game: Game): Record<string, GameElement> => {
        const source = game.create(Owner, 'source') as Owner;
        source.records = ['a', 'b'];
        return { source, target: game.create(Owner, 'target') };
      },
      view: () => ['target'],
      ...world,
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

function over(store: WorldStore, definition: ReturnType<typeof bundle>) {
  return new ResidentWorld({
    definition,
    seed: 'ledger',
    budgets: worldBudgets(),
    store,
    clock: { now: () => 0, arm: () => {}, yieldTurn: () => Promise.resolve() },
    presence: () => [],
    mintId: () => 'event',
  });
}

/** A launched world on state version 1, closed, then offered `migration`. */
async function reopened(migration: unknown) {
  const store = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, worldBudgets());
  const first = over(store, bundle({ stateVersion: 1 }));
  await first.start();
  await first.close();
  return { store, world: over(store, bundle({ stateVersion: 2, migration } as Partial<WorldDefinition>)) };
}

const joining = (declared: string) =>
  worldMigration<undefined>({
    from: 1,
    join: { sources: (name) => (name === 'target' ? [declared] : []), maxSources: 1, maxSourceBytes: 10_000 },
    // 'source' sorts before 'target', so it is rewritten first in the same call.
    partition: (element, ctx) => {
      if (ctx.name === 'source') (element as Owner).records.push('rewritten');
      if (ctx.name === 'target') (element as Owner).rebuilt = [...(ctx.source(declared) as Owner).records];
    },
  });

const attributesIn = async (store: WorldStore, name: string) =>
  ((await store.read(name))?.json as { attributes: { records: string[]; rebuilt: string[] } }).attributes;

describe('a join migration run by ResidentWorld (#787)', () => {
  it('reads each original as stored, even after its own root was rewritten in the same call', async () => {
    const { store, world } = await reopened(joining('source'));

    const outcome = await world.start();

    expect(outcome.migrated).toEqual({ from: 1, to: 2, partitions: 2, created: 0, events: 0 });
    expect(store.stateVersion()).toBe(2);
    expect((await attributesIn(store, 'source')).records).toEqual(['a', 'b', 'rewritten']);
    expect((await attributesIn(store, 'target')).rebuilt).toEqual(['a', 'b']);
    await world.close();
  });

  it('refuses a join that names a root the world does not hold, and changes nothing', async () => {
    const { store, world } = await reopened(joining('nowhere'));

    await expect(world.start()).rejects.toThrow(
      "This migration's `join.sources` names a root this world does not hold: nowhere. " +
        'Change `join.sources` to name only roots the world holds when the migration begins. ' +
        'The world was not changed.',
    );
    expect(store.stateVersion()).toBe(1);
    await world.close();
  });
});
