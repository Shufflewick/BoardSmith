import { describe, it, expect } from 'vitest';
import { Game, actionStep, simultaneousActionStep, createSnapshot, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { MCTSBot } from '../../bot/mcts-bot.js';
import {
  DeployGame,
  FixedDeployGame,
  GrowingDeployGame,
  TimedTurnGame,
  UntimedDeployGame,
} from '../../session/testing/fixtures/timed-step-fixture.js';

/**
 * A step's declared time limit (#300): the engine resolves it ONCE, when the
 * step is entered, and carries the resolved number in the flow state. It is a
 * duration, never an instant -- the engine keeps no clock and never closes the
 * step itself. The host reads it off the turn boundary and enforces it.
 */

const opts = { playerCount: 2, seed: 'step-time-limit' };

function runnerFor<G extends Game>(GameClass: new (options: GameOptions) => G): GameRunner<G> {
  const runner = new GameRunner({ GameClass, gameType: 'step-time-limit', gameOptions: opts });
  runner.start();
  return runner;
}

function commit<G extends Game>(runner: GameRunner<G>, seat: number): void {
  const result = runner.performAction('commit', seat, {});
  expect(result.success, result.error).toBe(true);
  runner.captureCheckpoint();
}

describe('a step declares how long it stays open', () => {
  it('reports a number limit on a simultaneous step', () => {
    const runner = runnerFor(FixedDeployGame);
    expect(runner.getFlowState()!.timeLimitMs).toBe(120_000);
  });

  it('reports a number limit on a sequential action step, for every turn', () => {
    const runner = runnerFor(TimedTurnGame);
    expect(runner.getFlowState()!.currentPlayer).toBe(1);
    expect(runner.getFlowState()!.timeLimitMs).toBe(45_000);

    expect(runner.performAction('commit', 1, {}).success).toBe(true);
    expect(runner.getFlowState()!.currentPlayer).toBe(2);
    expect(runner.getFlowState()!.timeLimitMs).toBe(45_000);
  });

  it('resolves a function limit when the step is entered', () => {
    const runner = runnerFor(GrowingDeployGame);
    expect(runner.getFlowState()!.timeLimitMs).toBe(30_000);
  });

  it('keeps the value fixed when a seat submits mid-round', () => {
    const runner = runnerFor(GrowingDeployGame);
    commit(runner, 1);
    // Seat 2 still owes a move: the same round, the same window, even though
    // the function would now answer 31 000.
    expect(runner.getFlowState()!.awaitingPlayers!.find((p) => p.playerIndex === 2)!.completed).toBe(false);
    expect(runner.getFlowState()!.timeLimitMs).toBe(30_000);
  });

  it('resolves the function again when the next round opens the step afresh', () => {
    const runner = runnerFor(GrowingDeployGame);
    commit(runner, 1);
    commit(runner, 2);
    expect(runner.getFlowState()!.timeLimitMs).toBe(32_000);
  });

  it('reports no field for a step that declares no limit', () => {
    const runner = runnerFor(UntimedDeployGame);
    expect(runner.getFlowState()!.awaitingInput).toBe(true);
    expect('timeLimitMs' in runner.getFlowState()!).toBe(false);
  });

  it('refuses a limit that is not a positive whole number of milliseconds, naming the step', () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        simultaneousActionStep({ name: 'deploy', actions: ['commit'], timeLimitMs: bad }),
      ).toThrow(/'deploy'.*timeLimitMs/s);
      expect(() => actionStep({ name: 'turn', actions: ['pass'], timeLimitMs: bad })).toThrow(
        /'turn'.*timeLimitMs/s,
      );
    }
  });

  it('refuses a function limit that answers something unusable, when the step is entered', () => {
    class BadGame extends DeployGame {
      constructor(options: GameOptions) {
        super(options, () => 0);
      }
    }
    expect(() => runnerFor(BadGame)).toThrow(/'deploy'.*timeLimitMs.*0/s);
  });
});

describe('the resolved limit survives every restore path', () => {
  function midRound() {
    const runner = runnerFor(GrowingDeployGame);
    commit(runner, 1);
    // Advance the counter the function reads WITHOUT closing the round, so a
    // restore that re-resolved the limit would answer something other than 30 000.
    runner.game.commits = 7;
    return runner;
  }

  it('survives restore() from a snapshot', () => {
    const runner = midRound();
    const restored = GameRunner.fromSnapshot(runner.getSnapshot(), GrowingDeployGame);
    expect(restored.getFlowState()!.timeLimitMs).toBe(30_000);
  });

  it('survives an undo checkpoint restore', () => {
    const runner = midRound();
    // Checkpoint 1: after seat 1 committed, inside the open round.
    const restored = GameRunner.fromCheckpoint(runner.getSnapshot(), 1, GrowingDeployGame);
    expect(restored).not.toBeNull();
    expect(restored!.getFlowState()!.timeLimitMs).toBe(30_000);
  });

  it('survives an MCTS clone', () => {
    const runner = midRound();
    const bot = new MCTSBot(runner.game, GrowingDeployGame, 'step-time-limit', 2, runner.actionHistory, {
      iterations: 1,
      playoutDepth: 1,
    });
    const snapshot = createSnapshot(runner.game, 'step-time-limit', runner.actionHistory, opts.seed);
    const clone = (bot as unknown as { restoreGame(s: typeof snapshot): Game }).restoreGame(snapshot);
    expect(clone.getFlowState()!.timeLimitMs).toBe(30_000);
  });
});
