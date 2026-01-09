import { describe, it, expect } from 'vitest';
import { createTestGame } from '@boardsmith/testing';
import { Player } from '@boardsmith/engine';
import { DemoGame, DemoPlayer } from '../src/rules/game.js';
import { Card } from '../src/rules/elements.js';

describe('DemoGame', () => {
  it('should create a game with correct number of cards', () => {
    // Use createTestGame which properly initializes the game with flow
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    // Deck should have 52 - (5 * 2) = 42 cards after dealing 5 to each player
    expect(testGame.game.deck.all(Card).length).toBe(42);
  });

  it('should deal 5 cards to each player', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    for (const player of testGame.game.all(Player) as DemoPlayer[]) {
      expect(player.hand.all(Card).length).toBe(5);
    }
  });

  it('should execute trade action with { value, display } choice object', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    const game = testGame.game;
    const player1 = game.getPlayer(1) as DemoPlayer;
    const player2 = game.getPlayer(2) as DemoPlayer;

    // Get a card from player 1's hand
    const myCard = player1.hand.first(Card)!;
    const player1HandCountBefore = player1.hand.all(Card).length;

    // Execute trade action with the full { value, display } choice object
    // (simulating what the UI sends when using playerChoices())
    const result = game.performAction('trade', player1, {
      myCard: myCard.id,
      targetPlayer: { value: 2, display: 'Player 2' },
    });

    expect(result.success).toBe(true);
    // Player 1 traded 1 card but should get 1 back from player 2
    expect(player1.hand.all(Card).length).toBe(player1HandCountBefore);
    // Player 2 should still have 5 cards (got 1, gave 1)
    expect(player2.hand.all(Card).length).toBe(5);
  });

  it('should execute gift action with { value, display } choice object', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    const game = testGame.game;
    const player1 = game.getPlayer(1) as DemoPlayer;
    const player2 = game.getPlayer(2) as DemoPlayer;

    // Get a card from player 1's hand
    const card = player1.hand.first(Card)!;
    const initialScore = player1.score ?? 0;
    const player2HandCountBefore = player2.hand.all(Card).length;

    // Execute gift action with the full { value, display } choice object
    const result = game.performAction('gift', player1, {
      card: card.id,
      recipient: { value: 2, display: 'Player 2' },
    });

    expect(result.success).toBe(true);
    // Player 1 should have scored points for gifting
    expect(player1.score).toBeGreaterThan(initialScore);
    // Player 2 should have one more card
    expect(player2.hand.all(Card).length).toBe(player2HandCountBefore + 1);
  });
});
