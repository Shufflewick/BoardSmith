import { describe, it, expect } from 'vitest';
import { toPublicFlowState } from './public-flow-state.js';
import { flowBoundaryKey } from './boundary-key.js';
import { turnSequence, dueSeats } from './seat-activity.js';
import type { FlowState } from './types.js';

// #449: the flow state a seat is sent carries no action count of any kind.
const server: FlowState = {
  position: {
    path: [1, 0, 2],
    iterations: { __loop_0: 7 },
    frameData: {
      __frame_1: { eligibleSeats: [2, 1], nextIndex: 1 },
      __frame_2: { moveCount: 5 },
    },
    playerIndex: 1,
    variables: { secret: 'x' },
    turnRun: { player: 1, count: 3 },
  },
  complete: false,
  awaitingInput: true,
  awaitingPlayers: [
    { playerIndex: 1, availableActions: ['placePack', 'done'], completed: false },
    { playerIndex: 2, availableActions: ['done'], completed: false },
  ],
  currentPhase: 'deploy',
  moveCount: 5,
  movesRemaining: 2,
  movesRequired: 0,
  timeLimitMs: 30000,
  turnScopeUndeclared: 'deploy',
  actionError: "seat 1's error",
  followUps: [{ action: 'peek', args: { card: 12 }, seat: 1 }],
};

describe('toPublicFlowState (#449)', () => {
  it('keeps exactly the fields a client reads, and no count', () => {
    expect(toPublicFlowState(server)).toEqual({
      position: { path: [1, 0, 2], frameData: { __frame_1: { eligibleSeats: [2, 1] } } },
      complete: false,
      awaitingInput: true,
      awaitingPlayers: server.awaitingPlayers,
      currentPhase: 'deploy',
      timeLimitMs: 30000,
    });
  });

  it('answers the client helpers exactly as the server state does', () => {
    const pub = toPublicFlowState(server);
    expect(flowBoundaryKey(pub)).toBe(flowBoundaryKey(server));
    expect(turnSequence(pub)).toEqual(turnSequence(server));
    expect(dueSeats(pub)).toEqual(dueSeats(server));
  });
});
