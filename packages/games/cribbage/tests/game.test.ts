import { describe, it, expect, beforeEach } from 'vitest';
import { createTestGame } from '@boardsmith/testing';
import { CribbageGame, Card, CribbagePlayer, scoreHand, scoreHandDetailed } from '@boardsmith/cribbage-rules';

describe('CribbageGame', () => {
  describe('GameView Structure', () => {
    it('should include deck with childCount in gameView', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      // Get game view for player 0
      const gameView = testGame.game.toJSONForPlayer(0);

      // Find deck in gameView - search by $type or name (className can be mangled by bundlers)
      const deck = gameView.children?.find(c =>
        (c.attributes as any)?.$type === 'deck' || c.name === 'deck'
      );

      expect(deck).toBeDefined();
      expect(deck?.childCount).toBe(40); // 52 - 12 dealt
      expect(deck?.children).toBeUndefined(); // Children should be hidden
    });
  });

  describe('Game Setup', () => {
    it('should create a 2-player game', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      expect(testGame.game.players.length).toBe(2);
    });

    it('should randomly select first dealer', () => {
      // Run multiple games and verify dealer is sometimes 0 and sometimes 1
      let dealer0Count = 0;
      let dealer1Count = 0;

      for (let i = 0; i < 20; i++) {
        const testGame = createTestGame(CribbageGame, {
          playerCount: 2,
          playerNames: ['Alice', 'Bob'],
          seed: `test-seed-${i}`,
        });

        if (testGame.game.dealerPosition === 0) dealer0Count++;
        else dealer1Count++;
      }

      // With 20 games and random selection, both should have at least 1
      expect(dealer0Count).toBeGreaterThan(0);
      expect(dealer1Count).toBeGreaterThan(0);
    });

    it('should deal 6 cards to each player after startNewRound', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CribbagePlayer;
      const bob = testGame.game.players[1] as CribbagePlayer;

      const aliceHand = testGame.game.getPlayerHand(alice);
      const bobHand = testGame.game.getPlayerHand(bob);

      expect(aliceHand.count(Card)).toBe(6);
      expect(bobHand.count(Card)).toBe(6);
      expect(testGame.game.deck.count(Card)).toBe(40); // 52 - 12 = 40
    });
  });

  describe('Original Hand Cards Tracking', () => {
    it('should store original hand cards after discarding', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CribbagePlayer;
      const bob = testGame.game.players[1] as CribbagePlayer;

      // Get the cards in each hand before discarding
      const aliceHandBefore = [...testGame.game.getPlayerHand(alice).all(Card)];
      const bobHandBefore = [...testGame.game.getPlayerHand(bob).all(Card)];

      // Simulate discarding by moving 2 cards to crib for each player
      aliceHandBefore.slice(0, 2).forEach(c => c.putInto(testGame.game.crib));
      bobHandBefore.slice(0, 2).forEach(c => c.putInto(testGame.game.crib));

      // Now store original hands (this is what the fix does after discard phase)
      testGame.game.storeOriginalHands();

      // Each player should have 4 cards stored
      expect(alice.originalHandCardIds.length).toBe(4);
      expect(bob.originalHandCardIds.length).toBe(4);

      // The stored cards should match the current hand
      const aliceOriginalCards = testGame.game.getOriginalHandCards(alice);
      const bobOriginalCards = testGame.game.getOriginalHandCards(bob);

      expect(aliceOriginalCards.length).toBe(4);
      expect(bobOriginalCards.length).toBe(4);
    });

    it('should retrieve original hand cards even after they are played', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'test-seed',
      });

      const alice = testGame.game.players[0] as CribbagePlayer;

      // Simulate discarding
      const aliceHand = testGame.game.getPlayerHand(alice);
      const cards = [...aliceHand.all(Card)];
      cards.slice(0, 2).forEach(c => c.putInto(testGame.game.crib));

      // Store original hands
      testGame.game.storeOriginalHands();

      // Get the original card IDs
      const originalIds = [...alice.originalHandCardIds];

      // Now simulate playing all cards to the play area
      const remainingCards = [...aliceHand.all(Card)];
      for (const card of remainingCards) {
        card.putInto(testGame.game.playArea);
      }

      // Hand should be empty now
      expect(aliceHand.count(Card)).toBe(0);

      // But we should still be able to get the original cards
      const originalCards = testGame.game.getOriginalHandCards(alice);
      expect(originalCards.length).toBe(4);

      // And they should match the original IDs
      const retrievedIds = originalCards.map(c => c.name);
      expect(retrievedIds.sort()).toEqual(originalIds.sort());
    });
  });

  describe('Scoring with Original Hand Cards', () => {
    it('should score player hand using original cards after play phase', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'scoring-test',
      });

      const alice = testGame.game.players[0] as CribbagePlayer;
      const aliceHand = testGame.game.getPlayerHand(alice);

      // Game already dealt 6 cards to each player
      // Simulate discarding 2 cards
      const handCards = [...aliceHand.all(Card)];
      handCards.slice(0, 2).forEach(c => c.putInto(testGame.game.crib));

      // Store original hands (the 4 remaining cards)
      testGame.game.storeOriginalHands();

      // Get the stored IDs before playing
      const storedIds = [...alice.originalHandCardIds];
      expect(storedIds.length).toBe(4);

      // Now simulate all cards being played (moved out of hand)
      for (const card of [...aliceHand.all(Card)]) {
        card.putInto(testGame.game.playedCards);
      }

      // Hand is now empty
      expect(aliceHand.count(Card)).toBe(0);

      // But we should still be able to get original cards
      const originalCards = testGame.game.getOriginalHandCards(alice);
      expect(originalCards.length).toBe(4);

      // Scoring should work using original hand cards
      const score = testGame.game.scorePlayerHand(alice);

      // Score depends on the actual cards, but it shouldn't error
      expect(score).toBeDefined();
      expect(score.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Go Flow', () => {
    it('should track when player says Go', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'go-test',
      });

      expect(testGame.game.playerSaidGo[0]).toBe(false);
      expect(testGame.game.playerSaidGo[1]).toBe(false);

      // Simulate player 0 saying Go
      testGame.game.playerSaidGo[0] = true;

      expect(testGame.game.playerSaidGo[0]).toBe(true);
      expect(testGame.game.playerSaidGo[1]).toBe(false);
    });

    it('should reset Go flags when count resets', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
        seed: 'go-reset-test',
      });

      // Set both players as having said Go
      testGame.game.playerSaidGo[0] = true;
      testGame.game.playerSaidGo[1] = true;

      // Reset count
      testGame.game.resetCount();

      // Go flags should be reset
      expect(testGame.game.playerSaidGo[0]).toBe(false);
      expect(testGame.game.playerSaidGo[1]).toBe(false);
    });
  });

  describe('Scoring Functions', () => {
    it('should score fifteens correctly', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      // Get all aces from everywhere in the game (deck + hands)
      const allCards = [...testGame.game.all(Card)];
      const aces = allCards.filter(c => c.rank === 'A').slice(0, 4);

      // Four aces = no fifteens (sum is only 4), but 6 pairs
      const score = scoreHand(aces, null, false);
      expect(score.fifteens).toBe(0); // No fifteens
      expect(score.pairs).toBe(12); // Four of a kind = 6 pairs * 2
    });

    it('should score pairs correctly', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const aces = allCards.filter(c => c.rank === 'A').slice(0, 2);
      const twos = allCards.filter(c => c.rank === '2').slice(0, 2);

      // Two pairs = 4 points
      const score = scoreHand([...aces, ...twos], null, false);
      expect(score.pairs).toBe(4);
    });

    it('should score runs correctly', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const ace = allCards.find(c => c.rank === 'A')!;
      const two = allCards.find(c => c.rank === '2')!;
      const three = allCards.find(c => c.rank === '3')!;
      const four = allCards.find(c => c.rank === '4')!;

      // Run of 4 = 4 points
      const score = scoreHand([ace, two, three, four], null, false);
      expect(score.runs).toBe(4);
    });
  });

  describe('Detailed Scoring (Animated Reveal)', () => {
    it('should return individual scoring items for pairs', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const aces = allCards.filter(c => c.rank === 'A').slice(0, 2);
      const twos = allCards.filter(c => c.rank === '2').slice(0, 2);

      // Two pairs should give 2 separate scoring items
      const score = scoreHandDetailed([...aces, ...twos], null, false);

      const pairItems = score.items.filter(i => i.category === 'pair');
      expect(pairItems.length).toBe(2); // Two separate pairs
      expect(pairItems[0].points).toBe(2);
      expect(pairItems[1].points).toBe(2);
      expect(score.total).toBe(4);
    });

    it('should return individual scoring items for fifteens', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const five = allCards.find(c => c.rank === '5')!;
      const ten = allCards.find(c => c.rank === '10')!;
      const ace = allCards.find(c => c.rank === 'A')!;
      const four = allCards.find(c => c.rank === '4')!;

      // 5+10=15, also A+4+10=15
      const score = scoreHandDetailed([five, ten, ace, four], null, false);

      const fifteenItems = score.items.filter(i => i.category === 'fifteen');
      // 5+10=15, also A+4+10=15
      expect(fifteenItems.length).toBe(2);
      expect(fifteenItems[0].points).toBe(2);
    });

    it('should include card references in scoring items', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const aces = allCards.filter(c => c.rank === 'A').slice(0, 2);
      const twos = allCards.filter(c => c.rank === '2').slice(0, 2);

      const score = scoreHandDetailed([...aces, ...twos], null, false);

      for (const item of score.items) {
        expect(item.cards.length).toBeGreaterThan(0);
        expect(item.description).toBeTruthy();
      }
    });

    it('should have description strings for each item', () => {
      const testGame = createTestGame(CribbageGame, {
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });

      const allCards = [...testGame.game.all(Card)];
      const ace = allCards.find(c => c.rank === 'A')!;
      const two = allCards.find(c => c.rank === '2')!;
      const three = allCards.find(c => c.rank === '3')!;
      const four = allCards.find(c => c.rank === '4')!;

      const score = scoreHandDetailed([ace, two, three, four], null, false);

      const runItems = score.items.filter(i => i.category === 'run');
      expect(runItems.length).toBe(1);
      expect(runItems[0].description).toContain('Run');
      expect(runItems[0].description).toContain('4');
    });
  });
});
