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
import { WebSocket, WebSocketServer } from 'ws';

import { Game, Player, Space, type GameElement, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, type WorldDefinition } from '../../world/index.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
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

type Frame = Record<string, unknown> & { type: string };

/** One real page: a socket, and every frame it has been sent. */
interface Page {
  readonly socket: WebSocket;
  readonly frames: Frame[];
  next(accept: (frame: Frame) => boolean): Promise<Frame>;
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
  walked = [];
  duringWalk = () => {};
});

async function serve(): Promise<{ host: LocalWorldHost; port: number }> {
  const budgets = worldBudgets();
  const store = openWorldStore(worldStorePath(tempTree('bs-world-connections-')), budgets);
  // Asked for on each message, as the dev server asks, so it may be declared
  // after the connections that read it.
  const connections = createWorldConnections(() => host);
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
  return { host, port: (wss.address() as { port: number }).port };
}

async function open(port: number, clientId: string): Promise<Page> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: Frame[] = [];
  const waiters: Array<{ accept: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
  socket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as Frame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (!waiter.accept(frame)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  cleanup.push(() => socket.terminate());
  const page: Page = {
    socket,
    frames,
    next: (accept) => new Promise((resolve) => waiters.push({ accept, resolve })),
  };
  const greeted = page.next((frame) => frame.type === 'world_offers');
  socket.send(JSON.stringify({ type: 'hello', clientId }));
  await greeted;
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
