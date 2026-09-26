/**
 * #395: A WORLD THAT HAS COMPLETED STAYS COMPLETED, AND RUNS NOTHING ELSE.
 *
 * `complete()` used to set a flag in memory and nothing else. Later commands
 * still ran, scheduled events kept firing and re-arming, and a restarted
 * `boardsmith dev` had forgotten the ending altogether -- while the platform
 * (ShufflewickPub `games/src/world-session.ts`) refuses every command with
 * `world-ended`, empties the queue, and never ends a season twice (#339). So
 * anything an author tested in dev after the close was behaviour the platform
 * will never show.
 *
 * Driven over BOTH stores a `ResidentWorld` runs on: the dev host's SQLite,
 * which is the one a restart has to find the ending in, and `boardsmith/testing`'s
 * memory store, so a game's own `TestWorld` tests see the same close.
 */
import { describe, expect, it } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import {
  WorldRefusal,
  worldAction,
  worldBudgets,
  worldClockAction,
  type WorldDefinition,
} from '../../world/index.js';
import {
  ResidentWorld,
  worldSeatPlayer,
  type WorldHostClock,
  type WorldStore,
} from '../../world/host/index.js';
import { openWorldStore, worldStorePath } from './world-store.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const MINUTE = 60_000;
const OPENED = 1_700_000_000_000;

class Ledger extends Space<Season> {
  /** What ran, in the order it committed. */
  marks = '';
}

class Season extends Game<Season, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Ledger]);
  }
}

const LEDGER = 'ledger';

function write(world: { partition(name: string): GameElement }, mark: string): void {
  const ledger = world.partition(LEDGER) as Ledger;
  ledger.marks = ledger.marks === '' ? mark : `${ledger.marks},${mark}`;
}

/** A player's ordinary move. */
const note = worldAction<Season>('note')
  .prompt('Note')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => write(world, 'note'));

/** A player's move that ends the season. */
const close = worldAction<Season>('close')
  .prompt('Close the season')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => {
    write(world, 'close');
    // Scheduled in the very command that ends the world: the ending must take
    // this with everything else in the queue.
    world.schedule({ delayMs: MINUTE, action: 'beat' });
    world.complete();
  });

/** The world's heartbeat. */
const beat = worldClockAction<Season>('beat')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => write(world, 'beat'));

/** The clock's own ending, for a season that closes on a timer. */
const expire = worldClockAction<Season>('expire')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => {
    write(world, 'expire');
    world.complete();
  });

/**
 * Arms the queue a case starts from: a recurring heartbeat, and for
 * `expiring` a timed close due BEFORE the first beat with a one-shot beat after
 * it -- so events are still queued behind the ending when it runs. For
 * `recurring-expiry` the close is itself a recurrence, so several of its own
 * occurrences are due at once.
 */
const arm = worldClockAction<Season>('arm')
  .needs(() => [])
  .execute((args, { world }) => {
    if (args.mode === 'recurring-expiry') {
      world.schedule({ delayMs: MINUTE, everyMs: MINUTE, action: 'expire' });
      return;
    }
    world.schedule({ key: 'heartbeat', delayMs: MINUTE, everyMs: MINUTE, action: 'beat' });
    if (args.mode === 'expiring') {
      world.schedule({ delayMs: MINUTE / 2, action: 'expire' });
      world.schedule({ delayMs: 3 * MINUTE, action: 'beat' });
    }
  });

/** A presence hook, so the clock's own commands can be seen after the end. */
const arrive = worldClockAction<Season>('arrive')
  .needs(() => [LEDGER])
  .execute((_args, { world }) => write(world, 'arrive'));

/** The season's rules; `world` overrides what a later version of them declares. */
function bundle(world: Partial<WorldDefinition> = {}): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Season,
    gameType: 'season',
    displayName: 'Season',
    world: {
      maxPlayers: 1,
      genesis: (game: Game): Record<string, GameElement> => ({ [LEDGER]: game.create(Ledger, 'ledger') }),
      view: () => [LEDGER],
      actions: [note, close, beat, expire, arm, arrive],
      ...world,
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

/** A clock a test moves by hand; `arm` is recorded and never fires by itself. */
function handClock(): WorldHostClock & { set(to: number): void } {
  let now = OPENED;
  return {
    now: () => now,
    arm: () => {},
    yieldTurn: () => new Promise<void>((resolve) => setImmediate(resolve)),
    set(to) {
      now = to;
    },
  };
}

const PLAYER = worldSeatPlayer(1);

/** A world over `store` on `definition`, not yet started. */
function over(store: WorldStore, definition = bundle()) {
  const clock = handClock();
  let minted = 0;
  const world = new ResidentWorld({
    definition,
    seed: 'season',
    budgets: worldBudgets(),
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
  });
  return { world, clock };
}

/** A launched world over `store`, with its one seat taken. */
async function opened(store: WorldStore) {
  const clock = handClock();
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(),
    seed: 'season',
    budgets: worldBudgets(),
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
  });
  await world.start();
  world.seat(PLAYER, 1);
  let orders = 0;
  return {
    world,
    clock,
    take: (action: string) =>
      world.run(() =>
        world.command({ player: PLAYER, order: { id: `order-${++orders}`, at: world.now() }, action }),
      ),
    marks: async () => {
      const stored = await store.read(LEDGER);
      return (stored?.json as { attributes?: { marks?: string } }).attributes?.marks ?? '';
    },
  };
}

/** The refusal a command sent to an ended world must meet. */
async function expectEnded(sent: Promise<unknown>): Promise<void> {
  const refusal = await sent.then(
    () => null,
    (error: unknown) => error,
  );
  expect(refusal).toBeInstanceOf(WorldRefusal);
  expect((refusal as WorldRefusal).code).toBe('world-ended');
  expect((refusal as WorldRefusal).message).toBe(
    "This world's season has ended, so it no longer answers commands.",
  );
}

/** A fresh SQLite store in its own temp tree. */
function sqliteStore(): WorldStore {
  const dir = tempTree('bs-world-ended-');
  return openWorldStore(worldStorePath(dir), worldBudgets());
}

const STORES: ReadonlyArray<readonly [string, () => WorldStore]> = [
  ['the dev host SQLite store', sqliteStore],
  ['the testing memory store', () => createMemoryWorldStore(worldBudgets())],
];

describe.each(STORES)('an ended world, on %s (#395)', (_name, makeStore) => {
  it('refuses every later command with world-ended, and runs none of it', async () => {
    const store = makeStore();
    const { world, take, marks } = await opened(store);
    await take('note');
    await take('close');

    expect(world.completed).toBe(true);
    await expectEnded(take('note'));
    await expectEnded(take('close'));
    expect(await marks()).toBe('note,close');
    await world.close();
  });

  it('empties the queue in the ending, so no event fires and nothing re-arms', async () => {
    const store = makeStore();
    const { world, take, marks } = await opened(store);
    await world.run(() => world.clockCommand('arm', { mode: 'heartbeat' }));
    expect(store.pendingEvents()).toHaveLength(1);

    await take('close');

    // The heartbeat AND the beat the closing command scheduled are both gone.
    expect(store.pendingEvents()).toEqual([]);
    expect(await world.run(() => world.fireDue())).toBeNull();
    expect(await marks()).toBe('close');
    await world.close();
  });

  it('stops a drain at the event that ended it and clears what was queued behind', async () => {
    const store = makeStore();
    const { world, clock, marks } = await opened(store);
    await world.run(() => world.clockCommand('arm', { mode: 'expiring' }));

    // Everything is due: the expiry, the heartbeat's occurrences after it, and
    // a beat after those. Only the expiry may run.
    clock.set(OPENED + 5 * MINUTE);
    await world.run(() => world.fireDue());

    expect(world.completed).toBe(true);
    expect(await marks()).toBe('expire');
    expect(store.pendingEvents()).toEqual([]);
    await world.close();
  });

  it('runs one occurrence of a recurring ending, not every one that is due', async () => {
    const store = makeStore();
    const { world, clock, marks } = await opened(store);
    await world.run(() => world.clockCommand('arm', { mode: 'recurring-expiry' }));

    clock.set(OPENED + 5 * MINUTE);
    await world.run(() => world.fireDue());

    expect(await marks()).toBe('expire');
    expect(store.pendingEvents()).toEqual([]);
    await world.close();
  });

  it("runs none of the clock's own commands, such as a presence hook", async () => {
    const store = makeStore();
    const { world, take, marks } = await opened(store);
    await take('close');

    await world.run(() => world.clockCommand('arrive', {}));

    expect(await marks()).toBe('close');
    await world.close();
  });

  it('still answers views', async () => {
    const store = makeStore();
    const { world, take } = await opened(store);
    await take('close');

    const views = await world.run(() => world.viewsFor([PLAYER]));
    expect(views.failed).toEqual({});
    expect(JSON.stringify(views.bodyFor(PLAYER))).toContain('close');
    await world.close();
  });

  it('refuses to record a second ending', async () => {
    const store = makeStore();
    const { world, take } = await opened(store);
    await take('close');

    await expect(
      store.writeCheckpoint({ partitions: {}, nextElementId: store.nextElementId() ?? 0 }, { endedAt: OPENED }),
    ).rejects.toThrow('This world has already ended');
    await world.close();
  });
});

describe('an ended dev world after a restart (#395)', () => {
  it('is still complete, and still refuses commands', async () => {
    const dir = tempTree('bs-world-ended-restart-');
    const path = worldStorePath(dir);
    const first = await opened(openWorldStore(path, worldBudgets()));
    await first.world.run(() => first.world.clockCommand('arm', { mode: 'heartbeat' }));
    await first.take('close');
    await first.world.close();

    const store = openWorldStore(path, worldBudgets());
    expect(store.endedAt()).toBe(OPENED);
    const second = await opened(store);
    expect(second.world.completed).toBe(true);
    await expectEnded(second.take('note'));
    expect(store.pendingEvents()).toEqual([]);
    expect(await second.marks()).toBe('close');
    await second.world.close();
  });
});

/**
 * #400: AN ENDED WORLD IS NEVER MIGRATED.
 *
 * The platform refuses to move a finished season onto new rules
 * (ShufflewickPub `games/src/world-session.ts`, `#upgradeDoorClosed`): "This
 * world's season has already ended, so there are no rules left for it to run.
 * A finished season keeps the version it played on." It goes on answering
 * views on the rules it ended on. `boardsmith dev` has only the rules in the
 * project, so it cannot keep the old ones beside them: it refuses to open the
 * ended world on rules that declare another state version, with the platform's
 * sentence and what to do instead, and writes nothing.
 */
/**
 * Each store, as something that can be opened again after the world over it is
 * closed: the SQLite file is reopened, as a restarted `boardsmith dev` does, and
 * the memory store is the same object, as a rebuilt host in one test sees it.
 */
const REOPENABLE_STORES: ReadonlyArray<readonly [string, () => () => WorldStore]> = [
  [
    'the dev host SQLite store',
    () => {
      const path = worldStorePath(tempTree('bs-world-ended-400-'));
      return () => openWorldStore(path, worldBudgets());
    },
  ],
  [
    'the testing memory store',
    () => {
      const store = createMemoryWorldStore(worldBudgets());
      return () => store;
    },
  ],
];

describe.each(REOPENABLE_STORES)('an ended world offered a new state version, on %s (#400)', (_name, storeAt) => {
  it('is not migrated, refuses in the platform words, and is left exactly as it ended', async () => {
    const open = storeAt();
    const first = await opened(open());
    await first.take('note');
    await first.take('close');
    await first.world.close();

    let migrationRan = false;
    const store = open();
    const { world } = over(
      store,
      bundle({
        stateVersion: 1,
        migration: {
          from: 0,
          partition: () => {
            migrationRan = true;
          },
        },
      }),
    );
    const refusal = await world.start().then(
      () => null,
      (error: unknown) => error,
    );

    expect(migrationRan, 'the migration ran on an ended world').toBe(false);
    expect(refusal).toBeInstanceOf(WorldRefusal);
    expect((refusal as WorldRefusal).code).toBe('world-ended');
    const message = (refusal as WorldRefusal).message;
    expect(message).toContain(
      "This world's season has already ended, so there are no rules left for it to run. " +
        'A finished season keeps the version it played on.',
    );
    expect(message).toContain('state version 0');
    expect(message).toContain('boardsmith dev --reset');
    expect(store.stateVersion()).toBe(0);
    expect(store.endedAt()).toBe(OPENED);
    const stored = await store.read(LEDGER);
    expect((stored?.json as { attributes?: { marks?: string } }).attributes?.marks).toBe('note,close');
    await world.close();
  });

  it('still opens on rules that declare the version it ended on', async () => {
    const open = storeAt();
    const first = await opened(open());
    await first.take('close');
    await first.world.close();

    const { world } = over(open());
    await expect(world.start()).resolves.toEqual({ migrated: undefined });
    expect(world.completed).toBe(true);
    await world.close();
  });
});
