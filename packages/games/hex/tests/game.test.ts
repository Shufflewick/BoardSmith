import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestGame,
  toDebugString,
  traceAction,
  logAvailableActions,
  diffSnapshots,
} from '@boardsmith/testing';
import { HexGame, Cell, Stone, HexPlayer, Board } from '@boardsmith/hex-rules';

describe('HexGame', () => {
  describe('Game Setup', () => {
    it('should create a 2-player game', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.players.length).toBe(2);
      expect(testGame.game.players[0].name).toBe('Alice');
      expect(testGame.game.players[1].name).toBe('Bob');
    });

    it('should create a board with default size 7', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.boardSize).toBe(7);
      const cells = [...testGame.game.board.all(Cell)];
      expect(cells.length).toBe(49); // 7x7 = 49 cells
    });

    it('should have board size accessible', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      // Default size is 7
      expect(testGame.game.boardSize).toBe(7);
      const cells = [...testGame.game.board.all(Cell)];
      expect(cells.length).toBe(49); // 7x7 = 49 cells
    });

    it('should start with empty board', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const stones = [...testGame.game.all(Stone)];
      expect(stones.length).toBe(0);
    });
  });

  describe('Board Structure', () => {
    it('should provide cell access by axial coordinates', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const cell = testGame.game.board.getCell(3, 4);
      expect(cell).toBeDefined();
      expect(cell?.q).toBe(3);
      expect(cell?.r).toBe(4);
    });

    it('should return undefined for out-of-bounds cells', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const cell = testGame.game.board.getCell(10, 10);
      expect(cell).toBeUndefined();
    });

    it('should get all empty cells at game start', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const emptyCells = testGame.game.board.getEmptyCells();
      expect(emptyCells.length).toBe(49); // All cells empty at start
    });

    it('should identify cell neighbors correctly', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      // Center cell should have 6 neighbors
      const centerCell = testGame.game.board.getCell(3, 3);
      expect(centerCell).toBeDefined();

      const neighbors = testGame.game.board.getNeighbors(centerCell!);
      expect(neighbors.length).toBe(6);

      // Corner cell should have fewer neighbors
      const cornerCell = testGame.game.board.getCell(0, 0);
      const cornerNeighbors = testGame.game.board.getNeighbors(cornerCell!);
      expect(cornerNeighbors.length).toBeLessThan(6);
    });
  });

  describe('Edge Detection', () => {
    it('should identify Red start edge (r=0)', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const topCell = testGame.game.board.getCell(3, 0);
      expect(topCell?.isRedStartEdge()).toBe(true);

      const midCell = testGame.game.board.getCell(3, 3);
      expect(midCell?.isRedStartEdge()).toBe(false);
    });

    it('should identify Red goal edge (r=size-1)', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const bottomCell = testGame.game.board.getCell(3, 6);
      expect(bottomCell?.isRedGoalEdge(7)).toBe(true);

      const midCell = testGame.game.board.getCell(3, 3);
      expect(midCell?.isRedGoalEdge(7)).toBe(false);
    });

    it('should identify Blue start edge (q=0)', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const leftCell = testGame.game.board.getCell(0, 3);
      expect(leftCell?.isBlueStartEdge()).toBe(true);

      const midCell = testGame.game.board.getCell(3, 3);
      expect(midCell?.isBlueStartEdge()).toBe(false);
    });

    it('should identify Blue goal edge (q=size-1)', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const rightCell = testGame.game.board.getCell(6, 3);
      expect(rightCell?.isBlueGoalEdge(7)).toBe(true);

      const midCell = testGame.game.board.getCell(3, 3);
      expect(midCell?.isBlueGoalEdge(7)).toBe(false);
    });
  });

  describe('Game State', () => {
    it('should not be finished at game start', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.isFinished()).toBe(false);
    });

    it('should have no winners at game start', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.getWinners()).toEqual([]);
    });
  });

  describe('Win Detection', () => {
    it('should detect no win with empty board', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as HexPlayer;
      const bob = testGame.game.players[1] as HexPlayer;

      expect(testGame.game.board.checkWin(alice)).toBe(false);
      expect(testGame.game.board.checkWin(bob)).toBe(false);
    });
  });

  describe('Debug Utilities (examples)', () => {
    it('demonstrates toDebugString for game state inspection', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'debug-demo',
      });

      // Useful when debugging test failures
      const stateString = toDebugString(testGame.game);
      expect(stateString).toContain('HexGame');
      expect(stateString).toContain('Alice');
      expect(stateString).toContain('Bob');

      // Uncomment to see the full debug output:
      // console.log(stateString);
    });

    it('demonstrates traceAction for understanding action availability', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'trace-demo',
      });

      const alice = testGame.game.players[0] as HexPlayer;
      const trace = traceAction(testGame.game, 'placeStone', alice);

      // traceAction returns structured info about action availability
      expect(trace.actionName).toBe('placeStone');
      expect(typeof trace.available).toBe('boolean');
      expect(trace.reason).toBeDefined();
      expect(Array.isArray(trace.details)).toBe(true);

      // When debugging, uncomment to see full trace:
      // console.log('Action available:', trace.available);
      // console.log('Reason:', trace.reason);
      // trace.details.forEach(d => console.log(`${d.step}: ${d.passed ? '?' : '?'} ${d.info}`));
    });

    it('demonstrates logAvailableActions for quick action overview', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'log-demo',
      });

      const alice = testGame.game.players[0] as HexPlayer;
      const actionLog = logAvailableActions(testGame.game, alice);

      // Returns a string summarizing available actions
      expect(actionLog).toContain('Alice');
      expect(typeof actionLog).toBe('string');

      // Uncomment to see the full action log:
      // console.log(actionLog);
    });

    it('demonstrates diffSnapshots for tracking state changes', () => {
      const testGame = createTestGame(HexGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'diff-demo',
      });

      const before = JSON.stringify(testGame.runner.getSnapshot());

      // Simulate a game state change
      const alice = testGame.game.players[0] as HexPlayer;
      alice.stonesPlaced = 5;

      const after = JSON.stringify(testGame.runner.getSnapshot());
      const diff = diffSnapshots(before, after);

      // Diff shows what changed
      expect(typeof diff).toBe('string');

      // Uncomment to see the diff:
      // console.log(diff);
    });
  });
});
