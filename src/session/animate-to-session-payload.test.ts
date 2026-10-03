import { describe, it, expect } from 'vitest';
import { executeOp } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/index.js';
import {
  secretDeploymentDefinition,
  createSecretDeploymentSession,
} from './testing/fixtures/secret-deployment-fixture.js';

// #23 put `animateTo`'s audience on the game view; the session's own
// `state.animationEvents` (the list the UI plays) must honour it too, or a seat
// is handed another seat's private animation. In the fixture `placePack` plays
// `packPlaced` to the placing seat only (#487 found the gap).

const eventTypes = (state: PlayerGameState | undefined) => (state?.animationEvents ?? []).map((e) => e.type);

describe("a seat's state carries only the animation events it may see", () => {
  it('stateful session: seat 1 sees its private event, seat 2 and the spectator do not', async () => {
    const session = createSecretDeploymentSession({ seed: 'animate-to' });
    expect((await session.performAction('placePack', 1, {})).success).toBe(true);

    expect(eventTypes(session.getState(1).state)).toEqual(['packPlaced']);
    const seat2 = session.getState(2).state!;
    expect(seat2.animationEvents).toBeUndefined();
    expect(seat2.lastAnimationEventId).toBeUndefined();
    expect(session.getState(0).state!.animationEvents).toBeUndefined();
    // The id counter counts every seat's events, so it stays out of a seat's view.
    expect(seat2.view).not.toHaveProperty('animationEventSeq');
  });

  it('stateless executor: the same, for every player view and the spectator view', async () => {
    const options = { playerCount: 2, seed: 'animate-to' };
    const start = await executeOp(secretDeploymentDefinition, options, null, null, { type: 'start' });
    const placed = await executeOp(secretDeploymentDefinition, options, start.snapshot, null, {
      type: 'action',
      actionName: 'placePack',
      player: 1,
      args: {},
      boundaryKey: flowBoundaryKey(start.flowState as BoundaryKeyState),
    });
    expect(placed.success).toBe(true);
    const stateOf = (view: unknown) => (view as { state: PlayerGameState }).state;

    expect(eventTypes(stateOf(placed.playerViews[0]))).toEqual(['packPlaced']);
    expect(stateOf(placed.playerViews[1]).animationEvents).toBeUndefined();
    expect(stateOf(placed.spectatorView).animationEvents).toBeUndefined();
  });

  it('a public animation still reaches every seat and the spectator', async () => {
    const session = createSecretDeploymentSession({ seed: 'animate-to' });
    expect((await session.performAction('signal', 1, {})).success).toBe(true);
    for (const seat of [0, 1, 2]) expect(eventTypes(session.getState(seat).state)).toEqual(['signal']);
  });

  it("seat 2's ids do not count seat 1's private animations (#489)", async () => {
    const idOfSignalAfter = async (privatePacks: number) => {
      const session = createSecretDeploymentSession({ seed: 'animate-to' });
      for (let i = 0; i < privatePacks; i++) expect((await session.performAction('placePack', 1, {})).success).toBe(true);
      expect((await session.performAction('signal', 2, {})).success).toBe(true);
      return { seat1: session.getState(1).state!, seat2: session.getState(2).state!, spectator: session.getState(0).state! };
    };
    const none = await idOfSignalAfter(0);
    const two = await idOfSignalAfter(2);
    expect(two.seat2.animationEvents).toEqual(none.seat2.animationEvents);
    expect(two.seat2.lastAnimationEventId).toBe(1);
    expect(two.spectator.animationEvents).toEqual(none.spectator.animationEvents);
    // Seat 1 saw its own two, so the public event is its third.
    expect(two.seat1.lastAnimationEventId).toBe(3);
  });

});
