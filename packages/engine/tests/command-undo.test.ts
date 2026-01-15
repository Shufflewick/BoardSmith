import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
} from '../src/index.js';

// Test classes
class TestGame extends Game<TestGame, Player> {}

class TestPiece extends Piece<TestGame> {
  value!: number;
}

class TestSpace extends Space<TestGame> {}

describe('Command Undo', () => {
  let game: TestGame;
  let board: TestSpace;
  let hand: TestSpace;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    board = game.create(TestSpace, 'board');
    hand = game.create(TestSpace, 'hand');
  });

  describe('undoLastCommand', () => {
    it('should return false when history is empty', () => {
      expect(game.undoLastCommand()).toBe(false);
    });

    it('should undo MOVE command (piece moves back)', () => {
      // Create a piece on the board
      const piece = board.create(TestPiece, 'piece', { value: 42 });

      // Execute MOVE command via game.execute (which tracks inverse)
      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });

      expect(piece.parent).toBe(hand);
      expect(hand.all(TestPiece).length).toBe(1);
      expect(board.all(TestPiece).length).toBe(0);

      // Undo should move it back
      const success = game.undoLastCommand();
      expect(success).toBe(true);
      expect(piece.parent).toBe(board);
      expect(hand.all(TestPiece).length).toBe(0);
      expect(board.all(TestPiece).length).toBe(1);
    });

    it('should undo SET_ATTRIBUTE command (value restored)', () => {
      const piece = board.create(TestPiece, 'piece', { value: 10 });
      const originalValue = piece.value;

      // Execute a SET_ATTRIBUTE command
      game.execute({
        type: 'SET_ATTRIBUTE',
        elementId: piece.id,
        attribute: 'value',
        value: 99,
      });

      expect(piece.value).toBe(99);

      // Undo should restore original value
      const success = game.undoLastCommand();
      expect(success).toBe(true);
      expect(piece.value).toBe(originalValue);
    });

    it('should undo REMOVE command (element restored from pile)', () => {
      const piece = board.create(TestPiece, 'piece', { value: 5 });

      // Execute REMOVE command (moves to pile)
      game.execute({
        type: 'REMOVE',
        elementId: piece.id,
      });

      expect(piece.parent).toBe(game.pile);
      expect(board.all(TestPiece).length).toBe(0);

      // Undo should restore it to original parent
      const success = game.undoLastCommand();
      expect(success).toBe(true);
      expect(piece.parent).toBe(board);
      expect(board.all(TestPiece).length).toBe(1);
    });

    it('should return false for non-invertible commands (SHUFFLE)', () => {
      // Create some pieces to shuffle
      board.createMany(3, TestPiece, 'piece', (i) => ({ value: i }));

      // Execute a SHUFFLE command
      game.execute({
        type: 'SHUFFLE',
        spaceId: board.id,
      });

      // Undo should return false (SHUFFLE is not invertible)
      const success = game.undoLastCommand();
      expect(success).toBe(false);
    });
  });

  describe('undoCommands', () => {
    it('should undo multiple commands in reverse order', () => {
      const piece = board.create(TestPiece, 'piece', { value: 1 });

      // Execute several commands via game.execute
      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });
      expect(piece.parent).toBe(hand);

      // Execute a SET_ATTRIBUTE
      game.execute({
        type: 'SET_ATTRIBUTE',
        elementId: piece.id,
        attribute: 'value',
        value: 100,
      });
      expect(piece.value).toBe(100);

      // Move back to board
      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: board.id,
      });
      expect(piece.parent).toBe(board);

      // Now undo all 3 commands
      const success = game.undoCommands(3);
      expect(success).toBe(true);

      // Should be back to original state: piece on board with value 1
      expect(piece.parent).toBe(board);
      expect(piece.value).toBe(1);
    });

    it('should stop and return false if a non-invertible command is encountered', () => {
      const piece = board.create(TestPiece, 'piece', { value: 1 });

      // First, a MOVE (invertible)
      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });

      // Then a SHUFFLE (not invertible)
      game.execute({
        type: 'SHUFFLE',
        spaceId: hand.id,
      });

      // Then another MOVE (invertible)
      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: board.id,
      });

      // Try to undo all 3 - should fail after the first undo (which was the last MOVE)
      // because it hits SHUFFLE next
      const success = game.undoCommands(3);
      expect(success).toBe(false);

      // The last MOVE should have been undone, so piece is back in hand
      expect(piece.parent).toBe(hand);
    });

    it('should handle undoing more commands than exist', () => {
      const piece = board.create(TestPiece, 'piece', { value: 1 });

      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });

      // Try to undo 100 commands when only 1 exists
      const success = game.undoCommands(100);
      expect(success).toBe(false);

      // The one move should have been undone
      expect(piece.parent).toBe(board);
    });
  });

  describe('history management', () => {
    it('should remove command from history after successful undo', () => {
      const piece = board.create(TestPiece, 'piece', { value: 1 });
      const historyLengthBefore = game.commandHistory.length;

      game.execute({
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });
      expect(game.commandHistory.length).toBe(historyLengthBefore + 1);

      game.undoLastCommand();
      expect(game.commandHistory.length).toBe(historyLengthBefore);
    });

    it('should not remove command from history on failed undo', () => {
      board.createMany(3, TestPiece, 'piece', (i) => ({ value: i }));

      game.execute({
        type: 'SHUFFLE',
        spaceId: board.id,
      });

      const historyLengthBefore = game.commandHistory.length;

      const success = game.undoLastCommand();
      expect(success).toBe(false);
      expect(game.commandHistory.length).toBe(historyLengthBefore);
    });
  });
});
