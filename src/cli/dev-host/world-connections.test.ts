/**
 * #284 OVER REAL SOCKETS: a page killed mid-push costs the pages that remain
 * nothing more.
 *
 * `world-host.test.ts` holds the host's half with a transport it controls. This
 * is the boundary itself, wired as `boardsmith dev` wires it: `openWorldRun`,
 * the world bundled with its rules and run in their worker (#885), the literal
 * `createWorldConnections` in front of it, a real `ws` server, real clients,
 * and a client killed with `terminate()` -- no closing handshake, the socket
 * simply goes, exactly as it does when a driver process or a browser tab is
 * killed.
 *
 * The world runs in another thread, so the rules talk to the test over a
 * `BroadcastChannel`: each seat an offer walk reaches, and a gate that holds
 * the walk of seat 1 until the test has killed the page and the host has seen
 * its socket close. "Killed mid-push" is then a fact of the test, not a race.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { bundleWorldRules, openWorldRun, startWorldRuntime } from '../commands/dev-world.js';
import { rulesProject } from './rules-project.test-helper.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';

const CHANNEL = `bs-284-${process.pid}`;

const RULES = `import { Game, Player, Space } from 'boardsmith';
import type { GameOptions } from 'boardsmith';
import { worldAction } from 'boardsmith/world';

class Fire extends Space<Camp> {
  logs = 0;
}

class Camp extends Game<Camp, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Fire]);
  }
}

// The test's line into this worker: which seats a walk reaches, and a gate that holds one walk of seat 1.
const line = new BroadcastChannel(${JSON.stringify(CHANNEL)});
let gate: Int32Array | null = null;
line.onmessage = (event: MessageEvent) => {
  if (event.data.gate) {
    gate = new Int32Array(event.data.gate);
    line.postMessage({ armed: true });
  }
  if (event.data.flush) line.postMessage({ flushed: true });
};

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
      line.postMessage({ walked: ctx.player.seat });
      if (gate !== null && ctx.player.seat === 1) {
        const held = gate;
        gate = null;
        line.postMessage({ holding: true });
        Atomics.wait(held, 0, 0);
      }
      return true;
    },
  })
  .needs(() => ['fire'])
  .execute(() => {});

/** Stops the rules worker, as a rule that kills its thread does (#1060). */
const crash = worldAction<Camp>('crash')
  .prompt('Stop the rules')
  .needs(() => ['fire'])
  .execute(() => process.exit(1));

export const gameDefinition = {
  gameClass: Camp,
  gameType: 'camp',
  displayName: 'Camp',
  world: {
    maxPlayers: 4,
    genesis: (game: Camp) => ({ fire: game.create(Fire, 'fire') }),
    view: () => ['fire'],
    actions: [stoke, warm, crash],
  },
};
`;

// Bundling is the slow part, so it happens here, where no test timeout applies (#363).
const project = rulesProject('bs-world-connections-', RULES);
const bundlePath = await bundleWorldRules(project.rulesPath, project.tempDir, 'monorepo');

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

/** What the rules said over the line, and a way to wait for one thing they say. */
function rulesLine() {
  const line = new BroadcastChannel(CHANNEL);
  cleanup.push(() => line.close());
  let walked: number[] = [];
  const waiters: Array<{ accept: (data: Record<string, unknown>) => boolean; resolve: () => void }> = [];
  line.onmessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown>;
    if (typeof data.walked === 'number') walked.push(data.walked);
    // Everything the rules said before arming is from before the push under test.
    if (data.armed) walked = [];
    for (const waiter of [...waiters]) {
      if (!waiter.accept(data)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const heard = (accept: (data: Record<string, unknown>) => boolean) =>
    new Promise<void>((resolve) => waiters.push({ accept, resolve }));
  return {
    walked: () => walked,
    heard,
    post: (data: unknown) => line.postMessage(data),
  };
}

async function serve() {
  // Each run gets its own worker: a run stops the worker it runs in when it closes.
  const runtime = await startWorldRuntime(bundlePath);
  cleanup.push(() => runtime.worker.close());
  const cwd = tempTree('bs-world-connections-run-');
  const run = await openWorldRun({
    cwd,
    displayName: 'Camp',
    port: 5173,
    runtime,
    reloadRules: () => Promise.reject(new Error('This test never reloads its rules.')),
  });
  const server = await serveSockets(run.connections.accept);
  cleanup.push(async () => {
    run.connections.forgetAll();
    await server.close();
    await run.close();
  });
  return { server, run, runtime };
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
    const { server } = await serve();
    const rules = rulesLine();
    const first = await open(server.port, 'p1');
    await open(server.port, 'p2');
    const doomed = await open(server.port, 'p3');

    // ARMED: the next walk of seat 1 holds until the test lets it go.
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const letGo = () => {
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
    };
    cleanup.push(letGo);
    const armed = rules.heard((data) => data.armed === true);
    rules.post({ gate: gate.buffer });
    await armed;

    // KILLED MID-PUSH: once the push after p1's command is walking seat 1, p3's
    // process dies. Nothing closes cleanly; its socket just goes.
    const holding = rules.heard((data) => data.holding === true);
    const answered = first.next((frame) => frame.type === 'world_response');
    first.send({ type: 'action', requestId: 'r1', order: { id: 'order-1', at: Date.now() }, action: 'stoke', args: {} });
    await holding;
    const gone = server.closed();
    doomed.socket.terminate();
    await gone;
    letGo();
    expect(await answered).toMatchObject({ requestId: 'r1', ok: true });

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
    first.send({ type: 'action', requestId: 'r2', order: { id: 'order-2', at: Date.now() }, action: 'stoke', args: {} });
    expect(await again).toMatchObject({ requestId: 'r2', ok: true });
    expect((await state).presence).toEqual([1, 2]);
    expect(JSON.stringify((await state).view)).toContain('"logs":2');

    // Every walk the rules reported has arrived once they answer a flush, which they post after them.
    const flushed = rules.heard((data) => data.flushed === true);
    rules.post({ flush: true });
    await flushed;
    expect(rules.walked()).toContain(1);
    expect(rules.walked()).not.toContain(3);
  });
});

describe('#879: a frame that is not a message', () => {
  it('is dropped, and the page is still served', async () => {
    const { server } = await serve();
    const page = await open(server.port, 'p1');
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
  const served = await serve();
  const queue = served.run.queue;
  const admit = queue.admit.bind(queue);
  vi.spyOn(queue, 'admit').mockImplementation((message) => {
    if (!holding) return admit(message);
    queued.push(message.run);
    arrived();
    return Promise.resolve();
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
    const { server, held, release } = await serveHeld();
    const before = await open(server.port, 'p1', oldLoad);
    // The old page's wc-0 is refused, so its answer is told from the new one's.
    await held(() => before.send(act('wc-0', 'o1', 'nope')));

    // THE RELOAD: the new page greets before the old socket closes, and
    // numbers its requests from wc-0 again.
    const after = await open(server.port, 'p1', newLoad);
    before.socket.terminate();
    const answered = after.next((frame) => frame.type === 'world_response' && frame.requestId === 'wc-0');
    await held(() => after.send(act('wc-0', 'o2', 'stoke')));
    await release();

    expect(await answered).toMatchObject({ ok: true });
    // The world answers in order, so once wc-1 is answered every earlier answer has arrived.
    const fenced = after.next((frame) => frame.type === 'world_response' && frame.requestId === 'wc-1');
    after.send(act('wc-1', 'o3', 'stoke'));
    await fenced;
    expect(after.frames.filter((frame) => frame.type === 'world_response' && frame.requestId === 'wc-0')).toHaveLength(1);
  });

  it('forgets a request still unanswered when a rules reload forgets its page', async () => {
    const { server, run, held, release } = await serveHeld();
    const before = await open(server.port, 'p1', 'load-1');
    await held(() => before.send(act('wc-0', 'o1', 'stoke')));
    run.connections.forgetAll({ type: 'world_reload' });

    // Even a socket of the same page load greeting again is not that page.
    const after = await open(server.port, 'p1', 'load-1');
    await release();
    // Answered after anything the released request sent, on the same socket.
    const answered = after.next((frame) => frame.type === 'world_response');
    after.send(act('wc-1', 'o2', 'stoke'));
    expect(await answered).toMatchObject({ requestId: 'wc-1', ok: true });
    expect(after.frames.filter((frame) => frame.type === 'world_response')).toHaveLength(1);
  });
});

describe('#1060: a command to a world whose rules worker stopped', () => {
  it('is refused, the command that stopped it and every one after it', async () => {
    const { server } = await serve();
    const page = await open(server.port, 'p1');
    const failures: string[] = [];
    let failed: () => void = () => {};
    const quiet = vi.spyOn(console, 'error').mockImplementation((...said: unknown[]) => {
      const line = said.map(String).join(' ');
      if (!line.includes("world message 'action' failed")) return;
      failures.push(line);
      failed();
    });
    cleanup.push(() => quiet.mockRestore());
    /** Every frame the host sent before this has arrived: a pong follows them on the same socket. */
    const fence = () => new Promise<void>((resolve) => {
      page.socket.once('pong', () => resolve());
      page.socket.ping();
    });

    for (const [requestId, action] of [['c1', 'crash'], ['c2', 'stoke']]) {
      const hostFailed = new Promise<void>((resolve) => (failed = resolve));
      page.send(act(requestId, `o-${requestId}`, action));
      await hostFailed;
      await fence();
      expect(page.frames.filter((frame) => frame.type === 'world_response' && frame.requestId === requestId)).toEqual([
        { type: 'world_response', requestId, ok: false, message: expect.stringContaining('Your rules stopped running') },
      ]);
    }
    expect(failures).toHaveLength(2);
  });
});

describe('#1178: a second hello on one socket naming a different client', () => {
  it('lets the first client go, and a later close lets go of the new client only', async () => {
    const { server, runtime } = await serve();
    const call = vi.spyOn(runtime.worker, 'call');
    const departures = () => call.mock.calls.filter(([type]) => type === 'disconnect').map(([, payload]) => payload);
    const watcher = await open(server.port, 'p0');
    const page = await open(server.port, 'p1');
    const greeted = page.next((frame) => frame.type === 'world_offers');
    page.send({ type: 'hello', clientId: 'p2' });
    await greeted;

    // The world answers in order, so the watcher's state shows every departure before it.
    const presence = async (requestId: string) => {
      const state = watcher.next((frame) => frame.type === 'world_state');
      const answered = watcher.next((frame) => frame.type === 'world_response' && frame.requestId === requestId);
      watcher.send(act(requestId, requestId, 'stoke'));
      await answered;
      return (await state).presence;
    };
    // p1 left first, so p2 takes the seat it freed.
    expect(await presence('w1')).toEqual([1, 2]);
    expect(departures()).toEqual([{ clientId: 'p1' }]);

    const gone = server.closed();
    page.socket.close();
    await gone;
    expect(await presence('w2')).toEqual([1]);
    expect(departures()).toEqual([{ clientId: 'p1' }, { clientId: 'p2' }]);
  });
});
