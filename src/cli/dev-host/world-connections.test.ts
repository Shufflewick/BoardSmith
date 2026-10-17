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
import { afterEach, describe, expect, it } from 'vitest';

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

export const gameDefinition = {
  gameClass: Camp,
  gameType: 'camp',
  displayName: 'Camp',
  world: {
    maxPlayers: 4,
    genesis: (game: Camp) => ({ fire: game.create(Fire, 'fire') }),
    view: () => ['fire'],
    actions: [stoke, warm],
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
  const run = await openWorldRun({
    cwd: tempTree('bs-world-connections-run-'),
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
  return { server };
}

async function open(port: number, clientId: string) {
  const page = await openSocketPage(port, clientId, (frame) => frame.type === 'world_offers');
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
