import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import { executeDebugCommand, type GameCommand } from './debug-command.js';
import { Game, Space, Piece, Player } from '../engine/index.js';

class TestPiece extends Piece<TestGame> {
  value: number = 0;
}

class TestSpace extends Space<TestGame> {}

class TestGame extends Game<TestGame, Player> {}

describe('GameCommand (#499)', () => {
  it('is exactly the three edits the debug ops send', () => {
    expectTypeOf<GameCommand['type']>().toEqualTypeOf<'MOVE' | 'SHUFFLE' | 'REORDER_CHILD'>();
  });
});

describe('executeDebugCommand', () => {
  let game: TestGame;
  let board: TestSpace;
  let hand: TestSpace;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    board = game.create(TestSpace, 'board');
    hand = game.create(TestSpace, 'hand');
  });

  it('rejects an unknown command type with an error naming the type', () => {
    const result = executeDebugCommand(game, { type: 'NOT_A_COMMAND' } as unknown as GameCommand);
    expect(result.success).toBe(false);
    expect(result.error).toContain('NOT_A_COMMAND');
  });

  it('converts a thrown error into a failed result instead of propagating', () => {
    // A move into the piece's own subtree is refused by a throw in the engine.
    const outer = board.create(TestSpace, 'outer');
    const inner = outer.create(TestSpace, 'inner');
    const result = executeDebugCommand(game, { type: 'MOVE', elementId: outer.id, destinationId: inner.id });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(outer.parent).toBe(board);
  });

  describe('MOVE', () => {
    it('reparents the element', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeDebugCommand(game, { type: 'MOVE', elementId: piece.id, destinationId: hand.id });
      expect(result.success).toBe(true);
      expect(piece.parent).toBe(hand);
    });

    it("honours position 'first'", () => {
      hand.create(TestPiece, 'a');
      const b = board.create(TestPiece, 'b');
      executeDebugCommand(game, { type: 'MOVE', elementId: b.id, destinationId: hand.id, position: 'first' });
      expect(hand.all(TestPiece).map((p) => p.name)).toEqual(['b', 'a']);
    });

    it('fails when the element is missing', () => {
      const result = executeDebugCommand(game, { type: 'MOVE', elementId: 99999, destinationId: hand.id });
      expect(result.success).toBe(false);
      expect(result.error).toContain('99999');
    });

    it('fails when the destination is missing', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeDebugCommand(game, { type: 'MOVE', elementId: piece.id, destinationId: 99999 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Destination');
      expect(piece.parent).toBe(board);
    });
  });

  describe('SHUFFLE', () => {
    it('keeps every child, only reorders', () => {
      for (let i = 0; i < 20; i++) board.create(TestPiece, `p${i}`, { value: i });
      const result = executeDebugCommand(game, { type: 'SHUFFLE', spaceId: board.id });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece).map((p) => p.value).sort((a, b) => a - b))
        .toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    it('fails when the space is missing', () => {
      const result = executeDebugCommand(game, { type: 'SHUFFLE', spaceId: 99999 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('99999');
    });
  });

  describe('REORDER_CHILD', () => {
    it('moves a child to the target index', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      const result = executeDebugCommand(game, { type: 'REORDER_CHILD', elementId: pieces[2].id, targetIndex: 0 });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['c', 'a', 'b']);
    });

    it('rejects an out-of-range index without disturbing the order', () => {
      const pieces = ['a', 'b'].map((n) => board.create(TestPiece, n));
      for (const targetIndex of [-1, 2]) {
        const result = executeDebugCommand(game, { type: 'REORDER_CHILD', elementId: pieces[0].id, targetIndex });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid target index');
      }
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b']);
    });

    it('fails for an element with no parent', () => {
      const result = executeDebugCommand(game, { type: 'REORDER_CHILD', elementId: game.id, targetIndex: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no parent');
    });
  });
});
