import { describe, it, expect } from 'vitest';
import { availableActionsForSeat, dueSeats } from './seat-activity.js';
import { createPlayerView } from '../utils/snapshot.js';
import { simulateRandomGames } from '../../testing/random-simulation.js';
import { PlayThenAcknowledgeGame } from '../../session/testing/fixtures/play-then-acknowledge-fixture.js';

/**
 * #321: once a simultaneous step is awaiting, the flow state must not carry
 * the previous action step's `currentPlayer` / `availableActions`. The
 * fixture is cribbage's play-then-score hand reduced to its bones.
 */
function atScoring(): PlayThenAcknowledgeGame {
  const game = new PlayThenAcknowledgeGame({ playerCount: 2, seed: 'x' });
  game.startFlow();
  game.continueFlow('playCard', { card: 1 });
  game.continueFlow('playCard', { card: 2 });
  return game;
}

describe('#321: a simultaneous step entered after an action step', () => {
  it('the action step before it still reports its own seat and actions', () => {
    const game = new PlayThenAcknowledgeGame({ playerCount: 2, seed: 'x' });
    const state = game.startFlow();

    expect(state.currentPlayer).toBe(1);
    expect(state.availableActions).toEqual(['playCard']);
    expect(state.awaitingPlayers).toBeUndefined();
  });

  it('carries no leftover currentPlayer or availableActions once the simultaneous step is awaiting', () => {
    const state = atScoring().getFlowState()!;

    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers).toEqual([
      { playerIndex: 1, availableActions: ['acknowledgeScore'], completed: false },
      { playerIndex: 2, availableActions: ['acknowledgeScore'], completed: false },
    ]);
    expect(state.currentPlayer).toBeUndefined();
    expect(state.availableActions).toBeUndefined();
  });

  it('still carries none after one seat has acted in the step', () => {
    const game = atScoring();
    const state = game.continueFlow('acknowledgeScore', {}, 1);

    expect(state.awaitingInput).toBe(true);
    expect(state.currentPlayer).toBeUndefined();
    expect(state.availableActions).toBeUndefined();
  });

  it('a restored engine reports no leftover seat or actions either', () => {
    const live = atScoring();
    const captured = live.getFlowState()!;

    const restored = new PlayThenAcknowledgeGame({ playerCount: 2, seed: 'x' });
    restored.startFlow();
    restored.restoreFlowState(captured);

    const state = restored.getFlowState()!;
    expect(state.awaitingInput).toBe(true);
    expect(state.awaitingPlayers).toEqual(captured.awaitingPlayers);
    expect(state.currentPlayer).toBeUndefined();
    expect(state.availableActions).toBeUndefined();
  });

  it('a stored state that carries the leftover fields does not bring them back on restore', () => {
    // Snapshots written before #321 hold the stale pair. Restoring one must
    // not republish it: what the state reports is decided by the step that is
    // awaiting, not by whatever the stored object happened to carry.
    const captured = { ...atScoring().getFlowState()!, currentPlayer: 2, availableActions: ['playCard'] };

    const restored = new PlayThenAcknowledgeGame({ playerCount: 2, seed: 'x' });
    restored.startFlow();
    restored.restoreFlowState(captured);

    const state = restored.getFlowState()!;
    expect(state.currentPlayer).toBeUndefined();
    expect(state.availableActions).toBeUndefined();
  });

  it('every reader of the flow state offers a finished seat nothing and names the awaited seats', () => {
    const game = atScoring();
    game.continueFlow('acknowledgeScore', {}, 1);
    const state = game.getFlowState()!;

    // seat-activity: the one canonical answer the session host, turn boundary and UI read.
    expect(dueSeats(state)).toEqual([2]);
    expect(availableActionsForSeat(state, 1)).toEqual([]);
    expect(availableActionsForSeat(state, 2)).toEqual(['acknowledgeScore']);

    // The host-embedded player view.
    const seat1View = createPlayerView(game, 1);
    expect(seat1View.flowState?.isMyTurn).toBe(false);
    expect(seat1View.flowState?.availableActions).toEqual([]);

    // The debug description names the step's seats, not the last action step's seat.
    const debug = game.getFlowDebugInfo();
    expect(debug.awaiting).toEqual({ currentPlayer: undefined, awaitingPlayers: [1, 2] });
    expect(debug.describe()).toMatch(/, waiting on seats 1, 2$/);
  });

  it('simulateRandomGames plays every game to completion instead of getting stuck', async () => {
    const results = await simulateRandomGames(PlayThenAcknowledgeGame, {
      count: 4,
      playerCounts: [2],
      seed: 'x',
    });

    expect(results.errors).toEqual([]);
    expect(results.stuck).toBe(0);
    expect(results.completed).toBe(4);
  });
});
