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
      maxPlayers: 2,
      ordering,
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, LOG) }),
      view: () => {
        if (viewThrows) throw viewThrows;
        return [LOG];
      },
      actions: [boom, tick, arm, stamp, poke],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

function host(options: {
  ordering?: 'arrival' | 'chronological';
  clock?: WorldHostClock;
  store?: ReturnType<typeof createMemoryWorldStore>;
  onNotice?: (message: string) => void;
} = {}) {
  const budgets = worldBudgets();
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
      devThrow.enabled = false;
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
