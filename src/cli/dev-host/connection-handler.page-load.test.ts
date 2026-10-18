/**
 * #1041: A REQUEST ID BELONGS TO ONE PAGE LOAD.
 *
 * A page keeps its client id across reloads, and its game numbers requests
 * from `req-0` on every load. A reloaded page's `hello` can arrive before the
 * old socket closes, and the host routes by client id, so the answer to the
 * old page's `req-3` used to reach the new page, where it answered the new
 * page's own `req-3`. Each page load now names itself in `hello`, and a reply
 * is delivered only while the load that asked still holds the client's socket.
 * A socket that merely reconnects keeps its load, so its answers still arrive.
 *
 * Driven over real sockets through the handler `boardsmith dev` runs, into a
 * real `MultiplayerHost`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { executeOp } from '../../session/index.js';
import { eachPlayerFixtureDefinition as game } from '../../session/testing/fixtures/each-player-fixture.js';
import { createDevHostConnectionHandler } from './connection-handler.js';
import { MultiplayerHost } from './multiplayer-host.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';

type Page = Awaited<ReturnType<typeof openSocketPage>>;

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/**
 * A dev host whose next action op waits until the test lets it finish. With
 * `reloading`, every message waits as a saved rules edit holds them, until
 * `drain` ends the reload and runs them in order (#379).
 */
async function startHost(opts: { reloading?: boolean } = {}) {
  let reloading = opts.reloading ?? false;
  const pages = new Map<string, WebSocket>();
  const queued: Array<() => Promise<void>> = [];
  const drain = async () => {
    reloading = false;
    for (const run of queued.splice(0)) await run();
  };
  let hold: { reached: () => void; release: Promise<void> } | null = null;
  const mpHost = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    maxPlayers: 2,
    executeOp: async (options, snapshot, pending, op, hostOptions) => {
      if (op.type === 'action' && hold) {
        const held = hold;
        hold = null;
        held.reached();
        await held.release;
      }
      return executeOp(game, options, snapshot, pending, op, hostOptions);
    },
    send: (clientId, frame) => {
      const socket = pages.get(clientId);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    },
  });
  const server = await serveSockets(
    createDevHostConnectionHandler({
      mpHost,
      clients: pages,
      queue: {
        admit: (work) => {
          if (!reloading) return work.run();
          queued.push(work.run);
          return Promise.resolve();
        },
      },
      onError: (error) => {
        throw error;
      },
    }),
  );
  stops.push(() => server.close());
  /** Arm the hold; resolves `reached` once an action op is waiting in it. */
  const holdNextAction = () => {
    let release!: () => void;
    let reached!: () => void;
    const atHold = new Promise<void>((resolve) => (reached = resolve));
    hold = { reached, release: new Promise<void>((resolve) => (release = resolve)) };
    return { atHold, release };
  };
  return { port: server.port, server, mpHost, holdNextAction, drain };
}

const inGame = (f: { type: string }) => f.type === 'init';

/** Send a move as `requestId`; the host refuses it (no boundary key), which still answers it. */
function sendMove(page: Page, requestId: string): void {
  page.send({ type: 'server_request', requestId, op: 'action', payload: { actionName: 'pass', args: {} } });
}

/** Resolves once every message `page` sent before now has been answered (a lobby round trip). */
async function settled(page: Page): Promise<void> {
  const reply = page.next((f) => f.type === 'lobby' && f.requestId === 'settle');
  page.send({ type: 'getLobby', requestId: 'settle' });
  await reply;
}

const answersTo = (page: Page, requestId: string) =>
  page.frames.filter((f) => f.type === 'server_response' && f.requestId === requestId);

describe('#1041: a request id belongs to one page load', () => {
  it("the answer to a reloaded page's request never reaches the new page, which reuses the id", async () => {
    const host = await startHost();
    const oldPage = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-1' });
    const { atHold, release } = host.holdNextAction();
    sendMove(oldPage, 'req-3');
    await atHold;

    // The reload: the new page says hello before the old socket closes.
    const newPage = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-2' });
    release();
    await settled(newPage);
    expect(answersTo(newPage, 'req-3')).toEqual([]);

    // The new page's own req-3 is answered, once.
    const own = newPage.next((f) => f.type === 'server_response' && f.requestId === 'req-3');
    sendMove(newPage, 'req-3');
    await own;
    await settled(newPage);
    expect(answersTo(newPage, 'req-3')).toHaveLength(1);
  });

  it('the same holds when the request and the reload both wait for a rules edit to build', async () => {
    const host = await startHost({ reloading: true });
    const oldPage = await openSocketPage(host.port, 'A', (f) => f.type === 'welcome', { loadId: 'load-1' });
    sendMove(oldPage, 'req-3');
    await host.server.received((m) => m.type === 'server_request');
    const newPage = await openSocketPage(host.port, 'A', (f) => f.type === 'welcome', { loadId: 'load-2' });
    await host.drain();

    await settled(newPage);
    expect(answersTo(newPage, 'req-3')).toEqual([]);
  });

  it('a socket that reconnects within the same page load still gets its answer', async () => {
    const host = await startHost();
    const first = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-1' });
    const { atHold, release } = host.holdNextAction();
    sendMove(first, 'req-3');
    await atHold;

    const back = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-1' });
    const answer = back.next((f) => f.type === 'server_response' && f.requestId === 'req-3');
    release();
    await answer;
    expect(answersTo(back, 'req-3')).toHaveLength(1);
  });

  it("forgets a closed socket's page load, and a reconnect of that load is answered again", async () => {
    const host = await startHost();
    const first = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-1' });
    const { atHold, release } = host.holdNextAction();
    sendMove(first, 'req-3');
    await atHold;

    const gone = host.server.closed();
    first.socket.close();
    await gone;
    // Scripted clients get a new id per socket, so a kept entry would grow forever.
    expect((host.mpHost as any).pageLoad.has('A')).toBe(false);

    const back = await openSocketPage(host.port, 'A', inGame, { loadId: 'load-1' });
    const answer = back.next((f) => f.type === 'server_response' && f.requestId === 'req-3');
    release();
    await answer;
    expect(answersTo(back, 'req-3')).toHaveLength(1);
  });
});
