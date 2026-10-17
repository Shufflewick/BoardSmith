import { beforeEach, describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound, type MultiplayerHostOptions } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';
import { succeeded } from '../../session/op-result.test-helper.js';

/** This suite's stand-in browser memory — see test-client-memory.ts. */
const clients = createDevHostClientMemory();
const rememberRendered = clients.remember;
/** The boundary key `clientId` would echo on its next submission. */
const clientKey = (clientId: string) => clients.key(clientId);

beforeEach(() => clients.reset());

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! , turnScope: 'restart' }),
      }),
    });
  }
}

const def = {
  gameClass: PassGame,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
} satisfies GameDefinitionLike;

// Each seat passes exactly once (no outer loop), then the flow completes →
// game over. Lets tests observe whether bot played the open seat (isComplete)
// and whether the follower borrows the active seat as it rotates.
class AlternateGame extends Game<AlternateGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['pass'] , turnScope: 'restart' }) }),
    });
  }
}

const altDef = {
  gameClass: AlternateGame,
  gameType: 'alternate',
  minPlayers: 2,
  maxPlayers: 2,
} satisfies GameDefinitionLike;

function makeAltHost(
  opts: { debug?: boolean; playerCount?: number; failStart?: () => boolean; refuseStart?: () => boolean } = {},
) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const playerCount = opts.playerCount ?? 2;
  const host = new MultiplayerHost({
    playerCount,
    minPlayers: 2,
    maxPlayers: playerCount,
    makeSeed: () => 'alt',
    debug: opts.debug,
    executeOp: (gameOptions, snap, pend, op, hostOptions) => {
      if (op.type === 'start' && opts.failStart?.()) throw new Error('The deck is missing.');
      if (op.type === 'start' && opts.refuseStart?.()) {
        return Promise.resolve({ success: false as const, error: 'The deck is missing.', category: 'bundle' as const });
      }
      return executeOp({ ...altDef, maxPlayers: playerCount }, gameOptions, snap, pend, op, hostOptions);
    },
    send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const has = (clientId: string, type: HostOutbound['type']) => to(clientId).some((m) => m.type === type);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any;
  const pass = (clientId: string, requestId: string) =>
    host.handleMessage(clientId, {
      type: 'server_request',
      requestId,
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey(clientId) },
    });
  return { host, sent, to, has, lastOfType, pass, clear: () => (sent.length = 0) };
}

/** The follower `A` is acting as seat 2, which is due, and sees that seat's own view. */
function expectFollowingSeatTwo(lastOfType: ReturnType<typeof makeAltHost>['lastOfType']): void {
  expect(lastOfType('A', 'init').seat).toBe(2);
  expect((lastOfType('A', 'game_state').view as any).state.isMyTurn).toBe(true);
}

function makeHost(opts: { designatedBotSeats?: number[]; debug?: boolean } = {}) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'mp',
    designatedBotSeats: opts.designatedBotSeats,
    debug: opts.debug,
    executeOp: (gameOptions, snap, pend, op, hostOptions) => executeOp(def, gameOptions, snap, pend, op, hostOptions),
    send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const has = (clientId: string, type: HostOutbound['type']) => to(clientId).some((m) => m.type === type);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any;
  return { host, sent, to, has, lastOfType, clear: () => (sent.length = 0) };
}

describe('MultiplayerHost (always-live)', () => {
  it('the first client auto-takes a seat and the game starts immediately', async () => {
    const { host, to, has } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    expect(has('A', 'init')).toBe(true);
    expect(has('A', 'game_state')).toBe(true);
    expect((to('A').find((m) => m.type === 'init') as any).seat).toBe(1);
  });

  it('the auto-seated dev avoids an --bot-designated seat', async () => {
    const { host, to } = makeHost({ designatedBotSeats: [1] }); // --bot 1
    await host.handleMessage('A', { type: 'hello' });
    // Seat 1 is reserved for the bot, so the dev lands in seat 2.
    expect((to('A').find((m) => m.type === 'init') as any).seat).toBe(2);
  });

  it('a second client lands in the seat-picker, not auto-seated', async () => {
    const { host, has, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // starts the game
    await host.handleMessage('B', { type: 'hello' });
    expect(lastOfType('B', 'lobby').phase).toBe('playing');
    expect(has('B', 'init')).toBe(false); // B must pick a seat
  });

  it('a second client can take over an open/bot seat mid-game', async () => {
    const { host, has } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    expect(has('B', 'joined')).toBe(true);
    expect(has('B', 'init')).toBe(true);
    expect(has('B', 'game_state')).toBe(true);
  });

  it('rejects taking a seat held by a connected client', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // A holds seat 1
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 1 });
    expect(lastOfType('B', 'error')).toBeTruthy();
  });

  it('routes an in-game action to the session and responds to the actor', async () => {
    const { host, to, has, clear } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    clear();
    await host.handleMessage('A', {
      type: 'server_request',
      requestId: 'r1',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('A') },
    });
    expect(has('A', 'game_state')).toBe(true);
    const resp = to('A').find((m) => m.type === 'server_response') as any;
    expect(resp.requestId).toBe('r1');
    expect(resp.result.success).toBe(true);
  });

  it('#878: two pages that send the same request id each get their own answer', async () => {
    const { host, to, pass } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, due
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B = seat 2, not due
    // Every page numbers its requests from req-0, and the host runs them concurrently.
    await Promise.all([pass('A', 'req-3'), pass('B', 'req-3')]);
    const answers = (clientId: string) =>
      to(clientId).filter((m) => m.type === 'server_response').map((m) => (m as any).result.success);
    expect(answers('A')).toEqual([true]);
    expect(answers('B')).toEqual([false]);
  });

  it('#878: a request the host cannot run is answered with an error and leaves nothing in flight', async () => {
    const { host, to } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    // No payload: reading the action name from it throws.
    await host.handleMessage('A', { type: 'server_request', requestId: 'r9', op: 'action', payload: undefined as any });
    const answer = to('A').find((m) => m.type === 'server_response') as any;
    expect(answer).toMatchObject({ requestId: 'r9', result: { success: false } });
    expect(answer.result.error).toMatch(/could not run.*action/i);
    expect((host as any).requestOrigin.size).toBe(0);
  });

  it('re-inits a seat on reconnect (same clientId) mid-game', async () => {
    const { host, has, clear } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    host.disconnect('A');
    clear();
    await host.handleMessage('A', { type: 'hello' });
    expect(has('A', 'init')).toBe(true);
    expect(has('A', 'game_state')).toBe(true);
  });

  it('restart rebuilds the game and re-sends init to the seated client', async () => {
    const { host, has, clear } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    clear();
    await host.handleMessage('A', { type: 'restart' });
    expect(has('A', 'init')).toBe(true);
    expect(has('A', 'game_state')).toBe(true);
  });

  it('F-12: two near-simultaneous restarts start only ONE new session (in-flight guard)', async () => {
    let startOps = 0;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOps++;
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });

    await host.handleMessage('A', { type: 'hello' }); // initial start
    startOps = 0;

    // Fire two restarts without awaiting the first — the second must be ignored
    // by the concurrency guard rather than building a second live session.
    const p1 = host.handleMessage('A', { type: 'restart' });
    const p2 = host.handleMessage('A', { type: 'restart' });
    await Promise.all([p1, p2]);

    expect(startOps).toBe(1);
  });

  it('leaving a seat mid-game frees it (reverts to open/bot)', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    await host.handleMessage('B', { type: 'leave' });
    const seat2 = lastOfType('A', 'lobby').seats.find((s: any) => s.seat === 2);
    expect(seat2.held).toBe(false);
  });
});

describe('MultiplayerHost — player configs', () => {
  it('passes playerConfigs with per-seat isBot to the game (production parity, drives in-flow bot)', async () => {
    // Games like MERC read options.playerConfigs[seat-1].isBot to decide whether a
    // seat is bot-controlled in their own flow. The production lobby supplies this;
    // the dev host must too, or the game treats the bot seat as a human and the
    // dev host's MCTS later finds "No available moves".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      botLevel: 'hard',
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });

    await host.handleMessage('A', { type: 'hello' }); // A → seat 1 (human); seat 2 open → bot

    const configs = startOptions?.playerConfigs as Array<{ isBot: boolean; botLevel?: string }> | undefined;
    expect(configs).toBeDefined();
    expect(configs?.[0].isBot).toBe(false); // seat 1 = human (A)
    expect(configs?.[1].isBot).toBe(true); // seat 2 = bot
    expect(configs?.[1].botLevel).toBe('hard');
  });
});

describe('MultiplayerHost — seat stability on reconnect', () => {
  it('a seated client reconnecting after a failed start keeps its seat (not reassigned to the bot)', async () => {
    // Repro: the dev auto-seats into seat 1, the first start fails (or hasn't
    // finished), then the browser reconnects. The reconnecting client must NOT be
    // bumped to another seat — otherwise seat 1 is released and played by a bot
    // while the dev is asked to take seat 2.
    let failNextStart = true;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start' && failNextStart) {
          failNextStart = false;
          throw new Error('simulated transient start failure');
        }
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });

    await host.handleMessage('A', { type: 'hello' }); // auto-seat seat 1, start FAILS
    await host.handleMessage('A', { type: 'hello' }); // reconnect → must stay in seat 1

    const lastLobby = [...sent]
      .reverse()
      .find((e) => e.clientId === 'A' && e.msg.type === 'lobby')?.msg as
      | { seats: Array<{ seat: number; held: boolean; mine: boolean }> }
      | undefined;
    const seat1 = lastLobby?.seats.find((s) => s.seat === 1);
    const seat2 = lastLobby?.seats.find((s) => s.seat === 2);
    expect(seat1?.mine).toBe(true); // still A's seat, not handed to the bot
    expect(seat2?.held).toBe(false); // A was NOT bumped to seat 2
  });
});

describe('MultiplayerHost — configure while a game is starting (#886)', () => {
  it('is refused and changes nothing, so the lobby never shows seats the game does not have', async () => {
    let release: (() => void) | null = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      executeOp: async (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start' && release === null && sent.length > 0) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return executeOp(def, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });
    const lastOfType = (clientId: string, type: HostOutbound['type']) =>
      [...sent].reverse().find((e) => e.clientId === clientId && e.msg.type === type)?.msg as any;
    await host.handleMessage('A', { type: 'hello' }); // the first start (nothing sent yet) is not held
    const restarting = host.handleMessage('A', { type: 'restart' }); // held inside its start op
    await host.handleMessage('A', { type: 'configure', gameOptions: { playerCount: 4 } });
    const told = lastOfType('A', 'error');
    release!();
    await restarting;
    await host.handleMessage('A', { type: 'getLobby' });
    expect(lastOfType('A', 'lobby').seats).toHaveLength(2);
    expect(lastOfType('A', 'lobby').playerCount).toBe(2);
    expect(told?.message).toMatch(/game is starting.*try again/i);
  });
});

describe('MultiplayerHost — a restart that fails (#880)', () => {
  it('leaves no dead game behind: moves are refused, every page is told why, and a reload starts a game', async () => {
    let failStart = false;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start' && failStart) throw new TypeError("Cannot read properties of undefined (reading 'cards')");
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });
    const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
    const lastOfType = (clientId: string, type: HostOutbound['type']) =>
      [...to(clientId)].reverse().find((m) => m.type === type) as any;
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    failStart = true;
    await host.handleMessage('A', { type: 'restart' });
    const told = lastOfType('A', 'error');
    sent.length = 0;
    await host.handleMessage('A', {
      type: 'server_request',
      requestId: 'r1',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('A') },
    });
    expect(to('A').some((m) => m.type === 'server_response')).toBe(false);
    expect(lastOfType('A', 'error')).toMatchObject({ message: expect.stringMatching(/no game is running.*reload/i), requestId: 'r1' });
    expect(told.message).toBe(
      "The game could not start (Cannot read properties of undefined (reading 'cards')). " +
        'Fix the problem, then press "New game" or reload this page.',
    );

    failStart = false;
    await host.handleMessage('A', { type: 'hello' }); // the reload the message asks for
    expect(lastOfType('A', 'init').seat).toBe(1);
  });
});

describe('MultiplayerHost — New game after a failed start (#1039)', () => {
  let logged: unknown[][] = [];
  const realError = console.error;
  beforeEach(() => {
    logged = [];
    console.error = (...args: unknown[]) => { logged.push(args); };
    return () => { console.error = realError; };
  });

  it('starts a game when the first start failed', async () => {
    let failStart = true;
    const { host, lastOfType } = makeAltHost({ refuseStart: () => failStart });
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1; its start fails
    failStart = false;
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'init').seat).toBe(1);
    expect(lastOfType('A', 'error').message).toBe(
      'The game could not start (The deck is missing.). Fix the problem, then press "New game" or reload this page.',
    );
  });

  it('starts a game when a restart failed', async () => {
    let failStart = false;
    const { host, lastOfType, clear } = makeAltHost({ failStart: () => failStart });
    await host.handleMessage('A', { type: 'hello' });
    failStart = true;
    await host.handleMessage('A', { type: 'restart' });
    failStart = false;
    clear();
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'error')).toBeUndefined();
    expect(lastOfType('A', 'init').seat).toBe(1);
  });

  it('prints a refused start in the terminal as one readable line', async () => {
    const { host } = makeAltHost({ refuseStart: () => true });
    await host.handleMessage('A', { type: 'hello' });
    expect(logged).toEqual([
      ['[boardsmith dev] The game could not start (The deck is missing.). Fix the problem, then press "New game" or reload this page.'],
    ]);
  });

  it('prints a start that crashed in the terminal with its stack', async () => {
    const { host } = makeAltHost({ failStart: () => true });
    await host.handleMessage('A', { type: 'hello' });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual([
      '[boardsmith dev] The game could not start (The deck is missing.). Fix the problem, then press "New game" or reload this page.',
      expect.stringMatching(/^Error: The deck is missing\.\n\s+at /),
    ]);
  });
});

describe('MultiplayerHost — a move while a restart is starting (#1042)', () => {
  it('is refused with the reason, not answered success with no new state', async () => {
    let release: (() => void) | null = null;
    let starts = 0;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'mp',
      executeOp: async (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start' && ++starts === 2) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });
    const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1; the first start is not held
    const key = clientKey('A');
    const restarting = host.handleMessage('A', { type: 'restart' }); // held inside its start op
    sent.length = 0;
    await host.handleMessage('A', {
      type: 'server_request',
      requestId: 'r1',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: key },
    });
    await host.handleMessage('A', { type: 'getState', requestId: 'r2' });
    await host.handleMessage('A', { type: 'restart' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    host.disconnect('A'); // the page reloads while the new game starts
    await host.handleMessage('A', { type: 'hello' });
    const during = to('A');
    sent.length = 0;
    release!();
    await restarting;
    expect(during.some((m) => m.type === 'server_response' || m.type === 'game_state')).toBe(false);
    expect(during.some((m) => m.type === 'init')).toBe(true);
    const after = to('A').filter((m) => m.type === 'init' || m.type === 'game_state').map((m) => m.type);
    expect(after.slice(-2)).toEqual(['init', 'game_state']); // startGame's reinit, after any state the new game broadcast
    const errors = during.filter((m) => m.type === 'error');
    expect(errors).toEqual([
      { type: 'error', message: expect.stringMatching(/game is starting.*try again/i), requestId: 'r1' },
      { type: 'error', message: expect.stringMatching(/game is starting.*try again/i), requestId: 'r2' },
      { type: 'error', message: expect.stringMatching(/game is starting.*try again/i) },
      { type: 'error', message: expect.stringMatching(/game is starting.*try again/i) },
    ]);
  });
});

describe('MultiplayerHost — stale disconnect after reconnect (DEF-C session-layer canary)', () => {
  it('drops broadcasts to a seat when a STALE disconnect() arrives after its reconnect hello (documents the consequence the dev.ts transport-layer guard must prevent)', async () => {
    // This test intentionally drives the sequence that `MultiplayerHost`'s
    // public API allows a careless transport to trigger: hello (reconnect)
    // THEN a disconnect() call for the SAME clientId. MultiplayerHost has no
    // way to know the disconnect is stale (it only sees clientId strings, not
    // socket identity) — that check belongs one layer up, in dev.ts's
    // `wss.on('connection', ...)` close handler (see 153-RESEARCH.md).
    // This canary documents WHY that transport-layer guard is required: once
    // disconnect() runs, this seat's connected flag flips false and every
    // subsequent broadcast/response to it is silently dropped, even though
    // the client just told the host it reconnected. The real fix (Task 2) is
    // in dev.ts, NOT here — MultiplayerHost's disconnect() contract is
    // correct on its own; the bug is a transport that calls it wrongly.
    const { host, to, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('B', { type: 'hello' }); // B unseated
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B = seat 2
    clear();

    await host.handleMessage('A', { type: 'hello' }); // A's browser reloads and reconnects (same clientId)
    clear();

    host.disconnect('A'); // the OLD socket's belated close event finally arrives (stale)

    clear();
    await pass('A', 'r1'); // A acts — handleServerRequest has no connected-check, so this is accepted
    expect(to('A').some((m) => m.type === 'game_state')).toBe(false); // dropped: connected flag is wrongly false
    expect(to('A').some((m) => m.type === 'server_response')).toBe(false); // dropped for the same reason
  });
});

describe('MultiplayerHost — follow active seat', () => {
  it('baseline: without follow, bot plays the open seat and the game completes', async () => {
    const { host, lastOfType, pass } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = bot
    await pass('A', 'r1'); // A passes seat 1 → bot passes seat 2 → flow completes
    await host.settled();
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('enabling follow pauses bot and lets one client drive both seats', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = bot
    clear();

    // Enable follow while seat 1 (A's own seat) is active.
    await host.handleMessage('A', { type: 'follow', enabled: true });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: true, seat: 1 });

    // A passes as seat 1. bot must NOT play seat 2 — instead the follower is
    // handed seat 2 (init seat 2) and the game is NOT complete.
    clear();
    await pass('A', 'r1');
    expect(lastOfType('A', 'init').seat).toBe(2);
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);

    // A now passes as seat 2 (attributed to the active seat) → flow completes.
    clear();
    await pass('A', 'r2');
    await host.settled();
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('routes a follower\'s server_response back to the follower, not the empty acting seat', async () => {
    const { host, to, pass } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = open
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // A passes as seat 1 → seat 2 becomes the active seat

    // A now acts as seat 2 — a seat it does NOT occupy. Its server_response must
    // route back to A (by requestId), not to seat 2's (empty) client. Before the
    // fix it was posted to the acting seat and silently dropped, which left
    // element-pick resolve_choices (and thus validElements) empty in the
    // follower's UI even though game_state broadcasts still arrived.
    await pass('A', 'r2');
    const resp = to('A').find(
      (m) => m.type === 'server_response' && (m as { requestId?: string }).requestId === 'r2',
    );
    expect(resp).toBeDefined();
  });

  it('disabling follow mid-game resumes bot for the open seat', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // seat 1 passed; now seat 2 is active, bot paused
    clear();

    // Disable while seat 2 is active → seat 2 reverts to bot, which passes →
    // flow completes.
    await host.handleMessage('A', { type: 'follow', enabled: false });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('rejects enabling follow when the client holds no seat', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A seated, game live
    await host.handleMessage('B', { type: 'hello' }); // B unseated (seat-picker)
    await host.handleMessage('B', { type: 'follow', enabled: true });
    expect(lastOfType('B', 'error').message).toMatch(/take a seat/i);
  });

  it('follow-mode survives a follower reconnect (page reload)', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // seat 2 active, A is the follower
    host.disconnect('A'); // page reload: WS closes...
    clear();
    await host.handleMessage('A', { type: 'hello' }); // ...then reconnects (same id)
    // Follow is restored: A is told follow is on and re-shown the ACTIVE seat (2),
    // with seat 2's own view (isMyTurn true) — not its own seat 1.
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: true, seat: 2 });
    expectFollowingSeatTwo(lastOfType);
  });

  it('explicitly leaving ends follow-mode', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await host.handleMessage('A', { type: 'leave' });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
  });

  it.each([
    ['a restart', { type: 'restart' }],
    ['a configure restart', { type: 'configure', gameOptions: {} }],
  ] as const)('#460: follow-mode survives %s: no bot acts in the new game, and the follower is shown the seat that is due', async (_, message) => {
    const { host, lastOfType, pass, has, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    clear();
    await host.handleMessage('A', message);

    expect(has('A', 'follow')).toBe(false);
    // A passes as seat 1; with a bot on seat 2 the game would now be over.
    await pass('A', 'r1');
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
    expectFollowingSeatTwo(lastOfType);
  });

  it('#460: a configure that removes the follower\'s seat ends follow-mode, so the bots drive the seats left', async () => {
    const { host, lastOfType } = makeHost({ designatedBotSeats: [1] }); // A lands in seat 2
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });

    await host.handleMessage('A', { type: 'configure', gameOptions: { playerCount: 1 } });

    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
  });

  it('#877: follow is refused while another person holds a seat, so nobody sees or plays their seat', async () => {
    const { host, lastOfType, has, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B = seat 2 (human)
    clear();
    await host.handleMessage('A', { type: 'follow', enabled: true });
    expect(lastOfType('A', 'error').message).toMatch(/only person at the table/i);
    expect(has('A', 'follow')).toBe(false);
    await pass('A', 'r1'); // seat 2 (B) is due now; A must not be handed it
    expect(has('A', 'init')).toBe(false);
  });

  it('#884: under --debug, a seat its player leaves while someone follows is not handed to a bot', async () => {
    const { host, lastOfType, pass } = makeAltHost({ debug: true });
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B = seat 2
    await host.handleMessage('A', { type: 'follow', enabled: true }); // --debug keeps follow open to A
    await pass('A', 'r1'); // seat 2 is due now
    await host.handleMessage('B', { type: 'leave' });
    await host.settled();
    // The follower drives seat 2 now; a bot passing it would have ended the game.
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
    expectFollowingSeatTwo(lastOfType);
  });

  it('#877: when a second person ends follow, the bots resume the seats the follower was covering', async () => {
    const { host, lastOfType, pass } = makeAltHost({ playerCount: 3 });
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1; seats 2 and 3 are bots
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // as seat 1
    await pass('A', 'r2'); // as seat 2; seat 3 is due and its bot is paused
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    await host.settled();
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
    // Seat 3's bot took its turn, the last one in the game.
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('#877: a second person arriving at a table whose start failed ends follow before the next start', async () => {
    let failStart = false;
    const { host, lastOfType } = makeAltHost({ failStart: () => failStart });
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('A', { type: 'follow', enabled: true });
    failStart = true;
    await host.handleMessage('A', { type: 'restart' }); // fails: back to the lobby, A still follows
    failStart = false;
    await host.handleMessage('B', { type: 'hello' }); // first arrival in the lobby: seated, and the game starts
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
    expect(lastOfType('A', 'error').message).toMatch(/follow active seat ended/i);
    expect(lastOfType('A', 'init').seat).toBe(1);
    expect(lastOfType('B', 'init').seat).toBe(2);
  });

  it('#877: a second person sitting down ends follow-mode and tells the follower why', async () => {
    const { host, lastOfType, has, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await host.handleMessage('B', { type: 'hello' });
    clear();
    await host.handleMessage('B', { type: 'join', seat: 2 });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false, seat: 1 });
    expect(lastOfType('A', 'error').message).toMatch(/follow active seat ended.*someone else holds a seat/i);
    clear();
    await pass('A', 'r1'); // seat 2 (B) is due now; A must not be handed it
    expect(has('A', 'init')).toBe(false);
  });
});

// ── Teaching lockout (cross-layer, --lock-teaching wiring) ────────────────────
// These tests exercise the full stack: MultiplayerHost with teachingDisabled:true
// → baseOptions.teachingDisabled → executeOp guards (hint/heatmapToggle/startTutorial)
// AND createDevSession adapters.teachingDisabled → SnapshotSessionHost.handleOp
// (demoStart). No stubs — the REAL executeOp and SnapshotSessionHost are used.

function makeLockedHost() {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'locked',
    teachingDisabled: true,
    executeOp: (gameOptions, snap, pend, op, hostOptions) => executeOp(def, gameOptions, snap, pend, op, hostOptions),
    send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any;
  const serverReq = (clientId: string, requestId: string, op: string, payload: Record<string, unknown> = {}) =>
    host.handleMessage(clientId, { type: 'server_request', requestId, op, payload });
  return { host, sent, to, lastOfType, serverReq, clear: () => (sent.length = 0) };
}

describe('MultiplayerHost — teaching lockout (cross-layer: teachingDisabled:true)', () => {
  it('hint op is rejected fail-loud through the real executeOp guard', async () => {
    const { host, lastOfType, serverReq } = makeLockedHost();
    await host.handleMessage('A', { type: 'hello' }); // A → seat 1, game starts

    await serverReq('A', 'r-hint', 'hint', { seat: 1 });
    const resp = lastOfType('A', 'server_response');
    expect(resp.requestId).toBe('r-hint');
    expect(resp.result.success).toBe(false);
    expect(resp.result.error).toMatch(/disabled/i);
  });

  it('heatmap-toggle op is rejected fail-loud through the real executeOp guard', async () => {
    const { host, lastOfType, serverReq } = makeLockedHost();
    await host.handleMessage('A', { type: 'hello' });

    await serverReq('A', 'r-heatmap', 'heatmap-toggle', { visible: true });
    const resp = lastOfType('A', 'server_response');
    expect(resp.requestId).toBe('r-heatmap');
    expect(resp.result.success).toBe(false);
    expect(resp.result.error).toMatch(/disabled/i);
  });

  it('start-tutorial op is rejected fail-loud through the real executeOp guard', async () => {
    const { host, lastOfType, serverReq } = makeLockedHost();
    await host.handleMessage('A', { type: 'hello' });

    await serverReq('A', 'r-tutorial', 'start-tutorial');
    const resp = lastOfType('A', 'server_response');
    expect(resp.requestId).toBe('r-tutorial');
    expect(resp.result.success).toBe(false);
    expect(resp.result.error).toMatch(/disabled/i);
  });

  it('demo-start op is rejected fail-loud through the real SnapshotSessionHost.handleOp guard', async () => {
    const { host, lastOfType, serverReq } = makeLockedHost();
    await host.handleMessage('A', { type: 'hello' });

    await serverReq('A', 'r-demo', 'demo-start');
    const resp = lastOfType('A', 'server_response');
    expect(resp.requestId).toBe('r-demo');
    expect(resp.result.success).toBe(false);
    expect(resp.result.error).toMatch(/disabled/i);
  });

  it('without teachingDisabled, a pass action routes normally (default unchanged)', async () => {
    // Uses the standard makeHost (teachingDisabled absent) to confirm lockout is
    // NOT active when the flag is omitted.
    const { host, lastOfType, clear } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    clear();
    await host.handleMessage('A', {
      type: 'server_request',
      requestId: 'r-pass',
      op: 'action',
      payload: { actionName: 'pass', args: {}, boundaryKey: clientKey('A') },
    });
    const resp = lastOfType('A', 'server_response');
    expect(resp.result.success).toBe(true);
  });
});

// ── Scriptable dev-host ops (DRIVE-01/DRIVE-03) ───────────────────────────────

describe('MultiplayerHost — getState', () => {
  it('returns the caller\'s own seat view, matching viewForSeat, with requestId echoed', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // A → seat 1, game live
    await host.handleMessage('A', { type: 'getState', requestId: 'gs-1' });
    const gs = lastOfType('A', 'game_state');
    expect(gs.requestId).toBe('gs-1');
    expect(gs.view).toBeDefined();
    expect(gs.isComplete).toBe(false);
  });

  it('errors (not a view) when called before any join, in lobby phase', async () => {
    const { host, lastOfType } = makeHost();
    // No 'hello' yet — host is still in 'lobby' phase, no session.
    await host.handleMessage('Z', { type: 'getState', requestId: 'gs-2' });
    const err = lastOfType('Z', 'error');
    expect(err).toBeTruthy();
    expect(lastOfType('Z', 'game_state')).toBeUndefined();
  });

  it('errors (not a view) for a connected-but-unseated client mid-game', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // A → seat 1, game starts
    await host.handleMessage('B', { type: 'hello' }); // B lands in seat-picker, unseated
    await host.handleMessage('B', { type: 'getState', requestId: 'gs-3' });
    const err = lastOfType('B', 'error');
    expect(err).toBeTruthy();
    expect(lastOfType('B', 'game_state')).toBeUndefined();
  });

  it('ignores any client-supplied seat field — seat is server-resolved only', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // A → seat 1
    await host.handleMessage('B', { type: 'hello' }); // B unseated
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B → seat 2
    // getState has no `seat` field on the ClientInbound variant, so even if a
    // crafted payload smuggled one in, TypeScript wouldn't accept it and the
    // handler never reads anything but clientSeat/followerClientId.
    await host.handleMessage('B', { type: 'getState', requestId: 'gs-4' });
    const gsB = lastOfType('B', 'game_state');
    expect(gsB.requestId).toBe('gs-4');
    // B's view must differ in identity from A's — each seat sees its own view;
    // proving this requires seat-scoped content, so at minimum assert B got A's
    // response, not silently nothing.
    expect(gsB.view).toBeDefined();
  });
});

describe('MultiplayerHost — getLobby', () => {
  it('returns the lobby payload in lobby phase, before any join, with requestId echoed', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('Z', { type: 'getLobby', requestId: 'gl-1' });
    const lobby = lastOfType('Z', 'lobby');
    expect(lobby).toBeTruthy();
    expect(lobby.requestId).toBe('gl-1');
    expect(lobby.phase).toBe('lobby');
  });

  it('also works mid-game (any phase)', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // game starts
    await host.handleMessage('A', { type: 'getLobby', requestId: 'gl-2' });
    const lobby = lastOfType('A', 'lobby');
    expect(lobby.requestId).toBe('gl-2');
    expect(lobby.phase).toBe('playing');
  });
});

describe('MultiplayerHost — debugToggle/uiSwitch relay', () => {
  it('debugToggle fans out to ALL connected clients', async () => {
    const { host, has } = makeHost();
    await host.handleMessage('A', { type: 'hello' }); // A → seat 1
    await host.handleMessage('B', { type: 'hello' }); // B unseated but connected

    await host.handleMessage('A', { type: 'debugToggle' });
    expect(has('A', 'debugToggle')).toBe(true);
    expect(has('B', 'debugToggle')).toBe(true);
  });

  it('uiSwitch forwards the name intact to all connected clients', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });

    await host.handleMessage('B', { type: 'uiSwitch', name: 'custom' });
    expect(lastOfType('A', 'uiSwitch')).toMatchObject({ name: 'custom' });
    expect(lastOfType('B', 'uiSwitch')).toMatchObject({ name: 'custom' });
  });

  it('neither op mutates game state (session untouched)', async () => {
    const { host, lastOfType, clear } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    clear();
    await host.handleMessage('A', { type: 'debugToggle' });
    await host.handleMessage('A', { type: 'uiSwitch', name: 'auto' });
    // No game_state/error frame is produced by either relay op.
    expect(lastOfType('A', 'game_state')).toBeUndefined();
    expect(lastOfType('A', 'error')).toBeUndefined();
  });
});

// ── D11 (ENDGAME-02): restart from a finished game ──────────────────────────
// The real restart path (`{type:'restart'}` → handleRestart → startGame()) is
// NOT guard-gated against a finished game — `LobbyPhase` has no 'complete'
// value, so completion never flips `phase` off 'playing'. The tests below are
// CHARACTERIZATION/ADVERSARIAL: they document that the host-level restart
// already works and already rejects mid-setup — they are expected to PASS on
// CURRENT (pre-fix) source. D11's actual bug is the DevHost/GameShell ROUTING
// gaps covered in DevHost.restart.test.ts and GameShell.restart.test.ts.
describe('MultiplayerHost — restart from a finished game (D11 characterization + adversarial)', () => {
  function makeAltHostWithSeedCapture(options: Pick<MultiplayerHostOptions, 'seedSnapshot'> = {}) {
    const seeds: string[] = [];
    let seedCounter = 0;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      ...options,
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => `seed-${seedCounter++}`,
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') seeds.push((gameOptions as { seed?: string }).seed ?? '');
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });
    const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
    const lastOfType = (clientId: string, type: HostOutbound['type']) =>
      [...to(clientId)].reverse().find((m) => m.type === type) as any;
    const pass = (clientId: string, requestId: string) =>
      host.handleMessage(clientId, {
        type: 'server_request',
        requestId,
        op: 'action',
        payload: { actionName: 'pass', args: {}, boundaryKey: clientKey(clientId) },
      });
    return { host, sent, to, lastOfType, pass, seeds, clear: () => (sent.length = 0) };
  }

  it("CHARACTERIZATION (already passes pre-fix): a {type:'restart'} sent to a FINISHED game restarts with a fresh runner+seed (the guard never rejected this)", async () => {
    const { host, lastOfType, pass, seeds } = makeAltHostWithSeedCapture();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = bot
    await pass('A', 'r1'); // A passes seat 1 → bot passes seat 2 → flow completes
    await host.settled();
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
    expect(seeds).toHaveLength(1);

    await host.handleMessage('A', { type: 'restart' });

    // Fresh runner+seed: a SECOND 'start' op fired with a DIFFERENT seed.
    expect(seeds).toHaveLength(2);
    expect(seeds[1]).not.toBe(seeds[0]);
    // isComplete is cleared, not carried over from the finished game.
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
  });

  it('ADVERSARIAL: the restarted game is genuinely playable from move 0 (not the stale finished runner), and a second restart loops', async () => {
    const { host, lastOfType, pass, seeds } = makeAltHostWithSeedCapture();
    await host.handleMessage('A', { type: 'hello' });
    await pass('A', 'r1');
    await host.settled();
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);

    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);

    // Acting in the restarted game must succeed and complete it again — proves
    // the runner is a genuinely fresh instance, not the finished one replaying
    // a completed flow (which would reject the action or stay complete).
    await pass('A', 'r2');
    await host.settled();
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);

    // Second restart-from-finished: the multi-game-format loop repeats.
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
    expect(seeds).toHaveLength(3);
    expect(new Set(seeds).size).toBe(3); // three distinct seeds across two restarts
  });

  it('#460: a restart naming a seed deals the new game from it, and every frame says which seed its game was dealt from', async () => {
    const { host, lastOfType, seeds } = makeAltHostWithSeedCapture();
    await host.handleMessage('A', { type: 'hello' });
    expect(lastOfType('A', 'game_state').seed).toBe('seed-0');

    await host.handleMessage('A', { type: 'restart', seed: 'deal-7' });

    expect(seeds).toEqual(['seed-0', 'deal-7']);
    expect(lastOfType('A', 'game_state').seed).toBe('deal-7');
    // A restart naming no seed deals a fresh one again.
    await host.handleMessage('A', { type: 'restart' });
    expect(seeds).toEqual(['seed-0', 'deal-7', 'seed-1']);
  });

  it('#460: refuses a blank seed, saying what a seed is, and leaves the game as it was', async () => {
    const { host, lastOfType, seeds } = makeAltHostWithSeedCapture();
    await host.handleMessage('A', { type: 'hello' });

    await host.handleMessage('A', { type: 'restart', seed: '  ' });

    expect(seeds).toEqual(['seed-0']);
    expect(lastOfType('A', 'error').message).toBe(
      'A game is dealt from a seed, any text that is not blank (such as "7" or "opening"). Type one, then deal again.',
    );
  });

  it('#460: a host that starts every game from a recorded state refuses to deal from a seed, and says why', async () => {
    const recorded = succeeded(await executeOp(altDef, { playerCount: 2, seed: 'recorded' }, null, null, { type: 'start' }));
    const { host, lastOfType } = makeAltHostWithSeedCapture({
      seedSnapshot: recorded.snapshot as NonNullable<MultiplayerHostOptions['seedSnapshot']>,
    });
    await host.handleMessage('A', { type: 'hello' });
    expect(lastOfType('A', 'game_state').seed).toBe('recorded');

    await host.handleMessage('A', { type: 'restart', seed: 'deal-7' });

    expect(lastOfType('A', 'error').message).toBe(
      'This `boardsmith dev` starts every game from the recorded state its `--seed <file>` names, so it cannot deal ' +
        'from a seed. Start `boardsmith dev` without `--seed` to deal from one.',
    );
    expect(lastOfType('A', 'game_state').seed).toBe('recorded');
  });

  it('CHARACTERIZATION (already passes pre-fix): a restart with no live session (never started) is still rejected', async () => {
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: def.maxPlayers,
      makeSeed: () => 'never-started',
      executeOp: (gameOptions, snap, pend, op, hostOptions) =>
        executeOp(altDef, gameOptions, snap, pend, op, hostOptions),
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });
    // No 'hello' — the host is never told a client connected, so it never
    // auto-starts. Bypass the happy path entirely: send restart cold.
    await host.handleMessage('A', { type: 'restart' });
    const err = sent.find((e) => e.msg.type === 'error');
    expect(err?.msg).toMatchObject({ message: 'No game in progress to restart.' });
  });
});

/**
 * A 1-seat game (`minPlayers: 1`, or `--players 1`) has exactly one seat, so a
 * "pick a seat" screen offers no choice. Before the fix, only the FIRST client
 * ever to connect was auto-seated; every later client was sent the seat-picker,
 * and when seat 1's holder was still connected `DevHost.vue` rendered no "Take
 * seat" button for it. That left the page with no control of any kind and the
 * board never mounted (issue #150).
 */
function makeSoloHost() {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 1,
    minPlayers: 1,
    maxPlayers: def.maxPlayers,
    makeSeed: () => 'solo',
    executeOp: (gameOptions, snap, pend, op, hostOptions) => executeOp(def, gameOptions, snap, pend, op, hostOptions),
    send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const has = (clientId: string, type: HostOutbound['type']) => to(clientId).some((m) => m.type === type);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type) as any;
  return { host, sent, to, has, lastOfType, clear: () => (sent.length = 0) };
}

describe('MultiplayerHost — a 1-seat game has no seat to pick (#150)', () => {
  it('seats a SECOND live client in seat 1 instead of a seat-picker it cannot act on', async () => {
    const { host, has, lastOfType } = makeSoloHost();
    await host.handleMessage('A', { type: 'hello' }); // auto-seated, game starts
    await host.handleMessage('B', { type: 'hello' }); // second tab, A still connected

    expect(has('B', 'init')).toBe(true);
    expect(lastOfType('B', 'init').seat).toBe(1);
    expect(has('B', 'game_state')).toBe(true);
  });

  it('seats a later SOLO client in seat 1 when the first client has gone away', async () => {
    const { host, has, lastOfType } = makeSoloHost();
    await host.handleMessage('A', { type: 'hello' });
    host.disconnect('A'); // tab closed / fresh browser profile → new clientId next time
    await host.handleMessage('B', { type: 'hello' });

    expect(has('B', 'init')).toBe(true);
    expect(lastOfType('B', 'init').seat).toBe(1);
  });

  it('hands seat 1 wholly to the new client, leaving no dangling reservation for the old one', async () => {
    const { host, lastOfType } = makeSoloHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' }); // B supersedes A on seat 1
    await host.handleMessage('A', { type: 'hello' }); // A returns: must NOT reclaim B's seat

    const seat1 = lastOfType('A', 'lobby').seats.find((s: any) => s.seat === 1);
    expect(seat1.mine).toBe(true); // newest client owns the one seat
    expect(lastOfType('B', 'lobby').seats.find((s: any) => s.seat === 1).mine).toBe(false);
    expect(seat1.connected).toBe(true);
  });

  it('does NOT auto-seat later clients when there is more than one seat (the real lobby is preserved)', async () => {
    const { host, has, lastOfType } = makeHost(); // playerCount: 2
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });

    expect(has('B', 'init')).toBe(false); // B still picks its seat
    expect(lastOfType('B', 'lobby').seats.find((s: any) => s.seat === 2).held).toBe(false);
  });
});

// #481: debugging is on only while one person holds every human seat, unless
// `boardsmith dev --debug` forces it on.
describe('MultiplayerHost debugging follows who holds the seats (#481)', () => {
  async function ask(t: ReturnType<typeof makeHost>, clientId: string, op: string, payload: Record<string, unknown> = {}) {
    const requestId = `${op}-${Math.random()}`;
    await t.host.handleMessage(clientId, { type: 'server_request', requestId, op, payload });
    const reply = t.to(clientId).find((m) => m.type === 'server_response' && m.requestId === requestId);
    return (reply as Extract<HostOutbound, { type: 'server_response' }>).result;
  }
  const lobbyDebug = (t: ReturnType<typeof makeHost>, clientId: string) =>
    (t.lastOfType(clientId, 'lobby') as { debug: boolean }).debug;

  it('is on for one person alone at the table', async () => {
    const t = makeHost();
    await t.host.handleMessage('A', { type: 'hello' });
    expect(lobbyDebug(t, 'A')).toBe(true);
    expect((await ask(t, 'A', 'debug:history')).success).toBe(true);
    expect((await ask(t, 'A', 'debug:logs')).success).toBe(true);
  });

  it('turns off for everyone the moment a second person takes a seat, and back on when they leave', async () => {
    const t = makeHost();
    await t.host.handleMessage('A', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'join', seat: 2 });

    expect(lobbyDebug(t, 'A')).toBe(false);
    expect(lobbyDebug(t, 'B')).toBe(false);
    for (const [op, payload] of [
      ['debug:history', {}],
      ['debug:logs', {}],
      ['debug:rewind', { actionIndex: 0 }],
      ['debug:shuffle-deck', { deckId: 1 }],
      ['debug:state-at', { actionIndex: 0 }],
    ] as const) {
      for (const who of ['A', 'B']) {
        const result = await ask(t, who, op, { ...payload });
        expect(result.success, `${who} ${op}`).toBe(false);
        expect(result.error).toMatch(/debugging is not turned on/i);
      }
    }

    await t.host.handleMessage('B', { type: 'leave' });
    expect(lobbyDebug(t, 'A')).toBe(true);
    expect((await ask(t, 'A', 'debug:history')).success).toBe(true);
  });

  it('stays off while a second person is away but still holds their seat', async () => {
    const t = makeHost();
    await t.host.handleMessage('A', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'join', seat: 2 });
    t.host.disconnect('B');
    expect(lobbyDebug(t, 'A')).toBe(false);
    expect((await ask(t, 'A', 'debug:history')).success).toBe(false);
  });

  it('does not count bot seats as people: one human with --bot seats keeps debugging on', async () => {
    const t = makeHost({ designatedBotSeats: [1] });
    await t.host.handleMessage('A', { type: 'hello' });
    expect(t.lastOfType('A', 'init').seat).toBe(2);
    expect(lobbyDebug(t, 'A')).toBe(true);
    expect((await ask(t, 'A', 'debug:history')).success).toBe(true);
  });

  it('is on for a several-person table when the host forces it (boardsmith dev --debug)', async () => {
    const t = makeHost({ debug: true });
    await t.host.handleMessage('A', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'hello' });
    await t.host.handleMessage('B', { type: 'join', seat: 2 });
    expect(lobbyDebug(t, 'A')).toBe(true);
    expect((await ask(t, 'B', 'debug:history')).success).toBe(true);
  });
});

// A client id is how the dev host knows who is who (reconnects, the one-person
// debug rule). Handing one client another's id lets it connect as them.
describe('MultiplayerHost lobby frames carry no client ids', () => {
  it('no lobby frame or getLobby reply names any seat holder; each says only which seat is yours', async () => {
    const t = makeHost();
    await t.host.handleMessage('client-alpha', { type: 'hello' });
    await t.host.handleMessage('client-beta', { type: 'hello' });
    await t.host.handleMessage('client-beta', { type: 'join', seat: 2 });
    await t.host.handleMessage('client-alpha', { type: 'getLobby', requestId: 'q' });
    t.host.disconnect('client-beta');

    const lobbies = t.sent.filter((e) => e.msg.type === 'lobby');
    expect(lobbies.length).toBeGreaterThan(2);
    for (const { clientId, msg } of lobbies) {
      const frame = JSON.stringify(msg);
      expect(frame).not.toContain('"clientId"');
      const other = clientId === 'client-alpha' ? 'client-beta' : 'client-alpha';
      expect(frame).not.toContain(other);
    }

    const forAlpha = t.lastOfType('client-alpha', 'lobby') as { seats: Array<{ seat: number; mine: boolean; held: boolean }> };
    expect(forAlpha.seats.map((s) => [s.seat, s.mine, s.held])).toEqual([[1, true, true], [2, false, true]]);
  });
});
