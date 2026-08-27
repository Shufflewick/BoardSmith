import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { measureSnapshotSize, projectSnapshotSize } from './state-size.js';
import { createTestGame } from './test-game.js';

class Token extends Piece<BudgetGame> {}
class Board extends Space<BudgetGame> {}

class BudgetGame extends Game<BudgetGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);
    const board = this.create(Board, 'board');
    for (let i = 0; i < 30; i++) board.create(Token, `t-${i}`);
    this.registerActions(
      Action.create('pass').prompt('Pass').execute(() => ({ success: true })),
    );
    this.setFlow(defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 200,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    }));
  }
}

function play(actions: number, checkpoints?: { max?: number }) {
  const runner = new GameRunner({
    GameClass: BudgetGame,
    gameType: 'budget-game',
    gameOptions: { playerCount: 2, seed: 'budget' },
    checkpoints,
  });
  runner.start();
  for (let i = 0; i < actions; i++) {
    runner.performAction('pass', (i % 2) + 1, {});
    runner.captureCheckpoint();
  }
  return runner.getSnapshot();
}

describe('measureSnapshotSize', () => {
  it('attributes the bytes to the checkpoints, not the tree', () => {
    const size = measureSnapshotSize(play(20));
    expect(size.checkpointCount).toBe(21);
    // The point of the measurement: the tree is small and the retained copies
    // of it are not. A game author reading only `treeBytes` sees no problem.
    expect(size.checkpointBytes).toBeGreaterThan(size.treeBytes * 10);
    expect(size.bytesPerCheckpoint).toBeGreaterThan(0);
    expect(size.totalBytes).toBeGreaterThan(size.checkpointBytes);
  });

  it('reports zero retained checkpoints for a snapshot that keeps none', () => {
    const runner = new GameRunner({
      GameClass: BudgetGame,
      gameType: 'budget-game',
      gameOptions: { playerCount: 2, seed: 'budget' },
      checkpoints: { enabled: false },
    });
    runner.start();
    const size = measureSnapshotSize(runner.getSnapshot());
    expect(size.checkpointCount).toBe(0);
    expect(size.bytesPerCheckpoint).toBe(0);
  });
});

describe('measureSnapshotSize — sparse checkpoint windows (issue 143)', () => {
  /**
   * The documented-but-wrong recipe: perform N actions, snapshot ONCE at the
   * end. Checkpoints are captured through the snapshot funnel, so every slot
   * between the start and the final action is left uncaptured.
   */
  function playSnapshottingOnlyAtTheEnd(actions: number) {
    const runner = new GameRunner({
      GameClass: BudgetGame,
      gameType: 'budget-game',
      gameOptions: { playerCount: 2, seed: 'budget' },
    });
    runner.start();
    for (let i = 0; i < actions; i++) {
      runner.performAction('pass', (i % 2) + 1, {});
    }
    return runner.getSnapshot();
  }

  it('refuses to average over uncaptured slots instead of reporting a wrong multiplier', () => {
    const snapshot = playSnapshottingOnlyAtTheEnd(20);
    expect(() => measureSnapshotSize(snapshot)).toThrow(/never captured/);
  });

  it('names the counts and the fix in the error', () => {
    const snapshot = playSnapshottingOnlyAtTheEnd(20);
    let message = '';
    try {
      measureSnapshotSize(snapshot);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('19 of 21');
    expect(message).toContain('getSnapshot()');
  });

  it('measures normally once the snapshot funnel ran after every action', () => {
    const size = measureSnapshotSize(play(20));
    expect(size.checkpointCount).toBe(21);
    expect(size.bytesPerCheckpoint).toBeGreaterThan(size.treeBytes * 0.9);
  });
});

describe('createTestGame checkpoints policy (issue 143)', () => {
  it('applies a retention policy instead of passing it to the game constructor', () => {
    const game = createTestGame(BudgetGame, {
      playerCount: 2,
      seed: 'budget',
      checkpoints: { max: 3 },
    });
    for (let i = 0; i < 10; i++) {
      game.doAction((i % 2) + 1, 'pass', {});
      game.runner.getSnapshot();
    }
    const size = measureSnapshotSize(game.runner.getSnapshot());
    expect(size.checkpointCount).toBe(3);
    expect(game.runner.checkpointPolicy.max).toBe(3);
    // The policy must NOT have leaked into the game's constructor options.
    expect(game.game.getConstructorOptions().checkpoints).toBeUndefined();
  });

  it('can turn checkpointing off entirely', () => {
    const game = createTestGame(BudgetGame, {
      playerCount: 2,
      seed: 'budget',
      checkpoints: { enabled: false },
    });
    game.doAction(1, 'pass', {});
    const size = measureSnapshotSize(game.runner.getSnapshot());
    expect(size.checkpointCount).toBe(0);
  });
});

describe('projectSnapshotSize', () => {
  it('projects a full game from an early measurement, within tolerance', () => {
    // The whole reason this exists: a measurement taken 10 actions in says
    // nothing on its own, and measuring only what you have played is how the
    // ceiling stays invisible until production.
    const early = measureSnapshotSize(play(10));
    const projected = projectSnapshotSize(early, 100);
    const actual = measureSnapshotSize(play(100)).totalBytes;

    expect(projected).toBeGreaterThan(actual * 0.85);
    expect(projected).toBeLessThan(actual * 1.15);
  });

  it('flattens the projection under a retention cap', () => {
    const early = measureSnapshotSize(play(10, { max: 5 }));
    const at100 = projectSnapshotSize(early, 100, { maxCheckpoints: 5 });
    const at1000 = projectSnapshotSize(early, 1000, { maxCheckpoints: 5 });
    const uncapped = projectSnapshotSize(early, 1000);

    // Capped growth is the action-history term only; uncapped is tree-sized
    // per action, which is orders of magnitude more.
    expect(uncapped).toBeGreaterThan(at1000 * 10);
    expect(at1000).toBeLessThan(at100 * 5);
  });
});
