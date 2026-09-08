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

import {
  Game,
  Player,
  Space,
  type ActionDefinition,
  type GameOptions,
  type GameElement,
} from '../../engine/index.js';
import {
  WorldRefusal,
  worldAction,
  worldBudgets,
  worldClockAction,
  type WorldBudgets,
  type StoredPartition,
  type WorldDefinition,
} from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import type { WorldDevClock } from './node-world-clock.js';
import { LocalWorldHost, devWorldPlayer } from './world-host.js';

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

// ── The village's verbs, as ACTIONS (#169) ──────────────────────────────────
//
// The bundle hands `world.actions` to `createWorld`, which registers them on
// the game it builds -- so they are declared once here rather than rebuilt per
// call, and the game class registers none of them itself.

const chop = worldAction<Village>('chop')
  .prompt('Cut a log')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    const hearth = ctx.world.partition(HEARTH) as Hearth;
    hearth.logs += 1;
    ctx.world.emit(
      HEARTH,
      { chopped: ctx.player.seat, logs: hearth.logs },
      `Seat ${ctx.player.seat} cut a log.`,
    );
  });

const bank = worldAction<Village>('bank')
  .prompt('Bank a log on a slow burn')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    (ctx.world.partition(HEARTH) as Hearth).logs += 1;
    ctx.world.schedule({ delayMs: 600_000, action: 'burn', args: {} });
    ctx.world.emit(HEARTH, { banked: true });
  });

/** SEATLESS: the clock's own, and no player may issue it (#120). */
const burn = worldClockAction<Village>('burn')
  .prompt('The fire takes what was banked')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    const hearth = ctx.world.partition(HEARTH) as Hearth;
    hearth.burns += 1;
    ctx.world.emit(HEARTH, { burned: hearth.burns });
  });

const VILLAGE_ACTIONS: readonly ActionDefinition[] = [chop, bank, burn];

function worldBlock(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
  return {
    maxPlayers: 4,
    genesis: (game) => ({ [HEARTH]: game.create(Hearth, 'hearth') as GameElement }),
    view: () => [HEARTH],
    actions: VILLAGE_ACTIONS,
    ...overrides,
  } as WorldDefinition;
}

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    gameClass: Village,
    gameType: 'village',
    displayName: 'Village',
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

/**
 * A FRESH ORDER IDENTITY, one per send (#195).
 *
 * Every player command carries one, and two presses of the same button are two
 * orders -- so a test that sends twice and expects two effects mints twice,
 * exactly as the page does. The cases that are ABOUT a repeat name their own id.
 */
let orderCounter = 0;
function nextOrder(): { id: string; at: number } {
  orderCounter += 1;
  return { id: `order-${orderCounter}`, at: 0 };
}

interface Sent {
  clientId: string;
  message: Record<string, unknown>;
}

function openHost(options: {
  dir: string;
  definition?: ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
  clock?: WorldDevClock;
  budgets?: WorldBudgets;
}): { host: LocalWorldHost; store: LocalWorldStore; sent: Sent[] } {
  const budgets = options.budgets ?? worldBudgets();
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

/**
 * A LAUNCHED, PLAYED WORLD, CLOSED AGAIN.
 *
 * The starting state of every upgrade case below: stored bytes in the hearth,
 * a queued event on the clock and a seated player -- all three of which an
 * upgrade has to leave standing. `verbs` says what was played, because a case
 * about partitions wants a log cut and one about timers wants one banked.
 */
async function aPlayedVillage(
  worldDefinition: WorldDefinition = worldBlock(),
  verbs: readonly string[] = ['chop', 'bank'],
): Promise<void> {
  const opened = await attached({ dir, definition: bundle({ world: worldDefinition }) });
  for (const action of verbs) {
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: `r-${action}`,
      action,
      args: {},
    });
  }
  await opened.host.close();
}

/** The world as it is ON DISK, read by a store nobody has been playing
 *  through -- which is the only honest way to ask what an upgrade wrote. */
function onDisk(): LocalWorldStore {
  return openWorldStore(worldStorePath(dir), worldBudgets());
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
    await second.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    const state = last(second.sent, 'c1', 'world_state');
    expect(JSON.stringify(state?.view)).toContain('"logs":1');
    await second.host.close();
  });
});

describe('#167: an action is dispatched through its ordered declaration, then run', () => {
  it('changes the world, pushes the acting seat a new view, and narrates', async () => {
    const { host, sent } = await attached({ dir });

    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });

    expect(last(sent, 'c1', 'world_response')).toMatchObject({ requestId: 'r1', ok: true });
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    // NARRATION IS NOT STATE: the routed event arrives on its own frame.
    const narration = last(sent, 'c1', 'world_events');
    expect(JSON.stringify(narration?.events)).toContain('"chopped":1');
    // AND THE SENTENCE SURVIVES THE HOST (#186). It used to re-map every event
    // to `{ scope, payload }` on the way to the wire, so the shell's log --
    // which filters on `text` -- was empty in every world there has ever been.
    expect((narration?.events as unknown[])[0]).toMatchObject({ text: 'Seat 1 cut a log.' });
    await host.close();
  });

  it('offers only the actions a player may issue', async () => {
    // `burn` is the clock's own, so it is not on the frame: a client that was
    // never offered it cannot send it by accident, and the submit path refuses
    // it besides -- filtering alone would leave the rule enforceable only by
    // the client, which is not a place a rule can live.
    const { host, sent } = await attached({ dir });
    const offers = last(sent, 'c1', 'world_state')?.actions as Array<{ name: string }>;
    expect(offers.map((o) => o.name)).toEqual(['bank', 'chop']);
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
    const roll = worldAction<Village>('roll')
      .prompt('Call the roll')
      .needs(() => [HEARTH])
      .execute((_args, ctx) => {
        seen.push([...ctx.world.presence].sort((a, b) => a - b));
      });
    const definition = bundle({
      world: worldBlock({ actions: [...VILLAGE_ACTIONS, roll] }),
    });
    const { host } = await attached({ dir, definition });
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'roll', args: {} });
    expect(seen).toEqual([[1, 2]]);
    await host.close();
  });
});

describe('#167: scheduled events fire on their due time', () => {
  /** A world with one log banked on a slow burn: the state both cases below
   *  start from, and the one thing they differ about is what happens next. */
  async function banked() {
    const clock = testClock();
    const opened = await attached({ dir, clock });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'bank',
      args: {},
    });
    return { ...opened, clock };
  }

  it('arms a timer for the event a command scheduled, and runs it when it comes due', async () => {
    const { host, sent, clock } = await banked();
    expect(clock.armedDelay).toBe(600_000);
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":0');

    clock.advance(600_000);
    clock.fireArmed();
    await host.settled();
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":1');
    await host.close();
  });

  it('"fire due events now" moves the world\'s clock to the due instant instead of waiting', async () => {
    const { host, sent } = await banked();

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

describe("#216: an advanced clock belongs to the world, not to the host that advanced it", () => {
  /**
   * A RULE RELOAD REPLACES THE RUNTIME, NOT THE WORLD.
   *
   * `dev-world.ts` answers a rules edit by closing this host and opening
   * another over the same store (#201). Everything durable survives that --
   * including partitions a fired event settled at a time that has not arrived
   * yet -- so a second host starting its clock at the wall would issue command
   * timestamps EARLIER than state already on disk, and a game that checks its
   * own monotonicity refuses the next order until real time catches up.
   *
   * The same sentence covers a cold `boardsmith dev`: reopening a store is
   * reopening a world, and the two must not disagree about what time it is.
   */
  async function advanced() {
    const clock = testClock();
    const opened = await attached({ dir, clock });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'bank',
      args: {},
    });
    await opened.host.handleMessage('c1', { type: 'fire_due' });
    const status = last(opened.sent, 'c1', 'world_status');
    expect(status?.clockSkewMs).toBe(600_000);
    return { ...opened, clock, worldNow: status?.worldNow as number };
  }

  it('carries the advance into the host a rule reload opens over the same store', async () => {
    const first = await advanced();
    await first.host.close();

    // What `hostOver` does: a new host, the same store, a clock that only ever
    // knew the wall.
    const second = await attached({ dir, clock: testClock() }, 'c2');
    const status = last(second.sent, 'c2', 'world_status');
    expect(status?.clockSkewMs).toBe(600_000);
    expect(status?.worldNow as number).toBeGreaterThanOrEqual(first.worldNow);
    await second.host.close();
  });

  it('never hands a command a timestamp earlier than the world already settled at', async () => {
    const first = await advanced();
    await first.host.close();

    const second = await attached({ dir, clock: testClock() }, 'c2');
    // The order the reproduction was refused on: the next command after the
    // reload, against state the fired event already settled in the future.
    await second.host.handleMessage('c2', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r2',
      action: 'chop',
      args: {},
    });
    const answer = last(second.sent, 'c2', 'world_response');
    expect(answer?.ok).toBe(true);
    const status = last(second.sent, 'c2', 'world_status');
    expect(status?.worldNow as number).toBeGreaterThanOrEqual(first.worldNow);
    await second.host.close();
  });
});

describe('#167: wake from parked really drops residency', () => {
  it('rehydrates the world from the store and answers the same view', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    expect(host.residency().length).toBeGreaterThan(0);

    await host.handleMessage('c1', { type: 'wake' });

    // THE POINT OF THE CONTROL. Everything the genesis instance was holding is
    // gone, and what comes back came out of the store -- which is the path
    // that finds an `{ __elementId }` that never adopted.
    expect(host.residencyBeforeLastWake()).toBeGreaterThan(0);
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r2', action: 'chop', args: {} });
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":2');
    await host.close();
  });
});

describe('#167: the world is where it was left after a restart', () => {
  it('finds the logs, the roster and the pending burn after the host stops', async () => {
    const first = openHost({ dir });
    await first.host.start();
    await first.host.handleMessage('c1', { type: 'hello' });
    await first.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    await first.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r2', action: 'bank', args: {} });
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
    ).toThrow(/A world game exports `world: \{ actions, view \}` alongside `gameClass`/);
    store.close();
  });

  it('clock-only-command: a seat reaching for the clock\'s own verb', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'burn', args: {} });
    const answer = last(sent, 'c1', 'world_response');
    expect(answer).toMatchObject({ ok: false });
    expect(answer?.message).toBe(
      '"burn" is this world\'s own clock at work, not an action you take. It runs when the event ' +
        'that was scheduled for it comes due, whether or not anybody is here to watch it, and no ' +
        'player may issue it.',
    );
  });

  it('partition-too-large: a partition that outgrew what one storage value holds', async () => {
    const hoard = worldAction<Village>('hoard')
      .prompt('Pile it up')
      .needs(() => [HEARTH])
      .execute((_args, ctx) => {
        const hearth = ctx.world.partition(HEARTH) as Hearth & { pile?: string };
        hearth.pile = 'x'.repeat(600_000);
      });
    const definition = bundle({
      world: worldBlock({ actions: [...VILLAGE_ACTIONS, hoard] }),
    });
    const { host, sent, store } = await attached({ dir, definition });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'hoard', args: {} });
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
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'yodel', args: {} });
    expect(last(sent, 'c1', 'world_response')?.message).toBe(
      'This world has no action named "yodel". It answers to: chop, bank, burn.',
    );
    await host.close();
  });

  it('a refusal leaves the world unchanged and the store clean', async () => {
    const { host, store } = await attached({ dir });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'yodel', args: {} });
    expect(store.dirtyPartitions()).toEqual([]);
    await host.close();
  });

  it('#197: closing twice is closing once, and the second caller waits for the first', async () => {
    const { host } = await attached({ dir });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    // Ctrl-C through a package script signals the whole process group, so both
    // handlers run: the second must not reach a finalised statement.
    await Promise.all([host.close(), host.close()]);
    await expect(host.close()).resolves.toBeUndefined();
  });

  it('classifies every refusal it surfaces with the library\'s own code', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'burn', args: {} });
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

/**
 * #195: A PAID ORDER SURVIVES A LOST REPLY.
 *
 * The village's `chop` stands in for every paid order there is: it changes the
 * world exactly once per press, and the hearth's log count is what says how
 * many times the handler actually ran. Every case below is one sentence of the
 * ticket, asserted against the real host over a real store.
 */
describe('#195: an uncertain order is answered from its receipt, never spent twice', () => {
  const order = (id: string, at = 0) => ({ id, at });

  async function chop(
    host: LocalWorldHost,
    requestId: string,
    id: string,
    at = 0,
    clientId = 'c1',
  ): Promise<void> {
    await host.handleMessage(clientId, {
      type: 'action',
      order: order(id, at),
      requestId,
      action: 'chop',
      args: {},
    });
  }

  const logsIn = (sent: Sent[], clientId = 'c1'): string =>
    JSON.stringify(last(sent, clientId, 'world_state')?.view);

  it('runs the handler once and answers the repeat from the receipt', async () => {
    const { host, sent } = await attached({ dir });
    await chop(host, 'r1', 'o1');
    expect(logsIn(sent)).toContain('"logs":1');

    // THE LOST REPLY, AFTER COMMIT. The page never heard the answer and sends
    // the same order again.
    await chop(host, 'r2', 'o1');
    expect(last(sent, 'c1', 'world_response')).toMatchObject({
      requestId: 'r2',
      ok: true,
      replayed: true,
    });
    expect(logsIn(sent)).toContain('"logs":1');
    await host.close();
  });

  it('a deliberate second press is a second order, and does run twice', async () => {
    const { host, sent } = await attached({ dir });
    await chop(host, 'r1', 'o1');
    await chop(host, 'r2', 'o2');
    expect(logsIn(sent)).toContain('"logs":2');
    expect(last(sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    expect(last(sent, 'c1', 'world_response')?.replayed).toBeUndefined();
    await host.close();
  });

  it('the receipt outlives the process, so a reload recovers rather than re-spends', async () => {
    const first = await attached({ dir });
    await chop(first.host, 'r1', 'o1');
    await first.host.close();

    // A NEW HOST OVER THE SAME STORE: the page reloaded, the socket is new,
    // and the order it never heard about is sent again.
    const second = await attached({ dir });
    await chop(second.host, 'r1', 'o1');
    expect(last(second.sent, 'c1', 'world_response')).toMatchObject({ ok: true, replayed: true });
    expect(logsIn(second.sent)).toContain('"logs":1');
    await second.host.close();
  });

  it('two tabs holding the same order spend once between them', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c2', { type: 'attach', seat: 1 });
    await chop(host, 'r1', 'o1', 0, 'c1');
    await chop(host, 'r2', 'o1', 0, 'c2');
    expect(last(sent, 'c2', 'world_response')).toMatchObject({ ok: true, replayed: true });
    expect(logsIn(sent, 'c1')).toContain('"logs":1');
    await host.close();
  });

  it('one seat cannot replay another seat\'s order', async () => {
    const { host, sent } = await attached({ dir });
    await chop(host, 'r1', 'o1');
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c2', { type: 'attach', seat: 2 });
    await chop(host, 'r2', 'o1', 0, 'c2');
    // Seat 2's order ran, because seat 2 has no receipt under that name.
    expect(last(sent, 'c2', 'world_response')?.replayed).toBeUndefined();
    expect(logsIn(sent, 'c2')).toContain('"logs":2');
    await host.close();
  });

  it('a refused command leaves no receipt, so its repeat is free to run', async () => {
    const { host, sent, store } = await attached({ dir });
    await host.handleMessage('c1', {
      type: 'action',
      order: order('o1'),
      requestId: 'r1',
      action: 'yodel',
      args: {},
    });
    expect(last(sent, 'c1', 'world_response')?.ok).toBe(false);
    expect(store.receipt(devWorldPlayer(1), 'o1')).toBeUndefined();
    await host.close();
  });

  it('refuses an order it cannot identify, before anything is run', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', {
      type: 'action',
      order: { id: '', at: 0 },
      requestId: 'r1',
      action: 'chop',
      args: {},
    });
    expect(last(sent, 'c1', 'world_response')).toMatchObject({ ok: false, code: 'invalid-order' });
    expect(logsIn(sent)).toContain('"logs":0');
    await host.close();
  });

  it('says out loud when an order is too old to answer, and changes nothing', async () => {
    // A page that came back from a long time offline holding an unanswered
    // order. Its receipt, if it ever had one, has been swept.
    const clock = testClock();
    const budgets = worldBudgets({ receiptRetentionMs: 1_000 });
    const { host, sent } = await attached({ dir, clock, budgets });
    await chop(host, 'r1', 'o1', clock.now());
    clock.advance(60_000);
    // Any later command moves the floor past the swept window.
    await chop(host, 'r2', 'o2', clock.now());
    const before = logsIn(sent);

    await chop(host, 'r3', 'o1', clock.now() - 50_000);
    expect(last(sent, 'c1', 'world_response')).toMatchObject({
      ok: false,
      code: 'order-outcome-unknown',
    });
    expect(logsIn(sent)).toBe(before);
    await host.close();
  });
});

/**
 * #200: A WORLD ANYBODY IS IN CAN STILL GAIN A FEATURE.
 *
 * `stateVersion` was a veto and nothing else, so a season somebody was playing
 * could never move onto rules that read its state differently -- however
 * plainly the author could say how. These drive the whole of the answer
 * through the REAL host over a REAL store: a world launched under one version,
 * reopened by a bundle that declares the next, with its partitions and its
 * queued events transformed and made durable together.
 */
describe('#200: a world moving onto rules that read it differently', () => {
  it('records the version genesis wrote under, so a world is never asked to migrate to itself', async () => {
    await aPlayedVillage(worldBlock({ stateVersion: 2 }));
    const store = onDisk();
    expect(store.stateVersion()).toBe(2);
    store.close();
  });

  it('transforms every partition and every queued event, in one durable step', async () => {
    await aPlayedVillage();

    const migrated = worldBlock({
      stateVersion: 1,
      migration: {
        from: 0,
        // The world gains a second hearth number, and every log already cut
        // counts as one that was seasoned.
        partition: (element) => {
          (element as unknown as Hearth).burns += 10;
        },
        event: (event) => ({ ...event.args, seasoned: true }),
      },
    });
    const { host, store, sent } = await attached({ dir, definition: bundle({ world: migrated }) });

    expect(store.stateVersion()).toBe(1);
    expect(JSON.stringify(await store.read(HEARTH))).toContain('"burns":10');
    expect(store.pendingEvents()[0]?.args).toEqual({ seasoned: true });
    // AND THE WORLD IS PLAYABLE ON THE NEW RULES, from the migrated bytes.
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r3',
      action: 'chop',
      args: {},
    });
    // Two logs were cut before the migration (`chop` and `bank` each cut one),
    // so this is the third -- read out of the MIGRATED bytes.
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":3');
    await host.close();
  });

  it('answers what it moved, because a migration runs before anybody is in the world', async () => {
    // Nobody is attached when a world starts, so there is no socket to tell.
    // `start` answers instead, and the CLI says it in the terminal -- where
    // the person who published the new rules is standing.
    await aPlayedVillage();
    const migrated = worldBlock({ stateVersion: 1, migration: { from: 0, partition: () => {} } });
    const opened = openHost({ dir, definition: bundle({ world: migrated }) });
    expect(await opened.host.start()).toEqual({
      migrated: { from: 0, to: 1, partitions: 1, created: 0, events: 1 },
    });
    await opened.host.close();
  });

  /**
   * Start a played village under `world` and expect the start to refuse, with
   * every byte of the world -- and its recorded version -- exactly as it was.
   *
   * One helper because "nothing happened" is the same assertion whichever way
   * the start refused, and a second copy of it is a second chance for one of
   * them to stop checking that the world survived.
   */
  async function refusedStart(world: WorldDefinition, saying: RegExp): Promise<void> {
    const first = onDisk();
    const before = JSON.stringify(await first.read(HEARTH));
    first.close();

    const opened = openHost({ dir, definition: bundle({ world }) });
    await expect(opened.host.start()).rejects.toThrow(saying);
    await opened.host.close();

    const after = onDisk();
    expect(after.stateVersion()).toBe(0);
    expect(JSON.stringify(await after.read(HEARTH))).toBe(before);
    after.close();
  }

  it('REFUSES to start over a world it cannot read, leaving every byte alone', async () => {
    // A bumped version with no migration: the author's veto, still a veto.
    await aPlayedVillage();
    await refusedStart(worldBlock({ stateVersion: 3 }), /declare no migration/);
  });

  it('REFUSES a migration written for a different version rather than running it', async () => {
    await aPlayedVillage();
    const opened = openHost({
      dir,
      definition: bundle({
        world: worldBlock({ stateVersion: 2, migration: { from: 1, partition: () => {} } }),
      }),
    });
    await expect(opened.host.start()).rejects.toThrow(/one step/);
    await opened.host.close();
  });

  it('leaves the world untouched when the migration itself throws', async () => {
    // The author's own hook is the likeliest thing to fail, and a world half
    // through one is the state this contract exists to make unreachable.
    await aPlayedVillage();
    await refusedStart(
      worldBlock({
        stateVersion: 1,
        migration: {
          from: 0,
          partition: () => {
            throw new Error('the hearth is not what I thought it was');
          },
        },
      }),
      /not what I thought/,
    );
  });
});

/**
 * #218: A WORLD THAT OUTGREW ITS GENESIS.
 *
 * `genesis` runs once, at a world's first instant, and `migration.partition`
 * transforms a root that already exists -- it cannot answer more roots and has
 * nowhere to say what a new one hangs from. So an occupied world could gain a
 * feature (#200) but could never gain a ROOM: twelve empires could not become
 * five hundred, and one shared timeline could not become a region apiece,
 * without resetting everybody's saved colonies.
 *
 * Everything below runs through the real `LocalWorldHost` over a real SQLite
 * store, because the whole claim is about what is durable afterwards.
 */
describe('#218: adding durable partition roots to a world anybody is in', () => {
  /** One log banked on a slow burn: stored bytes and a queued event, both of
   *  which the upgrade has to leave standing. */
  const aBankedVillage = (world?: WorldDefinition) => aPlayedVillage(world, ['bank']);

  /** The upgrade Lacuna needs, in miniature: the hearth stays, and the world
   *  gains a root per region that genesis never built. */
  function withRegions(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
    return worldBlock({
      stateVersion: 1,
      migration: {
        from: 0,
        create: (game, ctx) =>
          Object.fromEntries(
            ['region:1', 'region:2']
              .filter((name) => !ctx.existing.includes(name))
              .map((name) => [name, game.create(Hearth, name) as GameElement]),
          ),
      },
      ...overrides,
    });
  }

  it('creates the new roots in the same durable step, with everything that was there', async () => {
    await aBankedVillage();
    const { host, store } = await attached({ dir, definition: bundle({ world: withRegions() }) });

    expect(store.stateVersion()).toBe(1);
    expect([...store.partitionNames()].sort()).toEqual([HEARTH, 'region:1', 'region:2']);
    // THE OLD WORLD SURVIVED IT: the log banked before the upgrade is still
    // banked, and the timer it armed is still queued.
    expect(JSON.stringify(await store.read(HEARTH))).toContain('"logs":1');
    expect(store.pendingEvents()).toHaveLength(1);
    await host.close();
  });

  it('reports how many roots it added, beside what it transformed', async () => {
    await aBankedVillage();
    const opened = openHost({ dir, definition: bundle({ world: withRegions() }) });
    expect(await opened.host.start()).toEqual({
      migrated: { from: 0, to: 1, partitions: 1, created: 2, events: 1 },
    });
    await opened.host.close();
  });

  it('is idempotent across a second start, because the hook filters ctx.existing', async () => {
    await aBankedVillage();
    const first = await attached({ dir, definition: bundle({ world: withRegions() }) });
    await first.host.close();

    // The same bundle again: the world is already on version 1, so no migration
    // runs at all -- and a THIRD version whose hook would build the same names
    // filters them out rather than replacing live partitions.
    const again = openHost({
      dir,
      definition: bundle({ world: withRegions({ stateVersion: 2, migration: {
        from: 1,
        create: (game, ctx) =>
          Object.fromEntries(
            ['region:1', 'region:2', 'region:3']
              .filter((name) => !ctx.existing.includes(name))
              .map((name) => [name, game.create(Hearth, name) as GameElement]),
          ),
      } }) }),
    });
    expect(await again.host.start()).toEqual({
      migrated: { from: 1, to: 2, partitions: 3, created: 1, events: 1 },
    });
    const store = onDisk();
    expect([...store.partitionNames()].sort()).toEqual([
      HEARTH, 'region:1', 'region:2', 'region:3',
    ]);
    store.close();
    await again.host.close();
  });

  it('refuses a root whose name the world already holds, and writes nothing', async () => {
    await aBankedVillage();
    const collides = worldBlock({
      stateVersion: 1,
      migration: {
        from: 0,
        create: (game) => ({ [HEARTH]: game.create(Hearth, 'a second hearth') as GameElement }),
      },
    });
    const opened = openHost({ dir, definition: bundle({ world: collides }) });
    await expect(opened.host.start()).rejects.toThrow(/already holds/);
    await opened.host.close();

    const store = onDisk();
    // THE WORLD IS EXACTLY AS IT WAS, on its old rules, playable.
    expect(store.stateVersion()).toBe(0);
    expect([...store.partitionNames()]).toEqual([HEARTH]);
    expect(JSON.stringify(await store.read(HEARTH))).toContain('"logs":1');
    store.close();
  });

  it('leaves the old roots and the old bytes when the create hook throws', async () => {
    await aBankedVillage();
    const broken = worldBlock({
      stateVersion: 1,
      migration: {
        from: 0,
        partition: (element) => {
          (element as unknown as Hearth).burns += 10;
        },
        create: () => {
          throw new Error('the region table is not ready');
        },
      },
    });
    const opened = openHost({ dir, definition: bundle({ world: broken }) });
    await expect(opened.host.start()).rejects.toThrow(/region table is not ready/);
    await opened.host.close();

    const store = onDisk();
    expect(store.stateVersion()).toBe(0);
    expect([...store.partitionNames()]).toEqual([HEARTH]);
    // NOT EVEN THE TRANSFORM LANDED: the migration is all or nothing, and the
    // hook that threw ran after every partition had been transformed in memory.
    expect(JSON.stringify(await store.read(HEARTH))).toContain('"burns":0');
    store.close();
  });

  /**
   * The ticket's own question: does widening the world need a second, separate
   * roster migration? It does not. The roster is the STORE's, not the bundle's;
   * `maxPlayers` is read from the compiled rules at construction and bounds who
   * may sit down, so raising it across an upgrade keeps every seated player
   * where they were and opens the seats above them.
   */
  it('a wider world keeps its seated players and opens the new seats', async () => {
    await aBankedVillage();
    const wider = withRegions({ maxPlayers: 40 });
    const { host, sent } = await attached({ dir, definition: bundle({ world: wider }) });

    // The player who was seated before the upgrade is still in their seat, and
    // the bytes they left are still in front of them.
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    // AND A SEAT THE OLD WORLD DID NOT HAVE can be taken and can act.
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c2', { type: 'attach', seat: 13 });
    await host.handleMessage('c2', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r13',
      action: 'chop',
      args: {},
    });
    expect(last(sent, 'c2', 'world_response')).toMatchObject({ ok: true });
    await host.close();
  });

  it('makes a new root reachable to an ordinary command afterwards', async () => {
    await aBankedVillage();
    const regionChop = worldAction<Village>('chopRegion')
      .prompt('Cut a log in a region')
      .needs(() => ['region:1'])
      .execute((_args, ctx) => {
        (ctx.world.partition('region:1') as Hearth).logs += 1;
        ctx.world.emit('region:1', { chopped: true });
      });
    const upgraded = withRegions({
      actions: [...VILLAGE_ACTIONS, regionChop],
      view: () => [HEARTH, 'region:1'],
    });
    const { host, store } = await attached({ dir, definition: bundle({ world: upgraded }) });
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r2',
      action: 'chopRegion',
      args: {},
    });
    expect(JSON.stringify(await store.read('region:1'))).toContain('"logs":1');
    await host.close();
  });
});

/**
 * #218: A ROOT BUILT THE FIRST TIME SOMEBODY REACHES FOR IT.
 *
 * The other half. Genesis running once means a 500-seat world had to pay for
 * 500 empires on the day it opened; `world.createPartition` lets a root come
 * into existence when a declaration first names it, and a mistyped name stays
 * the loud refusal it has always been.
 */
describe('#218: partitions created on first use', () => {
  const holdingOf = (seat: number) => `holding:${seat}`;

  const settle = worldAction<Village>('settle')
    .prompt('Found a holding')
    .needs(({ player }) => [holdingOf((player as { seat: number }).seat)])
    .execute((_args, ctx) => {
      const holding = ctx.world.partition(holdingOf(ctx.player.seat)) as Hearth;
      holding.logs += 1;
      ctx.world.emit(holdingOf(ctx.player.seat), { settled: ctx.player.seat });
    });

  const missing = worldAction<Village>('reachForNothing')
    .prompt('Name a partition that does not exist')
    .needs(() => ['nosuchroom'])
    .execute(() => {});

  function lazyWorld(): WorldDefinition {
    return worldBlock({
      actions: [...VILLAGE_ACTIONS, settle, missing],
      view: (seat) => [HEARTH, holdingOf(seat)],
      createPartition: (game, name) =>
        name.startsWith('holding:') ? (game.create(Hearth, name) as GameElement) : undefined,
    });
  }

  it('builds the root, stores it, and lets the command run', async () => {
    const { host, store } = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'settle',
      args: {},
    });
    expect([...store.partitionNames()].sort()).toEqual([HEARTH, holdingOf(1)]);
    expect(JSON.stringify(await store.read(holdingOf(1)))).toContain('"logs":1');
    await host.close();
  });

  it('reaches the SAME root a second time rather than building another', async () => {
    const first = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await first.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'settle',
      args: {},
    });
    await first.host.close();

    // A fresh host over the same store: the root is read back rather than
    // rebuilt, so the log cut into it is still there and gains a second.
    const again = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await again.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r2',
      action: 'settle',
      args: {},
    });
    expect([...again.store.partitionNames()].sort()).toEqual([HEARTH, holdingOf(1)]);
    expect(JSON.stringify(await again.store.read(holdingOf(1)))).toContain('"logs":2');
    await again.host.close();
  });

  it('still refuses a name the world does not create, so a typo stays loud', async () => {
    const { host, sent } = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'reachForNothing',
      args: {},
    });
    const answer = last(sent, 'c1', 'world_response');
    expect(answer).toMatchObject({ ok: false, code: 'partition-missing' });
    expect(answer?.message).toContain('nosuchroom');
    await host.close();
  });
});

/**
 * #223: A WORLD WRITTEN BEFORE THE CONSTRUCTION-ID FLOOR CAN STILL GROW.
 *
 * #218 parted the id space so a seat count can change without the wider
 * construction minting ids the stored partitions already hold -- and that
 * fixed every world written since, which is not the set of worlds anybody
 * cares about. A world written BEFORE it holds roots at ids like 14, because
 * that is where the old counter happened to be, and those are exactly the
 * worlds with a season in them worth keeping. Widening one still failed on the
 * FIRST adoption, before any migration hook could run -- at a moment no author
 * could have reached.
 *
 * The world under test is built the only honest way: by writing partitions at
 * pre-floor ids directly into the store, which is what the previous SDK left
 * behind. A fixture built through the current one would carry the floor and
 * miss the whole case, which is the mistake #218's own widening test made.
 */
describe('#223: lifting a world written before the construction-id floor', () => {
  /** The bytes the OLD SDK left: a hearth at id 14, holding a reference to a
   *  log at 15, exactly as a world serializes one (`{ __elementId }`). */
  function preFloorHearth(): StoredPartition {
    return {
      parentId: 0,
      json: {
        className: 'Hearth',
        id: 14,
        name: 'hearth',
        attributes: { logs: 3, burns: 0, marker: { __elementId: 15 }, seat: { __playerRef: 2 } },
        children: [
          { className: 'Hearth', id: 15, name: 'marker', attributes: { logs: 0, burns: 0 } },
        ],
      },
    };
  }

  /** A launched world holding those bytes and one queued event whose frozen
   *  arguments name an element by id. */
  async function aPreFloorWorld(): Promise<void> {
    const store = openWorldStore(worldStorePath(dir), worldBudgets());
    await store.createAll({ [HEARTH]: preFloorHearth() }, 0);
    store.close();
  }

  it('lifts every id and every reference above the floor, in one step', async () => {
    await aPreFloorWorld();
    const opened = openHost({ dir, definition: bundle() });
    const started = await opened.host.start();
    expect(started.lifted).toEqual({ offset: 1_000_000 - 14, partitions: 1, events: 0 });
    await opened.host.close();

    const store = openWorldStore(worldStorePath(dir), worldBudgets());
    const lifted = JSON.stringify(await store.read(HEARTH));
    // THE IDS MOVED, and by the smallest shift that clears the floor.
    expect(lifted).toContain('"id":1000000');
    expect(lifted).toContain('"id":1000001');
    // AND SO DID THE REFERENCE, or the world would wake up pointing at nothing.
    expect(lifted).toContain('"__elementId":1000001');
    // A SEAT IS NOT AN ELEMENT ID. Seat 2 is still seat 2 in a world that just
    // grew, which is the one number a blanket shift would have ruined.
    expect(lifted).toContain('"__playerRef":2');
    // AND THE GAME'S OWN DATA IS UNTOUCHED.
    expect(lifted).toContain('"logs":3');
    store.close();
  });

  it('lets the lifted world WIDEN, which is the case the whole ticket is about', async () => {
    await aPreFloorWorld();
    const wider = worldBlock({ maxPlayers: 40 });
    const { host, sent } = await attached({ dir, definition: bundle({ world: wider }) });

    // The world is playable on the wider rules, from the bytes it already had.
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":3');
    // AND A SEAT THE OLD WORLD DID NOT HAVE can be taken and can act.
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c2', { type: 'attach', seat: 13 });
    await host.handleMessage('c2', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r13',
      action: 'chop',
      args: {},
    });
    expect(last(sent, 'c2', 'world_response')).toMatchObject({ ok: true });
    await host.close();
  });

  it('is done ONCE: a second start finds a world already above the floor', async () => {
    await aPreFloorWorld();
    const first = openHost({ dir, definition: bundle() });
    expect((await first.host.start()).lifted).toBeDefined();
    await first.host.close();

    const again = openHost({ dir, definition: bundle() });
    expect((await again.host.start()).lifted).toBeUndefined();
    await again.host.close();
  });

  it('leaves a world written since the floor entirely alone', async () => {
    // The ordinary start, which must cost one comparison and no write.
    const opened = await attached({ dir });
    await opened.host.close();

    const again = openHost({ dir, definition: bundle() });
    expect((await again.host.start()).lifted).toBeUndefined();
    await again.host.close();
  });
});
