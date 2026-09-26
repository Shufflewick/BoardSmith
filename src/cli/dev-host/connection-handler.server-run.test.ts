/**
 * #416: A TAB FROM AN EARLIER `boardsmith dev` RUN IS NOT A PLAYER OF THE NEW ONE.
 *
 * `DevHost.vue` retries its socket every second after a close, forever, with
 * the client id it keeps in localStorage. So a tab left open across a server
 * restart reconnected to the new server within a second of it starting, the
 * host took that hello as the first arrival, seated it in seat 1 and started
 * the game, and the page the designer actually opened landed in the seat
 * picker with seat 1 held by a tab they had forgotten.
 *
 * Each run of the connection handler now has its own id. A page is told it on
 * hello (`welcome`) and names it when its socket reconnects; a hello naming a
 * different run is answered `stale_run` and goes no further, so it claims
 * nothing. A fresh page load names no run and joins as before, and a reconnect
 * within the same run keeps its seat through the #412 grace.
 *
 * Driven over real sockets through the handler `boardsmith dev` runs, into a
 * real `MultiplayerHost` for each run.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { executeOp } from '../../session/index.js';
import { eachPlayerFixtureDefinition as game } from '../../session/testing/fixtures/each-player-fixture.js';
import { createDevHostConnectionHandler } from './connection-handler.js';
import { MultiplayerHost } from './multiplayer-host.js';
import { manualGraceTimer } from './reconnect-grace.test-helper.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';

type Page = Awaited<ReturnType<typeof openSocketPage>>;

const runs: Array<{ stop: () => Promise<void> }> = [];
afterEach(async () => {
  for (const run of runs.splice(0).reverse()) await run.stop();
});

/** One `boardsmith dev` run: a fresh two-seat host behind a fresh connection handler. */
async function startRun() {
  const pages = new Map<string, WebSocket>();
  const graces = manualGraceTimer();
  const deliver = (clientId: string, frame: unknown) => {
    const socket = pages.get(clientId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  };
  const mpHost = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    maxPlayers: 2,
    executeOp: (options, snapshot, pending, op, hostOptions) => executeOp(game, options, snapshot, pending, op, hostOptions),
    reconnectTimer: graces.timer,
    send: deliver,
  });
  const server = await serveSockets(
    createDevHostConnectionHandler({ mpHost, clients: pages, queue: { admit: (work) => work.run() }, onError: fail }),
  );
  let stopped = false;
  const run = {
    port: server.port,
    server,
    graces,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await server.close();
    },
  };
  runs.push(run);
  return run;
}

function fail(error: unknown): never {
  throw error;
}

/** Open a page on `run` and wait until it is in the game; returns it and the run it was welcomed to. */
async function seatedPage(run: { port: number }, clientId: string) {
  const page = await openSocketPage(run.port, clientId, (f) => f.type === 'init');
  return { page, runId: page.frames.find((f) => f.type === 'welcome')?.runId };
}

/** The seats as the host reports them, asked through `page`. */
async function seatsSeenBy(page: Page) {
  const reply = page.next((f) => f.type === 'lobby' && f.requestId === 'lobby-check');
  page.send({ type: 'getLobby', requestId: 'lobby-check' });
  return (await reply).seats as Array<{ seat: number; clientId: string | null; connected: boolean }>;
}

/** A tab that joined one run, and the run started after that one stopped. */
async function restartedUnder(clientId: string) {
  const first = await startRun();
  const { runId } = await seatedPage(first, clientId);
  await first.stop();
  return { oldRun: runId, second: await startRun() };
}

const initOrStale = (f: { type: string }) => f.type === 'init' || f.type === 'stale_run';

describe('#416: a tab from an earlier dev-server run', () => {
  it('is told which run it joined when it says hello, before anything else', async () => {
    const { page, runId } = await seatedPage(await startRun(), 'A');
    expect(typeof runId).toBe('string');
    expect(page.frames[0]).toEqual({ type: 'welcome', runId });
  });

  it('is not seated in the new run, and a fresh page opened after it gets seat 1', async () => {
    const { oldRun, second } = await restartedUnder('A');
    // The old tab reconnects first, naming the run it joined.
    const stale = await openSocketPage(second.port, 'A', initOrStale, { runId: oldRun });
    expect(stale.frames.map((f) => f.type)).toEqual(['stale_run']);

    // The designer's fresh page lands in the game in seat 1.
    const fresh = await seatedPage(second, 'B');
    expect(fresh.page.frames.find((f) => f.type === 'init')?.seat).toBe(1);
    expect(fresh.runId).not.toBe(oldRun);

    const seats = await seatsSeenBy(fresh.page);
    expect(seats.find((s) => s.seat === 1)).toMatchObject({ clientId: 'B', connected: true });
    expect(seats.find((s) => s.seat === 2)?.clientId).toBeNull();
    // Nothing further was sent to the stale tab: not a lobby, not a board.
    expect(stale.frames.map((f) => f.type)).toEqual(['stale_run']);
  });

  it('cannot take a seat afterwards on that socket', async () => {
    const { oldRun, second } = await restartedUnder('A');
    const fresh = await seatedPage(second, 'B');
    const stale = await openSocketPage(second.port, 'A', initOrStale, { runId: oldRun });
    stale.send({ type: 'join', seat: 2 });
    await second.server.received((m) => m.type === 'join');

    expect((await seatsSeenBy(fresh.page)).find((s) => s.seat === 2)?.clientId).toBeNull();
  });

  it("sharing its client id with the fresh page (one browser), does not take that page's messages", async () => {
    const { oldRun, second } = await restartedUnder('C');
    const fresh = await seatedPage(second, 'C');
    await openSocketPage(second.port, 'C', initOrStale, { runId: oldRun });

    // The fresh page is still the one the host answers.
    expect((await seatsSeenBy(fresh.page)).find((s) => s.seat === 1)).toMatchObject({ clientId: 'C', connected: true });
  });
});

describe('#416: a reconnect within the same run keeps its seat (#412)', () => {
  /** A run with `A` seated whose socket has just closed, inside the reconnect grace. */
  async function droppedWithinGrace() {
    const run = await startRun();
    const { page, runId } = await seatedPage(run, 'A');
    const gone = run.server.closed();
    page.socket.close();
    await gone;
    expect(run.graces.armed()).toEqual([10_000]);
    return { run, runId };
  }

  it('a socket that reconnects naming this run is seated again and ends the grace', async () => {
    const { run, runId } = await droppedWithinGrace();
    const back = await openSocketPage(run.port, 'A', initOrStale, { runId });
    expect(back.frames.map((f) => f.type)).toContain('init');
    expect(back.frames.find((f) => f.type === 'init')?.seat).toBe(1);
    expect(back.frames.map((f) => f.type)).not.toContain('stale_run');
    expect(run.graces.armed()).toEqual([]);
  });

  it('a reload (a fresh page load, which names no run) is seated again and ends the grace', async () => {
    const { run } = await droppedWithinGrace();
    const { page } = await seatedPage(run, 'A');
    expect(page.frames.find((f) => f.type === 'init')?.seat).toBe(1);
    expect(run.graces.armed()).toEqual([]);
  });
});
