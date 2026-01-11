import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  captureDevState,
  restoreDevState,
  validateDevSnapshot,
  getSnapshotElementCount,
  createCheckpoint,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  Action,
} from '../src/index.js';
import type { DevSnapshot } from '../src/index.js';

// ============================================
// Test Game Classes
// ============================================

class TestGame extends Game<TestGame, Player> {
  board!: TestBoard;

  setup() {
    this.registerElements([TestBoard, TestCard, TestPiece]);
    this.board = this.create(TestBoard, 'board');
  }
}

class TestBoard extends Space<TestGame> {}

class TestCard extends Piece<TestGame> {
  suit!: string;
  rank!: number;
  faceUp: boolean = false;

  // Getter - should NOT be in snapshot, will recompute with new code
  get displayName(): string {
    return `${this.rank} of ${this.suit}`;
  }
}

class TestPiece extends Piece<TestGame> {
  health: number = 10;
  position: { x: number; y: number } = { x: 0, y: 0 };
}

// Game with flow for testing flow position restoration
class FlowGame extends Game<FlowGame, Player> {
  board!: TestBoard;
  turnCount: number = 0;

  setup() {
    this.registerElements([TestBoard, TestCard]);
    this.board = this.create(TestBoard, 'board');
    this.board.createMany(5, TestCard, 'card', (i) => ({
      suit: 'hearts',
      rank: i + 1,
    }));
  }

  defineActions() {
    this.registerActions(
      Action.create('takeTurn')
        .execute(() => {
          this.turnCount++;
        })
    );
  }

  defineFlow() {
    this.setFlow(defineFlow({
      root: loop({
        while: () => this.turnCount < 10,
        do: eachPlayer({
          do: actionStep({ actions: ['takeTurn'] }),
        }),
      }),
    }));
  }
}

// ============================================
// Tests
// ============================================

describe('Dev State Transfer', () => {
  describe('captureDevState', () => {
    let game: TestGame;

    beforeEach(() => {
      game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
      game.setup();
    });

    it('should capture element tree correctly', () => {
      // Create some elements
      game.board.createMany(3, TestCard, 'card', (i) => ({
        suit: i % 2 === 0 ? 'hearts' : 'spades',
        rank: i + 1,
      }));

      const snapshot = captureDevState(game);

      expect(snapshot.elements).toBeDefined();
      expect(snapshot.elements.className).toBe('TestGame');
      expect(snapshot.elements.phase).toBe('setup');
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should capture element count correctly', () => {
      game.board.createMany(5, TestCard, 'card', (i) => ({
        suit: 'hearts',
        rank: i + 1,
      }));

      const snapshot = captureDevState(game);
      const count = getSnapshotElementCount(snapshot);

      // 1 (game) + 2 (players) + 1 (board) + 5 (cards) = 9
      expect(count).toBe(9);
    });

    it('should capture registered classes', () => {
      const snapshot = captureDevState(game);

      // The game's class registry includes element classes from registerElements
      expect(snapshot.registeredClasses).toContain('TestBoard');
      expect(snapshot.registeredClasses).toContain('TestCard');
      // Player and base classes are also registered
      expect(snapshot.registeredClasses).toContain('Player');
    });

    it('should capture sequence counter', () => {
      game.board.createMany(10, TestCard, 'card', (i) => ({
        suit: 'hearts',
        rank: i + 1,
      }));

      const snapshot = captureDevState(game);

      // Sequence should be at least number of elements created
      expect(snapshot.sequence).toBeGreaterThanOrEqual(13);
    });

    it('should capture settings including PersistentMap data', () => {
      game.settings.customSetting = 'test-value';
      game.settings.nested = { deep: { value: 42 } };

      const snapshot = captureDevState(game);

      expect(snapshot.elements.settings.customSetting).toBe('test-value');
      expect(snapshot.elements.settings.nested).toEqual({ deep: { value: 42 } });
    });

    it('should capture messages', () => {
      game.message('Game started!');
      game.message('Player {{player}} joined', { player: 'Alice' });

      const snapshot = captureDevState(game);

      expect(snapshot.elements.messages).toHaveLength(2);
      expect(snapshot.elements.messages[0].text).toBe('Game started!');
      expect(snapshot.elements.messages[1].text).toBe('Player {{player}} joined');
    });
  });

  describe('restoreDevState', () => {
    let snapshot: DevSnapshot;
    let classRegistry: Map<string, any>;

    beforeEach(() => {
      const game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
      game.setup();

      // Create some state
      game.board.createMany(3, TestCard, 'card', (i) => ({
        suit: i % 2 === 0 ? 'hearts' : 'spades',
        rank: i + 1,
        faceUp: i === 0,
      }));

      game.settings.customSetting = 'restored-value';
      game.message('Test message');

      snapshot = captureDevState(game);

      classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('TestBoard', TestBoard);
      classRegistry.set('TestCard', TestCard);
      classRegistry.set('TestPiece', TestPiece);
      classRegistry.set('Player', Player);
    });

    it('should recreate game with same element count', () => {
      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      expect(restored.all(TestCard).length).toBe(3);
      expect(restored.all(Player).length).toBe(2);
      expect(restored.first(TestBoard)).toBeDefined();
    });

    it('should preserve element IDs', () => {
      const originalCardIds = snapshot.elements.children
        ?.find(c => c.name === 'board')
        ?.children?.map(c => c.id) ?? [];

      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      const restoredCardIds = restored.all(TestCard).map(c => c.id);

      expect(restoredCardIds).toEqual(originalCardIds);
    });

    it('should preserve stored properties', () => {
      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      const cards = restored.all(TestCard);
      const heartsCards = cards.filter(c => c.suit === 'hearts');
      const spadesCards = cards.filter(c => c.suit === 'spades');

      expect(heartsCards.length).toBe(2);
      expect(spadesCards.length).toBe(1);

      // Check faceUp is preserved
      const faceUpCard = cards.find(c => c.faceUp);
      expect(faceUpCard).toBeDefined();
      expect(faceUpCard?.rank).toBe(1);
    });

    it('should restore settings', () => {
      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      expect(restored.settings.customSetting).toBe('restored-value');
    });

    it('should restore messages', () => {
      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      expect(restored.messages).toHaveLength(1);
      expect(restored.messages[0].text).toBe('Test message');
    });

    it('should restore game phase', () => {
      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
        classRegistry,
      });

      expect(restored.phase).toBe('setup');
    });
  });

  describe('Getters recompute with new logic', () => {
    it('should NOT include getters in snapshot attributes', () => {
      const game = new TestGame({ playerCount: 2 });
      game.setup();

      // Create a card with getter
      const card = game.board.create(TestCard, 'ace', {
        suit: 'hearts',
        rank: 14,
        faceUp: true,
      });

      // Verify getter works
      expect(card.displayName).toBe('14 of hearts');

      // Capture snapshot
      const snapshot = captureDevState(game);

      // Find the card in the snapshot
      const boardJson = snapshot.elements.children?.find(c => c.name === 'board');
      const cardJson = boardJson?.children?.find(c => c.name === 'ace');

      // Getter should NOT be in attributes
      expect(cardJson?.attributes.displayName).toBeUndefined();

      // Stored properties should be there
      expect(cardJson?.attributes.suit).toBe('hearts');
      expect(cardJson?.attributes.rank).toBe(14);
      expect(cardJson?.attributes.faceUp).toBe(true);
    });
  });

  describe('Round-trip preserves state', () => {
    it('should preserve complete game state through capture/restore', () => {
      // Create a game with complex state
      const game = new TestGame({ playerCount: 3, playerNames: ['Alice', 'Bob', 'Charlie'] });
      game.setup();

      // Add various elements
      game.board.createMany(5, TestCard, 'card', (i) => ({
        suit: ['hearts', 'spades', 'diamonds', 'clubs', 'hearts'][i],
        rank: i + 1,
        faceUp: i % 2 === 0,
      }));

      game.board.create(TestPiece, 'piece', {
        health: 25,
        position: { x: 5, y: 10 },
      });

      // Set up game state
      game.phase = 'started';
      game.settings.round = 3;
      game.settings.scores = { 1: 100, 2: 75, 3: 50 };
      game.message('Round 3 started');

      // Capture and restore
      const snapshot = captureDevState(game);

      const classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('TestBoard', TestBoard);
      classRegistry.set('TestCard', TestCard);
      classRegistry.set('TestPiece', TestPiece);
      classRegistry.set('Player', Player);

      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 3, playerNames: ['Alice', 'Bob', 'Charlie'] },
        classRegistry,
      });

      // Verify everything was preserved
      expect(restored.all(TestCard).length).toBe(5);
      expect(restored.all(TestPiece).length).toBe(1);
      expect(restored.all(Player).length).toBe(3);

      expect(restored.phase).toBe('started');
      expect(restored.settings.round).toBe(3);
      expect(restored.settings.scores).toEqual({ 1: 100, 2: 75, 3: 50 });
      expect(restored.messages).toHaveLength(1);

      // Verify nested object properties
      const piece = restored.first(TestPiece)!;
      expect(piece.health).toBe(25);
      expect(piece.position).toEqual({ x: 5, y: 10 });

      // Verify card properties
      const hearts = restored.all(TestCard, { suit: 'hearts' });
      expect(hearts.length).toBe(2);
    });
  });

  describe('validateDevSnapshot', () => {
    it('should validate when all classes are registered', () => {
      const game = new TestGame({ playerCount: 2 });
      game.setup();

      const snapshot = captureDevState(game);

      const classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('TestBoard', TestBoard);
      classRegistry.set('TestCard', TestCard);
      classRegistry.set('TestPiece', TestPiece);
      classRegistry.set('Player', Player);
      classRegistry.set('Space', Space);

      const result = validateDevSnapshot(snapshot, classRegistry);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report missing classes', () => {
      const game = new TestGame({ playerCount: 2 });
      game.setup();
      game.board.create(TestCard, 'card', { suit: 'hearts', rank: 1 });

      const snapshot = captureDevState(game);

      // Registry missing TestCard
      const classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('TestBoard', TestBoard);
      classRegistry.set('Player', Player);

      const result = validateDevSnapshot(snapshot, classRegistry);

      expect(result.valid).toBe(false);
      // Find missing-class errors
      const missingClassErrors = result.errors.filter(e => e.type === 'missing-class');
      expect(missingClassErrors.length).toBeGreaterThan(0);
      expect(missingClassErrors.some(e => e.message.includes('TestCard'))).toBe(true);
    });
  });

  describe('Flow position restoration', () => {
    it('should capture flow position when game has flow', () => {
      const game = new FlowGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
      game.setup();
      game.defineActions();
      game.defineFlow();

      // Start the flow
      game.startFlow();

      // Take some actions to advance flow
      const flowState = game.getFlowState();
      expect(flowState?.awaitingInput).toBe(true);

      const snapshot = captureDevState(game);

      // Flow position should be captured
      expect(snapshot.flowPosition).toBeDefined();
      expect(snapshot.flowState).toBeDefined();
    });

    it('should have undefined flow position when no flow', () => {
      const game = new TestGame({ playerCount: 2 });
      game.setup();

      const snapshot = captureDevState(game);

      // No flow defined
      expect(snapshot.flowPosition).toBeUndefined();
      expect(snapshot.flowState).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty game', () => {
      const game = new TestGame({ playerCount: 2 });
      // Don't call setup - minimal game

      const snapshot = captureDevState(game);

      expect(snapshot.elements.children?.length).toBe(2); // Just players

      const classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('Player', Player);

      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2 },
        classRegistry,
      });

      expect(restored.all(Player).length).toBe(2);
    });

    it('should handle deeply nested elements', () => {
      // Create nested structure
      class Container extends Space<TestGame> {}

      const game = new TestGame({ playerCount: 2 });
      game._ctx.classRegistry.set('Container', Container);

      const level1 = game.create(Container, 'level1');
      const level2 = level1.create(Container, 'level2');
      const level3 = level2.create(Container, 'level3');
      level3.create(TestCard, 'deep-card', { suit: 'hearts', rank: 1 });

      const snapshot = captureDevState(game);

      const classRegistry = new Map();
      classRegistry.set('TestGame', TestGame);
      classRegistry.set('Container', Container);
      classRegistry.set('TestCard', TestCard);
      classRegistry.set('Player', Player);

      const restored = restoreDevState(snapshot, TestGame, {
        gameOptions: { playerCount: 2 },
        classRegistry,
      });

      // Verify nested structure is preserved
      const restoredLevel1 = restored.first({ name: 'level1' })!;
      const restoredLevel2 = restoredLevel1.first({ name: 'level2' })!;
      const restoredLevel3 = restoredLevel2.first({ name: 'level3' })!;
      const restoredCard = restoredLevel3.first(TestCard)!;

      expect(restoredCard.suit).toBe('hearts');
      expect(restoredCard.rank).toBe(1);
    });
  });

  describe('Checkpoints', () => {
    it('should create checkpoint with action index', () => {
      const game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
      game.setup();
      game.board.createMany(3, TestCard, 'card', (i) => ({
        suit: 'hearts',
        rank: i + 1,
      }));

      const checkpoint = createCheckpoint(game, 5);

      expect(checkpoint.actionIndex).toBe(5);
      expect(checkpoint.actionCount).toBe(5);
      expect(checkpoint.elements).toBeDefined();
      expect(checkpoint.elements.className).toBe('TestGame');
    });

    it('should create checkpoint that extends DevSnapshot', () => {
      const game = new TestGame({ playerCount: 2 });
      game.setup();
      game.settings.testValue = 42;

      const checkpoint = createCheckpoint(game, 10);

      // Checkpoint should have all DevSnapshot properties
      expect(checkpoint.timestamp).toBeLessThanOrEqual(Date.now());
      expect(checkpoint.registeredClasses).toContain('TestBoard');
      expect(checkpoint.sequence).toBeGreaterThan(0);
      expect(checkpoint.elements.settings.testValue).toBe(42);

      // Plus checkpoint-specific properties
      expect(checkpoint.actionIndex).toBe(10);
      expect(checkpoint.actionCount).toBe(10);
    });
  });
});
