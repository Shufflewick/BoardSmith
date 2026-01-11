import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckpointManager } from '../src/checkpoint-manager.js';
import {
  Game,
  Space,
  Piece,
  Player,
  createCheckpoint,
  type DevCheckpoint,
} from '@boardsmith/engine';

// ============================================
// Test Game Classes
// ============================================

class TestGame extends Game<TestGame, Player> {
  board!: TestBoard;
  turnCount: number = 0;

  setup() {
    this.registerElements([TestBoard, TestCard]);
    this.board = this.create(TestBoard, 'board');
  }
}

class TestBoard extends Space<TestGame> {}

class TestCard extends Piece<TestGame> {
  suit!: string;
  rank!: number;
}

// ============================================
// Tests
// ============================================

describe('CheckpointManager', () => {
  let manager: CheckpointManager<TestGame>;
  let game: TestGame;

  beforeEach(() => {
    manager = new CheckpointManager<TestGame>({ interval: 5, maxCheckpoints: 3 });
    game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
    game.setup();
  });

  describe('shouldCheckpoint', () => {
    it('should return false for action index 0', () => {
      expect(manager.shouldCheckpoint(0)).toBe(false);
    });

    it('should return false for negative action index', () => {
      expect(manager.shouldCheckpoint(-1)).toBe(false);
    });

    it('should return true at interval boundaries', () => {
      expect(manager.shouldCheckpoint(5)).toBe(true);
      expect(manager.shouldCheckpoint(10)).toBe(true);
      expect(manager.shouldCheckpoint(15)).toBe(true);
    });

    it('should return false between intervals', () => {
      expect(manager.shouldCheckpoint(1)).toBe(false);
      expect(manager.shouldCheckpoint(4)).toBe(false);
      expect(manager.shouldCheckpoint(6)).toBe(false);
      expect(manager.shouldCheckpoint(9)).toBe(false);
    });

    it('should respect custom interval', () => {
      const customManager = new CheckpointManager<TestGame>({ interval: 3 });
      expect(customManager.shouldCheckpoint(3)).toBe(true);
      expect(customManager.shouldCheckpoint(6)).toBe(true);
      expect(customManager.shouldCheckpoint(5)).toBe(false);
    });

    it('should use default interval of 10', () => {
      const defaultManager = new CheckpointManager<TestGame>();
      expect(defaultManager.interval).toBe(10);
      expect(defaultManager.shouldCheckpoint(10)).toBe(true);
      expect(defaultManager.shouldCheckpoint(5)).toBe(false);
    });
  });

  describe('capture', () => {
    it('should store checkpoint at action index', () => {
      // Suppress console.log for cleaner test output
      vi.spyOn(console, 'log').mockImplementation(() => {});

      manager.capture(game, 5);
      expect(manager.size).toBe(1);
    });

    it('should store multiple checkpoints', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      manager.capture(game, 5);
      manager.capture(game, 10);
      expect(manager.size).toBe(2);
    });
  });

  describe('findNearest', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      manager.capture(game, 5);
      manager.capture(game, 10);
      manager.capture(game, 15);
    });

    it('should find exact match', () => {
      const checkpoint = manager.findNearest(10);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.actionIndex).toBe(10);
    });

    it('should find nearest checkpoint before target', () => {
      const checkpoint = manager.findNearest(12);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.actionIndex).toBe(10);
    });

    it('should find checkpoint at target', () => {
      const checkpoint = manager.findNearest(15);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.actionIndex).toBe(15);
    });

    it('should return undefined if no suitable checkpoint', () => {
      const checkpoint = manager.findNearest(3);
      expect(checkpoint).toBeUndefined();
    });

    it('should find earliest checkpoint when no later ones exist', () => {
      const checkpoint = manager.findNearest(6);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.actionIndex).toBe(5);
    });
  });

  describe('pruning', () => {
    it('should prune old checkpoints when over limit', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Manager has maxCheckpoints: 3
      manager.capture(game, 5);
      manager.capture(game, 10);
      manager.capture(game, 15);
      expect(manager.size).toBe(3);

      // Adding 4th should prune oldest
      manager.capture(game, 20);
      expect(manager.size).toBe(3);

      // Oldest (5) should be gone, newest (20) should exist
      expect(manager.findNearest(5)).toBeUndefined();
      expect(manager.findNearest(20)).toBeDefined();
    });

    it('should keep newest checkpoints after pruning', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      manager.capture(game, 5);
      manager.capture(game, 10);
      manager.capture(game, 15);
      manager.capture(game, 20);
      manager.capture(game, 25);

      // Should have 10, 15, 20 or 15, 20, 25 (newest 3)
      const at25 = manager.findNearest(25);
      const at20 = manager.findNearest(20);
      const at15 = manager.findNearest(15);

      expect(at25).toBeDefined();
      expect(at25!.actionIndex).toBe(25);

      expect(at20).toBeDefined();
      expect(at20!.actionIndex).toBe(20);

      expect(at15).toBeDefined();
      expect(at15!.actionIndex).toBe(15);
    });
  });

  describe('clear', () => {
    it('should remove all checkpoints', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      manager.capture(game, 5);
      manager.capture(game, 10);
      expect(manager.size).toBe(2);

      manager.clear();
      expect(manager.size).toBe(0);
    });
  });

  describe('clearAfter', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      manager.capture(game, 5);
      manager.capture(game, 10);
      manager.capture(game, 15);
    });

    it('should clear checkpoints after index', () => {
      manager.clearAfter(7);

      // Only checkpoint at 5 remains
      expect(manager.size).toBe(1);

      // findNearest(5) finds the checkpoint at 5
      expect(manager.findNearest(5)).toBeDefined();
      expect(manager.findNearest(5)!.actionIndex).toBe(5);

      // findNearest(10) finds checkpoint at 5 (nearest before 10)
      expect(manager.findNearest(10)).toBeDefined();
      expect(manager.findNearest(10)!.actionIndex).toBe(5);
    });

    it('should keep checkpoint at exact index', () => {
      manager.clearAfter(10);

      // Checkpoints at 5 and 10 remain
      expect(manager.size).toBe(2);

      expect(manager.findNearest(5)).toBeDefined();
      expect(manager.findNearest(5)!.actionIndex).toBe(5);

      expect(manager.findNearest(10)).toBeDefined();
      expect(manager.findNearest(10)!.actionIndex).toBe(10);

      // findNearest(15) finds checkpoint at 10 (nearest before 15)
      expect(manager.findNearest(15)).toBeDefined();
      expect(manager.findNearest(15)!.actionIndex).toBe(10);
    });

    it('should clear all checkpoints if index is before first', () => {
      manager.clearAfter(2);
      expect(manager.size).toBe(0);
    });

    it('should preserve all checkpoints if index is after last', () => {
      manager.clearAfter(20);
      expect(manager.size).toBe(3);
    });
  });

  describe('integration with createCheckpoint', () => {
    it('should store valid DevCheckpoint', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Add some state
      game.board.createMany(3, TestCard, 'card', (i) => ({
        suit: 'hearts',
        rank: i + 1,
      }));

      manager.capture(game, 5);

      const checkpoint = manager.findNearest(5);
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.actionIndex).toBe(5);
      expect(checkpoint!.actionCount).toBe(5);
      expect(checkpoint!.elements).toBeDefined();
      expect(checkpoint!.elements.className).toBe('TestGame');
    });
  });
});
