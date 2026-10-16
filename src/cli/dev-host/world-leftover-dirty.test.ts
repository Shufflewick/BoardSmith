/**
 * #730: A DIRTY MARK LEFT BY A CRASH DOES NOT FAIL THE FIRST COMMAND AFTER RESTART.
 *
 * `recordDirty` is written before the checkpoint, so a host that dies between
 * the two leaves marks in the store. A rebuilt world has nothing resident, and
 * every checkpoint serializes every marked partition, so the first dispatch
 * after the restart used to be rolled back for a partition it never touched.
 *
 * Driven over both stores a `ResidentWorld` runs on: the dev host's SQLite and
 * `boardsmith/testing`'s memory store.
 */
import { describe, expect, it } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, worldClockAction, type WorldDefinition } from '../../world/index.js';
import { ResidentWorld, worldSeatPlayer, type WorldStore } from '../../world/host/index.js';
import { openWorldStore, worldStorePath } from './world-store.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';
import { frozenClock } from './frozen-clock.test-helper.js';

const MINUTE = 60_000;
const OPENED = 1_700_000_000_000;
const LEDGER = 'ledger';
const VAULT = 'vault:2';

class Ledger extends Space<Realm> {
  marks = '';
}

class Realm extends Game<Realm, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ledger]);
  }
}

function write(world: { partition(name: string): GameElement }, mark: string): void {
  const ledger = world.partition(LEDGER) as Ledger;
  ledger.marks = ledger.marks === '' ? mark : `${ledger.marks},${mark}`;
}

const post = worldAction<Realm>('post')
  .prompt('Post')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => write(world, 'post'));

const beat = worldClockAction<Realm>('beat')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => write(world, 'beat'));

const arm = worldClockAction<Realm>('arm')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ delayMs: MINUTE, action: 'beat' });
  });

const definition = {
  gameClass: Realm,
  gameType: 'realm',
  displayName: 'Realm',
  world: {
    maxPlayers: 2,
    genesis: (game: Game): Record<string, GameElement> => ({
      [LEDGER]: game.create(Ledger, 'ledger'),
      [VAULT]: game.create(Ledger, 'vault'),
    }),
    view: () => [LEDGER],
    actions: [post, beat, arm],
  } as WorldDefinition,
} as ConstructorParameters<typeof ResidentWorld>[0]['definition'];

const PLAYER = worldSeatPlayer(1);

function host(store: WorldStore, clock = frozenClock(OPENED)) {
  let minted = 0;
  const world = new ResidentWorld({
    definition,
    seed: 'realm',
    budgets: worldBudgets(),
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
  });
  return { world, clock };
}

async function ledgerMarks(store: WorldStore): Promise<string> {
  const stored = await store.read(LEDGER);
  return (stored?.json as { attributes?: { marks?: string } }).attributes?.marks ?? '';
}

const stores: ReadonlyArray<[string, () => { open: () => WorldStore; reopen: (old: WorldStore) => WorldStore }]> = [
  [
    'the dev SQLite store',
    () => {
      const path = worldStorePath(tempTree('bs-leftover-dirty-'));
      return {
        open: () => openWorldStore(path, worldBudgets()),
        // The process died: its handle goes, the file stays.
        reopen: (old) => {
          old.close();
          return openWorldStore(path, worldBudgets());
        },
      };
    },
  ],
  [
    'the testing memory store',
    () => ({
      open: () => createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, worldBudgets()),
      reopen: (old) => old,
    }),
  ],
];

/** A launched world whose host died after marking `vault:2` and before it checkpointed. */
async function crashAfterMarking(
  backing: { open: () => WorldStore; reopen: (old: WorldStore) => WorldStore },
  setup: (world: ResidentWorld) => Promise<void> = async () => {},
): Promise<WorldStore> {
  const store = backing.open();
  const { world } = host(store);
  await world.start();
  world.seat(PLAYER, 1);
  await setup(world);
  store.recordDirty([VAULT]);
  return backing.reopen(store);
}

describe.each(stores)('#730: leftover dirty marks over %s', (_label, backing) => {
  it('lets the first command after a restart run', async () => {
    const store = await crashAfterMarking(backing());
    const { world } = host(store);
    await world.start();

    const outcome = await world.run(() =>
      world.command({ player: PLAYER, order: { id: 'order-1', at: world.now() }, action: 'post' }),
    );
    expect(outcome.kind).toBe('committed');
    expect(await ledgerMarks(store)).toBe('post');
    expect(store.dirtyPartitions()).toEqual([]);
    await world.close();
  });

  it('lets a due event drained first after a restart run', async () => {
    const store = await crashAfterMarking(backing(), (world) => world.clockCommand('arm', {}));
    const { world, clock } = host(store);
    await world.start();
    clock.set(OPENED + 2 * MINUTE);

    await world.run(() => world.fireDue());
    expect(await ledgerMarks(store)).toBe('beat');
    expect(store.pendingEvents()).toEqual([]);
    await world.close();
  });
});
