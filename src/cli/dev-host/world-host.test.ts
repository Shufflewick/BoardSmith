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
 * #201: A RULE EDIT STOPS THIS WORLD RATHER THAN BEING HALF-APPLIED.
 *
 * `boardsmith dev` loads the Node runtime once, before Vite, so an author's
 * saved rules reach the BROWSER through HMR and never reach the world. The two
 * then disagree in the worst way: the new surface offers a verb the old rules
 * do not have, or the new shape of one they do, and the world commits the
 * result -- a durable world made of two versions.
 */
describe('#201: rules that moved under a running world', () => {
  it('refuses a command and names the restart, leaving the world untouched', async () => {
    const { host, sent } = await attached({ dir });
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'chop',
      args: {},
    });
    const before = JSON.stringify(last(sent, 'c1', 'world_state')?.view);

    host.markRulesStale('src/rules/index.ts');
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r2',
      action: 'chop',
      args: {},
    });

    const answer = last(sent, 'c1', 'world_response');
    expect(answer?.ok).toBe(false);
    expect(answer?.message).toContain('src/rules/index.ts');
    expect(answer?.message).toContain('Restart `boardsmith dev`');
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toBe(before);
    await host.close();
  });

  it('says it once, however many times a file is saved', async () => {
    const { host, sent } = await attached({ dir });
    host.markRulesStale('src/rules/index.ts');
    host.markRulesStale('src/rules/index.ts');
    host.markRulesStale('src/rules/actions.ts');
    const notices = sent.filter((one) => one.message.type === 'world_notice');
    expect(notices).toHaveLength(1);
    await host.close();
  });
});
