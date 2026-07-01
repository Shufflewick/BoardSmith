/**
 * GameSession broadcast — flow-debug + pending-action introspection (Phase 123 Plan 04)
 *
 * Covers:
 * - flowDebugInfo.description is a non-empty string on every connected seat's broadcast state
 * - pendingAction is injected per-seat via GameSession.getPendingAction(effectivePosition)
 * - Perspective isolation (T-123-07): seat 2's broadcast NEVER contains seat 1's
 *   accumulated pending-action args
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import type { PlayerGameState, BroadcastAdapter } from './types.js';

// Two-step action (chooseFrom color -> chooseFrom size), awaited by seat 1 only,
// so we can leave it mid-flight while seat 2 is also connected.
class TwoStepGame extends Game<TwoStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute(() => {})
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['pick'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      })
    );
  }
}

type CapturedState = {
  seat: number;
  state: PlayerGameState;
};

function makeMockBroadcaster(
  sessions: Array<{ playerSeat: number; isSpectator: boolean }>,
  captured: CapturedState[]
): BroadcastAdapter {
  return {
    getSessions: () => sessions,
    send: (_session: { playerSeat: number; isSpectator: boolean }, update: Record<string, unknown>) => {
      const seat = (_session as { playerSeat: number }).playerSeat;
      captured.push({ seat, state: (update as { state: PlayerGameState }).state });
    },
  } as unknown as BroadcastAdapter;
}

function makeSession() {
  return GameSession.create({
    gameType: 'flow-debug-test',
    GameClass: TwoStepGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'test',
  });
}

describe('GameSession broadcast — flowDebugInfo', () => {
  it('every connected seat receives a non-empty flowDebugInfo.description', () => {
    const session = makeSession();
    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [
        { playerSeat: 1, isSpectator: false },
        { playerSeat: 2, isSpectator: false },
      ],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    expect(captured).toHaveLength(2);
    for (const { state } of captured) {
      expect(state.flowDebugInfo).toBeDefined();
      expect(typeof state.flowDebugInfo!.description).toBe('string');
      expect(state.flowDebugInfo!.description.length).toBeGreaterThan(0);
      expect(Array.isArray(state.flowDebugInfo!.path)).toBe(true);
    }
  });
});

describe('GameSession broadcast — pendingAction perspective isolation (T-123-07)', () => {
  it("seat 2's broadcast never contains seat 1's accumulated pending-action args", () => {
    const session = makeSession();

    // Seat 1 begins (but does not complete) the two-step 'pick' action.
    const start = session.startPendingAction('pick', 1);
    expect(start.success).toBe(true);

    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [
        { playerSeat: 1, isSpectator: false },
        { playerSeat: 2, isSpectator: false },
      ],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    const seat1State = captured.find((c) => c.seat === 1)!.state;
    const seat2State = captured.find((c) => c.seat === 2)!.state;

    // Seat 1 sees its OWN pending action.
    expect(seat1State.pendingAction).toBeDefined();
    expect(seat1State.pendingAction!.actionName).toBe('pick');

    // Seat 2 must never see seat 1's pending action — the primary flagged threat.
    expect(seat2State.pendingAction).toBeUndefined();
  });

  it('a spectator (effectivePosition 0) receives flowDebugInfo but no pending action', () => {
    const session = makeSession();
    session.startPendingAction('pick', 1);

    const captured: CapturedState[] = [];
    const broadcaster = makeMockBroadcaster(
      [{ playerSeat: 1, isSpectator: true }],
      captured
    );
    session.setBroadcaster(broadcaster);
    session.broadcast();

    const spectatorState = captured[0]!.state;
    expect(spectatorState.flowDebugInfo).toBeDefined();
    expect(spectatorState.pendingAction).toBeUndefined();
  });
});
