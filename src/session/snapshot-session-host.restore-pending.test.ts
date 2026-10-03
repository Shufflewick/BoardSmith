/**
 * A seat's in-progress multi-step selection survives the host's process dying
 * (#320, ShufflewickPub #511).
 *
 * A platform restores a host from what its `persist` adapter wrote, on a fresh
 * process. Everything below drives the REAL engine through `executeOp` and
 * JSON-round-trips the persisted state, the way a Durable Object's storage does.
 */
import { describe, it, expect } from 'vitest';
import { executeOp, type OpResult } from './stateless-ops.js';
import {
  SnapshotSessionHost,
  type SnapshotHostState,
  type SnapshotSessionAdapters,
} from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
// A repeating selection whose picks live ONLY in the pending state, and whose
// onEach moves a token during the selection, so the persisted snapshot holds a
// mutation that belongs to an unfinished action.
import { repeatingCollectDefinition as collectDef } from './testing/fixtures/repeating-collect-fixture.js';

const options = { playerCount: 2, seed: 'bs320' };

function makeHost(extra: Partial<SnapshotSessionAdapters> = {}) {
  const broadcasts: unknown[][] = [];
  const persisted: SnapshotHostState[] = [];
  const host = new SnapshotSessionHost({
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) => executeOp(collectDef, options, snap, pend, op),
    push: () => {}, record: ({ players: views }) => broadcasts.push(views),
    // What a Durable Object's storage hands back: a JSON round trip.
    persist: (state) => {
      persisted.push(JSON.parse(JSON.stringify(state)) as SnapshotHostState);
    },
    ...extra,
  });
  return { host, broadcasts, persisted };
}

function pick(host: SnapshotSessionHost, value: string): Promise<OpResult> {
  return host.handleOp(1, {
    type: 'selectionStep',
    player: 1,
    selectionName: 'token',
    value,
    actionName: 'collect',
    boundaryKey: boundaryKeyOfHost(host),
  });
}

type RepeatingPending = { repeating?: { accumulated: unknown[] } };

describe('SnapshotSessionHost restores in-progress selections (#320)', () => {
  it('persist hands out the whole durable state, and durableState() returns the same thing', async () => {
    const { host, persisted } = makeHost();
    await host.start();
    await pick(host, 'p1');

    const last = persisted.at(-1)!;
    expect(Object.keys(last).sort()).toEqual(['flowState', 'pendingStates', 'snapshot']);
    expect(last.flowState).toEqual(JSON.parse(JSON.stringify(host.flowState)));
    expect(Object.keys(last.pendingStates)).toEqual(['1']);
    expect(JSON.parse(JSON.stringify(host.durableState()))).toEqual(last);
  });

  it('a repeating selection paused across a restore keeps its picks and completes on the fresh host', async () => {
    const first = makeHost();
    await first.host.start();
    expect((await pick(first.host, 'p1')).success).toBe(true);

    // The process dies. A fresh host is built from storage alone.
    const stored = first.persisted.at(-1)!;
    const second = makeHost();
    second.host.restoreFrom(stored);

    const next = await pick(second.host, 'p2');
    expect(next.success).toBe(true);
    expect((next.pendingState as RepeatingPending).repeating?.accumulated).toEqual(['p1', 'p2']);

    const done = await pick(second.host, 'stop');
    expect(done.success).toBe(true);
    expect(done.actionComplete).toBe(true);
    const game = second.host.snapshot as { state: { attributes: { collected: unknown } } };
    expect(game.state.attributes.collected).toEqual(['p1', 'p2', 'stop']);
  });

  it("a restored seat's pending action is broadcast to that seat only", async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    const lastViews = first.broadcasts.at(-1)!;

    const second = makeHost();
    second.host.restoreFrom({ ...first.persisted.at(-1)!, playerViews: lastViews });
    second.host.broadcastCurrent();

    const views = second.broadcasts.at(-1) as Array<{ state: { pendingAction?: RepeatingPending } }>;
    expect(views[0]!.state.pendingAction?.repeating?.accumulated).toEqual(['p1']);
    expect(views[1]!.state.pendingAction).toBeUndefined();
  });

  it('restoreFrom refuses pending states keyed by anything but a seat of this table', async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    const stored = first.persisted.at(-1)!;
    const pending = stored.pendingStates['1']!;

    for (const key of ['0', '3', 'seat1', '1.5']) {
      const { host } = makeHost();
      expect(() => host.restoreFrom({ ...stored, pendingStates: { [key]: pending } })).toThrow(
        /pending selection.*seat/i,
      );
    }
  });

  it('restoreFrom requires the pending states, so a consumer cannot persist a subset', async () => {
    const first = makeHost();
    await first.host.start();
    const { snapshot, flowState } = first.persisted.at(-1)!;
    const { host } = makeHost();
    // @ts-expect-error -- pendingStates is required: persist what persist handed you.
    expect(() => host.restoreFrom({ snapshot, flowState })).toThrow(/pendingStates/);
  });

  it('a failed action that cleared a pending selection persists the cleared state', async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    expect(Object.keys(first.persisted.at(-1)!.pendingStates)).toEqual(['1']);

    const refused = await first.host.handleOp(1, {
      type: 'action',
      actionName: 'collect',
      player: 1,
      args: { token: ['nope'] },
      boundaryKey: boundaryKeyOfHost(first.host),
    });
    expect(refused.success).toBe(false);

    // Storage agrees with memory: a restore does not resurrect the selection.
    expect(first.persisted.at(-1)!.pendingStates).toEqual({});
    expect(first.host.durableState().pendingStates).toEqual({});
  });
});
