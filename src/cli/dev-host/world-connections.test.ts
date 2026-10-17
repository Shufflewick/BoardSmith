/**
 * #284 OVER REAL SOCKETS: a page killed mid-push costs the pages that remain
 * nothing more.
 *
 * `world-host.test.ts` holds the host's half with a transport it controls. This
 * is the boundary itself: the literal `createWorldConnections` the dev server
 * runs, a real `ws` server, real clients, and a client killed with
 * `terminate()` -- no closing handshake, the socket simply goes, exactly as it
 * does when a driver process or a browser tab is killed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, type WorldDefinition } from '../../world/index.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { openSocketPage } from './socket-page.test-helper.js';
import { createWorldConnections } from './world-connections.js';
import { LocalWorldHost } from './world-host.js';
import { openWorldStore, worldStorePath } from './world-store.js';

class Fire extends Space<Camp> {
  logs = 0;
}

class Camp extends Game<Camp, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Fire]);
  }
}

/** Every seat whose offers were walked, in order. Set per test. */
let walked: number[] = [];
/** Called from inside each walk, so a test can act while a push is under way. */
let duringWalk: (seat: number) => void = () => {};

const stoke = worldAction<Camp>('stoke')
  .prompt('Stoke the fire')
  .needs(() => ['fire'])
  .execute((_args, ctx) => {
    (ctx.world.partition('fire') as Fire).logs += 1;
  });

/** Offered to every seat; its condition is where a walk is observed. */
const warm = worldAction<Camp>('warm')
  .prompt('Warm your hands')
  .condition({
    'counted as walked': (ctx) => {
      walked.push(ctx.player.seat);
      duringWalk(ctx.player.seat);
      return true;
    },
  })
  .needs(() => ['fire'])
  .execute(() => {});

const definition = {
  gameClass: Camp,
  gameType: 'camp',
  displayName: 'Camp',
  world: {
    maxPlayers: 4,
    genesis: (game: Camp) => ({ fire: game.create(Fire, 'fire') as GameElement }),
    view: () => ['fire'],
    actions: [stoke, warm],
  } as unknown as WorldDefinition,
} as unknown as ConstructorParameters<typeof LocalWorldHost>[0]['definition'];


let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
  walked = [];
  duringWalk = () => {};
});

async function serve(
  queue: Parameters<typeof createWorldConnections>[1] = { admit: (message) => message.run() },
): Promise<{ host: LocalWorldHost; port: number; connections: ReturnType<typeof createWorldConnections> }> {
  const budgets = worldBudgets();
  const dir = tempTree('bs-world-connections-');
  const store = openWorldStore(worldStorePath(dir), budgets);
  // Asked for on each message, as the dev server asks, so it may be declared
  // after the connections that read it.
  const connections = createWorldConnections(() => host, queue);
  const host = new LocalWorldHost({
    definition,
    worldName: 'Camp',
    seed: 'seed',
    budgets,
    store,
    send: connections.send,
    isOpen: connections.isOpen,
  });
  await host.start();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', connections.accept);
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  cleanup.push(async () => {
    connections.forgetAll();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await host.close();
  });
  return { host, port: (wss.address() as { port: number }).port, connections };
}

async function open(port: number, clientId: string, loadId?: string) {
  const page = await openSocketPage(
    port,
    clientId,
    (frame) => frame.type === 'world_offers',
    loadId === undefined ? {} : { loadId },
  );
  cleanup.push(() => page.socket.terminate());
  return page;
}

describe('#284: a page killed while the host is pushing', () => {
  it('is noticed before the push reaches its seat, and the others are still served', async () => {
    const { host, port } = await serve();
    const first = await open(port, 'p1');
    await open(port, 'p2');
    const doomed = await open(port, 'p3');
    walked = [];

    // KILLED MID-PUSH: the moment the push after p1's command starts walking
    // seat 1, p3's process dies. Nothing closes cleanly; its socket just goes.
    duringWalk = (seat) => {
      if (seat !== 1) return;
      duringWalk = () => {};
      doomed.socket.terminate();
    };
    const answered = first.next((frame) => frame.type === 'world_response');
    first.socket.send(
      JSON.stringify({
        type: 'action',
        requestId: 'r1',
        order: { id: 'order-1', at: Date.now() },
        action: 'stoke',
        args: {},
      }),
    );
    expect(await answered).toMatchObject({ requestId: 'r1', ok: true });
    await host.settled();

    expect(walked).toContain(1);
    expect(walked).not.toContain(3);

    // AND THE SEATS THAT REMAIN ARE STILL SERVED, told the truth about who is
    // here on the very next command.
    // THIS command's own frames: its response, and the push that follows it in
    // the same turn of the world lock. A departure's push can still be on its
    // way, so "the next state frame" alone would not be this command's.
    let responded = false;
    const again = first.next((frame) => {
      responded = frame.type === 'world_response' && frame.requestId === 'r2';
      return responded;
    });
    const state = first.next((frame) => responded && frame.type === 'world_state');
    first.socket.send(
      JSON.stringify({
        type: 'action',
        requestId: 'r2',
        order: { id: 'order-2', at: Date.now() },
        action: 'stoke',
        args: {},
      }),
    );
    expect(await again).toMatchObject({ requestId: 'r2', ok: true });
    expect((await state).presence).toEqual([1, 2]);
    expect(JSON.stringify((await state).view)).toContain('"logs":2');
  });
});

describe('#879: a frame that is not a message', () => {
  it('is dropped, and the page is still served', async () => {
    const { port } = await serve();
    const page = await open(port, 'p1');
    for (const junk of ['null', '42', '"x"', '[]', '{}', 'not json']) page.socket.send(junk);

    const answered = page.next((frame) => frame.type === 'world_response' && frame.requestId === 'r1');
    page.send({ type: 'action', requestId: 'r1', order: { id: 'r1', at: Date.now() }, action: 'stoke', args: {} });
    expect(await answered).toMatchObject({ ok: true });
  });
});

/**
 * A world whose messages can be held, as a saved rules edit holds them (#379):
 * `held` sends while holding and resolves once the queue has taken it;
 * `release` runs everything held, in order.
 */
async function serveHeld() {
  let holding = false;
  let arrived: () => void = () => {};
  const queued: Array<() => Promise<void>> = [];
  const served = await serve({
    admit: (message) => {
      if (!holding) return message.run();
      queued.push(message.run);
      arrived();
      return Promise.resolve();
    },
  });
  const held = async (send: () => void) => {
    holding = true;
    const taken = new Promise<void>((resolve) => (arrived = resolve));
    send();
    await taken;
    holding = false;
  };
  const release = async () => {
    for (const run of queued.splice(0)) await run();
  };
  return { ...served, held, release };
}

const act = (requestId: string, order: string, action: string) => ({
  type: 'action',
  requestId,
  order: { id: order, at: Date.now() },
  action,
  args: {},
});

describe('#1099: a reply to a page that reloaded', () => {
  it.each([
    ['a page load that names itself', 'load-1', 'load-2'],
    ['a client that names no page load', undefined, undefined],
  ])('never answers the new socket\'s request that reused the same id: %s', async (_case, oldLoad, newLoad) => {
    const { host, port, held, release } = await serveHeld();
    const before = await open(port, 'p1', oldLoad);
    // The old page's wc-0 is refused, so its answer is told from the new one's.
    await held(() => before.send(act('wc-0', 'o1', 'nope')));

    // THE RELOAD: the new page greets before the old socket closes, and
    // numbers its requests from wc-0 again.
    const after = await open(port, 'p1', newLoad);
    before.socket.terminate();
    const answered = after.next((frame) => frame.type === 'world_response' && frame.requestId === 'wc-0');
    await held(() => after.send(act('wc-0', 'o2', 'stoke')));
    await release();

    expect(await answered).toMatchObject({ ok: true });
    await host.settled();
    expect(after.frames.filter((frame) => frame.type === 'world_response')).toHaveLength(1);
  });

  it('forgets a request still unanswered when a rules reload forgets its page', async () => {
    const { port, connections, held, release } = await serveHeld();
    const before = await open(port, 'p1', 'load-1');
    await held(() => before.send(act('wc-0', 'o1', 'stoke')));
    connections.forgetAll({ type: 'world_reload' });

    // Even a socket of the same page load greeting again is not that page.
    const after = await open(port, 'p1', 'load-1');
    await release();
    // Answered after anything the released request sent, on the same socket.
    const answered = after.next((frame) => frame.type === 'world_response');
    after.send(act('wc-1', 'o2', 'stoke'));
    expect(await answered).toMatchObject({ requestId: 'wc-1', ok: true });
  });
});
