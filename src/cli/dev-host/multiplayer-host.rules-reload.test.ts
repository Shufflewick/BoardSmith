/**
 * #343: A RULES EDIT REACHES THE TABLE HOST, NOT ONLY THE BROWSER.
 *
 * `boardsmith dev` bundles a table's rules once, and the browser gets every
 * later edit through Vite. Before this, the page ran the edited rules while the
 * authoritative host kept running the ones it started with, until the command
 * was restarted: the table-side version of what #201 fixed for worlds.
 *
 * These tests drive the real road: a game project on disk, bundled by the same
 * loader `boardsmith dev` uses, a rule EDITED on disk, the bundle loaded again,
 * and the running host handed the result. Nothing here is a hand-built runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocket } from 'ws';

import { tableRulesReloadQueue, type TableRuntime } from '../commands/dev-table-runtime.js';
import { gateOf } from './rules-reload-queue.js';
import { boundaryKeyOf } from '../../session/testing/boundary-stamp.js';
import { createDevHostConnectionHandler } from './connection-handler.js';
import type { WorldHostClock } from './node-world-clock.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { openTable, tableProject } from './table-host.test-helper.js';
import { buildFailure } from './rules-project.test-helper.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());
afterEach(() => vi.restoreAllMocks());

/** The flows a test edits between. */
const FLOWS = {
  /** Three one-move steps, one after another. */
  three: `sequence(
    actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart' }),
    actionStep({ name: 'b', actions: ['bump'], turnScope: 'restart' }),
    actionStep({ name: 'c', actions: ['bump'], turnScope: 'restart' }),
  )`,
  /** One step, repeated: every move the three-step game made is still legal here. */
  looped: `sequence(
    loop({ name: 'rounds', maxIterations: 5, do: actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart' }) }),
  )`,
  /** One move and the game is over, so a history of two moves cannot be replayed. */
  one: `sequence(actionStep({ name: 'a', actions: ['bump'] }))`,
  /** Each seat bumps in turn, three rounds. */
  turns: `loop({ name: 'rounds', maxIterations: 3, do: eachPlayer({ name: 'turn', do: actionStep({ name: 'a', actions: ['bump'] }) }) })`,
  /** One timed step, repeated. */
  timed: (limitMs: number) => `sequence(
    loop({ name: 'rounds', maxIterations: 5, do: actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart', timeLimitMs: ${limitMs} }) }),
  )`,
};

/**
 * A counter game whose `bump` adds `step`, written the way an author writes one.
 * One seat unless told otherwise; `demo` gives it the bot objectives the
 * narrated demo needs to suggest a move.
 */
function rulesSource(args: { step: number; flow: string; seats?: number; demo?: boolean }): string {
  const seats = args.seats ?? 1;
  return [
    "import { Action, Game, Player, actionStep, defineFlow, eachPlayer, loop, sequence, type GameOptions } from 'boardsmith';",
    'export class CounterGame extends Game<CounterGame, Player> {',
    '  count = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    `    this.registerAction(Action.create('bump').execute(() => { this.count += ${args.step}; }));`,
    `    this.setFlow(defineFlow<CounterGame>({ root: ${args.flow} }));`,
    '  }',
    '}',
    'export const gameDefinition = {',
    '  gameClass: CounterGame,',
    "  gameType: 'rules-reload-counter',",
    `  minPlayers: ${seats},`,
    `  maxPlayers: ${seats},`,
    ...(args.demo === true ? ['  bot: { objectives: () => ({}) },'] : []),
    '};',
  ].join('\n');
}

/** A table project on disk, saved with the rules an author writes. */
function counterProject(initial: Parameters<typeof rulesSource>[0]) {
  const project = tableProject('bs-table-rules-reload-', rulesSource(initial));
  return {
    save: (rules: Parameters<typeof rulesSource>[0]) => project.save(rulesSource(rules)),
    load: project.load,
  };
}

const START = 1_700_000_000_000;

/** A hand-driven clock, so a timed step's window is observable without waiting. */
function fakeClock() {
  let now = START;
  const armed: Array<number | null> = [];
  let due: (() => void) | null = null;
  return {
    clock: {
      now: () => now,
      yieldTurn: async () => {},
      arm(delayMs: number | null, fire: () => void) {
        armed.push(delayMs);
        due = delayMs === null ? null : fire;
      },
    } satisfies WorldHostClock,
    advance(ms: number) {
      now += ms;
    },
    /** The armed timer goes off, as the Node clock's would once its delay has passed. */
    fire() {
      const fire = due;
      due = null;
      fire?.();
    },
    armed,
  };
}

async function openCounterTable(runtime: TableRuntime, clock = fakeClock()) {
  const table = await openTable(runtime, clients, {
    makeSeed: () => 'rules-reload',
    clock: clock.clock,
    idleAction: { name: 'bump' },
  });
  return { ...table, bump: () => table.act('bump') };
}

/** The counter as the last frame the seat was sent shows it. */
function shownCount(frames: ReadonlyArray<Record<string, unknown>>): number {
  const view = frames.at(-1)?.view as { state: { view: { attributes: { count: number } } } };
  return view.state.view.attributes.count;
}

describe('#343: a table dev host reloads its rules on the server', () => {
  it('runs the edited rule on the next move, from the position the game was in', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.looped });
    const table = await openCounterTable(await project.load());
    await table.bump();
    expect(shownCount(table.frames())).toBe(1);

    project.save({ step: 10, flow: FLOWS.looped });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('restored');
    await table.bump();
    // 1 from the move made on the old rule, 10 from the move made on the new one.
    expect(shownCount(table.frames())).toBe(11);
  }, 30_000);

  it('rebuilds the game by replaying its moves when the saved position no longer fits the flow', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.three });
    const table = await openCounterTable(await project.load());
    await table.bump();
    await table.bump();

    // Two moves in, the game stands at the third step of a three-step sequence.
    // The edited flow has one child there, so that position cannot be restored.
    project.save({ step: 1, flow: FLOWS.looped });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('replayed');
    expect(outcome?.kind === 'replayed' && outcome.moves).toBe(2);
    expect(shownCount(table.frames())).toBe(2);
    // And the table goes on, on the edited flow.
    const result = await table.bump();
    expect(result?.success).toBe(true);
    expect(shownCount(table.frames())).toBe(3);
    expect(table.errors()).toEqual([]);
  }, 30_000);

  it('tells every client and the terminal when the moves cannot be replayed either', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.three });
    const table = await openCounterTable(await project.load());
    // A second page on a one-seat table takes the seat, so the first takes it
    // back: both stay connected, and both must hear about the failure.
    await table.host.handleMessage('spectator', { type: 'hello' });
    await table.host.handleMessage('dev', { type: 'hello' });
    await table.bump();
    await table.bump();

    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A one-move game: the position does not fit, and the second move of the
    // history is made after the game is over, so replay fails too.
    project.save({ step: 1, flow: FLOWS.one });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('failed');
    const said = table.errors();
    expect(said.map((e) => e.to).sort()).toEqual(['dev', 'spectator']);
    for (const { message } of said) {
      expect(message).toContain('cannot continue on your edited rules');
      expect(message).toContain('New game');
    }
    expect(printed).toHaveBeenCalledWith(expect.stringContaining('cannot continue on your edited rules'));

    // A page that reloads is seated again (which clears its banner) and told again.
    const before = table.sent.length;
    await table.host.handleMessage('dev', { type: 'hello' });
    const replayed = table.sent.slice(before).filter((e) => e.clientId === 'dev').map((e) => e.msg.type);
    expect(replayed.indexOf('error')).toBeGreaterThan(replayed.indexOf('init'));

    // It does not carry on quietly: a move is refused with the same instruction.
    const refused = await table.bump();
    expect(refused).toBeUndefined();
    expect(table.errors().at(-1)?.message).toContain('New game');

    // And "New game" is the way forward, on the edited rules.
    await table.host.handleMessage('dev', { type: 'restart' });
    const next = await table.bump();
    expect(next?.success).toBe(true);
    expect(shownCount(table.frames())).toBe(1);
  }, 30_000);

  it("keeps a timed step's deadline across the reload, and the edited limit from the next step", async () => {
    const project = counterProject({ step: 1, flow: FLOWS.timed(10_000) });
    const time = fakeClock();
    const table = await openCounterTable(await project.load(), time);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 10_000);

    time.advance(4_000);
    time.armed.length = 0;
    project.save({ step: 1, flow: FLOWS.timed(20_000) });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('restored');
    // The carried game is at the same step, so the step keeps its window: a
    // save gives nobody more time (#387). The open step keeps the limit it
    // opened with, too: a step's limit is resolved when the step opens, and is
    // part of its state.
    expect(time.armed).toEqual([]);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 10_000);

    // The next step opens under the edited rules, with the edited limit.
    await table.bump();
    expect(time.armed.at(-1)).toBe(20_000);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 4_000 + 20_000);
  }, 30_000);

  it('only swaps the rules when no game is running, so the next start uses them', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.looped });
    const sent: HostOutbound[] = [];
    const host = new MultiplayerHost({
      playerCount: 1,
      minPlayers: 1,
      maxPlayers: 1,
      makeSeed: () => 'rules-reload',
      clock: fakeClock().clock,
      executeOp: (await project.load()).rules.executeOp,
      send: (_clientId, msg) => {
        sent.push(msg);
        clients.remember('dev', msg);
      },
    });

    project.save({ step: 7, flow: FLOWS.looped });
    expect(await host.reloadRules((await project.load()).rules)).toBeNull();

    await host.handleMessage('dev', { type: 'hello' });
    await host.handleMessage('dev', {
      type: 'server_request',
      requestId: 'one',
      op: 'action',
      payload: { actionName: 'bump', args: {}, boundaryKey: clients.key('dev') },
    });
    const frames = sent.filter((m): m is Extract<HostOutbound, { type: 'game_state' }> => m.type === 'game_state');
    expect(shownCount(frames)).toBe(7);
  }, 30_000);
});

/**
 * #379: A MOVE SENT WHILE THE EDITED RULES ARE STILL BUILDING WAITS FOR THEM.
 *
 * Driven the way `boardsmith dev` runs: a real socket into the real connection
 * handler, the queue `tableRulesReloadQueue` builds for the table road, and
 * real bundles of the author's rules. The rebuild is held until the move has
 * reached the host, so "sent before the bundle resolved" is a fact of the test
 * and not a race it hopes to win.
 */
// Bundling is the slow part, so it happens here, while the file is collected
// and no test timeout applies (#363).
const pendingProject = counterProject({ step: 1, flow: FLOWS.looped });
const beforeEdit = await pendingProject.load();
pendingProject.save({ step: 10, flow: FLOWS.looped });
const afterEdit = await pendingProject.load();
const brokenEdit = await buildFailure(tableProject('bs-table-rules-broken-', 'export const gameDefinition = ;').load);

const closing: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

/**
 * A table on `before` (the one-seat counter unless told otherwise) served over
 * a real socket, with `dev` seated, whose next reload builds `edit` (or fails
 * with it). Each save says what the rebuild waits for, so what a test sends
 * "during the rebuild" has always reached the host before it finishes.
 */
async function serveTable(edit: TableRuntime | Error, before: TableRuntime = beforeEdit, seats = 1) {
  let rebuildWaitsFor: Promise<void> = Promise.resolve();
  const load = async () => {
    await rebuildWaitsFor;
    if (edit instanceof Error) throw edit;
    return edit;
  };
  const sockets = new Map<string, WebSocket>();
  const host = new MultiplayerHost({
    playerCount: seats,
    minPlayers: seats,
    maxPlayers: seats,
    makeSeed: () => 'rules-reload',
    clock: fakeClock().clock,
    executeOp: before.rules.executeOp,
    hostWork: gateOf(() => queue),
    send: (clientId, message) => {
      const socket = sockets.get(clientId);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
  });
  const queue = tableRulesReloadQueue({ host, running: before.gameDefinition, load });
  const server = await serveSockets(
    createDevHostConnectionHandler({
      mpHost: host,
      clients: sockets,
      queue,
      onError: (error) => {
        throw error;
      },
    }),
  );
  closing.push(server.close);
  const page = await openSocketPage(server.port, 'dev', (f) => f.type === 'game_state');
  let request = 0;
  /** Bump as the page, from the board it last drew; resolves with the host's answer. */
  const bump = () => {
    const requestId = `bump-${++request}`;
    const drawn = page.frames.filter((f) => f.type === 'game_state').at(-1)!;
    const answer = page.next((f) => (f.type === 'server_response' || f.type === 'error') && f.requestId === requestId);
    page.send({
      type: 'server_request',
      requestId,
      op: 'action',
      payload: { actionName: 'bump', args: {}, boundaryKey: boundaryKeyOf(drawn.view) },
    });
    return answer;
  };
  const count = () => shownCount(page.frames.filter((f) => f.type === 'game_state'));
  /** Save an edit whose rebuild finishes once `until` has happened; resolves once the reload has settled. */
  const saveHeldUntil = (until: Promise<void>) => {
    rebuildWaitsFor = until;
    return queue.saved('src/rules/index.ts');
  };
  /** Save an edit and bump while it builds; resolves with the answer once the reload has settled. */
  const bumpDuringRebuild = async () => {
    const reloaded = saveHeldUntil(server.received((m) => m.type === 'server_request'));
    const answer = bump();
    await reloaded;
    return answer;
  };
  return { page, server, bump, bumpDuringRebuild, saveHeldUntil, count };
}

describe('#379: a move sent while the edited rules are still building', () => {
  it('waits for the edited rules and runs on them', async () => {
    const table = await serveTable(afterEdit);
    expect(await table.bump()).toMatchObject({ type: 'server_response' });
    await vi.waitFor(() => expect(table.count()).toBe(1));

    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await table.bumpDuringRebuild()).toMatchObject({ type: 'server_response', result: { success: true } });
    // 1 from the move before the save, 10 from the move sent during the rebuild.
    await vi.waitFor(() => expect(table.count()).toBe(11));
    await vi.waitFor(() =>
      expect(table.page.frames.filter((f) => f.type === 'rules_reload').map((f) => f.state)).toEqual([
        'reloading',
        'reloaded',
      ]),
    );
  }, 30_000);

  it('refuses the move with the rebuild error when the edit does not build, and stays on the old rules', async () => {
    const table = await serveTable(brokenEdit);
    await table.bump();
    await vi.waitFor(() => expect(table.count()).toBe(1));

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = await table.bumpDuringRebuild();
    expect(refused.type).toBe('error');
    expect(refused.message).toContain('Your edited rules did not load, so this table is still running the ones it had');
    expect(refused.message).toContain(brokenEdit.message);
    await vi.waitFor(() =>
      expect(table.page.frames.filter((f) => f.type === 'rules_reload').at(-1)).toMatchObject({
        state: 'failed',
        message: refused.message,
      }),
    );

    // The game is where it was, on the rules it had: the next move adds 1.
    expect(await table.bump()).toMatchObject({ type: 'server_response', result: { success: true } });
    await vi.waitFor(() => expect(table.count()).toBe(2));
  }, 30_000);
});

/**
 * #387: WORK THE TABLE STARTS ITSELF WAITS FOR THE EDITED RULES TOO.
 *
 * #379 held every page's messages while an edit rebuilt, but a step deadline
 * running out and a bot covering a seat whose page closed are not messages:
 * they fired during the rebuild and ran on the rules from before the save. They
 * go through the same queue now, as the host's own work that cannot be
 * refused: on the edited rules once they are in place, and on the old ones only
 * when the edit does not build.
 */
const timedProject = counterProject({ step: 1, flow: FLOWS.timed(10_000) });
const timedBefore = await timedProject.load();
timedProject.save({ step: 10, flow: FLOWS.timed(10_000) });
const timedAfter = await timedProject.load();

const turnsProject = counterProject({ step: 1, flow: FLOWS.turns, seats: 2 });
const turnsBefore = await turnsProject.load();
turnsProject.save({ step: 10, flow: FLOWS.turns, seats: 2 });
const turnsAfter = await turnsProject.load();

/** A timed one-seat table on `timedBefore`, whose next reload builds `edit` (or fails with it). */
async function timedTable(edit: TableRuntime | Error) {
  const time = fakeClock();
  const table = await openTable(timedBefore, clients, {
    makeSeed: () => 'rules-reload',
    clock: time.clock,
    idleAction: { name: 'bump' },
    hostWork: gateOf(() => queue),
  });
  const queue = tableRulesReloadQueue({
    host: table.host,
    running: timedBefore.gameDefinition,
    load: async () => {
      if (edit instanceof Error) throw edit;
      return edit;
    },
  });
  return { ...table, bump: () => table.act('bump'), time, queue };
}

/**
 * What each case below edits to, and the count the table then shows: 1 from
 * the move before the save, plus the step of the rules the host's own move ran
 * on.
 */
const OUTCOMES = [
  { on: 'the edited rules once they are in place', timed: timedAfter, turns: turnsAfter, count: 11 },
  { on: 'the old rules when the edit does not build', timed: brokenEdit, turns: brokenEdit, count: 2 },
];

/** The terminal's reload lines, which these cases do not read. */
function quietTerminal(): void {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
}

describe('#387: a step deadline that runs out while the edited rules are still building', () => {
  quietTerminal();

  it.each(OUTCOMES)('closes the step on $on', async ({ timed, count }) => {
    const table = await timedTable(timed);
    await table.bump();
    expect(shownCount(table.frames())).toBe(1);

    const reloaded = table.queue.saved('src/rules/index.ts');
    table.time.advance(10_000);
    table.time.fire();
    await reloaded;
    // The idle action the deadline submitted bumps by the step of the rules it ran on.
    await vi.waitFor(() => expect(shownCount(table.frames())).toBe(count));
  }, 30_000);
});

describe('#387: a bot covering a seat whose page closes while the edited rules are still building', () => {
  quietTerminal();

  it.each(OUTCOMES)('moves on $on', async ({ turns, count }) => {
    const table = await serveTable(turns, turnsBefore, 2);
    const p2 = await openSocketPage(table.server.port, 'p2', (f) => f.type === 'lobby');
    const joined = p2.next((f) => f.type === 'joined');
    p2.send({ type: 'join', seat: 2 });
    await joined;
    // Seat 1's move, on the rules from before any edit. Seat 2 is due next.
    await table.bump();
    await vi.waitFor(() => expect(table.count()).toBe(1));

    const reloaded = table.saveHeldUntil(table.server.closed());
    p2.socket.close();
    await reloaded;
    // The bot that took seat 2 over bumps by the step of the rules it ran on.
    await vi.waitFor(() => expect(table.count()).toBe(count));
  }, 30_000);
});

/**
 * #388: THE NARRATED DEMO'S NEXT MOVE WAITS FOR THE EDITED RULES TOO.
 *
 * The demo paces its moves with the session's own timer, which nothing in
 * #387 reached: a move that came due during the rebuild ran on the rules from
 * before the save. The session hands each demo move to the host's work gate
 * now, the rules reload queue in `boardsmith dev`.
 */
const demoProject = counterProject({ step: 1, flow: FLOWS.looped, demo: true });
const demoBefore = await demoProject.load();
demoProject.save({ step: 10, flow: FLOWS.looped, demo: true });
const demoAfter = await demoProject.load();

describe('#388: a demo move that comes due while the edited rules are still building', () => {
  quietTerminal();

  it.each([
    { on: 'the edited rules once they are in place', edit: demoAfter, count: 10 },
    { on: 'the old rules when the edit does not build', edit: brokenEdit, count: 1 },
  ])('runs on $on', async ({ edit, count }) => {
    let handedToGate: () => void = () => {};
    const handed = new Promise<void>((resolve) => (handedToGate = resolve));
    const table = await openTable(demoBefore, clients, {
      makeSeed: () => 'rules-reload',
      clock: fakeClock().clock,
      hostWork: {
        get reloadPending() {
          return queue.reloadPending;
        },
        hold(work) {
          handedToGate();
          queue.hold(work);
        },
      },
    });
    const moved = () => table.frames().some((frame) => shownCount([frame]) > 0);
    const queue = tableRulesReloadQueue({
      host: table.host,
      running: demoBefore.gameDefinition,
      // The rebuild finishes once the demo's move has come due: handed to the
      // gate, or made on the spot by a demo nothing holds.
      load: async () => {
        await Promise.race([handed, vi.waitFor(() => expect(moved()).toBe(true), { timeout: 10_000 })]);
        if (edit instanceof Error) throw edit;
        return edit;
      },
    });

    // The demo narrates its first move on the rules from before any edit, and
    // paces it for an hour.
    await table.ask('demo-start', { delay: 3_600_000 });
    await vi.waitFor(() =>
      expect(table.frames().some((frame) => JSON.stringify(frame.view).includes('"narration"'))).toBe(true),
    );

    const reloaded = queue.saved('src/rules/index.ts');
    // The pace runs out during the rebuild. (Sent straight to the host, as the
    // demo's own timer would fire, and not as a page's message the queue holds.)
    await table.ask('demo-control', { control: 'play', delay: 0 });
    await reloaded;

    // The first move the demo made adds the step of the rules it ran on.
    await vi.waitFor(() => expect(moved()).toBe(true));
    const first = table.frames().find((frame) => shownCount([frame]) > 0)!;
    expect(shownCount([first])).toBe(count);
    await table.ask('demo-stop', {});
  }, 30_000);
});
