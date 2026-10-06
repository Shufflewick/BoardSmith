import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import type { AnimationEvent } from '../engine/index.js';
import { executeOp } from './stateless-ops.js';
import { botGameDef, botGameOptions } from './testing/fixtures/bot-game-fixture.js';
import { SnapshotSessionHost, type SnapshotHostState } from './snapshot-session-host.js';
import { createAnimationEvents, animationTimeline } from '../ui/composables/useAnimationEvents.js';

// A demo's "back" puts the game one move back. The move it then plays has
// animations, and the client must play them: it already played the beats of
// the move that was taken back, so if nothing tells it the position went back,
// the new move's beats arrive under ids it has seen and are dropped. The demo
// used to put the old snapshot and views back by hand, under the restore epoch
// clients had already seen (#449 review).

const def = botGameDef;
const options = botGameOptions;

type SeatState = { animationEvents?: AnimationEvent[]; gameInstanceId?: string; restoreEpoch?: number; viewerSeat?: number; isDemoRunning?: boolean };

async function until(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

describe('demo step back (#449 review)', () => {
  it("delivers the next move's animations after stepping back a move", async () => {
    // Seat 1's client: the real queue, fed from what the host broadcasts to seat 1.
    const seat1 = ref<SeatState | undefined>();
    const delivered: unknown[] = [];
    const queue = createAnimationEvents({
      events: () => seat1.value?.animationEvents,
      timeline: () => animationTimeline(seat1.value),
    });
    queue.registerHandler('moved', async (event) => {
      delivered.push(event.data);
    }, { skip: 'drop' });

    let moves = 0;
    const causes: string[] = [];
    const persisted: SnapshotHostState[] = [];
    const host = new SnapshotSessionHost({
      playerCount: 2,
      // The demo plays every seat at the first bot seat's level; one search
      // iteration is all a move needs here.
      executeOp: async (snap, pend, op) => {
        const res = await executeOp(def, options, snap, pend, op);
        if (op.type === 'action' && res.success) moves++;
        return res;
      },
      persist: (state) => {
        persisted.push(state);
      },
      push: () => {}, record: ({ players: views }, meta) => {
        seat1.value = (views[0] as { state: SeatState }).state;
        causes.push(meta.cause);
      },
    });
    host.setBotSeats([{ seat: 2, level: '1' }]);
    await host.start();

    const settle = async () => {
      await nextTick();
      for (let i = 0; i < 100 && queue.isAnimating.value; i++) await new Promise((r) => setTimeout(r, 10));
    };

    // A delay long enough that the loop only moves when told to.
    await host.handleOp(1, { type: 'demoStart', delay: 100_000 });
    await until(() => seat1.value?.isDemoRunning === true);

    await host.handleOp(1, { type: 'demoControl', control: 'step' });
    await until(() => moves === 1);
    await settle();
    expect(delivered).toHaveLength(1);

    const epochBefore = seat1.value?.restoreEpoch;
    const causesBefore = causes.length;
    const persistedBefore = persisted.length;
    await host.handleOp(1, { type: 'demoControl', control: 'back' });
    await settle();
    expect(seat1.value?.restoreEpoch).not.toBe(epochBefore);
    // Stepping back changes the game, so it is published as a change (#537).
    expect(causes.slice(causesBefore)[0]).toBe('change');
    // ...and saved: what storage holds is the position the demo stepped back to.
    expect(persisted.length).toBe(persistedBefore + 1);
    expect(persisted.at(-1)!.snapshot).toBe(host.snapshot);
    expect(persisted.at(-1)!.snapshot!.actionHistory).toHaveLength(0);

    await host.handleOp(1, { type: 'demoControl', control: 'step' });
    await until(() => moves === 2);
    await settle();
    // The move taken back played once; the move made after the step back played too.
    expect(delivered).toHaveLength(2);

    await host.handleOp(1, { type: 'demoStop' });
    await until(() => seat1.value?.isDemoRunning === undefined);
  });

  it('names no timeline when the state does not say which game, restore or seat it is', () => {
    expect(animationTimeline(undefined)).toBeUndefined();
    expect(animationTimeline({ restoreEpoch: 0, viewerSeat: 1 })).toBeUndefined();
    expect(animationTimeline({ gameInstanceId: 'g', viewerSeat: 1 })).toBeUndefined();
    expect(animationTimeline({ gameInstanceId: 'g', restoreEpoch: 2 })).toBeUndefined();
    expect(animationTimeline({ gameInstanceId: 'g', restoreEpoch: 2, viewerSeat: 1 })).toBe('g:2:1');
    expect(animationTimeline({ gameInstanceId: 'g', restoreEpoch: 2, viewerSeat: 0 })).toBe('g:2:0');
  });
});
