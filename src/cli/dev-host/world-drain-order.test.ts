/**
 * #280: A DRAIN ARBITRATES AGAINST THE QUEUE IT HAS, NOT THE ONE IT HAD.
 *
 * A world that declares `world.ordering: "chronological"` is promised that its
 * events commit in nominal order. The drain selected the events due at `now`
 * ONCE and then dispatched that list, so an event scheduled by the checkpoint
 * of an earlier member -- due before a later member the list already held --
 * committed AFTER it. Two events at T and T+20, the one at T inserting a third
 * at T+10, committed `0, 20, 10`. A world whose clock is part of its rules
 * reaches a state no punctual world ever reaches, and the only defence was for
 * every game to notice the stale boundary itself and refuse it.
 *
 * The same snapshot made three other things true, and all four are here:
 *
 * AN ENTRY THE PRECEDING CHECKPOINT TOOK BACK STILL FIRED. A cancel or a keyed
 * upsert applied by an earlier member changed the queue, and the drain was no
 * longer reading the queue.
 *
 * SAME-INSTANT ORDER IS INSERTION ORDER, which is the thing re-reading could
 * have broken: `(due, seq)` is the whole of it, and a re-read that lost the
 * sequence would reorder two events scheduled in the same millisecond.
 *
 * AND A DRAIN IS STILL BOUNDED. Re-reading a queue that a handler can add to is
 * exactly how a drain becomes an unbounded loop, so one batch still spends at
 * most `drainBatch` entries and re-arms for the rest.
 *
 * ## Why this file is here and drives `ResidentWorld` directly
 *
 * The drain is `ResidentWorld`'s, but what it re-reads is a STORE, and the
 * store that has to answer is the real one: `openWorldStore`'s SQLite, which
 * lives in this directory with every other test that drives a world over it. A
 * Map would prove the loop and not the read.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import {
  worldBudgets,
  worldClockAction,
  type WorldBudgets,
  type WorldDefinition,
} from '../../world/index.js';
import { ResidentWorld } from '../../world/host/index.js';
import { frozenClock } from './frozen-clock.test-helper.js';
import { openWorldStore, worldStorePath } from './world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

const SECOND = 1000;
/** How far after the arming command the first scheduled event is due. */
const LEAD = 60 * SECOND;
/** How much later than that the second one is due -- the entry the old drain
 *  had already selected. */
const LATE = 20 * SECOND;
/** What the first event schedules when it runs: earlier than `LATE`, and
 *  therefore the one the host used to commit second. */
const INSERT = 10 * SECOND;
/** How far past the last due time the clock is frozen, so every drain below
 *  runs with everything already due and no clock jump to make. */
const FROZEN = 30 * SECOND;
/** Where a replacing upsert puts the timer it displaces: out of reach. */
const FAR = 400 * SECOND;

class Log extends Space<Chronicle> {
  /** What committed, in the order the checkpoints committed it. A string
   *  because the assertion is about ORDER and a string shows it whole. */
  marks = '';
}

class Chronicle extends Game<Chronicle, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Log]);
  }
}

const LOG = 'log';

/**
 * THE ONE CLOCK VERB, and every case arms it differently.
 *
 * It writes down what it is, and then does at most one thing to the queue:
 * schedule another mark, forget a keyed one, or move a keyed one out of reach.
 * Three shapes of "the checkpoint before me changed the queue", in one verb, so
 * a case reads as the queue it arms rather than as a bundle of its own.
 */
const mark = worldClockAction<Chronicle>('mark')
  .needs(() => [LOG])
  .execute((args, { world }) => {
    const log = world.partition(LOG) as Log;
    const label = String(args.label);
    log.marks = log.marks === '' ? label : `${log.marks},${label}`;
    if (args.inserts !== undefined) {
      world.schedule({
        delayMs: Number(args.inserts),
        action: 'mark',
        args: { label: 'inserted' },
      });
    }
    if (args.cancels !== undefined) world.cancel(String(args.cancels));
    if (args.replaces !== undefined) {
      world.schedule({
        key: String(args.replaces),
        delayMs: FAR,
        action: 'mark',
        args: { label: 'replaced' },
      });
    }
  });

/**
 * THE QUEUE A CASE STARTS FROM, armed by the clock so every event below is
 * world-owned -- which is what a cancel and a keyed upsert need, since both are
 * addressed by `(owner, key)` and a clock dispatch is the only owner that can
 * reach another clock dispatch's timer.
 */
const arm = worldClockAction<Chronicle>('arm')
  .needs(() => [])
  .execute((args, { world }) => {
    const mode = String(args.mode);
    if (mode === 'insertion') {
      world.schedule({ delayMs: LEAD, action: 'mark', args: { label: 'early', inserts: INSERT } });
      world.schedule({ delayMs: LEAD + LATE, action: 'mark', args: { label: 'late' } });
      return;
    }
    if (mode === 'cancel' || mode === 'replace') {
      world.schedule({
        delayMs: LEAD,
        action: 'mark',
        args: { label: 'early', [mode === 'cancel' ? 'cancels' : 'replaces']: 'late' },
      });
      world.schedule({ key: 'late', delayMs: LEAD + LATE, action: 'mark', args: { label: 'late' } });
      return;
    }
    if (mode === 'tie') {
      // THREE IN ONE MILLISECOND. Nothing but the insertion sequence orders
      // them, which is the invariant a re-reading drain could lose.
      for (const label of ['first', 'second', 'third']) {
        world.schedule({ delayMs: LEAD, action: 'mark', args: { label } });
      }
      return;
    }
    if (mode === 'crowd') {
      for (let index = 0; index < Number(args.count); index++) {
        world.schedule({
          delayMs: LEAD + index * SECOND,
          action: 'mark',
          args: { label: `m${index}` },
        });
      }
      return;
    }
    throw new Error(`no such arming mode: ${mode}`);
  });

function bundle(): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Chronicle,
    gameType: 'chronicle',
    displayName: 'Chronicle',
    world: {
      maxPlayers: 1,
      // THE DECLARATION THIS TICKET IS ABOUT: this world's clock is part of its
      // rules, so the host owes it nominal order.
      ordering: 'chronological',
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, 'log') }),
      view: () => [LOG],
      actions: [mark, arm],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

const OPENED = 1_700_000_000_000;

let dir: string;
beforeEach(() => {
  dir = tempTree('bs-drain-order-');
});

/** A launched world over its own SQLite store, with nothing queued yet. */
async function opened(budgets: WorldBudgets = worldBudgets()): Promise<{
  world: ResidentWorld;
  clock: ReturnType<typeof frozenClock>;
  marks: () => Promise<string>;
}> {
  const clock = frozenClock(OPENED);
  const store = openWorldStore(worldStorePath(dir), budgets);
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(),
    seed: 'drain-order',
    budgets,
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
  });
  await world.start();
  return {
    world,
    clock,
    marks: async () => {
      const stored = await store.read(LOG);
      const attributes = (stored?.json as { attributes?: Record<string, string> }).attributes ?? {};
      return attributes.marks ?? '';
    },
  };
}

/** Arm a queue, freeze the clock past every event in it, and drain once. */
async function drained(
  mode: string,
  options: { budgets?: WorldBudgets; count?: number } = {},
): Promise<{ world: ResidentWorld; marks: string; jumpMs: number | null }> {
  const { world, clock, marks } = await opened(options.budgets ?? worldBudgets());
  await world.clockCommand('arm', {
    mode,
    ...(options.count === undefined ? {} : { count: options.count }),
  });
  clock.set(OPENED + LEAD + LATE + FROZEN);
  const fired = await world.fireDue();
  return { world, marks: await marks(), jumpMs: fired?.jumpMs ?? null };
}

describe('#280: a chronological drain reads the queue between its own checkpoints', () => {
  it('commits an event an earlier checkpoint inserted BEFORE the later one already selected', async () => {
    const { world, marks, jumpMs } = await drained('insertion');

    // The whole of the ticket: `early, inserted, late` and not `early, late,
    // inserted`. Nothing was fabricated to get it -- the clock was already past
    // everything, so the firing moved it by nothing at all.
    expect(marks).toBe('early,inserted,late');
    expect(jumpMs).toBe(0);
    await world.close();
  });

  it('does NOT fire an entry the preceding checkpoint cancelled', async () => {
    const { world, marks } = await drained('cancel');

    expect(marks).toBe('early');
    await world.close();
  });

  it('does NOT fire an entry the preceding checkpoint displaced with a keyed upsert', async () => {
    const { world, marks } = await drained('replace');

    // The displaced timer is out at `FAR`, so what must not be in the log is
    // the occurrence the snapshot was still holding.
    expect(marks).toBe('early');
    await world.close();
  });

  it('keeps insertion order among events due in the same millisecond', async () => {
    const { world, marks } = await drained('tie');

    expect(marks).toBe('first,second,third');
    await world.close();
  });

  it('spends at most one batch and re-arms for the rest, so a re-read is not a loop', async () => {
    // Five due, a batch of two: the drain must stop at two rather than keep
    // re-reading a queue that is still answering with due work.
    const { world, marks } = await drained('crowd', {
      budgets: worldBudgets({ drainBatch: 2 }),
      count: 5,
    });

    expect(marks).toBe('m0,m1');
    await world.close();
  });
});
