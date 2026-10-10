/**
 * #583: A RECURRENCE WHOSE HANDLER RE-ARMS OR CANCELS ITS OWN KEY IS NOT
 * RE-ARMED BY THE HOST.
 *
 * The host re-arms a recurrence in the same write that settles the occurrence
 * it ran. When the handler itself upserted or cancelled the recurrence's own
 * key, that automatic re-arm used to land anyway: an upsert left two events
 * under one key, and a cancel was ignored. The handler's explicit request wins.
 *
 * Driven through `ResidentWorld` over the real SQLite store, because what has
 * to be right is what the queue holds once the checkpoint has landed.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import {
  WORLD_OWNER,
  worldAction,
  worldBudgets,
  worldClockAction,
  type WorldDefinition,
} from '../../world/index.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { ResidentWorld, worldSeatPlayer } from '../../world/host/index.js';
import { frozenClock } from './frozen-clock.test-helper.js';
import { openWorldStore, worldStorePath } from './world-store.js';

const MINUTE = 60_000;
const OPENED = 1_700_000_000_000;
const LOG = 'log';

class Log extends Space<Ticker> {
  /** Every occurrence that committed, as `<due>m`. */
  marks = '';
}

class Ticker extends Game<Ticker, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Log]);
  }
}

/** What the tick's handler asks of the schedule on each occurrence. */
let mode: 'upsert-own' | 'cancel-own' | 'other-key' = 'upsert-own';

const tick = worldClockAction<Ticker>('tick')
  .needs(() => [LOG])
  .execute((_args, { world }) => {
    const log = world.partition(LOG) as Log;
    const mark = `${(world.timing!.due - OPENED) / MINUTE}m`;
    log.marks = log.marks === '' ? mark : `${log.marks},${mark}`;
    if (mode === 'upsert-own') {
      world.schedule({ key: 'tick', delayMs: 5 * MINUTE, everyMs: 5 * MINUTE, action: 'tick' });
    } else if (mode === 'cancel-own') {
      world.cancel('tick');
    } else {
      world.schedule({ key: 'other', delayMs: 10 * MINUTE, action: 'noop' });
    }
  });

const noop = worldClockAction<Ticker>('noop')
  .needs(() => [])
  .execute(() => {});

const arm = worldClockAction<Ticker>('arm')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ key: 'tick', delayMs: MINUTE, everyMs: MINUTE, action: 'tick' });
  });

/** The same recurrence armed by a seat's own command, so the seat owns it. */
const armBySeat = worldAction<Ticker>('armBySeat')
  .prompt('Start the tick')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ key: 'tick', delayMs: MINUTE, everyMs: MINUTE, action: 'tick' });
  });

const PLAYER = worldSeatPlayer(1);

function bundle(): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Ticker,
    gameType: 'ticker',
    displayName: 'Ticker',
    world: {
      maxPlayers: 1,
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, LOG) }),
      view: () => [LOG],
      actions: [tick, noop, arm, armBySeat],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

let dir: string;
beforeEach(() => {
  dir = tempTree('bs-recurrence-own-key-');
});

/** A world with the tick armed -- by the clock, or by a seat's command -- and
 *  its clock frozen `minutes` and a half after launch, so occurrences
 *  1m..<minutes>m are due. */
async function behindBy(minutes: number, armedBy: 'world' | 'seat' = 'world') {
  const clock = frozenClock(OPENED);
  const budgets = worldBudgets();
  const store = openWorldStore(worldStorePath(dir), budgets);
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(),
    seed: 'recurrence-own-key',
    budgets,
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
    onNotice: () => {},
  });
  await world.start();
  if (armedBy === 'world') {
    await world.clockCommand('arm', {});
  } else {
    world.seat(PLAYER, 1);
    await world.run(() =>
      world.command({ player: PLAYER, order: { id: 'order-1', at: world.now() }, action: 'armBySeat' }),
    );
  }
  clock.set(OPENED + minutes * MINUTE + MINUTE / 2);
  /** One wake of the clock, and what it left: the log, and the queue as
   *  `<owner>:<key>@<due>m/<every>m`, the owner being `world` or `seat`. */
  const wake = async () => {
    await world.fireDue();
    const stored = await store.read(LOG);
    const attributes = (stored?.json as { attributes?: Record<string, string> }).attributes ?? {};
    return {
      marks: attributes.marks ?? '',
      queued: store
        .pendingEvents()
        .map(
          (event) =>
            `${event.owner === WORLD_OWNER ? 'world' : 'seat'}:${event.key}@${(event.due - OPENED) / MINUTE}m` +
            (event.everyMs === undefined ? '' : `/${event.everyMs / MINUTE}m`),
        )
        .sort(),
    };
  };
  return { world, wake };
}

describe("#583: a recurrence's handler decides what happens to its own key", () => {
  it("a handler that upserts its own key leaves ONE event under it, on the handler's schedule", async () => {
    mode = 'upsert-own';
    const { world, wake } = await behindBy(1);
    expect(await wake()).toEqual({ marks: '1m', queued: ['world:tick@6m/5m'] });
    await world.close();
  });

  it('a self-upsert during a catch-up stops the occurrences still owed', async () => {
    mode = 'upsert-own';
    const { world, wake } = await behindBy(4);
    expect(await wake()).toEqual({ marks: '1m', queued: ['world:tick@6m/5m'] });
    await world.close();
  });

  it('a handler that cancels its own key leaves nothing queued', async () => {
    mode = 'cancel-own';
    const { world, wake } = await behindBy(1);
    expect(await wake()).toEqual({ marks: '1m', queued: [] });
    await world.close();
  });

  it('a self-cancel during a catch-up stops the occurrences still owed', async () => {
    mode = 'cancel-own';
    const { world, wake } = await behindBy(4);
    expect(await wake()).toEqual({ marks: '1m', queued: [] });
    await world.close();
  });

  it('a handler that schedules a DIFFERENT key still gets the automatic re-arm', async () => {
    mode = 'other-key';
    const { world, wake } = await behindBy(1);
    expect(await wake()).toEqual({ marks: '1m', queued: ['world:other@11m', 'world:tick@2m/1m'] });
    await world.close();
  });
});

describe('#583: a recurrence a SEAT armed is not its handler\'s own key', () => {
  // The handler runs as the clock, so its schedules belong to the world: the
  // key it names is (world, tick), and the seat's (seat, tick) is untouched.
  it('a cancel from the handler leaves the seat-owned tick re-arming', async () => {
    mode = 'cancel-own';
    const { world, wake } = await behindBy(1, 'seat');
    expect(await wake()).toEqual({ marks: '1m', queued: ['seat:tick@2m/1m'] });
    await world.close();
  });

  it('an upsert from the handler adds a world-owned tick beside the re-armed seat one', async () => {
    mode = 'upsert-own';
    const { world, wake } = await behindBy(1, 'seat');
    expect(await wake()).toEqual({ marks: '1m', queued: ['seat:tick@2m/1m', 'world:tick@6m/5m'] });
    await world.close();
  });
});
