import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTestGame,
  toDebugString,
  traceAction,
  logAvailableActions,
  diffSnapshots,
} from '@boardsmith/testing';
import { Player } from '@boardsmith/engine';
import {
  PolyPotionsGame,
  IngredientDie,
  IngredientShelf,
  PolyPotionsPlayer,
  INGREDIENT_TRACK_CONFIG,
  DISTILLATION_POINTS,
  FULMINATE_POINTS,
} from '@boardsmith/polyhedral-potions-rules';

describe('PolyPotionsGame', () => {
  describe('Game Setup', () => {
    it('should create a 2-player game', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect([...testGame.game.all(Player)].length).toBe(2);
      expect(testGame.game.getPlayer(1)!.name).toBe('Alice');
      expect(testGame.game.getPlayer(2)!.name).toBe('Bob');
    });

    it('should support 1-5 players', () => {
      for (let count = 1; count <= 5; count++) {
        const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].slice(0, count);
        const testGame = createTestGame(PolyPotionsGame, {
          playerCount: count,
          playerNames: names,
          seed: 'test-seed',
        });

        expect([...testGame.game.all(Player)].length).toBe(count);
      }
    });

    it('should create an ingredient shelf with 7 dice', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.shelf).toBeDefined();
      const dice = testGame.game.shelf.getDice();
      expect(dice.length).toBe(7);
    });

    it('should have dice of correct types (d4, d6, d8, d10, d10%, d12, d20)', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const dice = testGame.game.shelf.getDice() as IngredientDie[];
      const sidesCounts: Record<number, number> = {};

      for (const die of dice) {
        sidesCounts[die.sides] = (sidesCounts[die.sides] || 0) + 1;
      }

      expect(sidesCounts[4]).toBe(1);  // 1 d4
      expect(sidesCounts[6]).toBe(1);  // 1 d6
      expect(sidesCounts[8]).toBe(1);  // 1 d8
      expect(sidesCounts[10]).toBe(2); // 2 d10s (d10 and d10%)
      expect(sidesCounts[12]).toBe(1); // 1 d12
      expect(sidesCounts[20]).toBe(1); // 1 d20
    });

    it('should roll all dice at game start', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const dice = testGame.game.shelf.getDice() as IngredientDie[];

      for (const die of dice) {
        expect(die.value).toBeGreaterThanOrEqual(1);
        expect(die.value).toBeLessThanOrEqual(die.sides);
        expect(die.drafted).toBe(false);
      }
    });
  });

  describe('Draft Areas', () => {
    it('should create a draft area for each player', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.getPlayer(1)! as PolyPotionsPlayer;
      const bob = testGame.game.getPlayer(2)! as PolyPotionsPlayer;

      const aliceDraft = testGame.game.getPlayerDraftArea(alice);
      const bobDraft = testGame.game.getPlayerDraftArea(bob);

      expect(aliceDraft).toBeDefined();
      expect(bobDraft).toBeDefined();
    });
  });

  describe('Dice Mechanics', () => {
    it('should identify available dice (not drafted)', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const available = testGame.game.getAvailableDice();
      expect(available.length).toBe(7); // All dice available at start
    });

    it('should detect D10 zero-or-ten condition', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const dice = testGame.game.shelf.getDice() as IngredientDie[];
      const d10 = dice.find(d => d.sides === 10);
      expect(d10).toBeDefined();

      // Force value to 10 to test condition
      d10!.value = 10;
      expect(d10!.canBeZeroOrTen).toBe(true);

      d10!.value = 5;
      expect(d10!.canBeZeroOrTen).toBe(false);
    });
  });

  describe('Scoring Configuration', () => {
    it('should have correct ingredient track configuration', () => {
      expect(INGREDIENT_TRACK_CONFIG.d4.boxes).toBe(5);
      expect(INGREDIENT_TRACK_CONFIG.d6.boxes).toBe(5);
      expect(INGREDIENT_TRACK_CONFIG.d8.boxes).toBe(5);
      expect(INGREDIENT_TRACK_CONFIG.d10.boxes).toBe(6);
      expect(INGREDIENT_TRACK_CONFIG.d12.boxes).toBe(6);
      expect(INGREDIENT_TRACK_CONFIG.d20.boxes).toBe(5);
    });

    it('should have correct distillation points grid', () => {
      expect(DISTILLATION_POINTS.length).toBe(4); // 4 columns
      expect(DISTILLATION_POINTS[0].length).toBe(4); // 4+ rows per column
    });

    it('should have fulminate points track', () => {
      expect(FULMINATE_POINTS.length).toBeGreaterThan(0);
      expect(FULMINATE_POINTS[0]).toBe(0); // First position is 0 points
    });
  });

  describe('Game State', () => {
    it('should start at round 1', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.round).toBe(1);
    });

    it('should start with empty draft state', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.draftedDice).toEqual([]);
      expect(testGame.game.draftedValues).toEqual([]);
      expect(testGame.game.craftedValue).toBe(0);
      expect(testGame.game.craftedPoison).toBe(false);
    });

    it('should not be finished at game start', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      expect(testGame.game.isFinished()).toBe(false);
      expect(testGame.game.gameEndTriggered).toBe(false);
    });
  });

  describe('Player State', () => {
    it('should start with 0 stars for each player', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      for (const player of testGame.game.all(Player)) {
        expect((player as PolyPotionsPlayer).stars).toBe(0);
      }
    });

    it('should start with 0 score for each player', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      for (const player of testGame.game.all(Player)) {
        expect((player as PolyPotionsPlayer).score).toBe(0);
      }
    });
  });

  describe('Debug Utilities (examples)', () => {
    it('demonstrates toDebugString for game state inspection', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'debug-demo',
      });

      // Useful when debugging test failures
      const stateString = toDebugString(testGame.game);
      expect(stateString).toContain('PolyPotionsGame');
      expect(stateString).toContain('Alice');
      expect(stateString).toContain('Bob');

      // Uncomment to see the full debug output:
      // console.log(stateString);
    });

    it('demonstrates traceAction for understanding action availability', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'trace-demo',
      });

      const alice = testGame.game.getPlayer(1)! as PolyPotionsPlayer;
      const trace = traceAction(testGame.game, 'draft', alice);

      // traceAction returns structured info about action availability
      expect(trace.actionName).toBe('draft');
      expect(typeof trace.available).toBe('boolean');
      expect(trace.reason).toBeDefined();
      expect(Array.isArray(trace.details)).toBe(true);

      // When debugging, uncomment to see full trace:
      // console.log('Action available:', trace.available);
      // console.log('Reason:', trace.reason);
      // trace.details.forEach(d => console.log(`${d.step}: ${d.passed ? '?' : '?'} ${d.info}`));
    });

    it('demonstrates logAvailableActions for quick action overview', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'log-demo',
      });

      const alice = testGame.game.getPlayer(1)! as PolyPotionsPlayer;
      const actionLog = logAvailableActions(testGame.game, alice);

      // Returns a string summarizing available actions
      expect(actionLog).toContain('Alice');
      expect(typeof actionLog).toBe('string');

      // Uncomment to see the full action log:
      // console.log(actionLog);
    });

    it('demonstrates diffSnapshots for tracking state changes', () => {
      const testGame = createTestGame(PolyPotionsGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'diff-demo',
      });

      const before = JSON.stringify(testGame.runner.getSnapshot());

      // Simulate a game state change
      testGame.game.round = 5;

      const after = JSON.stringify(testGame.runner.getSnapshot());
      const diff = diffSnapshots(before, after);

      // Diff shows what changed
      expect(typeof diff).toBe('string');

      // Uncomment to see the diff:
      // console.log(diff);
    });
  });
});
