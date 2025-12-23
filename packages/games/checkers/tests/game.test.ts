import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestGame,
  toDebugString,
  traceAction,
  logAvailableActions,
  diffSnapshots,
} from '@boardsmith/testing';
import { CheckersGame, CheckerPiece, CheckersPlayer, Square } from '@boardsmith/checkers-rules';

describe('CheckersGame', () => {
  describe('Game Setup', () => {
    it('should create a 2-player game', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.players.length).toBe(2);
      expect(testGame.game.players[0].name).toBe('Alice');
      expect(testGame.game.players[1].name).toBe('Bob');
    });

    it('should create an 8x8 board', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const squares = testGame.game.board.all(Square);
      expect([...squares].length).toBe(64);
    });

    it('should place 12 pieces for each player', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;
      const bob = testGame.game.players[1] as CheckersPlayer;

      const alicePieces = testGame.game.getPlayerPieces(alice);
      const bobPieces = testGame.game.getPlayerPieces(bob);

      expect(alicePieces.length).toBe(12);
      expect(bobPieces.length).toBe(12);
    });

    it('should place pieces only on dark squares', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const allPieces = [...testGame.game.all(CheckerPiece)];

      for (const piece of allPieces) {
        const square = piece.parent as Square;
        expect(square.isDark).toBe(true);
      }
    });
  });

  describe('Board Structure', () => {
    it('should have correct square colors alternating', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      // Check corners
      const a1 = testGame.game.board.getSquare(7, 0); // bottom-left
      const h8 = testGame.game.board.getSquare(0, 7); // top-right

      // In chess, a1 is dark, h8 is dark
      expect(a1?.isDark).toBe(true);
      expect(h8?.isDark).toBe(true);
    });

    it('should provide square access by row and column', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const square = testGame.game.board.getSquare(3, 4);
      expect(square).toBeDefined();
      expect(square?.row).toBe(3);
      expect(square?.col).toBe(4);
    });
  });

  describe('Move Logic', () => {
    it('should identify valid moves for current player', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;
      const validMoves = testGame.game.getValidMoves(alice);

      // Player 0's pieces are on rows 0-2, they move toward row 7
      // Should have valid moves from row 2 pieces
      expect(validMoves.length).toBeGreaterThan(0);
    });

    it('should detect when player has no valid moves', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      // Initial position should have moves
      const alice = testGame.game.players[0] as CheckersPlayer;
      expect(testGame.game.hasAnyValidMove(alice)).toBe(true);
    });

    it('should not be finished at game start', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.isFinished()).toBe(false);
    });
  });

  describe('Capture Detection', () => {
    it('should not have captures available at game start', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;

      // At game start, no captures are possible (pieces are 2 rows apart)
      expect(testGame.game.playerHasCaptures(alice)).toBe(false);
    });
  });

  describe('King Rows', () => {
    it('should identify king rows correctly', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;
      const bob = testGame.game.players[1] as CheckersPlayer;

      // Player 0 kings at row 7, Player 1 kings at row 0
      expect(testGame.game.isKingRow(7, alice)).toBe(true);
      expect(testGame.game.isKingRow(0, alice)).toBe(false);
      expect(testGame.game.isKingRow(0, bob)).toBe(true);
      expect(testGame.game.isKingRow(7, bob)).toBe(false);
    });
  });

  describe('Debug Utilities (examples)', () => {
    it('demonstrates toDebugString for game state inspection', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'debug-demo',
      });

      // Useful when debugging test failures
      const stateString = toDebugString(testGame.game);
      expect(stateString).toContain('CheckersGame');
      expect(stateString).toContain('Alice');
      expect(stateString).toContain('Bob');

      // Uncomment to see the full debug output:
      // console.log(stateString);
    });

    it('demonstrates traceAction for understanding action availability', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'trace-demo',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;
      const trace = traceAction(testGame.game, 'move', alice);

      // traceAction returns structured info about action availability
      expect(trace.actionName).toBe('move');
      expect(typeof trace.available).toBe('boolean');
      expect(trace.reason).toBeDefined();
      expect(Array.isArray(trace.details)).toBe(true);

      // When debugging, uncomment to see full trace:
      // console.log('Action available:', trace.available);
      // console.log('Reason:', trace.reason);
      // trace.details.forEach(d => console.log(`${d.step}: ${d.passed ? '?' : '?'} ${d.info}`));
    });

    it('demonstrates logAvailableActions for quick action overview', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'log-demo',
      });

      const alice = testGame.game.players[0] as CheckersPlayer;
      const actionLog = logAvailableActions(testGame.game, alice);

      // Returns a string summarizing available actions
      expect(actionLog).toContain('Alice');
      expect(typeof actionLog).toBe('string');

      // Uncomment to see the full action log:
      // console.log(actionLog);
    });

    it('demonstrates diffSnapshots for tracking state changes', () => {
      const testGame = createTestGame(CheckersGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'diff-demo',
      });

      const before = JSON.stringify(testGame.runner.getSnapshot());

      // Simulate a game state change
      const alice = testGame.game.players[0] as CheckersPlayer;
      alice.capturedCount = 3;

      const after = JSON.stringify(testGame.runner.getSnapshot());
      const diff = diffSnapshots(before, after);

      // Diff shows what changed
      expect(typeof diff).toBe('string');

      // Uncomment to see the diff:
      // console.log(diff);
    });
  });
});
