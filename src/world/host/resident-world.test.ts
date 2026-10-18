/**
 * #793: SMALLER DEFECTS IN THE LIBRARY'S OWN WORLD HOST.
 *
 * Each case drives `ResidentWorld` over the memory store with a hand-moved
 * clock, so what is asserted is what the host did, not how long it took.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Game, Player, PlayerFacingError, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, worldClockAction, type WorldDefinition } from '../index.js';
import { ResidentWorld, worldSeatPlayer, type WorldHostClock } from './index.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';

// Production's answer, where a raw throw's text never reaches a player.
const devThrow = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevThrowEnabled: () => devThrow.enabled };
});

const OPENED = 1_700_000_000_000;
const MINUTE = 60_000;
const LOG = 'log';

class Log extends Space<Ticker> {
  marks = '';
}

class Ticker extends Game<Ticker, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Log]);
  }
}

/** What the clock-issued `stamp` saw: its due and its `world.now`. */
let stamped: { due: number; now: number } | undefined;
/** What `world.view` throws, when it throws. */
let viewThrows: Error | undefined;

const mark = (text: string) => (_args: unknown, { world }: { world: { partition(name: string): unknown } }) => {
  const log = world.partition(LOG) as Log;
  log.marks += text;
};

const boom = worldClockAction<Ticker>('boom')
  .needs(() => [LOG])
  .execute(() => {
    throw new Error('refused on purpose');
  });
const fizz = worldClockAction<Ticker>('fizz')
  .prompt('the harvest festival')
  .needs(() => [LOG])
  .execute(() => {
    throw new Error('refused on purpose');
  });
const armFizz = worldClockAction<Ticker>('armFizz')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ delayMs: MINUTE, action: 'fizz' });
  });
const tick = worldClockAction<Ticker>('tick').needs(() => [LOG]).execute(mark('t'));
const arm = worldClockAction<Ticker>('arm')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ delayMs: MINUTE, action: 'boom' });
    world.schedule({ delayMs: 2 * MINUTE, action: 'tick' });
  });
const stamp = worldClockAction<Ticker>('stamp')
  .needs(() => [])
  .execute((_args, { world }) => {
    stamped = { due: world.timing!.due, now: world.now };
    world.schedule({ delayMs: MINUTE, action: 'tick' });
  });
const poke = worldAction<Ticker>('poke').needs(() => [LOG]).execute(mark('p'));

function bundle(ordering: 'arrival' | 'chronological' = 'arrival') {
  return {
    gameClass: Ticker,
    gameType: 'ticker',
    displayName: 'Ticker',
    world: {
      maxPlayers: 3,
      ordering,
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, LOG) }),
      view: () => {
        if (viewThrows) throw viewThrows;
        return [LOG];
      },
      actions: [boom, fizz, armFizz, tick, arm, stamp, poke],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

function host(options: {
  ordering?: 'arrival' | 'chronological';
  clock?: WorldHostClock;
  store?: ReturnType<typeof createMemoryWorldStore>;
  onNotice?: (message: string) => void;
  budgets?: ReturnType<typeof worldBudgets>;
} = {}) {
  const budgets = options.budgets ?? worldBudgets();
  let now = OPENED;
  const clock = options.clock ?? {
    now: () => now,
    arm: () => {},
    yieldTurn: () => Promise.resolve(),
  };
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(options.ordering),
    seed: 'resident-world-793',
    budgets,
    store: options.store ?? createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets),
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
    ...(options.onNotice ? { onNotice: options.onNotice } : {}),
  });
  return { world, advance: (ms: number) => (now += ms) };
}

afterEach(() => {
  stamped = undefined;
  viewThrows = undefined;
  devThrow.enabled = true;
  vi.restoreAllMocks();
});

describe('#793: ResidentWorld', () => {
  it('closes the store even when the final checkpoint throws', async () => {
    const budgets = worldBudgets();
    const memory = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, budgets);
    let failing = false;
    const close = vi.fn(memory.close);
    const store = {
      ...memory,
      close,
      dirtyPartitions: () => (failing ? [LOG] : memory.dirtyPartitions()),
      writeCheckpoint: (...args: Parameters<typeof memory.writeCheckpoint>) => {
        if (failing) throw new Error('disk full');
        return memory.writeCheckpoint(...args);
      },
    };
    const { world } = host({ store });
    await world.start();
    world.seat(worldSeatPlayer(1), 1);
    await world.run(() =>
      world.command({ player: worldSeatPlayer(1), order: { id: 'o1', at: OPENED }, action: 'poke', args: {} }),
    );

    failing = true;
    await expect(world.close()).rejects.toThrow('disk full');
    expect(close).toHaveBeenCalledOnce();
  });

  it('says a refusing event refused once per catch-up, not once per round', async () => {
    const notices: string[] = [];
    const { world, advance } = host({ ordering: 'chronological', onNotice: (m) => notices.push(m) });
    await world.start();
    world.seat(worldSeatPlayer(1), 1);
    await world.clockCommand('arm', {});
    advance(3 * MINUTE);

    await expect(
      world.run(() =>
        world.command({ player: worldSeatPlayer(1), order: { id: 'o1', at: OPENED }, action: 'poke', args: {} }),
      ),
    ).rejects.toMatchObject({ code: 'world-catching-up' });
    expect(notices.filter((m) => m.includes('"boom" refused'))).toHaveLength(1);
  });

  it('names the stuck event when a due event that refuses is what the world is behind on (#939)', async () => {
    const { world, advance } = host({ ordering: 'chronological' });
    await world.start();
    world.seat(worldSeatPlayer(1), 1);
    await world.clockCommand('arm', {});
    advance(3 * MINUTE);

    const refusal: unknown = await world
      .run(() =>
        world.command({ player: worldSeatPlayer(1), order: { id: 'o1', at: OPENED }, action: 'poke', args: {} }),
      )
      .catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: 'world-catching-up', message: expect.stringContaining('"boom"') });
    expect((refusal as Error).message).not.toMatch(/in a moment/);
    // Nothing is kept, so the player must be told to resend.
    expect((refusal as Error).message).toMatch(/send your command again/);
    // The game's own error text is for the author's notice, not the player.
    expect((refusal as Error).message).not.toContain('refused on purpose');
  });

  it('names the stuck event by its declared prompt when it has one (#1175)', async () => {
    const { world, advance } = host({ ordering: 'chronological' });
    await world.start();
    world.seat(worldSeatPlayer(1), 1);
    await world.clockCommand('armFizz', {});
    advance(3 * MINUTE);

    const refusal = world.run(() =>
      world.command({ player: worldSeatPlayer(1), order: { id: 'o1', at: OPENED }, action: 'poke', args: {} }),
    );
    await expect(refusal).rejects.toMatchObject({ code: 'world-catching-up' });
    const message = (await refusal.catch((error: Error) => error)).message;
    expect(message).toContain('"the harvest festival"');
    expect(message).not.toContain('"fizz"');
  });

  it('still says "in a moment" when the world is only catching up (#939)', async () => {
    const { world, advance } = host({
      ordering: 'chronological',
      budgets: worldBudgets({ drainBatch: 1, catchUpRounds: 1 }),
    });
    await world.start();
    world.seat(worldSeatPlayer(1), 1);
    await world.clockCommand('stamp', {});
    await world.clockCommand('stamp', {});
    advance(3 * MINUTE);

    await expect(
      world.run(() =>
        world.command({ player: worldSeatPlayer(1), order: { id: 'o1', at: OPENED }, action: 'poke', args: {} }),
      ),
    ).rejects.toMatchObject({ code: 'world-catching-up', message: expect.stringMatching(/in a moment/) });
  });

  it('plans a clock-issued command\'s schedules from the instant its handler was told', async () => {
    // A clock that moves on every read, so a second read is visible.
    let now = OPENED;
    const store = createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, worldBudgets());
    const { world } = host({ store, clock: { now: () => (now += 1), arm: () => {}, yieldTurn: () => Promise.resolve() } });
    await world.start();

    await world.clockCommand('stamp', {});
    expect(stamped!.now).toBe(stamped!.due);
    expect(store.pendingEvents().map((event) => event.due)).toEqual([stamped!.now + MINUTE]);
  });

  describe('a view that throws', () => {
    it('does not hand the game\'s raw error text to the player', async () => {
      // Even in development: the world reads no environment (#165), so the detail is only ever logged (#982).
      devThrow.enabled = true;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { world } = host();
      await world.start();
      world.seat(worldSeatPlayer(1), 1);
      viewThrows = new TypeError("Cannot read properties of undefined (reading 'secret')");

      const views = await world.run(() => world.viewsFor([worldSeatPlayer(1)]));
      const failure = views.failed[worldSeatPlayer(1)];
      expect(failure).toBeDefined();
      expect(failure!.message).not.toContain('secret');
      expect(failure!.message).toMatch(/error in the game's rules/);
    });

    it('logs once for the whole audience, with how many seats failed, not once per seat', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { world } = host();
      await world.start();
      const seats = [1, 2, 3].map((seat) => worldSeatPlayer(seat));
      seats.forEach((player, i) => world.seat(player, i + 1));
      viewThrows = new TypeError('broken view');

      const views = await world.run(() => world.viewsFor(seats));
      expect(Object.keys(views.failed)).toHaveLength(3);
      expect(logged).toHaveBeenCalledOnce();
      expect(String(logged.mock.calls[0]![0])).toContain('3 seats');
    });

    it('passes a PlayerFacingError the game wrote through verbatim', async () => {
      const { world } = host();
      await world.start();
      world.seat(worldSeatPlayer(1), 1);
      viewThrows = new PlayerFacingError('The fog hides the valley today.');

      const views = await world.run(() => world.viewsFor([worldSeatPlayer(1)]));
      expect(views.failed[worldSeatPlayer(1)]?.message).toBe('The fog hides the valley today.');
    });
  });
});
