import { describe, it, expect } from 'vitest';
import { createTestGame } from '@boardsmith/testing';
import { Player } from '@boardsmith/engine';
import { FlossBittiesGame } from '../src/rules/game.js';
import { Card, PlayArea, DiscardPile, FlossBittiesPlayer, SUITS } from '../src/rules/elements.js';

describe('FlossBittiesGame', () => {
  it('should create a game with correct number of cards in deck', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    // 72 total cards - 16 dealt (8 per player) = 56 in deck
    expect(testGame.game.deck.count(Card)).toBe(56);
  });

  it('should deal 8 cards to each player', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    for (const player of testGame.game.all(Player)) {
      const hand = testGame.game.getPlayerHand(player);
      expect(hand.count(Card)).toBe(8);
    }
  });

  it('should create play areas for each player and suit', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    for (const player of testGame.game.all(Player)) {
      for (const suit of SUITS) {
        const area = testGame.game.getPlayArea(player, suit);
        expect(area).toBeDefined();
        expect(area.suit).toBe(suit);
      }
    }
  });

  it('should create discard piles for each suit', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    for (const suit of SUITS) {
      const pile = testGame.game.getDiscardPile(suit);
      expect(pile).toBeDefined();
      expect(pile.suit).toBe(suit);
    }
  });

  it('should calculate area score correctly for empty area', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const score = testGame.game.calculateAreaScore(player, 'Red');
    expect(score).toBe(0); // Empty area = 0 points
  });

  it('should calculate area score with cards', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const area = testGame.game.getPlayArea(player, 'Red');

    // Create test cards directly in play area: 3, 7, 9, 10 = 29 - 20 = 9
    area.create(Card, '3 of Red', { suit: 'Red', rank: '3' });
    area.create(Card, '7 of Red', { suit: 'Red', rank: '7' });
    area.create(Card, '9 of Red', { suit: 'Red', rank: '9' });
    area.create(Card, '10 of Red', { suit: 'Red', rank: '10' });

    const score = testGame.game.calculateAreaScore(player, 'Red');
    expect(score).toBe(9); // 29 - 20 = 9
  });

  it('should calculate area score with wager cards', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const area = testGame.game.getPlayArea(player, 'Blue');

    // 2 wagers + 8, 9, 10 = 27 - 20 = 7, × 3 (for 2 wagers) = 21
    area.create(Card, 'Blue Wager 1', { suit: 'Blue', rank: 'Wager' });
    area.create(Card, 'Blue Wager 2', { suit: 'Blue', rank: 'Wager' });
    area.create(Card, '8 of Blue', { suit: 'Blue', rank: '8' });
    area.create(Card, '9 of Blue', { suit: 'Blue', rank: '9' });
    area.create(Card, '10 of Blue', { suit: 'Blue', rank: '10' });

    const score = testGame.game.calculateAreaScore(player, 'Blue');
    expect(score).toBe(21); // (27 - 20) × 3 = 21
  });

  it('should calculate negative score correctly', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const area = testGame.game.getPlayArea(player, 'Green');

    // Just a 2 = 2 - 20 = -18
    area.create(Card, '2 of Green', { suit: 'Green', rank: '2' });

    const score = testGame.game.calculateAreaScore(player, 'Green');
    expect(score).toBe(-18);
  });

  it('should calculate negative score with wagers', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const area = testGame.game.getPlayArea(player, 'Yellow');

    // 3 wagers only = 0 - 20 = -20, × 4 = -80
    area.create(Card, 'Yellow Wager 1', { suit: 'Yellow', rank: 'Wager' });
    area.create(Card, 'Yellow Wager 2', { suit: 'Yellow', rank: 'Wager' });
    area.create(Card, 'Yellow Wager 3', { suit: 'Yellow', rank: 'Wager' });

    const score = testGame.game.calculateAreaScore(player, 'Yellow');
    expect(score).toBe(-80); // (0 - 20) × 4 = -80
  });

  it('should enforce ascending order for playable cards', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    const player = testGame.game.getPlayer(1)!;
    const area = testGame.game.getPlayArea(player, 'Purple');
    const hand = testGame.game.getPlayerHand(player);

    // Play a 5 to the area
    area.create(Card, '5 of Purple', { suit: 'Purple', rank: '5' });

    // Create test cards in hand
    const card3 = hand.create(Card, 'test-3', { suit: 'Purple', rank: '3' });
    const card7 = hand.create(Card, 'test-7', { suit: 'Purple', rank: '7' });
    const wager = hand.create(Card, 'test-wager', { suit: 'Purple', rank: 'Wager' });

    expect(testGame.game.canPlayToArea(player, card3)).toBe(false); // 3 < 5
    expect(testGame.game.canPlayToArea(player, card7)).toBe(true); // 7 > 5
    expect(testGame.game.canPlayToArea(player, wager)).toBe(false); // 0 < 5
  });

  it('should end game when deck is empty', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    expect(testGame.game.isFinished()).toBe(false);

    // Empty the deck
    while (testGame.game.deck.count(Card) > 0) {
      const card = testGame.game.deck.first(Card);
      if (card) card.remove();
    }

    expect(testGame.game.isFinished()).toBe(true);
  });

  it('should not be finished at game start', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    expect(testGame.game.isFinished()).toBe(false);
  });

  it('should have no winners at game start', () => {
    const testGame = createTestGame(FlossBittiesGame, {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'test',
    });

    expect(testGame.game.getWinners()).toEqual([]);
  });
});
