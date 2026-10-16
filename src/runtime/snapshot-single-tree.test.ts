import { describe, it, expect, vi } from 'vitest';
import { Game, Space, Piece, Player, Action, loop, eachPlayer, actionStep } from '../engine/index.js';
import { snapshotTree, type GameStateSnapshot } from '../engine/utils/index.js';
import { GameRunner, type RunnerCheckpointPolicy } from './runner.js';

// #804: a snapshot carries the element tree exactly once.

class Token extends Piece<BoardGame> {
  label!: string;
}
class Board extends Space<BoardGame> {}

class BoardGame extends Game<BoardGame, Player> {
  board!: Board;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerElements([Token, Board]);
    this.board = this.create(Board, 'board');
    for (let i = 0; i < 60; i++) this.board.create(Token, `token-${i}`, { label: `label-${i}` });
    this.registerActions(Action.create('pass').prompt('Pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({ while: () => true, maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
    });
  }
}

function playedRunner(checkpoints?: RunnerCheckpointPolicy): GameRunner<BoardGame> {
  const runner = new GameRunner({
    GameClass: BoardGame,
    gameType: 'board-game',
    gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'single-tree' },
    checkpoints,
  });
  runner.start();
  expect(runner.performAction('pass', 1, {}).success).toBe(true);
  return runner;
}

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

describe('a snapshot carries the element tree once (#804)', () => {
  it('reads the tree from the newest checkpoint and writes no separate state', () => {
    const runner = playedRunner();
    const snapshot = runner.getSnapshot();

    expect('state' in snapshot).toBe(false);
    expect(snapshotTree(snapshot)).toEqual(runner.game.toJSON());
  });

  it('shrinks the encoded snapshot: everything besides the tree is smaller than a second tree', () => {
    const snapshot = playedRunner().getSnapshot();
    const treeBytes = bytes(snapshotTree(snapshot));

    expect(bytes(snapshot) - treeBytes).toBeLessThan(treeBytes);
  });

  it('serializes the tree once per snapshot', () => {
    const runner = playedRunner();
    const toJSON = vi.spyOn(runner.game, 'toJSON');

    runner.getSnapshot();

    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it('carries the tree as state, once, when checkpoints are disabled', () => {
    const runner = playedRunner({ enabled: false });
    const toJSON = vi.spyOn(runner.game, 'toJSON');
    const snapshot = runner.getSnapshot();

    expect(toJSON).toHaveBeenCalledTimes(1);
    expect('actionCheckpoints' in snapshot).toBe(false);
    expect(snapshotTree(snapshot)).toEqual(runner.game.toJSON());
    const restored = GameRunner.fromSnapshot(JSON.parse(JSON.stringify(snapshot)) as GameStateSnapshot, BoardGame);
    expect(restored.game.toJSON()).toEqual(runner.game.toJSON());
  });

  it('restores from the newest checkpoint even when the restoring runner keeps none', () => {
    const runner = playedRunner();
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot())) as GameStateSnapshot;

    const restored = GameRunner.fromSnapshot(snapshot, BoardGame, { checkpoints: { enabled: false } });

    expect(restored.game.toJSON()).toEqual(runner.game.toJSON());
    expect('state' in restored.getSnapshot()).toBe(true);
  });

  it('refuses a snapshot written by an older engine, which stored the tree twice', () => {
    const runner = playedRunner();
    const current = runner.getSnapshot();
    const old = { ...current, state: runner.game.toJSON() } as unknown as GameStateSnapshot;

    expect(() => GameRunner.fromSnapshot(old, BoardGame)).toThrow(/older version of BoardSmith/);
  });

  it('refuses a snapshot that carries no tree at all', () => {
    const disabled = playedRunner({ enabled: false }).getSnapshot();
    const { state: _state, ...withoutTree } = disabled as { state?: unknown };
    const emptyWindow = { ...withoutTree, actionCheckpoints: { baseIndex: 1, entries: [] } };

    expect(() => GameRunner.fromSnapshot(withoutTree as GameStateSnapshot, BoardGame)).toThrow(/no element tree/);
    expect(() => GameRunner.fromSnapshot(emptyWindow as unknown as GameStateSnapshot, BoardGame)).toThrow(/no element tree/);
  });
});
