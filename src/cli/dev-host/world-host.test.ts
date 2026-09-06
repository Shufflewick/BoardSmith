/**
 * #167: A WORLD RUNS ON A LAPTOP, DRIVEN THROUGH THE SAME LIBRARY THE PLATFORM
 * DRIVES.
 *
 * Every fact below is one of the ticket's own acceptance sentences, asserted
 * against the real `LocalWorldHost` over a real `LocalWorldStore` on a real
 * SQLite file. Nothing here is faked: the same `createWorld`, the same
 * `settleDeclaration`, the same `planSchedules`, the same refusals. What IS
 * injected is the clock, because a test that waited ten real minutes to see a
 * tick is the exact problem the "fire due events now" control exists to solve.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Game, Player, Space, type GameOptions, type GameElement } from '../../engine/index.js';
import { WorldRefusal, worldBudgets, type WorldDefinition } from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import { LocalWorldHost, devWorldPlayer, type WorldDevClock } from './world-host.js';

// ── A world bundle, in the shape a real one exports ─────────────────────────

class Hearth extends Space<Village> {
  logs = 0;
  burns = 0;
}

class Village extends Game<Village, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Hearth]);
  }
}

const HEARTH = 'hearth';

function worldBlock(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
  return {
    genesis: (game) => ({ [HEARTH]: game.create(Hearth, 'hearth') as GameElement }),
    view: () => [HEARTH],
    commands: {
      chop: {
        prompt: 'Cut a log',
        args: [],
        partitions: () => [HEARTH],
        run: ({ partition, seat }) => {
          const hearth = partition(HEARTH) as Hearth;
          hearth.logs += 1;
          return [{ scope: HEARTH, payload: { chopped: seat, logs: hearth.logs } }];
        },
      },
      bank: {
        prompt: 'Bank a log on a slow burn',
        args: [],
        partitions: () => [HEARTH],
        run: ({ partition, schedule }) => {
          (partition(HEARTH) as Hearth).logs += 1;
          schedule({ delayMs: 600_000, command: 'burn', args: {} });
          return [{ scope: HEARTH, payload: { banked: true } }];
        },
      },
      burn: {
        clockOnly: true,
        prompt: 'The fire takes what was banked',
        args: [],
        partitions: () => [HEARTH],
        run: ({ partition }) => {
          const hearth = partition(HEARTH) as Hearth;
          hearth.burns += 1;
          return [{ scope: HEARTH, payload: { burned: hearth.burns } }];
        },
      },
      ...overrides.commands,
    },
    ...overrides,
  } as WorldDefinition;
}

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    gameClass: Village,
    gameType: 'village',
    displayName: 'Village',
    minPlayers: 1,
    maxPlayers: 4,
    world: worldBlock(),
    ...overrides,
  } as ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
}

/**
 * A clock nothing waits on.
 *
 * `now` is a number this test moves, and `arm` records the request rather than
 * setting a timer -- so "fires on its due time" is asserted by advancing the
 * clock and firing what was armed, which is the same code path a real
 * `setTimeout` takes and none of the wall time.
 */
function testClock(): WorldDevClock & { advance(ms: number): void; fireArmed(): void; armedDelay: number | null } {
  let now = 1_000_000;
  let armed: { delayMs: number; fire: () => void } | null = null;
  return {
    now: () => now,
    arm(delayMs, fire) {
      armed = delayMs === null ? null : { delayMs, fire };
    },
    get armedDelay() {
      return armed === null ? null : armed.delayMs;
    },
    advance(ms) {
      now += ms;
    },
    fireArmed() {
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

function openHost(options: {
  dir: string;
  definition?: ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
  clock?: WorldDevClock;
}): { host: LocalWorldHost; store: LocalWorldStore; sent: Sent[] } {
  const budgets = worldBudgets();
  const store = openWorldStore(worldStorePath(options.dir), budgets);
  const sent: Sent[] = [];
  const host = new LocalWorldHost({
    definition: options.definition ?? bundle(),
    worldName: 'Village',
    seed: 'seed',
    budgets,
    store,
    clock: options.clock ?? testClock(),
    send: (clientId, message) => sent.push({ clientId, message: message as Record<string, unknown> }),
  });
  return { host, store, sent };
}

/**
 * A launched world with one client attached, which is the state every case
 * below starts from. Written once because it is the same three lines each time
 * and a divergence between two of them is a difference nothing would report.
 */
async function attached(options: Parameters<typeof openHost>[0], clientId = 'c1') {
  const opened = openHost(options);
  await opened.host.start();
  await opened.host.handleMessage(clientId, { type: 'hello' });
  return opened;
}

/** The last frame of a type this client was sent. */
function last(sent: Sent[], clientId: string, type: string): Record<string, unknown> | undefined {
  return [...sent].reverse().find((s) => s.clientId === clientId && s.message.type === type)?.message;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bs-world-host-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('#167: genesis runs once, into the local store', () => {
  it('launches the world on first start and never again', async () => {
    const first = openHost({ dir });
    expect(first.store.isLaunched()).toBe(false);
    await first.host.start();
    expect(first.store.isLaunched()).toBe(true);
    expect(await first.store.read(HEARTH)).toBeDefined();
    await first.host.close();

    // A SECOND HOST OVER THE SAME STORE RE-RUNS NOTHING. Genesis is what a
    // world starts as; running it twice would build a second hearth over the
    // one the players have been using.
    const second = openHost({ dir });
    await second.host.start();
    await second.host.handleMessage('c1', { type: 'hello' });
    await second.host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'chop', args: {} });
    const state = last(second.sent, 'c1', 'world_state');
    expect(JSON.stringify(state?.view)).toContain('"logs":1');
    await second.host.close();
  });
});

describe('#167: a command is dispatched through partitions() then run', () => {
  it('changes the world, pushes the acting seat a new view, and narrates', async () => {
    const { host, sent } = await attached({ dir });

    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'chop', args: {} });

    expect(last(sent, 'c1', 'world_response')).toMatchObject({ requestId: 'r1', ok: true });
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    // NARRATION IS NOT STATE: the routed event arrives on its own frame.
    const narration = last(sent, 'c1', 'world_events');
    expect(JSON.stringify(narration?.events)).toContain('"chopped":1');
    await host.close();
  });

  it('offers only the commands a player may issue', async () => {
    const { host, sent } = await attached({ dir });
    const offers = last(sent, 'c1', 'world_state')?.commands as Array<{ name: string }>;
    expect(offers.map((o) => o.name).sort()).toEqual(['bank', 'chop']);
    await host.close();
  });
});

describe('#167: a seat switcher, so one person can play several seats', () => {
  it('moves a client between seats and projects each seat its own view', async () => {
    const { host, sent } = await attached({ dir });
    expect(last(sent, 'c1', 'world_state')?.seat).toBe(1);

    await host.handleMessage('c1', { type: 'attach', seat: 3 });
    expect(last(sent, 'c1', 'world_state')?.seat).toBe(3);

    // The ROSTER is durable, and both seats are in it: a seat is where a
    // player's holdings are, so taking a second one never gives back the first.
    const roster = openHost({ dir }).store.seats().map((s) => s.seat);
    expect(roster).toEqual([1, 3]);
    await host.close();
  });

  it('REFUSES a seat this world does not have, in the library\'s own sentence', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'attach', seat: 9 });
    expect(last(sent, 'c1', 'world_notice')?.message).toContain('this world\'s game declares maxPlayers: 4');
    await host.close();
  });
});

describe('#167: presence is the seats this host has open', () => {
  it('reports one entry per seat, and drops it when the socket goes', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c2', { type: 'hello' });
    expect(last(sent, 'c1', 'world_state')?.presence).toEqual([1, 2]);

    await host.disconnect('c2');
    expect(last(sent, 'c1', 'world_state')?.presence).toEqual([1]);
    await host.close();
  });

  it('hands the running command the same set, so a world can ask who is here', async () => {
    const seen: number[][] = [];
    const definition = bundle({
      world: worldBlock({
        commands: {
          ...worldBlock().commands,
          roll: {
            prompt: 'Call the roll',
            args: [],
            partitions: () => [HEARTH],
            run: ({ presence }) => {
              seen.push([...presence].sort((a, b) => a - b));
              return [];
            },
          },
        },
      }),
    });
    const { host } = await attached({ dir, definition });
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'roll', args: {} });
    expect(seen).toEqual([[1, 2]]);
    await host.close();
  });
});

describe('#167: scheduled events fire on their due time', () => {
  it('arms a timer for the event a command scheduled, and runs it when it comes due', async () => {
    const clock = testClock();
    const { host, sent } = await attached({ dir, clock });

    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'bank', args: {} });
    expect(clock.armedDelay).toBe(600_000);
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":0');

    clock.advance(600_000);
    clock.fireArmed();
    await host.settled();
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":1');
    await host.close();
  });

  it('"fire due events now" moves the world\'s clock to the due instant instead of waiting', async () => {
    const clock = testClock();
    const { host, sent } = await attached({ dir, clock });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'bank', args: {} });

    // NOT A FABRICATED TICK. The world's clock jumps to the moment the event
    // was due, so the handler receives its own `due` and the world computes
    // exactly the state ten real minutes would have produced.
    await host.handleMessage('c1', { type: 'fire_due' });
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":1');
    expect(last(sent, 'c1', 'world_notice')?.message).toContain('600000ms');
    await host.close();
  });

  it('says so rather than pretending when nothing is scheduled', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'fire_due' });
    expect(last(sent, 'c1', 'world_notice')?.message).toContain('Nothing is scheduled');
    await host.close();
  });
});

describe('#167: wake from parked really drops residency', () => {
  it('rehydrates the world from the store and answers the same view', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'chop', args: {} });
    expect(host.residency().length).toBeGreaterThan(0);

    await host.handleMessage('c1', { type: 'wake' });

    // THE POINT OF THE CONTROL. Everything the genesis instance was holding is
    // gone, and what comes back came out of the store -- which is the path
    // that finds an `{ __elementId }` that never adopted.
    expect(host.residencyBeforeLastWake()).toBeGreaterThan(0);
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    await host.handleMessage('c1', { type: 'command', requestId: 'r2', command: 'chop', args: {} });
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":2');
    await host.close();
  });
});

describe('#167: the world is where it was left after a restart', () => {
  it('finds the logs, the roster and the pending burn after the host stops', async () => {
    const first = openHost({ dir });
    await first.host.start();
    await first.host.handleMessage('c1', { type: 'hello' });
    await first.host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'chop', args: {} });
    await first.host.handleMessage('c1', { type: 'command', requestId: 'r2', command: 'bank', args: {} });
    await first.host.close();

    const second = openHost({ dir });
    await second.host.start();
    await second.host.handleMessage('c9', { type: 'hello' });
    expect(JSON.stringify(last(second.sent, 'c9', 'world_state')?.view)).toContain('"logs":2');
    expect(second.store.pendingEvents()).toHaveLength(1);
    expect(second.store.seats()).toEqual([{ player: devWorldPlayer(1), seat: 1 }]);
    await second.host.close();
  });
});

describe('#167: the refusals a bundle hits on the platform are hit locally, in the same sentence', () => {
  it('bundle-not-a-world: a project whose rules export no world block', async () => {
    const store = openWorldStore(worldStorePath(dir), worldBudgets());
    expect(
      () =>
        new LocalWorldHost({
          definition: bundle({ world: undefined }),
          worldName: 'Village',
          seed: 'seed',
          budgets: worldBudgets(),
          store,
          send: () => {},
        }),
    ).toThrow(/A world game exports `world: \{ commands, view \}` alongside `gameClass`/);
    store.close();
  });

  it('clock-only-command: a seat reaching for the clock\'s own verb', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'burn', args: {} });
    const answer = last(sent, 'c1', 'world_response');
    expect(answer).toMatchObject({ ok: false });
    expect(answer?.message).toBe(
      '"burn" is this world\'s own clock at work, not an action you take. It runs when the event ' +
        'that was scheduled for it comes due, whether or not anybody is here to watch it, and no ' +
        'player may issue it.',
    );
  });

  it('partition-too-large: a partition that outgrew what one storage value holds', async () => {
    const definition = bundle({
      world: worldBlock({
        commands: {
          ...worldBlock().commands,
          hoard: {
            prompt: 'Pile it up',
            args: [],
            partitions: () => [HEARTH],
            run: ({ partition }) => {
              const hearth = partition(HEARTH) as Hearth & { pile?: string };
              hearth.pile = 'x'.repeat(600_000);
              return [];
            },
          },
        },
      }),
    });
    const { host, sent, store } = await attached({ dir, definition });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'hoard', args: {} });
    const answer = last(sent, 'c1', 'world_response');
    expect(answer).toMatchObject({ ok: false });
    expect(answer?.message).toContain(
      `-byte limit one partition may hold. A partition is written as a single storage value`,
    );
    // AND THE COMMAND IS ROLLED BACK, in the platform's own sentence. A world
    // that could not be made durable has to give the bytes back: the resident
    // tree is dropped and the store's durable world is what is left.
    expect(answer?.message).toContain(
      'Command "hoard" ran and was then rolled back, because the world could not be made durable ' +
        '-- nothing it changed survives, and sending it again is safe.',
    );
    expect(store.dirtyPartitions()).toEqual([]);
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).not.toContain('xxxxx');
    await host.close();
  });

  it('unknown-command: the world says what it does answer to', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'yodel', args: {} });
    expect(last(sent, 'c1', 'world_response')?.message).toBe(
      'This world has no command named "yodel". It answers to: chop, bank, burn.',
    );
    await host.close();
  });

  it('a refusal leaves the world unchanged and the store clean', async () => {
    const { host, store } = await attached({ dir });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'yodel', args: {} });
    expect(store.dirtyPartitions()).toEqual([]);
    await host.close();
  });

  it('classifies every refusal it surfaces with the library\'s own code', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'command', requestId: 'r1', command: 'burn', args: {} });
    expect(last(sent, 'c1', 'world_response')?.code).toBe('clock-only-command');
    await host.close();
  });
});

describe('#167: WorldRefusal is what the host raises, not a bare Error', () => {
  it('keeps the code so a UI can tell a game refusal from a host failure', () => {
    const error = new WorldRefusal('clock-only-command', 'x');
    expect(error.code).toBe('clock-only-command');
  });
});
