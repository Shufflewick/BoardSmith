/**
 * #489: a page that changes seat plays the new seat's animations.
 *
 * Each seat numbers only the animation events it may see, so two seats'
 * numbers say nothing about each other. The follower in `boardsmith dev` shows
 * whichever seat is due, so it changes seat in the middle of a game: here seat
 * 1 places three packs (animations only seat 1 sees) and signals, which leaves
 * seat 1's numbers well above seat 2's. When seat 1 is done the follower shows
 * seat 2, and seat 2's next signal must still play, though its number is below
 * the highest one the page saw as seat 1.
 *
 * The page's queue is built the way `useTableSeat` builds it, from the frames
 * the host sends the follower.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue';

import { executeOp } from '../../session/index.js';
import type { PlayerGameState } from '../../session/types.js';
import { secretDeploymentDefinition } from '../../session/testing/fixtures/secret-deployment-fixture.js';
import { animationTimeline, createAnimationEvents } from '../../ui/composables/useAnimationEvents.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
let scope: EffectScope;
beforeEach(() => {
  clients.reset();
  scope = effectScope();
});
afterEach(() => scope.stop());

describe('a page that changes seat plays the new seat its animations (#489)', () => {
  it('the follower plays seat 2 its signal after seat 1 played private ones', async () => {
    const shown = shallowRef<{ state: PlayerGameState } | undefined>();
    const played: string[] = [];
    let seat = 0;
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: 2,
      makeSeed: () => 'bs489',
      executeOp: (gameOptions, snap, pend, op, hostOptions) =>
        // The bot covering seat 2 until the follower takes it over never moves.
        executeOp(secretDeploymentDefinition, gameOptions, snap, pend, op.type === 'botTurn' ? { ...op, seats: [] } : op, hostOptions),
      send: (clientId, msg: HostOutbound) => {
        clients.remember(clientId, msg);
        if (clientId !== 'A') return;
        if (msg.type === 'init') seat = msg.seat;
        if (msg.type === 'game_state') shown.value = msg.view as { state: PlayerGameState };
      },
    });
    const queue = scope.run(() =>
      createAnimationEvents({
        events: () => shown.value?.state.animationEvents,
        timeline: () => animationTimeline(shown.value?.state),
        handlerWaitTimeout: 0,
      }),
    )!;
    for (const type of ['packPlaced', 'signal']) {
      queue.registerHandler(type, async (event) => {
        played.push(`${type} by ${String(event.data.seat ?? seat)}`);
      }, { skip: 'drop' });
    }

    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('A', { type: 'follow', enabled: true });
    let request = 0;
    const act = async (actionName: string) => {
      await host.handleMessage('A', {
        type: 'server_request',
        requestId: `${actionName}-${++request}`,
        op: 'action',
        payload: { actionName, args: {}, boundaryKey: clients.key('A') },
      });
      // The page plays what the frame brought before the next move.
      await nextTick();
      while (queue.isAnimating.value) await new Promise((resolve) => setTimeout(resolve, 0));
    };

    expect(seat).toBe(1);
    for (const move of ['placePack', 'placePack', 'placePack', 'signal', 'done']) await act(move);
    // Seat 1 is done, so the follower now shows seat 2.
    expect(seat).toBe(2);
    await act('signal');

    expect(played).toEqual([
      'packPlaced by 1',
      'packPlaced by 1',
      'packPlaced by 1',
      'signal by 1',
      'signal by 2',
    ]);
  });
});
