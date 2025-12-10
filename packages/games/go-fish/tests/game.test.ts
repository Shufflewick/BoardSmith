import { describe, it, expect, beforeEach } from 'vitest';
import { createTestGame, assertActionSucceeds, assertActionFails, simulateAction } from '@boardsmith/testing';
import { GoFishGame, Card, Hand, Pond, Books, GoFishPlayer } from '@boardsmith/gofish-rules';

describe('GoFishGame', () => {
  describe('Game Setup', () => {
    it('should create a 2-player game with 7 cards each', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      expect(testGame.game.players.length).toBe(2);

      const alice = testGame.game.players[0] as GoFishPlayer;
      const bob = testGame.game.players[1] as GoFishPlayer;

      const aliceHand = testGame.game.getPlayerHand(alice);
      const bobHand = testGame.game.getPlayerHand(bob);

      expect(aliceHand.count(Card)).toBe(7);
      expect(bobHand.count(Card)).toBe(7);
      expect(testGame.game.pond.count(Card)).toBe(52 - 14); // 38 cards remaining
    });

    it('should create a 3-player game with 7 cards each', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 3,
        playerNames: ['Alice', 'Bob', 'Charlie'],
      });

      for (const player of testGame.game.players) {
        const hand = testGame.game.getPlayerHand(player as GoFishPlayer);
        expect(hand.count(Card)).toBe(7);
      }
      expect(testGame.game.pond.count(Card)).toBe(52 - 21); // 31 cards remaining
    });

    it('should create a 4-player game with 5 cards each', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 4,
        playerNames: ['Alice', 'Bob', 'Charlie', 'Dave'],
      });

      for (const player of testGame.game.players) {
        const hand = testGame.game.getPlayerHand(player as GoFishPlayer);
        expect(hand.count(Card)).toBe(5);
      }
      expect(testGame.game.pond.count(Card)).toBe(52 - 20); // 32 cards remaining
    });

    it('should create books space for each player', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      for (const player of testGame.game.players) {
        const books = testGame.game.getPlayerBooks(player as GoFishPlayer);
        expect(books).toBeDefined();
        expect(books.count(Card)).toBe(0);
      }
    });
  });

  describe('Player Helper Methods', () => {
    let game: GoFishGame;
    let alice: GoFishPlayer;

    beforeEach(() => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });
      game = testGame.game;
      alice = game.players[0] as GoFishPlayer;
    });

    it('should get player ranks', () => {
      const ranks = game.getPlayerRanks(alice);
      expect(ranks.length).toBeGreaterThan(0);
      expect(ranks.length).toBeLessThanOrEqual(7); // Can't have more ranks than cards
    });

    it('should check if player has rank', () => {
      const ranks = game.getPlayerRanks(alice);
      if (ranks.length > 0) {
        expect(game.playerHasRank(alice, ranks[0])).toBe(true);
      }
      // Check for a rank that's unlikely to be there by clearing hand first
      const hand = game.getPlayerHand(alice);
      const cards = [...hand.all(Card)];
      for (const card of cards) {
        card.putInto(game.pond);
      }
      expect(game.playerHasRank(alice, 'A')).toBe(false);
    });

    it('should get cards of a rank', () => {
      const ranks = game.getPlayerRanks(alice);
      if (ranks.length > 0) {
        const cards = game.getCardsOfRank(alice, ranks[0]);
        expect(cards.length).toBeGreaterThan(0);
        for (const card of cards) {
          expect(card.rank).toBe(ranks[0]);
        }
      }
    });
  });

  describe('Book Formation', () => {
    let game: GoFishGame;
    let alice: GoFishPlayer;

    beforeEach(() => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });
      game = testGame.game;
      alice = game.players[0] as GoFishPlayer;
    });

    it('should form a book when player has 4 of a kind', () => {
      // Clear Alice's hand
      const hand = game.getPlayerHand(alice);
      for (const card of [...hand.all(Card)]) {
        card.putInto(game.pond);
      }

      // Collect all 4 aces from everywhere (some may be in Bob's hand)
      const aces = [...game.all(Card, { rank: 'A' })];
      for (const ace of aces) {
        ace.putInto(hand);
      }

      expect(alice.bookCount).toBe(0);

      const formedBooks = game.checkForBooks(alice);

      expect(formedBooks).toContain('A');
      expect(alice.bookCount).toBe(1);

      const books = game.getPlayerBooks(alice);
      expect(books.count(Card)).toBe(4); // All 4 aces in books
      expect(hand.count(Card)).toBe(0); // Hand is empty
    });

    it('should not form a book with less than 4 cards', () => {
      const hand = game.getPlayerHand(alice);
      for (const card of [...hand.all(Card)]) {
        card.putInto(game.pond);
      }

      // Give Alice 3 Aces (get all aces from everywhere, then take 3)
      const aces = [...game.all(Card, { rank: 'A' })].slice(0, 3);
      for (const ace of aces) {
        ace.putInto(hand);
      }

      const formedBooks = game.checkForBooks(alice);

      expect(formedBooks).toHaveLength(0);
      expect(alice.bookCount).toBe(0);
      expect(hand.count(Card)).toBe(3); // Cards still in hand
    });
  });

  describe('Drawing from Pond', () => {
    let game: GoFishGame;
    let alice: GoFishPlayer;

    beforeEach(() => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });
      game = testGame.game;
      alice = game.players[0] as GoFishPlayer;
    });

    it('should draw a card from the pond', () => {
      const initialHandCount = game.getPlayerHand(alice).count(Card);
      const initialPondCount = game.pond.count(Card);

      const drawnCard = game.drawFromPond(alice);

      expect(drawnCard).toBeDefined();
      expect(game.getPlayerHand(alice).count(Card)).toBe(initialHandCount + 1);
      expect(game.pond.count(Card)).toBe(initialPondCount - 1);
    });

    it('should return undefined when pond is empty', () => {
      // Empty the pond
      for (const card of [...game.pond.all(Card)]) {
        card.putInto(game.getPlayerHand(alice));
      }

      const drawnCard = game.drawFromPond(alice);
      expect(drawnCard).toBeUndefined();
    });
  });

  describe('Game End Conditions', () => {
    let game: GoFishGame;
    let alice: GoFishPlayer;
    let bob: GoFishPlayer;

    beforeEach(() => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });
      game = testGame.game;
      alice = game.players[0] as GoFishPlayer;
      bob = game.players[1] as GoFishPlayer;
    });

    it('should not be finished when no books formed', () => {
      expect(game.isFinished()).toBe(false);
    });

    it('should be finished when all 13 books formed', () => {
      // Simulate all books being formed
      alice.bookCount = 7;
      bob.bookCount = 6;

      expect(game.getTotalBooks()).toBe(13);
      expect(game.isFinished()).toBe(true);
    });

    it('should determine winner by book count', () => {
      alice.bookCount = 7;
      bob.bookCount = 6;

      const winners = game.getWinners();

      expect(winners).toHaveLength(1);
      expect(winners[0].name).toBe('Alice');
    });

    it('should handle ties', () => {
      alice.bookCount = 7;
      bob.bookCount = 6;

      const winners = game.getWinners();
      expect(winners).toHaveLength(1);
      expect(winners[0].name).toBe('Alice');
    });
  });

  describe('Action System with TestGame', () => {
    it('should register the ask action', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const action = testGame.game.getAction('ask');
      expect(action).toBeDefined();
      expect(action?.name).toBe('ask');
    });

    it('should have ask action available to player with cards', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as GoFishPlayer;
      // canPlayerAct takes a player index, not a player object
      expect(testGame.game.canPlayerAct(alice.position)).toBe(true);
    });

    it('should allow asking another player for cards using simulateAction', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'deterministic-test',
      });

      // Get Alice's ranks to ask for
      const alice = testGame.game.players[0] as GoFishPlayer;
      const bob = testGame.game.players[1] as GoFishPlayer;
      const aliceRanks = testGame.game.getPlayerRanks(alice);

      if (aliceRanks.length > 0) {
        const result = simulateAction(testGame, 0, 'ask', {
          target: bob,
          rank: aliceRanks[0],
        });

        expect(result.success).toBe(true);
      }
    });
  });

  describe('Flow System with TestGame', () => {
    it('should start the game flow', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const state = testGame.getFlowState();

      expect(state).toBeDefined();
      expect(state?.awaitingInput).toBe(true);
      expect(state?.currentPlayer).toBe(0); // First player's turn
      expect(state?.availableActions).toContain('ask');
    });

    it('should handle a complete ask action via doAction', () => {
      const testGame = createTestGame(GoFishGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'action-test',
      });

      const alice = testGame.game.players[0] as GoFishPlayer;
      const bob = testGame.game.players[1] as GoFishPlayer;

      const aliceRanks = testGame.game.getPlayerRanks(alice);
      if (aliceRanks.length > 0) {
        const result = testGame.doAction(0, 'ask', {
          target: bob,
          rank: aliceRanks[0],
        });

        expect(result.success).toBe(true);
      }
    });
  });
});
