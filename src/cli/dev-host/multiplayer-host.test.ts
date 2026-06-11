import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
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

function makeHost() {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: 1,
    makeSeed: () => 'mp',
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
