/**
 * #278: THE CHAIR A WORLD'S CLOCK FREES IS THE HOST'S TO WRITE DOWN.
 *
 * ShufflewickPub #475 built the engine half: a world declares
 * `world.vacateByClock`, that one seatless verb calls `ctx.world.vacate(seat)`,
 * and the engine answers `result.vacated` with the seat and the roster key it
 * resolved for itself. Nothing consumed that answer. `LocalWorldHost` drained
 * the occurrence, committed the game field it changed, settled the event -- and
 * left the roster row exactly where it was, so the chair the teardown had
 * finished emptying was still held by the player who was never coming back.
 *
 * Every case below is that contract, driven through the real host over a real
 * SQLite store:
 *
 * ONE CHECKPOINT OR NONE. The release rides the same write as the effects that
 * prove the ground is back and as the settlement of the occurrence that did it.
 * A checkpoint that refuses leaves the chair HELD and the estate standing --
 * the one pairing that must not come apart, because a chair handed on over an
 * estate still on the ground gives a newcomer somebody else's castle.
 *
 * IT SURVIVES THE HOST. A release that lived only in the resident roster would
 * be undone by the next `boardsmith dev`, which builds its world from the
 * store.
 *
 * A RE-DRAIN FREES ONE CHAIR. The host's own stamp says the chair is already
 * empty, the engine reports no vacancy against it, and the second occurrence is
 * an ordinary dispatch -- so a recurrence that fires again does not corrupt a
 * roster it has already emptied.
 *
 * AND THE PAGE IS TOLD. A dev client watching through that seat is looking at a
 * chair it no longer holds, and a world that took it silently is a browser that
 * quietly stops working.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Game,
  Player,
  Space,
  type ActionDefinition,
  type GameOptions,
  type GameElement,
} from '../../engine/index.js';
import {
  worldAction,
  worldBudgets,
  worldClockAction,
  type WorldBudgets,
  type WorldDefinition,
} from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import type { WorldHostClock } from './node-world-clock.js';
import { LocalWorldHost, devWorldPlayer } from './world-host.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const DAY = 86_400_000;

/**
 * WHAT THE WORLD WRITES DOWN WHEN IT TAKES AN ESTATE.
 *
 * Long enough to be the whole of a tight partition budget, which is what the
 * rollback case needs: a checkpoint that refuses on size is the reachable way
 * to make the host's one write fail AFTER the handler has already run.
 */
const KEEPSAKE = 'x'.repeat(512);

class Estate extends Space<Homestead> {
  /** What this seat still stands on. The teardown's own evidence. */
  holdings = 0;
  /** How many teardown occurrences have committed against this estate. */
  razed = 0;
  /** The world's note of what it took, written by the verb that takes it. */
  keepsake = '';
}

class Homestead extends Game<Homestead, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Estate]);
  }
}

const estate = (seat: number): string => `estate:${seat}`;

/** Ordinary play, so a case can see the chair working before the clock takes
 *  it. */
const build = worldAction<Homestead>('build')
  .prompt('Put something up')
  .needs(({ player }) => [estate(player.seat)])
  .execute((_args, ctx) => {
    (ctx.world.partition(estate(ctx.player.seat)) as Estate).holdings += 1;
  });

/**
 * A SEAT ARMING THE WORLD'S CLOCK AGAINST ITS OWN CHAIR.
 *
 * A RECURRENCE, because a recurrence is how a real teardown ladder re-arms --
 * and it is the reachable way to drain the same occurrence twice, which is what
 * "a retry frees exactly one chair" is asserted over.
 */
const abandon = worldAction<Homestead>('abandon')
  .prompt('Walk away and let the world take it')
  .needs(({ player }) => [estate(player.seat)])
  .execute((_args, ctx) => {
    ctx.world.schedule({
      key: `reap:${ctx.player.seat}`,
      delayMs: DAY,
      everyMs: DAY,
      action: 'reap',
      args: { chair: ctx.player.seat },
    });
  });

/** THE DECLARED VACANCY VERB: the ground comes back, the world writes down what
 *  it took, and the chair is handed on in the same breath. */
const reap = worldClockAction<Homestead>('reap')
  .prompt('Take the estate of whoever stopped playing')
  .about(({ args }) => Number(args.chair))
  .needs(({ args }) => [estate(Number(args.chair))])
  .execute((args, { world }) => {
    const seat = Number(args.chair);
    const held = world.partition(estate(seat)) as Estate;
    held.holdings = 0;
    held.razed += 1;
    held.keepsake = KEEPSAKE;
    world.vacate(seat);
  });

const HOMESTEAD_ACTIONS: readonly ActionDefinition[] = [build, abandon, reap];

function bundle(): ConstructorParameters<typeof LocalWorldHost>[0]['definition'] {
  return {
    gameClass: Homestead,
    gameType: 'homestead',
    displayName: 'Homestead',
    world: {
      maxPlayers: 4,
      genesis: (game: Game) => {
        const roots: Record<string, GameElement> = {};
        for (const seat of [1, 2]) roots[estate(seat)] = game.create(Estate, `estate${seat}`);
        return roots;
      },
      view: (seat: number) => [estate(seat)],
      actions: HOMESTEAD_ACTIONS,
      vacateByClock: 'reap',
    } as WorldDefinition,
  } as ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
}

/** A clock nothing waits on: `arm` records the request, and a case fires it. */
function testClock(): WorldHostClock & { advance(ms: number): void } {
  let now = 1_000_000;
  let armed: { fire: () => void } | null = null;
  return {
    now: () => now,
    arm(delayMs, fire) {
      armed = delayMs === null ? null : { fire };
    },
    yieldTurn: () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }),
    advance(ms) {
      now += ms;
      const pending = armed;
      armed = null;
      pending?.fire();
    },
  };
}

interface Sent {
  clientId: string;
  message: Record<string, unknown>;
}

let orderCounter = 0;
function nextOrder(): { id: string; at: number } {
  orderCounter += 1;
  return { id: `order-${orderCounter}`, at: 0 };
}

let dir: string;
beforeEach(() => {
  dir = tempTree('bs-world-vacancy-');
});

/** A launched world with one client watching through seat 1. */
async function opened(budgets: WorldBudgets = worldBudgets()): Promise<{
  host: LocalWorldHost;
  store: LocalWorldStore;
  sent: Sent[];
  clock: ReturnType<typeof testClock>;
}> {
  const store = openWorldStore(worldStorePath(dir), budgets);
  const sent: Sent[] = [];
  const clock = testClock();
  const host = new LocalWorldHost({
    definition: bundle(),
    worldName: 'Homestead',
    seed: 'seed',
    budgets,
    store,
    clock,
    send: (clientId, message) => sent.push({ clientId, message: message as Record<string, unknown> }),
    // No page in this file ever closes its socket.
    isOpen: () => true,
  });
  await host.start();
  await host.handleMessage('c1', { type: 'hello' });
  return { host, store, sent, clock };
}

async function send(host: LocalWorldHost, action: string): Promise<void> {
  await host.handleMessage('c1', {
    type: 'action',
    order: nextOrder(),
    requestId: `r-${action}-${orderCounter}`,
    action,
    args: {},
  });
}

/** The world as it is ON DISK, read by a store nobody is playing through --
 *  which is the only honest way to ask what a checkpoint wrote. */
function onDisk(): LocalWorldStore {
  return openWorldStore(worldStorePath(dir), worldBudgets());
}

/** One estate's attributes, out of the bytes a checkpoint left behind. */
async function storedEstate(
  store: LocalWorldStore,
  seat: number,
): Promise<{ holdings: number; razed: number }> {
  const stored = await store.read(estate(seat));
  const attributes = (stored?.json as { attributes?: Record<string, number> }).attributes ?? {};
  return { holdings: attributes.holdings ?? 0, razed: attributes.razed ?? 0 };
}

describe('#278: a scheduled vacancy releases the seat it finalized', () => {
  it('writes the release into the same checkpoint as the razing and the settlement', async () => {
    const { host, store, clock } = await opened();

    await send(host, 'build');
    await send(host, 'abandon');
    expect(store.seats()).toEqual([{ player: devWorldPlayer(1), seat: 1 }]);

    clock.advance(DAY);
    await host.settled();

    // THE THREE FACTS OF ONE CHECKPOINT. Two of them held before this ticket:
    // the estate came down and the occurrence was settled. The chair did not.
    expect(await storedEstate(store, 1)).toEqual({ holdings: 0, razed: 1 });
    expect(store.pendingEvents().map((event) => event.due)).toEqual([clock.now() + DAY]);
    expect(store.seats()).toEqual([]);
    await host.close();
  });

  it('answers a point read about the freed chair as empty, so the next holder is a newcomer', async () => {
    const { host, store, clock } = await opened();

    await send(host, 'build');
    await send(host, 'abandon');
    clock.advance(DAY);
    await host.settled();

    // TENANCY IS WHAT A LATER TEARDOWN ASKS, and an emptied chair must answer
    // `empty` -- that answer is the whole of how a retried completion releases
    // exactly once. The watermark goes with the holder: a chair still carrying
    // the last activity of the player who left would report its NEXT occupant
    // as idle since before they arrived, which is an inactivity sweep reaping
    // somebody on their first day.
    expect(store.activityOf(1)).toMatchObject({ seat: 1, at: null, tenancy: 'empty' });
    expect(store.activityOf(2)).toMatchObject({ seat: 2, tenancy: 'empty' });
    await host.close();
  });

  it('keeps the release across a cold reopen, because a host builds its roster from the store', async () => {
    const first = await opened();
    await send(first.host, 'abandon');
    first.clock.advance(DAY);
    await first.host.settled();
    await first.host.close();

    const store = onDisk();
    expect(store.seats()).toEqual([]);
    expect(await storedEstate(store, 1)).toEqual({ holdings: 0, razed: 1 });
    store.close();
  });

  it('frees ONE chair when the same teardown is drained again', async () => {
    const { host, store, clock } = await opened();

    await send(host, 'abandon');
    clock.advance(DAY);
    await host.settled();
    clock.advance(DAY);
    await host.settled();

    // The second occurrence is an ordinary dispatch over an empty chair: it
    // commits, and it releases nothing a second time.
    expect(await storedEstate(store, 1)).toEqual({ holdings: 0, razed: 2 });
    expect(store.seats()).toEqual([]);
    await host.close();
  });

  it('leaves the chair HELD when the checkpoint carrying its release refuses', async () => {
    // A BUDGET THE RAZED ESTATE CANNOT FIT IN. The handler runs, the resident
    // tree changes, and the one write that would make any of it true is
    // refused -- which is the reachable rollback, and the case the release must
    // not be able to escape.
    const { host, store, sent, clock } = await opened(worldBudgets({ partitionMaxBytes: 512 }));

    await send(host, 'build');
    await send(host, 'abandon');
    clock.advance(DAY);
    await host.settled();

    expect(store.seats()).toEqual([{ player: devWorldPlayer(1), seat: 1 }]);
    expect(await storedEstate(store, 1)).toEqual({ holdings: 1, razed: 0 });
    // AND THE OCCURRENCE STAYS QUEUED, said out loud, so the teardown is
    // retried rather than silently abandoned halfway.
    expect(store.pendingEvents()).toHaveLength(1);
    expect(
      sent.some((one) => String(one.message.message ?? '').includes('"reap" refused')),
    ).toBe(true);
    await host.close();
  });

  it('tells the page watching that seat that the world took its chair', async () => {
    const { host, sent, clock } = await opened();

    await send(host, 'abandon');
    const before = sent.length;
    clock.advance(DAY);
    await host.settled();

    const told = sent
      .slice(before)
      .filter((one) => one.clientId === 'c1' && one.message.type === 'world_notice')
      .map((one) => String(one.message.message));
    expect(told.some((message) => message.includes('seat 1'))).toBe(true);
    await host.close();
  });
});
