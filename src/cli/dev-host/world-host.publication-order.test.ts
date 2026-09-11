/**
 * #244: A COMMITTED VIEW IS PUBLISHED BEFORE THE OFFERS THAT FOLLOW IT.
 *
 * The projection a world has already computed is authoritative the moment it
 * exists. Action-offer enumeration is a SEPARATE and unbounded cost -- it walks
 * every offerable action's declaration, hydrates whatever those name, and
 * evaluates every candidate of every selection -- and a host that held the
 * finished projection behind it made the browser wait on work the projection
 * does not depend on. The reported world measured 5,351ms between "taken" and
 * the state reaching the screen, with nothing wrong but the order.
 *
 * So the two are two frames. `world_state` carries the committed projection and
 * goes to every watcher first; `world_offers` follows, carrying the REVISION it
 * was enumerated over so an offer can never be read as proof that an action is
 * still legal against a state that has since moved.
 *
 * The deferral here is the real one and not a stub: a world whose actions
 * declare a partition per seat, over a store whose read of one seat's ledger is
 * held open. That is exactly the shape the report came from -- offers hydrate
 * what the view did not name -- and it blocks in the one place the host
 * actually awaits.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Game,
  Player,
  Space,
  type ActionDefinition,
  type GameElement,
  type GameOptions,
} from '../../engine/index.js';
import {
  worldAction,
  worldBudgets,
  type StoredPartition,
  type WorldDefinition,
} from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import type { WorldDevClock } from './node-world-clock.js';
import { LocalWorldHost } from './world-host.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

// ── A hamlet whose actions read a partition the view never names ────────────

class Hearth extends Space<Hamlet> {
  logs = 0;
}

/** One seat's own book. The VIEW does not name it; the action does, which is
 *  what makes an offer cost a storage read the projection never pays. */
class Ledger extends Space<Hamlet> {
  entries = 0;
}

class Hamlet extends Game<Hamlet, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Hearth, Ledger]);
  }
}

const HEARTH = 'hearth';
const SEATS = [1, 2, 3, 4] as const;
const ledgerOf = (seat: number): string => `ledger-${seat}`;

const tally = worldAction<Hamlet>('tally')
  .prompt('Write a line in your own book')
  .needs(({ player }) => [ledgerOf(player.seat)])
  .execute((_args, ctx) => {
    (ctx.world.partition(ledgerOf(ctx.player.seat)) as Ledger).entries += 1;
  });

const HAMLET_ACTIONS: readonly ActionDefinition[] = [tally];

function hamletBlock(): WorldDefinition {
  return {
    maxPlayers: 4,
    genesis: (game) => ({
      [HEARTH]: game.create(Hearth, 'hearth') as GameElement,
      ...Object.fromEntries(
        SEATS.map((seat) => [ledgerOf(seat), game.create(Ledger, ledgerOf(seat)) as GameElement]),
      ),
    }),
    view: () => [HEARTH],
    actions: HAMLET_ACTIONS,
  } as WorldDefinition;
}

function bundle(): ConstructorParameters<typeof LocalWorldHost>[0]['definition'] {
  return {
    gameClass: Hamlet,
    gameType: 'hamlet',
    displayName: 'Hamlet',
    world: hamletBlock(),
  } as ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
}

/** A clock nothing waits on, as `world-host.test.ts` uses. */
function testClock(): WorldDevClock {
  let now = 1_000_000;
  return {
    now: () => now,
    arm(delayMs) {
      if (delayMs !== null) now += 0;
    },
  };
}

// ── A store whose read of one named partition can be held open ──────────────

interface GatedStore {
  readonly store: LocalWorldStore;
  /** Hold every later read of this partition until `release` is called. */
  hold(name: string): void;
  release(name: string): void;
}

function gated(store: LocalWorldStore): GatedStore {
  const held = new Map<string, { wait: Promise<void>; open: () => void }>();
  const wrapped: LocalWorldStore = {
    ...store,
    async read(name: string): Promise<StoredPartition | undefined> {
      await held.get(name)?.wait;
      return store.read(name);
    },
  };
  return {
    store: wrapped,
    hold(name) {
      let open = (): void => {};
      const wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      held.set(name, { wait, open });
    },
    release(name) {
      const gate = held.get(name);
      held.delete(name);
      gate?.open();
    },
  };
}

/**
 * EVERYTHING THAT CAN PROCEED, PROCEEDS.
 *
 * The gate above is an unresolved promise, so a chain that reaches it stops
 * there and every frame the host was going to send before it has been sent.
 * Several turns of the macrotask queue, because the host's own work is a chain
 * of awaits over SQLite reads rather than a single tick.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
}

interface Sent {
  clientId: string;
  message: Record<string, unknown>;
}

function openHost(dir: string): {
  host: LocalWorldHost;
  sent: Sent[];
  gate: GatedStore;
} {
  const budgets = worldBudgets();
  const gate = gated(openWorldStore(worldStorePath(dir), budgets));
  const sent: Sent[] = [];
  const host = new LocalWorldHost({
    definition: bundle(),
    worldName: 'Hamlet',
    seed: 'seed',
    budgets,
    store: gate.store,
    clock: testClock(),
    send: (clientId, message) => sent.push({ clientId, message: message as Record<string, unknown> }),
  });
  return { host, sent, gate };
}

function framesOf(sent: readonly Sent[], clientId: string, type: string): Record<string, unknown>[] {
  return sent.filter((s) => s.clientId === clientId && s.message.type === type).map((s) => s.message);
}

function last(sent: readonly Sent[], clientId: string, type: string): Record<string, unknown> | undefined {
  return framesOf(sent, clientId, type).at(-1);
}

/**
 * A LAUNCHED WORLD NOBODY IS HOLDING.
 *
 * Genesis leaves everything it built RESIDENT, so a host that has just run it
 * would answer every offer out of memory and read nothing. A world is only
 * honest about what an offer costs once it has been closed and reopened --
 * which is also the state every world on the platform is in, since a host that
 * wakes holds nothing until something names it.
 */
async function launchedAndClosed(dir: string): Promise<void> {
  const opened = openHost(dir);
  await opened.host.start();
  await opened.host.close();
}

let dir: string;
beforeEach(async () => {
  dir = tempTree('bs-world-publication-');
  await launchedAndClosed(dir);
});

describe('#244: the committed projection does not wait on action-offer enumeration', () => {
  it('reaches every watcher while one seat\'s offers are still blocked', async () => {
    const { host, sent, gate } = openHost(dir);
    await host.start();
    // Two watchers, each on its own seat, both already offered: seat 1's and
    // seat 2's books are resident, so neither of their offers reads anything.
    await host.handleMessage('c1', { type: 'hello' });
    await host.handleMessage('c2', { type: 'attach', seat: 2 });
    const mark = sent.length;

    // Seat 3's book has never been read, so the offer road must hydrate it --
    // and it cannot. This is the only slow thing in the push.
    gate.hold(ledgerOf(3));
    let finished = false;
    const switching = host.handleMessage('c1', { type: 'attach', seat: 3 }).then(() => {
      finished = true;
    });
    await settle();

    // THE DEFERRAL IS REAL, asserted rather than assumed: if the push had run
    // to the end the ordering below would be proving nothing at all.
    expect(finished).toBe(false);
    const held = sent.slice(mark);
    // THE PROJECTION IS ALREADY COMPUTED, so both watchers have it. c2's seat
    // has nothing to do with seat 3's book; before #244 it waited on it anyway.
    expect(framesOf(held, 'c1', 'world_state')).toHaveLength(1);
    expect(framesOf(held, 'c2', 'world_state')).toHaveLength(1);
    // AND THE OFFERS HAVE NOT BEEN SENT, which is the whole point: they are the
    // work being waited on, and the view did not wait for it.
    expect(framesOf(held, 'c1', 'world_offers')).toHaveLength(0);

    gate.release(ledgerOf(3));
    await switching;

    // WHAT AN OFFER IS ABOUT IS ON THE OFFER. A frame that named no state could
    // not be told from one enumerated over a state that has since moved, and a
    // page holding it would be holding a permission nobody re-checked.
    for (const clientId of ['c1', 'c2']) {
      const state = last(sent, clientId, 'world_state');
      const offers = last(sent, clientId, 'world_offers');
      expect(offers).toBeDefined();
      expect(typeof state?.revision).toBe('number');
      expect(offers?.revision).toBe(state?.revision);
    }
    expect((last(sent, 'c1', 'world_offers')?.actions as Array<{ name: string }>).map((o) => o.name))
      .toEqual(['tally']);

    await host.close();
  });

  it('moves the revision when the world commits, so an earlier offer cannot answer for it', async () => {
    const { host, sent } = openHost(dir);
    await host.start();
    await host.handleMessage('c1', { type: 'hello' });

    const before = last(sent, 'c1', 'world_state')?.revision as number;
    const offeredBefore = last(sent, 'c1', 'world_offers')?.revision as number;
    expect(offeredBefore).toBe(before);

    await host.handleMessage('c1', {
      type: 'action',
      order: { id: 'order-1', at: 0 },
      requestId: 'r1',
      action: 'tally',
      args: {},
    });

    const after = last(sent, 'c1', 'world_state')?.revision as number;
    // A COMMITTED COMMAND IS A NEW STATE. The offers enumerated over the old
    // one are stamped with the old number and can therefore be recognised as
    // being about a world that no longer exists.
    expect(after).toBeGreaterThan(before);
    expect(last(sent, 'c1', 'world_offers')?.revision).toBe(after);

    await host.close();
  });
});
