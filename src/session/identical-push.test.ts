import { describe, it, expect } from 'vitest';
import { SnapshotSessionHost, type BotSeat } from './snapshot-session-host.js';
import { executeOp } from './stateless-ops.js';
import { createHeadlessSession } from './headless-session.js';
import { secretDeploymentDefinition } from './testing/fixtures/secret-deployment-fixture.js';

// #487: in the fixture's simultaneous deployment, seat 1's `placePack` changes
// nothing seat 2 or a spectator may see (and plays an animation only seat 1
// may see). A push to them anyway would tell them seat 1 acted, so they must
// receive nothing; a public move (`signal`, `done`) must still reach them.

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

  /** A fresh process's host, restored from what `table` left and the views its pages hold. */
  function restoredFrom(table: Awaited<ReturnType<typeof secretTable>>['table'], botSeats: BotSeat[] = []) {
    const pushes: number[][] = [];
    const broadcasts: unknown[][] = [];
    const host = SnapshotSessionHost.restore(
      {
        playerCount: 2,
        executeOp: (snap, pend, op) => executeOp(secretDeploymentDefinition, { playerCount: 2, seed: 'bs487' }, snap, pend, op),
        record: (views) => broadcasts.push(views.players),
        push: (changed) => pushes.push(changed.map((c) => c.seat)),
      },
      {
        ...table.host.durableState(),
        playerViews: table.broadcasts.at(-1) as unknown[],
        spectatorView: table.spectatorViews.at(-1),
        botSeats,
      },
    );
    return { host, pushes, broadcasts };
  }

  it('a host restored with the views its pages hold pushes them nothing until something they may see changes', async () => {
    const { table } = await secretTable();
    const restored = restoredFrom(table);
    expect(restored.pushes).toEqual([]);
    const key = table.metas.at(-1)!.turnBoundary.key;
    expect((await restored.host.handleOp(1, { type: 'action', actionName: 'placePack', player: 1, args: {}, boundaryKey: key })).success).toBe(true);
    expect(restored.pushes).toEqual([[1]]);
  });

  it('a host restored after a seat passed to the bot while it slept pushes every page the change', async () => {
    const { table } = await secretTable();
    // The pages were last pushed a table with no bot; the roster now has one.
    const restored = restoredFrom(table, [{ seat: 2 }]);
    expect(restored.pushes).toEqual([[0, 1, 2]]);
  });

  it('a host restored after a person took the bot\'s seat while it slept pushes every page the change', async () => {
    const { table } = await secretTable();
    table.makeSeatBot(2);
    expect((table.broadcasts.at(-1) as Array<{ state: { hasBotPlayers?: boolean } }>)[0]!.state.hasBotPlayers).toBe(true);
    // The pages were last pushed a table with a bot; the roster now has none.
    const restored = restoredFrom(table);
    expect(restored.pushes).toEqual([[0, 1, 2]]);
    expect((restored.broadcasts.at(-1) as Array<{ state: { hasBotPlayers?: boolean } }>)[0]!.state.hasBotPlayers).toBeUndefined();
  });

  it('a seat passing to the bot is pushed to every page when it happens, not with the next move', async () => {
    const { table, pushedSince } = await secretTable();
    const from = table.pushes.length;
    table.makeSeatBot(2);
    // Every view now says a bot plays here.
    expect(pushedSince(from)).toEqual([[0, 1, 2]]);
  });
});
