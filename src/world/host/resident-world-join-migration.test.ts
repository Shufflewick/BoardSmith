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
  .needs(() => ['dest'])
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
        return { source, dest: game.create(Owner, 'dest') };
      },
      view: () => ['dest'],
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
    join: { sources: (name) => (name === 'dest' ? [declared] : []), maxSources: 1, maxSourceBytes: 10_000 },
    partition: (element, ctx) => {
      if (ctx.name !== 'dest') return;
      (element as Owner).rebuilt = [...(ctx.source(declared) as Owner).records];
    },
  });

describe('a join migration run by ResidentWorld (#787)', () => {
  it('reads its originals from the roots the call already carries', async () => {
    const { store, world } = await reopened(joining('source'));

    const outcome = await world.start();

    expect(outcome.migrated).toEqual({ from: 1, to: 2, partitions: 2, created: 0, events: 0 });
    expect(store.stateVersion()).toBe(2);
    const dest = (await store.read('dest'))?.json as { attributes: { rebuilt: string[] } };
    expect(dest.attributes.rebuilt).toEqual(['a', 'b']);
    await world.close();
  });

  it('still refuses an original the world does not hold, and changes nothing', async () => {
    const { store, world } = await reopened(joining('nowhere'));

    await expect(world.start()).rejects.toThrow(/Not sent: nowhere\./);
    expect(store.stateVersion()).toBe(1);
    await world.close();
  });
});
