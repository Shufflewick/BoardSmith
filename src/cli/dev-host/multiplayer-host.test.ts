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
const gameOptions = { playerCount: 2, seed: 'mp' };

function makeHost(overrides: Partial<{ minPlayers: number }> = {}) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 2,
    minPlayers: overrides.minPlayers ?? 1,
    executeOp: (snap, pend, op) =>
      executeOp(def, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
    send: (clientId, msg) => sent.push({ clientId, msg }),
  });
  const to = (clientId: string) => sent.filter((e) => e.clientId === clientId).map((e) => e.msg);
  const lastOfType = (clientId: string, type: HostOutbound['type']) =>
    [...to(clientId)].reverse().find((m) => m.type === type);
  return { host, sent, to, lastOfType, clear: () => (sent.length = 0) };
}

describe('MultiplayerHost', () => {
  it('hello returns a lobby with all seats open', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    const lobby = lastOfType('A', 'lobby');
    expect(lobby).toBeTruthy();
    expect(lobby).toMatchObject({ phase: 'lobby', playerCount: 2 });
    expect((lobby as any).seats.every((s: any) => s.clientId === null)).toBe(true);
  });

  it('join claims a seat and broadcasts the lobby to all connected clients', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'hello' });
    await host.handleMessage('A', { type: 'join', seat: 1, name: 'Ann' });

    expect(lastOfType('A', 'joined')).toEqual({ type: 'joined', seat: 1 });
    // B (also connected) sees the updated lobby.
    const lobbyB = lastOfType('B', 'lobby') as any;
    const seat1 = lobbyB.seats.find((s: any) => s.seat === 1);
    expect(seat1).toMatchObject({ clientId: 'A', name: 'Ann', connected: true });
  });

  it('rejects joining a seat held by another connected client', async () => {
    const { host, lastOfType } = makeHost();
    await host.handleMessage('A', { type: 'join', seat: 1 });
    await host.handleMessage('B', { type: 'join', seat: 1 });
    expect(lastOfType('B', 'error')).toMatchObject({ type: 'error' });
  });

  it('does not start below minPlayers', async () => {
    const { host, lastOfType } = makeHost({ minPlayers: 2 });
    await host.handleMessage('A', { type: 'join', seat: 1 });
    await host.handleMessage('A', { type: 'start' });
    expect(lastOfType('A', 'error')).toMatchObject({ type: 'error' });
    // Still in lobby.
    expect((lastOfType('A', 'lobby') as any).phase).toBe('lobby');
  });

  it('starts the game and sends init + game_state to seated clients', async () => {
    const { host, to } = makeHost();
    await host.handleMessage('A', { type: 'join', seat: 1 });
    await host.handleMessage('A', { type: 'start' });

    const msgs = to('A').map((m) => m.type);
    expect(msgs).toContain('init');
    expect(msgs).toContain('game_state');
    const init = to('A').find((m) => m.type === 'init') as any;
    expect(init.seat).toBe(1);
  });

  it('routes an in-game action to the session and responds to the actor', async () => {
    const { host, to, clear } = makeHost();
    await host.handleMessage('A', { type: 'join', seat: 1 });
    await host.handleMessage('A', { type: 'start' });
    clear();

    await host.handleMessage('A', { type: 'server_request', requestId: 'r1', op: 'action', payload: { actionName: 'pass', args: {} } });

    const types = to('A').map((m) => m.type);
    expect(types).toContain('game_state'); // broadcast of the new state
    const resp = to('A').find((m) => m.type === 'server_response') as any;
    expect(resp.requestId).toBe('r1');
    expect(resp.result.success).toBe(true);
  });

  it('re-inits a seat on reconnect (same clientId) mid-game', async () => {
    const { host, to, clear } = makeHost();
    await host.handleMessage('A', { type: 'join', seat: 1 });
    await host.handleMessage('A', { type: 'start' });
    host.disconnect('A'); // mid-game keeps the seat
    clear();

    await host.handleMessage('A', { type: 'hello' });

    const types = to('A').map((m) => m.type);
    expect(types).toContain('init');
    expect(types).toContain('game_state');
  });
});
