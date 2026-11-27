import { describe, it, expect } from 'vitest';
import { Game, type GameOptions } from '../index.js';
import { createSnapshot } from '../utils/index.js';
import { GameRunner } from '../../runtime/runner.js';
import { MCTSBot } from '../../bot/mcts-bot.js';
import {
  FixedDeployGame,
  TimedTurnGame,
  UntimedDeployGame,
} from '../../session/testing/fixtures/timed-step-fixture.js';

/**
 * A step declared `timed: true` (#300, #1830): the engine carries the mark in
 * the flow state while the step is open, so the host knows to close it when the
 * table's time per turn runs out. The step says nothing about how long that is.
 */

const opts = { playerCount: 2, seed: 'timed-step' };

function runnerFor<G extends Game>(GameClass: new (options: GameOptions) => G): GameRunner<G> {
  const runner = new GameRunner({ GameClass, gameType: 'timed-step', gameOptions: opts });
  runner.start();
  return runner;
}

describe('a step declares that the host times it', () => {
  it('reports the mark on a simultaneous step', () => {
    expect(runnerFor(FixedDeployGame).getFlowState()!.timed).toBe(true);
  });

  it('reports the mark on a sequential action step, for every turn', () => {
    const runner = runnerFor(TimedTurnGame);
    expect(runner.getFlowState()!.currentPlayer).toBe(1);
    expect(runner.getFlowState()!.timed).toBe(true);

    expect(runner.performAction('commit', 1, {}).success).toBe(true);
    expect(runner.getFlowState()!.currentPlayer).toBe(2);
    expect(runner.getFlowState()!.timed).toBe(true);
  });

  it('reports no field for a step that is not timed', () => {
    const runner = runnerFor(UntimedDeployGame);
    expect(runner.getFlowState()!.awaitingInput).toBe(true);
    expect('timed' in runner.getFlowState()!).toBe(false);
  });
});

describe('the mark survives every restore path', () => {
  function midRound() {
    const runner = runnerFor(FixedDeployGame);
    expect(runner.performAction('commit', 1, {}).success).toBe(true);
    runner.captureCheckpoint();
    return runner;
  }

  it('survives restore() from a snapshot', () => {
    const restored = GameRunner.fromSnapshot(midRound().getSnapshot(), FixedDeployGame);
    expect(restored.getFlowState()!.timed).toBe(true);
  });

  it('survives an undo checkpoint restore', () => {
    // Checkpoint 1: after seat 1 committed, inside the open round.
    const restored = GameRunner.fromCheckpoint(midRound().getSnapshot(), 1, FixedDeployGame);
    expect(restored).not.toBeNull();
    expect(restored!.getFlowState()!.timed).toBe(true);
  });

  it('survives an MCTS clone', () => {
    const runner = midRound();
    const bot = new MCTSBot(runner.game, FixedDeployGame, 'timed-step', 2, {
      iterations: 1,
      playoutDepth: 1,
    });
    const snapshot = createSnapshot(runner.game, 'timed-step', runner.actionHistory, opts.seed);
    const clone = (bot as unknown as { restoreGame(s: typeof snapshot): Game }).restoreGame(snapshot);
    expect(clone.getFlowState()!.timed).toBe(true);
  });
});
