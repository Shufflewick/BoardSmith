import { describe, it, expect } from 'vitest';
import { executeOp, type ExecutableOp } from './stateless-ops.js';
import { botGameDef, botGameOptions } from './testing/fixtures/bot-game-fixture.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { refused, stubExecuteOp, succeeded } from './op-result.test-helper.js';

// A demo's "back" replaces the runner, exactly as an undo does, so what every
// seat holds against the old one goes with it: half-made picks, hints and
// heatmaps (#811). Undo already dropped them; the demo's step back did not.

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

describe('demo step back (#811)', () => {
  it("drops every seat's half-made picks, hints and heatmaps", async () => {
    let moves = 0;
    let lastEnvelope: object = {};
    // The fixture never awaits seat 2, so its teaching state and a two-pick
    // action are stubbed: the first pick starts one, the second needs it.
    const stubbed: Partial<Record<string, (op: ExecutableOp, pend: Record<string, unknown> | null) => unknown>> = {
      hint: (op) => ({ success: true, hintAnnotation: { seat: (op as { seat: number }).seat, annotation: { text: 'move left' } } }),
      heatmapToggle: (op) => ({ success: true, heatmapUpdate: { seat: (op as { seat: number }).seat, visible: true, entries: [] } }),
      selectionStep: (op, pend) => {
        if ((op as { selectionName: string }).selectionName === 'first') {
          return { ...lastEnvelope, actionComplete: false, pendingState: { first: 'a' } };
        }
        return pend === null
          ? { success: false, error: 'There is no selection in progress to continue.', category: 'bundle' }
          : { ...lastEnvelope, actionComplete: true, pendingState: null };
      },
    };
    const host = new SnapshotSessionHost({
      playerCount: 2,
      executeOp: stubExecuteOp(async (snap, pend, op) => {
        const stub = stubbed[op.type];
        if (stub) return stub(op, pend);
        const res = await executeOp(botGameDef, botGameOptions, snap, pend, op);
        if (res.success && 'snapshot' in res) lastEnvelope = res;
        if (op.type === 'action' && res.success) moves++;
        return res;
      }),
      push: () => {}, record: () => {},
    });
    host.setBotSeats([{ seat: 2, level: '1' }]);
    await host.start();

    succeeded(await host.handleOp(2, { type: 'heatmapToggle', seat: 2, visible: true }));
    succeeded(await host.handleOp(2, { type: 'hint', seat: 2 }));
    expect(host.transientTeachingState.get(2)?.heatmap).toBeDefined();
    expect(host.transientTeachingState.get(2)?.hint).toBeDefined();

    // A delay long enough that the loop only moves when told to.
    await host.handleOp(1, { type: 'demoStart', delay: 100_000 });
    await host.handleOp(1, { type: 'demoControl', control: 'step' });
    await until(() => moves === 1);

    succeeded(await host.handleOp(2, {
      type: 'selectionStep', player: 2, selectionName: 'first', value: 'a', actionName: 'twoPick',
      boundaryKey: boundaryKeyOfHost(host),
    }));
    expect(host.durableState().pendingStates['2']).toEqual({ first: 'a' });

    await host.handleOp(1, { type: 'demoControl', control: 'back' });

    expect(host.durableState().pendingStates['2']).toBeUndefined();
    expect(host.transientTeachingState.has(2)).toBe(false);
    refused(await host.handleOp(2, {
      type: 'selectionStep', player: 2, selectionName: 'second', value: 'b', actionName: 'twoPick',
      boundaryKey: boundaryKeyOfHost(host),
    }));

    await host.handleOp(1, { type: 'demoStop' });
    await host.settled();
  });
});
