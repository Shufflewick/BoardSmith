import { describe, it, expect } from 'vitest';
import { GameSession } from './game-session.js';
import { executeOp } from './stateless-ops.js';
import type { PlayerGameState } from './types.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/index.js';
import {
  secretDeploymentDefinition,
  SecretDeploymentGame,
} from './testing/fixtures/secret-deployment-fixture.js';

// #23 put `animateTo`'s audience on the game view; the session's own
// `state.animationEvents` (the list the UI plays) must honour it too, or a seat
// is handed another seat's private animation. In the fixture `placePack` plays
// `packPlaced` to the placing seat only (#487 found the gap).

const eventTypes = (state: PlayerGameState | undefined) => (state?.animationEvents ?? []).map((e) => e.type);

describe("a seat's state carries only the animation events it may see", () => {
  it('stateful session: seat 1 sees its private event, seat 2 and the spectator do not', async () => {
    const session = GameSession.create<SecretDeploymentGame>({
      gameType: 'secret-deployment',
      GameClass: SecretDeploymentGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 'animate-to',
    });
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
    const session = GameSession.create<SecretDeploymentGame>({
      gameType: 'secret-deployment',
      GameClass: SecretDeploymentGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 'animate-to',
    });
    expect((await session.performAction('signal', 1, {})).success).toBe(true);
    for (const seat of [0, 1, 2]) expect(eventTypes(session.getState(seat).state)).toEqual(['signal']);
  });
});
