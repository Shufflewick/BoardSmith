import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';

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
    executeOp: (gameOptions, snap, pend, op) => executeOp(altDef, gameOptions, snap, pend, op),
    send: (clientId, msg) => sent.push({ clientId, msg }),
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
      payload: { actionName: 'pass', args: {} },
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
    executeOp: (gameOptions, snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    send: (clientId, msg) => sent.push({ clientId, msg }),
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
      payload: { actionName: 'pass', args: {} },
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
