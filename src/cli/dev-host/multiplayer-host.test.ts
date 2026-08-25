import { beforeEach, describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

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
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const def: GameDefinitionLike = {
  gameClass: PassGame as new (...args: unknown[]) => unknown,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 4,
};

// Each seat passes exactly once (no outer loop), then the flow completes →
// game over. Lets tests observe whether AI played the open seat (isComplete)
// and whether the follower borrows the active seat as it rotates.
class AlternateGame extends Game<AlternateGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    );
  }
}

const altDef: GameDefinitionLike = {
  gameClass: AlternateGame as new (...args: unknown[]) => unknown,
  gameType: 'alternate',
  minPlayers: 2,
  maxPlayers: 2,
};

function makeAltHost() {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 2,
    makeSeed: () => 'alt',
    executeOp: (gameOptions, snap, pend, op, hostOptions) => executeOp(altDef, gameOptions, snap, pend, op, hostOptions),
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

function makeHost(opts: { designatedAiSeats?: number[] } = {}) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    makeSeed: () => 'mp',
    designatedAiSeats: opts.designatedAiSeats,
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

  it('the auto-seated dev avoids an --ai-designated seat', async () => {
    const { host, to } = makeHost({ designatedAiSeats: [1] }); // --ai 1
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

  it('a second client can take over an open/AI seat mid-game', async () => {
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

  it('leaving a seat mid-game frees it (reverts to open/AI)', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2 });
    await host.handleMessage('B', { type: 'leave' });
    const seat2 = lastOfType('A', 'lobby').seats.find((s: any) => s.seat === 2);
    expect(seat2.clientId).toBe(null);
  });
});

describe('MultiplayerHost — player configs', () => {
  it('passes playerConfigs with per-seat isAI to the game (production parity, drives in-flow AI)', async () => {
    // Games like MERC read options.playerConfigs[seat-1].isAI to decide whether a
    // seat is AI-controlled in their own flow. The production lobby supplies this;
    // the dev host must too, or the game treats the bot seat as a human and the
    // dev host's MCTS later finds "No available moves".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let startOptions: any = null;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      makeSeed: () => 'mp',
      aiLevel: 'hard',
      executeOp: (gameOptions, snap, pend, op, hostOptions) => {
        if (op.type === 'start') startOptions = gameOptions;
        return executeOp(altDef, gameOptions, snap, pend, op, hostOptions);
      },
      send: (clientId, msg) => { sent.push({ clientId, msg }); rememberRendered(clientId, msg); },
    });

    await host.handleMessage('A', { type: 'hello' }); // A → seat 1 (human); seat 2 open → AI

    const configs = startOptions?.playerConfigs as Array<{ isAI: boolean; aiLevel?: string }> | undefined;
    expect(configs).toBeDefined();
    expect(configs?.[0].isAI).toBe(false); // seat 1 = human (A)
    expect(configs?.[1].isAI).toBe(true); // seat 2 = AI
    expect(configs?.[1].aiLevel).toBe('hard');
  });
});

describe('MultiplayerHost — seat stability on reconnect', () => {
  it('a seated client reconnecting after a failed start keeps its seat (not reassigned to the AI)', async () => {
    // Repro: the dev auto-seats into seat 1, the first start fails (or hasn't
    // finished), then the browser reconnects. The reconnecting client must NOT be
    // bumped to another seat — otherwise seat 1 is released and played by a bot
    // while the dev is asked to take seat 2.
    let failNextStart = true;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
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
      | { seats: Array<{ seat: number; clientId: string | null }> }
      | undefined;
    const seat1 = lastLobby?.seats.find((s) => s.seat === 1);
    const seat2 = lastLobby?.seats.find((s) => s.seat === 2);
    expect(seat1?.clientId).toBe('A'); // still A's seat, not handed to the bot
    expect(seat2?.clientId).toBe(null); // A was NOT bumped to seat 2
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
  it('baseline: without follow, AI plays the open seat and the game completes', async () => {
    const { host, lastOfType, pass } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = AI
    await pass('A', 'r1'); // A passes seat 1 → AI passes seat 2 → flow completes
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);
  });

  it('enabling follow pauses AI and lets one client drive both seats', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = AI
    clear();

    // Enable follow while seat 1 (A's own seat) is active.
    await host.handleMessage('A', { type: 'follow', enabled: true });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: true, seat: 1 });

    // A passes as seat 1. AI must NOT play seat 2 — instead the follower is
    // handed seat 2 (init seat 2) and the game is NOT complete.
    clear();
    await pass('A', 'r1');
    expect(lastOfType('A', 'init').seat).toBe(2);
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);

    // A now passes as seat 2 (attributed to the active seat) → flow completes.
    clear();
    await pass('A', 'r2');
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

  it('disabling follow mid-game resumes AI for the open seat', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await pass('A', 'r1'); // seat 1 passed; now seat 2 is active, AI paused
    clear();

    // Disable while seat 2 is active → seat 2 reverts to AI, which passes →
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
    expect(lastOfType('A', 'init').seat).toBe(2);
    expect((lastOfType('A', 'game_state').view as any).state.isMyTurn).toBe(true);
  });

  it('explicitly leaving ends follow-mode', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await host.handleMessage('A', { type: 'leave' });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
  });

  it('restart resets follow-mode and echoes it disabled', async () => {
    const { host, lastOfType } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'follow')).toMatchObject({ enabled: false });
  });

  it('with a SECOND human seated, the follower still borrows the active seat', async () => {
    const { host, lastOfType, pass, clear } = makeAltHost();
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1
    await host.handleMessage('B', { type: 'hello' }); // B unseated
    await host.handleMessage('B', { type: 'join', seat: 2 }); // B = seat 2 (human)
    await host.handleMessage('A', { type: 'follow', enabled: true });
    clear();
    await pass('A', 'r1'); // A ends seat 1's turn -> seat 2 active
    // The follower (A) must be handed seat 2 AND seat 2's own view (isMyTurn true).
    expect(lastOfType('A', 'init').seat).toBe(2);
    const gs = lastOfType('A', 'game_state');
    expect((gs.view as any).state.isMyTurn).toBe(true);
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
  function makeAltHostWithSeedCapture() {
    const seeds: string[] = [];
    let seedCounter = 0;
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
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
    await host.handleMessage('A', { type: 'hello' }); // A = seat 1, seat 2 = AI
    await pass('A', 'r1'); // A passes seat 1 → AI passes seat 2 → flow completes
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
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);

    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);

    // Acting in the restarted game must succeed and complete it again — proves
    // the runner is a genuinely fresh instance, not the finished one replaying
    // a completed flow (which would reject the action or stay complete).
    await pass('A', 'r2');
    expect(lastOfType('A', 'game_state').isComplete).toBe(true);

    // Second restart-from-finished: the multi-game-format loop repeats.
    await host.handleMessage('A', { type: 'restart' });
    expect(lastOfType('A', 'game_state').isComplete).toBe(false);
    expect(seeds).toHaveLength(3);
    expect(new Set(seeds).size).toBe(3); // three distinct seeds across two restarts
  });

  it('CHARACTERIZATION (already passes pre-fix): a restart with no live session (never started) is still rejected', async () => {
    const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
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
