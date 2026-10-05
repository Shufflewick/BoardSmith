/**
 * SnapshotSessionHost cannot be called in the wrong order (#537).
 *
 * - `SnapshotSessionHost.restore()` builds a host from persisted state and
 *   publishes it once, so a roster change made while the host slept reaches
 *   the pages without the platform remembering a follow-up call.
 * - The host owns the bot roster: `setBotSeats()` stores it and publishes only
 *   when whether a bot plays here changes.
 * - Every publish says why it happened (`PublishMeta.cause`).
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/index.js';
import { executeOp } from './stateless-ops.js';
import {
  SnapshotSessionHost,
  type BotSeat,
  type HostRestore,
  type PublishCause,
  type PublishMeta,
  type SnapshotSessionAdapters,
} from './snapshot-session-host.js';
import { secretDeploymentDefinition } from './testing/fixtures/secret-deployment-fixture.js';

const options = { playerCount: 2, seed: 'bs537' };

type Published = { cause: PublishCause; views: unknown[]; spectator: unknown };

/** Adapters that record every publish and push, with a bot that never moves. */
function adapters(onRecord?: (meta: PublishMeta) => void) {
  const records: Published[] = [];
  const pushes: Array<{ cause: PublishCause; seats: number[]; views: unknown[] }> = [];
  const value: SnapshotSessionAdapters = {
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) =>
      executeOp(secretDeploymentDefinition, options, snap, pend, op.type === 'botTurn' ? { ...op, seats: [] } : op),
    record: (views, meta) => {
      records.push({ cause: meta.cause, views: views.players, spectator: views.spectator });
      onRecord?.(meta);
    },
    push: (changed, meta) =>
      pushes.push({ cause: meta.cause, seats: changed.map((c) => c.seat), views: changed.map((c) => c.view) }),
  };
  return { value, records, pushes };
}

async function startedTable(onRecord?: (meta: PublishMeta) => void) {
  const a = adapters(onRecord);
  const host = new SnapshotSessionHost(a.value);
  await host.start();
  return { host, ...a };
}

function hasBots(view: unknown): boolean {
  return (view as { state: { hasBotPlayers?: boolean } }).state.hasBotPlayers === true;
}

async function act(host: SnapshotSessionHost, seat: number, actionName: string) {
  const boundaryKey = flowBoundaryKey(host.flowState as BoundaryKeyState);
  const res = await host.handleOp(seat, { type: 'action', actionName, player: seat, args: {}, boundaryKey });
  expect(res.success).toBe(true);
}

describe('the call order is not the platform\'s to remember (#537)', () => {
  it('the adapters have no live roster, and the host has no restoreFrom or rosterChanged', () => {
    expectTypeOf<SnapshotSessionAdapters>().not.toHaveProperty('botSeats');
    expectTypeOf<SnapshotSessionHost>().not.toHaveProperty('restoreFrom');
    expectTypeOf<SnapshotSessionHost>().not.toHaveProperty('rosterChanged');
    expectTypeOf<PublishMeta['cause']>().toEqualTypeOf<'change' | 'republish' | 'restore' | 'roster'>();
    // The roster is stated on restore, never assumed: an omitted one would be
    // published as "no bots" and then corrected, pushing every page twice.
    expectTypeOf<HostRestore['botSeats']>().toEqualTypeOf<BotSeat[]>();
  });

  it('refuses an op whose snapshot carries no winners, rather than publishing a won game as a draw', async () => {
    const a = adapters();
    const host = new SnapshotSessionHost({
      ...a.value,
      executeOp: async (snap, pend, op) => {
        const res = await a.value.executeOp(snap, pend, op);
        const { winners: _dropped, ...withoutWinners } = res.snapshot as Record<string, unknown>;
        return { ...res, snapshot: withoutWinners };
      },
    });
    await expect(host.start()).rejects.toThrow(/winners/);
    expect(a.records).toEqual([]);
  });

  it('a host restored after a seat passed to the bot while it slept pushes every page the change, with cause restore', async () => {
    const first = await startedTable();
    const last = first.records.at(-1)!;
    const second = adapters();
    SnapshotSessionHost.restore(second.value, {
      ...first.host.durableState(),
      playerViews: last.views,
      spectatorView: last.spectator,
      botSeats: [{ seat: 2 }],
    });
    expect(second.records.map((r) => r.cause)).toEqual(['restore']);
    expect(second.pushes.map((p) => [p.cause, p.seats])).toEqual([['restore', [0, 1, 2]]]);
    expect(second.pushes[0]!.views.every(hasBots)).toBe(true);
  });

  it('a host restored with nothing changed pushes nothing', async () => {
    const first = await startedTable();
    const last = first.records.at(-1)!;
    const second = adapters();
    const host = SnapshotSessionHost.restore(second.value, {
      ...first.host.durableState(),
      playerViews: last.views,
      spectatorView: last.spectator,
      botSeats: [],
    });
    expect(second.records.map((r) => r.cause)).toEqual(['restore']);
    expect(second.pushes).toEqual([]);
    // The first change after waking pushes only the seat it changes.
    await act(host, 1, 'placePack');
    expect(second.pushes.map((p) => [p.cause, p.seats])).toEqual([['change', [1]]]);
  });

  it('setBotSeats that flips whether a bot plays publishes once, with cause roster', async () => {
    const { host, records, pushes } = await startedTable();
    const before = records.length;
    host.setBotSeats([{ seat: 2 }]);
    expect(records.slice(before).map((r) => r.cause)).toEqual(['roster']);
    expect(pushes.at(-1)!.cause).toBe('roster');
    expect(pushes.at(-1)!.seats).toEqual([0, 1, 2]);

    host.setBotSeats([]);
    expect(records.slice(before).map((r) => r.cause)).toEqual(['roster', 'roster']);
    expect(pushes.at(-1)!.views.some(hasBots)).toBe(false);
  });

  it('setBotSeats that does not flip whether a bot plays publishes nothing, but the roster changes', async () => {
    const { host, records } = await startedTable();
    host.setBotSeats([{ seat: 2 }]);
    const before = records.length;
    host.setBotSeats([{ seat: 1 }]);
    host.setBotSeats([{ seat: 1 }, { seat: 2 }]);
    expect(records.length).toBe(before);
    // The bot convert op reads the stored roster: seat 1 is a bot now.
    expect((await host.handleOp(1, { type: 'convertSeatToBot', seat: 1 })).success).toBe(true);
  });

  it('setBotSeats before the game starts publishes nothing, and the start carries the roster', async () => {
    const a = adapters();
    const host = new SnapshotSessionHost(a.value);
    host.setBotSeats([{ seat: 2 }]);
    expect(a.records).toEqual([]);
    await host.start();
    expect(a.records.map((r) => r.cause)).toEqual(['change']);
    expect(a.records[0]!.views.every(hasBots)).toBe(true);
  });

  it('record names the cause of each publish: a move, a republish, a roster change', async () => {
    const { host, records } = await startedTable();
    await act(host, 1, 'placePack');
    host.broadcastCurrent();
    host.setBotSeats([{ seat: 2 }]);
    expect(records.map((r) => r.cause)).toEqual(['change', 'change', 'republish', 'roster']);
  });

  it('setBotSeats called from inside record publishes after that record, never before its push', async () => {
    let host: SnapshotSessionHost | null = null;
    let armed = false;
    const table = await startedTable(() => {
      if (armed) {
        armed = false;
        host!.setBotSeats([{ seat: 2 }]);
      }
    });
    host = table.host;
    armed = true;
    await act(host, 1, 'signal');
    // The move's record and push, then the roster's: the last view every page
    // was pushed says a bot plays here.
    expect(table.records.slice(1).map((r) => r.cause)).toEqual(['change', 'roster']);
    expect(table.pushes.slice(1).map((p) => p.cause)).toEqual(['change', 'roster']);
    const lastPushed = new Map<number, unknown>();
    for (const push of table.pushes) push.seats.forEach((seat, i) => lastPushed.set(seat, push.views[i]));
    expect([...lastPushed.values()].every(hasBots)).toBe(true);
  });
});
