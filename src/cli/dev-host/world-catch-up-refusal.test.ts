/**
 * #538: A REFUSED CATCH-UP RESUMES AT THE OCCURRENCE THAT REFUSED.
 *
 * A recurrence that fell behind is run as several occurrences in one wake, and
 * each one's checkpoint makes it durable on its own. The queue used to move
 * only with the LAST occurrence, so when a later one refused, the event stayed
 * queued at its original due and the next wake ran the earlier occurrences a
 * second time on top of state that already held them -- every wake, for ever,
 * when the refusal was persistent.
 *
 * Driven through `ResidentWorld` over the real SQLite store, because what has
 * to be right is what the queue holds once each checkpoint has landed.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import {
  worldBudgets,
  worldClockAction,
  type WorldBudgets,
  type WorldDefinition,
} from '../../world/index.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { ResidentWorld } from '../../world/host/index.js';
import { frozenClock } from './frozen-clock.test-helper.js';
import { openWorldStore, worldStorePath } from './world-store.js';

const MINUTE = 60_000;
const OPENED = 1_700_000_000_000;
const LOG = 'log';

class Log extends Space<Ticker> {
  /** Every occurrence that committed, as `<due>m`, plus `+<missed>` on a
   *  coalesced call. A string, because the assertion is about what ran how
   *  often and in what order. */
  marks = '';
}

class Ticker extends Game<Ticker, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Log]);
  }
}

/** Which handler calls refuse, counted from 1 across the whole case. */
let refuseOn: (call: number, due: string) => boolean = () => false;
let calls = 0;

const tick = worldClockAction<Ticker>('tick')
  .needs(() => [LOG])
  .execute((_args, { world }) => {
    calls += 1;
    const due = `${(world.timing!.due - OPENED) / MINUTE}m`;
    if (refuseOn(calls, due)) throw new Error('refused on purpose');
    const missed = world.timing!.missedCount;
    const mark = missed === 0 ? due : `${due}+${missed}`;
    const log = world.partition(LOG) as Log;
    log.marks = log.marks === '' ? mark : `${log.marks},${mark}`;
  });

const arm = worldClockAction<Ticker>('arm')
  .needs(() => [])
  .execute((_args, { world }) => {
    world.schedule({ key: 'tick', delayMs: MINUTE, everyMs: MINUTE, action: 'tick' });
  });

function bundle(): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Ticker,
    gameType: 'ticker',
    displayName: 'Ticker',
    world: {
      maxPlayers: 1,
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, LOG) }),
      view: () => [LOG],
      actions: [tick, arm],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

let dir: string;
beforeEach(() => {
  dir = tempTree('bs-catch-up-refusal-');
  calls = 0;
  refuseOn = () => false;
});

/** A world with the tick armed, its clock frozen `minutes` and a half after
 *  launch, so occurrences 1m..<minutes>m are due. */
async function behindBy(minutes: number, budgets: WorldBudgets = worldBudgets()) {
  const clock = frozenClock(OPENED);
  const store = openWorldStore(worldStorePath(dir), budgets);
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(),
    seed: 'catch-up-refusal',
    budgets,
    store,
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
    onNotice: () => {},
  });
  await world.start();
  await world.clockCommand('arm', {});
  clock.set(OPENED + minutes * MINUTE + MINUTE / 2);
  /** One wake of the clock, and what it left: the log, and where the queue
   *  holds the tick. */
  const wake = async () => {
    await world.fireDue();
    const stored = await store.read(LOG);
    const attributes = (stored?.json as { attributes?: Record<string, string> }).attributes ?? {};
    return {
      marks: attributes.marks ?? '',
      queued: store.pendingEvents().map((event) => `${(event.due - OPENED) / MINUTE}m`),
    };
  };
  return { world, wake };
}

describe('#538: a refused catch-up resumes at the occurrence that refused', () => {
  it('applies every occurrence once when a later one refuses once', async () => {
    const { world, wake } = await behindBy(4);
    refuseOn = (call) => call === 3;

    expect(await wake()).toEqual({ marks: '1m,2m', queued: ['3m'] });
    expect(await wake()).toEqual({ marks: '1m,2m,3m,4m', queued: ['5m'] });
    await world.close();
  });

  it('never re-applies the earlier occurrences while a later one keeps refusing', async () => {
    const { world, wake } = await behindBy(4);
    refuseOn = (_call, due) => due === '3m';

    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await wake()).toEqual({ marks: '1m,2m', queued: ['3m'] });
    }
    await world.close();
  });

  it('keeps the event where it was when the FIRST occurrence refuses', async () => {
    const { world, wake } = await behindBy(4);
    refuseOn = (call) => call === 1;

    expect(await wake()).toEqual({ marks: '', queued: ['1m'] });
    expect(await wake()).toEqual({ marks: '1m,2m,3m,4m', queued: ['5m'] });
    await world.close();
  });

  it('keeps the fold when the coalesced call refuses (ShufflewickPub #155)', async () => {
    // Two real iterations, then one call standing for 3m, 4m and 5m.
    const { world, wake } = await behindBy(5, worldBudgets({ catchUpMaxRealIterations: 2 }));
    refuseOn = (_call, due) => due === '5m' && calls === 3;

    // Resumed at the FIRST occurrence the coalesced call stood for, so the
    // occurrences it carried are still owed rather than erased.
    expect(await wake()).toEqual({ marks: '1m,2m', queued: ['3m'] });
    expect(await wake()).toEqual({ marks: '1m,2m,3m,4m,5m', queued: ['6m'] });
    await world.close();
  });
});
