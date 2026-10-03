import { describe, it, expect } from 'vitest';
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

  it('refuses connections that do not each name a distinct connection', () => {
    const { session, connections } = statefulTable();
    connections.push({ connectionId: 'seat-2', playerSeat: 2, isSpectator: false });
    expect(() => session.broadcast()).toThrow(/connectionId "seat-2" is used by more than one/);
  });
});

describe('SnapshotSessionHost hands its adapter the same view for a seat that saw nothing (#487)', () => {
  it("seat 2's view is not pushed after seat 1's secret actions, and is after a public one", async () => {
    const table = createHeadlessSession(secretDeploymentDefinition, { playerCount: 2, seed: 'bs487' });
    await table.host.start();
    // The adapter's half: one gate, one recipient per seat, as a platform host keeps per socket.
    const gate = new StatePushGate<number, { view: { state: unknown } }>({ playerState: (f) => f.view.state });
    const pushedTo = (seat: number) =>
      table.broadcasts.map((views) => gate.shouldPush(seat, { view: (views as Array<{ state: unknown }>)[seat - 1]! }));
    const key = () => table.metas.at(-1)!.turnBoundary.key;
    const act = async (seat: number, actionName: string) =>
      expect((await table.host.handleOp(seat, { type: 'action', actionName, player: seat, args: {}, boundaryKey: key() })).success).toBe(true);

    await act(1, 'placePack');
    await act(1, 'placePack');
    await act(1, 'signal');
    await act(1, 'placePack');
    await act(1, 'done');
    // start, placePack, placePack, signal, placePack, done
    expect(pushedTo(2)).toEqual([true, false, false, true, false, true]);
    expect(pushedTo(1).every(Boolean)).toBe(true);
  });
});
