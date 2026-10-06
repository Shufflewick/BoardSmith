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
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { createRequire } from 'node:module';

import {
  Game,
  Player,
  Space,
  type ActionDefinition,
  type GameOptions,
  type GameElement,
  WORLD_PARTITION_ID_FLOOR,
  PlayerFacingError,
} from '../../engine/index.js';
import {
  WorldRefusal,
  worldAction,
  worldBudgets,
  worldClockAction,
  WORLD_PRESENCE_DEFAULT_GRACE_MS,
  type WorldBudgets,
  type WorldDefinition,
  type WorldActionOffer,
  type WorldMigration,
} from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import type { WorldHostClock } from './node-world-clock.js';
import { LocalWorldHost, devWorldPlayer, type WorldDevRequest } from './world-host.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { worldElementIds } from '../../engine/element/element-ids.js';

/** Run SQL against a world store behind its back, for a state the store
 *  itself never writes. */
function execOnStore(path: string, ...statements: string[]): void {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void };
  };
  const db = new DatabaseSync(path);
  try {
    for (const sql of statements) db.exec(sql);
  } finally {
    db.close();
  }
}

/**
 * THE SAME STORE, AS LAYOUT 7 LEFT IT (#482).
 *
 * Layout 8 added the world's element id key and changed nothing else, so a
 * store without it, stamped 7, is layout 7 exactly -- a world whose ids are its
 * bare creation counter. Reached through SQLite directly, because the store
 * only ever writes the layout it is on.
 */
function rewindStoreToLayout7(path: string): void {
  execOnStore(
    path,
    "DELETE FROM meta WHERE key = 'elementIdKey'",
    "UPDATE meta SET value = '7' WHERE key = 'schemaVersion'",
  );
}

/**
 * A STAMP LOWERED BEHIND THE STORE'S BACK (#540). The store has no door that
 * writes a stamp on its own, so a host defect that lost one is reproduced
 * through SQLite directly.
 */
function lowerAllocationStamp(path: string, nextElementId: number): void {
  execOnStore(path, `UPDATE meta SET value = '${nextElementId}' WHERE key = 'nextElementId'`);
}

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

/**
 * WHAT THE HOST STAMPED ON THE LAST DISPATCH (ShufflewickPub #383).
 *
 * `world.activity` is only readable from inside a handler, so the two verbs
 * below copy it out here. A module-level box rather than an emitted payload
 * because the clock's road narrates to nobody in particular and the assertion
 * is about the stamp, not about the log.
 */
let seenActivity: unknown = 'never ran';

/** A seat looking at its own idleness -- the road a "you expire in N days"
 *  prompt travels. */
const look = worldAction<Village>('look')
  .prompt('Check how long you have been away')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    seenActivity = ctx.world.activity;
  });

/** A seat's command the world REFUSES, which must not count as activity. */
const overreach = worldAction<Village>('overreach')
  .prompt('Ask for something the world will not give')
  .needs(() => [HEARTH])
  .execute(() => {
    throw new PlayerFacingError('The village has nothing for you.');
  });

/** What both arming verbs do, written once: WHO arms the timer is the whole
 *  difference between them, and a copy per verb would hide that. */
const arms = (key: string, action: string, delayMs: number) => (_args: unknown, ctx: any) => {
  ctx.world.schedule({ delayMs, key, action, args: {} });
};

/** A seat arming its own deadline: the event's OWNER is the acting seat, which
 *  is what makes `reap` a recheck rather than a stranger's alarm. */
const armReap = worldAction<Village>('arm-reap')
  .prompt('Arm the reaper against yourself')
  .needs(() => [HEARTH])
  .execute(arms('reap', 'reap', 600_000));

/** A seat asking the WORLD to set the alarm, so the alarm the reaper answers to
 *  is owned by the world and not by the seat that started the chain. */
const armSow = worldAction<Village>('arm-sow')
  .prompt('Ask the world to set its own alarm')
  .needs(() => [HEARTH])
  .execute(arms('sow', 'sow', 300_000));

/** The CLOCK arming the clock: an event scheduled from inside a seatless
 *  handler is owned by the world, not by any player. */
const sow = worldClockAction<Village>('sow')
  .prompt('The world sets its own alarm')
  .needs(() => [HEARTH])
  .execute(arms('reap', 'reap', 600_000));

/** The irreversible deadline, rechecking the watermark as it fires. */
const reap = worldClockAction<Village>('reap')
  .prompt('Take the empire of whoever stopped playing')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    seenActivity = ctx.world.activity;
  });

/**
 * A verb that CREATES, which is the road #224 was about.
 *
 * `chop` mutates an attribute and mints nothing. Every case below was built out
 * of verbs like it, which is why no test grew a partition, checkpointed, and
 * rebuilt the runner -- the one sequence that proved the stamp was being lost.
 */
const stack = worldAction<Village>('stack')
  .prompt('Stack the logs where they fell')
  .needs(() => [HEARTH])
  .execute((_args, ctx) => {
    const hearth = ctx.world.partition(HEARTH) as Hearth;
    hearth.create(Hearth, `pile-${hearth.logs}`);
    hearth.logs += 1;
  });

const VILLAGE_ACTIONS: readonly ActionDefinition[] = [chop, bank, burn, stack];

/** The #383 verbs are their own bundle: adding them to the village would change
 *  what every other case here sees this world answer to. */
const ACTIVITY_ACTIONS: readonly ActionDefinition[] = [
  chop,
  look,
  overreach,
  armReap,
  armSow,
  sow,
  reap,
];

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
function testClock(): WorldHostClock & { advance(ms: number): void; fireArmed(): void; armedDelay: number | null } {
  let now = 1_000_000;
  let armed: { delayMs: number; fire: () => void } | null = null;
  return {
    now: () => now,
    arm(delayMs, fire) {
      armed = delayMs === null ? null : { delayMs, fire };
    },
    yieldTurn: () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      }),
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

/** The `stack` verb, sent once as a page sends it. */
function stackOrder(requestId: string): WorldDevRequest {
  return { type: 'action', order: nextOrder(), requestId, action: 'stack', args: {} };
}

interface Sent {
  clientId: string;
  message: Record<string, unknown>;
}

function openHost(options: {
  dir: string;
  definition?: ConstructorParameters<typeof LocalWorldHost>[0]['definition'];
  clock?: WorldHostClock;
  budgets?: WorldBudgets;
  hostWork?: ConstructorParameters<typeof LocalWorldHost>[0]['hostWork'];
}): {
  host: LocalWorldHost;
  store: LocalWorldStore;
  sent: Sent[];
  /** A socket going away the way `dev-world.ts` reports one: shut at once,
   *  and the host told. Answers the host's departure, still queued. */
  drop: (clientId: string) => Promise<void>;
} {
  const budgets = options.budgets ?? worldBudgets();
  const store = openWorldStore(worldStorePath(options.dir), budgets);
  const sent: Sent[] = [];
  const shut = new Set<string>();
  const host = new LocalWorldHost({
    definition: options.definition ?? bundle(),
    worldName: 'Village',
    seed: 'seed',
    budgets,
    store,
    clock: options.clock ?? testClock(),
    ...(options.hostWork === undefined ? {} : { hostWork: options.hostWork }),
    send: (clientId, message) => sent.push({ clientId, message: message as Record<string, unknown> }),
    isOpen: (clientId) => !shut.has(clientId),
  });
  const drop = (clientId: string): Promise<void> => {
    shut.add(clientId);
    return host.disconnect(clientId);
  };
  return { host, store, sent, drop };
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
  dir = tempTree('bs-world-host-');
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

describe("#482: the world's ids are keyed by the key its store holds", () => {
  it('mints opaque ids, read back to counter values only with the stored key', async () => {
    const opened = await attached({ dir });
    const hearth = (await opened.store.read(HEARTH))!;
    const id = (hearth.json as { id: number }).id;
    expect(id).not.toBe(WORLD_PARTITION_ID_FLOOR);
    expect(worldElementIds(opened.store.elementIdKey()).cursorOf(id)).toBe(WORLD_PARTITION_ID_FLOOR);
    await opened.host.close();
  });

  it('serves the same ids after a restart, because the key comes back out of the store', async () => {
    const first = await attached({ dir });
    await first.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    const before = JSON.stringify(last(first.sent, 'c1', 'world_state')?.view);
    await first.host.close();

    const second = await attached({ dir });
    const after = JSON.stringify(last(second.sent, 'c1', 'world_state')?.view);
    expect(after).toBe(before);
    await second.host.close();
  });

  it('never sends the key to a page, through any seat', async () => {
    const opened = await attached({ dir });
    const key = opened.store.elementIdKey();
    await opened.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'chop', args: {} });
    await opened.host.handleMessage('c2', { type: 'hello' });
    await opened.host.handleMessage('c2', { type: 'attach', seat: 2 });
    await opened.host.handleMessage('c2', { type: 'action', order: nextOrder(), requestId: 'r2', action: 'chop', args: {} });

    expect(opened.sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(opened.sent)).not.toContain(key);
    await opened.host.close();
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
    // ON ITS OWN FRAME, BEHIND THE VIEW (#244).
    const offers = last(sent, 'c1', 'world_offers')?.actions as Array<{ name: string }>;
    expect(offers.map((o) => o.name)).toEqual(['bank', 'chop', 'stack']);
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

/**
 * A WORLD THAT WRITES DOWN EVERY PRESENCE TRANSITION IT IS TOLD, as
 * `arrive:<seat>` or `depart:<seat>`. `greet` and `farewell` are the two hooks a
 * case may name in its declaration.
 */
function presenceWorld(presence: WorldDefinition['presence']) {
  const told: string[] = [];
  const transition = (name: string) =>
    worldClockAction<Village>(name)
      .prompt(`The clock tells the world a seat ${name === 'greet' ? 'arrived' : 'left'}`)
      .needs(() => [HEARTH])
      .execute((args) => {
        told.push(`${args.present === true ? 'arrive' : 'depart'}:${String(args.seat)}`);
      });
  const definition = bundle({
    world: worldBlock({
      actions: [...VILLAGE_ACTIONS, transition('greet'), transition('farewell')],
      presence,
    }),
  });
  return { told, definition };
}

/**
 * THE DEPARTURE TIMERS, UNDER THE TEST'S HAND. A departure waits out a real
 * grace (a minute by default, #338), so the cases below fake `setTimeout` and
 * move it forward rather than waiting. Nothing else is faked: the world's own
 * clock is `testClock`, and `setImmediate` still turns.
 */
function fakeDepartureTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Moves the departure timers `ms` forward (the default grace unless told
 *  otherwise), then waits for what they queued behind the world lock. */
async function afterDepartureTimers(
  host: LocalWorldHost,
  ms: number = WORLD_PRESENCE_DEFAULT_GRACE_MS,
): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await host.settled();
}

/** Seat 1, the only seat the world was told arrived, departs exactly one
 *  default grace from now: not a millisecond sooner. */
async function expectSeat1DepartsAfterTheGrace(host: LocalWorldHost, told: readonly string[]): Promise<void> {
  await afterDepartureTimers(host, WORLD_PRESENCE_DEFAULT_GRACE_MS - 1);
  expect(told).toEqual(['arrive:1']);
  await afterDepartureTimers(host, 1);
  expect(told).toEqual(['arrive:1', 'depart:1']);
}

/**
 * #331: AN ARRIVAL IS A SEAT GOING FROM NO OPEN SOCKET TO ONE.
 *
 * The platform's rule, which this host must match so an author's `onArrive`
 * runs as often here as it does in production (ShufflewickPub
 * `games/src/world-presence-policy.ts`): the world is told a seat arrived only
 * when the seat had no other socket, a return within the departure grace is a
 * flap nobody is told about, and per seat arrivals and departures alternate.
 */
describe('#331: an arrival is a seat going from no open socket to one', () => {
  fakeDepartureTimers();

  it('a page that says hello and then attaches to the seat it holds arrives once', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet' });
    const { host } = await attached({ dir, definition });

    await host.handleMessage('c1', { type: 'attach', seat: 1 });
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('a second tab on an open seat is not an arrival, and its closing is not a departure', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet', onDepart: 'farewell' });
    const { host, drop } = await attached({ dir, definition });

    await host.handleMessage('c2', { type: 'attach', seat: 1 });
    await drop('c2');
    await afterDepartureTimers(host);
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('a tab moving onto a seat another tab holds is not an arrival there', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet' });
    const { host } = await attached({ dir, definition });
    await host.handleMessage('c2', { type: 'hello' });

    await host.handleMessage('c2', { type: 'attach', seat: 1 });
    expect(told).toEqual(['arrive:1', 'arrive:2']);
    await host.close();
  });

  it('the last socket leaving and returning within the grace is a flap: no departure, no second arrival', async () => {
    const { told, definition } = presenceWorld({
      onArrive: 'greet',
      onDepart: 'farewell',
      departGraceMs: 60_000,
    });
    const { host, drop } = await attached({ dir, definition });

    await drop('c1');
    await host.handleMessage('c2', { type: 'hello' });
    await afterDepartureTimers(host);
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('a return already queued when the departure comes due is a flap, whichever reaches the lock first', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet', onDepart: 'farewell' });
    const { host, drop } = await attached({ dir, definition });

    // The return is queued as the grace runs out: the departure's timer may
    // fire before or after the return is seated, and neither order may tell
    // the world the seat left while a page holds it.
    await drop('c1');
    await vi.advanceTimersByTimeAsync(WORLD_PRESENCE_DEFAULT_GRACE_MS - 1);
    const returning = host.handleMessage('c2', { type: 'hello' });
    await afterDepartureTimers(host, 1);
    await returning;
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('a return after the departure was delivered is a new arrival', async () => {
    const { told, definition } = presenceWorld({
      onArrive: 'greet',
      onDepart: 'farewell',
      departGraceMs: 1_000,
    });
    const { host, drop } = await attached({ dir, definition });

    await drop('c1');
    await afterDepartureTimers(host, 1_000);
    await host.handleMessage('c2', { type: 'hello' });
    expect(told).toEqual(['arrive:1', 'depart:1', 'arrive:1']);
    await host.close();
  });

  it('with no onDepart, a return is an arrival only once the seat was gone for the grace', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet', departGraceMs: 60_000 });
    const clock = testClock();
    const { host, drop } = await attached({ dir, definition, clock });

    await drop('c1');
    clock.advance(59_999);
    await host.handleMessage('c2', { type: 'hello' });
    expect(told).toEqual(['arrive:1']);

    await drop('c2');
    clock.advance(60_000);
    await host.handleMessage('c3', { type: 'hello' });
    expect(told).toEqual(['arrive:1', 'arrive:1']);
    await host.close();
  });
});

/**
 * #338: THE DEPARTURE GRACE IS THE PLATFORM'S, DEFAULT AND BOUNDS.
 *
 * With no declared grace this host used 0, so a page reload was a departure
 * and a new arrival locally and a flap in production. example-rts declares
 * `presence: { onArrive: 'settle' }` with no grace, and re-ran `settle` on
 * every reload in dev and never on the platform.
 */
describe('#338: the departure grace is the platform grace', () => {
  fakeDepartureTimers();

  it('an undeclared grace is a minute: a departure is delivered only once the seat was empty that long', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet', onDepart: 'farewell' });
    const { host, drop } = await attached({ dir, definition });

    await drop('c1');
    await expectSeat1DepartsAfterTheGrace(host, told);
    await host.close();
  });

  it('an arrive-only world with no declared grace does not arrive again when a page reloads', async () => {
    const { told, definition } = presenceWorld({ onArrive: 'greet' });
    const clock = testClock();
    const { host, drop } = await attached({ dir, definition, clock });

    // A reload: the socket closes and a new one says hello a moment later.
    await drop('c1');
    clock.advance(1_000);
    await host.handleMessage('c2', { type: 'hello' });
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it.each([0, 500, 24 * 60 * 60 * 1000 + 1])(
    'refuses a declared grace of %sms at start, as the platform does, before anything is written',
    async (departGraceMs) => {
      const { definition } = presenceWorld({ onArrive: 'greet', departGraceMs });
      const { host, store } = openHost({ dir, definition });

      await expect(host.start()).rejects.toThrow(
        /world\.presence\.departGraceMs.*1000 through 86400000 milliseconds/s,
      );
      expect(store.isLaunched()).toBe(false);
      await host.close();
    },
  );
});

/**
 * #339: WHAT THE WORLD WAS TOLD OUTLIVES THE HOST THAT TOLD IT.
 *
 * A rule edit closes this host and opens a new one over the same store, and
 * restarting `boardsmith dev` does the same. The record of which seats the
 * world believes present is kept in that store, as the platform keeps it in
 * its Durable Object (ShufflewickPub `games/src/world-presence-ledger.ts`),
 * so a page that comes back is not announced again. Seats that do not come
 * back are reconciled at start the way the platform reconciles at a wake: the
 * grace is measured from the start, because nobody can say how long they have
 * been gone.
 */
describe('#339: the told-present record is kept in the world store', () => {
  fakeDepartureTimers();

  /**
   * A world with a page on seat 1, closed and opened again on the same store
   * and clock: a rule reload, or `boardsmith dev` restarted. `meanwhile` runs
   * against the first host before it closes. Answers the second host, started
   * and with no page open yet.
   */
  async function acrossARestart(
    presence: WorldDefinition['presence'],
    meanwhile: (first: ReturnType<typeof openHost>, clock: ReturnType<typeof testClock>) => Promise<void> = async () => {},
  ) {
    const { told, definition } = presenceWorld(presence);
    const clock = testClock();
    const first = await attached({ dir, definition, clock });
    await meanwhile(first, clock);
    await first.host.close();
    const { host } = openHost({ dir, definition, clock });
    await host.start();
    return { told, clock, host };
  }

  it('a page that comes back after a reload is not announced again, and does not depart', async () => {
    const { told, host } = await acrossARestart({ onArrive: 'greet', onDepart: 'farewell' });

    await host.handleMessage('c1', { type: 'hello' });
    await afterDepartureTimers(host);
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('an arrive-only world does not announce a page that comes back after a reload', async () => {
    const { told, clock, host } = await acrossARestart({ onArrive: 'greet' });

    clock.advance(2_000);
    await host.handleMessage('c1', { type: 'hello' });
    expect(told).toEqual(['arrive:1']);
    await host.close();
  });

  it('a seat nobody brings back departs one grace after the host started, and its return is an arrival', async () => {
    const { told, host } = await acrossARestart({ onArrive: 'greet', onDepart: 'farewell' });

    await expectSeat1DepartsAfterTheGrace(host, told);

    await host.handleMessage('c1', { type: 'hello' });
    expect(told).toEqual(['arrive:1', 'depart:1', 'arrive:1']);
    await host.close();
  });

  it('a departure still waiting out its grace when the host closed is owed after the restart', async () => {
    const { told, host } = await acrossARestart(
      { onArrive: 'greet', onDepart: 'farewell' },
      async (first) => {
        await first.drop('c1');
      },
    );

    await afterDepartureTimers(host);
    expect(told).toEqual(['arrive:1', 'depart:1']);
    await host.close();
  });

  it('an arrive-only world counts an absence nobody saw end from the start, and keeps one it saw begin', async () => {
    // Seat 1 was open when the host closed: its absence is measured from the
    // restart. Seat 2 had already gone, and its own instant is kept, because it
    // is older and truer than the restart.
    const { told, clock, host } = await acrossARestart({ onArrive: 'greet' }, async (first, firstClock) => {
      await first.host.handleMessage('c2', { type: 'hello' });
      await first.drop('c2');
      firstClock.advance(30_000);
    });

    clock.advance(30_000);
    await host.handleMessage('c3', { type: 'attach', seat: 2 });
    await host.handleMessage('c4', { type: 'attach', seat: 1 });
    expect(told).toEqual(['arrive:1', 'arrive:2', 'arrive:2']);
    await host.close();
  });
});

/**
 * #284: A SOCKET THAT DIED ABRUPTLY COSTS THE SEATS THAT REMAIN NOTHING.
 *
 * The reported wedge: driver processes killed mid-command left a dev host whose
 * port answered and whose commands never settled. What it was doing was work
 * for the dead. Every message ends in a push that enumerates the offers of
 * every attached seat, one after another, and on a real world one walk runs to
 * seconds -- and the host kept walking the killed seats until their queued
 * departure finally reached the world lock, never looking up in between, so
 * not even a close could be noticed until the whole push was over.
 *
 * `warm` is offered to every seat, and its condition writes down which seat's
 * offers were being walked. That list is the cost this ticket is about.
 */
describe('#284: an abruptly closed connection is not worked for', () => {
  /** `onWalk`, when given, runs inside each seat's walk, after it is counted:
   *  the place a case stands to make something happen mid-push. */
  function counting(onWalk?: (seat: number) => void) {
    const walked: number[] = [];
    const warm = worldAction<Village>('warm')
      .prompt('Warm your hands')
      .condition({
        'counted as walked': (ctx) => {
          walked.push(ctx.player.seat);
          onWalk?.(ctx.player.seat);
          return true;
        },
      })
      .needs(() => [HEARTH])
      .execute(() => {});
    const definition = bundle({ world: worldBlock({ actions: [...VILLAGE_ACTIONS, warm] }) });
    return { walked, definition };
  }

  it('stops walking, projecting and presenting a seat the moment its socket closes', async () => {
    const { walked, definition } = counting();
    const { host, sent, drop } = await attached({ dir, definition });
    await host.handleMessage('c2', { type: 'hello' });
    walked.length = 0;
    const before = sent.length;

    // c1's command is received first and c2's socket dies while it is still
    // queued: the order a killed driver produces against a busy host.
    const acting = host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'chop',
      args: {},
    });
    const leaving = drop('c2');
    await Promise.all([acting, leaving]);

    expect(last(sent, 'c1', 'world_response')).toMatchObject({ requestId: 'r1', ok: true });
    expect(walked).not.toContain(2);
    expect(sent.slice(before).filter((frame) => frame.clientId === 'c2')).toEqual([]);
    // The very first frame c1 is sent after the close already says who is here.
    const firstState = sent.slice(before).find(
      (frame) => frame.clientId === 'c1' && frame.message.type === 'world_state',
    );
    expect(firstState?.message.presence).toEqual([1]);
    await host.close();
  });

  it('notices a close that arrives while an earlier seat is being walked', async () => {
    // THE KILL LANDS MID-PUSH. A close is an I/O callback, so it can never run
    // inside a walk; it runs on a later turn of the event loop. It is modelled
    // as a turn queued from inside seat 1's own walk, which is queued before
    // any turn the host takes afterwards, so it has run by the time seat 2's
    // turn comes -- on every run, however fast the walks are. A host that never
    // yields between seats reaches seat 3 before that turn, and walks it.
    // (#286: this case used to poll from a zero-delay interval, whose timer
    // cannot fire again for a millisecond, longer than a whole three-seat push.)
    let killed = false;
    let armed = false;
    let drop: (clientId: string) => Promise<void> = async () => {};
    const { walked, definition } = counting((seat) => {
      if (!armed || killed || seat !== 1) return;
      killed = true;
      setImmediate(() => {
        void drop('c3');
      });
    });
    const opened = await attached({ dir, definition });
    const { host } = opened;
    drop = opened.drop;
    await host.handleMessage('c2', { type: 'hello' });
    await host.handleMessage('c3', { type: 'hello' });
    walked.length = 0;

    // A push walks in seat order, and this one starts with seat 1.
    armed = true;
    await host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'chop',
      args: {},
    });
    await host.settled();

    expect(killed).toBe(true);
    expect(walked).toContain(1);
    expect(walked).not.toContain(3);
    await host.close();
  });

  it('seats nobody for a connection that closed before its hello ran', async () => {
    const { walked, definition } = counting();
    const { host, store, sent, drop } = await attached({ dir, definition });
    walked.length = 0;

    const greeting = host.handleMessage('c2', { type: 'hello' });
    const leaving = drop('c2');
    await Promise.all([greeting, leaving]);

    // THE ROSTER IS DURABLE, so a chair granted to a page that was already
    // gone is a chair held by nobody forever.
    expect(store.seats().map((row) => row.seat)).toEqual([1]);
    expect(walked).not.toContain(2);
    expect(sent.filter((frame) => frame.clientId === 'c2')).toEqual([]);
    await host.close();
  });

  it('still applies an order its connection sent before dying', async () => {
    const { host, sent, drop } = await attached({ dir });
    await host.handleMessage('c2', { type: 'hello' });

    // RECEIVED IS RECEIVED. The order carries a durable identity (#195), so the
    // player's next page can ask again and be answered from its receipt; what
    // must not happen is a command that silently did or did not run depending
    // on how fast a socket died.
    const acting = host.handleMessage('c2', {
      type: 'action',
      order: { id: 'dying-order', at: 0 },
      requestId: 'r1',
      action: 'chop',
      args: {},
    });
    const leaving = drop('c2');
    await Promise.all([acting, leaving]);

    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"logs":1');
    await host.close();
  });
});

/**
 * ShufflewickPub #378: THE PANEL RE-ASKS ONE PICK, AND THE HOST ANSWERS.
 *
 * The end-to-end half. A world's offer is enumerated with nothing bound, so a
 * `multiSelect` that reads `args.size` resolved to the unbounded fallback and
 * the browser was handed a cap the game never meant. The wire carries a re-ask
 * now, and this drives it the way a browser does: the same message, the same
 * host, the same answer.
 */
/**
 * A READ CHANGES NOTHING, which is the same assertion for every read this host
 * answers: a re-asked pick (#378) and a quoted draft (#248) both run over the
 * world and neither may move it. The BYTES are compared rather than a projection,
 * and the dirty set beside them -- a write the store has not been told about yet
 * is still a write.
 */
async function changesNothing(store: LocalWorldStore, read: () => Promise<void>): Promise<void> {
  const before = JSON.stringify(await store.read(HEARTH));
  await read();
  expect(JSON.stringify(await store.read(HEARTH))).toBe(before);
  expect(store.dirtyPartitions()).toEqual([]);
}

describe('#378: one pick, re-asked with the args bound so far', () => {
  const stack = worldAction<Village>('stack')
    .prompt('Stack the hearth')
    .needs(() => [HEARTH])
    .chooseFrom('size', { prompt: 'How big a stack?', choices: ['small', 'big'] })
    .chooseFrom('logs', {
      prompt: 'Which logs?',
      choices: ['oak', 'ash', 'elm'],
      multiSelect: ({ args }) => {
        const size = args.size as string | undefined;
        if (size === undefined) return { min: 1 };
        return { min: 1, max: size === 'big' ? 3 : 1 };
      },
    })
    .execute(() => {});

  const stacking = () => bundle({ world: worldBlock({ actions: [...VILLAGE_ACTIONS, stack] }) });

  it('answers the cap the chosen size decides, which the offer could not know', async () => {
    const { host, sent } = await attached({ dir, definition: stacking() });

    // WHAT THE OFFER SAID with nothing bound: no upper bound at all, and said
    // by OMISSION rather than by a number the wire cannot carry.
    const offered = (last(sent, 'c1', 'world_offers')!.actions as WorldActionOffer[])
      .find((offer) => offer.name === 'stack')!
      .selections.find((pick) => pick.name === 'logs')!;
    expect(JSON.parse(JSON.stringify(offered.multiSelect))).toEqual({ min: 1 });

    await host.handleMessage('c1', {
      type: 'pick',
      requestId: 'p1',
      action: 'stack',
      selection: 'logs',
      args: { size: 'big' },
    });

    const answer = last(sent, 'c1', 'world_pick_result')!;
    expect(answer.ok).toBe(true);
    expect((answer.selection as { multiSelect: unknown }).multiSelect).toEqual({ min: 1, max: 3 });
    await host.close();
  });

  it('answers the OTHER cap for the other size, from the same offer', async () => {
    const { host, sent } = await attached({ dir, definition: stacking() });

    await host.handleMessage('c1', {
      type: 'pick',
      requestId: 'p1',
      action: 'stack',
      selection: 'logs',
      args: { size: 'small' },
    });

    expect((last(sent, 'c1', 'world_pick_result')!.selection as { multiSelect: unknown })
      .multiSelect).toEqual({ min: 1, max: 1 });
    await host.close();
  });

  it('changes nothing: a pick is a question, and the world is where it was', async () => {
    const { host, store } = await attached({ dir, definition: stacking() });

    await changesNothing(store, () =>
      host.handleMessage('c1', {
        type: 'pick',
        requestId: 'p1',
        action: 'stack',
        selection: 'logs',
        args: { size: 'big' },
      }),
    );
    await host.close();
  });

  it('refuses a pick from a page holding no seat, without running anything', async () => {
    const opened = openHost({ dir, definition: stacking() });
    await opened.host.start();

    await opened.host.handleMessage('c9', {
      type: 'pick',
      requestId: 'p1',
      action: 'stack',
      selection: 'logs',
      args: { size: 'big' },
    });

    expect(last(opened.sent, 'c9', 'world_pick_result')).toMatchObject({ ok: false });
    await opened.host.close();
  });

  it('names the selections it DOES have when asked for one it does not', async () => {
    const { host, sent } = await attached({ dir, definition: stacking() });

    await host.handleMessage('c1', {
      type: 'pick',
      requestId: 'p1',
      action: 'stack',
      selection: 'kindling',
      args: { size: 'big' },
    });

    const answer = last(sent, 'c1', 'world_pick_result')!;
    expect(answer.ok).toBe(false);
    expect(answer.message).toMatch(/kindling/);
    expect(answer.message).toMatch(/"size", "logs"/);
    await host.close();
  });
});

/**
 * #248: THE HOST PRICES A DRAFT, AND CHANGES NOTHING DOING IT.
 *
 * The end-to-end half of the quote road. A world action that charges for a typed
 * number could not tell the player the total before the charge: the offer is
 * enumerated with nothing bound, and nothing else on this wire carries a value
 * the player has typed and not submitted. The `quote` message does, and this
 * drives it the way a browser does -- the same message, the same host, the same
 * answer -- including the one thing that must remain true throughout: the world
 * is exactly where it was.
 */
describe('#248: the draft in front of the player, priced by the game', () => {
  /** Logs at five each, with an omitted quantity meaning one. */
  const buy = worldAction<Village>('buy')
    .prompt('Buy logs')
    .needs(() => [HEARTH])
    .enterNumber('logs', { prompt: 'How many?', min: 0, integer: true, optional: 'just the one' })
    .quote(({ logs }, { world }) => {
      const many = logs === undefined ? 1 : logs;
      const hearth = world.partition(HEARTH) as Hearth;
      return [`${many * 5} coins`, `the hearth would hold ${hearth.logs + many}`];
    })
    .execute(({ logs }, ctx) => {
      const many = logs === undefined ? 1 : logs;
      (ctx.world.partition(HEARTH) as Hearth).logs += many;
    });

  const buying = () => bundle({ world: worldBlock({ actions: [...VILLAGE_ACTIONS, buy] }) });

  /** Ask what a draft costs, the way a browser does. */
  const priceOf = (
    host: { handleMessage: (client: string, message: WorldDevRequest) => Promise<void> },
    args: Record<string, unknown>,
    action = 'buy',
    clientId = 'c1',
  ) => host.handleMessage(clientId, { type: 'quote', requestId: 'q1', action, args });

  it('tells the seat the action quotes, on the offer itself', async () => {
    const { host, sent } = await attached({ dir, definition: buying() });

    const offers = last(sent, 'c1', 'world_offers')!.actions as WorldActionOffer[];
    expect(offers.find((offer) => offer.name === 'buy')!.quote).toBe(true);
    expect(offers.find((offer) => offer.name === 'chop')!.quote).toBeUndefined();
    await host.close();
  });

  it('prices a quantity the player has typed and not submitted', async () => {
    const { host, sent } = await attached({ dir, definition: buying() });

    await priceOf(host, { logs: 3 });

    const answer = last(sent, 'c1', 'world_quote_result')!;
    expect(answer.ok).toBe(true);
    expect(answer.quote).toEqual(['15 coins', 'the hearth would hold 3']);
    await host.close();
  });

  it('prices an OMITTED quantity as the game\'s own default', async () => {
    const { host, sent } = await attached({ dir, definition: buying() });

    await priceOf(host, {});

    expect(last(sent, 'c1', 'world_quote_result')!.quote).toEqual([
      '5 coins',
      'the hearth would hold 1',
    ]);
    await host.close();
  });

  it('prices a ZERO quantity as zero, which is a different answer', async () => {
    const { host, sent } = await attached({ dir, definition: buying() });

    await priceOf(host, { logs: 0 });

    expect(last(sent, 'c1', 'world_quote_result')!.quote).toEqual([
      '0 coins',
      'the hearth would hold 0',
    ]);
    await host.close();
  });

  it('changes nothing: being quoted is not buying', async () => {
    const { host, store } = await attached({ dir, definition: buying() });

    await changesNothing(store, () => priceOf(host, { logs: 9 }));
    await host.close();
  });

  it('refuses a quote from a page holding no seat, without running anything', async () => {
    const opened = openHost({ dir, definition: buying() });
    await opened.host.start();

    await priceOf(opened.host, { logs: 1 }, 'buy', 'c9');

    expect(last(opened.sent, 'c9', 'world_quote_result')).toMatchObject({ ok: false });
    await opened.host.close();
  });

  it('refuses to price an action that declares no quote', async () => {
    const { host, sent } = await attached({ dir, definition: buying() });

    await priceOf(host, {}, 'chop');

    const answer = last(sent, 'c1', 'world_quote_result')!;
    expect(answer.ok).toBe(false);
    expect(answer.message).toMatch(/chop/);
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

  /** The ten-minute burn is on the armed timer, and firing that timer -- not
   *  "fire due events now" -- is what runs it. */
  async function burnsWhenArmedTimerFires(
    host: LocalWorldHost,
    sent: Sent[],
    clock: ReturnType<typeof testClock>,
  ): Promise<void> {
    expect(clock.armedDelay).toBe(600_000);
    clock.advance(600_000);
    clock.fireArmed();
    await host.settled();
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":1');
    await host.close();
  }

  it('arms a timer for the event a command scheduled, and runs it when it comes due', async () => {
    const { host, sent, clock } = await banked();
    expect(JSON.stringify(last(sent, 'c1', 'world_state')?.view)).toContain('"burns":0');
    await burnsWhenArmedTimerFires(host, sent, clock);
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

  it('arms a timer for the event an ARRIVAL scheduled, with no command after it (#327)', async () => {
    // The bundle's `onArrive` verb is issued by the clock, not by a seat, so
    // the re-arm this proves is `clockCommand`'s, not `command`'s.
    const kindle = worldClockAction<Village>('kindle')
      .prompt('A seat arrives and the fire is laid')
      .needs(() => [HEARTH])
      .execute((_args, ctx) => {
        ctx.world.schedule({ delayMs: 600_000, action: 'burn', args: {} });
      });
    const clock = testClock();
    const { host, sent } = await attached({
      dir,
      clock,
      definition: bundle({
        world: worldBlock({ actions: [...VILLAGE_ACTIONS, kindle], presence: { onArrive: 'kindle' } }),
      }),
    });
    await burnsWhenArmedTimerFires(host, sent, clock);
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
          isOpen: () => true,
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
      'This world has no action named "yodel". It answers to: chop, bank, burn, stack.',
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

  /** Every element id inside one stored partition's bytes. */
  function idsIn(json: unknown): number[] {
    if (typeof json !== 'object' || json === null) return [];
    const node = json as { id?: unknown; children?: unknown[] };
    const here = typeof node.id === 'number' ? [node.id] : [];
    return [...here, ...(node.children ?? []).flatMap((child) => idsIn(child))];
  }

  /**
   * ShufflewickPub #377: A COLD HOST MINTS OUTSIDE EVERY STORED ROOT.
   *
   * The case #218 opened and did not close. A host that builds a root on demand
   * mints its ids from the game's counter, and a COLD host's counter starts at
   * the construction floor and is only ever raised by what it happens to adopt.
   * So the second host to create a root built it on top of the identity of a
   * root the first host had created and this one had never loaded -- and the
   * world stayed playable until some later command declared both, at which
   * point adoption refused and the world was finished.
   *
   * The stamp is durable state now: written in the same transaction as the
   * bytes it was minted for, read back at the next build.
   */
  /**
   * #224: A COMMAND MINTS TOO, SO A CHECKPOINT CARRIES THE STAMP.
   *
   * #377 wrote the stamp on three roads and left out the fourth: an ordinary
   * `create()` inside an action's `execute` advances the same counter. A host
   * that stored the grown bytes and kept its older number was then refused, on
   * the next restart, by the very partition it had itself just written.
   */
  it('restarts on a world an ordinary command grew', async () => {
    const first = await attached({ dir, definition: bundle() });
    await first.host.handleMessage('c1', stackOrder('r1'));
    expect(last(first.sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    const grown = first.store.nextElementId()!;
    await first.host.close();

    // The stamp moved with the bytes, so the next host is built ABOVE what its
    // own store holds rather than below it.
    const second = await attached({ dir, definition: bundle() });
    expect(second.store.nextElementId()).toBe(grown);
    await second.host.handleMessage('c1', stackOrder('r2'));

    expect(last(second.sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    await second.host.close();
  });

  it('refuses a stamp standing below its own bytes, and leaves it as it found it (#540)', async () => {
    // No world this host can open was written by the r51-r58 hosts that left
    // such a stamp behind (#224), so a stale stamp on a current world is a NEW
    // host defect. Repairing it quietly on the next run would hide that defect;
    // the world refuses instead, and says it is the host's to report.
    const first = await attached({ dir, definition: bundle() });
    await first.host.handleMessage('c1', stackOrder('r1'));
    await first.host.close();

    // The grown bytes, under a stamp lowered behind the store's back.
    lowerAllocationStamp(worldStorePath(dir), WORLD_PARTITION_ID_FLOOR + 1);
    const damaged = openHost({ dir, definition: bundle() });
    await damaged.host.start();
    await damaged.host.handleMessage('c1', { type: 'hello' });
    await damaged.host.handleMessage('c1', { type: 'attach', seat: 1 });
    await damaged.host.handleMessage('c1', stackOrder('r2'));

    const response = last(damaged.sent, 'c1', 'world_response') as {
      ok: boolean;
      code?: string;
      message?: string;
    };
    expect(response).toMatchObject({ ok: false, code: 'allocation-stale' });
    expect(response.message).toMatch(/host defect/);
    expect(response.message).not.toMatch(/worldIdAllocationOf/);
    // Nothing rewrote it: the defect is still there to be seen.
    expect(damaged.store.nextElementId()).toBe(WORLD_PARTITION_ID_FLOOR + 1);
    await damaged.host.close();
  });

  it('mints a cold root outside the ids a stored, unloaded root already holds', async () => {
    const first = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await first.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'settle',
      args: {},
    });
    const stamp = first.store.nextElementId()!;
    await first.host.close();

    // A COLD host. Seat 2 has no holding, so this build mints one -- and seat
    // 1's holding is on disk, unloaded, invisible to this host's counter.
    const second = openHost({ dir, definition: bundle({ world: lazyWorld() }) });
    await second.host.start();
    await second.host.handleMessage('c2', { type: 'hello' });
    await second.host.handleMessage('c2', { type: 'attach', seat: 2 });
    await second.host.handleMessage('c2', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r2',
      action: 'settle',
      args: {},
    });

    const one = idsIn((await second.store.read(holdingOf(1)))?.json);
    const two = idsIn((await second.store.read(holdingOf(2)))?.json);
    // MINTED ABOVE THE STORED STAMP, not from whatever this host happened to
    // adopt -- so the new root cannot land on an id a stored root holds, and
    // the stamp moves on for the host after this one.
    expect(one.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThan(0);
    // Compared as COUNTER values, read back with the world's own key (#482):
    // the stamp is a counter value, and an id is its keyed cipher.
    const keyed = worldElementIds(second.store.elementIdKey());
    const twoCursors = two.map((id) => keyed.cursorOf(id));
    expect(Math.min(...twoCursors)).toBeGreaterThanOrEqual(stamp);
    expect(second.store.nextElementId()).toBeGreaterThan(Math.max(...twoCursors));
    expect(two.filter((id) => one.includes(id))).toEqual([]);

    // And the world still runs a command that loads BOTH, which is where the
    // collision used to surface: seat 1 acting on this same host adopts its
    // stored holding beside the one just minted.
    await second.host.handleMessage('c1', { type: 'hello' });
    await second.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r3',
      action: 'settle',
      args: {},
    });
    expect(last(second.sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    await second.host.close();
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
/**
 * ShufflewickPub #379: A MIGRATION IS ONE TRANSACTION, NOT A WALK IN KEY ORDER.
 *
 * #200 transforms one root at a time and #218 adds new ones afterwards, and
 * neither can express the shape a real occupied upgrade has: an EXISTING root
 * whose new value is derived from ANOTHER existing root. The host hydrated,
 * transformed and serialized each root as it reached it, so a `partition` hook
 * could only see the one it was handed -- and the `create` hook, which runs
 * last, may only answer NEW names, so updating an earlier root from there
 * changed nothing the transaction had already collected.
 *
 * Depending on whatever order `partitionNames()` happened to return is not a
 * migration contract. So every root is resident before ANY callback runs, and
 * nothing is serialized until every one of them has finished: `finalize` is the
 * phase that can read the whole world and write across it.
 *
 * The cases below are the issue's own acceptance regression, over the real
 * `LocalWorldHost` and a real SQLite store, because the whole claim is about
 * what is durable afterwards.
 */
/**
 * ShufflewickPub #380: A WORLD MAY SAY ITS COMMANDS ARE CHRONOLOGICAL.
 *
 * The default is stated in ShufflewickPub's own PERSISTENT-WORLDS.md and it is
 * deliberate: a frame drains on its way in, spends a BUDGET, and applies the
 * player's command whether or not the queue emptied. Blocking every command on
 * an arbitrarily long catch-up with the world lock held is the failure that
 * budget exists to prevent, and most worlds do not care.
 *
 * A world with a real clock does. At hour T an NPC market event chooses an
 * offer, creates its contract and schedules the NEXT decision -- which cannot
 * declare its partitions until the earlier one has committed, because they are
 * the contract it has not made yet. A player arriving while that chain is
 * overdue overtook it, and the world produced a state no punctual one reaches.
 * Pre-declaring every hypothetical contract is unbounded and wrong; running the
 * chain inside the player's handler reaches roots the handler never declared;
 * refusing forces manual retries.
 *
 * So the world SAYS SO -- `world.ordering: 'chronological'` -- and the host
 * gates the command behind a bounded, yielding catch-up. The player's own
 * arrival instant and order identity are untouched: what changes is what has
 * happened before their handler runs, not when they arrived.
 */
describe('#380: a chronological world catches up before a player acts', () => {
  /** Records the order handlers actually ran in, which is the whole claim. */
  let ran: string[] = [];

  beforeEach(() => {
    ran = [];
  });

  /** A one-shot chain: each occurrence schedules the next, so the queue can
   *  only be drained in nominal order and never predeclared. */
  const tick = worldClockAction<Village>('tick')
    .needs(() => [HEARTH])
    .execute((_args, ctx) => {
      const hearth = ctx.world.partition(HEARTH) as Hearth;
      hearth.burns += 1;
      ran.push(`tick@${ctx.world.timing?.due ?? 0}`);
      if (hearth.burns < 3) ctx.world.schedule({ delayMs: 1_000, action: 'tick', args: {} });
    });

  /** Starts the chain. A player's verb, because only a command may schedule. */
  const arm = worldAction<Village>('arm')
    .needs(() => [HEARTH])
    .execute((_args, ctx) => {
      ctx.world.schedule({ delayMs: 1_000, action: 'tick', args: {} });
    });

  /** The player's verb. It records where in the chain it landed. */
  const arrive = worldAction<Village>('arrive')
    .needs(() => [HEARTH])
    .execute((_args, ctx) => {
      const hearth = ctx.world.partition(HEARTH) as Hearth;
      hearth.logs += 1;
      ran.push(`arrive@burns=${hearth.burns}`);
    });

  function timedWorld(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
    return worldBlock({
      actions: [...VILLAGE_ACTIONS, tick, arm, arrive],
      ...overrides,
    });
  }

  /**
   * ONE PLAYER'S ACTION, SENT ON `c1`.
   *
   * Every message this suite sends is that shape and only the verb, the
   * request id and -- where the order's identity is the claim -- the order
   * itself differ. Written once so a case reads as what it varies.
   */
  async function play(
    opened: Awaited<ReturnType<typeof attached>>,
    action: string,
    requestId: string,
    order = nextOrder(),
  ): Promise<void> {
    await opened.host.handleMessage('c1', { type: 'action', order, requestId, action, args: {} });
  }

  /**
   * ARMED, AND THREE BEATS BEHIND.
   *
   * The starting position of every case below: the chain is armed, the clock
   * has run past three of its beats without anything draining them, and `ran`
   * is cleared so what a case asserts is what its own command caused.
   */
  async function armedAndBehind(
    opened: Awaited<ReturnType<typeof attached>>,
    clock: ReturnType<typeof testClock>,
    arming = 'arm',
  ): Promise<void> {
    await play(opened, arming, 'arm');
    clock.advance(5_000);
    ran = [];
  }

  /** That starting position, on a world of this suite's making: the host, its
   *  clock, and the chain already three beats behind. */
  async function behindOn(
    world: WorldDefinition,
    budgets?: Parameters<typeof attached>[0]['budgets'],
  ): Promise<{ opened: Awaited<ReturnType<typeof attached>>; clock: ReturnType<typeof testClock> }> {
    const clock = testClock();
    const opened = await attached({ dir, clock, budgets, definition: bundle({ world }) });
    await armedAndBehind(opened, clock);
    return { opened, clock };
  }

  it('runs every overdue event before the command, in nominal order', async () => {
    const { opened } = await behindOn(timedWorld({ ordering: 'chronological' }));

    await play(opened, 'arrive', 'r1');

    // Every tick ran, in order, and the player's handler saw the world they
    // left behind rather than the one they overtook.
    expect(ran).toEqual([
      expect.stringMatching(/^tick@/),
      expect.stringMatching(/^tick@/),
      expect.stringMatching(/^tick@/),
      'arrive@burns=3',
    ]);
    await opened.host.close();
  });

  it('leaves an ARRIVAL world exactly as it was: the command overtakes', async () => {
    // The default, unchanged, and pinned here so the gate is visibly opt-in.
    const { opened } = await behindOn(timedWorld());

    await play(opened, 'arrive', 'r1');

    expect(ran[0]).toBe('arrive@burns=0');
    await opened.host.close();
  });

  it('keeps the player\'s own arrival instant, not the catch-up\'s', async () => {
    let sawNow = 0;
    const stamped = worldAction<Village>('stamped')
      .needs(() => [HEARTH])
      .execute((_args, ctx) => {
        sawNow = ctx.world.now;
      });
    const { opened, clock } = await behindOn(
      timedWorld({ ordering: 'chronological', actions: [...VILLAGE_ACTIONS, tick, arm, arrive, stamped] }),
    );
    const arrivedAt = clock.now();

    await play(opened, 'stamped', 'r1');

    // The catch-up ran at the ticks' OWN dues, all of them earlier than this.
    expect(sawNow).toBe(arrivedAt);
    await opened.host.close();
  });

  it('answers a REPLAYED order from its receipt without draining anything', async () => {
    // An order the world already committed is answered from the receipt, and a
    // receipt is not a reason to run the clock.
    const world = timedWorld({ ordering: 'chronological' });
    const clock = testClock();
    const opened = await attached({ dir, clock, definition: bundle({ world }) });
    const order = nextOrder();
    await play(opened, 'arrive', 'r1', order);

    await armedAndBehind(opened, clock);
    await play(opened, 'arrive', 'r2', order);

    expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({ ok: true, replayed: true });
    expect(ran).toEqual([]);
    await opened.host.close();
  });

  /** A world whose budget cannot finish the chain it is behind on: one event
   *  per batch, one batch per command. The chain is three beats long, so the
   *  first command always stops with work still due. */
  const TOO_SMALL_TO_CATCH_UP = { drainBatch: 1, catchUpRounds: 1 };

  /** A chronological world on that budget, armed and three beats behind. */
  async function behindOnTooSmallABudget(): Promise<{
    opened: Awaited<ReturnType<typeof attached>>;
    order: ReturnType<typeof nextOrder>;
  }> {
    const { opened } = await behindOn(
      timedWorld({ ordering: 'chronological' }),
      worldBudgets(TOO_SMALL_TO_CATCH_UP),
    );
    return { opened, order: nextOrder() };
  }

  it('REFUSES the command when the catch-up runs out of budget, and changes nothing', async () => {
    // THE ORDERING IS THE GUARANTEE, NOT THE BUDGET (ShufflewickPub #395).
    // Applying anyway is what this host used to do, and it made the
    // declaration a bigger budget: past one budget's worth of due events a
    // player overtook the rest with nothing anywhere saying so.
    const { opened, order } = await behindOnTooSmallABudget();

    await play(opened, 'arrive', 'r1', order);

    // REFUSED BY NAME, with the sentence that tells the player what to do.
    const answer = last(opened.sent, 'c1', 'world_response');
    expect(answer).toMatchObject({ ok: false, code: 'world-catching-up' });
    expect(answer?.message).toMatch(/Send it again/);
    // The budget bought one beat, and the player's handler did NOT run behind
    // it -- which is the whole claim.
    expect(ran).toEqual([expect.stringMatching(/^tick@/)]);
    // THE REST OF THE WORK IS STILL SCHEDULED. Nothing was dropped to answer.
    expect(opened.store.pendingEvents()).toHaveLength(1);
    // AND NO RECEIPT WAS WRITTEN, which is what makes sending it again right
    // rather than a gamble.
    expect(opened.store.receipt(devWorldPlayer(1), order.id)).toBeUndefined();
    await opened.host.close();
  });

  it('runs the same order once the world is level, so the refusal costs the player nothing', async () => {
    const { opened, order } = await behindOnTooSmallABudget();

    // Each attempt spends its budget on one more beat; the chain is three
    // beats long, so the third attempt is the one that finds it level.
    for (const requestId of ['r1', 'r2']) {
      await play(opened, 'arrive', requestId, order);
      expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({
        ok: false,
        code: 'world-catching-up',
      });
    }

    await play(opened, 'arrive', 'r3', order);

    // THE SAME ORDER IDENTITY RUNS, ONCE, IN ORDER -- not replayed from a
    // receipt a refusal must never have written.
    expect(last(opened.sent, 'c1', 'world_response')).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(last(opened.sent, 'c1', 'world_response')?.replayed).toBeUndefined();
    expect(ran.filter((step) => step.startsWith('arrive@'))).toEqual(['arrive@burns=3']);
    expect(opened.store.pendingEvents()).toHaveLength(0);
    await opened.host.close();
  });

  it('REFUSES the command when a due event refuses, and leaves that event queued', async () => {
    // A refused event stays queued and is said out loud; a catch-up that kept
    // retrying it would spin forever on a world nobody can move. The command
    // behind it is refused for the same reason budget exhaustion refuses it --
    // the world is still behind, and the declaration says not to overtake.
    const doomed = worldClockAction<Village>('doomed')
      .needs(() => [HEARTH])
      .execute(() => {
        throw new Error('this event cannot run');
      });
    const armDoom = worldAction<Village>('arm-doom')
      .needs(() => [HEARTH])
      .execute((_args, ctx) => {
        ctx.world.schedule({ delayMs: 1_000, action: 'doomed', args: {} });
      });
    const clock = testClock();
    const opened = await attached({
      dir,
      clock,
      definition: bundle({
        world: timedWorld({
          ordering: 'chronological',
          actions: [...VILLAGE_ACTIONS, tick, arm, arrive, doomed, armDoom],
        }),
      }),
    });

    await armedAndBehind(opened, clock, 'arm-doom');
    const order = nextOrder();

    await play(opened, 'arrive', 'r1', order);

    expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({
      ok: false,
      code: 'world-catching-up',
    });
    expect(ran).toEqual([]);
    // The event is still queued, and somebody was told.
    expect(opened.store.pendingEvents()).toHaveLength(1);
    expect(last(opened.sent, 'c1', 'world_notice')?.message).toMatch(/"doomed" refused/);
    // AND NO RECEIPT, so the player's next attempt is their first spend.
    expect(opened.store.receipt(devWorldPlayer(1), order.id)).toBeUndefined();
    await opened.host.close();
  });

  it('REFUSES a bundle whose world.ordering is not one this host runs', () => {
    // At CONSTRUCTION, which is where every other unusable declaration is
    // refused: an ordering nobody runs is wrong for every command this world
    // will ever receive, so it is not a thing to discover on the first one.
    expect(() =>
      openHost({
        dir,
        definition: bundle({
          world: timedWorld({ ordering: 'whenever' as unknown as 'arrival' }),
        }),
      }),
    ).toThrow(/world\.ordering/);
  });
});

describe('#379: a migration reads across roots, in one atomic step', () => {
  /**
   * A world of two rooms whose contents differ, so "read the other one" is a
   * distinguishable claim. `logs` is the value; `burns` is where a derived one
   * is written, because it starts at zero everywhere.
   */
  function twoRooms(order: readonly string[]): WorldDefinition {
    return worldBlock({
      genesis: (game) =>
        Object.fromEntries(
          order.map((name, index) => {
            const room = game.create(Hearth, name) as Hearth;
            room.logs = index + 1;
            return [name, room as GameElement];
          }),
        ),
      view: () => [...order],
    });
  }

  /**
   * The upgrade: `north` takes its burn count from what `south` has stored, a
   * new `tally` root takes the sum of both, and none of it may depend on which
   * room the store happens to list first.
   */
  function derivingUpgrade(overrides: Partial<WorldMigration> = {}): WorldDefinition {
    return worldBlock({
      stateVersion: 1,
      genesis: (game) =>
        Object.fromEntries(
          ['north', 'south'].map((name) => [name, game.create(Hearth, name) as GameElement]),
        ),
      view: () => ['north', 'south'],
      migration: {
        from: 0,
        create: (game, ctx) =>
          ctx.existing.includes('tally')
            ? {}
            : { tally: game.create(Hearth, 'tally') as GameElement },
        finalize: (_game, ctx) => {
          const north = ctx.partition('north') as Hearth;
          const south = ctx.partition('south') as Hearth;
          // AN EXISTING ROOT, DERIVED FROM ANOTHER EXISTING ROOT.
          north.burns = south.logs;
          // AND A NEW ROOT, derived from both, in the same phase.
          (ctx.partition('tally') as Hearth).logs = north.logs + south.logs;
        },
        ...overrides,
      },
    } as Partial<WorldDefinition>);
  }

  /** A launched, unplayed world holding those two rooms in that order. */
  async function aWorldOf(order: readonly string[]): Promise<void> {
    const opened = openHost({ dir, definition: bundle({ world: twoRooms(order) }) });
    await opened.host.start();
    await opened.host.close();
  }

  async function burnsAndTally(): Promise<{ burns: unknown; tally: unknown }> {
    const store = openWorldStore(worldStorePath(dir), worldBudgets());
    try {
      const north = JSON.parse(JSON.stringify(await store.read('north'))) as {
        json: { attributes: { burns: number } };
      };
      const tally = JSON.parse(JSON.stringify(await store.read('tally'))) as {
        json: { attributes: { logs: number } };
      };
      return { burns: north.json.attributes.burns, tally: tally.json.attributes.logs };
    } finally {
      store.close();
    }
  }

  it('derives an existing root from another existing root, and a new one from both', async () => {
    await aWorldOf(['north', 'south']);

    const opened = openHost({ dir, definition: bundle({ world: derivingUpgrade() }) });
    await opened.host.start();
    await opened.host.close();

    // south.logs is 2, so north.burns is 2; the tally is 1 + 2.
    expect(await burnsAndTally()).toEqual({ burns: 2, tally: 3 });
  });

  it('answers the same whichever order the store lists its roots in', async () => {
    // The whole point: `partitionNames()` order is a storage accident, and a
    // migration contract may not be a function of one.
    await aWorldOf(['south', 'north']);

    const opened = openHost({ dir, definition: bundle({ world: derivingUpgrade() }) });
    await opened.host.start();
    await opened.host.close();

    // south was created first here, so its logs are 1 and north's are 2.
    expect(await burnsAndTally()).toEqual({ burns: 1, tally: 3 });
  });

  it('still runs the per-root hook first, so finalize reads TRANSFORMED bytes', async () => {
    // The ordering that IS a contract: `partition` normalizes each root, and
    // `finalize` derives across the results. A finalize that saw pre-transform
    // values would make the per-root hook useless to it.
    await aWorldOf(['north', 'south']);

    const opened = openHost({
      dir,
      definition: bundle({
        world: derivingUpgrade({
          partition: (element) => {
            (element as Hearth).logs *= 10;
          },
        }),
      }),
    });
    await opened.host.start();
    await opened.host.close();

    expect(await burnsAndTally()).toEqual({ burns: 20, tally: 30 });
  });

  it('leaves EVERY original byte and the version alone when finalize throws', async () => {
    await aWorldOf(['north', 'south']);
    const before = await (async () => {
      const store = openWorldStore(worldStorePath(dir), worldBudgets());
      try {
        return {
          north: JSON.stringify(await store.read('north')),
          south: JSON.stringify(await store.read('south')),
          names: [...store.partitionNames()].sort(),
          version: store.stateVersion(),
        };
      } finally {
        store.close();
      }
    })();

    const opened = openHost({
      dir,
      definition: bundle({
        world: derivingUpgrade({
          finalize: () => {
            throw new Error('the region table is not ready');
          },
        }),
      }),
    });
    await expect(opened.host.start()).rejects.toThrow(/region table is not ready/);
    await opened.host.close();

    const store = openWorldStore(worldStorePath(dir), worldBudgets());
    try {
      expect(JSON.stringify(await store.read('north'))).toBe(before.north);
      expect(JSON.stringify(await store.read('south'))).toBe(before.south);
      // NOT EVEN THE NEW ROOT: `create` ran and its element was built, and none
      // of it is durable, because nothing is written until finalize returns.
      expect([...store.partitionNames()].sort()).toEqual(before.names);
      expect(store.stateVersion()).toBe(before.version);
    } finally {
      store.close();
    }
  });

  it('is idempotent across a second start, because there is nothing left to do', async () => {
    await aWorldOf(['north', 'south']);
    const first = openHost({ dir, definition: bundle({ world: derivingUpgrade() }) });
    await first.host.start();
    await first.host.close();

    const again = openHost({ dir, definition: bundle({ world: derivingUpgrade() }) });
    expect((await again.host.start()).migrated).toBeUndefined();
    await again.host.close();

    expect(await burnsAndTally()).toEqual({ burns: 2, tally: 3 });
  });

  it('REFUSES a finalize that reaches for a root this world does not hold', async () => {
    await aWorldOf(['north', 'south']);

    const opened = openHost({
      dir,
      definition: bundle({
        world: derivingUpgrade({
          finalize: (_game, ctx) => {
            ctx.partition('nosuchroom');
          },
        }),
      }),
    });
    await expect(opened.host.start()).rejects.toThrow(/nosuchroom/);
    await opened.host.close();
  });
});

/**
 * ShufflewickPub #383: THE HOST IS THE ONLY THING THAT MAY SAY WHEN A SEAT WAS
 * LAST HERE.
 *
 * `world-store.test.ts` proves the watermark is durable and monotonic; this
 * proves the host puts the right instant in it, hands the right seat's back
 * down, and does neither of those on the roads that are not a player playing.
 * Together they are the whole of the contract a gameplay inactivity deadline
 * is allowed to be built on.
 */
describe('#383: a seat\'s activity, stamped by the host', () => {
  const OPENED = 1_000_000;

  /** The village, plus the verbs that read the stamp. Its own bundle so the
   *  rest of this file still sees the world it was written against. */
  function activityBundle() {
    return bundle({ world: worldBlock({ actions: ACTIVITY_ACTIONS }) });
  }

  function opened(clock?: WorldHostClock) {
    return attached({ dir, definition: activityBundle(), ...(clock === undefined ? {} : { clock }) });
  }

  beforeEach(() => {
    seenActivity = 'never ran';
  });

  async function send(host: LocalWorldHost, action: string, clientId = 'c1') {
    await host.handleMessage(clientId, {
      type: 'action',
      order: nextOrder(),
      requestId: `r-${action}`,
      action,
      args: {},
    });
  }

  async function look(host: LocalWorldHost, clientId = 'c1') {
    await send(host, 'look', clientId);
    return seenActivity as { seat: number; at: number | null; since: number; inactiveSince: number };
  }

  it('measures a seat nobody has seen from when the world started watching, not from 1970', async () => {
    const { host } = await opened();

    // The migration guarantee, end to end: an upgraded world reports its seats
    // as idle since the upgrade, so the self-destruct does not run on everybody
    // at once the first time the host wakes with this feature in it.
    expect(await look(host)).toEqual({ seat: 1, at: null, since: OPENED, inactiveSince: OPENED });
    await host.close();
  });

  it('hands a seat the watermark from BEFORE this command, so a prompt can say how long they were away', async () => {
    const clock = testClock();
    const { host } = await opened(clock);

    await send(host, 'chop');
    clock.advance(9 * 86_400_000);
    const seen = await look(host);

    // When they were last here, NOT "now" -- a command that reported its own
    // arrival could never render "you were away nine days".
    expect(seen.at).toBe(OPENED);
    expect(seen.inactiveSince).toBe(OPENED);
    await host.close();
  });

  it('does NOT count a command the world refused', async () => {
    const clock = testClock();
    const { host } = await opened(clock);

    await send(host, 'chop');
    clock.advance(5 * 86_400_000);
    // A refusal is the world saying nothing happened. If it moved the
    // watermark, any client could hold an empire open forever by sending
    // garbage on a timer, and the deadline would be unreachable.
    await send(host, 'overreach');

    expect((await look(host)).at).toBe(OPENED);
    await host.close();
  });

  it("keeps one seat's activity out of another's", async () => {
    const clock = testClock();
    const world = await opened(clock);
    await world.host.handleMessage('c2', { type: 'hello' });

    await send(world.host, 'chop', 'c1');
    clock.advance(3 * 86_400_000);

    expect((await look(world.host, 'c1')).at).toBe(OPENED);
    expect((await look(world.host, 'c2')).at).toBeNull();
    await world.host.close();
  });

  it("hands a seat-owned scheduled event THAT seat's watermark, so an irreversible deadline can be rechecked", async () => {
    const clock = testClock();
    const { host } = await opened(clock);

    // Seat 1 arms the reaper against itself, then comes back before it fires.
    await send(host, 'arm-reap');
    clock.advance(300_000);
    await send(host, 'chop');
    const cameBack = clock.now();

    clock.advance(300_001);
    await host.handleMessage('c1', { type: 'fire_due' });

    // The event is charged to the world and is ABOUT seat 1 -- so the handler
    // sees the player returned, and can re-arm instead of reaping.
    const seen = seenActivity as { seat: number; at: number | null };
    expect(seen.seat).toBe(1);
    expect(seen.at).toBe(cameBack);
    await host.close();
  });

  it("hands the world's own scheduled event no seat at all", async () => {
    const clock = testClock();
    const { host } = await opened(clock);

    // The chain: a seat asks the world to set an alarm, the world's handler
    // sets it, and THAT event belongs to the world. There is no seat to be
    // about, and the handler is told so rather than handed a plausible
    // stranger -- a reaper that defaulted here would reap the wrong empire.
    await send(host, 'arm-sow');
    clock.advance(300_001);
    await host.handleMessage('c1', { type: 'fire_due' });
    clock.advance(600_001);
    await host.handleMessage('c1', { type: 'fire_due' });

    expect(seenActivity).toBeNull();
    await host.close();
  });

  it('does not let a late drain age a player who is here now', async () => {
    const clock = testClock();
    const { host } = await opened(clock);

    // A world that was down for a week drains its overdue events at their
    // NOMINAL due, which is in the past. None of that is activity, and none of
    // it may move a watermark backwards either.
    await send(host, 'arm-reap');
    clock.advance(20 * 86_400_000);
    await send(host, 'chop');
    const cameBack = clock.now();
    await host.handleMessage('c1', { type: 'fire_due' });

    expect((await look(host)).at).toBe(cameBack);
    await host.close();
  });

  it('is still true after the host restarts, because hibernation is not a fresh start', async () => {
    const clock = testClock();
    const first = await opened(clock);
    await send(first.host, 'chop');
    await first.host.close();

    // A new process over the same store, twenty days later. An idleness clock
    // that restarted with the host would never reach a deadline at all.
    const later = testClock();
    later.advance(20 * 86_400_000);
    const again = await opened(later);
    const seen = await look(again.host);

    expect(seen.since).toBe(OPENED);
    expect(seen.at).toBe(OPENED);
    expect(later.now() - seen.inactiveSince).toBe(20 * 86_400_000);
    await again.host.close();
  });
});

describe('#482: a world stored before its ids were keyed', () => {
  it('is refused on open, naming the reset, before anything is written', async () => {
    // Layout 7's world holds ids that ARE its creation counter. No key reads
    // them back, so there is no step that carries it across: the author is
    // told why, and how to start again.
    await aPlayedVillage();
    rewindStoreToLayout7(worldStorePath(dir));

    expect(() => openHost({ dir })).toThrow(/#482/);
    expect(() => openHost({ dir })).toThrow(/boardsmith dev --reset/);
  });
});

/**
 * #387: A DEPARTURE IS WORK THE HOST STARTS ITSELF. While an edited rules file
 * rebuilds, `boardsmith dev` holds such work until the world runs the rules it
 * settles on, so a departure whose grace runs out meanwhile waits in the same
 * gate as the world's alarm, and runs once it is let go.
 */
describe('#387: a departure whose grace runs out is handed to the host', () => {
  fakeDepartureTimers();

  /** Seat 1's page leaves and its grace runs out, with the host's own work held. */
  async function departedWhileHeld() {
    const { told, definition } = presenceWorld({ onArrive: 'greet', onDepart: 'farewell' });
    const waiting: Array<() => void | Promise<void>> = [];
    const { host, drop } = await attached({ dir, definition, hostWork: { reloadPending: true, hold: (work) => void waiting.push(work) } });
    await drop('c1');
    await afterDepartureTimers(host);
    expect(told).toEqual(['arrive:1']);
    expect(waiting).toHaveLength(1);
    return { told, host, letGo: () => waiting.shift()!() };
  }

  it('runs only when the host lets it go', async () => {
    const { told, host, letGo } = await departedWhileHeld();
    await letGo();
    await host.settled();
    expect(told).toEqual(['arrive:1', 'depart:1']);
    await host.close();
  });

  it('is dropped when the world closed while it waited', async () => {
    const { told, host, letGo } = await departedWhileHeld();
    await host.close();
    await letGo();
    expect(told).toEqual(['arrive:1']);
  });
});

/**
 * #395: THE DEV HOST'S ANSWER TO AN ENDED WORLD, through the socket.
 *
 * `world-ended.test.ts` holds the world itself to the platform's behaviour;
 * this is what a page sees of it: the command refused by code with the
 * platform's sentence, and the completion notice still there after a restart.
 */
describe('an ended world, as a page sees it (#395)', () => {
  const finish = worldAction<Village>('finish')
    .prompt('End the season')
    .needs(() => [HEARTH])
    .execute((_args, ctx) => {
      ctx.world.complete();
    });
  const seasonal = () => bundle({ world: worldBlock({ actions: [...VILLAGE_ACTIONS, finish] }) });

  async function send(opened: Awaited<ReturnType<typeof attached>>, action: string): Promise<Record<string, unknown> | undefined> {
    await opened.host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: `r-${action}`, action, args: {} });
    return last(opened.sent, 'c1', 'world_response');
  }

  it('refuses a command after the ending, and still does after a restart', async () => {
    const first = await attached({ dir, definition: seasonal() });
    expect(await send(first, 'finish')).toMatchObject({ ok: true });
    expect(await send(first, 'chop')).toMatchObject({
      ok: false,
      code: 'world-ended',
      message: "This world's season has ended, so it no longer answers commands.",
    });
    await first.host.close();

    const second = await attached({ dir, definition: seasonal() });
    expect(last(second.sent, 'c1', 'world_state')?.notice).toMatch(/reported that it is complete/);
    expect(await send(second, 'chop')).toMatchObject({ ok: false, code: 'world-ended' });
    expect(JSON.stringify(last(second.sent, 'c1', 'world_state')?.view)).toContain('"logs":0');
    await second.host.close();
  });
});

describe('ShufflewickPub #521: a notice reaches its seat now if it is here, and waits in its box either way', () => {
  const alarm = worldAction<Village>('alarm')
    .prompt('Raise the alarm for seats 2 and 3')
    .needs(() => [HEARTH])
    .execute((_args, ctx) => {
      for (const seat of [2, 3]) {
        ctx.world.notify(seat, { payload: { from: ctx.player.seat }, line: 'The alarm sounds.', whenFull: 'dropOldest' });
      }
    });
  const noticed = () =>
    bundle({ world: worldBlock({ notices: { perSeat: 4 }, actions: [...VILLAGE_ACTIONS, alarm] }) });

  it('sends the line to the connected recipient alone, and keeps it in both boxes', async () => {
    const { host, sent, store } = await attached({ dir, definition: noticed() });
    await host.handleMessage('c2', { type: 'hello' });
    const before = sent.length;

    await host.handleMessage('c1', { type: 'action', order: nextOrder(), requestId: 'r1', action: 'alarm', args: {} });

    const frames = sent.slice(before).filter((s) => s.message.type === 'world_events');
    // Seat 2 is here and hears it at once, on the reserved scope; seat 1 sent
    // it and is told nothing; seat 3 is not connected at all.
    expect(frames.map((f) => f.clientId)).toEqual(['c2']);
    expect(frames[0]!.message.events).toEqual([
      { scope: 'notice', payload: { from: 1 }, text: 'The alarm sounds.' },
    ]);
    // And both boxes hold it, durably, whoever was connected.
    expect(store.noticeBox(2).entries.map((entry) => entry.text)).toEqual(['The alarm sounds.']);
    expect(store.noticeBox(3).entries.map((entry) => entry.text)).toEqual(['The alarm sounds.']);
    await host.close();
    const disk = onDisk();
    expect(disk.noticeBox(3).entries).toHaveLength(1);
    disk.close();
  });
});
