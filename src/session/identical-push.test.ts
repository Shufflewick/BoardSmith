import { describe, it, expect, vi } from 'vitest';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/index.js';
import { _clearShownWarnings } from '../utils/dev.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { executeOp } from './stateless-ops.js';
import { GameSession } from './game-session.js';
import { createHeadlessSession } from './headless-session.js';
import { StatePushGate } from './state-push-gate.js';
import type { SessionInfo } from './types.js';
import {
  secretDeploymentDefinition,
  SecretDeploymentGame,
} from './testing/fixtures/secret-deployment-fixture.js';

// #487: in the fixture's simultaneous deployment, seat 1's `placePack` changes
// nothing seat 2 or a spectator may see (and plays an animation only seat 1
// may see). A push to them anyway would tell them seat 1 acted, so they must
// receive nothing; a public move (`signal`, `done`) must still reach them.

function statefulTable() {
  const session = GameSession.create<SecretDeploymentGame>({
    gameType: 'secret-deployment',
    GameClass: SecretDeploymentGame,
    playerCount: 2,
    playerNames: ['A', 'B'],
    seed: 'bs487',
  });
  const connections: SessionInfo[] = [
    { connectionId: 'seat-1', playerSeat: 1, isSpectator: false },
    { connectionId: 'seat-2', playerSeat: 2, isSpectator: false },
    { connectionId: 'watcher', playerSeat: 0, isSpectator: true },
  ];
  const sent: Array<{ to: string; message: unknown }> = [];
  session.setBroadcaster({
    getSessions: () => connections.map((c) => ({ ...c })),
    send: (to, message) => sent.push({ to: to.connectionId, message: structuredClone(message) }),
  });
  const pushesTo = (connectionId: string) => sent.filter((s) => s.to === connectionId).length;
  const act = async (seat: number, action: string) =>
    expect((await session.performAction(action, seat, {})).success).toBe(true);
  return { session, connections, sent, pushesTo, act };
}

describe('GameSession pushes no state identical to the last one sent (#487)', () => {
  it("seat 2 and a spectator receive nothing when seat 1 acts in secret; seat 1 still does", async () => {
    const { session, pushesTo, act } = statefulTable();
    session.broadcast();
    expect([pushesTo('seat-1'), pushesTo('seat-2'), pushesTo('watcher')]).toEqual([1, 1, 1]);

    await act(1, 'placePack');
    await act(1, 'placePack');
    expect(pushesTo('seat-1')).toBe(3);
    expect(pushesTo('seat-2')).toBe(1);
    expect(pushesTo('watcher')).toBe(1);
  });

  it('a public animation reaches everyone, and a later secret action that drains it still sends nothing', async () => {
    const { session, pushesTo, act } = statefulTable();
    session.broadcast();
    await act(1, 'signal');
    expect([pushesTo('seat-2'), pushesTo('watcher')]).toEqual([2, 2]);

    await act(1, 'placePack');
    expect([pushesTo('seat-2'), pushesTo('watcher')]).toEqual([2, 2]);
  });

  it("a public move still reaches seat 2 and the spectator", async () => {
    const { session, pushesTo, act } = statefulTable();
    session.broadcast();
    await act(1, 'placePack');
    await act(1, 'done');
    expect([pushesTo('seat-2'), pushesTo('watcher')]).toEqual([2, 2]);
  });

  it('a new connection gets the full state on the next broadcast, and nobody else is pushed', async () => {
    const { session, connections, sent, pushesTo, act } = statefulTable();
    session.broadcast();
    await act(1, 'placePack');
    connections.push({ connectionId: 'seat-2-reloaded', playerSeat: 2, isSpectator: false });
    const before = sent.length;
    session.broadcast();
    expect(sent.slice(before).map((s) => s.to)).toEqual(['seat-2-reloaded']);
    expect(pushesTo('seat-2-reloaded')).toBe(1);
  });

  it('a connection that left and came back under the same id is sent the full state again', async () => {
    const { session, connections, pushesTo } = statefulTable();
    session.broadcast();
    const seat2 = connections.splice(1, 1)[0]!;
    session.broadcast();
    connections.push(seat2);
    session.broadcast();
    expect(pushesTo('seat-2')).toBe(2);
  });

  it('a connection whose send failed is sent the state again on the next broadcast', async () => {
    const session = GameSession.create<SecretDeploymentGame>({
      gameType: 'secret-deployment',
      GameClass: SecretDeploymentGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 'bs487',
    });
    let failing = true;
    const delivered: unknown[] = [];
    session.setBroadcaster({
      getSessions: () => [{ connectionId: 'seat-2', playerSeat: 2, isSpectator: false }],
      send: (_to, message) => {
        if (failing) throw new Error('socket closed');
        delivered.push(message);
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      session.broadcast();
      failing = false;
      session.broadcast();
      expect(delivered).toHaveLength(1);
    } finally {
      error.mockRestore();
    }
  });

  it('refuses connections that do not each name a distinct connection', () => {
    const { session, connections } = statefulTable();
    connections.push({ connectionId: 'seat-2', playerSeat: 2, isSpectator: false });
    expect(() => session.broadcast()).toThrow(/connectionId "seat-2" is used by more than one/);
  });
});

describe('SnapshotSessionHost pushes only the seats whose view changed (#487)', () => {
  async function secretTable() {
    const table = createHeadlessSession(secretDeploymentDefinition, { playerCount: 2, seed: 'bs487' });
    await table.host.start();
    const key = () => table.metas.at(-1)!.turnBoundary.key;
    const act = async (seat: number, actionName: string) =>
      expect((await table.host.handleOp(seat, { type: 'action', actionName, player: seat, args: {}, boundaryKey: key() })).success).toBe(true);
    /** The seats each push since `from` went to (0 = the spectators). */
    const pushedSince = (from: number) => table.pushes.slice(from).map((push) => push.map((p) => p.seat));
    return { table, act, pushedSince };
  }

  it('a secret move is pushed to its own seat only; a public one to everyone', async () => {
    const { table, act, pushedSince } = await secretTable();
    expect(pushedSince(0)).toEqual([[0, 1, 2]]);
    const from = table.pushes.length;

    await act(1, 'placePack');
    await act(1, 'placePack');
    await act(1, 'signal');
    await act(1, 'placePack');
    await act(1, 'done');
    expect(pushedSince(from)).toEqual([[1], [1], [0, 1, 2], [1], [0, 1, 2]]);
    // The state of record still follows every change, for pages that connect.
    expect(table.broadcasts).toHaveLength(6);
  });

  it('a host restored with the views its pages hold pushes them nothing until something they may see changes', async () => {
    const { table } = await secretTable();
    const restored = createHeadlessSession(secretDeploymentDefinition, { playerCount: 2, seed: 'bs487' });
    restored.host.restoreFrom({
      ...table.host.durableState(),
      playerViews: table.broadcasts.at(-1) as unknown[],
      spectatorView: table.spectatorViews.at(-1),
    });
    const key = table.metas.at(-1)!.turnBoundary.key;
    expect((await restored.host.handleOp(1, { type: 'action', actionName: 'placePack', player: 1, args: {}, boundaryKey: key })).success).toBe(true);
    expect(restored.pushes.map((push) => push.map((p) => p.seat))).toEqual([[1]]);
  });

  it('a seat passing to the bot is pushed to every page when it happens, not with the next move', async () => {
    const { table, pushedSince } = await secretTable();
    const from = table.pushes.length;
    table.makeSeatBot(2);
    // Every view now says a bot plays here.
    expect(pushedSince(from)).toEqual([[0, 1, 2]]);
  });

  it('warns when the roster changed and nobody called rosterChanged()', async () => {
    _clearShownWarnings();
    const roster: Array<{ seat: number }> = [];
    const pushes: number[][] = [];
    const host = new SnapshotSessionHost({
      playerCount: 2,
      get botSeats() {
        return roster;
      },
      // A bot that never moves: the warning is about the roster, not the bot's play.
      executeOp: (snap, pend, op) =>
        executeOp(secretDeploymentDefinition, { playerCount: 2, seed: 'bs487' }, snap, pend, op.type === 'botTurn' ? { ...op, seats: [] } : op),
      record: () => {},
      push: (changed) => pushes.push(changed.map((c) => c.seat)),
    });
    await host.start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      roster.push({ seat: 2 });
      const boundaryKey = flowBoundaryKey(host.flowState as BoundaryKeyState);
      expect((await host.handleOp(1, { type: 'action', actionName: 'placePack', player: 1, args: {}, boundaryKey })).success).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('rosterChanged()'));
    } finally {
      warn.mockRestore();
    }
  });
});
