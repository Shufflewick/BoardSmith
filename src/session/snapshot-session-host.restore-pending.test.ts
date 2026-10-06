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
  type HostRestore,
  type SnapshotHostState,
  type SnapshotSessionAdapters,
} from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
// A repeating selection whose picks live ONLY in the pending state, and whose
// onEach moves a token during the selection, so the persisted snapshot holds a
// mutation that belongs to an unfinished action.
import { repeatingCollectDefinition as collectDef } from './testing/fixtures/repeating-collect-fixture.js';

const options = { playerCount: 2, seed: 'bs320' };

function makeAdapters(extra: Partial<SnapshotSessionAdapters> = {}) {
  const broadcasts: unknown[][] = [];
  const persisted: SnapshotHostState[] = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) => executeOp(collectDef, options, snap, pend, op),
    push: () => {}, record: ({ players: views }) => broadcasts.push(views),
    // What a Durable Object's storage hands back: a JSON round trip.
    persist: (state) => {
      persisted.push(JSON.parse(JSON.stringify(state)) as SnapshotHostState);
    },
    ...extra,
  };
  return { adapters, broadcasts, persisted };
}

function makeHost(extra: Partial<SnapshotSessionAdapters> = {}) {
  const { adapters, ...rest } = makeAdapters(extra);
  return { host: new SnapshotSessionHost(adapters), ...rest };
}

/** A fresh process's host, built from what storage handed back. */
function restoredHost(state: HostRestore) {
  const { adapters, ...rest } = makeAdapters();
  return { host: SnapshotSessionHost.restore(adapters, state), ...rest };
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
    expect(Object.keys(last).sort()).toEqual(['pendingStates', 'snapshot']);
    expect(Object.keys(last.pendingStates)).toEqual(['1']);
    expect(JSON.parse(JSON.stringify(host.durableState()))).toEqual(last);
  });

  it('a repeating selection paused across a restore keeps its picks and completes on the fresh host', async () => {
    const first = makeHost();
    await first.host.start();
    expect((await pick(first.host, 'p1')).success).toBe(true);

    // The process dies. A fresh host is built from storage alone.
    const stored = first.persisted.at(-1)!;
    const second = restoredHost({ ...stored, botSeats: [] });

    const next = await pick(second.host, 'p2');
    expect(next.success).toBe(true);
    expect((next.pendingState as RepeatingPending).repeating?.accumulated).toEqual(['p1', 'p2']);

    const done = await pick(second.host, 'stop');
    expect(done.success).toBe(true);
    expect(done.actionComplete).toBe(true);
    expect(second.host.snapshot!.state.attributes.collected).toEqual(['p1', 'p2', 'stop']);
  });

  it("a restored seat's pending action is broadcast to that seat only", async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    const lastViews = first.broadcasts.at(-1)!;

    const second = restoredHost({ ...first.persisted.at(-1)!, playerViews: lastViews, botSeats: [] });

    const views = second.broadcasts.at(-1) as Array<{ state: { pendingAction?: RepeatingPending } }>;
    expect(views[0]!.state.pendingAction?.repeating?.accumulated).toEqual(['p1']);
    expect(views[1]!.state.pendingAction).toBeUndefined();
  });

  it('restore refuses pending states keyed by anything but a seat of this table', async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    const stored = first.persisted.at(-1)!;
    const pending = stored.pendingStates['1']!;

    for (const key of ['0', '3', 'seat1', '1.5']) {
      expect(() => restoredHost({ ...stored, pendingStates: { [key]: pending }, botSeats: [] })).toThrow(
        /pending selection.*seat/i,
      );
    }
  });

  it('restore requires the pending states, so a consumer cannot persist a subset', async () => {
    const first = makeHost();
    await first.host.start();
    const { snapshot } = first.persisted.at(-1)!;
    // @ts-expect-error -- pendingStates is required: persist what persist handed you.
    expect(() => restoredHost({ snapshot, botSeats: [] })).toThrow(/pendingStates/);
  });

  it('a refused action keeps the pending selection, in memory and in storage alike', async () => {
    const first = makeHost();
    await first.host.start();
    await pick(first.host, 'p1');
    const saved = first.persisted.at(-1)!.pendingStates;
    expect(Object.keys(saved)).toEqual(['1']);
    const saves = first.persisted.length;

    const refused = await first.host.handleOp(1, {
      type: 'action',
      actionName: 'collect',
      player: 1,
      args: { token: ['nope'] },
      boundaryKey: boundaryKeyOfHost(first.host),
    });
    expect(refused.success).toBe(false);

    // The refusal changed nothing: no save, and the selection stands in both.
    expect(first.persisted.length).toBe(saves);
    expect(first.host.durableState().pendingStates).toEqual(saved);
  });
});
