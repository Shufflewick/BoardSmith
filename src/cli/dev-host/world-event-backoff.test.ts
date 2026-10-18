/**
 * #721: A SCHEDULED EVENT THAT REFUSES IS RETRIED AFTER A WAIT, NOT AT ONCE.
 *
 * A refused event stays queued at a due already passed, and the re-arm used to
 * arm for now over it, so on a real clock it ran again as fast as the timer
 * could fire, broadcasting a notice every time. The clock here records what it
 * was armed with, which is the work done, and never waits.
 */
import { describe, expect, it } from 'vitest';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldBudgets, worldClockAction, type WorldDefinition } from '../../world/index.js';
import { ResidentWorld, type WorldHostClock } from '../../world/host/index.js';
import { createMemoryWorldStore } from '../../testing/memory-world-store.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../../engine/element/world-element-id-key.test-helper.js';

const OPENED = 1_700_000_000_000;
// The platform's retry floor (ShufflewickPub WORLD_RETRY_WAKE_FLOOR_MS).
const RETRY_MS = 40_000;
const LOG = 'log';

class Log extends Space<Clockwork> {}

class Clockwork extends Game<Clockwork, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Log]);
  }
}

let failing = true;
let runs = 0;

const boom = worldClockAction<Clockwork>('boom')
  .needs(() => [LOG])
  .execute(() => {
    runs += 1;
    if (failing) throw new Error('broken on purpose');
  });

const tick = worldClockAction<Clockwork>('tick')
  .needs(() => [])
  .execute(() => {});

const arm = worldClockAction<Clockwork>('arm')
  .needs(() => [])
  .execute((args, { world }) => {
    world.schedule({ delayMs: 0, action: 'boom' });
    if (args.tickIn !== undefined) world.schedule({ delayMs: Number(args.tickIn), action: 'tick' });
  });

function bundle(): ConstructorParameters<typeof ResidentWorld>[0]['definition'] {
  return {
    gameClass: Clockwork,
    gameType: 'clockwork',
    displayName: 'Clockwork',
    world: {
      maxPlayers: 1,
      genesis: (game: Game): Record<string, GameElement> => ({ [LOG]: game.create(Log, LOG) }),
      view: () => [LOG],
      actions: [boom, arm, tick],
    } as WorldDefinition,
  } as ConstructorParameters<typeof ResidentWorld>[0]['definition'];
}

/** A clock that never fires and remembers the delay it was last armed with. */
function recordingClock(): WorldHostClock & { armedDelay: number | null } {
  const clock = {
    armedDelay: null as number | null,
    now: () => OPENED,
    arm(delayMs: number | null) {
      clock.armedDelay = delayMs;
    },
    yieldTurn: () => Promise.resolve(),
  };
  return clock;
}

async function launched(armArgs: Record<string, unknown> = {}) {
  failing = true;
  runs = 0;
  const clock = recordingClock();
  const notices: string[] = [];
  let minted = 0;
  const world = new ResidentWorld({
    definition: bundle(),
    seed: 'backoff',
    budgets: worldBudgets(),
    store: createMemoryWorldStore(TEST_WORLD_ELEMENT_ID_KEY, worldBudgets()),
    clock,
    presence: () => [],
    mintId: () => `event-${++minted}`,
    onNotice: (message) => notices.push(message),
  });
  await world.start();
  await world.run(() => world.clockCommand('arm', armArgs));
  return { world, clock, notices };
}

describe('#721: a refused scheduled event waits before it is tried again', () => {
  it('arms the retry a backoff after now, not now', async () => {
    const { world, clock, notices } = await launched();
    expect(clock.armedDelay).toBe(0);

    await world.run(() => world.fireDue());

    expect(runs).toBe(1);
    expect(notices).toHaveLength(1);
    expect(clock.armedDelay).toBe(RETRY_MS);
    await world.close();
  });

  it('arms a fresh timer due before the retry at its own due, not the retry (#953)', async () => {
    const { world, clock } = await launched({ tickIn: 10_000 });

    await world.run(() => world.fireDue());

    expect(runs).toBe(1);
    expect(clock.armedDelay).toBe(10_000);
    await world.close();
  });

  it('arms overdue work for now again once a batch runs clean', async () => {
    const { world, clock } = await launched();
    await world.run(() => world.fireDue());
    failing = false;

    await world.run(() => world.fireDue());
    expect(clock.armedDelay).toBeNull();
    await world.run(() => world.clockCommand('arm', {}));

    expect(clock.armedDelay).toBe(0);
    await world.close();
  });
});
