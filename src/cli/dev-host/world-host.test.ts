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
  type WorldBudgets,
  type StoredPartition,
  type WorldDefinition,
  type WorldActionOffer,
  type WorldMigration,
} from '../../world/index.js';
import { openWorldStore, worldStorePath, type LocalWorldStore } from './world-store.js';
import type { WorldDevClock } from './node-world-clock.js';
import { LocalWorldHost, devWorldPlayer } from './world-host.js';

/**
 * A STORE AS THE OLDER CODE LEFT IT: real partitions, no allocation stamp
 * (ShufflewickPub #377).
 *
 * Reached through SQLite directly rather than through `LocalWorldStore`,
 * deliberately: every door this store has writes the stamp with the bytes, and
 * a fixture built through one of them could not be the world the repair is for.
 */
function forgetAllocationStamp(path: string): void {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (file: string) => { exec(sql: string): void; close(): void };
  };
  const db = new DatabaseSync(path);
  try {
    db.exec("DELETE FROM meta WHERE key = 'nextElementId'");
  } finally {
    db.close();
  }
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

const VILLAGE_ACTIONS: readonly ActionDefinition[] = [chop, bank, burn];

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

/**
 * ShufflewickPub #378: THE PANEL RE-ASKS ONE PICK, AND THE HOST ANSWERS.
 *
 * The end-to-end half. A world's offer is enumerated with nothing bound, so a
 * `multiSelect` that reads `args.size` resolved to the unbounded fallback and
 * the browser was handed a cap the game never meant. The wire carries a re-ask
 * now, and this drives it the way a browser does: the same message, the same
 * host, the same answer.
 */
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
    const offered = (last(sent, 'c1', 'world_state')!.actions as WorldActionOffer[])
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
    const before = JSON.stringify(await store.read(HEARTH));

    await host.handleMessage('c1', {
      type: 'pick',
      requestId: 'p1',
      action: 'stack',
      selection: 'logs',
      args: { size: 'big' },
    });

    expect(JSON.stringify(await store.read(HEARTH))).toBe(before);
    expect(store.dirtyPartitions()).toEqual([]);
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
    expect(Math.min(...two)).toBeGreaterThanOrEqual(stamp);
    expect(second.store.nextElementId()).toBeGreaterThan(Math.max(...two));
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

  it('REPAIRS a world that was occupied before the stamp existed', async () => {
    // The supported repair. The store below is one the older code wrote: real
    // partitions, real minted ids, and no record of how far the counter got.
    // `start` derives the stamp from the stored bytes ONCE and writes it, and
    // the world mints safely from then on.
    const first = await attached({ dir, definition: bundle({ world: lazyWorld() }) });
    await first.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'settle',
      args: {},
    });
    await first.host.close();
    forgetAllocationStamp(worldStorePath(dir));

    const second = openHost({ dir, definition: bundle({ world: lazyWorld() }) });
    expect(second.store.nextElementId()).toBeUndefined();
    await second.host.start();
    expect(second.store.nextElementId()).toBeGreaterThan(WORLD_PARTITION_ID_FLOOR);

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
    expect(two.filter((id) => one.includes(id))).toEqual([]);
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

  it('runs every overdue event before the command, in nominal order', async () => {
    const world = timedWorld({ ordering: 'chronological' });
    const clock = testClock();
    const opened = await attached({ dir, clock, definition: bundle({ world }) });

    // Arm the chain, then let three beats fall due without draining.
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm',
      args: {},
    });
    clock.advance(5_000);
    ran = [];

    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'arrive',
      args: {},
    });

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
    const world = timedWorld();
    const clock = testClock();
    const opened = await attached({ dir, clock, definition: bundle({ world }) });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm',
      args: {},
    });
    clock.advance(5_000);
    ran = [];

    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'arrive',
      args: {},
    });

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
    const clock = testClock();
    const opened = await attached({
      dir,
      clock,
      definition: bundle({
        world: timedWorld({ ordering: 'chronological', actions: [...VILLAGE_ACTIONS, tick, arm, arrive, stamped] }),
      }),
    });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm',
      args: {},
    });
    clock.advance(5_000);
    const arrivedAt = clock.now();

    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'stamped',
      args: {},
    });

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
    await opened.host.handleMessage('c1', {
      type: 'action',
      order,
      requestId: 'r1',
      action: 'arrive',
      args: {},
    });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm',
      args: {},
    });
    clock.advance(5_000);
    ran = [];

    await opened.host.handleMessage('c1', { type: 'action', order, requestId: 'r2', action: 'arrive', args: {} });

    expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({ ok: true, replayed: true });
    expect(ran).toEqual([]);
    await opened.host.close();
  });

  it('applies the command anyway when the catch-up runs out of budget', async () => {
    // Degradation by LATENCY, never refusal -- the same rule the drain has.
    // A world that cannot be caught up inside its ceiling still answers, and
    // says so, rather than making the player press the button again.
    const clock = testClock();
    const opened = await attached({
      dir,
      clock,
      budgets: worldBudgets({ drainBatch: 1, catchUpRounds: 1 }),
      definition: bundle({ world: timedWorld({ ordering: 'chronological' }) }),
    });
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm',
      args: {},
    });
    clock.advance(5_000);
    ran = [];

    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'arrive',
      args: {},
    });

    expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    // One batch of one ran, and then the command was applied over a world that
    // is still behind rather than being refused.
    expect(ran).toEqual([expect.stringMatching(/^tick@/), 'arrive@burns=1']);
    await opened.host.close();
  });

  it('stops catching up when a due event refuses, and still applies the command', async () => {
    // A refused event stays queued and is said out loud; a catch-up that kept
    // retrying it would spin forever on a world nobody can move.
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
    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'arm',
      action: 'arm-doom',
      args: {},
    });
    clock.advance(5_000);
    ran = [];

    await opened.host.handleMessage('c1', {
      type: 'action',
      order: nextOrder(),
      requestId: 'r1',
      action: 'arrive',
      args: {},
    });

    expect(last(opened.sent, 'c1', 'world_response')).toMatchObject({ ok: true });
    expect(ran).toEqual(['arrive@burns=0']);
    // The event is still queued, and somebody was told.
    expect(opened.store.pendingEvents()).toHaveLength(1);
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
    // A world written before the allocation stamp existed carries none, so the
    // fixture writes the rows and then drops the key the way the older code
    // left it: absent. `start` derives it, once, after the lift (#377).
    await store.createAll({ partitions: { [HEARTH]: preFloorHearth() }, nextElementId: 1_000_000 }, 0);
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

  function opened(clock?: WorldDevClock) {
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
