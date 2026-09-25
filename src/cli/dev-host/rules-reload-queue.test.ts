/**
 * #379: WHAT A PAGE SENDS WHILE A SAVED RULES FILE IS STILL REBUILDING.
 *
 * The queue itself, with the rules and the host stood in by plain values. The
 * two roads drive it with real bundles and real sockets in
 * `multiplayer-host.rules-reload.test.ts` and `world-rules-reload.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorldHostClock } from './node-world-clock.js';
import { createRulesReloadQueue, heldClock, type RulesReloadNotice } from './rules-reload-queue.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** A promise and the function that settles it. */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A queue over a host whose rules are a version number, and a log of what happened, in order. */
function queueOver(load: () => Promise<number>) {
  const events: string[] = [];
  const notices: RulesReloadNotice[] = [];
  let rules = 1;
  const queue = createRulesReloadQueue<number>({
    what: 'table',
    load,
    adopt: async (next) => {
      rules = next;
      events.push(`adopt ${next}`);
    },
    tell: (notice) => notices.push(notice),
  });
  /** A message that runs the rules, logging the version it ran on. */
  const move = (name: string) => ({
    run: async () => {
      events.push(`${name} on ${rules}`);
    },
    refuse: (message: string) => events.push(`${name} refused: ${message}`),
  });
  /** A message that only reads, logging the version it read. */
  const read = (name: string) => ({
    run: async () => {
      events.push(`${name} read ${rules}`);
    },
  });
  return { queue, events, notices, move, read };
}

describe('#379: a message sent while the rules are rebuilding', () => {
  it('runs at once when no reload is pending', async () => {
    const { queue, events, notices, move } = queueOver(async () => 2);
    await queue.admit(move('bump'));
    expect(events).toEqual(['bump on 1']);
    expect(notices).toEqual([]);
  });

  it('waits for the edited rules, then runs on them, and the pages are told on both sides', async () => {
    const bundle = deferred<number>();
    const { queue, events, notices, move } = queueOver(() => bundle.promise);

    const reloaded = queue.saved('src/rules/index.ts');
    // Told before the bundle has even started, not when it lands.
    expect(notices).toEqual([{ state: 'reloading' }]);
    const moved = queue.admit(move('bump'));
    bundle.resolve(2);
    await Promise.all([reloaded, moved]);

    expect(events).toEqual(['adopt 2', 'bump on 2']);
    expect(notices).toEqual([{ state: 'reloading' }, { state: 'reloaded' }]);
  });

  it('keeps the order messages arrived in, including one that arrives while the held ones run', async () => {
    const bundle = deferred<number>();
    const { queue, events, move } = queueOver(() => bundle.promise);
    let late: Promise<void> = Promise.resolve();
    const reloaded = queue.saved('src/rules/index.ts');
    const first = queue.admit({
      run: async () => {
        events.push('first on 2');
        // Sent while the held messages are being delivered: it may not overtake them.
        late = queue.admit(move('late'));
      },
    });
    const second = queue.admit(move('second'));
    bundle.resolve(2);
    await Promise.all([reloaded, first, second]);
    await late;
    expect(events).toEqual(['adopt 2', 'first on 2', 'second on 2', 'late on 2']);
  });

  it('refuses a held move with the rebuild error, keeps the old rules, and still answers a read', async () => {
    const bundle = deferred<number>();
    const { queue, events, notices, move, read } = queueOver(() => bundle.promise);
    const reloaded = queue.saved('src/rules/index.ts');
    const moved = queue.admit(move('bump'));
    const looked = queue.admit(read('lobby'));
    bundle.reject(new Error('Expected ";" but found "}"'));
    await Promise.all([reloaded, moved, looked]);

    const refusal =
      'Your edited rules did not load, so this table is still running the ones it had: Expected ";" but found "}"';
    expect(events).toEqual([`bump refused: ${refusal}`, 'lobby read 1']);
    expect(notices).toEqual([{ state: 'reloading' }, { state: 'failed', message: refusal }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(refusal));

    // Afterwards the host takes moves again, on the rules it kept.
    await queue.admit(move('next'));
    expect(events.at(-1)).toBe('next on 1');
  });

  it("refuses a held move with the road's own words when the host cannot take the rules", async () => {
    const notices: RulesReloadNotice[] = [];
    const refused: string[] = [];
    const queue = createRulesReloadQueue<number>({
      what: 'world',
      load: async () => 2,
      adopt: async () => {
        throw new Error('Those rules cannot run this world, so nothing was changed on disk: no view');
      },
      tell: (notice) => notices.push(notice),
    });
    const reloaded = queue.saved('src/rules/index.ts');
    const moved = queue.admit({ run: async () => {}, refuse: (message) => refused.push(message) });
    await Promise.all([reloaded, moved]);
    expect(refused).toEqual(['Those rules cannot run this world, so nothing was changed on disk: no view']);
    expect(notices.at(-1)).toEqual({ state: 'failed', message: refused[0] });
  });

  /** Two saves with a move sent between them; each save's bundle is answered by hand, in order. */
  function twoSaves() {
    const bundles = [deferred<number>(), deferred<number>()];
    let loads = 0;
    const { queue, events, notices, move } = queueOver(() => bundles[loads++]!.promise);
    const first = queue.saved('src/rules/index.ts');
    const moved = queue.admit(move('bump'));
    const second = queue.saved('src/rules/other.ts');
    return { bundles, events, notices, first, moved, second };
  }

  it('holds a message sent between two saves for the second, and tells the pages once', async () => {
    const { bundles, events, notices, first, moved, second } = twoSaves();
    bundles[0]!.resolve(2);
    await first;
    // The first reload is in place, but the designer has saved again since.
    expect(events).toEqual(['adopt 2']);
    bundles[1]!.resolve(3);
    await Promise.all([second, moved]);

    expect(events).toEqual(['adopt 2', 'adopt 3', 'bump on 3']);
    expect(notices).toEqual([{ state: 'reloading' }, { state: 'reloaded' }]);
  });

  it('runs held messages on the last save when an earlier one failed to build', async () => {
    const { bundles, events, notices, first, moved, second } = twoSaves();
    bundles[0]!.reject(new Error('half-typed'));
    bundles[1]!.resolve(2);
    await Promise.all([first, second, moved]);
    expect(events).toEqual(['adopt 2', 'bump on 2']);
    expect(notices.at(-1)).toEqual({ state: 'reloaded' });
  });

  it('passes on a held message that throws, and goes on to the next', async () => {
    const { queue, events, move } = queueOver(async () => 2);
    const reloaded = queue.saved('src/rules/index.ts');
    const broken = queue.admit({
      run: async () => {
        throw new Error('host failed');
      },
    });
    const next = queue.admit(move('next'));
    await expect(broken).rejects.toThrow('host failed');
    await Promise.all([reloaded, next]);
    expect(events).toEqual(['adopt 2', 'next on 2']);
  });
});

/**
 * #387: work the host starts itself (a timer going off) waits in the same
 * queue, and is never refused.
 */
describe('#387: work the host starts itself while the rules are rebuilding', () => {
  it('runs at once when no reload is pending', async () => {
    const { queue, events } = queueOver(async () => 2);
    queue.hold(() => void events.push('deadline'));
    await Promise.resolve();
    expect(events).toEqual(['deadline']);
  });

  it.each([
    { outcome: 'the edited rules, in order with the pages\' messages', built: 2, then: ['adopt 2', 'bump on 2', 'deadline'] },
    { outcome: 'the old rules, never refused, when the edit does not build', built: null, then: ['bump refused', 'deadline'] },
  ])('waits for the reload, then runs on $outcome', async ({ built, then }) => {
    const rebuild = deferred<number>();
    const { queue, events, move } = queueOver(() => rebuild.promise);
    const reloaded = queue.saved('src/rules/index.ts');
    void queue.admit(move('bump'));
    queue.hold(() => void events.push('deadline'));
    expect(events).toEqual([]);
    if (built === null) rebuild.reject(new Error('Unexpected token'));
    else rebuild.resolve(built);
    await reloaded;
    expect(events.map((event) => event.replace(/^(bump refused):.*/, '$1'))).toEqual(then);
  });
});

describe('#388: reloadPending, which a chain of bot moves stops on', () => {
  it('is true from a save until its reload has settled, and false while what it held runs', async () => {
    const rebuild = deferred<number>();
    const { queue } = queueOver(() => rebuild.promise);
    expect(queue.reloadPending).toBe(false);
    const reloaded = queue.saved('src/rules/index.ts');
    expect(queue.reloadPending).toBe(true);
    // Held work runs on the settled rules, so a chain it restarts goes on.
    const seen: boolean[] = [];
    queue.hold(() => void seen.push(queue.reloadPending));
    rebuild.resolve(2);
    await reloaded;
    expect(seen).toEqual([false]);
    expect(queue.reloadPending).toBe(false);
  });
});

describe('#387: heldClock', () => {
  /** A clock whose one timer the test sets off, and the fires the gate is holding. */
  function gatedClock() {
    let fire: (() => void) | null = null;
    const clock: WorldHostClock = {
      now: () => 0,
      yieldTurn: async () => {},
      arm: (delayMs, next) => {
        fire = delayMs === null ? null : next;
      },
    };
    const holding: Array<() => void | Promise<void>> = [];
    const held = heldClock(clock, { reloadPending: true, hold: (work) => void holding.push(work) });
    return { held, holding, goOff: () => fire?.() };
  }

  it('hands a timer that goes off to the gate instead of firing it', async () => {
    const { held, holding, goOff } = gatedClock();
    const fired = vi.fn();
    held.arm(1_000, fired);
    goOff();
    expect(fired).not.toHaveBeenCalled();
    await holding.shift()!();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('drops a held fire once the timer is armed again or disarmed, as a clock replaces its timer', async () => {
    const { held, holding, goOff } = gatedClock();
    const stale = vi.fn();
    held.arm(1_000, stale);
    goOff();
    held.arm(null, () => {});
    await holding.shift()!();
    expect(stale).not.toHaveBeenCalled();
  });
});
