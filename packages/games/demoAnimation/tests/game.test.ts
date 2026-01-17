import { describe, it, expect } from 'vitest';
import { createTestGame } from '@boardsmith/testing';
import { Player } from '@boardsmith/engine';
import { DemoGame, DemoPlayer } from '../src/rules/game.js';
import { Card } from '../src/rules/elements.js';

describe('DemoGame', () => {
  it('should create a game with correct initial deck size', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    // Deck starts with 20 cards (4 suits * 5 ranks)
    // After dealing 3 to one player, deck should have 17 cards
    expect(testGame.game.deck.all(Card).length).toBe(17);
  });

  it('should deal 3 cards to each player', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    for (const player of testGame.game.all(Player) as DemoPlayer[]) {
      expect(player.hand.all(Card).length).toBe(3);
    }
    // With 2 players: 20 - 6 = 14 cards in deck
    expect(testGame.game.deck.all(Card).length).toBe(14);
  });

  it('should execute draw action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const initialHandCount = player.hand.all(Card).length;
    const initialDeckCount = game.deck.all(Card).length;

    const result = game.performAction('draw', player, {});

    expect(result.success).toBe(true);
    expect(player.hand.all(Card).length).toBe(initialHandCount + 1);
    expect(game.deck.all(Card).length).toBe(initialDeckCount - 1);
  });

  it('should execute discard action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const card = player.hand.first(Card)!;
    const initialHandCount = player.hand.all(Card).length;

    const result = game.performAction('discard', player, { card: card.id });

    expect(result.success).toBe(true);
    expect(player.hand.all(Card).length).toBe(initialHandCount - 1);
    expect(game.discardPile.all(Card).length).toBe(1);
  });

  it('should execute shuffle action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;

    // Shuffle requires at least 2 cards
    const result = game.performAction('shuffle', player, {});

    expect(result.success).toBe(true);
    // Hand should still have same number of cards
    expect(player.hand.all(Card).length).toBe(3);
  });

  it('should execute score action and add points', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const card = player.hand.first(Card)!;
    const expectedPoints = card.pointValue;
    const initialScore = player.score;

    const result = game.performAction('score', player, { card: card.id });

    expect(result.success).toBe(true);
    expect(player.score).toBe(initialScore + expectedPoints);
    expect(game.scoreZone.all(Card).length).toBe(1);
  });

  it('should execute transfer action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const card = player.hand.first(Card)!;
    const initialHandCount = player.hand.all(Card).length;

    const result = game.performAction('transfer', player, { card: card.id });

    expect(result.success).toBe(true);
    expect(player.hand.all(Card).length).toBe(initialHandCount - 1);
    expect(game.transferZone.all(Card).length).toBe(1);
  });

  it('should execute return action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;

    // First transfer a card
    const card = player.hand.first(Card)!;
    game.performAction('transfer', player, { card: card.id });
    expect(game.transferZone.all(Card).length).toBe(1);

    // Now return it
    const transferredCard = game.transferZone.first(Card)!;
    const result = game.performAction('return', player, { card: transferredCard.id });

    expect(result.success).toBe(true);
    expect(game.transferZone.all(Card).length).toBe(0);
    expect(player.hand.all(Card).length).toBe(3);
  });

  it('should execute reveal action on face-down card', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;

    // First hide a card
    const card = player.hand.first(Card)!;
    game.performAction('hide', player, { card: card.id });
    expect(card.faceUp).toBe(false);

    // Now reveal it
    const result = game.performAction('reveal', player, { card: card.id });

    expect(result.success).toBe(true);
    expect(card.faceUp).toBe(true);
  });

  it('should execute hide action on face-up card', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const card = player.hand.first(Card)!;

    // Cards start face up
    expect(card.faceUp).toBe(true);

    const result = game.performAction('hide', player, { card: card.id });

    expect(result.success).toBe(true);
    expect(card.faceUp).toBe(false);
  });

  it('should execute deal action', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    const game = testGame.game;
    const player = game.getPlayer(1) as DemoPlayer;
    const initialHandCount = player.hand.all(Card).length;

    const result = game.performAction('deal', player, {});

    expect(result.success).toBe(true);
    expect(player.hand.all(Card).length).toBe(initialHandCount + 1);
    expect(game.lastDealtCard).not.toBeNull();
  });

  it('should not be finished when deck or hands have cards', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 1, seed: 'test' });
    expect(testGame.game.isFinished()).toBe(false);
  });

  it('should determine winner by highest score', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    const game = testGame.game;
    const player1 = game.getPlayer(1) as DemoPlayer;
    const player2 = game.getPlayer(2) as DemoPlayer;

    // Score some cards for player 1
    const card1 = player1.hand.first(Card)!;
    game.performAction('score', player1, { card: card1.id });

    // Verify player1 has higher score
    expect(player1.score).toBeGreaterThan(player2.score);
  });
});
