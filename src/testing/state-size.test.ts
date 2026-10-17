import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { assertStateBudget, measureSnapshotSize, projectSnapshotSize } from './state-size.js';
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
    this.setFlow({
      root: loop({
        while: () => true,
        maxIterations: 200,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    });
  }
}

/**
 * `actions` one-action turns with full history, so every checkpoint is kept and
 * the multiplier is there to measure. The default keeps only the turn start.
 */
function play(actions: number, checkpoints?: { max?: number }) {
  const runner = new GameRunner({
    GameClass: BudgetGame,
    gameType: 'budget-game',
    gameOptions: { playerCount: 2, seed: 'budget' },
    checkpoints: { ...checkpoints, history: 'full' },
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

/**
 * `scout` hands its seat a follow-up into `loot`, which the step never offers,
 * so the seat holds it until a host closes the seat (`closeExpiredHeldSeat`).
 */
class HeldSeatGame extends Game<HeldSeatGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Board]);
    const board = this.create(Board, 'board');
    for (let i = 0; i < 30; i++) board.create(Token, `t-${i}`);
    this.registerActions(
      Action.create('scout').prompt('Scout').execute(() => ({ success: true, followUp: { action: 'loot', args: {} } })),
      Action.create('loot').prompt('Loot').condition({ 'only as a follow-up': () => false }).execute(() => {}),
    );
    this.setFlow({
      root: loop({ while: () => true, maxIterations: 200, do: eachPlayer({ do: actionStep({ actions: ['scout'] }) }) }),
    });
  }
}

describe('measureSnapshotSize — sparse checkpoint windows (issue 143)', () => {
  /**
   * An action captures the state before it runs (#802), but a seat expiry
   * appends to the history without a capture. A host never sees the hole (its
   * previous op's snapshot captured that slot); a driver that expires a seat
   * between actions and snapshots once at the end leaves one.
   */
  function expireASeatSnapshottingOnlyAtTheEnd() {
    const runner = new GameRunner({
      GameClass: HeldSeatGame,
      gameType: 'held-seat-game',
      gameOptions: { playerCount: 2, seed: 'budget' },
      checkpoints: { history: 'full' },
    });
    runner.start();
    expect(runner.performAction('scout', 1, {}).success).toBe(true);
    expect(runner.closeExpiredHeldSeat(1, 'pass')).toBeDefined();
    expect(runner.performAction('scout', 2, {}).success).toBe(true);
    return runner.getSnapshot();
  }

  it('refuses to average over uncaptured slots instead of reporting a wrong multiplier', () => {
    expect(() => measureSnapshotSize(expireASeatSnapshottingOnlyAtTheEnd())).toThrow(/never captured/);
  });

  it('names the counts and the fix in the error', () => {
    expect(() => measureSnapshotSize(expireASeatSnapshottingOnlyAtTheEnd())).toThrow(
      /1 of 4 retained checkpoint slots[\s\S]*getSnapshot\(\)/,
    );
  });

  it('measures a driver that never snapshots between actions (#802)', () => {
    const runner = new GameRunner({
      GameClass: BudgetGame,
      gameType: 'budget-game',
      gameOptions: { playerCount: 2, seed: 'budget' },
      checkpoints: { history: 'full' },
    });
    runner.start();
    for (let i = 0; i < 20; i++) runner.performAction('pass', (i % 2) + 1, {});
    const size = measureSnapshotSize(runner.getSnapshot());
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
    // One-action turns: the default keeps only the turn start, inside the cap.
    expect(size.checkpointCount).toBe(1);
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

describe('assertStateBudget (#504)', () => {
  const size = measureSnapshotSize(play(20));

  it('passes a game under the budget', () => {
    expect(() => assertStateBudget(size, size.totalBytes)).not.toThrow();
  });

  it('fails a game over the budget, naming the measured size and the budget', () => {
    const budget = size.totalBytes - 1;
    expect(() => assertStateBudget(size, budget)).toThrow(
      new RegExp(`${size.totalBytes.toLocaleString('en-US')} bytes.*${budget.toLocaleString('en-US')} bytes`),
    );
  });

  it('says where the bytes went, so the failure points at the fix', () => {
    let message = '';
    try {
      assertStateBudget(size, 1000);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`${size.checkpointCount} checkpoints`);
    expect(message).toContain('message log');
    expect(message).toContain('checkpoints: { max }');
  });

  it('refuses a budget that is not a positive whole number of bytes', () => {
    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => assertStateBudget(size, budget)).toThrow(/budget/);
    }
  });
});
